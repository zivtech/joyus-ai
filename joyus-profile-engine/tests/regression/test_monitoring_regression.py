"""Cross-profile regression tests for monitoring (T073).

Verifies:
- Repairs are isolated to the target profile (no cross-profile contamination)
- End-to-end monitoring pipeline produces expected results
- Alert severity escalation works correctly
- Rollup accuracy matches manual calculations
"""

from __future__ import annotations

import os
import statistics
import sys
from datetime import datetime, timedelta, timezone

import pytest

from joyus_profile.models.monitoring import DriftConfig, DriftDiagnosis, RepairAction
from joyus_profile.monitor.alerts import AlertGenerator
from joyus_profile.monitor.drift_detector import DriftDetector
from joyus_profile.monitor.pipeline import MonitoringPipeline
from joyus_profile.monitor.repair import RepairFramework
from joyus_profile.monitor.rollups import RollupEngine
from joyus_profile.monitor.score_store import ScoreStore

sys.path.insert(
    0,
    os.path.join(os.path.dirname(__file__), "..", "unit", "test_monitor"),
)
from conftest import make_score, make_signal  # noqa: E402

BASE_DATE = datetime.now(timezone.utc) - timedelta(days=15)

PROFILE_A = "prof_a"
PROFILE_B = "prof_b"
PROFILE_C = "prof_c"


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _make_diagnosis(
    profile_id: str = PROFILE_A,
    cause: str = "model_update",
) -> DriftDiagnosis:
    """Build a minimal DriftDiagnosis for testing."""
    from cuid2 import cuid_wrapper

    _cuid = cuid_wrapper()

    _cause_to_action = {
        "position_change": "update_positions",
        "vocabulary_shift": "update_markers",
        "corpus_evolution": "rebuild_profile",
        "model_update": "recalibrate_thresholds",
        "profile_staleness": "update_corpus",
        "unknown": "escalate",
    }
    action_type = _cause_to_action.get(cause, "escalate")
    automated = action_type == "recalibrate_thresholds"

    recommended = RepairAction(
        action_id=_cuid(),
        action_type=action_type,
        description=f"Action for {cause}",
        automated=automated,
        status="proposed",
    )
    return DriftDiagnosis(
        diagnosis_id=_cuid(),
        profile_id=profile_id,
        detection_date=datetime.now(timezone.utc),
        severity="medium",
        signals=[],
        affected_features=[],
        probable_cause=cause,
        recommended_action=recommended,
        diagnosed_at=datetime.now(timezone.utc),
    )


# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------


@pytest.fixture()
def data_dir(tmp_path):
    d = tmp_path / "monitoring_regression"
    d.mkdir()
    return str(d)


@pytest.fixture()
def score_store(data_dir):
    return ScoreStore(data_dir)


@pytest.fixture()
def repair_framework(data_dir):
    return RepairFramework(data_dir)


@pytest.fixture()
def alert_generator(data_dir):
    return AlertGenerator(data_dir)


@pytest.fixture()
def rollup_engine(score_store):
    return RollupEngine(score_store)


@pytest.fixture()
def drift_detector(score_store):
    config = DriftConfig(window_days=30, min_samples=5)
    return DriftDetector(score_store, config)


@pytest.fixture()
def pipeline(score_store, drift_detector, alert_generator):
    return MonitoringPipeline(
        score_store=score_store,
        drift_detector=drift_detector,
        alert_generator=alert_generator,
    )


# ---------------------------------------------------------------------------
# Tests
# ---------------------------------------------------------------------------


class TestMonitoringRegression:
    def test_repair_doesnt_affect_other_profiles(
        self, score_store, repair_framework
    ):
        """Repairing profile A must not change profile B's or C's scores."""
        # Pre-populate scores for profiles B and C
        for i in range(6):
            score_store.append(
                PROFILE_B,
                make_score(score=0.82, timestamp=BASE_DATE + timedelta(hours=i)),
            )
            score_store.append(
                PROFILE_C,
                make_score(score=0.78, timestamp=BASE_DATE + timedelta(hours=i)),
            )

        def _mean(profile_id: str) -> float:
            scores = score_store.get_scores(profile_id)
            return sum(s.score for s in scores) / len(scores)

        pre_b = _mean(PROFILE_B)
        pre_c = _mean(PROFILE_C)

        # Apply repair to profile A (recalibrate_thresholds is automated)
        diagnosis = _make_diagnosis(profile_id=PROFILE_A, cause="model_update")
        action = repair_framework.propose(diagnosis)
        action = repair_framework.apply(action.action_id)
        assert action.status == "applied"

        # Scores for B and C must be unchanged
        assert abs(_mean(PROFILE_B) - pre_b) < 0.01
        assert abs(_mean(PROFILE_C) - pre_c) < 0.01

    def test_monitoring_pipeline_end_to_end(self, pipeline, score_store, drift_detector):
        """Generate → enqueue → process → drift check detects decline."""
        # Insert 6 stable baseline scores directly into the store
        for i in range(6):
            score_store.append(
                PROFILE_A,
                make_score(
                    score=0.85,
                    timestamp=BASE_DATE + timedelta(hours=i),
                ),
            )

        # Enqueue and process content that will produce low scores via the pipeline.
        # The _NullFidelityScorer gives base=0.5+(words*0.001); use short strings.
        for _ in range(6):
            pipeline.enqueue("bad content", PROFILE_A)

        results = pipeline.process_all()
        assert len(results) == 6

        # All jobs processed
        assert pipeline.pending_count == 0

        # After inserting 6 low scores on top of 6 high ones, drift should fire.
        all_signals = drift_detector.check(PROFILE_A)
        assert any(s.signal_type == "fidelity_decline" for s in all_signals)

    def test_alert_severity_escalation(self, alert_generator):
        """Signal count drives severity escalation: 1→low, 2→medium, 3+→high."""
        low_sig = make_signal(signal_type="fidelity_decline", severity="low")
        medium_sig = make_signal(signal_type="marker_shift", severity="low")
        high_sig = make_signal(signal_type="inconsistency", severity="low")

        # 1 signal → severity from the single signal itself (low)
        alerts_1 = alert_generator.generate_alerts(PROFILE_A, [low_sig])
        assert len(alerts_1) == 1
        assert alerts_1[0].severity == "low"

        # 2 signals → escalated to at least medium
        alerts_2 = alert_generator.generate_alerts(PROFILE_B, [low_sig, medium_sig])
        assert len(alerts_2) == 1
        assert alerts_2[0].severity in ("medium", "high", "critical")

        # 3 signals → escalated to at least high
        alerts_3 = alert_generator.generate_alerts(
            PROFILE_C, [low_sig, medium_sig, high_sig]
        )
        assert len(alerts_3) == 1
        assert alerts_3[0].severity in ("high", "critical")

    def test_rollup_accuracy(self, score_store, rollup_engine):
        """Rollup mean and std must match manual calculations."""
        known_scores = [0.80, 0.82, 0.85, 0.78, 0.90]
        target_date = BASE_DATE.date()

        for i, val in enumerate(known_scores):
            score_store.append(
                PROFILE_A,
                make_score(
                    score=val,
                    timestamp=BASE_DATE + timedelta(minutes=i),
                ),
            )

        rollup = rollup_engine.compute_daily(PROFILE_A, target_date)

        assert rollup.count == len(known_scores)
        assert rollup.mean is not None
        assert abs(rollup.mean - statistics.mean(known_scores)) < 1e-6

        expected_std = statistics.stdev(known_scores)
        assert rollup.std is not None
        assert abs(rollup.std - expected_std) < 1e-6

        assert rollup.min is not None
        assert abs(rollup.min - min(known_scores)) < 1e-9
        assert rollup.max is not None
        assert abs(rollup.max - max(known_scores)) < 1e-9
