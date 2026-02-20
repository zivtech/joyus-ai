"""Content generation data models: SourceRef and GeneratedContent."""

from __future__ import annotations

from datetime import datetime, timezone

from pydantic import BaseModel, Field

from .profile import ContentAccessLevel


class SourceRef(BaseModel):
    """Provenance tracking for generated content."""

    source_id: str
    source_type: str = "article"
    access_level: ContentAccessLevel = ContentAccessLevel.PUBLIC
    influence_type: str = "style_source"
    section_ref: str | None = None


class GeneratedContent(BaseModel):
    """Metadata for content produced by System 2."""

    content_id: str
    text: str
    target_profile: str
    target_voice: str | None = None
    fidelity_score: float = Field(default=0.0, ge=0.0, le=1.0)
    source_provenance: list[SourceRef] = Field(default_factory=list)
    access_level: ContentAccessLevel = ContentAccessLevel.PUBLIC
    access_justification: str = ""
    generated_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))
