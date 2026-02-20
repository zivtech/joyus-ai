"""Skill file emission: convert AuthorProfile to platform-consumable files."""

from __future__ import annotations

import json
from pathlib import Path

from pydantic import BaseModel, Field

from joyus_profile.emit.skill_md import generate_skill_md
from joyus_profile.models.profile import AuthorProfile


class SkillFileSet(BaseModel):
    """Tracks the set of emitted skill files."""

    skill_md: str
    markers_json: str
    stylometrics_json: str
    voice_files: list[str] = Field(default_factory=list)


class SkillEmitter:
    """Convert an AuthorProfile into platform-consumable skill files."""

    def emit(self, profile: AuthorProfile, output_dir: str) -> SkillFileSet:
        """Write SKILL.md, markers.json, stylometrics.json to output_dir."""
        out = Path(output_dir)
        out.mkdir(parents=True, exist_ok=True)

        # 1. SKILL.md
        skill_md_path = out / "SKILL.md"
        skill_md_path.write_text(generate_skill_md(profile))

        # 2. markers.json
        markers_path = out / "markers.json"
        markers_data = self._extract_markers(profile)
        markers_path.write_text(json.dumps(markers_data, indent=2))

        # 3. stylometrics.json
        stylo_path = out / "stylometrics.json"
        stylo_data = self._extract_stylometrics(profile)
        stylo_path.write_text(json.dumps(stylo_data, indent=2))

        # 4. voices/ directory (only if voice_contexts present)
        voice_files: list[str] = []
        if profile.voice_contexts:
            voices_dir = out / "voices"
            voices_dir.mkdir(exist_ok=True)
            for key, vc in profile.voice_contexts.items():
                voice_path = voices_dir / f"{key}.json"
                voice_path.write_text(vc.model_dump_json(indent=2))
                voice_files.append(str(voice_path))

        return SkillFileSet(
            skill_md=str(skill_md_path),
            markers_json=str(markers_path),
            stylometrics_json=str(stylo_path),
            voice_files=voice_files,
        )

    def _extract_markers(self, profile: AuthorProfile) -> dict:
        """Extract marker data for JSON serialization."""
        if not profile.markers:
            return {"high_signal": [], "medium_signal": [], "negative_markers": []}
        return profile.markers.model_dump()

    def _extract_stylometrics(self, profile: AuthorProfile) -> dict:
        """Extract stylometric data for JSON serialization."""
        if not profile.stylometric_features:
            return {"feature_count": 0}
        return profile.stylometric_features.model_dump()
