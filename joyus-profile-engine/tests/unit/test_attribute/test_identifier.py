"""Tests for AuthorIdentifier."""

from __future__ import annotations

from joyus_profile.attribute.identifier import AuthorIdentifier

from .conftest import AUTHOR_A_TEXT, AUTHOR_B_TEXT, OUTSIDER_TEXT


class TestAuthorIdentifier:
    def test_returns_ranked_candidates(self, two_author_hierarchy):
        identifier = AuthorIdentifier()
        result = identifier.identify(AUTHOR_A_TEXT, two_author_hierarchy)

        scores = [c.score for c in result.candidates]
        assert scores == sorted(scores, reverse=True)

    def test_top_candidate_matches_author_a(self, two_author_hierarchy):
        identifier = AuthorIdentifier()
        result = identifier.identify(AUTHOR_A_TEXT, two_author_hierarchy)

        assert result.candidates[0].profile_id == "author-a"

    def test_top_candidate_matches_author_b(self, two_author_hierarchy):
        identifier = AuthorIdentifier()
        result = identifier.identify(AUTHOR_B_TEXT, two_author_hierarchy)

        assert result.candidates[0].profile_id == "author-b"

    def test_returns_at_most_10_candidates(self, two_author_hierarchy):
        identifier = AuthorIdentifier()
        result = identifier.identify(AUTHOR_A_TEXT, two_author_hierarchy)

        assert len(result.candidates) <= 10

    def test_match_level_set_when_threshold_exceeded(self, two_author_hierarchy):
        identifier = AuthorIdentifier()
        result = identifier.identify(AUTHOR_A_TEXT, two_author_hierarchy)

        # With strong marker/vocab text the threshold should be exceeded
        assert result.match_level == "person"
        assert result.target_id == "author-a"

    def test_match_level_none_for_outsider_text(self, two_author_hierarchy):
        identifier = AuthorIdentifier()
        result = identifier.identify(OUTSIDER_TEXT, two_author_hierarchy)

        assert result.match_level is None
        assert result.target_id is None

    def test_explanation_tier_pattern(self, two_author_hierarchy):
        identifier = AuthorIdentifier()
        result = identifier.identify(AUTHOR_A_TEXT, two_author_hierarchy, explanation_tier="pattern")

        assert result.explanation_tier == "pattern"

    def test_explanation_tier_passage_includes_markers(self, two_author_hierarchy):
        identifier = AuthorIdentifier()
        result = identifier.identify(AUTHOR_A_TEXT, two_author_hierarchy, explanation_tier="passage")

        assert result.explanation_tier == "passage"
        # When there are matched markers the explanation should mention them
        best = result.candidates[0]
        if best.matched_markers:
            assert "Matched markers" in result.explanation

    def test_mode_is_identify(self, two_author_hierarchy):
        identifier = AuthorIdentifier()
        result = identifier.identify(AUTHOR_A_TEXT, two_author_hierarchy)

        assert result.mode == "identify"

    def test_result_has_text_hash(self, two_author_hierarchy):
        identifier = AuthorIdentifier()
        result = identifier.identify(AUTHOR_A_TEXT, two_author_hierarchy)

        assert len(result.text_hash) == 16
