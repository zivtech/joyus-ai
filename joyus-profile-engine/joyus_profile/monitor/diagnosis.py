"""Drift diagnosis engine: maps signals to probable causes and affected features."""

from __future__ import annotations

from datetime import datetime, timezone

from cuid2 import cuid_wrapper

from joyus_profile.models.monitoring import (
    DriftDiagnosis,
    DriftedFeature,
    DriftSignal,
    RepairAction,
)
from joyus_profile.monitor.drift_detector import DriftDetector
from joyus_profile.monitor.score_store import ScoreStore

_cuid = cuid_wrapper()

# Maps probable cause to recommended repair action type.
_CAUSE_TO_ACTION: dict[str, str] = {
    "position_change": "update_positions",
    "vocabulary_shift": "update_markers",
    "corpus_evolution": "rebuild_profile",
    "model_update": "recalibrate_thresholds",
    "profile_staleness": "update_corpus",
    "unknown": "escalate",
}

_CAUSE_DESCRIPTIONS: dict[str, str] = {
    "update_positions": "Update positions in the profile hierarchy",
    "update_markers": "Add new domain terms, retire obsolete ones",
    "rebuild_profile": "Re-run profile building on expanded corpus",
    "recalibrate_thresholds": "Adjust Tier 1 thresholds against known-good samples",
    "update_corpus": "Rebuild from updated corpus",
    "escalate": "Escalate to human with full diagnostic report",
}


class DiagnosisEngine:
    """Analyze drift signals to identify affected features and probable cause."""

    def __init__(self, score_store: ScoreStore, drift_detector: DriftDetector) -> None:
        self.score_store = score_store
        self.drift_detector = drift_detector

    def diagnose(self, profile_id: str, signals: list[DriftSignal]) -> DriftDiagnosis:
        """Analyze drift signals and produce a diagnosis."""
        affected = self._identify_affected_features(profile_id, signals)
        cause = self._determine_cause(signals, affected)
        severity = self._aggregate_severity(signals)
        action = self._recommend_repair(cause, severity, affected)

        return DriftDiagnosis(
            diagnosis_id=_cuid(),
            profile_id=profile_id,
            detection_date=datetime.now(timezone.utc),
            severity=severity,
            signals=signals,
            affected_features=affected,
            probable_cause=cause,
            recommended_action=action,
            diagnosed_at=datetime.now(timezone.utc),
        )

    def _determine_cause(
        self, signals: list[DriftSignal], features: list[DriftedFeature]
    ) -> str:
        """Map signal patterns to probable causes via heuristics."""
        signal_types = {s.signal_type for s in signals}

        # Prohibited framings suggest stance/position shift — highest priority
        if "negative_increase" in signal_types:
            return "position_change"
        # Both style and markers shifted → writing has fundamentally evolved
        if "stylometric_distance" in signal_types and "marker_shift" in signal_types:
            return "corpus_evolution"
        # Markers changed but core style stable → domain terminology shifted
        if "marker_shift" in signal_types and "stylometric_distance" not in signal_types:
            return "vocabulary_shift"
        # Only output variance changed → model behaviour changed, not the profile
        if "inconsistency" in signal_types and len(signal_types) == 1:
            return "model_update"
        # Gradual fidelity decline alone → profile has aged out
        if "fidelity_decline" in signal_types and len(signal_types) == 1:
            return "profile_staleness"
        return "unknown"

    def _identify_affected_features(
        self, profile_id: str, signals: list[DriftSignal]
    ) -> list[DriftedFeature]:
        """Break drift signals into specific feature-level changes."""
        features: list[DriftedFeature] = []

        for signal in signals:
            if signal.signal_type == "fidelity_decline":
                features.append(
                    DriftedFeature(
                        feature_name="overall.fidelity_score",
                        description=(
                            f"Fidelity score declined from {signal.baseline_value:.2f}"
                            f" to {signal.current_value:.2f}"
                        ),
                        baseline_value=signal.baseline_value,
                        current_value=signal.current_value,
                        deviation_pct=abs(signal.deviation),
                    )
                )
            elif signal.signal_type == "marker_shift":
                features.append(
                    DriftedFeature(
                        feature_name="vocabulary.signature_phrases",
                        description=(
                            f"Marker usage dropped {abs(signal.deviation) * 100:.0f}%"
                        ),
                        baseline_value=signal.baseline_value,
                        current_value=signal.current_value,
                        deviation_pct=abs(signal.deviation),
                    )
                )
            elif signal.signal_type == "stylometric_distance":
                features.append(
                    DriftedFeature(
                        feature_name="stylometrics.burrows_delta",
                        description=(
                            f"Stylometric distance increased to"
                            f" {signal.current_value:.3f}"
                            f" (baseline std: {signal.baseline_value:.3f})"
                        ),
                        baseline_value=signal.baseline_value,
                        current_value=signal.current_value,
                        deviation_pct=abs(signal.deviation),
                    )
                )
            elif signal.signal_type == "negative_increase":
                features.append(
                    DriftedFeature(
                        feature_name="anti_patterns.prohibited_framings",
                        description="Prohibited framings detected in generated content",
                        baseline_value=0.0,
                        current_value=signal.current_value,
                        deviation_pct=100.0,
                    )
                )
            elif signal.signal_type == "inconsistency":
                features.append(
                    DriftedFeature(
                        feature_name="consistency.cross_document_variance",
                        description=(
                            f"Output variance {signal.current_value:.3f} exceeds"
                            f" {signal.baseline_value:.3f} historical"
                        ),
                        baseline_value=signal.baseline_value,
                        current_value=signal.current_value,
                        deviation_pct=abs(signal.deviation),
                    )
                )

        return features

    def _aggregate_severity(self, signals: list[DriftSignal]) -> str:
        """Return the maximum severity across all signals."""
        _order = {"low": 0, "medium": 1, "high": 2, "critical": 3}
        _reverse = {v: k for k, v in _order.items()}
        if not signals:
            return "low"
        max_level = max(_order.get(s.severity, 0) for s in signals)
        return _reverse[max_level]

    def _recommend_repair(
        self,
        cause: str,
        severity: str,
        features: list[DriftedFeature],
    ) -> RepairAction:
        """Produce a RepairAction recommendation from the diagnosed cause."""
        action_type = _CAUSE_TO_ACTION.get(cause, "escalate")
        description = _CAUSE_DESCRIPTIONS.get(action_type, action_type)
        automated = action_type == "recalibrate_thresholds"

        return RepairAction(
            action_id=_cuid(),
            action_type=action_type,
            description=description,
            automated=automated,
            status="proposed",
        )
