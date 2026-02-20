"""Configurable drift detection thresholds per profile."""

from __future__ import annotations

import json
from pathlib import Path

from joyus_profile.models.monitoring import DriftConfig


def load_config(data_dir: str, profile_id: str) -> DriftConfig:
    """Load drift config for a profile, falling back to defaults.

    Looks for ``monitoring/{profile_id}/config.json``.  If the file does not
    exist or cannot be parsed, returns the default ``DriftConfig``.
    """
    config_path = Path(data_dir) / profile_id / "config.json"
    if not config_path.exists():
        return DriftConfig()

    try:
        raw = json.loads(config_path.read_text())
        return DriftConfig.model_validate(raw)
    except (json.JSONDecodeError, ValueError):
        return DriftConfig()


def save_config(data_dir: str, profile_id: str, config: DriftConfig) -> None:
    """Persist a drift config for a profile."""
    config_dir = Path(data_dir) / profile_id
    config_dir.mkdir(parents=True, exist_ok=True)
    path = config_dir / "config.json"
    tmp = path.with_suffix(".tmp")
    tmp.write_text(json.dumps(config.model_dump(), indent=2))
    tmp.rename(path)
