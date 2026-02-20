"""Phase B gap tests: effective_prohibited_framings and diff() for department changes.

These tests cover behaviors not exercised in test_composite.py or
test_hierarchy_manager.py.
"""

from __future__ import annotations

from joyus_profile.models.hierarchy import (
    DepartmentProfile,
    OrganizationProfile,
    ProfileHierarchy,
    ProhibitedFraming,
    StylometricBaseline,
)
from joyus_profile.models.profile import AuthorProfile
from joyus_profile.profile.hierarchy_manager import HierarchyManager

# ── Helpers ────────────────────────────────────────────────────────────────────


def _make_person(pid: str, dept_id: str = "d1") -> AuthorProfile:
    return AuthorProfile(
        profile_id=pid,
        author_name=pid,
        department_ids=[dept_id],
    )


def _make_hierarchy(
    prohibited_framings: list[ProhibitedFraming] | None = None,
) -> ProfileHierarchy:
    org = OrganizationProfile(
        org_id="org1",
        name="Example Corp",
        prohibited_framings=prohibited_framings or [],
    )
    dept = DepartmentProfile(department_id="d1", name="Research")
    return ProfileHierarchy(
        hierarchy_id="h1",
        org_profile=org,
        departments={"d1": dept},
        people={
            "p1": _make_person("p1"),
            "p2": _make_person("p2"),
        },
        department_members={"d1": ["p1", "p2"]},
        person_departments={"p1": ["d1"], "p2": ["d1"]},
    )


# ── effective_prohibited_framings() ────────────────────────────────────────────


class TestEffectiveProhibitedFramings:
    def test_returns_empty_when_no_framings(self) -> None:
        h = _make_hierarchy()
        result = h.effective_prohibited_framings()
        assert result == []

    def test_returns_org_level_framings(self) -> None:
        framings = [
            ProhibitedFraming(text="industry-friendly", reason="Bias"),
            ProhibitedFraming(text="deregulation", reason="Off-brand"),
        ]
        h = _make_hierarchy(prohibited_framings=framings)
        result = h.effective_prohibited_framings()
        assert len(result) == 2
        texts = {f.text for f in result}
        assert "industry-friendly" in texts
        assert "deregulation" in texts

    def test_returns_list_copy_not_reference(self) -> None:
        """Mutating the returned list does not alter the hierarchy."""
        framings = [ProhibitedFraming(text="term-a")]
        h = _make_hierarchy(prohibited_framings=framings)
        result = h.effective_prohibited_framings()
        result.append(ProhibitedFraming(text="term-injected"))
        # Hierarchy should be unaffected
        assert len(h.effective_prohibited_framings()) == 1

    def test_entity_id_param_ignored_returns_same_result(self) -> None:
        """entity_id is accepted but framings are org-wide (no per-entity override)."""
        framings = [ProhibitedFraming(text="shared-term")]
        h = _make_hierarchy(prohibited_framings=framings)
        assert h.effective_prohibited_framings("p1") == h.effective_prohibited_framings("d1")
        assert h.effective_prohibited_framings("p1") == h.effective_prohibited_framings()

    def test_single_framing(self) -> None:
        framings = [ProhibitedFraming(text="only-term", reason="policy", severity="high")]
        h = _make_hierarchy(prohibited_framings=framings)
        result = h.effective_prohibited_framings()
        assert len(result) == 1
        assert result[0].text == "only-term"
        assert result[0].severity == "high"


# ── diff() — department-level changes ─────────────────────────────────────────


class TestDiffDepartmentChanges:
    def _make_hierarchy_with_dept(
        self,
        domain: str = "general",
        baseline_means: dict | None = None,
    ) -> ProfileHierarchy:
        org = OrganizationProfile(org_id="org1", name="Example Corp")
        dept = DepartmentProfile(
            department_id="d1",
            name="Research",
            domain_specialization=domain,
            member_ids=["p1", "p2"],
            stylometric_baseline=StylometricBaseline(
                feature_means=baseline_means or {"the": 0.07},
                sample_count=20_000,
            ),
        )
        return ProfileHierarchy(
            hierarchy_id="h1",
            org_profile=org,
            departments={"d1": dept},
            people={
                "p1": _make_person("p1"),
                "p2": _make_person("p2"),
            },
            department_members={"d1": ["p1", "p2"]},
            person_departments={"p1": ["d1"], "p2": ["d1"]},
        )

    def test_diff_detects_dept_stylometric_change(self) -> None:
        """Large baseline delta (>0.01) should appear in modified_departments."""
        manager = HierarchyManager()
        h1 = self._make_hierarchy_with_dept(baseline_means={"the": 0.07})
        h2 = self._make_hierarchy_with_dept(baseline_means={"the": 0.20})

        result = manager.diff(h1, h2)

        modified_ids = {d.profile_id for d in result.modified_departments}
        assert "d1" in modified_ids
        d1_diff = next(d for d in result.modified_departments if d.profile_id == "d1")
        assert "stylometric_baseline" in d1_diff.changed_sections

    def test_diff_no_change_for_tiny_dept_delta(self) -> None:
        """Sub-threshold delta (<=0.01) should not flag dept as modified."""
        manager = HierarchyManager()
        h1 = self._make_hierarchy_with_dept(baseline_means={"the": 0.07000})
        h2 = self._make_hierarchy_with_dept(baseline_means={"the": 0.07001})

        result = manager.diff(h1, h2)

        modified_ids = {d.profile_id for d in result.modified_departments}
        if "d1" in modified_ids:
            d1_diff = next(d for d in result.modified_departments if d.profile_id == "d1")
            assert "stylometric_baseline" not in d1_diff.changed_sections

    def test_diff_detects_dept_added(self) -> None:
        manager = HierarchyManager()
        h1 = self._make_hierarchy_with_dept()

        # Add a second department to h2
        org = OrganizationProfile(org_id="org1", name="Example Corp")
        dept1 = DepartmentProfile(
            department_id="d1",
            name="Research",
            member_ids=["p1", "p2"],
            stylometric_baseline=StylometricBaseline(
                feature_means={"the": 0.07}, sample_count=20_000
            ),
        )
        dept2 = DepartmentProfile(department_id="d2", name="Policy")
        p3 = _make_person("p3", dept_id="d2")
        p4 = _make_person("p4", dept_id="d2")
        h2 = ProfileHierarchy(
            hierarchy_id="h1",
            org_profile=org,
            departments={"d1": dept1, "d2": dept2},
            people={
                "p1": _make_person("p1"),
                "p2": _make_person("p2"),
                "p3": p3,
                "p4": p4,
            },
            department_members={"d1": ["p1", "p2"], "d2": ["p3", "p4"]},
            person_departments={
                "p1": ["d1"], "p2": ["d1"], "p3": ["d2"], "p4": ["d2"]
            },
        )

        result = manager.diff(h1, h2)

        assert "d2" in result.added_departments

    def test_diff_detects_dept_removed(self) -> None:
        manager = HierarchyManager()
        # h1 has two departments
        org = OrganizationProfile(org_id="org1", name="Example Corp")
        dept1 = DepartmentProfile(department_id="d1", name="Research", member_ids=["p1", "p2"])
        dept2 = DepartmentProfile(department_id="d2", name="Policy", member_ids=["p3", "p4"])
        p3 = _make_person("p3", dept_id="d2")
        p4 = _make_person("p4", dept_id="d2")
        h1 = ProfileHierarchy(
            hierarchy_id="h1",
            org_profile=org,
            departments={"d1": dept1, "d2": dept2},
            people={
                "p1": _make_person("p1"),
                "p2": _make_person("p2"),
                "p3": p3,
                "p4": p4,
            },
            department_members={"d1": ["p1", "p2"], "d2": ["p3", "p4"]},
            person_departments={
                "p1": ["d1"], "p2": ["d1"], "p3": ["d2"], "p4": ["d2"]
            },
        )
        # h2 drops d2
        h2 = self._make_hierarchy_with_dept()

        result = manager.diff(h1, h2)

        assert "d2" in result.removed_departments


# ── Cascade threshold constants ────────────────────────────────────────────────


class TestCascadeThresholdValues:
    """Verify the published threshold constants match spec (§5.3 of 005/spec.md)."""

    def test_person_threshold_value(self) -> None:
        from joyus_profile.attribute.cascade import _PERSON_THRESHOLD
        assert _PERSON_THRESHOLD == 0.85

    def test_dept_threshold_value(self) -> None:
        from joyus_profile.attribute.cascade import _DEPT_THRESHOLD
        assert _DEPT_THRESHOLD == 0.80

    def test_org_threshold_value(self) -> None:
        from joyus_profile.attribute.cascade import _ORG_THRESHOLD
        assert _ORG_THRESHOLD == 0.70

    def test_person_threshold_higher_than_dept(self) -> None:
        from joyus_profile.attribute.cascade import _DEPT_THRESHOLD, _PERSON_THRESHOLD
        assert _PERSON_THRESHOLD > _DEPT_THRESHOLD

    def test_dept_threshold_higher_than_org(self) -> None:
        from joyus_profile.attribute.cascade import _DEPT_THRESHOLD, _ORG_THRESHOLD
        assert _DEPT_THRESHOLD > _ORG_THRESHOLD
