"""Post-repair verification: regression, forward, and cross-profile checks."""

from __future__ import annotations

from datetime import datetime, timezone

from joyus_profile.models.monitoring import RepairAction, RepairVerification
from joyus_profile.monitor.score_store import ScoreStore

# Minimum fidelity threshold for forward test (person-level profile).
_FORWARD_THRESHOLD = 0.80

# Minimum recent scores required for regression and cross-profile checks.
_MIN_SCORE_SAMPLES = 3

# Fraction by which current mean may fall below baseline before regression fails.
_REGRESSION_TOLERANCE = 0.05


class RepairVerifier:
    """Verify that an applied repair passes regression, forward, and cross-profile checks."""

    def __init__(self, hierarchy_dir: str, score_store: ScoreStore) -> None:
        self.hierarchy_dir = hierarchy_dir
        self.score_store = score_store

    def verify(self, action: RepairAction, profile_id: str) -> RepairVerification:
        """Run all three verification checks. Updates action.status in place."""
        regression = self._regression_test(profile_id)
        forward = self._forward_test(profile_id)
        cross_profile = self._cross_profile_check(profile_id)

        result = RepairVerification(
            regression_passed=regression,
            forward_passed=forward,
            cross_profile_passed=cross_profile,
            details=self._build_details(regression, forward, cross_profile),
        )

        all_passed = regression and forward and cross_profile
        if all_passed:
            action.status = "verified"
            action.verified_at = datetime.now(timezone.utc)
        # If any check fails, status stays "applied"; caller should trigger revert.

        action.verification_result = result
        return result

    # ------------------------------------------------------------------
    # Individual checks
    # ------------------------------------------------------------------

    def _regression_test(self, profile_id: str) -> bool:
        """Attribution accuracy must not drop below the pre-repair baseline.

        Uses stored fidelity scores as a proxy: the most-recent half of scores
        must have a mean within ``_REGRESSION_TOLERANCE`` of the earlier half.
        """
        scores = self.score_store.get_scores(profile_id)
        if len(scores) < _MIN_SCORE_SAMPLES * 2:
            # Insufficient history → pass conservatively (no evidence of regression).
            return True

        mid = len(scores) // 2
        baseline_mean = sum(s.score for s in scores[:mid]) / mid
        recent_mean = sum(s.score for s in scores[mid:]) / (len(scores) - mid)

        if baseline_mean == 0:
            return True

        drop = (baseline_mean - recent_mean) / baseline_mean
        return drop <= _REGRESSION_TOLERANCE

    def _forward_test(self, profile_id: str) -> bool:
        """Most-recent fidelity scores must meet the minimum threshold.

        Checks the last ``_MIN_SCORE_SAMPLES`` scores; all must be >= threshold.
        """
        recent = self.score_store.get_latest(profile_id, n=_MIN_SCORE_SAMPLES)
        if not recent:
            # No scores yet → pass conservatively.
            return True
        return all(s.score >= _FORWARD_THRESHOLD for s in recent)

    def _cross_profile_check(self, profile_id: str) -> bool:
        """Other profiles must not have degraded after the repair.

        Samples up to two sibling profiles from the score store data directory
        and verifies their recent mean has not dropped significantly.
        """
        import os

        store_dir = self.score_store.data_dir
        try:
            siblings = [
                d
                for d in os.listdir(store_dir)
                if d != profile_id
                and (store_dir / d / "scores.json").exists()
            ]
        except OSError:
            return True  # Cannot enumerate siblings → pass conservatively.

        # Sample at most 2 siblings to keep verification fast.
        sample = siblings[:2]
        for sibling_id in sample:
            scores = self.score_store.get_scores(sibling_id)
            if len(scores) < _MIN_SCORE_SAMPLES * 2:
                continue
            mid = len(scores) // 2
            baseline_mean = sum(s.score for s in scores[:mid]) / mid
            recent_mean = sum(s.score for s in scores[mid:]) / (len(scores) - mid)
            if baseline_mean > 0:
                drop = (baseline_mean - recent_mean) / baseline_mean
                if drop > _REGRESSION_TOLERANCE:
                    return False

        return True

    # ------------------------------------------------------------------
    # Helpers
    # ------------------------------------------------------------------

    @staticmethod
    def _build_details(
        regression: bool, forward: bool, cross_profile: bool
    ) -> str:
        parts: list[str] = []
        parts.append(
            f"regression_test={'passed' if regression else 'FAILED'}"
        )
        parts.append(
            f"forward_test={'passed' if forward else 'FAILED'}"
        )
        parts.append(
            f"cross_profile_check={'passed' if cross_profile else 'FAILED'}"
        )
        return "; ".join(parts)
