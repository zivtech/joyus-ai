"""Verification and fidelity scoring data models."""

from __future__ import annotations

from datetime import datetime, timezone

from pydantic import BaseModel, Field

from .content import SourceRef
from .profile import ContentAccessLevel


class FidelityScore(BaseModel):
    """Unified fidelity assessment for generated content."""

    score: float = Field(ge=0.0, le=1.0)
    passed: bool
    tier: int = Field(ge=1, le=2)  # 1=inline (<500ms), 2=deep (Burrows Delta)
    marker_score: float = Field(default=0.0, ge=0.0, le=1.0)
    style_score: float = Field(default=0.0, ge=0.0, le=1.0)
    feature_breakdown: dict[str, float] = Field(default_factory=dict)
    feedback: str | None = None
    timestamp: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))


class InlineResult(BaseModel):
    """Tier 1 inline verification result (<500ms)."""

    score: float = Field(ge=0.0, le=1.0)
    passed: bool
    feedback: str = ""
    details: dict[str, float] = Field(default_factory=dict)
    latency_ms: float = 0.0


class DeepResult(BaseModel):
    """Tier 2 deep analysis result."""

    burrows_delta: float = 0.0
    feature_breakdown: dict[str, float] = Field(default_factory=dict)
    drift_detected: bool = False
    recommendations: list[str] = Field(default_factory=list)


class VerificationResult(BaseModel):
    """Complete verification output (may include both tiers)."""

    result_id: str
    profile_id: str
    voice_key: str | None = None
    tier1: FidelityScore | None = None
    tier2: FidelityScore | None = None
    source_provenance: list[SourceRef] = Field(default_factory=list)
    access_level: ContentAccessLevel = ContentAccessLevel.PUBLIC
