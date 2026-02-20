"""Core profile data models: AuthorProfile, VoiceContext, and supporting types."""

from __future__ import annotations

from datetime import datetime
from enum import Enum

from pydantic import BaseModel, Field

from .features import (
    AudienceProfile,
    MarkerSet,
    StructuralPatterns,
    StylometricFeatures,
    VocabularyProfile,
)


class ContentAccessLevel(str, Enum):
    PUBLIC = "public"
    SUBSCRIBER = "subscriber"
    GROUP = "group"
    INTERNAL = "internal"


class AuthorIdentity(BaseModel):
    """Background and role information for an author."""

    role: str = ""
    organization: str = ""
    background: str = ""
    expertise_areas: list[str] = Field(default_factory=list)


class ExpertiseDomains(BaseModel):
    """Primary and secondary specialization areas."""

    primary: list[str] = Field(default_factory=list)
    secondary: list[str] = Field(default_factory=list)
    certifications: list[str] = Field(default_factory=list)


class Position(BaseModel):
    """A stance declaration with strength and evidence."""

    topic: str
    stance: str
    strength: float = Field(default=0.5, ge=0.0, le=1.0)
    evidence: list[str] = Field(default_factory=list)
    context: str = ""


class VoiceProfile(BaseModel):
    """Voice characteristics: formality, emotion, directness, complexity."""

    formality: float = Field(default=5.0, ge=0.0, le=10.0)
    emotion: float = Field(default=5.0, ge=0.0, le=10.0)
    directness: float = Field(default=5.0, ge=0.0, le=10.0)
    complexity: float = Field(default=5.0, ge=0.0, le=10.0)
    tone_descriptors: list[str] = Field(default_factory=list)


class ArgumentationProfile(BaseModel):
    """Evidence hierarchy and logical reasoning patterns."""

    evidence_types: list[str] = Field(default_factory=list)
    reasoning_patterns: list[str] = Field(default_factory=list)
    evidence_hierarchy: list[str] = Field(default_factory=list)
    logical_structures: list[str] = Field(default_factory=list)


class CitationProfile(BaseModel):
    """Preferred sources and citation style."""

    preferred_sources: list[str] = Field(default_factory=list)
    citation_style: str = ""
    source_types: list[str] = Field(default_factory=list)
    citation_frequency: float = 0.0


class AntiPatterns(BaseModel):
    """Things the author never does or common AI mistakes to avoid."""

    never_do: list[str] = Field(default_factory=list)
    common_ai_mistakes: list[str] = Field(default_factory=list)
    prohibited_phrases: list[str] = Field(default_factory=list)


class ExampleOutputs(BaseModel):
    """Annotated examples of good and bad writing in the author's style."""

    good_examples: list[str] = Field(default_factory=list)
    bad_examples: list[str] = Field(default_factory=list)
    annotations: dict[str, str] = Field(default_factory=dict)


class EdgeCase(BaseModel):
    """A scenario with specific guidance for handling."""

    scenario: str
    guidance: str
    priority: str = "medium"


class ValidationCriteria(BaseModel):
    """Self-check questions and minimum scores for profile validation."""

    self_check_questions: list[str] = Field(default_factory=list)
    minimum_fidelity_score: float = Field(default=0.7, ge=0.0, le=1.0)
    required_markers: list[str] = Field(default_factory=list)


class VoiceAccessLevel(BaseModel):
    """Access control for a voice profile (Layer 2)."""

    level: ContentAccessLevel
    restricted_sections: list[str] = Field(default_factory=list)


class VoiceContext(BaseModel):
    """Per-audience voice configuration with section overrides."""

    voice_id: str
    audience_key: str
    audience_label: str = ""
    description: str = ""
    fidelity_tier: int = Field(default=1, ge=1, le=4)
    corpus_size_for_voice: int = 0
    voice_override: VoiceProfile | None = None
    vocabulary_override: VocabularyProfile | None = None
    argumentation_override: ArgumentationProfile | None = None
    citations_override: CitationProfile | None = None
    structure_override: StructuralPatterns | None = None
    positions_override: list[Position] | None = None
    examples_override: ExampleOutputs | None = None
    anti_patterns_override: AntiPatterns | None = None
    access_level: VoiceAccessLevel | None = None


class CompositeVoiceConfig(BaseModel):
    """Configuration for blended voices (e.g., composite voice from multiple sources)."""

    source_voices: list[str] = Field(default_factory=list)
    source_weights: dict[str, float] = Field(default_factory=dict)
    additional_corpus_ref: str | None = None
    blending_strategy: str = "weighted_merge"


class AuthorProfile(BaseModel):
    """Complete writing profile for one person, built from corpus analysis."""

    profile_id: str
    author_name: str
    domain: str = "general"
    corpus_size: int = 0
    word_count: int = 0
    fidelity_tier: int = Field(default=1, ge=1, le=4)
    created_at: datetime = Field(default_factory=datetime.now)
    updated_at: datetime = Field(default_factory=datetime.now)
    confidence: float = Field(default=0.0, ge=0.0, le=1.0)
    version: str = "0.1.0"
    department_ids: list[str] = Field(default_factory=list)

    identity: AuthorIdentity = Field(default_factory=AuthorIdentity)
    expertise: ExpertiseDomains = Field(default_factory=ExpertiseDomains)
    positions: list[Position] = Field(default_factory=list)
    voice: VoiceProfile = Field(default_factory=VoiceProfile)
    voice_contexts: dict[str, VoiceContext] = Field(default_factory=dict)
    structure: StructuralPatterns = Field(default_factory=StructuralPatterns)
    vocabulary: VocabularyProfile = Field(default_factory=VocabularyProfile)
    argumentation: ArgumentationProfile = Field(default_factory=ArgumentationProfile)
    citations: CitationProfile = Field(default_factory=CitationProfile)
    anti_patterns: AntiPatterns = Field(default_factory=AntiPatterns)
    examples: ExampleOutputs = Field(default_factory=ExampleOutputs)
    edge_cases: list[EdgeCase] = Field(default_factory=list)
    validation: ValidationCriteria = Field(default_factory=ValidationCriteria)

    stylometric_features: StylometricFeatures | None = None
    markers: MarkerSet | None = None
    audience: AudienceProfile | None = None
