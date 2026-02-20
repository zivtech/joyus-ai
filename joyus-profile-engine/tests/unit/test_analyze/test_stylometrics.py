"""Tests for StylometricAnalyzer."""

from __future__ import annotations

import pytest

from joyus_profile.analyze.stylometrics import StylometricAnalyzer
from joyus_profile.models.corpus import Corpus, Document, DocumentMetadata, ProcessedCorpus


class TestStylometricExtraction:
    def test_extracts_features_from_corpus(self, analysis_corpus):
        analyzer = StylometricAnalyzer()
        features = analyzer.extract(analysis_corpus)
        assert features.feature_count > 0
        assert len(features.function_word_frequencies) > 0

    def test_sentence_stats_populated(self, analysis_corpus):
        analyzer = StylometricAnalyzer()
        features = analyzer.extract(analysis_corpus)
        stats = features.sentence_length_stats
        assert stats.mean > 0
        assert stats.min >= 1
        assert stats.max >= stats.min

    def test_vocabulary_richness(self, analysis_corpus):
        analyzer = StylometricAnalyzer()
        features = analyzer.extract(analysis_corpus)
        vr = features.vocabulary_richness
        assert 0 < vr.type_token_ratio <= 1.0
        assert vr.hapax_legomena_ratio >= 0
        assert vr.yules_k >= 0

    def test_punctuation_ratios(self, analysis_corpus):
        analyzer = StylometricAnalyzer()
        features = analyzer.extract(analysis_corpus)
        assert len(features.punctuation_ratios) > 0
        # Period should be present
        assert "." in features.punctuation_ratios

    def test_character_ngrams_top_100(self, analysis_corpus):
        analyzer = StylometricAnalyzer()
        features = analyzer.extract(analysis_corpus)
        assert len(features.character_ngrams) > 0
        assert len(features.character_ngrams) <= 100

    def test_pos_ngrams(self, analysis_corpus):
        analyzer = StylometricAnalyzer()
        features = analyzer.extract(analysis_corpus)
        assert len(features.pos_ngrams) > 0
        # POS bigrams should use underscore separator
        for key in features.pos_ngrams:
            assert "_" in key

    def test_small_corpus(self, small_corpus):
        analyzer = StylometricAnalyzer()
        features = analyzer.extract(small_corpus)
        assert features.feature_count > 50  # Should have many features even from small corpus

    def test_deterministic(self, small_corpus):
        """Same input should produce same output."""
        analyzer = StylometricAnalyzer()
        f1 = analyzer.extract(small_corpus)
        f2 = analyzer.extract(small_corpus)
        assert f1.function_word_frequencies == f2.function_word_frequencies
        assert f1.sentence_length_stats == f2.sentence_length_stats
