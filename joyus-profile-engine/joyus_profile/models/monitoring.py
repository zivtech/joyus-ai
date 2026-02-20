"""Fidelity monitoring, drift detection, and repair data models."""

from __future__ import annotations

from datetime import date, datetime, timezone
from enum import Enum

from pydantic import BaseModel, Field


class Severity(str, Enum):
    """Alert and signal severity levels."""

    LOW = "low"
    MEDIUM = "medium"
    HIGH = "high"
    CRITICAL = "critical"


class DriftSignal(BaseModel):
    """A detected quality drift for a specific profile."""

    signal_id: str
    profile_id: str
    signal_type: str
    severity: str = "medium"
    current_value: float = 0.0
    baseline_value: float = 0.0
    deviation: float = 0.0
    window_start: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))
    window_end: datetime | None = None
    sample_count: int = 0


class DriftedFeature(BaseModel):
    """A single feature that has drifted."""

    feature_name: str
    description: str = ""
    baseline_value: float = 0.0
    current_value: float = 0.0
    deviation_pct: float = 0.0


class RepairVerification(BaseModel):
    """Verification after a repair is applied."""

    regression_passed: bool = False
    forward_passed: bool = False
    cross_profile_passed: bool = False
    details: str = ""


class RepairAction(BaseModel):
    """A proposed repair for detected drift."""

    action_id: str
    action_type: str
    description: str = ""
    automated: bool = False
    status: str = "proposed"
    proposed_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))
    applied_at: datetime | None = None
    verified_at: datetime | None = None
    verification_result: RepairVerification | None = None


class DriftDiagnosis(BaseModel):
    """Diagnosis of detected drift."""

    diagnosis_id: str
    profile_id: str
    detection_date: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))
    severity: str = "medium"
    signals: list[DriftSignal] = Field(default_factory=list)
    affected_features: list[DriftedFeature] = Field(default_factory=list)
    probable_cause: str = "unknown"
    recommended_action: RepairAction | None = None
    diagnosed_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))


# --- WP12: Monitoring pipeline, rollups, alerts ---


class MonitoringJob(BaseModel):
    """A queued job for Tier 2 deep analysis."""

    job_id: str
    content: str
    profile_id: str
    voice_key: str | None = None
    queued_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))


class MonitoringResult(BaseModel):
    """Result of processing a single monitoring job."""

    job_id: str
    score: float = 0.0
    marker_score: float = 0.0
    style_score: float = 0.0
    feature_breakdown: dict[str, float] = Field(default_factory=dict)
    feedback: str | None = None
    passed: bool = True
    drift_signals: list[DriftSignal] = Field(default_factory=list)
    processed_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))


class SeverityRule(BaseModel):
    """Rule mapping signal count to minimum severity."""

    signal_count: int
    min_severity: str = "low"


class DriftConfig(BaseModel):
    """Drift detection configuration. Override per-profile as needed."""

    window_days: int = 14
    min_samples: int = 5

    # Signal 1: Fidelity decline
    fidelity_decline_pct: float = 0.05  # 5% decline triggers

    # Signal 2: Marker shift
    marker_shift_pct: float = 0.20  # 20% drop in marker usage

    # Signal 3: Stylometric distance
    stylometric_multiplier: float = 1.5  # 1.5x self-distance std

    # Signal 4: Negative markers
    negative_zero_tolerance: bool = True  # Any increase triggers

    # Signal 5: Inconsistency
    inconsistency_multiplier: float = 2.0  # 2x historical variance

    # Severity mapping
    severity_rules: list[SeverityRule] = Field(
        default_factory=lambda: [
            SeverityRule(signal_count=1, min_severity="low"),
            SeverityRule(signal_count=2, min_severity="medium"),
            SeverityRule(signal_count=3, min_severity="high"),
            SeverityRule(signal_count=4, min_severity="critical"),
        ]
    )


class DailyRollup(BaseModel):
    """Aggregated fidelity scores for a single day."""

    date: date
    count: int = 0
    mean: float | None = None
    std: float | None = None
    min: float | None = None
    max: float | None = None


class WeeklyRollup(BaseModel):
    """Aggregated fidelity scores for a 7-day week."""

    week_start: date
    week_end: date
    count: int = 0
    mean: float | None = None
    std: float | None = None
    min: float | None = None
    max: float | None = None
    daily_rollups: list[DailyRollup] = Field(default_factory=list)


class TrendData(BaseModel):
    """Trend analysis result for a profile over a time window."""

    profile_id: str
    window_days: int = 30
    granularity: str = "daily"
    overall_mean: float | None = None
    overall_std: float | None = None
    trend_slope: float | None = None
    sample_count: int = 0
    daily_rollups: list[DailyRollup] = Field(default_factory=list)
    weekly_rollups: list[WeeklyRollup] = Field(default_factory=list)


class Alert(BaseModel):
    """An alert generated from drift detection."""

    alert_id: str
    profile_id: str
    severity: str = "medium"
    signals: list[DriftSignal] = Field(default_factory=list)
    summary: str = ""
    created_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))
    acknowledged: bool = False
    requires_immediate: bool = False
