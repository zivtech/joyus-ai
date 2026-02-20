"""Simulated drift scenario integration tests (T071)."""

from __future__ import annotations

import os
import random

# Import shared helpers from the unit test conftest
import sys
from datetime import datetime, timedelta, timezone

import pytest

from joyus_profile.models.monitoring import DriftConfig
from joyus_profile.monitor.drift_detector import DriftDetector
from joyus_profile.monitor.score_store import ScoreStore

sys.path.insert(
    0,
    os.path.join(os.path.dirname(__file__), "..", "unit", "test_monitor"),
)
from conftest import make_score  # noqa: E402

BASE_DATE = datetime.now(timezone.utc) - timedelta(days=15)
PROFILE_ID = "drift_sim_profile"


@pytest.fixture()
def data_dir(tmp_path):
    d = tmp_path / "drift_sim"
    d.mkdir()
    return str(d)


@pytest.fixture()
def score_store(data_dir):
    return ScoreStore(data_dir)


@pytest.fixture()
def drift_detector(score_store):
    config = DriftConfig(
        window_days=30,
        min_samples=5,
        fidelity_decline_pct=0.05,
        marker_shift_pct=0.20,
        negative_zero_tolerance=True,
    )
    return DriftDetector(score_store, config)


class TestDriftSimulation:
    def test_gradual_fidelity_decline(self, score_store, drift_detector):
        """Simulate gradual score decline over 14 days → fidelity_decline signal."""
        baseline_score = 0.85
        for day in range(14):
            # 1% decline per day → ~8.5% first-half vs second-half mean gap (> 5% threshold)
            score = baseline_score - (day * 0.01)
            score_store.append(
                PROFILE_ID,
                make_score(
                    score=score,
                    timestamp=BASE_DATE + timedelta(days=day),
                ),
            )

        signals = drift_detector.check(PROFILE_ID)
        assert any(s.signal_type == "fidelity_decline" for s in signals)

    def test_marker_shift(self, score_store, drift_detector):
        """Simulate signature phrase usage dropping >20% → marker_shift signal."""
        # First 7 scores: marker_score ~0.80
        for day in range(7):
            score_store.append(
                PROFILE_ID,
                make_score(
                    score=0.82,
                    marker_score=0.80,
                    timestamp=BASE_DATE + timedelta(days=day),
                ),
            )
        # Next 7 scores: marker_score ~0.55 (31% drop > 20% threshold)
        for day in range(7, 14):
            score_store.append(
                PROFILE_ID,
                make_score(
                    score=0.80,
                    marker_score=0.55,
                    timestamp=BASE_DATE + timedelta(days=day),
                ),
            )

        signals = drift_detector.check(PROFILE_ID)
        assert any(s.signal_type == "marker_shift" for s in signals)

    def test_sudden_prohibited_framing(self, score_store, drift_detector):
        """Simulate prohibited framings appearing → negative_increase signal."""
        # Load baseline scores without negative markers
        for day in range(7):
            score_store.append(
                PROFILE_ID,
                make_score(
                    score=0.82,
                    feature_breakdown={"negative_markers": 0.0},
                    timestamp=BASE_DATE + timedelta(days=day),
                ),
            )
        # Recent scores with prohibited framing markers present
        for day in range(7, 14):
            score_store.append(
                PROFILE_ID,
                make_score(
                    score=0.75,
                    feature_breakdown={"negative_markers": 0.3},
                    timestamp=BASE_DATE + timedelta(days=day),
                ),
            )

        signals = drift_detector.check(PROFILE_ID)
        assert any(s.signal_type == "negative_increase" for s in signals)

    def test_no_drift_stable_scores(self, score_store, drift_detector):
        """Stable scores should produce no drift signals."""
        rng = random.Random(42)
        for day in range(14):
            score_store.append(
                PROFILE_ID,
                make_score(
                    score=0.82 + rng.uniform(-0.02, 0.02),
                    marker_score=0.75 + rng.uniform(-0.02, 0.02),
                    timestamp=BASE_DATE + timedelta(days=day),
                ),
            )

        signals = drift_detector.check(PROFILE_ID)
        assert len(signals) == 0

    def test_insufficient_data(self, score_store, drift_detector):
        """Fewer than min_samples should produce no signals."""
        # DriftConfig.min_samples defaults to 5 — insert only 1 score
        score_store.append(PROFILE_ID, make_score(score=0.50))
        signals = drift_detector.check(PROFILE_ID)
        assert len(signals) == 0

    def test_drift_detection_time(self, score_store, drift_detector):
        """Drift must be detectable within 48h of onset (spec §10).

        We model 48h of onset as 2 data points (one per day).  With a
        window that already includes the declining half, the signal should
        fire as soon as enough samples cross the threshold.
        """
        # Build a stable baseline of 6 scores
        for day in range(6):
            score_store.append(
                PROFILE_ID,
                make_score(
                    score=0.85,
                    timestamp=BASE_DATE + timedelta(days=day),
                ),
            )
        # Add 2 onset scores at a severe decline (simulate 48h window)
        for offset in range(2):
            score_store.append(
                PROFILE_ID,
                make_score(
                    score=0.50,  # >40% drop — critical
                    timestamp=BASE_DATE + timedelta(days=6 + offset),
                ),
            )

        signals = drift_detector.check(PROFILE_ID)
        # Decline should be detected within this 8-sample window
        assert any(s.signal_type == "fidelity_decline" for s in signals)
