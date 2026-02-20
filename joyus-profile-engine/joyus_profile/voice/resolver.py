"""VoiceResolver: applies per-audience voice overrides to an AuthorProfile."""

from __future__ import annotations

from pydantic import BaseModel

from joyus_profile.models.features import VocabularyProfile
from joyus_profile.models.hierarchy import ProfileHierarchy
from joyus_profile.models.profile import (
    AntiPatterns,
    AuthorProfile,
    VoiceContext,
)


class ResolvedProfile(BaseModel):
    """Result of voice resolution — merged profile + metadata."""

    profile: AuthorProfile
    voice_key: str | None = None
    tier: str = "standard"


class VoiceResolver:
    """Resolves a profile for a given audience key, applying voice overrides."""

    def resolve(
        self,
        profile: AuthorProfile,
        audience_key: str | None = None,
        hierarchy: ProfileHierarchy | None = None,
    ) -> ResolvedProfile:
        """Resolve the profile for the given audience.

        Layer 0: No audience_key — base profile returned unchanged (modulo org overrides).
        Layer 1: audience_key present — apply voice_contexts[audience_key] overrides.
        Layer 2: Access checking is handled separately by AccessChecker.
        """
        if audience_key is None:
            resolved = profile.model_copy(deep=True)
            if hierarchy is not None:
                resolved = self._apply_org_overrides(resolved, hierarchy)
            return ResolvedProfile(profile=resolved, voice_key=None, tier="standard")

        vc = profile.voice_contexts.get(audience_key)
        if vc is None:
            raise ValueError(
                f"Voice key '{audience_key}' not found in profile '{profile.profile_id}'"
            )

        resolved = self._apply_voice_context(profile, vc)
        if hierarchy is not None:
            resolved = self._apply_org_overrides(resolved, hierarchy)

        tier = _fidelity_tier_label(vc.fidelity_tier)
        return ResolvedProfile(profile=resolved, voice_key=audience_key, tier=tier)

    # ------------------------------------------------------------------
    # Private helpers
    # ------------------------------------------------------------------

    def _apply_voice_context(
        self, profile: AuthorProfile, vc: VoiceContext
    ) -> AuthorProfile:
        """Build a deep copy of profile with all non-None overrides applied."""
        copy = profile.model_copy(deep=True)

        if vc.voice_override is not None:
            copy.voice = vc.voice_override.model_copy(deep=True)

        if vc.vocabulary_override is not None:
            copy.vocabulary = self._merge_vocabulary(copy.vocabulary, vc.vocabulary_override)

        if vc.argumentation_override is not None:
            copy.argumentation = vc.argumentation_override.model_copy(deep=True)

        if vc.citations_override is not None:
            copy.citations = vc.citations_override.model_copy(deep=True)

        if vc.structure_override is not None:
            copy.structure = vc.structure_override.model_copy(deep=True)

        if vc.positions_override is not None:
            copy.positions = [p.model_copy(deep=True) for p in vc.positions_override]

        if vc.examples_override is not None:
            copy.examples = vc.examples_override.model_copy(deep=True)

        if vc.anti_patterns_override is not None:
            copy.anti_patterns = self._merge_anti_patterns(
                copy.anti_patterns, vc.anti_patterns_override
            )

        return copy

    def _merge_vocabulary(
        self, base: VocabularyProfile, override: VocabularyProfile
    ) -> VocabularyProfile:
        """Union merge: override adds terms, does not remove base terms."""
        return VocabularyProfile(
            signature_phrases=_union(base.signature_phrases, override.signature_phrases),
            preferred_terms=_union(base.preferred_terms, override.preferred_terms),
            avoided_terms=_union(base.avoided_terms, override.avoided_terms),
            technical_terms=_union(base.technical_terms, override.technical_terms),
        )

    def _merge_anti_patterns(
        self, base: AntiPatterns, override: AntiPatterns
    ) -> AntiPatterns:
        """Union of both sets — more restrictive (both sets retained)."""
        return AntiPatterns(
            never_do=_union(base.never_do, override.never_do),
            common_ai_mistakes=_union(base.common_ai_mistakes, override.common_ai_mistakes),
            prohibited_phrases=_union(base.prohibited_phrases, override.prohibited_phrases),
        )

    def _apply_org_overrides(
        self, profile: AuthorProfile, hierarchy: ProfileHierarchy
    ) -> AuthorProfile:
        """Apply org-level prohibited framings via hierarchy.effective_prohibited_framings()."""
        framings = hierarchy.effective_prohibited_framings()
        if not framings:
            return profile

        extra_phrases = [f.text for f in framings]
        merged = AntiPatterns(
            never_do=profile.anti_patterns.never_do,
            common_ai_mistakes=profile.anti_patterns.common_ai_mistakes,
            prohibited_phrases=_union(profile.anti_patterns.prohibited_phrases, extra_phrases),
        )
        profile.anti_patterns = merged
        return profile


# ------------------------------------------------------------------
# Module-level utilities
# ------------------------------------------------------------------


def _union(base: list[str], extra: list[str]) -> list[str]:
    """Return base + items in extra not already in base (order-preserving)."""
    seen = set(base)
    result = list(base)
    for item in extra:
        if item not in seen:
            seen.add(item)
            result.append(item)
    return result


def _fidelity_tier_label(tier_int: int) -> str:
    labels = {1: "standard", 2: "enhanced", 3: "high", 4: "premium"}
    return labels.get(tier_int, "standard")
