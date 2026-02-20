"""Marker analysis: identify domain-specific terms and phrases with weighted scoring."""

from __future__ import annotations

import math
from collections import Counter
from pathlib import Path

import yaml

from joyus_profile.models.corpus import ProcessedCorpus
from joyus_profile.models.features import Marker, MarkerSet

TEMPLATES_DIR = Path(__file__).parent.parent / "profile" / "templates"


class MarkerAnalyzer:
    """Identify high-signal, medium-signal, and negative markers from a corpus."""

    def __init__(self, max_ngram: int = 4) -> None:
        self.max_ngram = max_ngram

    def extract(self, corpus: ProcessedCorpus, domain: str = "general") -> MarkerSet:
        """Extract markers from a processed corpus."""
        # Gather all text for analysis
        texts = [doc.text for doc in corpus.corpus.documents]
        if not texts:
            return MarkerSet()

        # Extract candidate phrases (1-4 grams)
        doc_phrase_counts = self._extract_phrases_per_doc(texts)
        total_docs = len(texts)

        # Compute TF-IDF scores
        phrase_scores = self._compute_tfidf(doc_phrase_counts, total_docs)

        # Load domain template for boosting
        domain_terms = self._load_domain_terms(domain)

        # Apply domain boost
        for phrase in phrase_scores:
            for term in domain_terms:
                if term in phrase:
                    phrase_scores[phrase] *= 1.5
                    break

        # Compute global frequency
        all_words = " ".join(texts).lower().split()
        total_words = len(all_words)

        # Classify into tiers
        sorted_phrases = sorted(phrase_scores.items(), key=lambda x: x[1], reverse=True)

        high_signal: list[Marker] = []
        medium_signal: list[Marker] = []

        for phrase, score in sorted_phrases:
            freq = sum(
                text.lower().count(phrase) for text in texts
            ) / max(total_words, 1)

            if score > 0.5 and len(high_signal) < 20:
                high_signal.append(
                    Marker(text=phrase, weight=min(score, 1.0), frequency=freq, domain=domain)
                )
            elif score > 0.2 and len(medium_signal) < 30:
                medium_signal.append(
                    Marker(text=phrase, weight=min(score, 1.0), frequency=freq, domain=domain)
                )

            if len(high_signal) >= 20 and len(medium_signal) >= 30:
                break

        # Negative markers: common English phrases NOT found in corpus
        negative = self._find_negative_markers(texts, domain)

        return MarkerSet(
            high_signal=high_signal,
            medium_signal=medium_signal,
            negative_markers=negative,
        )

    def _extract_phrases_per_doc(
        self, texts: list[str]
    ) -> list[Counter]:
        """Extract phrase counts per document."""
        doc_counts = []
        for text in texts:
            words = text.lower().split()
            counts: Counter = Counter()
            for n in range(1, self.max_ngram + 1):
                for i in range(len(words) - n + 1):
                    phrase = " ".join(words[i : i + n])
                    # Filter: skip very short or pure punctuation phrases
                    if len(phrase) > 2 and any(c.isalpha() for c in phrase):
                        counts[phrase] += 1
            doc_counts.append(counts)
        return doc_counts

    def _compute_tfidf(
        self, doc_counts: list[Counter], total_docs: int
    ) -> dict[str, float]:
        """Compute TF-IDF scores across documents."""
        # Document frequency
        df: Counter = Counter()
        for counts in doc_counts:
            for phrase in counts:
                df[phrase] += 1

        # Average TF * IDF
        scores: dict[str, float] = {}
        for phrase, doc_freq in df.items():
            if doc_freq < 2:
                continue  # Skip phrases in only 1 document
            idf = math.log(total_docs / doc_freq) + 1
            avg_tf = sum(c.get(phrase, 0) for c in doc_counts) / total_docs
            scores[phrase] = avg_tf * idf

        return scores

    def _load_domain_terms(self, domain: str) -> list[str]:
        """Load domain-specific terms from template YAML."""
        template_path = TEMPLATES_DIR / f"{domain}.yaml"
        if not template_path.exists():
            return []
        try:
            data = yaml.safe_load(template_path.read_text())
            return data.get("terminology", {}).get("domain_terms", [])
        except Exception:
            return []

    def _find_negative_markers(
        self, texts: list[str], domain: str
    ) -> list[Marker]:
        """Find common phrases the author never uses."""
        corpus_text = " ".join(texts).lower()

        # Common English transition phrases as negative marker candidates
        candidates = [
            "in conclusion", "to summarize", "on the other hand",
            "it goes without saying", "at the end of the day",
            "needless to say", "for what it's worth",
            "having said that", "be that as it may",
            "first and foremost", "last but not least",
        ]

        negative = []
        for phrase in candidates:
            if phrase not in corpus_text:
                negative.append(
                    Marker(text=phrase, weight=0.3, frequency=0.0, domain=domain)
                )

        return negative[:10]  # Cap at 10
