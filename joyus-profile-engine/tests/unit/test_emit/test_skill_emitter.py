"""Tests for SkillEmitter."""

from __future__ import annotations

import json
from pathlib import Path

import pytest

from joyus_profile.emit.skill_emitter import SkillEmitter


class TestSkillEmitter:
    def test_emit_creates_files(self, sample_profile, tmp_path):
        emitter = SkillEmitter()
        result = emitter.emit(sample_profile, str(tmp_path / "output"))
        assert Path(result.skill_md).exists()
        assert Path(result.markers_json).exists()
        assert Path(result.stylometrics_json).exists()

    def test_skill_md_is_valid_markdown(self, sample_profile, tmp_path):
        emitter = SkillEmitter()
        out = tmp_path / "output"
        emitter.emit(sample_profile, str(out))
        content = (out / "SKILL.md").read_text()
        assert content.startswith("# Writing Profile:")
        assert "## Voice & Tone" in content
        assert "## Vocabulary" in content

    def test_markers_json_is_valid(self, sample_profile, tmp_path):
        emitter = SkillEmitter()
        out = tmp_path / "output"
        emitter.emit(sample_profile, str(out))
        data = json.loads((out / "markers.json").read_text())
        assert "high_signal" in data
        assert "medium_signal" in data
        assert "negative_markers" in data

    def test_stylometrics_json_is_valid(self, sample_profile, tmp_path):
        emitter = SkillEmitter()
        out = tmp_path / "output"
        emitter.emit(sample_profile, str(out))
        data = json.loads((out / "stylometrics.json").read_text())
        assert "feature_count" in data

    def test_no_voices_dir_for_layer_0(self, sample_profile, tmp_path):
        """Layer 0 profiles should not create voices/ directory."""
        emitter = SkillEmitter()
        out = tmp_path / "output"
        result = emitter.emit(sample_profile, str(out))
        assert not (out / "voices").exists()
        assert result.voice_files == []

    def test_creates_output_dir(self, sample_profile, tmp_path):
        emitter = SkillEmitter()
        out = tmp_path / "deep" / "nested" / "dir"
        result = emitter.emit(sample_profile, str(out))
        assert out.exists()
        assert Path(result.skill_md).exists()
