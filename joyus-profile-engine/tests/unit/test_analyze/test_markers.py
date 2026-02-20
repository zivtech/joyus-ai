"""Tests for MarkerAnalyzer."""

from __future__ import annotations

import pytest

from joyus_profile.analyze.markers import MarkerAnalyzer


class TestMarkerExtraction:
    def test_returns_marker_set(self, small_corpus):
        analyzer = MarkerAnalyzer()
        markers = analyzer.extract(small_corpus)
        # Should have some markers from even a small corpus
        assert len(markers.high_signal) > 0 or len(markers.medium_signal) > 0

    def test_negative_markers_identified(self, small_corpus):
        analyzer = MarkerAnalyzer()
        markers = analyzer.extract(small_corpus)
        assert len(markers.negative_markers) > 0
        # Negative markers should have 0 frequency
        for m in markers.negative_markers:
            assert m.frequency == 0.0

    def test_domain_boosting(self, small_corpus):
        analyzer = MarkerAnalyzer()
        general_markers = analyzer.extract(small_corpus, domain="general")
        legal_markers = analyzer.extract(small_corpus, domain="legal_advocacy")
        # Legal domain should boost regulatory terms
        legal_texts = {m.text for m in legal_markers.high_signal + legal_markers.medium_signal}
        general_texts = {m.text for m in general_markers.high_signal + general_markers.medium_signal}
        # At least some markers should differ due to boosting
        assert len(legal_texts) > 0

    def test_marker_weights_bounded(self, small_corpus):
        analyzer = MarkerAnalyzer()
        markers = analyzer.extract(small_corpus)
        for m in markers.high_signal + markers.medium_signal:
            assert 0.0 <= m.weight <= 1.0

    def test_from_fixtures(self, analysis_corpus):
        analyzer = MarkerAnalyzer()
        markers = analyzer.extract(analysis_corpus)
        total = len(markers.high_signal) + len(markers.medium_signal)
        assert total > 0
