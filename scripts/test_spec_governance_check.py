#!/usr/bin/env python3
"""Focused tests for scripts/spec-governance-check.py."""

from __future__ import annotations

import importlib.util
import json
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

SCRIPT_PATH = Path(__file__).with_name("spec-governance-check.py")


def _load_module():
    spec = importlib.util.spec_from_file_location("spec_governance_check", SCRIPT_PATH)
    assert spec is not None
    assert spec.loader is not None
    module = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = module
    spec.loader.exec_module(module)
    return module


checker = _load_module()


class SpecGovernanceCheckTest(unittest.TestCase):
    def _write_governance_skeleton(self, root: Path) -> None:
        (root / "spec").mkdir(parents=True)
        (root / "spec" / "constitution.md").write_text("# Constitution\n")

        charter_dir = root / ".kittify" / "charter"
        charter_dir.mkdir(parents=True)
        (charter_dir / "charter.md").write_text("# Charter\n")
        (charter_dir / "governance.yaml").write_text("{}\n")
        (charter_dir / "directives.yaml").write_text("{}\n")
        (charter_dir / "metadata.yaml").write_text("{}\n")

    def _write_low_risk_feature(self, root: Path) -> None:
        feature_dir = root / "kitty-specs" / "001-example"
        (feature_dir / "checklists").mkdir(parents=True)
        (feature_dir / "meta.json").write_text(
            json.dumps(
                {
                    "feature_number": "001",
                    "slug": "example",
                    "friendly_name": "Example Capability",
                    "mission": "software-dev",
                    "created_at": "2026-05-25",
                    "measurement_owner": "Platform Owner",
                    "review_cadence": "monthly",
                    "risk_class": "low",
                    "lifecycle_state": "spec-only",
                }
            )
        )
        (feature_dir / "spec.md").write_text("# Spec\nThis example mentions Python.\n")
        (feature_dir / "checklists" / "requirements.md").write_text(
            "- [x] No implementation details (languages, frameworks, APIs)\n"
        )

    def _run_checker(self, root: Path, *args: str) -> subprocess.CompletedProcess[str]:
        return subprocess.run(
            [sys.executable, str(SCRIPT_PATH), "--root", str(root), "--json", *args],
            capture_output=True,
            text=True,
            check=False,
        )

    def test_non_p0_failures_are_reported_as_warnings(self) -> None:
        finding = checker.Finding("CHK-001", "P1", "fail", "target.md", "message")
        normalized = checker._normalize_status(finding)

        self.assertEqual(normalized.status, "warn")

    def test_p0_failures_remain_blocking_failures(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            self._write_governance_skeleton(root)
            (root / "kitty-specs" / "001-example").mkdir(parents=True)

            result = self._run_checker(root)
            payload = json.loads(result.stdout)

            self.assertEqual(result.returncode, 1)
            self.assertEqual(payload["findings"][0]["check_id"], "ART-001")
            self.assertEqual(payload["findings"][0]["severity"], "P0")
            self.assertEqual(payload["findings"][0]["status"], "fail")

    def test_new_unbaselined_p1_findings_remain_visible_and_strict(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            self._write_governance_skeleton(root)
            self._write_low_risk_feature(root)

            result = self._run_checker(root)
            payload = json.loads(result.stdout)
            strict_result = self._run_checker(root, "--strict")

            self.assertEqual(result.returncode, 0)
            self.assertEqual(len(payload["findings"]), 1)
            self.assertEqual(payload["findings"][0]["check_id"], "CHK-001")
            self.assertEqual(payload["findings"][0]["severity"], "P1")
            self.assertEqual(payload["findings"][0]["status"], "warn")
            self.assertEqual(payload["accepted_baseline"], [])
            self.assertEqual(strict_result.returncode, 1)

    def test_accepted_legacy_findings_are_reported_separately(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            self._write_governance_skeleton(root)
            self._write_low_risk_feature(root)

            baseline_dir = root / "governance"
            baseline_dir.mkdir()
            (baseline_dir / "spec-governance-baseline.json").write_text(
                json.dumps(
                    {
                        "findings": [
                            {
                                "check_id": "CHK-001",
                                "severity": "P1",
                                "target": "kitty-specs/001-example/spec.md",
                                "message": "Checklist claims no implementation details, but spec contains technical terms: python",
                            }
                        ]
                    }
                )
            )

            result = self._run_checker(root, "--strict")
            payload = json.loads(result.stdout)

            self.assertEqual(result.returncode, 0)
            self.assertEqual(payload["findings"], [])
            self.assertEqual(len(payload["accepted_baseline"]), 1)
            self.assertEqual(payload["accepted_baseline"][0]["status"], "accepted")

    def test_baseline_cannot_accept_p0_findings(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            self._write_governance_skeleton(root)

            baseline_dir = root / "governance"
            baseline_dir.mkdir()
            (baseline_dir / "spec-governance-baseline.json").write_text(
                json.dumps(
                    {
                        "findings": [
                            {
                                "check_id": "ART-001",
                                "severity": "P0",
                                "target": "kitty-specs/001-example",
                                "message": "Missing meta.json",
                            }
                        ]
                    }
                )
            )

            result = self._run_checker(root)
            payload = json.loads(result.stdout)

            self.assertEqual(result.returncode, 1)
            self.assertEqual(payload["findings"][0]["check_id"], "BASE-002")
            self.assertEqual(payload["findings"][0]["status"], "fail")


if __name__ == "__main__":
    unittest.main()
