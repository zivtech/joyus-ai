"""JSON-based per-profile fidelity score storage with atomic writes."""

from __future__ import annotations

import json
from datetime import datetime
from pathlib import Path

from joyus_profile.models.verification import FidelityScore


class ScoreStore:
    """Append-only score storage organised by profile ID.

    Layout::

        {data_dir}/
            {profile_id}/
                scores.json   # list of serialised FidelityScore dicts
    """

    def __init__(self, data_dir: str) -> None:
        self.data_dir = Path(data_dir)

    # ------------------------------------------------------------------
    # Write
    # ------------------------------------------------------------------

    def append(self, profile_id: str, score: FidelityScore) -> None:
        """Append a score to the profile's score file (atomic write)."""
        path = self._score_file(profile_id)
        path.parent.mkdir(parents=True, exist_ok=True)

        scores = self._read_raw(profile_id)
        scores.append(score.model_dump(mode="json"))

        tmp = path.with_suffix(".tmp")
        tmp.write_text(json.dumps(scores, default=str, indent=2))
        tmp.rename(path)

    # ------------------------------------------------------------------
    # Read
    # ------------------------------------------------------------------

    def get_scores(
        self,
        profile_id: str,
        window_start: datetime | None = None,
        window_end: datetime | None = None,
    ) -> list[FidelityScore]:
        """Return scores for a profile, optionally filtered by time window."""
        raw = self._read_raw(profile_id)
        scores = [FidelityScore.model_validate(r) for r in raw]

        if window_start is not None:
            scores = [s for s in scores if s.timestamp >= window_start]
        if window_end is not None:
            scores = [s for s in scores if s.timestamp <= window_end]

        return scores

    def get_latest(self, profile_id: str, n: int = 10) -> list[FidelityScore]:
        """Return the *n* most recent scores in descending order."""
        scores = self.get_scores(profile_id)
        scores.sort(key=lambda s: s.timestamp, reverse=True)
        return scores[:n]

    # ------------------------------------------------------------------
    # Internal helpers
    # ------------------------------------------------------------------

    def _score_file(self, profile_id: str) -> Path:
        resolved = (self.data_dir / profile_id).resolve()
        if not resolved.is_relative_to(self.data_dir.resolve()):
            raise ValueError(f"Invalid profile_id: {profile_id!r}")
        return resolved / "scores.json"

    def _read_raw(self, profile_id: str) -> list[dict]:
        path = self._score_file(profile_id)
        if not path.exists():
            return []
        try:
            return json.loads(path.read_text())
        except (json.JSONDecodeError, ValueError):
            return []
