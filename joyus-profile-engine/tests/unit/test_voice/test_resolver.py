"""Tests for VoiceResolver."""

from __future__ import annotations

import pytest

from joyus_profile.models.hierarchy import ProfileHierarchy
from joyus_profile.models.profile import AuthorProfile
from joyus_profile.voice.resolver import VoiceResolver


@pytest.fixture()
def resolver() -> VoiceResolver:
    return VoiceResolver()


class TestLayer0:
    """No audience_key — base profile returned unchanged."""

    def test_no_audience_key_returns_base_profile(
        self, resolver: VoiceResolver, layer_0_profile: AuthorProfile
    ) -> None:
        result = resolver.resolve(layer_0_profile)
        assert result.voice_key is None
        assert result.profile.profile_id == layer_0_profile.profile_id
        assert result.profile.author_name == layer_0_profile.author_name

    def test_no_audience_key_voice_unchanged(
        self, resolver: VoiceResolver, layer_0_profile: AuthorProfile
    ) -> None:
        result = resolver.resolve(layer_0_profile)
        assert result.profile.voice.formality == layer_0_profile.voice.formality
        assert result.profile.voice.complexity == layer_0_profile.voice.complexity

    def test_no_audience_key_vocabulary_unchanged(
        self, resolver: VoiceResolver, layer_0_profile: AuthorProfile
    ) -> None:
        result = resolver.resolve(layer_0_profile)
        assert result.profile.vocabulary.signature_phrases == ["base phrase"]
        assert result.profile.vocabulary.preferred_terms == ["base term"]

    def test_no_audience_key_tier_is_standard(
        self, resolver: VoiceResolver, layer_0_profile: AuthorProfile
    ) -> None:
        result = resolver.resolve(layer_0_profile)
        assert result.tier == "standard"

    def test_result_is_deep_copy(
        self, resolver: VoiceResolver, layer_0_profile: AuthorProfile
    ) -> None:
        result = resolver.resolve(layer_0_profile)
        result.profile.vocabulary.preferred_terms.append("mutated")
        assert "mutated" not in layer_0_profile.vocabulary.preferred_terms


class TestLayer1:
    """audience_key present — voice overrides applied correctly."""

    def test_voice_override_applied(
        self, resolver: VoiceResolver, layer_1_profile: AuthorProfile
    ) -> None:
        result = resolver.resolve(layer_1_profile, audience_key="formal")
        assert result.profile.voice.formality == 9.0
        assert result.profile.voice.complexity == 8.0
        assert result.voice_key == "formal"

    def test_tier_label_reflects_fidelity(
        self, resolver: VoiceResolver, layer_1_profile: AuthorProfile
    ) -> None:
        result = resolver.resolve(layer_1_profile, audience_key="formal")
        assert result.tier == "high"  # fidelity_tier=3

    def test_accessible_voice_override_applied(
        self, resolver: VoiceResolver, layer_1_profile: AuthorProfile
    ) -> None:
        result = resolver.resolve(layer_1_profile, audience_key="accessible")
        assert result.profile.voice.formality == 4.0
        assert result.profile.voice.emotion == 7.0

    def test_partial_override_keeps_base_vocabulary(
        self, resolver: VoiceResolver, layer_1_profile: AuthorProfile
    ) -> None:
        """accessible voice has no vocabulary_override — base vocabulary must remain."""
        result = resolver.resolve(layer_1_profile, audience_key="accessible")
        assert "base phrase" in result.profile.vocabulary.signature_phrases
        assert "base term" in result.profile.vocabulary.preferred_terms

    def test_partial_override_applies_argumentation(
        self, resolver: VoiceResolver, layer_1_profile: AuthorProfile
    ) -> None:
        result = resolver.resolve(layer_1_profile, audience_key="accessible")
        assert "anecdote" in result.profile.argumentation.evidence_types
        assert "analogy" in result.profile.argumentation.reasoning_patterns

    def test_nonexistent_voice_raises_value_error(
        self, resolver: VoiceResolver, layer_1_profile: AuthorProfile
    ) -> None:
        with pytest.raises(ValueError, match="Voice key 'nonexistent'"):
            resolver.resolve(layer_1_profile, audience_key="nonexistent")


class TestVocabularyMerge:
    """Vocabulary merge is union — override adds, does not remove base terms."""

    def test_vocabulary_union_adds_override_terms(
        self, resolver: VoiceResolver, layer_1_profile: AuthorProfile
    ) -> None:
        result = resolver.resolve(layer_1_profile, audience_key="formal")
        vocab = result.profile.vocabulary
        # Base terms preserved
        assert "base phrase" in vocab.signature_phrases
        assert "base term" in vocab.preferred_terms
        # Override terms added
        assert "formal phrase" in vocab.signature_phrases
        assert "formal term" in vocab.preferred_terms

    def test_vocabulary_union_no_duplicates(
        self, resolver: VoiceResolver, layer_1_profile: AuthorProfile
    ) -> None:
        result = resolver.resolve(layer_1_profile, audience_key="formal")
        vocab = result.profile.vocabulary
        assert vocab.signature_phrases.count("base phrase") == 1

    def test_technical_voice_vocabulary_union(
        self, resolver: VoiceResolver, layer_1_profile: AuthorProfile
    ) -> None:
        result = resolver.resolve(layer_1_profile, audience_key="technical")
        vocab = result.profile.vocabulary
        assert "base phrase" in vocab.signature_phrases
        assert "technical phrase" in vocab.signature_phrases
        assert "api" in vocab.technical_terms
        assert "base tech" in vocab.technical_terms


class TestAntiPatternsMerge:
    """Anti-patterns merge is union — both sets retained (more restrictive)."""

    def test_anti_patterns_union_never_do(
        self, resolver: VoiceResolver, layer_1_profile: AuthorProfile
    ) -> None:
        result = resolver.resolve(layer_1_profile, audience_key="formal")
        ap = result.profile.anti_patterns
        assert "never base" in ap.never_do
        assert "never formal" in ap.never_do

    def test_anti_patterns_union_prohibited_phrases(
        self, resolver: VoiceResolver, layer_1_profile: AuthorProfile
    ) -> None:
        result = resolver.resolve(layer_1_profile, audience_key="formal")
        ap = result.profile.anti_patterns
        assert "prohibited base" in ap.prohibited_phrases
        assert "prohibited formal" in ap.prohibited_phrases


class TestOrgOverrides:
    """Org prohibited framings applied when hierarchy is provided."""

    def test_org_prohibited_framings_added(
        self,
        resolver: VoiceResolver,
        layer_0_profile: AuthorProfile,
        sample_hierarchy: ProfileHierarchy,
    ) -> None:
        result = resolver.resolve(layer_0_profile, hierarchy=sample_hierarchy)
        phrases = result.profile.anti_patterns.prohibited_phrases
        assert "org banned phrase" in phrases
        assert "org restricted term" in phrases

    def test_org_framings_combined_with_voice_override(
        self,
        resolver: VoiceResolver,
        layer_1_profile: AuthorProfile,
        sample_hierarchy: ProfileHierarchy,
    ) -> None:
        result = resolver.resolve(
            layer_1_profile, audience_key="formal", hierarchy=sample_hierarchy
        )
        phrases = result.profile.anti_patterns.prohibited_phrases
        assert "prohibited base" in phrases
        assert "prohibited formal" in phrases
        assert "org banned phrase" in phrases

    def test_no_hierarchy_no_org_phrases(
        self, resolver: VoiceResolver, layer_1_profile: AuthorProfile
    ) -> None:
        result = resolver.resolve(layer_1_profile, audience_key="formal")
        phrases = result.profile.anti_patterns.prohibited_phrases
        assert "org banned phrase" not in phrases

    def test_base_prohibited_phrases_preserved_with_hierarchy(
        self,
        resolver: VoiceResolver,
        layer_0_profile: AuthorProfile,
        sample_hierarchy: ProfileHierarchy,
    ) -> None:
        result = resolver.resolve(layer_0_profile, hierarchy=sample_hierarchy)
        phrases = result.profile.anti_patterns.prohibited_phrases
        assert "prohibited base" in phrases
