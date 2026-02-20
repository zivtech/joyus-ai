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
    base = Path(data_dir).resolve()
    config_path = (base / profile_id / "config.json")
    if not config_path.resolve().is_relative_to(base):
        raise ValueError(f"Invalid profile_id: {profile_id!r}")
    config_path = config_path.resolve()
    if not config_path.exists():
        return DriftConfig()

    try:
        raw = json.loads(config_path.read_text())
        return DriftConfig.model_validate(raw)
    except (json.JSONDecodeError, ValueError):
        return DriftConfig()


def save_config(data_dir: str, profile_id: str, config: DriftConfig) -> None:
    """Persist a drift config for a profile."""
    base = Path(data_dir).resolve()
    config_dir = (base / profile_id).resolve()
    if not config_dir.is_relative_to(base):
        raise ValueError(f"Invalid profile_id: {profile_id!r}")
    config_dir.mkdir(parents=True, exist_ok=True)
    path = config_dir / "config.json"
    tmp = path.with_suffix(".tmp")
    tmp.write_text(json.dumps(config.model_dump(), indent=2))
    tmp.rename(path)
