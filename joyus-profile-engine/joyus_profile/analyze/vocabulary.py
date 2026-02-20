"""Vocabulary analysis: signature phrases, preferred/avoided terms, technical terms."""

from __future__ import annotations

import math
from collections import Counter

import spacy

from joyus_profile.models.corpus import ProcessedCorpus
from joyus_profile.models.features import VocabularyProfile

# Common English words (top 200) used as baseline for preferred/avoided detection
_COMMON_WORDS = {
    "the", "be", "to", "of", "and", "a", "in", "that", "have", "i",
    "it", "for", "not", "on", "with", "he", "as", "you", "do", "at",
    "this", "but", "his", "by", "from", "they", "we", "say", "her", "she",
    "or", "an", "will", "my", "one", "all", "would", "there", "their", "what",
    "so", "up", "out", "if", "about", "who", "get", "which", "go", "me",
    "when", "make", "can", "like", "time", "no", "just", "him", "know", "take",
    "people", "into", "year", "your", "good", "some", "could", "them", "see",
    "other", "than", "then", "now", "look", "only", "come", "its", "over",
    "think", "also", "back", "after", "use", "two", "how", "our", "work",
    "first", "well", "way", "even", "new", "want", "because", "any", "these",
    "give", "day", "most", "us",
}

# Lazy spaCy model
_nlp = None


def _get_nlp():
    global _nlp
    if _nlp is None:
        _nlp = spacy.load("en_core_web_md", exclude=["ner"])
    return _nlp


class VocabularyAnalyzer:
    """Extract vocabulary usage patterns from a corpus."""

    def extract(self, corpus: ProcessedCorpus) -> VocabularyProfile:
        """Extract vocabulary profile from processed corpus."""
        nlp = _get_nlp()
        texts = [doc.text for doc in corpus.corpus.documents]
        if not texts:
            return VocabularyProfile()

        # Tokenize and collect data
        all_tokens: list[str] = []
        bigrams: Counter = Counter()
        trigrams: Counter = Counter()

        for text in texts:
            doc = nlp(text)
            tokens = [t.text.lower() for t in doc if not t.is_space and not t.is_punct]
            all_tokens.extend(tokens)

            # Collect multi-word expressions
            for i in range(len(tokens) - 1):
                bigrams[f"{tokens[i]} {tokens[i+1]}"] += 1
            for i in range(len(tokens) - 2):
                trigrams[f"{tokens[i]} {tokens[i+1]} {tokens[i+2]}"] += 1

        word_freq = Counter(all_tokens)
        total = len(all_tokens)
        if total == 0:
            return VocabularyProfile()

        # Signature phrases: multi-word expressions with high PMI
        signature = self._extract_signature_phrases(word_freq, bigrams, trigrams, total)

        # Preferred terms: used significantly more than baseline
        preferred = self._extract_preferred_terms(word_freq, total)

        # Avoided terms: common words the author uses much less than expected
        avoided = self._extract_avoided_terms(word_freq, total)

        # Technical terms: low-frequency, Latinate, or domain-specific
        technical = self._extract_technical_terms(word_freq, texts, nlp)

        return VocabularyProfile(
            signature_phrases=signature,
            preferred_terms=preferred,
            avoided_terms=avoided,
            technical_terms=technical,
        )

    def _extract_signature_phrases(
        self,
        word_freq: Counter,
        bigrams: Counter,
        trigrams: Counter,
        total: int,
    ) -> list[str]:
        """Extract multi-word expressions using PMI (pointwise mutual information)."""
        signatures = []

        # Bigram PMI
        for bigram, count in bigrams.most_common(200):
            if count < 3:
                continue
            w1, w2 = bigram.split()
            p_bigram = count / total
            p_w1 = word_freq.get(w1, 1) / total
            p_w2 = word_freq.get(w2, 1) / total
            pmi = math.log2(p_bigram / (p_w1 * p_w2)) if p_w1 * p_w2 > 0 else 0
            if pmi > 3.0:
                signatures.append(bigram)

        # Trigram PMI (simplified: compare to expected from bigram + unigram)
        for trigram, count in trigrams.most_common(100):
            if count < 2:
                continue
            words = trigram.split()
            p_trigram = count / total
            p_individual = 1.0
            for w in words:
                p_individual *= word_freq.get(w, 1) / total
            pmi = math.log2(p_trigram / p_individual) if p_individual > 0 else 0
            if pmi > 5.0:
                signatures.append(trigram)

        return signatures[:20]

    def _extract_preferred_terms(
        self, word_freq: Counter, total: int
    ) -> list[str]:
        """Find words used significantly more than expected."""
        preferred = []
        for word, count in word_freq.most_common(500):
            if word in _COMMON_WORDS:
                continue
            if len(word) < 4:
                continue
            freq = count / total
            # Words above 0.1% frequency that aren't common
            if freq > 0.001 and count >= 3:
                preferred.append(word)
        return preferred[:30]

    def _extract_avoided_terms(
        self, word_freq: Counter, total: int
    ) -> list[str]:
        """Find common words the author uses much less than expected."""
        avoided = []
        for word in _COMMON_WORDS:
            if len(word) < 3:
                continue
            freq = word_freq.get(word, 0) / total
            # Significantly below expected frequency for common words
            if freq < 0.0001:
                avoided.append(word)
        return avoided[:20]

    def _extract_technical_terms(
        self,
        word_freq: Counter,
        texts: list[str],
        nlp,
    ) -> list[str]:
        """Extract domain-specific technical terminology."""
        # Use spaCy NER on first doc to seed, then frequency-filter
        technical = []
        seen = set()

        # Find capitalized terms that aren't sentence-initial
        for text in texts[:3]:  # Sample first 3 docs
            doc = nlp(text)
            for token in doc:
                if (
                    token.pos_ in ("NOUN", "PROPN")
                    and len(token.text) > 4
                    and token.text.lower() not in _COMMON_WORDS
                    and word_freq.get(token.text.lower(), 0) >= 2
                    and token.text.lower() not in seen
                ):
                    technical.append(token.text.lower())
                    seen.add(token.text.lower())

        return technical[:30]
