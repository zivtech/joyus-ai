"""Skill file emission: convert AuthorProfile to platform-consumable files."""

from __future__ import annotations

import json
import re
from pathlib import Path

from pydantic import BaseModel, Field

from joyus_profile.emit.skill_md import generate_skill_md
from joyus_profile.models.hierarchy import (
    OrganizationProfile,
    ProfileHierarchy,
    StylometricBaseline,
)
from joyus_profile.models.profile import AuthorProfile


def _slugify(name: str) -> str:
    """Convert a name to a filesystem-safe slug."""
    slug = name.lower().strip()
    slug = re.sub(r"[^\w\s-]", "", slug)
    slug = re.sub(r"[\s_-]+", "-", slug)
    slug = slug.strip("-")
    return slug or "unnamed"


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

    # ── Hierarchy emission ─────────────────────────────────────────────

    def emit_hierarchy(
        self, hierarchy: ProfileHierarchy, output_dir: str
    ) -> dict[str, SkillFileSet]:
        """Write skill files for the full hierarchy.

        Directory layout:
            {output_dir}/org/           — org-level summary, stylometrics, voices.json
            {output_dir}/departments/{slug}/  — per-department composite files
            {output_dir}/people/{slug}/  — per-person skill files (existing emit())

        Returns a mapping of identifier -> SkillFileSet for each level.
        """
        out = Path(output_dir)
        result: dict[str, SkillFileSet] = {}

        # Org level
        org_dir = out / "org"
        org_dir.mkdir(parents=True, exist_ok=True)
        org_file_set = self._emit_org(hierarchy.org_profile, str(org_dir))
        result["org"] = org_file_set

        # Department level
        for dept_id, dept in hierarchy.departments.items():
            dept_slug = _slugify(dept.name)
            dept_dir = out / "departments" / dept_slug
            dept_dir.mkdir(parents=True, exist_ok=True)
            dept_file_set = self._emit_composite(
                dept.name, dept.stylometric_baseline, str(dept_dir)
            )
            result[f"department:{dept_id}"] = dept_file_set

        # People level
        for person_id, person in hierarchy.people.items():
            person_slug = _slugify(person.author_name)
            person_dir = out / "people" / person_slug
            person_file_set = self.emit(person, str(person_dir))
            result[f"person:{person_id}"] = person_file_set

        return result

    def _emit_composite(
        self,
        name: str,
        baseline: "StylometricBaseline",
        output_dir: str,
    ) -> SkillFileSet:
        """Emit profile.json and stylometrics.json for a composite (dept/org) node."""
        out = Path(output_dir)

        # profile.json — minimal summary
        profile_data = {"name": name, "stylometric_baseline": baseline.model_dump()}
        profile_path = out / "profile.json"
        profile_path.write_text(json.dumps(profile_data, indent=2))

        # stylometrics.json — baseline feature_means
        stylo_data = baseline.model_dump()
        stylo_path = out / "stylometrics.json"
        stylo_path.write_text(json.dumps(stylo_data, indent=2))

        # SKILL.md — plain summary
        skill_md_path = out / "SKILL.md"
        skill_md_path.write_text(f"# {name}\n\nComposite profile.\n")

        return SkillFileSet(
            skill_md=str(skill_md_path),
            markers_json=str(profile_path),
            stylometrics_json=str(stylo_path),
        )

    def _emit_org(
        self,
        org: OrganizationProfile,
        output_dir: str,
    ) -> SkillFileSet:
        """Emit org-level files including voices.json catalog."""
        out = Path(output_dir)

        file_set = self._emit_composite(org.name, org.stylometric_baseline, output_dir)

        # voices.json — voice_definitions catalog
        voices_path = out / "voices.json"
        voices_data = {
            key: vd.model_dump() for key, vd in org.voice_definitions.items()
        }
        voices_path.write_text(json.dumps(voices_data, indent=2))

        return SkillFileSet(
            skill_md=file_set.skill_md,
            markers_json=file_set.markers_json,
            stylometrics_json=file_set.stylometrics_json,
            voice_files=[str(voices_path)],
        )
