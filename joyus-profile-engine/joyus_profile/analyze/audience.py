"""Audience analysis: register detection and formality scoring."""

from __future__ import annotations

from collections import Counter

import spacy

from joyus_profile.models.corpus import ProcessedCorpus
from joyus_profile.models.features import AudienceProfile

# Lazy spaCy model
_nlp = None


def _get_nlp():
    global _nlp
    if _nlp is None:
        _nlp = spacy.load("en_core_web_md", exclude=["ner"])
    return _nlp


# Formality indicators (higher = more formal)
_FORMAL_INDICATORS = {
    "furthermore", "moreover", "consequently", "nevertheless", "notwithstanding",
    "pursuant", "herein", "thereof", "whereas", "accordingly",
    "therefore", "thus", "hence", "hereafter", "hereinafter",
}

_INFORMAL_INDICATORS = {
    "gonna", "wanna", "gotta", "kinda", "sorta", "stuff", "things",
    "basically", "literally", "actually", "pretty", "really", "super",
    "awesome", "cool", "hey", "okay", "ok", "yeah", "yep", "nope",
}

# Audience detection keywords
_AUDIENCE_SIGNALS = {
    "courts": ["plaintiff", "defendant", "court", "judge", "ruling", "statute", "jurisdiction"],
    "regulators": ["regulation", "compliance", "enforcement", "rulemaking", "agency", "commission"],
    "practitioners": ["implementation", "methodology", "framework", "best practice", "protocol"],
    "general_public": ["everyone", "people", "community", "public", "everyday", "simple"],
    "academics": ["research", "study", "findings", "hypothesis", "methodology", "analysis"],
}


class AudienceAnalyzer:
    """Detect writing register and target audiences."""

    def extract(self, corpus: ProcessedCorpus) -> AudienceProfile:
        """Analyze audience register and formality."""
        nlp = _get_nlp()
        texts = [doc.text for doc in corpus.corpus.documents]
        if not texts:
            return AudienceProfile()

        combined = " ".join(texts)
        doc = nlp(combined)

        # POS-based metrics
        pos_counts = Counter(token.pos_ for token in doc if not token.is_space)
        total_tokens = sum(pos_counts.values())

        # Passive voice ratio (approximation via auxiliary + past participle)
        passive_count = self._count_passive(doc)
        passive_ratio = passive_count / max(len(list(doc.sents)), 1)

        # Nominal vs verbal ratio (formal text tends to be more nominal)
        noun_ratio = (pos_counts.get("NOUN", 0) + pos_counts.get("PROPN", 0)) / max(total_tokens, 1)
        verb_ratio = pos_counts.get("VERB", 0) / max(total_tokens, 1)
        nominal_ratio = noun_ratio / max(verb_ratio, 0.01)

        # Sentence complexity (avg tokens per sentence)
        sentences = list(doc.sents)
        avg_sent_len = total_tokens / max(len(sentences), 1)

        # Formality word signals
        lower_text = combined.lower()
        formal_hits = sum(1 for w in _FORMAL_INDICATORS if w in lower_text)
        informal_hits = sum(1 for w in _INFORMAL_INDICATORS if w in lower_text)

        # Compute formality score (0-10)
        formality = self._compute_formality(
            passive_ratio, nominal_ratio, avg_sent_len, formal_hits, informal_hits
        )

        # Determine register
        register = self._classify_register(formality)

        # Detect audiences
        audiences = self._detect_audiences(lower_text)

        return AudienceProfile(
            primary_register=register,
            formality_score=round(formality, 1),
            detected_audiences=audiences,
        )

    def _count_passive(self, doc) -> int:
        """Count approximate passive voice constructions."""
        count = 0
        for token in doc:
            if token.dep_ == "nsubjpass" or (
                token.dep_ == "auxpass" and token.head.tag_ in ("VBN", "VBD")
            ):
                count += 1
        return count

    def _compute_formality(
        self,
        passive_ratio: float,
        nominal_ratio: float,
        avg_sent_len: float,
        formal_hits: int,
        informal_hits: int,
    ) -> float:
        """Compute formality score on 0-10 scale."""
        score = 5.0  # Start neutral

        # Passive voice increases formality
        score += min(passive_ratio * 3, 1.5)

        # High noun-to-verb ratio is more formal
        if nominal_ratio > 2.0:
            score += 1.0
        elif nominal_ratio > 1.5:
            score += 0.5

        # Longer sentences tend to be more formal
        if avg_sent_len > 25:
            score += 1.0
        elif avg_sent_len > 18:
            score += 0.5
        elif avg_sent_len < 10:
            score -= 1.0

        # Formal/informal word signals
        score += min(formal_hits * 0.2, 1.5)
        score -= min(informal_hits * 0.3, 2.0)

        return max(0.0, min(10.0, score))

    def _classify_register(self, formality: float) -> str:
        """Classify register from formality score."""
        if formality >= 7.5:
            return "formal"
        elif formality >= 5.5:
            return "professional"
        elif formality >= 3.5:
            return "neutral"
        elif formality >= 2.0:
            return "conversational"
        else:
            return "informal"

    def _detect_audiences(self, text: str) -> list[str]:
        """Detect likely target audiences from vocabulary signals."""
        audience_scores: dict[str, int] = {}
        for audience, keywords in _AUDIENCE_SIGNALS.items():
            hits = sum(1 for kw in keywords if kw in text)
            if hits >= 2:
                audience_scores[audience] = hits

        # Sort by hit count, return top audiences
        sorted_audiences = sorted(audience_scores.items(), key=lambda x: x[1], reverse=True)
        return [a for a, _ in sorted_audiences[:3]]
