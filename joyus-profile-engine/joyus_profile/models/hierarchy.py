"""Hierarchy data models: Department, Organization, and ProfileHierarchy."""

from __future__ import annotations

from datetime import datetime, timezone

from pydantic import BaseModel, Field, model_validator

from joyus_profile.exceptions import HierarchyValidationError

from .features import StructuralPatterns, VocabularyProfile
from .profile import ContentAccessLevel, Position


class RegisterInfo(BaseModel):
    """Audience register information for a department."""

    register_name: str = "neutral"
    frequency: float = 0.0
    contributors: list[str] = Field(default_factory=list)


class StylometricBaseline(BaseModel):
    """Aggregated feature distributions for composite profiles."""

    feature_means: dict[str, float] = Field(default_factory=dict)
    feature_stds: dict[str, float] = Field(default_factory=dict)
    sample_count: int = 0


class StyleGuide(BaseModel):
    """Editorial style guide for an organization."""

    name: str = ""
    rules: list[str] = Field(default_factory=list)
    preferred_voice: str = ""
    formatting_notes: list[str] = Field(default_factory=list)


class OfficialPosition(BaseModel):
    """Organization-level stance that may override individual positions."""

    topic: str
    stance: str
    authoritative: bool = False
    context: str = ""


class ProhibitedFraming(BaseModel):
    """A term or framing the organization never uses. Cascades to all levels."""

    text: str
    reason: str = ""
    severity: str = "high"


class OverrideSet(BaseModel):
    """Department-specific organization rules."""

    positions: list[OfficialPosition] = Field(default_factory=list)
    prohibited_framings: list[ProhibitedFraming] = Field(default_factory=list)
    style_notes: list[str] = Field(default_factory=list)


class VoiceDefinition(BaseModel):
    """Org-level voice declaration (audience voices available to all authors)."""

    audience_key: str
    audience_label: str = ""
    description: str = ""
    target_audience: str = ""
    access_level: ContentAccessLevel | None = None


class DepartmentProfile(BaseModel):
    """Topic-based expertise area composite, built from member profiles."""

    department_id: str
    name: str
    domain_specialization: str = "general"
    member_ids: list[str] = Field(default_factory=list)
    shared_vocabulary: VocabularyProfile = Field(default_factory=VocabularyProfile)
    shared_positions: list[Position] = Field(default_factory=list)
    structural_range: StructuralPatterns = Field(default_factory=StructuralPatterns)
    audience_registers: dict[str, RegisterInfo] = Field(default_factory=dict)
    typical_document_types: list[str] = Field(default_factory=list)
    stylometric_baseline: StylometricBaseline = Field(default_factory=StylometricBaseline)
    created_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))
    updated_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))


class OrganizationProfile(BaseModel):
    """Top-level organizational composite."""

    org_id: str
    name: str
    editorial_style_guide: StyleGuide = Field(default_factory=StyleGuide)
    official_positions: list[OfficialPosition] = Field(default_factory=list)
    prohibited_framings: list[ProhibitedFraming] = Field(default_factory=list)
    department_overrides: dict[str, OverrideSet] = Field(default_factory=dict)
    voice_definitions: dict[str, VoiceDefinition] = Field(default_factory=dict)
    stylometric_baseline: StylometricBaseline = Field(default_factory=StylometricBaseline)
    created_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))
    updated_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))


class ProfileHierarchy(BaseModel):
    """Complete organizational profile hierarchy."""

    hierarchy_id: str
    org_profile: OrganizationProfile
    departments: dict[str, DepartmentProfile] = Field(default_factory=dict)
    people: dict[str, "AuthorProfile"] = Field(default_factory=dict)
    department_members: dict[str, list[str]] = Field(default_factory=dict)
    person_departments: dict[str, list[str]] = Field(default_factory=dict)
    version: str = "0.1.0"
    built_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))

    def effective_prohibited_framings(self, entity_id: str | None = None) -> list:
        """Return org-level prohibited framings (cascade to all levels).

        Prohibited framings are defined at org level and cannot be overridden.
        This method provides the canonical accessor for any level in the hierarchy.
        """
        return list(self.org_profile.prohibited_framings)

    @model_validator(mode="after")
    def _validate_hierarchy(self) -> "ProfileHierarchy":
        """Validate many-to-many consistency and catch orphaned people."""
        errors: list[str] = []

        # Every person must belong to at least one department
        for person_id in self.people:
            depts = self.person_departments.get(person_id, [])
            if not depts:
                errors.append(f"Person '{person_id}' has no department assignment")

        # Department members must reference known people
        for dept_id, members in self.department_members.items():
            if dept_id not in self.departments:
                errors.append(
                    f"department_members references unknown department '{dept_id}'"
                )
            for pid in members:
                if pid not in self.people:
                    errors.append(
                        f"Department '{dept_id}' references unknown person '{pid}'"
                    )

        # person_departments must reference known departments
        for person_id, depts in self.person_departments.items():
            if person_id not in self.people:
                errors.append(
                    f"person_departments references unknown person '{person_id}'"
                )
            for did in depts:
                if did not in self.departments:
                    errors.append(
                        f"Person '{person_id}' references unknown department '{did}'"
                    )

        if errors:
            raise HierarchyValidationError(
                f"Hierarchy validation failed: {'; '.join(errors)}"
            )

        return self


# Deferred import to avoid circular dependency
from .profile import AuthorProfile  # noqa: E402

ProfileHierarchy.model_rebuild()
