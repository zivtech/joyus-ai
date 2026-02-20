"""Tests for ProfileGenerator."""

from __future__ import annotations

import pytest

from joyus_profile.models.corpus import Corpus, Document, DocumentMetadata, ProcessedCorpus
from joyus_profile.models.features import (
    AudienceProfile,
    MarkerSet,
    StylometricFeatures,
    StructuralPatterns,
    VocabularyProfile,
)
from joyus_profile.profile.generator import ProfileGenerator


class TestProfileBuild:
    def test_build_returns_complete_profile(self, small_corpus):
        gen = ProfileGenerator(domain="general")
        profile = gen.build(small_corpus, "Author A")
        assert profile.author_name == "Author A"
        assert profile.domain == "general"
        assert profile.corpus_size == small_corpus.corpus.total_documents
        assert profile.word_count == small_corpus.corpus.total_words
        assert profile.fidelity_tier >= 1
        assert 0.0 <= profile.confidence <= 1.0
        assert profile.profile_id  # non-empty CUID

    def test_build_populates_all_sections(self, small_corpus):
        gen = ProfileGenerator()
        profile = gen.build(small_corpus, "Author A")
        # All 12 sections should be present (even if defaults)
        assert profile.identity is not None
        assert profile.expertise is not None
        assert profile.positions is not None
        assert profile.voice is not None
        assert profile.structure is not None
        assert profile.vocabulary is not None
        assert profile.argumentation is not None
        assert profile.citations is not None
        assert profile.anti_patterns is not None
        assert profile.examples is not None
        assert profile.edge_cases is not None
        assert profile.validation is not None

    def test_build_stores_raw_features(self, small_corpus):
        gen = ProfileGenerator()
        profile = gen.build(small_corpus, "Author A")
        assert profile.stylometric_features is not None
        assert profile.markers is not None
        assert profile.audience is not None

    def test_voice_contexts_layer_0(self, small_corpus):
        """Layer 0: voice_contexts should be empty dict."""
        gen = ProfileGenerator()
        profile = gen.build(small_corpus, "Author A")
        assert profile.voice_contexts == {}


class TestBuildFromFeatures:
    def test_build_from_features_matches_build(self, small_corpus):
        """build_from_features with same inputs should produce equivalent profile."""
        from joyus_profile.analyze import (
            AudienceAnalyzer,
            MarkerAnalyzer,
            StructureAnalyzer,
            StylometricAnalyzer,
            VocabularyAnalyzer,
        )

        gen = ProfileGenerator()
        # Extract features manually
        stylo = StylometricAnalyzer().extract(small_corpus)
        markers = MarkerAnalyzer().extract(small_corpus)
        vocab = VocabularyAnalyzer().extract(small_corpus)
        structure = StructureAnalyzer().extract(small_corpus)
        audience = AudienceAnalyzer().extract(small_corpus)

        profile = gen.build_from_features(
            author_name="Author A",
            corpus=small_corpus,
            stylometric_features=stylo,
            markers=markers,
            vocabulary=vocab,
            structure=structure,
            audience=audience,
        )
        assert profile.author_name == "Author A"
        assert profile.corpus_size == small_corpus.corpus.total_documents
        assert profile.vocabulary == vocab
        assert profile.structure == structure

    def test_build_from_features_without_corpus(self):
        """Should work with just features, no corpus reference."""
        gen = ProfileGenerator()
        profile = gen.build_from_features(
            author_name="Author B",
            vocabulary=VocabularyProfile(preferred_terms=["thus", "hence"]),
            audience=AudienceProfile(formality_score=8.0, primary_register="formal"),
        )
        assert profile.author_name == "Author B"
        assert profile.corpus_size == 0
        assert profile.voice.formality == 8.0


class TestDomainWeighting:
    def test_legal_domain_weights(self, small_corpus):
        gen = ProfileGenerator(domain="legal_advocacy")
        profile = gen.build(small_corpus, "Author A")
        assert profile.domain == "legal_advocacy"
        # Legal domain should have edge cases from template register hints
        assert len(profile.edge_cases) > 0

    def test_general_domain_balanced(self, small_corpus):
        gen = ProfileGenerator(domain="general")
        profile = gen.build(small_corpus, "Author A")
        assert profile.domain == "general"

    def test_unknown_domain_falls_back(self, small_corpus):
        gen = ProfileGenerator(domain="nonexistent_domain")
        profile = gen.build(small_corpus, "Author A")
        # Should fall back to general template without error
        assert profile.domain == "nonexistent_domain"
        assert profile.fidelity_tier >= 1


class TestFidelityTier:
    def test_tier_1_small_corpus(self):
        gen = ProfileGenerator()
        assert gen._determine_tier(5_000) == 1

    def test_tier_2_medium_corpus(self):
        gen = ProfileGenerator()
        assert gen._determine_tier(10_000) == 2

    def test_tier_3_large_corpus(self):
        gen = ProfileGenerator()
        assert gen._determine_tier(50_000) == 3

    def test_tier_4_very_large_corpus(self):
        gen = ProfileGenerator()
        assert gen._determine_tier(100_000) == 4


class TestConfidenceScoring:
    def test_small_corpus_low_confidence(self):
        gen = ProfileGenerator()
        conf = gen._compute_confidence(5, 2_000, None)
        assert 0.45 <= conf <= 0.60

    def test_medium_corpus_moderate_confidence(self):
        gen = ProfileGenerator()
        conf = gen._compute_confidence(20, 30_000, None)
        assert 0.80 <= conf <= 0.95

    def test_large_corpus_high_confidence(self):
        gen = ProfileGenerator()
        conf = gen._compute_confidence(50, 100_000, None)
        assert conf >= 0.90

    def test_high_variance_reduces_confidence(self):
        gen = ProfileGenerator()
        from joyus_profile.models.features import SentenceLengthStats

        # High CV (std/mean > 1.5) should penalize
        features = StylometricFeatures(
            sentence_length_stats=SentenceLengthStats(mean=10.0, std=20.0),
        )
        conf_high_var = gen._compute_confidence(20, 30_000, features)
        conf_normal = gen._compute_confidence(20, 30_000, None)
        assert conf_high_var < conf_normal

    def test_confidence_floor(self):
        gen = ProfileGenerator()
        conf = gen._compute_confidence(1, 100, None)
        assert conf >= 0.5
