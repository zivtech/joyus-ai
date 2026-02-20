"""Five drift detection signals for fidelity monitoring."""

from __future__ import annotations

import statistics
from datetime import datetime, timedelta, timezone

from cuid2 import cuid_wrapper

from joyus_profile.models.monitoring import DriftConfig, DriftSignal
from joyus_profile.models.verification import FidelityScore
from joyus_profile.monitor.score_store import ScoreStore

_cuid = cuid_wrapper()


class DriftDetector:
    """Run five drift checks against stored fidelity scores for a profile.

    Signals:
        1. fidelity_decline  -- rolling average drops > threshold %
        2. marker_shift      -- marker_score drops > threshold %
        3. stylometric_distance -- function_words feature drifts > multiplier * std
        4. negative_increase -- prohibited framings appear (zero tolerance)
        5. inconsistency     -- variance exceeds multiplier * historical variance
    """

    def __init__(self, score_store: ScoreStore, config: DriftConfig) -> None:
        self.score_store = score_store
        self.config = config

    def check(self, profile_id: str) -> list[DriftSignal]:
        """Run all five drift checks. Returns detected signals (empty = no drift)."""
        now = datetime.now(timezone.utc)
        scores = self.score_store.get_scores(
            profile_id,
            window_start=now - timedelta(days=self.config.window_days),
        )
        if len(scores) < self.config.min_samples:
            return []

        signals: list[DriftSignal] = []
        signals.extend(self._check_fidelity_decline(profile_id, scores))
        signals.extend(self._check_marker_shift(profile_id, scores))
        signals.extend(self._check_stylometric_distance(profile_id, scores))
        signals.extend(self._check_negative_increase(profile_id, scores))
        signals.extend(self._check_inconsistency(profile_id, scores))
        return signals

    # ------------------------------------------------------------------
    # Signal 1: Fidelity decline
    # ------------------------------------------------------------------

    def _check_fidelity_decline(
        self, profile_id: str, scores: list[FidelityScore]
    ) -> list[DriftSignal]:
        """Rolling average of overall scores dropping > threshold %."""
        if len(scores) < 4:
            return []

        mid = len(scores) // 2
        first_half = [s.score for s in scores[:mid]]
        second_half = [s.score for s in scores[mid:]]

        baseline = statistics.mean(first_half)
        current = statistics.mean(second_half)

        if baseline == 0:
            return []

        decline = (baseline - current) / baseline
        if decline > self.config.fidelity_decline_pct:
            return [
                DriftSignal(
                    signal_id=_cuid(),
                    profile_id=profile_id,
                    signal_type="fidelity_decline",
                    severity=self._severity_for_decline(decline),
                    current_value=round(current, 4),
                    baseline_value=round(baseline, 4),
                    deviation=round(decline, 4),
                    window_start=scores[0].timestamp,
                    window_end=scores[-1].timestamp,
                    sample_count=len(scores),
                )
            ]
        return []

    # ------------------------------------------------------------------
    # Signal 2: Marker shift
    # ------------------------------------------------------------------

    def _check_marker_shift(
        self, profile_id: str, scores: list[FidelityScore]
    ) -> list[DriftSignal]:
        """Marker usage dropped > threshold %."""
        marker_scores = [s.marker_score for s in scores if s.marker_score > 0]
        if len(marker_scores) < 4:
            return []

        mid = len(marker_scores) // 2
        baseline = statistics.mean(marker_scores[:mid])
        current = statistics.mean(marker_scores[mid:])

        if baseline == 0:
            return []

        drop = (baseline - current) / baseline
        if drop > self.config.marker_shift_pct:
            return [
                DriftSignal(
                    signal_id=_cuid(),
                    profile_id=profile_id,
                    signal_type="marker_shift",
                    severity="medium" if drop < 0.4 else "high",
                    current_value=round(current, 4),
                    baseline_value=round(baseline, 4),
                    deviation=round(drop, 4),
                    window_start=scores[0].timestamp,
                    window_end=scores[-1].timestamp,
                    sample_count=len(marker_scores),
                )
            ]
        return []

    # ------------------------------------------------------------------
    # Signal 3: Stylometric distance
    # ------------------------------------------------------------------

    def _check_stylometric_distance(
        self, profile_id: str, scores: list[FidelityScore]
    ) -> list[DriftSignal]:
        """Function-word feature drifting beyond multiplier * self-distance std."""
        fw_values = [
            s.feature_breakdown.get("function_words", 0.0)
            for s in scores
            if s.feature_breakdown.get("function_words") is not None
        ]
        if len(fw_values) < 4:
            return []

        mid = len(fw_values) // 2
        baseline_vals = fw_values[:mid]
        current_vals = fw_values[mid:]

        baseline_mean = statistics.mean(baseline_vals)
        baseline_std = statistics.stdev(baseline_vals) if len(baseline_vals) > 1 else 0.0
        current_mean = statistics.mean(current_vals)

        if baseline_std == 0:
            return []

        distance = abs(current_mean - baseline_mean) / baseline_std
        if distance > self.config.stylometric_multiplier:
            return [
                DriftSignal(
                    signal_id=_cuid(),
                    profile_id=profile_id,
                    signal_type="stylometric_distance",
                    severity="medium" if distance < 2.5 else "high",
                    current_value=round(current_mean, 4),
                    baseline_value=round(baseline_mean, 4),
                    deviation=round(distance, 4),
                    window_start=scores[0].timestamp,
                    window_end=scores[-1].timestamp,
                    sample_count=len(fw_values),
                )
            ]
        return []

    # ------------------------------------------------------------------
    # Signal 4: Negative increase (prohibited framings)
    # ------------------------------------------------------------------

    def _check_negative_increase(
        self, profile_id: str, scores: list[FidelityScore]
    ) -> list[DriftSignal]:
        """Any prohibited framing appearance when zero-tolerance is enabled."""
        if not self.config.negative_zero_tolerance:
            return []

        for s in scores:
            neg_val = s.feature_breakdown.get("negative_markers", 0.0)
            if neg_val > 0:
                return [
                    DriftSignal(
                        signal_id=_cuid(),
                        profile_id=profile_id,
                        signal_type="negative_increase",
                        severity="critical",
                        current_value=round(neg_val, 4),
                        baseline_value=0.0,
                        deviation=round(neg_val, 4),
                        window_start=scores[0].timestamp,
                        window_end=scores[-1].timestamp,
                        sample_count=len(scores),
                    )
                ]
        return []

    # ------------------------------------------------------------------
    # Signal 5: Inconsistency (cross-document variance)
    # ------------------------------------------------------------------

    def _check_inconsistency(
        self, profile_id: str, scores: list[FidelityScore]
    ) -> list[DriftSignal]:
        """Cross-document variance exceeding multiplier * historical variance."""
        if len(scores) < 6:
            return []

        mid = len(scores) // 2
        baseline_vals = [s.score for s in scores[:mid]]
        current_vals = [s.score for s in scores[mid:]]

        if len(baseline_vals) < 2 or len(current_vals) < 2:
            return []

        baseline_var = statistics.variance(baseline_vals)
        current_var = statistics.variance(current_vals)

        if baseline_var == 0:
            return []

        ratio = current_var / baseline_var
        if ratio > self.config.inconsistency_multiplier:
            return [
                DriftSignal(
                    signal_id=_cuid(),
                    profile_id=profile_id,
                    signal_type="inconsistency",
                    severity="medium" if ratio < 3.0 else "high",
                    current_value=round(current_var, 4),
                    baseline_value=round(baseline_var, 4),
                    deviation=round(ratio, 4),
                    window_start=scores[0].timestamp,
                    window_end=scores[-1].timestamp,
                    sample_count=len(scores),
                )
            ]
        return []

    # ------------------------------------------------------------------
    # Helpers
    # ------------------------------------------------------------------

    @staticmethod
    def _severity_for_decline(decline: float) -> str:
        if decline > 0.20:
            return "critical"
        if decline > 0.15:
            return "high"
        if decline > 0.10:
            return "medium"
        return "low"
