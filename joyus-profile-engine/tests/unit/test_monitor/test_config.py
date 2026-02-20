"""Tests for DriftConfig: defaults, overrides, validation."""

from __future__ import annotations

import json
from pathlib import Path

from joyus_profile.models.monitoring import DriftConfig, SeverityRule
from joyus_profile.monitor.config import load_config, save_config

from .conftest import PROFILE_ID


class TestDefaultConfig:
    def test_defaults(self):
        config = DriftConfig()
        assert config.window_days == 14
        assert config.min_samples == 5
        assert config.fidelity_decline_pct == 0.05
        assert config.marker_shift_pct == 0.20
        assert config.stylometric_multiplier == 1.5
        assert config.negative_zero_tolerance is True
        assert config.inconsistency_multiplier == 2.0
        assert len(config.severity_rules) == 4

    def test_severity_rules_ordering(self):
        config = DriftConfig()
        counts = [r.signal_count for r in config.severity_rules]
        assert counts == [1, 2, 3, 4]


class TestLoadConfig:
    def test_loads_from_file(self, data_dir):
        config_dir = Path(data_dir) / PROFILE_ID
        config_dir.mkdir(parents=True, exist_ok=True)
        config_file = config_dir / "config.json"
        config_file.write_text(json.dumps({
            "window_days": 7,
            "min_samples": 3,
            "fidelity_decline_pct": 0.10,
        }))

        config = load_config(data_dir, PROFILE_ID)
        assert config.window_days == 7
        assert config.min_samples == 3
        assert config.fidelity_decline_pct == 0.10
        # Other fields keep defaults
        assert config.marker_shift_pct == 0.20

    def test_fallback_to_defaults(self, data_dir):
        config = load_config(data_dir, "nonexistent_profile")
        assert config.window_days == 14
        assert config.min_samples == 5

    def test_invalid_json_fallback(self, data_dir):
        config_dir = Path(data_dir) / PROFILE_ID
        config_dir.mkdir(parents=True, exist_ok=True)
        (config_dir / "config.json").write_text("not json at all")

        config = load_config(data_dir, PROFILE_ID)
        assert config.window_days == 14  # Falls back to defaults


class TestSaveConfig:
    def test_save_and_reload(self, data_dir):
        config = DriftConfig(window_days=21, min_samples=10)
        save_config(data_dir, PROFILE_ID, config)

        loaded = load_config(data_dir, PROFILE_ID)
        assert loaded.window_days == 21
        assert loaded.min_samples == 10

    def test_save_creates_directory(self, data_dir):
        config = DriftConfig()
        save_config(data_dir, "new_profile", config)

        path = Path(data_dir) / "new_profile" / "config.json"
        assert path.exists()


class TestValidation:
    def test_custom_severity_rules(self):
        config = DriftConfig(
            severity_rules=[
                SeverityRule(signal_count=1, min_severity="medium"),
                SeverityRule(signal_count=2, min_severity="critical"),
            ]
        )
        assert len(config.severity_rules) == 2
        assert config.severity_rules[1].min_severity == "critical"

    def test_negative_window_days_allowed(self):
        # Pydantic doesn't constrain this by default; just verify it stores
        config = DriftConfig(window_days=0)
        assert config.window_days == 0

    def test_model_dump_roundtrip(self):
        config = DriftConfig(window_days=7, fidelity_decline_pct=0.15)
        dumped = config.model_dump()
        restored = DriftConfig.model_validate(dumped)
        assert restored.window_days == 7
        assert restored.fidelity_decline_pct == 0.15
