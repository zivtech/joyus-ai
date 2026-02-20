"""Alert generation and storage for drift detection."""

from __future__ import annotations

import json
from datetime import datetime, timezone
from pathlib import Path

from cuid2 import cuid_wrapper

from joyus_profile.models.monitoring import Alert, DriftSignal

_cuid = cuid_wrapper()

_SEVERITY_ORDER: dict[str, int] = {"low": 0, "medium": 1, "high": 2, "critical": 3}
_SEVERITY_REVERSE: dict[int, str] = {v: k for k, v in _SEVERITY_ORDER.items()}


class AlertGenerator:
    """Convert drift signals into alerts with severity classification."""

    def __init__(self, data_dir: str) -> None:
        self.alerts_file = Path(data_dir) / "alerts.json"

    # ------------------------------------------------------------------
    # Generation
    # ------------------------------------------------------------------

    def generate_alerts(
        self, profile_id: str, signals: list[DriftSignal]
    ) -> list[Alert]:
        """Create alerts from drift signals. Returns empty list if no signals."""
        if not signals:
            return []

        severity = self._compute_severity(signals)
        requires_immediate = severity == "critical"

        alert = Alert(
            alert_id=_cuid(),
            profile_id=profile_id,
            severity=severity,
            signals=signals,
            summary=self._build_summary(signals),
            created_at=datetime.now(timezone.utc),
            acknowledged=False,
            requires_immediate=requires_immediate,
        )

        self._store_alert(alert)
        return [alert]

    # ------------------------------------------------------------------
    # Query
    # ------------------------------------------------------------------

    def get_alerts(
        self,
        profile_id: str | None = None,
        acknowledged: bool | None = None,
    ) -> list[Alert]:
        """Query stored alerts with optional filters."""
        all_alerts = self._read_alerts()
        result = all_alerts

        if profile_id is not None:
            result = [a for a in result if a.profile_id == profile_id]
        if acknowledged is not None:
            result = [a for a in result if a.acknowledged == acknowledged]

        return result

    def acknowledge(self, alert_id: str) -> None:
        """Mark an alert as acknowledged."""
        alerts = self._read_alerts()
        updated = False
        for alert in alerts:
            if alert.alert_id == alert_id:
                alert.acknowledged = True
                updated = True
                break

        if updated:
            self._write_alerts(alerts)

    # ------------------------------------------------------------------
    # Severity
    # ------------------------------------------------------------------

    def _compute_severity(
        self, signals: list[DriftSignal], severity_rules: list | None = None
    ) -> str:
        """Aggregate severity: max of individual severities, escalate by rules."""
        max_sev = max(_SEVERITY_ORDER.get(s.severity, 0) for s in signals)

        # Apply severity escalation rules (from DriftConfig.severity_rules)
        if severity_rules:
            for rule in severity_rules:
                if len(signals) >= rule.signal_count:
                    rule_sev = _SEVERITY_ORDER.get(rule.min_severity, 0)
                    if rule_sev > max_sev:
                        max_sev = rule_sev
        else:
            # Default escalation: 3+ signals -> at least "high"
            if len(signals) >= 3 and max_sev < _SEVERITY_ORDER["high"]:
                max_sev = _SEVERITY_ORDER["high"]

        return _SEVERITY_REVERSE[max_sev]

    @staticmethod
    def _build_summary(signals: list[DriftSignal]) -> str:
        """Human-readable alert summary."""
        parts: list[str] = []
        for s in signals:
            parts.append(
                f"{s.signal_type} ({s.severity}): "
                f"current={s.current_value:.3f}, baseline={s.baseline_value:.3f}, "
                f"deviation={s.deviation:.3f}"
            )
        prefix = f"Detected {len(signals)} drift signal(s)"
        return f"{prefix}. " + "; ".join(parts)

    # ------------------------------------------------------------------
    # Storage
    # ------------------------------------------------------------------

    def _store_alert(self, alert: Alert) -> None:
        """Append an alert to the global alerts file (atomic write)."""
        alerts = self._read_alerts()
        alerts.append(alert)
        self._write_alerts(alerts)

    def _read_alerts(self) -> list[Alert]:
        if not self.alerts_file.exists():
            return []
        try:
            raw = json.loads(self.alerts_file.read_text())
            return [Alert.model_validate(r) for r in raw]
        except (json.JSONDecodeError, ValueError):
            return []

    def _write_alerts(self, alerts: list[Alert]) -> None:
        self.alerts_file.parent.mkdir(parents=True, exist_ok=True)
        tmp = self.alerts_file.with_suffix(".tmp")
        data = [a.model_dump(mode="json") for a in alerts]
        tmp.write_text(json.dumps(data, default=str, indent=2))
        tmp.rename(self.alerts_file)
