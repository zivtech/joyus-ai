"""Outsider detection: flag text that doesn't match any known profile."""

from __future__ import annotations

from joyus_profile.models.attribution import AttributionResult
from joyus_profile.models.hierarchy import ProfileHierarchy

from .cascade import AttributionEngine


class OutsiderDetector:
    """Detect whether text originates from outside the known profile hierarchy."""

    def detect(self, text: str, hierarchy: ProfileHierarchy) -> AttributionResult:
        """Run full cascade attribution and determine if text is from an outsider.

        If the cascade returns ``match_level == "outsider"``, the confidence
        is set to ``1.0 - best_candidate_score`` (higher means more certainly
        an outsider).

        Args:
            text: Text to evaluate.
            hierarchy: Full profile hierarchy to match against.

        Returns:
            AttributionResult. When ``match_level == "outsider"`` the result
            indicates external authorship with ``confidence`` reflecting how
            strongly no known profile matched.
        """
        engine = AttributionEngine(hierarchy)
        result = engine.identify(text)

        if result.match_level == "outsider":
            # Recompute confidence as inverse of the best candidate score
            best_score = (
                result.candidates[0].score if result.candidates else 0.0
            )
            result = result.model_copy(
                update={
                    "confidence": round(1.0 - best_score, 4),
                    "explanation": (
                        result.explanation
                        + f" Outsider confidence: {1.0 - best_score:.3f}."
                    ),
                }
            )

        return result
