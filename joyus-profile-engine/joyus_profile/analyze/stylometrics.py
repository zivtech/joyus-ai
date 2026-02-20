"""Stylometric analysis: Burrows' Delta, sentence stats, punctuation, n-grams."""

from __future__ import annotations

import string
from collections import Counter

import numpy as np
import spacy

from joyus_profile.models.corpus import ProcessedCorpus
from joyus_profile.models.features import (
    SentenceLengthStats,
    StylometricFeatures,
    VocabularyRichness,
)

# Lazy-loaded spaCy model
_nlp = None


def _get_nlp():
    global _nlp
    if _nlp is None:
        _nlp = spacy.load("en_core_web_md", exclude=["ner"])
    return _nlp


class StylometricAnalyzer:
    """Extract stylometric features from a processed corpus."""

    def extract(self, corpus: ProcessedCorpus) -> StylometricFeatures:
        """Run full feature extraction pipeline."""
        from faststylometry import Corpus as FastCorpus

        # Build faststylometry corpus
        from faststylometry import tokenise_remove_pronouns_en

        fast_corpus = FastCorpus()
        for doc in corpus.corpus.documents:
            author = doc.metadata.author or "primary"
            fast_corpus.add_book(author, doc.doc_id, doc.text)
        fast_corpus.tokenise(tokenise_remove_pronouns_en)

        # Function word frequencies from faststylometry
        func_words = self._extract_function_words(fast_corpus)

        # Burrows' Delta self-distance baseline
        baseline = self._compute_self_distance(fast_corpus)

        # Custom features via spaCy
        nlp = _get_nlp()
        all_tokens: list[str] = []
        all_pos: list[str] = []
        sentence_lengths: list[int] = []
        all_text = ""

        for chunk in corpus.chunks:
            doc = nlp(chunk.text)
            for sent in doc.sents:
                sentence_lengths.append(len(sent))
            for token in doc:
                if not token.is_space:
                    all_tokens.append(token.text.lower())
                    all_pos.append(token.pos_)
            all_text += chunk.text + " "

        if not all_tokens:
            # Fallback: process document texts directly
            for doc_model in corpus.corpus.documents:
                doc = nlp(doc_model.text)
                for sent in doc.sents:
                    sentence_lengths.append(len(sent))
                for token in doc:
                    if not token.is_space:
                        all_tokens.append(token.text.lower())
                        all_pos.append(token.pos_)
                all_text += doc_model.text + " "

        sent_stats = self._sentence_stats(sentence_lengths)
        vocab_richness = self._vocabulary_richness(all_tokens)
        punct_ratios = self._punctuation_ratios(all_text, len(all_tokens))
        char_ngrams = self._character_ngrams(all_text, n=3)
        pos_ngrams = self._pos_ngrams(all_pos, n=2)

        feature_count = (
            len(func_words)
            + 6  # sentence stats (mean, median, std, min, max, distribution)
            + 5  # vocabulary richness
            + len(punct_ratios)
            + len(char_ngrams)
            + len(pos_ngrams)
            + (1 if baseline is not None else 0)
        )

        return StylometricFeatures(
            function_word_frequencies=func_words,
            sentence_length_stats=sent_stats,
            vocabulary_richness=vocab_richness,
            punctuation_ratios=punct_ratios,
            character_ngrams=char_ngrams,
            pos_ngrams=pos_ngrams,
            burrows_delta_baseline=baseline,
            feature_count=feature_count,
        )

    def _extract_function_words(self, fast_corpus) -> dict[str, float]:
        """Extract function word frequencies from a faststylometry Corpus."""
        word_counts: Counter = Counter()
        total = 0
        # fast_corpus.tokens is a list of lists (one token list per book)
        for book_tokens in fast_corpus.tokens:
            for token in book_tokens:
                word_counts[token] += 1
                total += 1
        if total == 0:
            return {}
        return {w: c / total for w, c in word_counts.most_common(50)}

    def _compute_self_distance(self, fast_corpus) -> float | None:
        """Compute Burrows' Delta self-distance as a baseline."""
        try:
            from faststylometry import calculate_burrows_delta

            df = calculate_burrows_delta(fast_corpus, fast_corpus)
            if df.empty:
                return None
            # Average self-distance across diagonal
            values = np.diag(df.values)
            return float(np.mean(values))
        except Exception:
            return None

    def _sentence_stats(self, lengths: list[int]) -> SentenceLengthStats:
        """Compute sentence length statistics."""
        if not lengths:
            return SentenceLengthStats()
        arr = np.array(lengths)
        hist, _ = np.histogram(arr, bins=min(20, len(set(lengths))))
        return SentenceLengthStats(
            mean=float(np.mean(arr)),
            median=float(np.median(arr)),
            std=float(np.std(arr)),
            min=int(np.min(arr)),
            max=int(np.max(arr)),
            distribution=hist.tolist(),
        )

    def _vocabulary_richness(self, tokens: list[str]) -> VocabularyRichness:
        """Compute vocabulary diversity metrics."""
        if not tokens:
            return VocabularyRichness()
        n = len(tokens)
        freq = Counter(tokens)
        v = len(freq)

        ttr = v / n if n > 0 else 0.0
        hapax = sum(1 for c in freq.values() if c == 1)
        hapax_ratio = hapax / n if n > 0 else 0.0

        # Yule's K
        freq_spectrum = Counter(freq.values())
        m2 = sum(i * i * vi for i, vi in freq_spectrum.items())
        yules_k = 10000 * (m2 - n) / (n * n) if n > 1 else 0.0

        # Simpson's diversity
        simpsons = 1.0 - sum(f * (f - 1) for f in freq.values()) / (n * (n - 1)) if n > 1 else 0.0

        # Brunet's W
        brunets_w = n ** (v ** -0.172) if v > 0 else 0.0

        return VocabularyRichness(
            type_token_ratio=ttr,
            hapax_legomena_ratio=hapax_ratio,
            yules_k=yules_k,
            simpsons_diversity=simpsons,
            brunets_w=brunets_w,
        )

    def _punctuation_ratios(self, text: str, total_tokens: int) -> dict[str, float]:
        """Compute punctuation character ratios."""
        if total_tokens == 0:
            return {}
        counts = Counter(c for c in text if c in string.punctuation)
        return {char: count / total_tokens for char, count in counts.most_common()}

    def _character_ngrams(self, text: str, n: int = 3) -> dict[str, float]:
        """Extract top-100 character trigram frequencies."""
        text = text.lower().replace(" ", "_")
        ngrams: Counter = Counter()
        for i in range(len(text) - n + 1):
            ngrams[text[i : i + n]] += 1
        total = sum(ngrams.values())
        if total == 0:
            return {}
        return {ng: c / total for ng, c in ngrams.most_common(100)}

    def _pos_ngrams(self, pos_tags: list[str], n: int = 2) -> dict[str, float]:
        """Extract POS tag bigram frequencies."""
        if len(pos_tags) < n:
            return {}
        ngrams: Counter = Counter()
        for i in range(len(pos_tags) - n + 1):
            ngrams["_".join(pos_tags[i : i + n])] += 1
        total = sum(ngrams.values())
        return {ng: c / total for ng, c in ngrams.most_common(50)}

    def score_against(self, text: str, profile_features: StylometricFeatures) -> float:
        """Score a text against pre-computed profile features using Burrows' Delta."""
        from faststylometry import Corpus as FastCorpus
        from faststylometry import (
            calculate_burrows_delta,
            tokenise_remove_pronouns_en,
        )

        # Build test corpus
        test_corpus = FastCorpus()
        test_corpus.add_book("test", "output", text)
        test_corpus.tokenise(tokenise_remove_pronouns_en)

        # Build reference corpus (placeholder — real usage would rebuild from stored profile)
        ref_corpus = FastCorpus()
        ref_corpus.add_book("reference", "profile", text)
        ref_corpus.tokenise(tokenise_remove_pronouns_en)

        try:
            df = calculate_burrows_delta(ref_corpus, test_corpus)
            return float(df.iloc[0, 0])
        except Exception:
            return float("inf")
