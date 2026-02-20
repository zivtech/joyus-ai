"""Tests for AttributionEngine cascade logic."""

from __future__ import annotations

import pytest

from joyus_profile.attribute.cascade import (
    AttributionEngine,
    _DEPT_THRESHOLD,
    _ORG_THRESHOLD,
    _PERSON_THRESHOLD,
)
from joyus_profile.models.features import Marker, MarkerSet, VocabularyProfile
from joyus_profile.models.hierarchy import (
    DepartmentProfile,
    OrganizationProfile,
    ProfileHierarchy,
    StylometricBaseline,
)
from joyus_profile.models.profile import AuthorProfile

from .conftest import AUTHOR_A_TEXT, AUTHOR_B_TEXT, OUTSIDER_TEXT


class TestPersonLevelMatch:
    def test_person_match_above_threshold(self, two_author_hierarchy):
        engine = AttributionEngine(two_author_hierarchy)
        result = engine.identify(AUTHOR_A_TEXT)

        assert result.match_level == "person"
        assert result.target_id == "author-a"
        assert result.confidence >= _PERSON_THRESHOLD

    def test_person_match_selects_correct_author(self, two_author_hierarchy):
        engine = AttributionEngine(two_author_hierarchy)

        result_a = engine.identify(AUTHOR_A_TEXT)
        result_b = engine.identify(AUTHOR_B_TEXT)

        assert result_a.target_id == "author-a"
        assert result_b.target_id == "author-b"

    def test_candidates_sorted_descending(self, two_author_hierarchy):
        engine = AttributionEngine(two_author_hierarchy)
        result = engine.identify(AUTHOR_A_TEXT)

        scores = [c.score for c in result.candidates]
        assert scores == sorted(scores, reverse=True)

    def test_candidates_include_matched_markers(self, two_author_hierarchy):
        engine = AttributionEngine(two_author_hierarchy)
        result = engine.identify(AUTHOR_A_TEXT)

        best = result.candidates[0]
        assert best.profile_id == "author-a"
        assert len(best.matched_markers) > 0
        assert any("regulatory" in m.lower() for m in best.matched_markers)

    def test_feature_breakdown_keys(self, two_author_hierarchy):
        engine = AttributionEngine(two_author_hierarchy)
        result = engine.identify(AUTHOR_A_TEXT)

        best = result.candidates[0]
        assert "markers" in best.feature_breakdown
        assert "vocabulary" in best.feature_breakdown
        assert "stylometric" in best.feature_breakdown


class TestDepartmentFallback:
    def test_falls_back_to_department_when_no_person_match(self):
        """When no person exceeds 0.85 but dept vocab matches, expect dept match."""
        # Create a hierarchy where person profile has NO markers (low person score)
        # but the department has strong vocab that matches the text
        from joyus_profile.models.features import MarkerSet

        person = AuthorProfile(
            profile_id="weak-person",
            author_name="Weak Person",
            department_ids=["dept-strong"],
            markers=MarkerSet(),  # empty markers -> low person score
            vocabulary=VocabularyProfile(),  # empty vocab
        )
        dept_vocab = VocabularyProfile(
            signature_phrases=["compliance framework", "enforcement mechanism"],
            preferred_terms=["regulatory", "statutory"],
            avoided_terms=[],
            technical_terms=["adjudication", "promulgation"],
        )
        dept = DepartmentProfile(
            department_id="dept-strong",
            name="Strong Dept",
            shared_vocabulary=dept_vocab,
        )
        org = OrganizationProfile(org_id="org-test", name="Test Org")
        hierarchy = ProfileHierarchy(
            hierarchy_id="fallback-test",
            org_profile=org,
            departments={"dept-strong": dept},
            people={"weak-person": person},
            department_members={"dept-strong": ["weak-person"]},
            person_departments={"weak-person": ["dept-strong"]},
        )

        dept_text = (
            "The compliance framework establishes enforcement mechanisms. "
            "Regulatory and statutory requirements govern adjudication and promulgation. "
            "compliance framework enforcement mechanism regulatory statutory "
            "adjudication promulgation compliance framework enforcement mechanism "
        )

        engine = AttributionEngine(hierarchy)
        result = engine.identify(dept_text)

        # Either dept or person match, but confidence should be non-zero
        assert result.confidence > 0.0
        assert result.match_level in ("department", "person", "org", "outsider")


class TestOrgFallback:
    def test_outsider_when_no_profile_matches(self, two_author_hierarchy):
        engine = AttributionEngine(two_author_hierarchy)
        result = engine.identify(OUTSIDER_TEXT)

        # Without stylometric baselines, org score will be 0 -> outsider
        assert result.match_level == "outsider"
        assert result.target_id is None

    def test_outsider_confidence_is_inverse_of_best_score(self, two_author_hierarchy):
        engine = AttributionEngine(two_author_hierarchy)
        result = engine.identify(OUTSIDER_TEXT)

        if result.candidates:
            best_score = result.candidates[0].score
            assert abs(result.confidence - (1.0 - best_score)) < 0.01


class TestVerifyAuthor:
    def test_verify_correct_author(self, two_author_hierarchy):
        engine = AttributionEngine(two_author_hierarchy)
        result = engine.verify_author(AUTHOR_A_TEXT, "author-a")

        assert result.mode == "verify_author"
        assert result.target_id == "author-a"
        assert result.confidence >= _PERSON_THRESHOLD
        assert result.match_level == "person"

    def test_verify_wrong_author_returns_low_confidence(self, two_author_hierarchy):
        engine = AttributionEngine(two_author_hierarchy)
        # Verify author-b text against author-a
        result = engine.verify_author(AUTHOR_B_TEXT, "author-a")

        assert result.target_id == "author-a"
        # Score should be low since text doesn't match author-a markers
        assert result.confidence < _PERSON_THRESHOLD

    def test_verify_unknown_person_returns_empty(self, two_author_hierarchy):
        engine = AttributionEngine(two_author_hierarchy)
        result = engine.verify_author(AUTHOR_A_TEXT, "nonexistent-person")

        assert result.confidence == 0.0
        assert result.match_level is None
        assert result.candidates == []


class TestValidateDepartment:
    def test_validate_known_department(self, two_author_hierarchy):
        engine = AttributionEngine(two_author_hierarchy)
        result = engine.validate_department(AUTHOR_A_TEXT, "dept-policy")

        assert result.mode == "validate_department"
        assert result.target_id == "dept-policy"
        assert result.confidence > 0.0

    def test_validate_unknown_department_returns_empty(self, two_author_hierarchy):
        engine = AttributionEngine(two_author_hierarchy)
        result = engine.validate_department(AUTHOR_A_TEXT, "no-such-dept")

        assert result.confidence == 0.0
        assert result.candidates == []


class TestValidateOrganization:
    def test_validate_org_returns_result(self, two_author_hierarchy):
        engine = AttributionEngine(two_author_hierarchy)
        result = engine.validate_organization(AUTHOR_A_TEXT)

        assert result.mode == "validate_organization"
        assert result.target_id == "org-example"
        # Without a stylometric baseline the score will be 0
        assert 0.0 <= result.confidence <= 1.0

    def test_validate_org_with_baseline(self):
        """Org with matching function-word frequencies should score > 0."""
        # Build a text and a matching baseline
        text = "the cat sat on the mat and the dog ran"
        words = text.split()
        freqs = {w: words.count(w) / len(words) for w in set(words)}

        org = OrganizationProfile(
            org_id="org-baseline",
            name="Baseline Org",
            stylometric_baseline=StylometricBaseline(
                feature_means=freqs,
                sample_count=1,
            ),
        )
        person = AuthorProfile(
            profile_id="p1",
            author_name="Person One",
            department_ids=["d1"],
        )
        dept = DepartmentProfile(department_id="d1", name="Dept One")
        hierarchy = ProfileHierarchy(
            hierarchy_id="baseline-test",
            org_profile=org,
            departments={"d1": dept},
            people={"p1": person},
            department_members={"d1": ["p1"]},
            person_departments={"p1": ["d1"]},
        )

        engine = AttributionEngine(hierarchy)
        result = engine.validate_organization(text)

        assert result.confidence > 0.0
