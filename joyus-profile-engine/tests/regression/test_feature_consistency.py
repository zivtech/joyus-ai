"""Regression tests: feature extraction produces consistent, reproducible results."""

from __future__ import annotations

from pathlib import Path

import pytest

from joyus_profile.analyze.audience import AudienceAnalyzer
from joyus_profile.analyze.markers import MarkerAnalyzer
from joyus_profile.analyze.structure import StructureAnalyzer
from joyus_profile.analyze.stylometrics import StylometricAnalyzer
from joyus_profile.analyze.vocabulary import VocabularyAnalyzer
from joyus_profile.ingest.loader import CorpusLoader
from joyus_profile.ingest.preprocessor import Preprocessor

FIXTURES_DIR = Path(__file__).parent.parent.parent / "fixtures" / "example"


@pytest.fixture(scope="module")
def regression_corpus():
    """Load fixture corpus once for all regression tests."""
    loader = CorpusLoader()
    corpus = loader.load_directory(str(FIXTURES_DIR), formats=[".txt"])
    preprocessor = Preprocessor(min_chunk_words=50, max_chunk_words=500)
    return preprocessor.process(corpus)


class TestFeatureConsistency:
    """Feature extraction must be deterministic: same input -> same output."""

    def test_stylometric_deterministic(self, regression_corpus):
        analyzer = StylometricAnalyzer()
        r1 = analyzer.extract(regression_corpus)
        r2 = analyzer.extract(regression_corpus)
        assert r1.function_word_frequencies == r2.function_word_frequencies
        assert r1.sentence_length_stats == r2.sentence_length_stats
        assert r1.vocabulary_richness == r2.vocabulary_richness
        assert r1.punctuation_ratios == r2.punctuation_ratios
        assert r1.feature_count == r2.feature_count

    def test_marker_deterministic(self, regression_corpus):
        analyzer = MarkerAnalyzer()
        r1 = analyzer.extract(regression_corpus)
        r2 = analyzer.extract(regression_corpus)
        assert [m.text for m in r1.high_signal] == [m.text for m in r2.high_signal]
        assert [m.text for m in r1.medium_signal] == [m.text for m in r2.medium_signal]

    def test_vocabulary_deterministic(self, regression_corpus):
        analyzer = VocabularyAnalyzer()
        r1 = analyzer.extract(regression_corpus)
        r2 = analyzer.extract(regression_corpus)
        assert r1.preferred_terms == r2.preferred_terms

    def test_structure_deterministic(self, regression_corpus):
        analyzer = StructureAnalyzer()
        r1 = analyzer.extract(regression_corpus)
        r2 = analyzer.extract(regression_corpus)
        assert r1 == r2

    def test_audience_deterministic(self, regression_corpus):
        analyzer = AudienceAnalyzer()
        r1 = analyzer.extract(regression_corpus)
        r2 = analyzer.extract(regression_corpus)
        assert r1 == r2

    def test_all_analyzers_complete(self, regression_corpus):
        """All 5 analyzers run without error on the fixture corpus."""
        stylo = StylometricAnalyzer().extract(regression_corpus)
        markers = MarkerAnalyzer().extract(regression_corpus)
        vocab = VocabularyAnalyzer().extract(regression_corpus)
        structure = StructureAnalyzer().extract(regression_corpus)
        audience = AudienceAnalyzer().extract(regression_corpus)

        assert stylo.feature_count > 0
        assert len(markers.high_signal) + len(markers.medium_signal) > 0
        assert isinstance(vocab.preferred_terms, list)
        assert structure.avg_paragraph_length > 0
        assert 0.0 <= audience.formality_score <= 10.0
