"""Shared fixtures for monitoring tests."""

from __future__ import annotations

from datetime import datetime, timedelta, timezone

import pytest

from joyus_profile.models.monitoring import DriftConfig, DriftSignal
from joyus_profile.models.verification import FidelityScore
from joyus_profile.monitor.alerts import AlertGenerator
from joyus_profile.monitor.drift_detector import DriftDetector
from joyus_profile.monitor.pipeline import MonitoringPipeline
from joyus_profile.monitor.rollups import RollupEngine
from joyus_profile.monitor.score_store import ScoreStore

PROFILE_ID = "prof_test_001"


def make_score(
    score: float = 0.8,
    marker_score: float = 0.7,
    style_score: float = 0.75,
    passed: bool = True,
    tier: int = 2,
    timestamp: datetime | None = None,
    feature_breakdown: dict[str, float] | None = None,
    feedback: str | None = None,
) -> FidelityScore:
    """Factory for FidelityScore with sensible defaults."""
    return FidelityScore(
        score=score,
        passed=passed,
        tier=tier,
        marker_score=marker_score,
        style_score=style_score,
        feature_breakdown=feature_breakdown or {},
        feedback=feedback,
        timestamp=timestamp or datetime.now(timezone.utc),
    )


def make_signal(
    profile_id: str = PROFILE_ID,
    signal_type: str = "fidelity_decline",
    severity: str = "low",
    current_value: float = 0.7,
    baseline_value: float = 0.85,
    deviation: float = 0.15,
) -> DriftSignal:
    """Factory for DriftSignal with sensible defaults."""
    return DriftSignal(
        signal_id="sig_test_001",
        profile_id=profile_id,
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
def data_dir(tmp_path):
    """Temporary data directory for score storage."""
    d = tmp_path / "monitoring"
    d.mkdir()
    return str(d)


@pytest.fixture
def score_store(data_dir):
    return ScoreStore(data_dir)


@pytest.fixture
def default_config():
    return DriftConfig()


@pytest.fixture
def drift_detector(score_store, default_config):
    return DriftDetector(score_store, default_config)


@pytest.fixture
def alert_generator(data_dir):
    return AlertGenerator(data_dir)


@pytest.fixture
def rollup_engine(score_store):
    return RollupEngine(score_store)


@pytest.fixture
def pipeline(score_store, drift_detector, alert_generator):
    return MonitoringPipeline(
        score_store=score_store,
        drift_detector=drift_detector,
        alert_generator=alert_generator,
    )
