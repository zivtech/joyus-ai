"""Attribution cascade data models."""

from __future__ import annotations

from datetime import datetime, timezone

from pydantic import BaseModel, Field


class CandidateMatch(BaseModel):
    """A single candidate in the attribution ranking."""

    profile_id: str
    profile_type: str = "person"
    score: float = Field(default=0.0, ge=0.0, le=1.0)
    feature_breakdown: dict[str, float] = Field(default_factory=dict)
    matched_markers: list[str] = Field(default_factory=list)


class AttributionResult(BaseModel):
    """Result of running attribution against the hierarchy."""

    result_id: str
    text_hash: str
    mode: str = "identify"
    match_level: str | None = None
    target_id: str | None = None
    candidates: list[CandidateMatch] = Field(default_factory=list)
    confidence: float = Field(default=0.0, ge=0.0, le=1.0)
    explanation_tier: str = "pattern"
    explanation: str = ""
    timestamp: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))
