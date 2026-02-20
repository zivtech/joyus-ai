"""Tests for DiagnosticReporter: Markdown output and cause labels."""

from __future__ import annotations

from datetime import datetime, timedelta, timezone

import pytest

from joyus_profile.models.monitoring import (
    DriftDiagnosis,
    DriftSignal,
    DriftedFeature,
    RepairAction,
)
from joyus_profile.monitor.reports import DiagnosticReporter, _CAUSE_LABELS

PROFILE_ID = "prof_report_test"


def _make_diagnosis(
    probable_cause: str = "vocabulary_shift",
    severity: str = "medium",
    signals: list[DriftSignal] | None = None,
    features: list[DriftedFeature] | None = None,
    action_type: str = "update_markers",
    automated: bool = False,
) -> DriftDiagnosis:
    now = datetime.now(timezone.utc)
    default_signal = DriftSignal(
        signal_id="s1",
        profile_id=PROFILE_ID,
        signal_type="marker_shift",
        severity="medium",
        current_value=0.6,
        baseline_value=0.8,
        deviation=0.2,
        window_start=now - timedelta(days=7),
        window_end=now,
        sample_count=8,
    )
    default_feature = DriftedFeature(
        feature_name="vocabulary.signature_phrases",
        description="Marker usage dropped 20%",
        baseline_value=0.8,
        current_value=0.6,
        deviation_pct=0.2,
    )
    action = RepairAction(
        action_id="act_001",
        action_type=action_type,
        description="Add new domain terms, retire obsolete ones",
        automated=automated,
        status="proposed",
    )
    return DriftDiagnosis(
        diagnosis_id="diag_001",
        profile_id=PROFILE_ID,
        detection_date=now,
        severity=severity,
        signals=signals or [default_signal],
        affected_features=features or [default_feature],
        probable_cause=probable_cause,
        recommended_action=action,
        diagnosed_at=now,
    )


@pytest.fixture
def reporter() -> DiagnosticReporter:
    return DiagnosticReporter()


class TestMarkdownStructure:
    def test_report_starts_with_h1(self, reporter: DiagnosticReporter):
        report = reporter.format_diagnosis(_make_diagnosis())
        assert report.startswith("# Drift Diagnosis:")

    def test_report_contains_profile_id(self, reporter: DiagnosticReporter):
        report = reporter.format_diagnosis(_make_diagnosis())
        assert PROFILE_ID in report

    def test_report_contains_severity(self, reporter: DiagnosticReporter):
        report = reporter.format_diagnosis(_make_diagnosis(severity="high"))
        assert "HIGH" in report

    def test_report_contains_signals_section(self, reporter: DiagnosticReporter):
        report = reporter.format_diagnosis(_make_diagnosis())
        assert "## Signals Detected" in report

    def test_report_contains_features_section(self, reporter: DiagnosticReporter):
        report = reporter.format_diagnosis(_make_diagnosis())
        assert "## Affected Features" in report

    def test_report_contains_recommended_action_section(
        self, reporter: DiagnosticReporter
    ):
        report = reporter.format_diagnosis(_make_diagnosis())
        assert "## Recommended Action" in report

    def test_signal_listed_with_values(self, reporter: DiagnosticReporter):
        report = reporter.format_diagnosis(_make_diagnosis())
        assert "marker_shift" in report
        assert "current=" in report
        assert "baseline=" in report

    def test_feature_listed(self, reporter: DiagnosticReporter):
        report = reporter.format_diagnosis(_make_diagnosis())
        assert "vocabulary.signature_phrases" in report

    def test_action_type_in_report(self, reporter: DiagnosticReporter):
        report = reporter.format_diagnosis(_make_diagnosis(action_type="update_markers"))
        assert "update_markers" in report

    def test_automated_flag_yes(self, reporter: DiagnosticReporter):
        report = reporter.format_diagnosis(
            _make_diagnosis(action_type="recalibrate_thresholds", automated=True)
        )
        assert "Yes" in report

    def test_automated_flag_no(self, reporter: DiagnosticReporter):
        report = reporter.format_diagnosis(_make_diagnosis(automated=False))
        assert "requires human approval" in report


class TestCauseLabels:
    @pytest.mark.parametrize("cause", list(_CAUSE_LABELS.keys()))
    def test_known_causes_return_human_label(
        self, reporter: DiagnosticReporter, cause: str
    ):
        label = reporter._format_cause(cause)
        assert label == _CAUSE_LABELS[cause]
        assert label != cause  # Should be a human-friendly expansion

    def test_unknown_cause_returned_as_is(self, reporter: DiagnosticReporter):
        assert reporter._format_cause("totally_new_cause") == "totally_new_cause"

    def test_model_update_label(self, reporter: DiagnosticReporter):
        assert "model" in reporter._format_cause("model_update").lower()

    def test_corpus_evolution_label(self, reporter: DiagnosticReporter):
        assert "evolved" in reporter._format_cause("corpus_evolution").lower()

    def test_position_change_label(self, reporter: DiagnosticReporter):
        assert "position" in reporter._format_cause("position_change").lower()


class TestEdgeCases:
    def test_empty_signals_renders_without_error(self, reporter: DiagnosticReporter):
        diag = _make_diagnosis(signals=[])
        report = reporter.format_diagnosis(diag)
        assert "## Signals Detected" in report

    def test_empty_features_renders_without_error(self, reporter: DiagnosticReporter):
        diag = _make_diagnosis(features=[])
        report = reporter.format_diagnosis(diag)
        assert "## Affected Features" in report

    def test_no_recommended_action(self, reporter: DiagnosticReporter):
        diag = _make_diagnosis()
        diag.recommended_action = None
        report = reporter.format_diagnosis(diag)
        assert "No repair action recommended" in report

    def test_report_is_string(self, reporter: DiagnosticReporter):
        report = reporter.format_diagnosis(_make_diagnosis())
        assert isinstance(report, str)

    def test_cause_in_report(self, reporter: DiagnosticReporter):
        report = reporter.format_diagnosis(
            _make_diagnosis(probable_cause="corpus_evolution")
        )
        assert "evolved" in report.lower()
