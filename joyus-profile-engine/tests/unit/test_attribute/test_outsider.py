"""Tests for OutsiderDetector."""

from __future__ import annotations

from joyus_profile.attribute.outsider import OutsiderDetector

from .conftest import AUTHOR_A_TEXT, OUTSIDER_TEXT


class TestOutsiderDetector:
    def test_detects_outsider_text(self, two_author_hierarchy):
        detector = OutsiderDetector()
        result = detector.detect(OUTSIDER_TEXT, two_author_hierarchy)

        assert result.match_level == "outsider"

    def test_outsider_confidence_is_inverse_of_best_score(self, two_author_hierarchy):
        detector = OutsiderDetector()
        result = detector.detect(OUTSIDER_TEXT, two_author_hierarchy)

        assert result.match_level == "outsider"
        if result.candidates:
            best_score = result.candidates[0].score
            expected_confidence = round(1.0 - best_score, 4)
            assert abs(result.confidence - expected_confidence) < 0.01

    def test_outsider_confidence_range(self, two_author_hierarchy):
        detector = OutsiderDetector()
        result = detector.detect(OUTSIDER_TEXT, two_author_hierarchy)

        assert 0.0 <= result.confidence <= 1.0

    def test_non_outsider_text_not_flagged(self, two_author_hierarchy):
        detector = OutsiderDetector()
        result = detector.detect(AUTHOR_A_TEXT, two_author_hierarchy)

        # Strong author-a text should not be outsider
        assert result.match_level != "outsider"

    def test_outsider_result_has_explanation(self, two_author_hierarchy):
        detector = OutsiderDetector()
        result = detector.detect(OUTSIDER_TEXT, two_author_hierarchy)

        assert "outsider" in result.explanation.lower()

    def test_outsider_result_mode(self, two_author_hierarchy):
        detector = OutsiderDetector()
        result = detector.detect(OUTSIDER_TEXT, two_author_hierarchy)

        # OutsiderDetector wraps AttributionEngine.identify which sets mode="identify"
        assert result.mode == "identify"

    def test_outsider_target_id_is_none(self, two_author_hierarchy):
        detector = OutsiderDetector()
        result = detector.detect(OUTSIDER_TEXT, two_author_hierarchy)

        assert result.target_id is None
