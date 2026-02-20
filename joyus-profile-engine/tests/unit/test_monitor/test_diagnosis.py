"""Tests for DiagnosisEngine: cause mapping, feature attribution, severity."""

from __future__ import annotations

from datetime import datetime, timedelta, timezone

import pytest

from joyus_profile.models.monitoring import DriftSignal
from joyus_profile.monitor.diagnosis import DiagnosisEngine
from joyus_profile.monitor.drift_detector import DriftDetector
from joyus_profile.monitor.score_store import ScoreStore

from .conftest import PROFILE_ID, make_signal


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _make_signal(
    signal_type: str,
    severity: str = "medium",
    current_value: float = 0.6,
    baseline_value: float = 0.8,
    deviation: float = 0.2,
) -> DriftSignal:
    return DriftSignal(
        signal_id="sig_test",
        profile_id=PROFILE_ID,
        signal_type=signal_type,
        severity=severity,
        current_value=current_value,
        baseline_value=baseline_value,
        deviation=deviation,
        window_start=datetime.now(timezone.utc) - timedelta(days=14),
        window_end=datetime.now(timezone.utc),
        sample_count=10,
    )


@pytest.fixture
def engine(score_store: ScoreStore, drift_detector: DriftDetector) -> DiagnosisEngine:
    return DiagnosisEngine(score_store, drift_detector)


# ---------------------------------------------------------------------------
# Cause mapping (T063)
# ---------------------------------------------------------------------------


class TestCauseMapping:
    def test_negative_increase_is_position_change(self, engine: DiagnosisEngine):
        signals = [_make_signal("negative_increase", severity="critical")]
        diag = engine.diagnose(PROFILE_ID, signals)
        assert diag.probable_cause == "position_change"

    def test_marker_shift_alone_is_vocabulary_shift(self, engine: DiagnosisEngine):
        signals = [_make_signal("marker_shift")]
        diag = engine.diagnose(PROFILE_ID, signals)
        assert diag.probable_cause == "vocabulary_shift"

    def test_stylometric_and_marker_is_corpus_evolution(self, engine: DiagnosisEngine):
        signals = [
            _make_signal("stylometric_distance"),
            _make_signal("marker_shift"),
        ]
        diag = engine.diagnose(PROFILE_ID, signals)
        assert diag.probable_cause == "corpus_evolution"

    def test_inconsistency_alone_is_model_update(self, engine: DiagnosisEngine):
        signals = [_make_signal("inconsistency")]
        diag = engine.diagnose(PROFILE_ID, signals)
        assert diag.probable_cause == "model_update"

    def test_fidelity_decline_alone_is_profile_staleness(self, engine: DiagnosisEngine):
        signals = [_make_signal("fidelity_decline")]
        diag = engine.diagnose(PROFILE_ID, signals)
        assert diag.probable_cause == "profile_staleness"

    def test_unknown_cause_for_unrecognised_combination(self, engine: DiagnosisEngine):
        signals = [
            _make_signal("fidelity_decline"),
            _make_signal("inconsistency"),
        ]
        diag = engine.diagnose(PROFILE_ID, signals)
        assert diag.probable_cause == "unknown"

    def test_negative_increase_overrides_other_signals(self, engine: DiagnosisEngine):
        """negative_increase should win even when marker_shift is also present."""
        signals = [
            _make_signal("negative_increase", severity="critical"),
            _make_signal("marker_shift"),
        ]
        diag = engine.diagnose(PROFILE_ID, signals)
        assert diag.probable_cause == "position_change"


# ---------------------------------------------------------------------------
# Feature attribution (T064)
# ---------------------------------------------------------------------------


class TestFeatureAttribution:
    def test_fidelity_decline_maps_to_overall_fidelity(self, engine: DiagnosisEngine):
        signals = [_make_signal("fidelity_decline")]
        diag = engine.diagnose(PROFILE_ID, signals)
        names = [f.feature_name for f in diag.affected_features]
        assert "overall.fidelity_score" in names

    def test_marker_shift_maps_to_signature_phrases(self, engine: DiagnosisEngine):
        signals = [_make_signal("marker_shift")]
        diag = engine.diagnose(PROFILE_ID, signals)
        names = [f.feature_name for f in diag.affected_features]
        assert "vocabulary.signature_phrases" in names

    def test_stylometric_distance_maps_to_burrows_delta(self, engine: DiagnosisEngine):
        signals = [_make_signal("stylometric_distance")]
        diag = engine.diagnose(PROFILE_ID, signals)
        names = [f.feature_name for f in diag.affected_features]
        assert "stylometrics.burrows_delta" in names

    def test_negative_increase_maps_to_prohibited_framings(
        self, engine: DiagnosisEngine
    ):
        signals = [_make_signal("negative_increase", current_value=0.1)]
        diag = engine.diagnose(PROFILE_ID, signals)
        names = [f.feature_name for f in diag.affected_features]
        assert "anti_patterns.prohibited_framings" in names

    def test_inconsistency_maps_to_cross_document_variance(
        self, engine: DiagnosisEngine
    ):
        signals = [_make_signal("inconsistency")]
        diag = engine.diagnose(PROFILE_ID, signals)
        names = [f.feature_name for f in diag.affected_features]
        assert "consistency.cross_document_variance" in names

    def test_deviation_pct_is_abs_deviation(self, engine: DiagnosisEngine):
        signal = _make_signal("fidelity_decline", deviation=-0.15)
        diag = engine.diagnose(PROFILE_ID, [signal])
        feat = diag.affected_features[0]
        assert feat.deviation_pct == pytest.approx(0.15)

    def test_negative_increase_deviation_always_100(self, engine: DiagnosisEngine):
        signal = _make_signal("negative_increase", current_value=0.05, deviation=0.05)
        diag = engine.diagnose(PROFILE_ID, [signal])
        feat = next(
            f
            for f in diag.affected_features
            if f.feature_name == "anti_patterns.prohibited_framings"
        )
        assert feat.deviation_pct == 100.0

    def test_feature_descriptions_are_non_empty(self, engine: DiagnosisEngine):
        for sig_type in [
            "fidelity_decline",
            "marker_shift",
            "stylometric_distance",
            "negative_increase",
            "inconsistency",
        ]:
            diag = engine.diagnose(PROFILE_ID, [_make_signal(sig_type)])
            for feat in diag.affected_features:
                assert feat.description, f"Empty description for {sig_type}"


# ---------------------------------------------------------------------------
# Severity aggregation
# ---------------------------------------------------------------------------


class TestSeverityAggregation:
    def test_single_low_signal(self, engine: DiagnosisEngine):
        signals = [_make_signal("fidelity_decline", severity="low")]
        diag = engine.diagnose(PROFILE_ID, signals)
        assert diag.severity == "low"

    def test_max_severity_wins(self, engine: DiagnosisEngine):
        signals = [
            _make_signal("fidelity_decline", severity="low"),
            _make_signal("negative_increase", severity="critical"),
        ]
        diag = engine.diagnose(PROFILE_ID, signals)
        assert diag.severity == "critical"

    def test_medium_and_high_gives_high(self, engine: DiagnosisEngine):
        signals = [
            _make_signal("fidelity_decline", severity="medium"),
            _make_signal("marker_shift", severity="high"),
        ]
        diag = engine.diagnose(PROFILE_ID, signals)
        assert diag.severity == "high"

    def test_empty_signals_severity_is_low(self, engine: DiagnosisEngine):
        diag = engine.diagnose(PROFILE_ID, [])
        assert diag.severity == "low"


# ---------------------------------------------------------------------------
# Recommended repair mapping
# ---------------------------------------------------------------------------


class TestRecommendedRepair:
    def test_position_change_recommends_update_positions(self, engine: DiagnosisEngine):
        signals = [_make_signal("negative_increase", severity="critical")]
        diag = engine.diagnose(PROFILE_ID, signals)
        assert diag.recommended_action is not None
        assert diag.recommended_action.action_type == "update_positions"

    def test_model_update_recommends_recalibrate(self, engine: DiagnosisEngine):
        signals = [_make_signal("inconsistency")]
        diag = engine.diagnose(PROFILE_ID, signals)
        assert diag.recommended_action is not None
        assert diag.recommended_action.action_type == "recalibrate_thresholds"
        assert diag.recommended_action.automated is True

    def test_unknown_cause_recommends_escalate(self, engine: DiagnosisEngine):
        signals = [
            _make_signal("fidelity_decline"),
            _make_signal("inconsistency"),
        ]
        diag = engine.diagnose(PROFILE_ID, signals)
        assert diag.recommended_action is not None
        assert diag.recommended_action.action_type == "escalate"


# ---------------------------------------------------------------------------
# Diagnosis metadata
# ---------------------------------------------------------------------------


class TestDiagnosisMetadata:
    def test_diagnosis_has_unique_id(self, engine: DiagnosisEngine):
        d1 = engine.diagnose(PROFILE_ID, [_make_signal("fidelity_decline")])
        d2 = engine.diagnose(PROFILE_ID, [_make_signal("fidelity_decline")])
        assert d1.diagnosis_id != d2.diagnosis_id

    def test_profile_id_preserved(self, engine: DiagnosisEngine):
        diag = engine.diagnose("my_profile", [_make_signal("marker_shift")])
        assert diag.profile_id == "my_profile"

    def test_signals_preserved(self, engine: DiagnosisEngine):
        signals = [_make_signal("fidelity_decline"), _make_signal("marker_shift")]
        diag = engine.diagnose(PROFILE_ID, signals)
        assert len(diag.signals) == 2
