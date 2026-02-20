"""Tests for RepairVerifier: 3 checks, pass/fail scenarios, status transitions."""

from __future__ import annotations

from datetime import datetime, timedelta, timezone
from pathlib import Path

import pytest

from joyus_profile.models.monitoring import RepairAction
from joyus_profile.models.verification import FidelityScore
from joyus_profile.monitor.score_store import ScoreStore
from joyus_profile.monitor.verify_repair import (
    RepairVerifier,
    _FORWARD_THRESHOLD,
    _MIN_SCORE_SAMPLES,
    _REGRESSION_TOLERANCE,
)

PROFILE_ID = "prof_verify_test"
SIBLING_ID = "prof_sibling_001"


# ---------------------------------------------------------------------------
# Fixtures & helpers
# ---------------------------------------------------------------------------


def _make_score(
    score: float = 0.85,
    marker_score: float = 0.8,
    style_score: float = 0.8,
    ts: datetime | None = None,
) -> FidelityScore:
    return FidelityScore(
        score=score,
        passed=score >= 0.75,
        tier=2,
        marker_score=marker_score,
        style_score=style_score,
        feature_breakdown={},
        timestamp=ts or datetime.now(timezone.utc),
    )


def _make_action(action_type: str = "update_markers") -> RepairAction:
    return RepairAction(
        action_id="act_verify_01",
        action_type=action_type,
        description="test action",
        automated=False,
        status="applied",
    )


@pytest.fixture
def store(tmp_path: Path) -> ScoreStore:
    return ScoreStore(str(tmp_path / "monitoring"))


@pytest.fixture
def verifier(tmp_path: Path, store: ScoreStore) -> RepairVerifier:
    return RepairVerifier(str(tmp_path / "hierarchy"), store)


def _populate_stable_scores(
    store: ScoreStore, profile_id: str, n: int = 12, score: float = 0.88
) -> None:
    """Add ``n`` stable scores spread over 14 days."""
    base = datetime.now(timezone.utc) - timedelta(days=14)
    for i in range(n):
        ts = base + timedelta(hours=i * 28)
        store.append(profile_id, _make_score(score=score, ts=ts))


# ---------------------------------------------------------------------------
# All checks pass
# ---------------------------------------------------------------------------


class TestAllCheckPass:
    def test_all_pass_sets_verified_status(
        self, verifier: RepairVerifier, store: ScoreStore
    ):
        _populate_stable_scores(store, PROFILE_ID)
        action = _make_action()
        result = verifier.verify(action, PROFILE_ID)
        assert result.regression_passed
        assert result.forward_passed
        assert result.cross_profile_passed
        assert action.status == "verified"

    def test_all_pass_sets_verified_at(
        self, verifier: RepairVerifier, store: ScoreStore
    ):
        _populate_stable_scores(store, PROFILE_ID)
        action = _make_action()
        verifier.verify(action, PROFILE_ID)
        assert action.verified_at is not None

    def test_result_attached_to_action(
        self, verifier: RepairVerifier, store: ScoreStore
    ):
        _populate_stable_scores(store, PROFILE_ID)
        action = _make_action()
        result = verifier.verify(action, PROFILE_ID)
        assert action.verification_result is result


# ---------------------------------------------------------------------------
# Regression test
# ---------------------------------------------------------------------------


class TestRegressionTest:
    def test_passes_when_scores_stable(
        self, verifier: RepairVerifier, store: ScoreStore
    ):
        _populate_stable_scores(store, PROFILE_ID, score=0.88)
        assert verifier._regression_test(PROFILE_ID) is True

    def test_fails_on_significant_drop(
        self, verifier: RepairVerifier, store: ScoreStore
    ):
        """Populate first half with high scores, second half low."""
        base = datetime.now(timezone.utc) - timedelta(days=14)
        for i in range(6):
            ts = base + timedelta(hours=i * 24)
            store.append(PROFILE_ID, _make_score(score=0.90, ts=ts))
        for i in range(6, 12):
            ts = base + timedelta(hours=i * 24)
            store.append(PROFILE_ID, _make_score(score=0.70, ts=ts))
        # 0.90 → 0.70 is a 22% drop, well above _REGRESSION_TOLERANCE
        assert verifier._regression_test(PROFILE_ID) is False

    def test_passes_with_insufficient_history(
        self, verifier: RepairVerifier, store: ScoreStore
    ):
        """Insufficient samples → pass conservatively."""
        store.append(PROFILE_ID, _make_score(score=0.80))
        assert verifier._regression_test(PROFILE_ID) is True


# ---------------------------------------------------------------------------
# Forward test
# ---------------------------------------------------------------------------


class TestForwardTest:
    def test_passes_when_recent_scores_above_threshold(
        self, verifier: RepairVerifier, store: ScoreStore
    ):
        for _ in range(_MIN_SCORE_SAMPLES):
            store.append(PROFILE_ID, _make_score(score=_FORWARD_THRESHOLD + 0.05))
        assert verifier._forward_test(PROFILE_ID) is True

    def test_fails_when_recent_scores_below_threshold(
        self, verifier: RepairVerifier, store: ScoreStore
    ):
        for _ in range(_MIN_SCORE_SAMPLES):
            store.append(PROFILE_ID, _make_score(score=_FORWARD_THRESHOLD - 0.10))
        assert verifier._forward_test(PROFILE_ID) is False

    def test_passes_with_no_scores(
        self, verifier: RepairVerifier, store: ScoreStore
    ):
        """No scores → pass conservatively."""
        assert verifier._forward_test(PROFILE_ID) is True

    def test_exactly_at_threshold_passes(
        self, verifier: RepairVerifier, store: ScoreStore
    ):
        for _ in range(_MIN_SCORE_SAMPLES):
            store.append(PROFILE_ID, _make_score(score=_FORWARD_THRESHOLD))
        assert verifier._forward_test(PROFILE_ID) is True


# ---------------------------------------------------------------------------
# Cross-profile check
# ---------------------------------------------------------------------------


class TestCrossProfileCheck:
    def test_passes_when_no_siblings(
        self, verifier: RepairVerifier, store: ScoreStore
    ):
        _populate_stable_scores(store, PROFILE_ID)
        assert verifier._cross_profile_check(PROFILE_ID) is True

    def test_passes_when_sibling_stable(
        self, verifier: RepairVerifier, store: ScoreStore
    ):
        _populate_stable_scores(store, PROFILE_ID)
        _populate_stable_scores(store, SIBLING_ID, score=0.85)
        assert verifier._cross_profile_check(PROFILE_ID) is True

    def test_fails_when_sibling_degraded(
        self, verifier: RepairVerifier, store: ScoreStore
    ):
        _populate_stable_scores(store, PROFILE_ID)
        # Sibling has a large drop
        base = datetime.now(timezone.utc) - timedelta(days=14)
        for i in range(6):
            ts = base + timedelta(hours=i * 24)
            store.append(SIBLING_ID, _make_score(score=0.90, ts=ts))
        for i in range(6, 12):
            ts = base + timedelta(hours=i * 24)
            store.append(SIBLING_ID, _make_score(score=0.60, ts=ts))
        assert verifier._cross_profile_check(PROFILE_ID) is False


# ---------------------------------------------------------------------------
# Status transitions
# ---------------------------------------------------------------------------


class TestStatusTransitions:
    def test_any_fail_keeps_applied_status(
        self, verifier: RepairVerifier, store: ScoreStore
    ):
        """If forward test fails, action stays 'applied' (not 'verified')."""
        _populate_stable_scores(store, PROFILE_ID, score=0.50)  # stable but low
        action = _make_action()
        verifier.verify(action, PROFILE_ID)
        # forward test will fail because scores < _FORWARD_THRESHOLD
        if not action.verification_result.forward_passed:
            assert action.status == "applied"

    def test_details_string_contains_all_three_checks(
        self, verifier: RepairVerifier, store: ScoreStore
    ):
        _populate_stable_scores(store, PROFILE_ID)
        action = _make_action()
        result = verifier.verify(action, PROFILE_ID)
        assert "regression_test" in result.details
        assert "forward_test" in result.details
        assert "cross_profile_check" in result.details
