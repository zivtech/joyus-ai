"""Shared fixtures for attribution tests."""

from __future__ import annotations

import pytest

from joyus_profile.models.features import Marker, MarkerSet, VocabularyProfile
from joyus_profile.models.hierarchy import (
    DepartmentProfile,
    OrganizationProfile,
    ProfileHierarchy,
)
from joyus_profile.models.profile import AuthorProfile


def _make_author(
    profile_id: str,
    dept_id: str,
    high_markers: list[str],
    vocab: list[str],
) -> AuthorProfile:
    markers = MarkerSet(
        high_signal=[Marker(text=m, weight=0.9) for m in high_markers],
        medium_signal=[],
        negative_markers=[],
    )
    vocabulary = VocabularyProfile(
        signature_phrases=vocab,
        preferred_terms=vocab,
        avoided_terms=[],
        technical_terms=[],
    )
    return AuthorProfile(
        profile_id=profile_id,
        author_name=profile_id,
        department_ids=[dept_id],
        markers=markers,
        vocabulary=vocabulary,
    )


def _make_dept(dept_id: str, vocab: list[str]) -> DepartmentProfile:
    shared_vocab = VocabularyProfile(
        signature_phrases=vocab,
        preferred_terms=vocab,
        avoided_terms=[],
        technical_terms=[],
    )
    return DepartmentProfile(
        department_id=dept_id,
        name=dept_id,
        shared_vocabulary=shared_vocab,
    )


def _make_org(org_id: str) -> OrganizationProfile:
    return OrganizationProfile(org_id=org_id, name=org_id)


@pytest.fixture()
def two_author_hierarchy() -> ProfileHierarchy:
    """Hierarchy with two clearly distinguishable authors in one department each."""
    author_a = _make_author(
        "author-a",
        "dept-policy",
        high_markers=["regulatory framework", "enforcement action"],
        vocab=["compliance", "regulation"],
    )
    author_b = _make_author(
        "author-b",
        "dept-market",
        high_markers=["market analysis", "growth trajectory"],
        vocab=["revenue", "market share"],
    )
    dept_policy = _make_dept("dept-policy", vocab=["compliance", "regulation"])
    dept_market = _make_dept("dept-market", vocab=["revenue", "market share"])
    org = _make_org("org-example")

    return ProfileHierarchy(
        hierarchy_id="test-hierarchy",
        org_profile=org,
        departments={"dept-policy": dept_policy, "dept-market": dept_market},
        people={"author-a": author_a, "author-b": author_b},
        department_members={
            "dept-policy": ["author-a"],
            "dept-market": ["author-b"],
        },
        person_departments={
            "author-a": ["dept-policy"],
            "author-b": ["dept-market"],
        },
    )


# Text that strongly matches author-a
AUTHOR_A_TEXT = (
    "The regulatory framework establishes clear enforcement action requirements. "
    "Compliance with regulation is mandatory for all participants. "
    "The regulatory framework applies broadly. "
    "enforcement action regulatory framework compliance regulation "
    "regulatory framework enforcement action regulatory framework "
)

# Text that strongly matches author-b
AUTHOR_B_TEXT = (
    "Our market analysis shows a positive growth trajectory this quarter. "
    "Revenue and market share are key indicators. "
    "market analysis growth trajectory revenue market share "
    "market analysis growth trajectory market analysis "
)

# Foreign text unlikely to match any known profile
OUTSIDER_TEXT = (
    "The quick brown fox jumps over the lazy dog. "
    "Culinary arts require passion and creativity. "
    "Photography captures fleeting moments beautifully. "
)
