"""Fidelity monitoring, drift detection, and repair data models."""

from __future__ import annotations

from datetime import datetime

from pydantic import BaseModel, Field


class DriftSignal(BaseModel):
    """A detected quality drift for a specific profile."""

    signal_id: str
    profile_id: str
    signal_type: str
    severity: str = "medium"
    current_value: float = 0.0
    baseline_value: float = 0.0
    deviation: float = 0.0
    window_start: datetime = Field(default_factory=datetime.now)
    window_end: datetime = Field(default_factory=datetime.now)
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
    proposed_at: datetime = Field(default_factory=datetime.now)
    applied_at: datetime | None = None
    verified_at: datetime | None = None
    verification_result: RepairVerification | None = None


class DriftDiagnosis(BaseModel):
    """Diagnosis of detected drift."""

    diagnosis_id: str
    profile_id: str
    detection_date: datetime = Field(default_factory=datetime.now)
    severity: str = "medium"
    signals: list[DriftSignal] = Field(default_factory=list)
    affected_features: list[DriftedFeature] = Field(default_factory=list)
    probable_cause: str = "unknown"
    recommended_action: RepairAction | None = None
    diagnosed_at: datetime = Field(default_factory=datetime.now)
