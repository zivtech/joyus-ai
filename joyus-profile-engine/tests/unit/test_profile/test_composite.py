"""Tests for the CompositeBuilder: department and organization aggregation."""

from __future__ import annotations

import pytest

from joyus_profile.exceptions import HierarchyValidationError, ProfileBuildError
from joyus_profile.models.features import (
    AudienceProfile,
    StylometricFeatures,
    VocabularyProfile,
)
from joyus_profile.models.hierarchy import (
    DepartmentProfile,
    OfficialPosition,
    OrganizationProfile,
    ProfileHierarchy,
    ProhibitedFraming,
    StyleGuide,
    StylometricBaseline,
    VoiceDefinition,
)
from joyus_profile.models.profile import (
    AuthorProfile,
    ContentAccessLevel,
    Position,
)
from joyus_profile.profile.composite import CompositeBuilder

# ── Fixtures ──────────────────────────────────────────────────────────


def _make_profile(
    pid: str,
    name: str,
    word_count: int = 10_000,
    dept_ids: list[str] | None = None,
    sig_phrases: list[str] | None = None,
    preferred: list[str] | None = None,
    technical: list[str] | None = None,
    avoided: list[str] | None = None,
    positions: list[Position] | None = None,
    fw_freqs: dict[str, float] | None = None,
    audience_register: str = "neutral",
) -> AuthorProfile:
    """Create a minimal AuthorProfile for composite testing."""
    features = None
    if fw_freqs:
        features = StylometricFeatures(function_word_frequencies=fw_freqs)

    audience = AudienceProfile(
        primary_register=audience_register,
        formality_score=5.0,
    )

    return AuthorProfile(
        profile_id=pid,
        author_name=name,
        word_count=word_count,
        department_ids=dept_ids or [],
        vocabulary=VocabularyProfile(
            signature_phrases=sig_phrases or [],
            preferred_terms=preferred or [],
            technical_terms=technical or [],
            avoided_terms=avoided or [],
        ),
        positions=positions or [],
        stylometric_features=features,
        audience=audience,
    )


@pytest.fixture
def profiles_pair() -> list[AuthorProfile]:
    """Two profiles with overlapping vocabulary."""
    return [
        _make_profile(
            "p1",
            "Author A",
            word_count=20_000,
            sig_phrases=["phrase alpha", "phrase beta"],
            preferred=["term-x", "term-y"],
            technical=["tech-a", "tech-b"],
            avoided=["bad-word"],
            positions=[
                Position(topic="regulation", stance="pro-reform", strength=0.8),
                Position(topic="transparency", stance="required", strength=0.6),
            ],
            fw_freqs={"the": 0.07, "of": 0.04, "and": 0.03},
            audience_register="formal",
        ),
        _make_profile(
            "p2",
            "Author B",
            word_count=10_000,
            sig_phrases=["phrase alpha", "phrase gamma"],
            preferred=["term-x", "term-z"],
            technical=["tech-a", "tech-c"],
            avoided=["other-bad"],
            positions=[
                Position(topic="regulation", stance="pro-reform", strength=0.6),
                Position(topic="access", stance="open", strength=0.7),
            ],
            fw_freqs={"the": 0.08, "of": 0.03, "but": 0.02},
            audience_register="neutral",
        ),
    ]


@pytest.fixture
def profiles_three(profiles_pair: list[AuthorProfile]) -> list[AuthorProfile]:
    """Three profiles for more thorough testing."""
    return profiles_pair + [
        _make_profile(
            "p3",
            "Author C",
            word_count=15_000,
            sig_phrases=["phrase alpha", "phrase delta"],
            preferred=["term-x", "term-w"],
            technical=["tech-a", "tech-d"],
            avoided=[],
            positions=[
                Position(topic="regulation", stance="pro-reform", strength=0.9),
            ],
            fw_freqs={"the": 0.06, "of": 0.05, "and": 0.04, "but": 0.01},
            audience_register="formal",
        ),
    ]


@pytest.fixture
def builder() -> CompositeBuilder:
    return CompositeBuilder()


# ── T039: build_department ────────────────────────────────────────────


class TestBuildDepartment:
    def test_basic_build(
        self, builder: CompositeBuilder, profiles_pair: list[AuthorProfile]
    ) -> None:
        dept = builder.build_department(profiles_pair, "Research", "policy")
        assert isinstance(dept, DepartmentProfile)
        assert dept.name == "Research"
        assert dept.domain_specialization == "policy"
        assert len(dept.member_ids) == 2
        assert "p1" in dept.member_ids
        assert "p2" in dept.member_ids

    def test_raises_for_single_member(self, builder: CompositeBuilder) -> None:
        single = [_make_profile("p1", "Solo Author")]
        with pytest.raises(ProfileBuildError, match="needs >= 2 members"):
            builder.build_department(single, "Tiny")

    def test_raises_for_empty(self, builder: CompositeBuilder) -> None:
        with pytest.raises(ProfileBuildError, match="needs >= 2 members"):
            builder.build_department([], "Empty")

    def test_shared_vocabulary_intersection(
        self, builder: CompositeBuilder, profiles_pair: list[AuthorProfile]
    ) -> None:
        dept = builder.build_department(profiles_pair, "Research")
        # "phrase alpha" is in both, threshold = max(2//2, 1) = 1
        assert "phrase alpha" in dept.shared_vocabulary.signature_phrases
        assert "term-x" in dept.shared_vocabulary.preferred_terms
        assert "tech-a" in dept.shared_vocabulary.technical_terms

    def test_avoided_terms_union(
        self, builder: CompositeBuilder, profiles_pair: list[AuthorProfile]
    ) -> None:
        dept = builder.build_department(profiles_pair, "Research")
        assert "bad-word" in dept.shared_vocabulary.avoided_terms
        assert "other-bad" in dept.shared_vocabulary.avoided_terms

    def test_consensus_positions(
        self, builder: CompositeBuilder, profiles_pair: list[AuthorProfile]
    ) -> None:
        dept = builder.build_department(profiles_pair, "Research")
        topics = {p.topic for p in dept.shared_positions}
        # "regulation" appears in both -> consensus
        assert "regulation" in topics
        # "transparency" and "access" appear in only one -> no consensus
        assert "transparency" not in topics
        assert "access" not in topics

    def test_weighted_stylometric_baseline(
        self, builder: CompositeBuilder, profiles_pair: list[AuthorProfile]
    ) -> None:
        dept = builder.build_department(profiles_pair, "Research")
        baseline = dept.stylometric_baseline
        assert baseline.sample_count == 30_000  # 20k + 10k

        # "the" weighted: (0.07 * 20000/30000) + (0.08 * 10000/30000)
        expected_the = (0.07 * 20_000 + 0.08 * 10_000) / 30_000
        assert abs(baseline.feature_means["the"] - expected_the) < 1e-9

        # "and" only in p1: (0.03 * 20000/30000) + (0 * 10000/30000)
        expected_and = (0.03 * 20_000) / 30_000
        assert abs(baseline.feature_means["and"] - expected_and) < 1e-9

    def test_audience_registers_merged(
        self, builder: CompositeBuilder, profiles_pair: list[AuthorProfile]
    ) -> None:
        dept = builder.build_department(profiles_pair, "Research")
        assert "formal" in dept.audience_registers
        assert "neutral" in dept.audience_registers
        assert "p1" in dept.audience_registers["formal"].contributors

    def test_three_members(
        self, builder: CompositeBuilder, profiles_three: list[AuthorProfile]
    ) -> None:
        dept = builder.build_department(profiles_three, "Big Team")
        assert len(dept.member_ids) == 3
        assert dept.stylometric_baseline.sample_count == 45_000

    def test_default_domain(
        self, builder: CompositeBuilder, profiles_pair: list[AuthorProfile]
    ) -> None:
        dept = builder.build_department(profiles_pair, "Generic")
        assert dept.domain_specialization == "general"

    def test_build_department_zero_word_counts(
        self, builder: CompositeBuilder
    ) -> None:
        """All profiles with word_count=0 should yield empty StylometricBaseline."""
        p1 = _make_profile("p1", "Author A", word_count=0, fw_freqs={"the": 0.07})
        p2 = _make_profile("p2", "Author B", word_count=0, fw_freqs={"the": 0.08})
        dept = builder.build_department([p1, p2], "Empty Corpus")
        assert dept.stylometric_baseline.sample_count == 0
        assert dept.stylometric_baseline.feature_means == {}
        assert dept.stylometric_baseline.feature_stds == {}


# ── T040: build_organization ──────────────────────────────────────────


class TestBuildOrganization:
    def test_basic_build(self, builder: CompositeBuilder) -> None:
        dept1 = DepartmentProfile(
            department_id="d1",
            name="Research",
            stylometric_baseline=StylometricBaseline(
                feature_means={"the": 0.07},
                sample_count=20_000,
            ),
        )
        dept2 = DepartmentProfile(
            department_id="d2",
            name="Policy",
            stylometric_baseline=StylometricBaseline(
                feature_means={"the": 0.09},
                sample_count=10_000,
            ),
        )
        org = builder.build_organization([dept1, dept2], "Example Corp")
        assert isinstance(org, OrganizationProfile)
        assert org.name == "Example Corp"
        # Weighted mean: (0.07 * 20k + 0.09 * 10k) / 30k
        expected = (0.07 * 20_000 + 0.09 * 10_000) / 30_000
        assert abs(org.stylometric_baseline.feature_means["the"] - expected) < 1e-9

    def test_raises_for_no_departments(self, builder: CompositeBuilder) -> None:
        with pytest.raises(ProfileBuildError, match="needs >= 1 department"):
            builder.build_organization([], "Empty Org")

    def test_editorial_style_guide(self, builder: CompositeBuilder) -> None:
        dept = DepartmentProfile(
            department_id="d1", name="Research",
            stylometric_baseline=StylometricBaseline(sample_count=100),
        )
        guide = StyleGuide(
            name="House Style",
            rules=["Use active voice", "Avoid jargon"],
            preferred_voice="accessible",
        )
        org = builder.build_organization(
            [dept], "Org", editorial_style_guide=guide
        )
        assert org.editorial_style_guide.name == "House Style"
        assert len(org.editorial_style_guide.rules) == 2

    def test_prohibited_framings(self, builder: CompositeBuilder) -> None:
        dept = DepartmentProfile(
            department_id="d1", name="Research",
            stylometric_baseline=StylometricBaseline(sample_count=100),
        )
        framings = [
            ProhibitedFraming(text="industry-friendly", reason="Bias"),
            ProhibitedFraming(text="deregulation", reason="Off-brand"),
        ]
        org = builder.build_organization(
            [dept], "Org", prohibited_framings=framings
        )
        assert len(org.prohibited_framings) == 2
        texts = {f.text for f in org.prohibited_framings}
        assert "industry-friendly" in texts
        assert "deregulation" in texts

    def test_official_positions_authoritative(
        self, builder: CompositeBuilder
    ) -> None:
        dept = DepartmentProfile(
            department_id="d1", name="Research",
            stylometric_baseline=StylometricBaseline(sample_count=100),
        )
        positions = [
            OfficialPosition(
                topic="data privacy",
                stance="strong protection required",
                authoritative=True,
            ),
        ]
        org = builder.build_organization(
            [dept], "Org", official_positions=positions
        )
        assert org.official_positions[0].authoritative is True

    def test_voice_definitions(self, builder: CompositeBuilder) -> None:
        dept = DepartmentProfile(
            department_id="d1", name="Research",
            stylometric_baseline=StylometricBaseline(sample_count=100),
        )
        voices = {
            "formal": VoiceDefinition(
                audience_key="formal",
                audience_label="Formal",
                target_audience="Courts and regulators",
                access_level=ContentAccessLevel.PUBLIC,
            ),
            "accessible": VoiceDefinition(
                audience_key="accessible",
                audience_label="Accessible",
                target_audience="General public",
            ),
        }
        org = builder.build_organization(
            [dept], "Org", voice_definitions=voices
        )
        assert len(org.voice_definitions) == 2
        assert org.voice_definitions["formal"].access_level == ContentAccessLevel.PUBLIC


# ── Incremental update ────────────────────────────────────────────────


class TestIncrementalUpdate:
    def test_incremental_adds_member(self, builder: CompositeBuilder) -> None:
        existing = DepartmentProfile(
            department_id="d1",
            name="Research",
            member_ids=["p1", "p2"],
            stylometric_baseline=StylometricBaseline(
                feature_means={"the": 0.07, "of": 0.04},
                sample_count=30_000,
            ),
        )
        new_member = _make_profile(
            "p3", "Author C", word_count=15_000,
            fw_freqs={"the": 0.06, "of": 0.05, "and": 0.03},
        )
        updated = builder.update_department_incremental(existing, new_member)
        assert "p3" in updated.member_ids
        assert updated.stylometric_baseline.sample_count == 45_000

        # Verify incremental formula: (old * old_total + new * new_size) / combined
        expected_the = (0.07 * 30_000 + 0.06 * 15_000) / 45_000
        assert abs(updated.stylometric_baseline.feature_means["the"] - expected_the) < 1e-9

    def test_incremental_new_key(self, builder: CompositeBuilder) -> None:
        existing = DepartmentProfile(
            department_id="d1",
            name="Research",
            member_ids=["p1"],
            stylometric_baseline=StylometricBaseline(
                feature_means={"the": 0.07},
                sample_count=10_000,
            ),
        )
        new_member = _make_profile(
            "p2", "Author B", word_count=10_000,
            fw_freqs={"the": 0.08, "but": 0.02},
        )
        updated = builder.update_department_incremental(existing, new_member)
        # "but" is new: (0 * 10k + 0.02 * 10k) / 20k = 0.01
        assert abs(updated.stylometric_baseline.feature_means["but"] - 0.01) < 1e-9

    def test_incremental_no_duplicate_member(
        self, builder: CompositeBuilder
    ) -> None:
        existing = DepartmentProfile(
            department_id="d1",
            name="Research",
            member_ids=["p1"],
            stylometric_baseline=StylometricBaseline(
                feature_means={"the": 0.07},
                sample_count=10_000,
            ),
        )
        # Re-add same member
        member = _make_profile("p1", "Author A", word_count=5_000)
        updated = builder.update_department_incremental(existing, member)
        assert updated.member_ids.count("p1") == 1

    def test_incremental_update_zero_word_count(
        self, builder: CompositeBuilder
    ) -> None:
        """New member with word_count=0 uses max(..., 1) so combined stays valid."""
        existing = DepartmentProfile(
            department_id="d1",
            name="Research",
            member_ids=["p1"],
            stylometric_baseline=StylometricBaseline(
                feature_means={"the": 0.07},
                sample_count=10_000,
            ),
        )
        new_member = _make_profile(
            "p2", "Author B", word_count=0,
            fw_freqs={"the": 0.05},
        )
        updated = builder.update_department_incremental(existing, new_member)
        # new_size = max(0, 1) = 1; combined = 10_001
        assert updated.stylometric_baseline.sample_count == 10_001
        assert "p2" in updated.member_ids
        # Weighted mean: (0.07 * 10_000 + 0.05 * 1) / 10_001
        expected_the = (0.07 * 10_000 + 0.05 * 1) / 10_001
        assert abs(updated.stylometric_baseline.feature_means["the"] - expected_the) < 1e-9


# ── T041/T042: Hierarchy validation ──────────────────────────────────


class TestProfileHierarchy:
    def _make_hierarchy(self, **kwargs) -> ProfileHierarchy:
        """Helper to build a valid hierarchy with overrides."""
        org = OrganizationProfile(org_id="org1", name="Example Corp")
        defaults = dict(
            hierarchy_id="h1",
            org_profile=org,
            departments={"d1": DepartmentProfile(department_id="d1", name="Research")},
            people={"p1": _make_profile("p1", "Author A", dept_ids=["d1"])},
            department_members={"d1": ["p1"]},
            person_departments={"p1": ["d1"]},
        )
        defaults.update(kwargs)
        return ProfileHierarchy(**defaults)

    def test_valid_hierarchy(self) -> None:
        h = self._make_hierarchy()
        assert h.hierarchy_id == "h1"
        assert len(h.people) == 1
        assert len(h.departments) == 1

    def test_orphaned_person_raises(self) -> None:
        """Person with no department assignment should fail validation."""
        with pytest.raises(HierarchyValidationError, match="no department assignment"):
            self._make_hierarchy(
                person_departments={},  # p1 has no entry
            )

    def test_unknown_person_in_dept_members(self) -> None:
        with pytest.raises(HierarchyValidationError, match="unknown person"):
            self._make_hierarchy(
                department_members={"d1": ["p1", "p_unknown"]},
            )

    def test_unknown_dept_in_person_departments(self) -> None:
        with pytest.raises(HierarchyValidationError, match="unknown department"):
            self._make_hierarchy(
                person_departments={"p1": ["d1", "d_unknown"]},
            )

    def test_unknown_dept_in_department_members(self) -> None:
        with pytest.raises(HierarchyValidationError, match="unknown department"):
            self._make_hierarchy(
                department_members={"d_unknown": ["p1"], "d1": ["p1"]},
            )

    def test_unknown_person_in_person_departments(self) -> None:
        with pytest.raises(HierarchyValidationError, match="unknown person"):
            self._make_hierarchy(
                person_departments={"p1": ["d1"], "p_unknown": ["d1"]},
            )

    def test_many_to_many(self) -> None:
        """Person belongs to 2 departments."""
        d2 = DepartmentProfile(department_id="d2", name="Policy")
        h = self._make_hierarchy(
            departments={
                "d1": DepartmentProfile(department_id="d1", name="Research"),
                "d2": d2,
            },
            department_members={"d1": ["p1"], "d2": ["p1"]},
            person_departments={"p1": ["d1", "d2"]},
        )
        assert len(h.person_departments["p1"]) == 2

    def test_multiple_people_multiple_depts(self) -> None:
        """Two people, two departments, cross-membership."""
        p2 = _make_profile("p2", "Author B", dept_ids=["d1", "d2"])
        h = self._make_hierarchy(
            departments={
                "d1": DepartmentProfile(department_id="d1", name="Research"),
                "d2": DepartmentProfile(department_id="d2", name="Policy"),
            },
            people={
                "p1": _make_profile("p1", "Author A", dept_ids=["d1"]),
                "p2": p2,
            },
            department_members={"d1": ["p1", "p2"], "d2": ["p2"]},
            person_departments={"p1": ["d1"], "p2": ["d1", "d2"]},
        )
        assert "p2" in h.department_members["d1"]
        assert "p2" in h.department_members["d2"]
        assert len(h.person_departments["p2"]) == 2
