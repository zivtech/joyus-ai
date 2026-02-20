"""Validate emitted skill files for schema correctness."""

from __future__ import annotations

import json
from pathlib import Path

from pydantic import BaseModel, Field

from joyus_profile.models.features import MarkerSet, StylometricFeatures
from joyus_profile.models.profile import VoiceContext


class ValidationIssue(BaseModel):
    """A single validation issue."""

    file: str
    severity: str = "error"
    message: str


class ValidationResult(BaseModel):
    """Result of validating emitted skill files."""

    passed: bool = True
    issues: list[ValidationIssue] = Field(default_factory=list)


def validate(output_dir: str) -> ValidationResult:
    """Validate a directory of emitted skill files."""
    out = Path(output_dir)
    issues: list[ValidationIssue] = []

    # Check SKILL.md exists and has required sections
    skill_md = out / "SKILL.md"
    if not skill_md.exists():
        issues.append(
            ValidationIssue(file="SKILL.md", message="File not found")
        )
    else:
        content = skill_md.read_text()
        required_headings = [
            "## Identity & Background",
            "## Voice & Tone",
            "## Vocabulary",
            "## Anti-Patterns",
            "## Validation Criteria",
        ]
        for heading in required_headings:
            if heading not in content:
                issues.append(
                    ValidationIssue(
                        file="SKILL.md",
                        severity="warning",
                        message=f"Missing section: {heading}",
                    )
                )

    # Check markers.json
    markers_path = out / "markers.json"
    if not markers_path.exists():
        issues.append(
            ValidationIssue(file="markers.json", message="File not found")
        )
    else:
        try:
            data = json.loads(markers_path.read_text())
            MarkerSet(**data)
        except json.JSONDecodeError as e:
            issues.append(
                ValidationIssue(
                    file="markers.json", message=f"Invalid JSON: {e}"
                )
            )
        except Exception as e:
            issues.append(
                ValidationIssue(
                    file="markers.json", message=f"Schema error: {e}"
                )
            )

    # Check stylometrics.json
    stylo_path = out / "stylometrics.json"
    if not stylo_path.exists():
        issues.append(
            ValidationIssue(
                file="stylometrics.json", message="File not found"
            )
        )
    else:
        try:
            data = json.loads(stylo_path.read_text())
            if "feature_count" not in data:
                issues.append(
                    ValidationIssue(
                        file="stylometrics.json",
                        severity="warning",
                        message="Missing feature_count field",
                    )
                )
            else:
                StylometricFeatures(**data)
        except json.JSONDecodeError as e:
            issues.append(
                ValidationIssue(
                    file="stylometrics.json", message=f"Invalid JSON: {e}"
                )
            )
        except Exception as e:
            issues.append(
                ValidationIssue(
                    file="stylometrics.json", message=f"Schema error: {e}"
                )
            )

    # Check voices/*.json if present
    voices_dir = out / "voices"
    if voices_dir.exists():
        for voice_file in voices_dir.glob("*.json"):
            try:
                data = json.loads(voice_file.read_text())
                VoiceContext(**data)
            except json.JSONDecodeError as e:
                issues.append(
                    ValidationIssue(
                        file=f"voices/{voice_file.name}",
                        message=f"Invalid JSON: {e}",
                    )
                )
            except Exception as e:
                issues.append(
                    ValidationIssue(
                        file=f"voices/{voice_file.name}",
                        message=f"Schema error: {e}",
                    )
                )

    has_errors = any(i.severity == "error" for i in issues)
    return ValidationResult(passed=not has_errors, issues=issues)
