"""Monitoring MCP tool handlers: check_drift, get_trends, trigger_repair."""

from __future__ import annotations

import asyncio
from typing import Any

from joyus_profile.models.monitoring import DriftConfig, DriftSignal
from joyus_profile.monitor.alerts import AlertGenerator
from joyus_profile.monitor.diagnosis import DiagnosisEngine
from joyus_profile.monitor.drift_detector import DriftDetector
from joyus_profile.monitor.repair import RepairFramework
from joyus_profile.monitor.rollups import RollupEngine
from joyus_profile.monitor.score_store import ScoreStore


def _format_signal(s: DriftSignal) -> dict[str, Any]:
    return {
        "signal_id": s.signal_id,
        "signal_type": s.signal_type,
        "severity": s.severity,
        "current_value": s.current_value,
        "baseline_value": s.baseline_value,
        "deviation": s.deviation,
        "sample_count": s.sample_count,
    }


def handle_check_drift(
    profile_id: str,
    data_dir: str,
    window_days: int = 14,
) -> dict[str, Any]:
    """Check for quality drift on a specific profile.

    When drift is detected the diagnosis is persisted so it can be referenced
    by ``trigger_repair(diagnosis_id=...)``.

    Args:
        profile_id: The profile to check for drift.
        data_dir: Directory where score data is stored.
        window_days: Number of days to look back for drift signals.

    Returns:
        Dict with drift_detected flag, signals list, and diagnosis (if drift found).
    """
    store = ScoreStore(data_dir)
    config = DriftConfig(window_days=window_days)
    detector = DriftDetector(store, config)
    signals = detector.check(profile_id)

    if not signals:
        return {"drift_detected": False, "signals": [], "diagnosis": None}

    engine = DiagnosisEngine(store, detector)
    diagnosis = engine.diagnose(profile_id, signals)

    # Persist the diagnosis so trigger_repair can load it by ID.
    framework = RepairFramework(data_dir)
    framework.save_diagnosis(diagnosis)

    return {
        "drift_detected": True,
        "signals": [_format_signal(s) for s in signals],
        "diagnosis": {
            "diagnosis_id": diagnosis.diagnosis_id,
            "probable_cause": diagnosis.probable_cause,
            "affected_features": [f.feature_name for f in diagnosis.affected_features],
            "recommended_action": (
                diagnosis.recommended_action.action_type
                if diagnosis.recommended_action is not None
                else None
            ),
            "description": (
                diagnosis.recommended_action.description
                if diagnosis.recommended_action is not None
                else None
            ),
        },
    }


def handle_get_trends(
    profile_id: str,
    data_dir: str,
    window_days: int = 30,
    granularity: str = "daily",
) -> dict[str, Any]:
    """Get fidelity trends for a profile over time.

    Args:
        profile_id: The profile to retrieve trends for.
        data_dir: Directory where score data is stored.
        window_days: Number of days to include in the trend window.
        granularity: Aggregation granularity — ``"daily"`` or ``"weekly"``.

    Returns:
        Dict with trend statistics, daily scores, and any active alerts.
    """
    store = ScoreStore(data_dir)
    rollups = RollupEngine(store)
    trend = rollups.get_trend(profile_id, window_days, granularity)
    alerts = AlertGenerator(data_dir).get_alerts(profile_id=profile_id)

    window_start = (
        trend.daily_rollups[0].date.isoformat() if trend.daily_rollups else ""
    )
    window_end = (
        trend.daily_rollups[-1].date.isoformat() if trend.daily_rollups else ""
    )

    return {
        "profile_id": profile_id,
        "window": {
            "start": window_start,
            "end": window_end,
        },
        "sample_count": trend.sample_count,
        "trend": {
            "fidelity_mean": trend.overall_mean,
            "fidelity_std": trend.overall_std,
            "fidelity_trend": trend.trend_slope,
            "daily_scores": [
                {"date": r.date.isoformat(), "mean": r.mean, "count": r.count}
                for r in trend.daily_rollups
            ],
        },
        "alerts": [{"severity": a.severity, "summary": a.summary} for a in alerts],
    }


def handle_trigger_repair(
    diagnosis_id: str,
    data_dir: str,
    auto_apply: bool = False,
) -> dict[str, Any]:
    """Propose or execute a repair action.

    The diagnosis must have been previously persisted via ``check_drift``.
    The action type is determined by the diagnosis's recommended_action.

    Args:
        diagnosis_id: ID of the diagnosis to repair.
        data_dir: Directory where repair/diagnosis data is stored.
        auto_apply: If True and the repair is automated, apply it immediately.

    Returns:
        Dict with action_id, status, description, and requires_approval flag.
    """
    framework = RepairFramework(data_dir)
    diagnosis = framework.load_diagnosis(diagnosis_id)

    repair = framework.propose(diagnosis)

    if auto_apply and repair.automated:
        repair = framework.apply(repair.action_id)

    return {
        "action_id": repair.action_id,
        "status": repair.status,
        "description": repair.description,
        "changes": {},
        "requires_approval": not repair.automated,
    }


# ---------------------------------------------------------------------------
# Async wrappers for MCP server registration
# ---------------------------------------------------------------------------


async def check_drift(
    profile_id: str,
    data_dir: str,
    window_days: int = 14,
) -> dict[str, Any]:
    """Async MCP entry-point for check_drift."""
    return await asyncio.to_thread(
        handle_check_drift, profile_id, data_dir, window_days
    )


async def get_trends(
    profile_id: str,
    data_dir: str,
    window_days: int = 30,
    granularity: str = "daily",
) -> dict[str, Any]:
    """Async MCP entry-point for get_trends."""
    return await asyncio.to_thread(
        handle_get_trends, profile_id, data_dir, window_days, granularity
    )


async def trigger_repair(
    diagnosis_id: str,
    data_dir: str,
    auto_apply: bool = False,
) -> dict[str, Any]:
    """Async MCP entry-point for trigger_repair."""
    return await asyncio.to_thread(
        handle_trigger_repair, diagnosis_id, data_dir, auto_apply
    )
