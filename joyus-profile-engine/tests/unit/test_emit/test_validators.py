"""Tests for skill file validators."""

from __future__ import annotations

import json
from pathlib import Path

import pytest

from joyus_profile.emit.skill_emitter import SkillEmitter
from joyus_profile.emit.validators import validate


class TestValidators:
    def test_valid_files_pass(self, sample_profile, tmp_path):
        emitter = SkillEmitter()
        out = tmp_path / "output"
        emitter.emit(sample_profile, str(out))
        result = validate(str(out))
        assert result.passed is True
        # May have warnings but no errors
        errors = [i for i in result.issues if i.severity == "error"]
        assert len(errors) == 0

    def test_missing_skill_md_fails(self, tmp_path):
        out = tmp_path / "empty"
        out.mkdir()
        result = validate(str(out))
        assert result.passed is False
        assert any(i.file == "SKILL.md" for i in result.issues)

    def test_missing_markers_json_fails(self, sample_profile, tmp_path):
        emitter = SkillEmitter()
        out = tmp_path / "output"
        emitter.emit(sample_profile, str(out))
        (out / "markers.json").unlink()
        result = validate(str(out))
        assert result.passed is False

    def test_malformed_json_fails(self, sample_profile, tmp_path):
        emitter = SkillEmitter()
        out = tmp_path / "output"
        emitter.emit(sample_profile, str(out))
        (out / "markers.json").write_text("{invalid json")
        result = validate(str(out))
        assert result.passed is False
        assert any("Invalid JSON" in i.message for i in result.issues)

    def test_skill_md_missing_sections_warns(self, sample_profile, tmp_path):
        emitter = SkillEmitter()
        out = tmp_path / "output"
        emitter.emit(sample_profile, str(out))
        # Replace SKILL.md with minimal content
        (out / "SKILL.md").write_text("# Writing Profile: Test\n\nMinimal content.")
        result = validate(str(out))
        warnings = [i for i in result.issues if i.severity == "warning"]
        assert len(warnings) > 0  # Should flag missing sections
