"""Tests for HierarchyManager: CRUD, cascade, diff, and hierarchy emission."""

from __future__ import annotations

import json
from pathlib import Path

import pytest

from joyus_profile.exceptions import HierarchyValidationError, ProfileBuildError
from joyus_profile.models.features import AudienceProfile, StylometricFeatures, VocabularyProfile
from joyus_profile.models.hierarchy import (
    DepartmentProfile,
    HierarchyDiff,
    OfficialPosition,
    OrganizationProfile,
    ProfileDiff,
    ProfileHierarchy,
    ProhibitedFraming,
    StylometricBaseline,
    VoiceDefinition,
)
from joyus_profile.models.profile import AuthorProfile, Position
from joyus_profile.emit.skill_emitter import SkillEmitter
from joyus_profile.profile.hierarchy_manager import HierarchyManager


# ── Helpers ────────────────────────────────────────────────────────────


def _make_profile(
    pid: str,
    name: str,
    word_count: int = 10_000,
    dept_ids: list[str] | None = None,
    sig_phrases: list[str] | None = None,
    preferred: list[str] | None = None,
    fw_freqs: dict[str, float] | None = None,
    positions: list[Position] | None = None,
    prohibited_phrases: list[str] | None = None,
) -> AuthorProfile:
    from joyus_profile.models.profile import AntiPatterns

    features = None
    if fw_freqs:
        features = StylometricFeatures(function_word_frequencies=fw_freqs)

    return AuthorProfile(
        profile_id=pid,
        author_name=name,
        word_count=word_count,
        department_ids=dept_ids or [],
        vocabulary=VocabularyProfile(
            signature_phrases=sig_phrases or [],
            preferred_terms=preferred or [],
        ),
        positions=positions or [],
        stylometric_features=features,
        audience=AudienceProfile(primary_register="neutral", formality_score=5.0),
        anti_patterns=AntiPatterns(prohibited_phrases=prohibited_phrases or []),
    )


def _make_valid_hierarchy(
    people: dict[str, AuthorProfile] | None = None,
    departments: dict[str, DepartmentProfile] | None = None,
    department_members: dict[str, list[str]] | None = None,
    person_departments: dict[str, list[str]] | None = None,
) -> ProfileHierarchy:
    """Build a minimal valid hierarchy for testing."""
    if people is None:
        people = {
            "p1": _make_profile("p1", "Author A", dept_ids=["d1"]),
            "p2": _make_profile("p2", "Author B", dept_ids=["d1"]),
        }
    if departments is None:
        departments = {"d1": DepartmentProfile(department_id="d1", name="Research")}
    if department_members is None:
        department_members = {"d1": list(people.keys())}
    if person_departments is None:
        person_departments = {pid: ["d1"] for pid in people}

    org = OrganizationProfile(org_id="org1", name="Example Corp")
    return ProfileHierarchy(
        hierarchy_id="h1",
        org_profile=org,
        departments=departments,
        people=people,
        department_members=department_members,
        person_departments=person_departments,
    )


@pytest.fixture
def manager() -> HierarchyManager:
    return HierarchyManager()


@pytest.fixture
def two_people() -> list[AuthorProfile]:
    return [
        _make_profile(
            "p1", "Author A", word_count=20_000,
            dept_ids=[],
            sig_phrases=["phrase alpha"],
            fw_freqs={"the": 0.07, "of": 0.04},
        ),
        _make_profile(
            "p2", "Author B", word_count=10_000,
            dept_ids=[],
            sig_phrases=["phrase alpha"],
            fw_freqs={"the": 0.09, "of": 0.03},
        ),
    ]


@pytest.fixture
def three_people(two_people: list[AuthorProfile]) -> list[AuthorProfile]:
    return two_people + [
        _make_profile(
            "p3", "Author C", word_count=15_000,
            dept_ids=[],
            sig_phrases=["phrase alpha"],
            fw_freqs={"the": 0.06, "of": 0.05},
        ),
    ]


# ── T043: build() ──────────────────────────────────────────────────────


class TestBuild:
    def test_build_creates_complete_hierarchy(
        self, manager: HierarchyManager, two_people: list[AuthorProfile]
    ) -> None:
        departments_config = [
            {"name": "Research", "domain_specialization": "policy", "member_ids": ["p1", "p2"]},
        ]
        org_config = {"name": "Example Corp"}

        h = manager.build(two_people, departments_config, org_config)

        assert isinstance(h, ProfileHierarchy)
        assert h.org_profile.name == "Example Corp"
        assert len(h.departments) == 1
        assert len(h.people) == 2
        assert "p1" in h.people
        assert "p2" in h.people

    def test_build_department_members_correct(
        self, manager: HierarchyManager, two_people: list[AuthorProfile]
    ) -> None:
        departments_config = [
            {"name": "Research", "member_ids": ["p1", "p2"]},
        ]
        org_config = {"name": "Example Corp"}

        h = manager.build(two_people, departments_config, org_config)

        dept_id = list(h.departments.keys())[0]
        assert set(h.department_members[dept_id]) == {"p1", "p2"}
        assert dept_id in h.person_departments["p1"]
        assert dept_id in h.person_departments["p2"]

    def test_build_multi_department(
        self, manager: HierarchyManager, three_people: list[AuthorProfile]
    ) -> None:
        departments_config = [
            {"name": "Research", "member_ids": ["p1", "p2"]},
            {"name": "Policy", "member_ids": ["p2", "p3"]},
        ]
        org_config = {"name": "Example Corp"}

        h = manager.build(three_people, departments_config, org_config)

        assert len(h.departments) == 2
        # p2 is in both departments
        assert len(h.person_departments["p2"]) == 2

    def test_build_raises_insufficient_members(
        self, manager: HierarchyManager, two_people: list[AuthorProfile]
    ) -> None:
        departments_config = [
            {"name": "Solo", "member_ids": ["p1"]},
        ]
        org_config = {"name": "Example Corp"}

        with pytest.raises(ProfileBuildError, match="needs >= 2 members"):
            manager.build(two_people, departments_config, org_config)

    def test_build_org_with_prohibited_framings(
        self, manager: HierarchyManager, two_people: list[AuthorProfile]
    ) -> None:
        framings = [ProhibitedFraming(text="industry-friendly", reason="bias")]
        departments_config = [{"name": "Research", "member_ids": ["p1", "p2"]}]
        org_config = {"name": "Example Corp", "prohibited_framings": framings}

        h = manager.build(two_people, departments_config, org_config)

        assert len(h.org_profile.prohibited_framings) == 1
        assert h.org_profile.prohibited_framings[0].text == "industry-friendly"


# ── T043: add_person() ─────────────────────────────────────────────────


class TestAddPerson:
    def test_add_person_appears_in_hierarchy(self, manager: HierarchyManager) -> None:
        h = _make_valid_hierarchy()
        new_person = _make_profile("p3", "Author C", word_count=8_000, fw_freqs={"the": 0.06})

        h2 = manager.add_person(h, new_person, dept_ids=["d1"])

        assert "p3" in h2.people
        assert "p3" in h2.department_members["d1"]
        assert "d1" in h2.person_departments["p3"]

    def test_add_person_rebuilds_department(self, manager: HierarchyManager) -> None:
        h = _make_valid_hierarchy()
        new_person = _make_profile("p3", "Author C", word_count=8_000, fw_freqs={"the": 0.06})

        h2 = manager.add_person(h, new_person, dept_ids=["d1"])

        # Department should now list 3 members
        assert "p3" in h2.departments["d1"].member_ids

    def test_add_person_unknown_dept_raises(self, manager: HierarchyManager) -> None:
        h = _make_valid_hierarchy()
        new_person = _make_profile("p3", "Author C")

        with pytest.raises(HierarchyValidationError, match="unknown department"):
            manager.add_person(h, new_person, dept_ids=["d_nonexistent"])

    def test_add_person_does_not_mutate_original(
        self, manager: HierarchyManager
    ) -> None:
        h = _make_valid_hierarchy()
        new_person = _make_profile("p3", "Author C", word_count=5_000, fw_freqs={"the": 0.05})

        h2 = manager.add_person(h, new_person, dept_ids=["d1"])

        assert "p3" not in h.people  # original unchanged
        assert "p3" in h2.people


# ── T043: remove_person() ──────────────────────────────────────────────


class TestRemovePerson:
    def test_remove_person_disappears(self, manager: HierarchyManager) -> None:
        people = {
            "p1": _make_profile("p1", "Author A", dept_ids=["d1"]),
            "p2": _make_profile("p2", "Author B", dept_ids=["d1"]),
            "p3": _make_profile("p3", "Author C", dept_ids=["d1"]),
        }
        dept = DepartmentProfile(
            department_id="d1", name="Research", member_ids=["p1", "p2", "p3"]
        )
        h = ProfileHierarchy(
            hierarchy_id="h1",
            org_profile=OrganizationProfile(org_id="org1", name="Example Corp"),
            departments={"d1": dept},
            people=people,
            department_members={"d1": ["p1", "p2", "p3"]},
            person_departments={"p1": ["d1"], "p2": ["d1"], "p3": ["d1"]},
        )

        h2 = manager.remove_person(h, "p1")

        assert "p1" not in h2.people
        assert "p1" not in h2.department_members["d1"]
        assert "p1" not in h2.person_departments

    def test_remove_person_rebuilds_department(self, manager: HierarchyManager) -> None:
        people = {
            "p1": _make_profile("p1", "Author A", word_count=20_000, fw_freqs={"the": 0.07}, dept_ids=["d1"]),
            "p2": _make_profile("p2", "Author B", word_count=10_000, fw_freqs={"the": 0.09}, dept_ids=["d1"]),
            "p3": _make_profile("p3", "Author C", word_count=15_000, fw_freqs={"the": 0.06}, dept_ids=["d1"]),
        }
        dept = DepartmentProfile(
            department_id="d1", name="Research", member_ids=["p1", "p2", "p3"]
        )
        h = ProfileHierarchy(
            hierarchy_id="h1",
            org_profile=OrganizationProfile(org_id="org1", name="Example Corp"),
            departments={"d1": dept},
            people=people,
            department_members={"d1": ["p1", "p2", "p3"]},
            person_departments={"p1": ["d1"], "p2": ["d1"], "p3": ["d1"]},
        )

        h2 = manager.remove_person(h, "p3")

        assert "p3" not in h2.departments["d1"].member_ids
        assert len(h2.departments["d1"].member_ids) == 2

    def test_remove_unknown_person_raises(self, manager: HierarchyManager) -> None:
        h = _make_valid_hierarchy()

        with pytest.raises(HierarchyValidationError, match="not found in hierarchy"):
            manager.remove_person(h, "p_nonexistent")

    def test_remove_does_not_mutate_original(self, manager: HierarchyManager) -> None:
        people = {
            "p1": _make_profile("p1", "Author A", dept_ids=["d1"]),
            "p2": _make_profile("p2", "Author B", dept_ids=["d1"]),
            "p3": _make_profile("p3", "Author C", dept_ids=["d1"]),
        }
        dept = DepartmentProfile(department_id="d1", name="Research", member_ids=["p1", "p2", "p3"])
        h = ProfileHierarchy(
            hierarchy_id="h1",
            org_profile=OrganizationProfile(org_id="org1", name="Example Corp"),
            departments={"d1": dept},
            people=people,
            department_members={"d1": ["p1", "p2", "p3"]},
            person_departments={"p1": ["d1"], "p2": ["d1"], "p3": ["d1"]},
        )

        h2 = manager.remove_person(h, "p1")

        assert "p1" in h.people  # original unchanged
        assert "p1" not in h2.people


# ── T043: rebuild_composites() ─────────────────────────────────────────


class TestRebuildComposites:
    def test_rebuild_produces_equivalent_result(
        self, manager: HierarchyManager, two_people: list[AuthorProfile]
    ) -> None:
        departments_config = [{"name": "Research", "member_ids": ["p1", "p2"]}]
        org_config = {"name": "Example Corp"}

        h1 = manager.build(two_people, departments_config, org_config)
        h2 = manager.rebuild_composites(h1)

        dept_id = list(h1.departments.keys())[0]
        # Member set should be identical
        assert set(h2.departments[dept_id].member_ids) == set(h1.departments[dept_id].member_ids)
        # Stylometric baseline should be very close (within floating point noise)
        old_means = h1.departments[dept_id].stylometric_baseline.feature_means
        new_means = h2.departments[dept_id].stylometric_baseline.feature_means
        for key in old_means:
            assert abs(old_means[key] - new_means.get(key, 0.0)) < 1e-9

    def test_rebuild_preserves_department_ids(
        self, manager: HierarchyManager, two_people: list[AuthorProfile]
    ) -> None:
        departments_config = [{"name": "Research", "member_ids": ["p1", "p2"]}]
        org_config = {"name": "Example Corp"}

        h1 = manager.build(two_people, departments_config, org_config)
        dept_id = list(h1.departments.keys())[0]

        h2 = manager.rebuild_composites(h1)

        assert dept_id in h2.departments


# ── T044: Cascade prohibited framings ──────────────────────────────────


class TestCascadeProhibitedFramings:
    def test_cascade_adds_to_org(self, manager: HierarchyManager) -> None:
        h = _make_valid_hierarchy()
        framing = ProhibitedFraming(text="bad-phrase", reason="policy")

        h2 = manager.update_prohibited_framings(h, [framing])

        texts = {f.text for f in h2.org_profile.prohibited_framings}
        assert "bad-phrase" in texts

    def test_cascade_adds_to_people_anti_patterns(
        self, manager: HierarchyManager
    ) -> None:
        h = _make_valid_hierarchy()
        framing = ProhibitedFraming(text="banned-term", reason="brand")

        h2 = manager.update_prohibited_framings(h, [framing])

        for person in h2.people.values():
            assert "banned-term" in person.anti_patterns.prohibited_phrases

    def test_cascade_idempotent(self, manager: HierarchyManager) -> None:
        h = _make_valid_hierarchy()
        framing = ProhibitedFraming(text="deregulation", reason="brand")

        h2 = manager.update_prohibited_framings(h, [framing])
        h3 = manager.update_prohibited_framings(h2, [framing])

        # Applying twice should not duplicate
        org_texts = [f.text for f in h3.org_profile.prohibited_framings]
        assert org_texts.count("deregulation") == 1

        for person in h3.people.values():
            count = person.anti_patterns.prohibited_phrases.count("deregulation")
            assert count == 1

    def test_cascade_multiple_framings(self, manager: HierarchyManager) -> None:
        h = _make_valid_hierarchy()
        framings = [
            ProhibitedFraming(text="term-one"),
            ProhibitedFraming(text="term-two"),
        ]

        h2 = manager.update_prohibited_framings(h, framings)

        for person in h2.people.values():
            assert "term-one" in person.anti_patterns.prohibited_phrases
            assert "term-two" in person.anti_patterns.prohibited_phrases


# ── T044: Authoritative position override ──────────────────────────────


class TestAuthorativePositionOverride:
    def test_authoritative_overrides_individual_positions(
        self, manager: HierarchyManager
    ) -> None:
        people = {
            "p1": _make_profile(
                "p1", "Author A", dept_ids=["d1"],
                positions=[Position(topic="data-privacy", stance="optional", strength=0.4)],
            ),
            "p2": _make_profile(
                "p2", "Author B", dept_ids=["d1"],
                positions=[Position(topic="data-privacy", stance="weak-protection", strength=0.5)],
            ),
        }
        h = _make_valid_hierarchy(people=people)
        org_pos = OfficialPosition(
            topic="data-privacy",
            stance="strong-protection-required",
            authoritative=True,
        )

        h2 = manager.update_official_position(h, org_pos)

        for person in h2.people.values():
            matching = [p for p in person.positions if p.topic == "data-privacy"]
            assert len(matching) == 1
            assert matching[0].stance == "strong-protection-required"

    def test_non_authoritative_does_not_override_people(
        self, manager: HierarchyManager
    ) -> None:
        people = {
            "p1": _make_profile(
                "p1", "Author A", dept_ids=["d1"],
                positions=[Position(topic="data-privacy", stance="optional", strength=0.4)],
            ),
            "p2": _make_profile("p2", "Author B", dept_ids=["d1"]),
        }
        h = _make_valid_hierarchy(people=people)
        org_pos = OfficialPosition(
            topic="data-privacy",
            stance="suggested-protection",
            authoritative=False,
        )

        h2 = manager.update_official_position(h, org_pos)

        # p1's individual stance should be unchanged
        p1_positions = {p.topic: p.stance for p in h2.people["p1"].positions}
        assert p1_positions.get("data-privacy") == "optional"

    def test_position_upserted_in_org(self, manager: HierarchyManager) -> None:
        h = _make_valid_hierarchy()
        pos1 = OfficialPosition(topic="privacy", stance="strict", authoritative=True)
        pos2 = OfficialPosition(topic="privacy", stance="very-strict", authoritative=True)

        h2 = manager.update_official_position(h, pos1)
        h3 = manager.update_official_position(h2, pos2)

        privacy_positions = [p for p in h3.org_profile.official_positions if p.topic == "privacy"]
        assert len(privacy_positions) == 1
        assert privacy_positions[0].stance == "very-strict"

    def test_authoritative_cascade_idempotent(self, manager: HierarchyManager) -> None:
        people = {
            "p1": _make_profile("p1", "Author A", dept_ids=["d1"]),
            "p2": _make_profile("p2", "Author B", dept_ids=["d1"]),
        }
        h = _make_valid_hierarchy(people=people)
        pos = OfficialPosition(topic="access", stance="open", authoritative=True)

        h2 = manager.update_official_position(h, pos)
        h3 = manager.update_official_position(h2, pos)

        # Position appears exactly once per person
        for person in h3.people.values():
            matches = [p for p in person.positions if p.topic == "access"]
            assert len(matches) == 1


# ── T045: diff() ───────────────────────────────────────────────────────


class TestDiff:
    def test_diff_detects_added_people(self, manager: HierarchyManager) -> None:
        h1 = _make_valid_hierarchy()
        new_person = _make_profile("p3", "Author C", word_count=5_000, fw_freqs={"the": 0.05})
        h2 = manager.add_person(h1, new_person, dept_ids=["d1"])

        result = manager.diff(h1, h2)

        assert "p3" in result.added_people
        assert "p3" not in result.removed_people

    def test_diff_detects_removed_people(self, manager: HierarchyManager) -> None:
        people = {
            "p1": _make_profile("p1", "Author A", dept_ids=["d1"]),
            "p2": _make_profile("p2", "Author B", dept_ids=["d1"]),
            "p3": _make_profile("p3", "Author C", dept_ids=["d1"]),
        }
        dept = DepartmentProfile(department_id="d1", name="Research", member_ids=["p1", "p2", "p3"])
        h1 = ProfileHierarchy(
            hierarchy_id="h1",
            org_profile=OrganizationProfile(org_id="org1", name="Example Corp"),
            departments={"d1": dept},
            people=people,
            department_members={"d1": ["p1", "p2", "p3"]},
            person_departments={"p1": ["d1"], "p2": ["d1"], "p3": ["d1"]},
        )
        h2 = manager.remove_person(h1, "p3")

        result = manager.diff(h1, h2)

        assert "p3" in result.removed_people
        assert "p3" not in result.added_people

    def test_diff_detects_modified_people(self, manager: HierarchyManager) -> None:
        h1 = _make_valid_hierarchy()

        # Cascade a framing to modify people
        framing = ProhibitedFraming(text="banned-word")
        h2 = manager.update_prohibited_framings(h1, [framing])

        result = manager.diff(h1, h2)

        modified_ids = {d.profile_id for d in result.modified_people}
        # Both p1 and p2 had anti_patterns changed
        assert modified_ids & {"p1", "p2"}

    def test_diff_detects_no_changes(self, manager: HierarchyManager) -> None:
        h = _make_valid_hierarchy()
        result = manager.diff(h, h)

        assert result.added_people == []
        assert result.removed_people == []
        assert result.modified_people == []
        assert result.added_departments == []
        assert result.removed_departments == []
        assert result.modified_departments == []
        assert result.org_changes is None

    def test_diff_detects_org_changes(self, manager: HierarchyManager) -> None:
        h1 = _make_valid_hierarchy()
        framing = ProhibitedFraming(text="org-banned")
        h2 = manager.update_prohibited_framings(h1, [framing])

        result = manager.diff(h1, h2)

        assert result.org_changes is not None
        assert "prohibited_framings" in result.org_changes.changed_sections

    def test_diff_stylometric_threshold(self, manager: HierarchyManager) -> None:
        """Small deltas (<=0.01) should NOT be flagged; large ones should."""
        from joyus_profile.models.profile import AntiPatterns

        p1_old = _make_profile("p1", "Author A", dept_ids=["d1"], fw_freqs={"the": 0.070})
        p1_new = _make_profile("p1", "Author A", dept_ids=["d1"], fw_freqs={"the": 0.070001})
        p2 = _make_profile("p2", "Author B", dept_ids=["d1"])

        h1 = _make_valid_hierarchy(people={"p1": p1_old, "p2": p2})
        h2 = _make_valid_hierarchy(people={"p1": p1_new, "p2": p2})

        result = manager.diff(h1, h2)
        # Tiny delta — should not be in modified_people for stylometrics
        modified_ids = {d.profile_id for d in result.modified_people}
        if "p1" in modified_ids:
            p1_diff = next(d for d in result.modified_people if d.profile_id == "p1")
            assert "stylometric_features" not in p1_diff.changed_sections

        # Now with a large delta
        p1_large = _make_profile("p1", "Author A", dept_ids=["d1"], fw_freqs={"the": 0.15})
        h3 = _make_valid_hierarchy(people={"p1": p1_large, "p2": p2})
        result2 = manager.diff(h1, h3)
        modified_ids2 = {d.profile_id for d in result2.modified_people}
        assert "p1" in modified_ids2
        p1_diff2 = next(d for d in result2.modified_people if d.profile_id == "p1")
        assert "stylometric_features" in p1_diff2.changed_sections


# ── T046: emit_hierarchy() ─────────────────────────────────────────────


class TestEmitHierarchy:
    def _make_full_hierarchy(self, manager: HierarchyManager) -> ProfileHierarchy:
        people = [
            _make_profile("p1", "Author A", word_count=20_000, dept_ids=[], fw_freqs={"the": 0.07}),
            _make_profile("p2", "Author B", word_count=10_000, dept_ids=[], fw_freqs={"the": 0.09}),
        ]
        from joyus_profile.models.hierarchy import VoiceDefinition

        departments_config = [{"name": "Research Team", "member_ids": ["p1", "p2"]}]
        org_config = {
            "name": "Example Corp",
            "voice_definitions": {
                "formal": VoiceDefinition(audience_key="formal", audience_label="Formal"),
            },
        }
        return manager.build(people, departments_config, org_config)

    def test_emit_hierarchy_creates_org_dir(
        self, manager: HierarchyManager, tmp_path: Path
    ) -> None:
        h = self._make_full_hierarchy(manager)
        emitter = SkillEmitter()

        result = emitter.emit_hierarchy(h, str(tmp_path))

        assert "org" in result
        assert (tmp_path / "org" / "SKILL.md").exists()
        assert (tmp_path / "org" / "stylometrics.json").exists()
        assert (tmp_path / "org" / "voices.json").exists()

    def test_emit_hierarchy_creates_department_dirs(
        self, manager: HierarchyManager, tmp_path: Path
    ) -> None:
        h = self._make_full_hierarchy(manager)
        emitter = SkillEmitter()

        result = emitter.emit_hierarchy(h, str(tmp_path))

        dept_keys = [k for k in result if k.startswith("department:")]
        assert len(dept_keys) == 1

        # Department dir uses slugified name "research-team"
        dept_dir = tmp_path / "departments" / "research-team"
        assert dept_dir.exists()
        assert (dept_dir / "stylometrics.json").exists()

    def test_emit_hierarchy_creates_people_dirs(
        self, manager: HierarchyManager, tmp_path: Path
    ) -> None:
        h = self._make_full_hierarchy(manager)
        emitter = SkillEmitter()

        result = emitter.emit_hierarchy(h, str(tmp_path))

        person_keys = [k for k in result if k.startswith("person:")]
        assert len(person_keys) == 2

        # People dirs use slugified author names
        assert (tmp_path / "people" / "author-a").exists()
        assert (tmp_path / "people" / "author-b").exists()

    def test_emit_hierarchy_voices_json_content(
        self, manager: HierarchyManager, tmp_path: Path
    ) -> None:
        h = self._make_full_hierarchy(manager)
        emitter = SkillEmitter()

        emitter.emit_hierarchy(h, str(tmp_path))

        voices_path = tmp_path / "org" / "voices.json"
        data = json.loads(voices_path.read_text())
        assert "formal" in data
        assert data["formal"]["audience_key"] == "formal"

    def test_emit_hierarchy_stylometrics_content(
        self, manager: HierarchyManager, tmp_path: Path
    ) -> None:
        h = self._make_full_hierarchy(manager)
        emitter = SkillEmitter()

        emitter.emit_hierarchy(h, str(tmp_path))

        dept_dir = tmp_path / "departments" / "research-team"
        stylo = json.loads((dept_dir / "stylometrics.json").read_text())
        assert "feature_means" in stylo
        assert "the" in stylo["feature_means"]

    def test_emit_hierarchy_result_keys(
        self, manager: HierarchyManager, tmp_path: Path
    ) -> None:
        h = self._make_full_hierarchy(manager)
        emitter = SkillEmitter()

        result = emitter.emit_hierarchy(h, str(tmp_path))

        assert "org" in result
        assert any(k.startswith("department:") for k in result)
        assert any(k.startswith("person:") for k in result)
