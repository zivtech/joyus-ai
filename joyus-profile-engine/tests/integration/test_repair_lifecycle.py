"""Repair lifecycle integration tests (T072).

Covers: propose → approve → apply → verify → verified/reverted, automated vs
manual repairs, and rejection.
"""

from __future__ import annotations

import os
import sys

import pytest

from joyus_profile.models.monitoring import DriftDiagnosis, RepairAction
from joyus_profile.monitor.repair import RepairFramework
from joyus_profile.monitor.score_store import ScoreStore
from joyus_profile.monitor.verify_repair import RepairVerifier

sys.path.insert(
    0,
    os.path.join(os.path.dirname(__file__), "..", "unit", "test_monitor"),
)
from conftest import make_score  # noqa: E402

PROFILE_ID = "repair_test_profile"


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def make_diagnosis(
    cause: str = "vocabulary_shift",
    profile_id: str = PROFILE_ID,
    action_type: str | None = None,
) -> DriftDiagnosis:
    """Build a minimal DriftDiagnosis for testing."""
    from datetime import datetime, timezone

    from cuid2 import cuid_wrapper

    _cuid = cuid_wrapper()

    # Derive action_type from cause using the same mapping as DiagnosisEngine
    _cause_to_action = {
        "position_change": "update_positions",
        "vocabulary_shift": "update_markers",
        "corpus_evolution": "rebuild_profile",
        "model_update": "recalibrate_thresholds",
        "profile_staleness": "update_corpus",
        "unknown": "escalate",
    }
    if action_type is None:
        action_type = _cause_to_action.get(cause, "escalate")

    automated = action_type == "recalibrate_thresholds"

    recommended = RepairAction(
        action_id=_cuid(),
        action_type=action_type,
        description=f"Action for {cause}",
        automated=automated,
        status="proposed",
    )
    return DriftDiagnosis(
        diagnosis_id=_cuid(),
        profile_id=profile_id,
        detection_date=datetime.now(timezone.utc),
        severity="medium",
        signals=[],
        affected_features=[],
        probable_cause=cause,
        recommended_action=recommended,
        diagnosed_at=datetime.now(timezone.utc),
    )


# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------


@pytest.fixture()
def data_dir(tmp_path):
    d = tmp_path / "repair_lifecycle"
    d.mkdir()
    return str(d)


@pytest.fixture()
def repair_framework(data_dir):
    return RepairFramework(data_dir)


@pytest.fixture()
def score_store(data_dir):
    return ScoreStore(data_dir)


@pytest.fixture()
def verifier(data_dir, score_store):
    return RepairVerifier(data_dir, score_store)


# ---------------------------------------------------------------------------
# Tests
# ---------------------------------------------------------------------------


class TestRepairLifecycle:
    def test_full_repair_happy_path(self, repair_framework, verifier, score_store):
        """Propose → approve → apply → verify → status=verified."""
        # Populate passing scores so the verifier's forward test passes.
        from datetime import datetime, timedelta, timezone

        for i in range(8):
            score_store.append(
                PROFILE_ID,
                make_score(
                    score=0.85,
                    timestamp=datetime.now(timezone.utc) - timedelta(hours=i),
                ),
            )

        # 1. Propose
        diagnosis = make_diagnosis(cause="vocabulary_shift")
        action = repair_framework.propose(diagnosis)
        assert action.status == "proposed"
        assert not action.automated  # update_markers is not automated

        # 2. Approve
        action = repair_framework.approve(action.action_id)
        assert action.status == "approved"

        # 3. Apply
        action = repair_framework.apply(action.action_id)
        assert action.status == "applied"

        # 4. Verify (all checks pass with good scores in the store)
        result = verifier.verify(action, PROFILE_ID)
        assert result.regression_passed
        assert result.forward_passed
        assert result.cross_profile_passed
        assert action.status == "verified"

    def test_repair_verification_failure_triggers_revert(
        self, repair_framework, score_store, data_dir
    ):
        """When forward verification fails, revert the repair."""
        from datetime import datetime, timedelta, timezone

        # Insert low scores that will fail the forward_test (threshold 0.80)
        for i in range(8):
            score_store.append(
                PROFILE_ID,
                make_score(
                    score=0.50,
                    timestamp=datetime.now(timezone.utc) - timedelta(hours=i),
                ),
            )

        verifier = RepairVerifier(data_dir, score_store)
        diagnosis = make_diagnosis(cause="vocabulary_shift")
        action = repair_framework.propose(diagnosis)
        action = repair_framework.approve(action.action_id)
        action = repair_framework.apply(action.action_id)

        result = verifier.verify(action, PROFILE_ID)
        # Forward test should fail (scores below 0.80 threshold)
        assert not result.forward_passed

        # Caller is responsible for revert when verification fails
        action = repair_framework.revert(action.action_id)
        assert action.status == "reverted"

    def test_automated_repair_skips_approval(self, repair_framework):
        """recalibrate_thresholds is automated and can skip approval."""
        diagnosis = make_diagnosis(cause="model_update")  # → recalibrate_thresholds
        action = repair_framework.propose(diagnosis)
        assert action.automated

        # Apply directly from "proposed" state (automated bypass)
        action = repair_framework.apply(action.action_id)
        assert action.status == "applied"

    def test_non_automated_repair_requires_approval(self, repair_framework):
        """rebuild_profile cannot be applied without approval."""
        diagnosis = make_diagnosis(cause="profile_staleness")  # → update_corpus
        action = repair_framework.propose(diagnosis)
        assert not action.automated

        with pytest.raises(ValueError, match="require"):
            repair_framework.apply(action.action_id)

    def test_reject_repair(self, repair_framework):
        """Rejected repairs stay in rejected state."""
        action = repair_framework.propose(make_diagnosis())
        action = repair_framework.reject(action.action_id, "Not appropriate")
        assert action.status == "rejected"

    def test_approve_already_approved_raises(self, repair_framework):
        """Approving an already-approved action raises ValueError."""
        diagnosis = make_diagnosis(cause="vocabulary_shift")
        action = repair_framework.propose(diagnosis)
        action = repair_framework.approve(action.action_id)
        with pytest.raises(ValueError):
            repair_framework.approve(action.action_id)

    def test_revert_unapplied_raises(self, repair_framework):
        """Reverting a proposed (not yet applied) action raises ValueError."""
        action = repair_framework.propose(make_diagnosis())
        with pytest.raises(ValueError):
            repair_framework.revert(action.action_id)
