"""Author identifier: person-level attribution from a hierarchy."""

from __future__ import annotations

from cuid2 import cuid_wrapper

from joyus_profile.models.attribution import AttributionResult
from joyus_profile.models.hierarchy import ProfileHierarchy

from .cascade import _PERSON_THRESHOLD, _hash_text, _score_person_profile

_cuid = cuid_wrapper()


class AuthorIdentifier:
    """Person-level identification (no cascade) against a profile hierarchy."""

    def identify(
        self,
        text: str,
        hierarchy: ProfileHierarchy,
        explanation_tier: str = "pattern",
    ) -> AttributionResult:
        """Score text against ALL person profiles and return ranked results.

        Args:
            text: The text to identify.
            hierarchy: The full profile hierarchy.
            explanation_tier: ``"pattern"`` (safe for any user) or ``"passage"``
                (may include source text snippets).

        Returns:
            AttributionResult with candidates sorted by score descending (top 10).
        """
        text_hash = _hash_text(text)

        candidates = [
            _score_person_profile(text, profile)
            for profile in hierarchy.people.values()
        ]
        candidates.sort(key=lambda c: c.score, reverse=True)
        top = candidates[:10]

        best = top[0] if top else None
        if best and best.score >= _PERSON_THRESHOLD:
            match_level = "person"
            confidence = best.score
            explanation = (
                f"Best match: '{best.profile_id}' with score {best.score:.3f}."
            )
            if explanation_tier == "passage":
                markers_preview = ", ".join(best.matched_markers[:5])
                if markers_preview:
                    explanation += f" Matched markers: {markers_preview}."
        else:
            match_level = None
            confidence = best.score if best else 0.0
            explanation = (
                "No person profile exceeded the identification threshold "
                f"({_PERSON_THRESHOLD})."
            )

        return AttributionResult(
            result_id=_cuid(),
            text_hash=text_hash,
            mode="identify",
            match_level=match_level,
            target_id=best.profile_id if (best and match_level) else None,
            candidates=top,
            confidence=round(confidence, 4),
            explanation_tier=explanation_tier,
            explanation=explanation,
        )
