"""Pydantic data models for the profile engine."""

from .attribution import AttributionResult, CandidateMatch
from .corpus import (
    Chunk,
    Corpus,
    Document,
    DocumentFormat,
    DocumentMetadata,
    ProcessedCorpus,
)
from .features import (
    AudienceProfile,
    Marker,
    MarkerSet,
    SentenceLengthStats,
    StructuralPatterns,
    StylometricFeatures,
    VocabularyProfile,
    VocabularyRichness,
)
from .hierarchy import (
    DepartmentProfile,
    OfficialPosition,
    OrganizationProfile,
    OverrideSet,
    ProfileHierarchy,
    ProhibitedFraming,
    RegisterInfo,
    StyleGuide,
    StylometricBaseline,
    VoiceDefinition,
)
from .monitoring import (
    DriftDiagnosis,
    DriftedFeature,
    DriftSignal,
    RepairAction,
    RepairVerification,
)
from .profile import (
    AntiPatterns,
    ArgumentationProfile,
    AuthorIdentity,
    AuthorProfile,
    CitationProfile,
    CompositeVoiceConfig,
    ContentAccessLevel,
    EdgeCase,
    ExampleOutputs,
    ExpertiseDomains,
    Position,
    ValidationCriteria,
    VoiceAccessLevel,
    VoiceContext,
    VoiceProfile,
)
from .content import (
    GeneratedContent,
    SourceRef,
)
from .verification import (
    DeepResult,
    FidelityScore,
    InlineResult,
    VerificationResult,
)

__all__ = [
    # Corpus
    "Chunk",
    "Corpus",
    "Document",
    "DocumentFormat",
    "DocumentMetadata",
    "ProcessedCorpus",
    # Features
    "AudienceProfile",
    "Marker",
    "MarkerSet",
    "SentenceLengthStats",
    "StructuralPatterns",
    "StylometricFeatures",
    "VocabularyProfile",
    "VocabularyRichness",
    # Profile
    "AntiPatterns",
    "ArgumentationProfile",
    "AuthorIdentity",
    "AuthorProfile",
    "CitationProfile",
    "CompositeVoiceConfig",
    "ContentAccessLevel",
    "EdgeCase",
    "ExampleOutputs",
    "ExpertiseDomains",
    "Position",
    "ValidationCriteria",
    "VoiceAccessLevel",
    "VoiceContext",
    "VoiceProfile",
    # Hierarchy
    "DepartmentProfile",
    "OfficialPosition",
    "OrganizationProfile",
    "OverrideSet",
    "ProfileHierarchy",
    "ProhibitedFraming",
    "RegisterInfo",
    "StyleGuide",
    "StylometricBaseline",
    "VoiceDefinition",
    # Content
    "GeneratedContent",
    "SourceRef",
    # Verification
    "DeepResult",
    "FidelityScore",
    "InlineResult",
    "VerificationResult",
    # Attribution
    "AttributionResult",
    "CandidateMatch",
    # Monitoring
    "DriftDiagnosis",
    "DriftedFeature",
    "DriftSignal",
    "RepairAction",
    "RepairVerification",
]
