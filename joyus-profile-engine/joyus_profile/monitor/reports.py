"""Human-readable diagnostic report generation."""

from __future__ import annotations

from joyus_profile.models.monitoring import DriftDiagnosis

_CAUSE_LABELS: dict[str, str] = {
    "model_update": "AI model behavior change",
    "corpus_evolution": "Author's writing style has evolved",
    "position_change": "Organizational position change",
    "vocabulary_shift": "Domain terminology shift",
    "profile_staleness": "Profile needs refresh (built too long ago)",
    "unknown": "Unknown — requires human investigation",
}


class DiagnosticReporter:
    """Generate human-readable Markdown diagnostic reports from a DriftDiagnosis."""

    def format_diagnosis(self, diagnosis: DriftDiagnosis) -> str:
        """Return a Markdown report for the given diagnosis."""
        lines: list[str] = [
            f"# Drift Diagnosis: {diagnosis.profile_id}",
            f"**Date**: {diagnosis.detection_date.strftime('%Y-%m-%d %H:%M UTC')}",
            f"**Severity**: {diagnosis.severity.upper()}",
            f"**Probable cause**: {self._format_cause(diagnosis.probable_cause)}",
            "",
            "## Signals Detected",
            "",
        ]

        for signal in diagnosis.signals:
            lines.append(
                f"- **{signal.signal_type}** ({signal.severity}): "
                f"current={signal.current_value:.3f}, "
                f"baseline={signal.baseline_value:.3f}"
            )

        lines.extend(
            [
                "",
                "## Affected Features",
                "",
            ]
        )

        for feature in diagnosis.affected_features:
            lines.append(f"- **{feature.feature_name}**: {feature.description}")

        lines.extend(
            [
                "",
                "## Recommended Action",
                "",
            ]
        )

        if diagnosis.recommended_action is not None:
            action = diagnosis.recommended_action
            lines.append(f"**Type**: {action.action_type}")
            lines.append(f"**Description**: {action.description}")
            approval = "Yes" if action.automated else "No — requires human approval"
            lines.append(f"**Automated**: {approval}")
        else:
            lines.append("No repair action recommended.")

        return "\n".join(lines)

    def _format_cause(self, cause: str) -> str:
        """Return a human-friendly label for a probable cause code."""
        return _CAUSE_LABELS.get(cause, cause)
