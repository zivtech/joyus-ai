"""Tests for RepairFramework: full lifecycle, approve/reject, auto-apply, revert."""

from __future__ import annotations

import json
from pathlib import Path

import pytest

from joyus_profile.models.monitoring import DriftDiagnosis, RepairAction
from joyus_profile.monitor.repair import RepairFramework

PROFILE_ID = "prof_repair_test"


# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------


@pytest.fixture
def framework(tmp_path: Path) -> RepairFramework:
    return RepairFramework(str(tmp_path / "monitoring"))


def _make_diagnosis(action_type: str = "update_markers") -> DriftDiagnosis:
    action = RepairAction(
        action_id="act_seed",
        action_type=action_type,
        description="seed action",
        automated=(action_type == "recalibrate_thresholds"),
        status="proposed",
    )
    return DriftDiagnosis(
        diagnosis_id="diag_001",
        profile_id=PROFILE_ID,
        severity="medium",
        probable_cause="vocabulary_shift",
        recommended_action=action,
    )


# ---------------------------------------------------------------------------
# propose()
# ---------------------------------------------------------------------------


class TestPropose:
    def test_propose_creates_proposed_status(self, framework: RepairFramework):
        action = framework.propose(_make_diagnosis())
        assert action.status == "proposed"

    def test_propose_persists_to_disk(self, framework: RepairFramework):
        action = framework.propose(_make_diagnosis())
        path = framework.repairs_dir / f"{action.action_id}.json"
        assert path.exists()

    def test_propose_returns_action_with_correct_type(self, framework: RepairFramework):
        action = framework.propose(_make_diagnosis("rebuild_profile"))
        assert action.action_type == "rebuild_profile"

    def test_propose_automated_false_for_manual_types(self, framework: RepairFramework):
        action = framework.propose(_make_diagnosis("update_markers"))
        assert action.automated is False

    def test_propose_automated_true_for_recalibrate(self, framework: RepairFramework):
        action = framework.propose(_make_diagnosis("recalibrate_thresholds"))
        assert action.automated is True

    def test_propose_unique_action_ids(self, framework: RepairFramework):
        a1 = framework.propose(_make_diagnosis())
        a2 = framework.propose(_make_diagnosis())
        assert a1.action_id != a2.action_id


# ---------------------------------------------------------------------------
# approve()
# ---------------------------------------------------------------------------


class TestApprove:
    def test_approve_transitions_to_approved(self, framework: RepairFramework):
        action = framework.propose(_make_diagnosis())
        approved = framework.approve(action.action_id)
        assert approved.status == "approved"

    def test_approve_persists(self, framework: RepairFramework):
        action = framework.propose(_make_diagnosis())
        framework.approve(action.action_id)
        loaded = framework._load_repair(action.action_id)
        assert loaded.status == "approved"

    def test_approve_already_approved_raises(self, framework: RepairFramework):
        action = framework.propose(_make_diagnosis())
        framework.approve(action.action_id)
        with pytest.raises(ValueError, match="approved"):
            framework.approve(action.action_id)

    def test_approve_applied_raises(self, framework: RepairFramework):
        action = framework.propose(_make_diagnosis("recalibrate_thresholds"))
        framework.apply(action.action_id)  # automated can apply directly
        with pytest.raises(ValueError):
            framework.approve(action.action_id)


# ---------------------------------------------------------------------------
# apply()
# ---------------------------------------------------------------------------


class TestApply:
    def test_apply_approved_transitions_to_applied(self, framework: RepairFramework):
        action = framework.propose(_make_diagnosis())
        framework.approve(action.action_id)
        applied = framework.apply(action.action_id)
        assert applied.status == "applied"

    def test_apply_sets_applied_at(self, framework: RepairFramework):
        action = framework.propose(_make_diagnosis())
        framework.approve(action.action_id)
        applied = framework.apply(action.action_id)
        assert applied.applied_at is not None

    def test_apply_automated_without_approval(self, framework: RepairFramework):
        """Automated repairs (recalibrate_thresholds) can skip approval."""
        action = framework.propose(_make_diagnosis("recalibrate_thresholds"))
        applied = framework.apply(action.action_id)
        assert applied.status == "applied"

    def test_apply_non_automated_without_approval_raises(
        self, framework: RepairFramework
    ):
        action = framework.propose(_make_diagnosis("update_markers"))
        with pytest.raises(ValueError, match="approval"):
            framework.apply(action.action_id)

    def test_apply_creates_snapshot(self, framework: RepairFramework):
        action = framework.propose(_make_diagnosis())
        framework.approve(action.action_id)
        framework.apply(action.action_id)
        snapshot = (
            framework.repairs_dir / action.action_id / "snapshot" / "pre_repair.json"
        )
        assert snapshot.exists()

    def test_apply_snapshot_is_valid_json(self, framework: RepairFramework):
        action = framework.propose(_make_diagnosis())
        framework.approve(action.action_id)
        framework.apply(action.action_id)
        snapshot = (
            framework.repairs_dir / action.action_id / "snapshot" / "pre_repair.json"
        )
        data = json.loads(snapshot.read_text())
        assert "action_id" in data

    def test_apply_rejected_raises(self, framework: RepairFramework):
        action = framework.propose(_make_diagnosis())
        framework.reject(action.action_id)
        with pytest.raises(ValueError):
            framework.apply(action.action_id)


# ---------------------------------------------------------------------------
# reject()
# ---------------------------------------------------------------------------


class TestReject:
    def test_reject_transitions_to_rejected(self, framework: RepairFramework):
        action = framework.propose(_make_diagnosis())
        rejected = framework.reject(action.action_id, reason="not needed")
        assert rejected.status == "rejected"

    def test_reject_persists(self, framework: RepairFramework):
        action = framework.propose(_make_diagnosis())
        framework.reject(action.action_id)
        loaded = framework._load_repair(action.action_id)
        assert loaded.status == "rejected"

    def test_reject_approved_raises(self, framework: RepairFramework):
        action = framework.propose(_make_diagnosis())
        framework.approve(action.action_id)
        with pytest.raises(ValueError):
            framework.reject(action.action_id)


# ---------------------------------------------------------------------------
# revert() — T068
# ---------------------------------------------------------------------------


class TestRevert:
    def _apply_action(
        self, framework: RepairFramework, action_type: str = "update_markers"
    ) -> RepairAction:
        action = framework.propose(_make_diagnosis(action_type))
        framework.approve(action.action_id)
        return framework.apply(action.action_id)

    def test_revert_applied_transitions_to_reverted(self, framework: RepairFramework):
        action = self._apply_action(framework)
        reverted = framework.revert(action.action_id)
        assert reverted.status == "reverted"

    def test_revert_persists(self, framework: RepairFramework):
        action = self._apply_action(framework)
        framework.revert(action.action_id)
        loaded = framework._load_repair(action.action_id)
        assert loaded.status == "reverted"

    def test_revert_proposed_raises(self, framework: RepairFramework):
        action = framework.propose(_make_diagnosis())
        with pytest.raises(ValueError, match="proposed"):
            framework.revert(action.action_id)

    def test_revert_rejected_raises(self, framework: RepairFramework):
        action = framework.propose(_make_diagnosis())
        framework.reject(action.action_id)
        with pytest.raises(ValueError):
            framework.revert(action.action_id)

    def test_revert_verified_also_transitions(self, framework: RepairFramework):
        """Verified repairs can also be reverted."""
        action = self._apply_action(framework)
        action.status = "verified"
        framework._save_repair(action)
        reverted = framework.revert(action.action_id)
        assert reverted.status == "reverted"

    def test_revert_automated_repair(self, framework: RepairFramework):
        action = framework.propose(_make_diagnosis("recalibrate_thresholds"))
        framework.apply(action.action_id)  # no approval needed
        reverted = framework.revert(action.action_id)
        assert reverted.status == "reverted"
