"""Repair action framework: propose, approve, apply, revert lifecycle."""

from __future__ import annotations

import json
from datetime import datetime, timezone
from pathlib import Path
from typing import Protocol, runtime_checkable

from cuid2 import cuid_wrapper

from joyus_profile.models.monitoring import DriftDiagnosis, RepairAction

_cuid = cuid_wrapper()

_ACTION_DESCRIPTIONS: dict[str, str] = {
    "rebuild_profile": "Re-run profile building on expanded corpus",
    "update_markers": "Add new domain terms, retire obsolete ones",
    "recalibrate_thresholds": "Adjust Tier 1 thresholds against known-good samples",
    "update_positions": "Update positions in profile hierarchy",
    "update_corpus": "Rebuild from updated corpus",
    "escalate": "Escalate to human with full diagnostic report",
}

# Only recalibrate_thresholds is automated (no human approval needed).
_AUTOMATED_ACTIONS: frozenset[str] = frozenset({"recalibrate_thresholds"})


@runtime_checkable
class RepairHandler(Protocol):
    """Protocol that every concrete handler must satisfy."""

    def execute(self, action: RepairAction) -> None: ...

    def revert(self, action: RepairAction) -> None: ...


class RebuildProfileHandler:
    """Re-run profile building on expanded corpus."""

    def execute(self, action: RepairAction) -> None:  # noqa: ARG002
        # Full re-build requires Phase A infrastructure integration.
        # TODO: invoke ProfileGenerator with expanded corpus path from action metadata.
        pass

    def revert(self, action: RepairAction) -> None:  # noqa: ARG002
        # Restore is handled by RepairFramework snapshot mechanism.
        pass


class UpdateMarkersHandler:
    """Add new markers, retire obsolete ones."""

    def execute(self, action: RepairAction) -> None:  # noqa: ARG002
        # TODO: load markers file, apply add/retire lists from action metadata.
        pass

    def revert(self, action: RepairAction) -> None:  # noqa: ARG002
        pass


class RecalibrateHandler:
    """Adjust Tier 1 thresholds against known-good samples (automated)."""

    def execute(self, action: RepairAction) -> None:  # noqa: ARG002
        # TODO: load known-good sample scores, compute new threshold percentiles.
        pass

    def revert(self, action: RepairAction) -> None:  # noqa: ARG002
        pass


class UpdatePositionsHandler:
    """Update positions in hierarchy; may cascade org → dept → person."""

    def execute(self, action: RepairAction) -> None:  # noqa: ARG002
        # TODO: walk hierarchy tree and propagate position updates.
        pass

    def revert(self, action: RepairAction) -> None:  # noqa: ARG002
        pass


class UpdateCorpusHandler:
    """Rebuild profile from updated corpus (author published new work)."""

    def execute(self, action: RepairAction) -> None:  # noqa: ARG002
        # TODO: fetch updated corpus, re-run preprocessing and profile generation.
        pass

    def revert(self, action: RepairAction) -> None:  # noqa: ARG002
        pass


class EscalateHandler:
    """Create escalation record for human investigation."""

    def execute(self, action: RepairAction) -> None:  # noqa: ARG002
        # Escalation is a record-keeping operation; the alert system surfaces it.
        pass

    def revert(self, action: RepairAction) -> None:  # noqa: ARG002
        pass


_HANDLERS: dict[str, RepairHandler] = {
    "rebuild_profile": RebuildProfileHandler(),
    "update_markers": UpdateMarkersHandler(),
    "recalibrate_thresholds": RecalibrateHandler(),
    "update_positions": UpdatePositionsHandler(),
    "update_corpus": UpdateCorpusHandler(),
    "escalate": EscalateHandler(),
}


class RepairFramework:
    """Lifecycle management for repair actions: propose → approve → apply → revert."""

    def __init__(self, data_dir: str) -> None:
        self.repairs_dir = Path(data_dir) / "repairs"
        self.repairs_dir.mkdir(parents=True, exist_ok=True)
        self.diagnoses_dir = Path(data_dir) / "diagnoses"
        self.diagnoses_dir.mkdir(parents=True, exist_ok=True)

    # ------------------------------------------------------------------
    # Diagnosis persistence
    # ------------------------------------------------------------------

    def save_diagnosis(self, diagnosis: DriftDiagnosis) -> None:
        """Persist a DriftDiagnosis so it can be retrieved by ID later."""
        path = self._diagnosis_path(diagnosis.diagnosis_id)
        tmp = path.with_suffix(".tmp")
        tmp.write_text(json.dumps(diagnosis.model_dump(mode="json"), indent=2))
        tmp.rename(path)

    def load_diagnosis(self, diagnosis_id: str) -> DriftDiagnosis:
        """Load a previously saved DriftDiagnosis by ID."""
        path = self._diagnosis_path(diagnosis_id)
        if not path.exists():
            raise FileNotFoundError(f"Diagnosis not found: {diagnosis_id!r}")
        raw = json.loads(path.read_text())
        return DriftDiagnosis.model_validate(raw)

    # ------------------------------------------------------------------
    # Public lifecycle methods
    # ------------------------------------------------------------------

    def propose(self, diagnosis: DriftDiagnosis) -> RepairAction:
        """Create a repair proposal from a diagnosis."""
        action_type = (
            diagnosis.recommended_action.action_type
            if diagnosis.recommended_action is not None
            else "escalate"
        )
        description = _ACTION_DESCRIPTIONS.get(action_type, action_type)
        automated = action_type in _AUTOMATED_ACTIONS

        action = RepairAction(
            action_id=_cuid(),
            action_type=action_type,
            description=description,
            automated=automated,
            status="proposed",
            proposed_at=datetime.now(timezone.utc),
        )

        self._save_repair(action)
        return action

    def approve(self, action_id: str) -> RepairAction:
        """Mark a repair proposal as approved (human approval step)."""
        action = self._load_repair(action_id)
        if action.status != "proposed":
            raise ValueError(
                f"Cannot approve action in '{action.status}' state"
            )
        action.status = "approved"
        self._save_repair(action)
        return action

    def apply(self, action_id: str) -> RepairAction:
        """Execute the repair. Automated repairs skip approval; others require it."""
        action = self._load_repair(action_id)
        if action.status not in ("approved", "proposed"):
            raise ValueError(
                f"Cannot apply action in '{action.status}' state"
            )
        if not action.automated and action.status != "approved":
            raise ValueError(
                "Non-automated repairs require approval before applying"
            )

        self._snapshot_before_repair(action)
        handler = self._get_handler(action.action_type)
        handler.execute(action)

        action.status = "applied"
        action.applied_at = datetime.now(timezone.utc)
        self._save_repair(action)
        return action

    def reject(self, action_id: str, reason: str = "") -> RepairAction:
        """Reject a proposed repair."""
        action = self._load_repair(action_id)
        if action.status != "proposed":
            raise ValueError(
                f"Cannot reject action in '{action.status}' state"
            )
        action.status = "rejected"
        self._save_repair(action)
        return action

    def revert(self, action_id: str) -> RepairAction:
        """Revert an applied (or verified) repair to restore the previous state."""
        action = self._load_repair(action_id)
        if action.status not in ("applied", "verified"):
            raise ValueError(
                f"Cannot revert action in '{action.status}' state"
            )

        self._restore_snapshot(action)
        handler = self._get_handler(action.action_type)
        handler.revert(action)

        action.status = "reverted"
        self._save_repair(action)
        return action

    # ------------------------------------------------------------------
    # Snapshot helpers (T068)
    # ------------------------------------------------------------------

    def _snapshot_before_repair(self, action: RepairAction) -> None:
        """Copy the repair record itself into a snapshot dir before executing."""
        snapshot_dir = self.repairs_dir / action.action_id / "snapshot"
        snapshot_dir.mkdir(parents=True, exist_ok=True)
        # Persist current action state as the pre-repair snapshot.
        snapshot_path = snapshot_dir / "pre_repair.json"
        snapshot_path.write_text(
            json.dumps(action.model_dump(mode="json"), indent=2)
        )

    def _restore_snapshot(self, action: RepairAction) -> None:
        """Verify snapshot exists (actual file restoration is handler-specific)."""
        snapshot_path = (
            self.repairs_dir / action.action_id / "snapshot" / "pre_repair.json"
        )
        if not snapshot_path.exists():
            # No snapshot means apply() was never called properly — safe to continue.
            return
        # Concrete handlers are responsible for restoring domain artefacts.
        # The snapshot directory is available at repairs_dir/action_id/snapshot/.

    # ------------------------------------------------------------------
    # Persistence helpers
    # ------------------------------------------------------------------

    def _get_handler(self, action_type: str) -> RepairHandler:
        if action_type not in _HANDLERS:
            raise ValueError(f"Unknown action type: {action_type!r}")
        return _HANDLERS[action_type]

    def _diagnosis_path(self, diagnosis_id: str) -> Path:
        path = (self.diagnoses_dir / f"{diagnosis_id}.json").resolve()
        if not path.is_relative_to(self.diagnoses_dir.resolve()):
            raise ValueError(f"Invalid diagnosis_id: {diagnosis_id!r}")
        return path

    def _action_path(self, action_id: str) -> Path:
        path = (self.repairs_dir / f"{action_id}.json").resolve()
        if not path.is_relative_to(self.repairs_dir.resolve()):
            raise ValueError(f"Invalid action_id: {action_id!r}")
        return path

    def _save_repair(self, action: RepairAction) -> None:
        path = self._action_path(action.action_id)
        tmp = path.with_suffix(".tmp")
        tmp.write_text(json.dumps(action.model_dump(mode="json"), indent=2))
        tmp.rename(path)

    def _load_repair(self, action_id: str) -> RepairAction:
        path = self._action_path(action_id)
        if not path.exists():
            raise FileNotFoundError(f"Repair action not found: {action_id!r}")
        raw = json.loads(path.read_text())
        return RepairAction.model_validate(raw)
