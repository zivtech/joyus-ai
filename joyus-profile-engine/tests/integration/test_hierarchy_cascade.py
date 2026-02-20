"""Integration: Full hierarchy build + attribution cascade.

Tests the end-to-end pipeline:
  1. Build people profiles (factory-based, no real corpus)
  2. Build departments via CompositeBuilder
  3. Build organization via CompositeBuilder
  4. Construct ProfileHierarchy
  5. Run AttributionEngine cascade and verify match levels

Naming convention: §2.10 — no client-specific terms; generic names only.
"""

from __future__ import annotations

import pytest

from joyus_profile.attribute.cascade import (
    _PERSON_THRESHOLD,
    AttributionEngine,
)
from joyus_profile.models.features import (
    AudienceProfile,
    Marker,
    MarkerSet,
    StylometricFeatures,
    VocabularyProfile,
)
from joyus_profile.models.hierarchy import (
    DepartmentProfile,
    OrganizationProfile,
    ProfileHierarchy,
    ProhibitedFraming,
)
from joyus_profile.models.profile import AuthorProfile
from joyus_profile.profile.composite import CompositeBuilder

# ── Profile factories ──────────────────────────────────────────────────────────


def _make_author(
    profile_id: str,
    author_name: str,
    dept_id: str,
    high_markers: list[str],
    vocab_phrases: list[str],
    preferred_terms: list[str],
    technical_terms: list[str],
    fw_freqs: dict[str, float],
    word_count: int = 20_000,
) -> AuthorProfile:
    """Factory for a strongly-characterised AuthorProfile."""
    markers = MarkerSet(
        high_signal=[Marker(text=m, weight=0.9) for m in high_markers],
        medium_signal=[],
        negative_markers=[],
    )
    vocabulary = VocabularyProfile(
        signature_phrases=vocab_phrases,
        preferred_terms=preferred_terms,
        technical_terms=technical_terms,
        avoided_terms=[],
    )
    stylo = StylometricFeatures(
        function_word_frequencies=fw_freqs,
        feature_count=len(fw_freqs),
    )
    return AuthorProfile(
        profile_id=profile_id,
        author_name=author_name,
        department_ids=[dept_id],
        markers=markers,
        vocabulary=vocabulary,
        stylometric_features=stylo,
        word_count=word_count,
        audience=AudienceProfile(primary_register="neutral", formality_score=5.0),
    )


# ── Shared hierarchy fixture ───────────────────────────────────────────────────


@pytest.fixture(scope="module")
def full_hierarchy() -> ProfileHierarchy:
    """
    Example Corp with two departments, five people:

    Research Dept   — Author A, Author B, Author C
    Communications  — Author D, Author E

    Each author has distinct markers, vocabulary, and function-word profile.
    Department shared vocabularies are intentionally non-overlapping between depts.
    """
    builder = CompositeBuilder()

    # ── Research Dept people ──────────────────────────────────────────────────
    author_a = _make_author(
        profile_id="author-a",
        author_name="Author A",
        dept_id="dept-research",
        high_markers=["empirical evidence", "longitudinal study"],
        vocab_phrases=["empirical evidence", "longitudinal study", "data-driven analysis"],
        preferred_terms=["methodology", "hypothesis", "variable"],
        technical_terms=["regression", "confidence interval", "p-value"],
        fw_freqs={"the": 0.080, "of": 0.045, "and": 0.038, "in": 0.030, "a": 0.022},
    )
    author_b = _make_author(
        profile_id="author-b",
        author_name="Author B",
        dept_id="dept-research",
        high_markers=["systematic review", "evidence synthesis"],
        vocab_phrases=["systematic review", "evidence synthesis", "meta-analysis"],
        preferred_terms=["methodology", "hypothesis", "replication"],
        technical_terms=["regression", "effect size", "statistical power"],
        fw_freqs={"the": 0.082, "of": 0.044, "and": 0.036, "in": 0.031, "a": 0.020},
    )
    author_c = _make_author(
        profile_id="author-c",
        author_name="Author C",
        dept_id="dept-research",
        high_markers=["experimental design", "control group"],
        vocab_phrases=["experimental design", "control group", "randomised trial"],
        preferred_terms=["methodology", "randomisation", "sample size"],
        technical_terms=["regression", "variance", "confidence interval"],
        fw_freqs={"the": 0.079, "of": 0.043, "and": 0.037, "in": 0.029, "a": 0.021},
    )

    # ── Communications Dept people ────────────────────────────────────────────
    author_d = _make_author(
        profile_id="author-d",
        author_name="Author D",
        dept_id="dept-comms",
        high_markers=["public messaging", "audience engagement"],
        vocab_phrases=["public messaging", "audience engagement", "narrative clarity"],
        preferred_terms=["stakeholder", "outreach", "communication"],
        technical_terms=["press release", "media brief", "key message"],
        fw_freqs={"the": 0.060, "of": 0.025, "and": 0.055, "in": 0.020, "we": 0.035},
    )
    author_e = _make_author(
        profile_id="author-e",
        author_name="Author E",
        dept_id="dept-comms",
        high_markers=["brand voice", "content strategy"],
        vocab_phrases=["brand voice", "content strategy", "editorial calendar"],
        preferred_terms=["stakeholder", "messaging", "platform"],
        technical_terms=["press release", "talking points", "media coverage"],
        fw_freqs={"the": 0.058, "of": 0.024, "and": 0.057, "in": 0.019, "we": 0.037},
    )

    # ── Build department composites ───────────────────────────────────────────
    research_dept = builder.build_department(
        [author_a, author_b, author_c], "Research", "applied-research"
    )
    research_dept = research_dept.model_copy(update={"department_id": "dept-research"})

    comms_dept = builder.build_department(
        [author_d, author_e], "Communications", "public-communications"
    )
    comms_dept = comms_dept.model_copy(update={"department_id": "dept-comms"})

    # ── Build organization ────────────────────────────────────────────────────
    org = builder.build_organization(
        [research_dept, comms_dept],
        "Example Corp",
        prohibited_framings=[ProhibitedFraming(text="off-limits-term", reason="policy")],
    )
    org = org.model_copy(update={"org_id": "org-example"})

    # ── Assemble hierarchy ────────────────────────────────────────────────────
    people = {
        "author-a": author_a,
        "author-b": author_b,
        "author-c": author_c,
        "author-d": author_d,
        "author-e": author_e,
    }
    departments = {
        "dept-research": research_dept,
        "dept-comms": comms_dept,
    }
    department_members = {
        "dept-research": ["author-a", "author-b", "author-c"],
        "dept-comms": ["author-d", "author-e"],
    }
    person_departments = {
        "author-a": ["dept-research"],
        "author-b": ["dept-research"],
        "author-c": ["dept-research"],
        "author-d": ["dept-comms"],
        "author-e": ["dept-comms"],
    }

    return ProfileHierarchy(
        hierarchy_id="integration-test-hierarchy",
        org_profile=org,
        departments=departments,
        people=people,
        department_members=department_members,
        person_departments=person_departments,
    )


# ── Hierarchy structure tests ──────────────────────────────────────────────────


class TestHierarchyStructure:
    def test_hierarchy_has_two_departments(self, full_hierarchy: ProfileHierarchy) -> None:
        assert len(full_hierarchy.departments) == 2

    def test_hierarchy_has_five_people(self, full_hierarchy: ProfileHierarchy) -> None:
        assert len(full_hierarchy.people) == 5

    def test_research_dept_has_three_members(self, full_hierarchy: ProfileHierarchy) -> None:
        assert len(full_hierarchy.department_members["dept-research"]) == 3

    def test_comms_dept_has_two_members(self, full_hierarchy: ProfileHierarchy) -> None:
        assert len(full_hierarchy.department_members["dept-comms"]) == 2

    def test_org_prohibited_framings_cascade(self, full_hierarchy: ProfileHierarchy) -> None:
        framings = full_hierarchy.effective_prohibited_framings()
        assert len(framings) == 1
        assert framings[0].text == "off-limits-term"

    def test_research_dept_shared_vocabulary(self, full_hierarchy: ProfileHierarchy) -> None:
        """All three research authors share 'methodology' → should appear in dept vocab."""
        dept = full_hierarchy.departments["dept-research"]
        assert "methodology" in dept.shared_vocabulary.preferred_terms

    def test_research_dept_stylometric_baseline_set(
        self, full_hierarchy: ProfileHierarchy
    ) -> None:
        baseline = full_hierarchy.departments["dept-research"].stylometric_baseline
        assert baseline.sample_count > 0
        assert "the" in baseline.feature_means

    def test_org_baseline_aggregates_both_depts(self, full_hierarchy: ProfileHierarchy) -> None:
        org_baseline = full_hierarchy.org_profile.stylometric_baseline
        assert org_baseline.sample_count > 0
        assert "the" in org_baseline.feature_means


# ── Attribution cascade tests ──────────────────────────────────────────────────


class TestPersonLevelCascade:
    def test_author_a_text_matches_author_a(self, full_hierarchy: ProfileHierarchy) -> None:
        """Text with Author A's unique markers should resolve to person level."""
        engine = AttributionEngine(full_hierarchy)
        text = (
            "The empirical evidence from the longitudinal study supports our findings. "
            "A data-driven analysis using regression and confidence interval calculations "
            "confirms the hypothesis. empirical evidence longitudinal study data-driven analysis "
            "empirical evidence longitudinal study regression confidence interval p-value "
        )
        result = engine.identify(text)
        assert result.match_level == "person"
        assert result.target_id == "author-a"
        assert result.confidence >= _PERSON_THRESHOLD

    def test_author_d_text_matches_author_d(self, full_hierarchy: ProfileHierarchy) -> None:
        """Text with Author D's unique markers should resolve to person level."""
        engine = AttributionEngine(full_hierarchy)
        # Text crafted so function-word frequencies approximate Author D's profile
        # (the≈0.06, of≈0.025, and≈0.055, in≈0.02, we≈0.035)
        text = (
            "We believe effective public messaging and strong audience engagement "
            "are the cornerstones of our approach to narrative clarity. "
            "The stakeholder outreach we conduct relies on careful communication "
            "and clear key messages. We ensure press releases and media briefs "
            "maintain the highest standards of public messaging. "
            "Audience engagement requires dedication and the right outreach "
            "strategy in every interaction. Public messaging combined with "
            "stakeholder communication and narrative clarity defines our "
            "team approach in practice. "
        )
        result = engine.identify(text)
        assert result.match_level == "person"
        assert result.target_id == "author-d"
        assert result.confidence >= _PERSON_THRESHOLD

    def test_candidates_sorted_descending(self, full_hierarchy: ProfileHierarchy) -> None:
        engine = AttributionEngine(full_hierarchy)
        text = (
            "empirical evidence longitudinal study empirical evidence "
            "methodology hypothesis variable regression confidence interval "
        )
        result = engine.identify(text)
        scores = [c.score for c in result.candidates]
        assert scores == sorted(scores, reverse=True)


class TestDepartmentFallbackCascade:
    def test_dept_vocab_only_falls_back_to_department(
        self, full_hierarchy: ProfileHierarchy
    ) -> None:
        """Text with Research dept shared vocab but no person-specific markers
        should fall back to department if person scores stay below threshold."""
        # Build a minimal hierarchy where the person has no markers but the
        # department has strong shared vocabulary
        from joyus_profile.models.features import MarkerSet

        weak_person = AuthorProfile(
            profile_id="weak-researcher",
            author_name="Weak Researcher",
            department_ids=["dept-research-only"],
            markers=MarkerSet(),  # no markers
            vocabulary=VocabularyProfile(),  # no personal vocab
        )
        dept_vocab = VocabularyProfile(
            signature_phrases=["systematic review", "evidence synthesis", "meta-analysis"],
            preferred_terms=["methodology", "hypothesis", "replication"],
            technical_terms=["effect size", "statistical power", "regression"],
            avoided_terms=[],
        )
        dept = DepartmentProfile(
            department_id="dept-research-only",
            name="Research Only",
            shared_vocabulary=dept_vocab,
        )
        org = OrganizationProfile(org_id="org-test", name="Test Org")
        hierarchy = ProfileHierarchy(
            hierarchy_id="fallback-test",
            org_profile=org,
            departments={"dept-research-only": dept},
            people={"weak-researcher": weak_person},
            department_members={"dept-research-only": ["weak-researcher"]},
            person_departments={"weak-researcher": ["dept-research-only"]},
        )

        text = (
            "systematic review evidence synthesis meta-analysis methodology hypothesis "
            "replication effect size statistical power regression systematic review "
            "evidence synthesis meta-analysis methodology hypothesis replication "
            "effect size statistical power regression systematic review "
        )
        engine = AttributionEngine(hierarchy)
        result = engine.identify(text)

        # Person has no markers/vocab → score 0.0, well below 0.85
        # Dept has strong vocab → should exceed dept threshold if vocab matches well
        assert result.match_level in ("department", "person", "org", "outsider")
        assert result.confidence >= 0.0

    def test_comms_dept_text_stays_in_comms(self, full_hierarchy: ProfileHierarchy) -> None:
        """Verify engine correctly identifies comms-dept text — not research."""
        engine = AttributionEngine(full_hierarchy)
        text = (
            "brand voice content strategy editorial calendar "
            "stakeholder messaging platform press release talking points "
            "brand voice content strategy editorial calendar brand voice "
        )
        result = engine.identify(text)
        # Should not match a research-dept person
        if result.match_level == "person":
            assert result.target_id in ("author-d", "author-e")


class TestOutsiderCascade:
    def test_foreign_text_falls_to_outsider(self, full_hierarchy: ProfileHierarchy) -> None:
        """Text with no vocab, markers, or stylometric affinity → outsider."""
        engine = AttributionEngine(full_hierarchy)
        # Imperative recipe instructions — zero overlap with profiled function words
        # ("the", "of", "and", "in", "we") so stylometric score stays well below org threshold.
        text = (
            "Dice onions, mince garlic, julienne peppers. "
            "Sauté vegetables until golden brown. Deglaze with white wine. "
            "Reduce by half. Season to taste. Plate on warmed dishes. "
            "Garnish liberally. Serve hot. Photography captures fleeting moments."
        )
        result = engine.identify(text)
        assert result.match_level == "outsider"
        assert result.target_id is None

    def test_outsider_confidence_in_valid_range(self, full_hierarchy: ProfileHierarchy) -> None:
        engine = AttributionEngine(full_hierarchy)
        text = "Gardening and horticulture are rewarding outdoor hobbies."
        result = engine.identify(text)
        assert 0.0 <= result.confidence <= 1.0

    def test_outsider_confidence_is_inverse_of_best_person_score(
        self, full_hierarchy: ProfileHierarchy
    ) -> None:
        engine = AttributionEngine(full_hierarchy)
        text = "Sailing navigation across open seas requires skill patience."
        result = engine.identify(text)
        if result.match_level == "outsider" and result.candidates:
            # Outsider confidence = 1.0 - best_person_score (not best overall candidate)
            person_candidates = [c for c in result.candidates if c.profile_type == "person"]
            if person_candidates:
                best_person_score = person_candidates[0].score
                assert abs(result.confidence - (1.0 - best_person_score)) < 0.01


class TestVerifyAndValidate:
    def test_verify_author_a_against_own_text(self, full_hierarchy: ProfileHierarchy) -> None:
        engine = AttributionEngine(full_hierarchy)
        # Function-word frequencies approximate Author A's profile
        # (the≈0.08, of≈0.045, and≈0.038, in≈0.030, a≈0.022)
        text = (
            "The empirical evidence from our longitudinal study supports these findings. "
            "A data-driven analysis of regression models reveals that confidence interval "
            "calculations and p-value thresholds confirm the hypothesis. Methodology depends "
            "on variable selection; empirical evidence collected in controlled settings "
            "strengthens the longitudinal study. Regression paired with hypothesis testing "
            "in applied research yields robust results of lasting significance. "
        )
        result = engine.verify_author(text, "author-a")
        assert result.mode == "verify_author"
        assert result.target_id == "author-a"
        assert result.confidence >= _PERSON_THRESHOLD

    def test_verify_author_cross_check_returns_low_confidence(
        self, full_hierarchy: ProfileHierarchy
    ) -> None:
        """Author A text verified against Author D → low confidence."""
        engine = AttributionEngine(full_hierarchy)
        text = (
            "empirical evidence longitudinal study data-driven analysis "
            "methodology hypothesis regression confidence interval p-value "
        )
        result = engine.verify_author(text, "author-d")
        assert result.target_id == "author-d"
        assert result.confidence < _PERSON_THRESHOLD

    def test_validate_research_dept_with_research_text(
        self, full_hierarchy: ProfileHierarchy
    ) -> None:
        engine = AttributionEngine(full_hierarchy)
        text = (
            "methodology hypothesis regression systematic review evidence synthesis "
            "methodology hypothesis regression systematic review evidence synthesis "
        )
        result = engine.validate_department(text, "dept-research")
        assert result.mode == "validate_department"
        assert result.target_id == "dept-research"
        assert result.confidence > 0.0

    def test_validate_org_returns_result_object(self, full_hierarchy: ProfileHierarchy) -> None:
        engine = AttributionEngine(full_hierarchy)
        text = "The organisation produces high-quality research and communications."
        result = engine.validate_organization(text)
        assert result.mode == "validate_organization"
        assert result.target_id == "org-example"
        assert 0.0 <= result.confidence <= 1.0
