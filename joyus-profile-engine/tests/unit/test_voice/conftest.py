"""Shared fixtures for voice context tests."""

from __future__ import annotations

import pytest

from joyus_profile.models.features import VocabularyProfile
from joyus_profile.models.hierarchy import (
    DepartmentProfile,
    OrganizationProfile,
    ProfileHierarchy,
    ProhibitedFraming,
)
from joyus_profile.models.profile import (
    AntiPatterns,
    ArgumentationProfile,
    AuthorProfile,
    ContentAccessLevel,
    VoiceAccessLevel,
    VoiceContext,
    VoiceProfile,
)


def _make_author(profile_id: str, author_name: str) -> AuthorProfile:
    return AuthorProfile(
        profile_id=profile_id,
        author_name=author_name,
        vocabulary=VocabularyProfile(
            signature_phrases=["base phrase"],
            preferred_terms=["base term"],
            avoided_terms=["base avoid"],
            technical_terms=["base tech"],
        ),
        anti_patterns=AntiPatterns(
            never_do=["never base"],
            common_ai_mistakes=["ai mistake base"],
            prohibited_phrases=["prohibited base"],
        ),
    )


@pytest.fixture()
def layer_0_profile() -> AuthorProfile:
    """AuthorProfile with no voice_contexts (Layer 0)."""
    return _make_author("author-a", "Author A")


@pytest.fixture()
def layer_1_profile() -> AuthorProfile:
    """AuthorProfile with 3 unrestricted voices (Layer 1)."""
    profile = _make_author("author-b", "Author B")

    formal_vc = VoiceContext(
        voice_id="formal",
        audience_key="formal",
        audience_label="Formal",
        fidelity_tier=3,
        voice_override=VoiceProfile(
            formality=9.0,
            emotion=2.0,
            directness=7.0,
            complexity=8.0,
            tone_descriptors=["authoritative", "precise"],
        ),
        vocabulary_override=VocabularyProfile(
            signature_phrases=["formal phrase"],
            preferred_terms=["formal term"],
            avoided_terms=["formal avoid"],
            technical_terms=["formal tech"],
        ),
        anti_patterns_override=AntiPatterns(
            never_do=["never formal"],
            common_ai_mistakes=[],
            prohibited_phrases=["prohibited formal"],
        ),
        access_level=None,
    )

    accessible_vc = VoiceContext(
        voice_id="accessible",
        audience_key="accessible",
        audience_label="Accessible",
        fidelity_tier=2,
        voice_override=VoiceProfile(
            formality=4.0,
            emotion=7.0,
            directness=8.0,
            complexity=3.0,
            tone_descriptors=["friendly", "clear"],
        ),
        # No vocabulary override — partial override
        argumentation_override=ArgumentationProfile(
            evidence_types=["anecdote", "case study"],
            reasoning_patterns=["analogy"],
        ),
        access_level=None,
    )

    technical_vc = VoiceContext(
        voice_id="technical",
        audience_key="technical",
        audience_label="Technical",
        fidelity_tier=4,
        vocabulary_override=VocabularyProfile(
            signature_phrases=["technical phrase"],
            preferred_terms=["technical term"],
            avoided_terms=[],
            technical_terms=["api", "schema", "endpoint"],
        ),
        access_level=None,
    )

    profile.voice_contexts = {
        "formal": formal_vc,
        "accessible": accessible_vc,
        "technical": technical_vc,
    }
    return profile


@pytest.fixture()
def layer_2_profile() -> AuthorProfile:
    """AuthorProfile with one restricted voice requiring SUBSCRIBER access (Layer 2)."""
    profile = _make_author("author-c", "Author C")

    public_vc = VoiceContext(
        voice_id="public",
        audience_key="public",
        audience_label="Public",
        fidelity_tier=1,
        access_level=None,
    )

    restricted_vc = VoiceContext(
        voice_id="subscriber-only",
        audience_key="subscriber-only",
        audience_label="Subscriber Only",
        fidelity_tier=2,
        voice_override=VoiceProfile(formality=8.0),
        access_level=VoiceAccessLevel(
            level=ContentAccessLevel.SUBSCRIBER,
            restricted_sections=["positions", "examples"],
        ),
    )

    internal_vc = VoiceContext(
        voice_id="internal",
        audience_key="internal",
        audience_label="Internal",
        fidelity_tier=4,
        access_level=VoiceAccessLevel(
            level=ContentAccessLevel.INTERNAL,
            restricted_sections=[],
        ),
    )

    profile.voice_contexts = {
        "public": public_vc,
        "subscriber-only": restricted_vc,
        "internal": internal_vc,
    }
    return profile


@pytest.fixture()
def sample_hierarchy() -> ProfileHierarchy:
    """Minimal ProfileHierarchy with org-level prohibited framings."""
    author = AuthorProfile(profile_id="author-x", author_name="Author X")
    dept = DepartmentProfile(department_id="dept-general", name="General")
    org = OrganizationProfile(
        org_id="org-example",
        name="Example Corp",
        prohibited_framings=[
            ProhibitedFraming(text="org banned phrase", reason="brand policy", severity="high"),
            ProhibitedFraming(text="org restricted term", reason="legal", severity="high"),
        ],
    )
    return ProfileHierarchy(
        hierarchy_id="test-hierarchy",
        org_profile=org,
        departments={"dept-general": dept},
        people={"author-x": author},
        department_members={"dept-general": ["author-x"]},
        person_departments={"author-x": ["dept-general"]},
    )
