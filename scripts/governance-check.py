#!/usr/bin/env python3
"""Org-scale agentic governance checks for joyus-ai.

Checks:
1. Artifact completeness: required files are present for each lifecycle state.
2. Metadata fields: each meta.json has measurement_owner, review_cadence,
   risk_class, lifecycle_state.
3. Reference integrity: governance docs and checklist template exist.
4. Governance dimensions: rollout, ROI, MCP approval, and autonomy coverage.
5. Constitution sync: constitution.md has version header and §Governance section.
"""

from __future__ import annotations

import argparse
import json
import re
import sys
from dataclasses import asdict, dataclass
from pathlib import Path
from typing import Iterable

# ---------------------------------------------------------------------------
# Constants
# ---------------------------------------------------------------------------

REQUIRED_ARTIFACTS = ["spec.md", "plan.md", "tasks.md"]

REQUIRED_ARTIFACTS_BY_LIFECYCLE = {
    "spec-only": ["spec.md"],
    "planning": REQUIRED_ARTIFACTS,
    "in-progress": REQUIRED_ARTIFACTS,
    "execution": REQUIRED_ARTIFACTS,
    "done": REQUIRED_ARTIFACTS,
}

P0_ARTIFACT_LIFECYCLES = {"execution", "done"}

REQUIRED_META_FIELDS = [
    "measurement_owner",
    "review_cadence",
    "risk_class",
    "lifecycle_state",
]

REQUIRED_REFERENCE_ARTIFACTS = [
    "governance/baseline-matrix.md",
    "governance/gap-register.md",
    "governance/remediation-backlog.md",
    "governance/policy-v1.0.md",
    "governance/roi-metrics-contract.md",
    "governance/mcp-approval-rubric.md",
    "governance/autonomy-levels.md",
    "checklists/requirements-template.md",
]

STUB_PATTERNS = [
    "[STUB]",
    "<!-- STUB",
]

GOVERNANCE_DIMENSION_CHECKS = [
    {
        "check_id": "GOVDIM-ROLLOUT",
        "target": "governance/policy-v1.0.md",
        "label": "rollout enforcement",
        "required_terms": [
            "Rollout Model",
            "pilot",
            "launch",
            "scale",
            "sustain",
            "Champion model",
            "Pilot Criteria",
            "Baseline availability",
        ],
    },
    {
        "check_id": "GOVDIM-ROI",
        "target": "governance/roi-metrics-contract.md",
        "label": "ROI contract enforcement",
        "required_terms": [
            "Collection Owner",
            "Review Owner",
            "Baseline Period",
            "Measurement method",
            "Data source",
            "Weekly",
            "M06",
            "remediation",
        ],
    },
    {
        "check_id": "GOVDIM-MCP-APPROVAL",
        "target": "governance/mcp-approval-rubric.md",
        "label": "MCP approval status enforcement",
        "required_terms": [
            "Data Access Scope",
            "Credential and Auth Model",
            "Logging and Auditability",
            "External Dependency Risk",
            "Sandbox and Execution Constraints",
            "Automatic Block Rule",
            "Integration Catalog",
            "Completed Example Assessment Record",
        ],
    },
    {
        "check_id": "GOVDIM-AUTONOMY",
        "target": "governance/autonomy-levels.md",
        "label": "autonomy classification enforcement",
        "required_terms": [
            "Level 0",
            "Level 1",
            "Level 2",
            "Level 3",
            "Level 4",
            "Level 5",
            "monthly",
            "Team Classification Register",
            "evidence",
            "Next Review",
        ],
    },
]


# ---------------------------------------------------------------------------
# Data types
# ---------------------------------------------------------------------------


@dataclass
class GovernanceCheckResult:
    check_id: str
    severity: str   # P0 / P1 / P2
    status: str     # pass / fail / warn
    target: str
    message: str


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _iter_feature_dirs(root: Path) -> Iterable[Path]:
    specs_dir = root / "kitty-specs"
    if not specs_dir.exists():
        return []
    return sorted(p for p in specs_dir.iterdir() if p.is_dir())


def _parse_meta(meta_path: Path) -> dict:
    try:
        return json.loads(meta_path.read_text())
    except Exception:
        return {}


def _feature_number(feature_dir: Path) -> str:
    """Extract numeric prefix from directory name, e.g. '007' from '007-slug'."""
    name = feature_dir.name
    parts = name.split("-", 1)
    return parts[0] if parts else name


def _feature_lifecycle(feature_dir: Path) -> str:
    meta_path = feature_dir / "meta.json"
    if not meta_path.exists():
        return "in-progress"
    meta = _parse_meta(meta_path)
    return str(meta.get("lifecycle_state") or "in-progress")


def _is_stub(path: Path) -> bool:
    """Return True if the file contains a stub marker."""
    try:
        text = path.read_text()
        return any(marker in text for marker in STUB_PATTERNS)
    except Exception:
        return False


# ---------------------------------------------------------------------------
# Check 1: Artifact completeness  (P0, downgraded to P2 if stub)
# ---------------------------------------------------------------------------


def check_artifact_completeness(root: Path) -> list[GovernanceCheckResult]:
    results: list[GovernanceCheckResult] = []

    for feature_dir in _iter_feature_dirs(root):
        num = _feature_number(feature_dir)
        lifecycle = _feature_lifecycle(feature_dir)
        required_artifacts = REQUIRED_ARTIFACTS_BY_LIFECYCLE.get(
            lifecycle,
            REQUIRED_ARTIFACTS,
        )

        for filename in required_artifacts:
            artifact_path = feature_dir / filename
            check_id = f"ARTIFACT-{num}-{filename.replace('/', '-')}"

            if artifact_path.exists():
                results.append(
                    GovernanceCheckResult(
                        check_id=check_id,
                        severity="P0",
                        status="pass",
                        target=str(artifact_path.relative_to(root)),
                        message=f"Artifact present: {filename}",
                    )
                )
            else:
                # Stub placeholders may be non-blocking only before planning starts.
                meta_path = feature_dir / "meta.json"
                is_stub_feature = _is_stub(meta_path) if meta_path.exists() else False
                if is_stub_feature and lifecycle == "spec-only":
                    severity = "P2"
                elif lifecycle in P0_ARTIFACT_LIFECYCLES:
                    severity = "P0"
                else:
                    severity = "P1"
                results.append(
                    GovernanceCheckResult(
                        check_id=check_id,
                        severity=severity,
                        status="fail",
                        target=str(feature_dir.relative_to(root)),
                        message=f"Missing required artifact: {filename}"
                        + f" for lifecycle {lifecycle!r}"
                        + (
                            " (spec-only stub — downgraded to P2)"
                            if is_stub_feature and lifecycle == "spec-only"
                            else ""
                        ),
                    )
                )

    return results


# ---------------------------------------------------------------------------
# Check 2: Metadata fields  (P1)
# ---------------------------------------------------------------------------


def check_metadata_fields(root: Path) -> list[GovernanceCheckResult]:
    results: list[GovernanceCheckResult] = []

    for feature_dir in _iter_feature_dirs(root):
        num = _feature_number(feature_dir)
        meta_path = feature_dir / "meta.json"

        if not meta_path.exists():
            results.append(
                GovernanceCheckResult(
                    check_id=f"META-{num}-meta.json",
                    severity="P1",
                    status="fail",
                    target=str(feature_dir.relative_to(root)),
                    message="meta.json is missing",
                )
            )
            continue

        meta = _parse_meta(meta_path)
        if not meta:
            results.append(
                GovernanceCheckResult(
                    check_id=f"META-{num}-meta.json",
                    severity="P1",
                    status="fail",
                    target=str(meta_path.relative_to(root)),
                    message="meta.json is empty or invalid JSON",
                )
            )
            continue

        for field in REQUIRED_META_FIELDS:
            check_id = f"META-{num}-{field}"
            value = meta.get(field, "")
            if value:
                results.append(
                    GovernanceCheckResult(
                        check_id=check_id,
                        severity="P1",
                        status="pass",
                        target=str(meta_path.relative_to(root)),
                        message=f"Field present: {field}={value!r}",
                    )
                )
            else:
                # Stub files downgrade to P2
                severity = "P2" if _is_stub(meta_path) else "P1"
                results.append(
                    GovernanceCheckResult(
                        check_id=check_id,
                        severity=severity,
                        status="fail",
                        target=str(meta_path.relative_to(root)),
                        message=f"Missing required metadata field: {field}"
                        + (" (stub — downgraded to P2)" if severity == "P2" else ""),
                    )
                )

    return results


# ---------------------------------------------------------------------------
# Check 3: Reference integrity  (P1)
# ---------------------------------------------------------------------------


def check_reference_integrity(root: Path) -> list[GovernanceCheckResult]:
    results: list[GovernanceCheckResult] = []

    for doc_rel in REQUIRED_REFERENCE_ARTIFACTS:
        doc_path = root / doc_rel
        check_id = f"REF-{doc_rel.replace('/', '-').replace('.', '-')}"

        if not doc_path.exists():
            results.append(
                GovernanceCheckResult(
                    check_id=check_id,
                    severity="P1",
                    status="fail",
                    target=doc_rel,
                    message=f"Required reference artifact missing: {doc_rel}",
                )
            )
            continue

        # Check for stub content — downgrade to P2
        if _is_stub(doc_path):
            results.append(
                GovernanceCheckResult(
                    check_id=check_id,
                    severity="P2",
                    status="warn",
                    target=doc_rel,
                    message=f"Reference artifact is a stub: {doc_rel}",
                )
            )
        else:
            results.append(
                GovernanceCheckResult(
                    check_id=check_id,
                    severity="P1",
                    status="pass",
                    target=doc_rel,
                    message=f"Reference artifact present: {doc_rel}",
                )
            )

    return results


# ---------------------------------------------------------------------------
# Check 4: Governance dimension enforcement  (P0)
# ---------------------------------------------------------------------------


def _missing_terms(text: str, required_terms: list[str]) -> list[str]:
    lowered = text.lower()
    return [term for term in required_terms if term.lower() not in lowered]


def check_governance_dimensions(root: Path) -> list[GovernanceCheckResult]:
    results: list[GovernanceCheckResult] = []

    for check in GOVERNANCE_DIMENSION_CHECKS:
        target = check["target"]
        doc_path = root / target

        if not doc_path.exists():
            results.append(
                GovernanceCheckResult(
                    check_id=check["check_id"],
                    severity="P0",
                    status="fail",
                    target=target,
                    message=f"Missing document for {check['label']}: {target}",
                )
            )
            continue

        missing = _missing_terms(doc_path.read_text(), check["required_terms"])
        if missing:
            results.append(
                GovernanceCheckResult(
                    check_id=check["check_id"],
                    severity="P0",
                    status="fail",
                    target=target,
                    message=(
                        f"{check['label']} is missing required terms: "
                        + ", ".join(missing)
                    ),
                )
            )
        else:
            results.append(
                GovernanceCheckResult(
                    check_id=check["check_id"],
                    severity="P0",
                    status="pass",
                    target=target,
                    message=f"{check['label']} coverage is enforced by content check",
                )
            )

    return results


# ---------------------------------------------------------------------------
# Check 5: Constitution sync  (P1)
# ---------------------------------------------------------------------------

_VERSION_HEADER_RE = re.compile(
    r"^\*Changes\s+v\d+\.\d+", re.MULTILINE
)
_GOVERNANCE_SECTION_RE = re.compile(
    r"^#{1,3}\s+\d+\.\s+Governance\b", re.MULTILINE | re.IGNORECASE
)


def check_constitution_sync(root: Path) -> list[GovernanceCheckResult]:
    results: list[GovernanceCheckResult] = []
    constitution_path = root / "spec" / "constitution.md"
    target = "spec/constitution.md"

    if not constitution_path.exists():
        results.append(
            GovernanceCheckResult(
                check_id="CONST-VERSION",
                severity="P1",
                status="fail",
                target=target,
                message="spec/constitution.md does not exist",
            )
        )
        results.append(
            GovernanceCheckResult(
                check_id="CONST-GOVERNANCE-SECTION",
                severity="P1",
                status="fail",
                target=target,
                message="spec/constitution.md does not exist",
            )
        )
        return results

    text = constitution_path.read_text()

    # CONST-VERSION: look for a version change log line
    if _VERSION_HEADER_RE.search(text):
        results.append(
            GovernanceCheckResult(
                check_id="CONST-VERSION",
                severity="P1",
                status="pass",
                target=target,
                message="Constitution has version header",
            )
        )
    else:
        results.append(
            GovernanceCheckResult(
                check_id="CONST-VERSION",
                severity="P1",
                status="fail",
                target=target,
                message=(
                    "Constitution is missing a version header "
                    "(expected a line matching '*Changes vN.N ...' at the bottom)"
                ),
            )
        )

    # CONST-GOVERNANCE-SECTION: look for a top-level §Governance section
    if _GOVERNANCE_SECTION_RE.search(text):
        results.append(
            GovernanceCheckResult(
                check_id="CONST-GOVERNANCE-SECTION",
                severity="P1",
                status="pass",
                target=target,
                message="Constitution contains §Governance section",
            )
        )
    else:
        results.append(
            GovernanceCheckResult(
                check_id="CONST-GOVERNANCE-SECTION",
                severity="P1",
                status="fail",
                target=target,
                message=(
                    "Constitution is missing a §Governance section "
                    "(expected a heading like '## 10. Governance')"
                ),
            )
        )

    return results


# ---------------------------------------------------------------------------
# Formatters
# ---------------------------------------------------------------------------


def _terminal_report(results: list[GovernanceCheckResult]) -> str:
    fails = [r for r in results if r.status == "fail"]
    warns = [r for r in results if r.status == "warn"]
    passes = [r for r in results if r.status == "pass"]
    p0_fails = [r for r in fails if r.severity == "P0"]
    p1_fails = [r for r in fails if r.severity == "P1"]

    lines: list[str] = []
    lines.append("=== Governance Check Results ===")
    lines.append(
        f"Total: {len(results)}  Pass: {len(passes)}  "
        f"Fail: {len(fails)}  Warn: {len(warns)}"
    )
    lines.append(f"P0 failures: {len(p0_fails)}  P1 failures: {len(p1_fails)}")
    lines.append("")

    if fails or warns:
        lines.append("--- Issues ---")
        for r in fails + warns:
            icon = "FAIL" if r.status == "fail" else "WARN"
            lines.append(f"[{icon}] [{r.severity}] {r.check_id}")
            lines.append(f"       Target:  {r.target}")
            lines.append(f"       Message: {r.message}")
        lines.append("")

    if not fails and not warns:
        lines.append("All governance checks passed.")
    else:
        overall = "PASS" if not p0_fails and not p1_fails else "FAIL"
        lines.append(f"Overall result: {overall}")

    return "\n".join(lines)


def _json_report(results: list[GovernanceCheckResult]) -> str:
    return json.dumps(
        {"results": [asdict(r) for r in results]},
        indent=2,
    )


# ---------------------------------------------------------------------------
# Entry point
# ---------------------------------------------------------------------------


def _run_checks(root: Path, severity_filter: str | None) -> list[GovernanceCheckResult]:
    all_results: list[GovernanceCheckResult] = []
    all_results.extend(check_artifact_completeness(root))
    all_results.extend(check_metadata_fields(root))

    if severity_filter != "P0":
        all_results.extend(check_reference_integrity(root))
        all_results.extend(check_governance_dimensions(root))
        all_results.extend(check_constitution_sync(root))
    else:
        all_results.extend(check_reference_integrity(root))
        all_results.extend(check_governance_dimensions(root))
        all_results.extend(check_constitution_sync(root))
        all_results = [r for r in all_results if r.severity == "P0"]

    return all_results


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Run org-scale agentic governance checks for joyus-ai",
    )
    parser.add_argument(
        "--root",
        default=".",
        help="Repository root directory (default: current directory)",
    )
    parser.add_argument(
        "--format",
        choices=["terminal", "json"],
        default="terminal",
        help="Output format (default: terminal)",
    )
    parser.add_argument(
        "--severity",
        choices=["P0", "P1", "P2"],
        default=None,
        help="Only show results at or above this severity level",
    )
    args = parser.parse_args()

    root = Path(args.root).resolve()
    results = _run_checks(root, args.severity)

    if args.format == "json":
        print(_json_report(results))
    else:
        print(_terminal_report(results))

    # Exit 1 if any P0 or P1 failures
    p0_p1_fails = [
        r for r in results
        if r.status == "fail" and r.severity in {"P0", "P1"}
    ]
    sys.exit(1 if p0_p1_fails else 0)


if __name__ == "__main__":
    main()
