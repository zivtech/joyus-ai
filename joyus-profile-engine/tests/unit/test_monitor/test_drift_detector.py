"""Tests for DriftDetector: all 5 signals, edge cases, insufficient data."""

from __future__ import annotations

from datetime import datetime, timedelta, timezone

from joyus_profile.models.monitoring import DriftConfig
from joyus_profile.monitor.drift_detector import DriftDetector

from .conftest import PROFILE_ID, make_score


class TestInsufficientData:
    def test_no_scores_returns_empty(self, drift_detector: DriftDetector):
        signals = drift_detector.check(PROFILE_ID)
        assert signals == []

    def test_below_min_samples_returns_empty(self, score_store, default_config):
        detector = DriftDetector(score_store, default_config)
        # Add fewer than min_samples (default=5)
        now = datetime.now(timezone.utc)
        for i in range(3):
            score_store.append(
                PROFILE_ID, make_score(score=0.8, timestamp=now - timedelta(hours=i))
            )
        signals = detector.check(PROFILE_ID)
        assert signals == []


class TestFidelityDecline:
    def test_detects_decline(self, score_store, data_dir):
        """Scores dropping from 0.9 to 0.7 = ~22% decline (>5%)."""
        config = DriftConfig(min_samples=4, window_days=30)
        detector = DriftDetector(score_store, config)
        now = datetime.now(timezone.utc)

        # First half: high scores
        for i in range(5):
            score_store.append(
                PROFILE_ID,
                make_score(score=0.9, timestamp=now - timedelta(days=10 - i)),
            )
        # Second half: low scores
        for i in range(5):
            score_store.append(
                PROFILE_ID,
                make_score(score=0.7, timestamp=now - timedelta(days=4 - i)),
            )

        signals = detector.check(PROFILE_ID)
        decline_signals = [s for s in signals if s.signal_type == "fidelity_decline"]
        assert len(decline_signals) == 1
        assert decline_signals[0].deviation > 0.05

    def test_no_decline_when_stable(self, score_store, data_dir):
        config = DriftConfig(min_samples=4, window_days=30)
        detector = DriftDetector(score_store, config)
        now = datetime.now(timezone.utc)

        for i in range(10):
            score_store.append(
                PROFILE_ID,
                make_score(score=0.85, timestamp=now - timedelta(days=10 - i)),
            )

        signals = detector.check(PROFILE_ID)
        decline_signals = [s for s in signals if s.signal_type == "fidelity_decline"]
        assert len(decline_signals) == 0


class TestMarkerShift:
    def test_detects_marker_drop(self, score_store, data_dir):
        """Marker score dropping from 0.8 to 0.5 = 37.5% drop (>20%)."""
        config = DriftConfig(min_samples=4, window_days=30)
        detector = DriftDetector(score_store, config)
        now = datetime.now(timezone.utc)

        # First half: high marker scores
        for i in range(4):
            score_store.append(
                PROFILE_ID,
                make_score(
                    score=0.85, marker_score=0.8,
                    timestamp=now - timedelta(days=10 - i),
                ),
            )
        # Second half: low marker scores
        for i in range(4):
            score_store.append(
                PROFILE_ID,
                make_score(
                    score=0.85, marker_score=0.5,
                    timestamp=now - timedelta(days=4 - i),
                ),
            )

        signals = detector.check(PROFILE_ID)
        marker_signals = [s for s in signals if s.signal_type == "marker_shift"]
        assert len(marker_signals) == 1

    def test_no_shift_when_stable(self, score_store, data_dir):
        config = DriftConfig(min_samples=4, window_days=30)
        detector = DriftDetector(score_store, config)
        now = datetime.now(timezone.utc)

        for i in range(10):
            score_store.append(
                PROFILE_ID,
                make_score(
                    score=0.85, marker_score=0.75,
                    timestamp=now - timedelta(days=10 - i),
                ),
            )

        signals = detector.check(PROFILE_ID)
        marker_signals = [s for s in signals if s.signal_type == "marker_shift"]
        assert len(marker_signals) == 0


class TestStylometricDistance:
    def test_detects_distance_drift(self, score_store, data_dir):
        """Function-word feature drifting beyond 1.5x std."""
        config = DriftConfig(min_samples=4, window_days=30)
        detector = DriftDetector(score_store, config)
        now = datetime.now(timezone.utc)

        # Baseline: tight cluster around 0.5 (std ~ 0.02)
        for i in range(5):
            score_store.append(
                PROFILE_ID,
                make_score(
                    score=0.85,
                    feature_breakdown={"function_words": 0.50 + i * 0.005},
                    timestamp=now - timedelta(days=10 - i),
                ),
            )
        # Current: shifted to 0.8 (far from baseline)
        for i in range(5):
            score_store.append(
                PROFILE_ID,
                make_score(
                    score=0.85,
                    feature_breakdown={"function_words": 0.80 + i * 0.005},
                    timestamp=now - timedelta(days=4 - i),
                ),
            )

        signals = detector.check(PROFILE_ID)
        stylo_signals = [s for s in signals if s.signal_type == "stylometric_distance"]
        assert len(stylo_signals) == 1

    def test_no_distance_drift_when_stable(self, score_store, data_dir):
        config = DriftConfig(min_samples=4, window_days=30)
        detector = DriftDetector(score_store, config)
        now = datetime.now(timezone.utc)

        # Use alternating values around a mean to create variance without drift
        values = [0.49, 0.51, 0.49, 0.51, 0.50, 0.49, 0.51, 0.49, 0.51, 0.50]
        for i in range(10):
            score_store.append(
                PROFILE_ID,
                make_score(
                    score=0.85,
                    feature_breakdown={"function_words": values[i]},
                    timestamp=now - timedelta(days=10 - i),
                ),
            )

        signals = detector.check(PROFILE_ID)
        stylo_signals = [s for s in signals if s.signal_type == "stylometric_distance"]
        assert len(stylo_signals) == 0


class TestNegativeIncrease:
    def test_detects_prohibited_framings(self, score_store, data_dir):
        """Any negative marker hit triggers with zero tolerance."""
        config = DriftConfig(min_samples=4, window_days=30)
        detector = DriftDetector(score_store, config)
        now = datetime.now(timezone.utc)

        for i in range(5):
            score_store.append(
                PROFILE_ID,
                make_score(
                    score=0.85,
                    feature_breakdown={"negative_markers": 0.0},
                    timestamp=now - timedelta(days=10 - i),
                ),
            )
        # One score with prohibited framing
        score_store.append(
            PROFILE_ID,
            make_score(
                score=0.85,
                feature_breakdown={"negative_markers": 0.3},
                timestamp=now - timedelta(hours=1),
            ),
        )

        signals = detector.check(PROFILE_ID)
        neg_signals = [s for s in signals if s.signal_type == "negative_increase"]
        assert len(neg_signals) == 1
        assert neg_signals[0].severity == "critical"

    def test_no_signal_when_clean(self, score_store, data_dir):
        config = DriftConfig(min_samples=4, window_days=30)
        detector = DriftDetector(score_store, config)
        now = datetime.now(timezone.utc)

        for i in range(6):
            score_store.append(
                PROFILE_ID,
                make_score(
                    score=0.85,
                    feature_breakdown={"negative_markers": 0.0},
                    timestamp=now - timedelta(days=6 - i),
                ),
            )

        signals = detector.check(PROFILE_ID)
        neg_signals = [s for s in signals if s.signal_type == "negative_increase"]
        assert len(neg_signals) == 0

    def test_disabled_zero_tolerance(self, score_store, data_dir):
        config = DriftConfig(
            min_samples=4, window_days=30, negative_zero_tolerance=False
        )
        detector = DriftDetector(score_store, config)
        now = datetime.now(timezone.utc)

        for i in range(5):
            score_store.append(
                PROFILE_ID,
                make_score(
                    score=0.85,
                    feature_breakdown={"negative_markers": 0.0},
                    timestamp=now - timedelta(days=6 - i),
                ),
            )
        score_store.append(
            PROFILE_ID,
            make_score(
                score=0.85,
                feature_breakdown={"negative_markers": 0.2},
                timestamp=now - timedelta(hours=1),
            ),
        )

        signals = detector.check(PROFILE_ID)
        neg_signals = [s for s in signals if s.signal_type == "negative_increase"]
        assert len(neg_signals) == 0


class TestInconsistency:
    def test_detects_high_variance(self, score_store, data_dir):
        """Current variance 2x+ historical triggers inconsistency."""
        config = DriftConfig(min_samples=4, window_days=30)
        detector = DriftDetector(score_store, config)
        now = datetime.now(timezone.utc)

        # Baseline: tight cluster
        for i in range(5):
            score_store.append(
                PROFILE_ID,
                make_score(score=0.80 + i * 0.01, timestamp=now - timedelta(days=10 - i)),
            )
        # Current: high variance
        scores_values = [0.5, 0.95, 0.55, 0.90, 0.50]
        for i, val in enumerate(scores_values):
            score_store.append(
                PROFILE_ID,
                make_score(score=val, timestamp=now - timedelta(days=4 - i)),
            )

        signals = detector.check(PROFILE_ID)
        inc_signals = [s for s in signals if s.signal_type == "inconsistency"]
        assert len(inc_signals) == 1

    def test_no_inconsistency_when_stable(self, score_store, data_dir):
        config = DriftConfig(min_samples=4, window_days=30)
        detector = DriftDetector(score_store, config)
        now = datetime.now(timezone.utc)

        for i in range(10):
            score_store.append(
                PROFILE_ID,
                make_score(score=0.80 + i * 0.005, timestamp=now - timedelta(days=10 - i)),
            )

        signals = detector.check(PROFILE_ID)
        inc_signals = [s for s in signals if s.signal_type == "inconsistency"]
        assert len(inc_signals) == 0
