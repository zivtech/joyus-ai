"""Stylometric feature extraction data models."""

from __future__ import annotations

from pydantic import BaseModel, Field


class SentenceLengthStats(BaseModel):
    """Statistics about sentence lengths in a corpus."""

    mean: float = 0.0
    median: float = 0.0
    std: float = 0.0
    min: int = 0
    max: int = 0
    distribution: list[int] = Field(default_factory=list)


class VocabularyRichness(BaseModel):
    """Vocabulary diversity metrics."""

    type_token_ratio: float = 0.0
    hapax_legomena_ratio: float = 0.0
    yules_k: float = 0.0
    simpsons_diversity: float = 0.0
    brunets_w: float = 0.0


class Marker(BaseModel):
    """A content marker (signature phrase or pattern)."""

    text: str
    weight: float = Field(default=0.5, ge=0.0, le=1.0)
    frequency: float = 0.0
    domain: str = "general"


class MarkerSet(BaseModel):
    """Classified content markers for an author."""

    high_signal: list[Marker] = Field(default_factory=list)
    medium_signal: list[Marker] = Field(default_factory=list)
    negative_markers: list[Marker] = Field(default_factory=list)


class VocabularyProfile(BaseModel):
    """Vocabulary usage patterns for an author."""

    signature_phrases: list[str] = Field(default_factory=list)
    preferred_terms: list[str] = Field(default_factory=list)
    avoided_terms: list[str] = Field(default_factory=list)
    technical_terms: list[str] = Field(default_factory=list)


class StructuralPatterns(BaseModel):
    """Document and paragraph structural patterns."""

    avg_paragraph_length: float = 0.0
    avg_paragraphs_per_doc: float = 0.0
    heading_frequency: float = 0.0
    list_usage_ratio: float = 0.0
    citation_density: float = 0.0


class AudienceProfile(BaseModel):
    """Audience register and formality analysis."""

    primary_register: str = "neutral"
    formality_score: float = Field(default=5.0, ge=0.0, le=10.0)
    detected_audiences: list[str] = Field(default_factory=list)


class StylometricFeatures(BaseModel):
    """Full 129-feature extraction result from all analyzers."""

    function_word_frequencies: dict[str, float] = Field(default_factory=dict)
    sentence_length_stats: SentenceLengthStats = Field(default_factory=SentenceLengthStats)
    vocabulary_richness: VocabularyRichness = Field(default_factory=VocabularyRichness)
    punctuation_ratios: dict[str, float] = Field(default_factory=dict)
    character_ngrams: dict[str, float] = Field(default_factory=dict)
    pos_ngrams: dict[str, float] = Field(default_factory=dict)
    burrows_delta_baseline: float | None = None
    feature_count: int = 0
