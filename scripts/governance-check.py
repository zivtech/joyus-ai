#!/usr/bin/env python3
"""Feature 007 governance checks for joyus-ai.

Checks:
1. Artifact completeness: each feature has spec.md, plan.md, tasks.md.
2. Metadata fields: each meta.json has measurement_owner, review_cadence,
   risk_class, lifecycle_state.
3. Reference integrity: governance docs exist.
4. Constitution sync: constitution.md has version header and §Governance section.
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

REQUIRED_META_FIELDS = [
    "measurement_owner",
    "review_cadence",
    "risk_class",
    "lifecycle_state",
]

REQUIRED_GOVERNANCE_DOCS = [
    "governance/baseline-matrix.md",
    "governance/gap-register.md",
    "governance/remediation-backlog.md",
    "governance/policy-v1.0.md",
    "governance/roi-metrics-contract.md",
    "governance/mcp-integration-rubric.md",
    "governance/autonomy-levels.md",
]

STUB_PATTERNS = [
    "[STUB]",
    "<!-- STUB",
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
        for filename in REQUIRED_ARTIFACTS:
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
                # Downgrade to P2 when the feature directory itself is a stub
                meta_path = feature_dir / "meta.json"
                is_stub_feature = _is_stub(meta_path) if meta_path.exists() else False
                severity = "P2" if is_stub_feature else "P0"
                results.append(
                    GovernanceCheckResult(
                        check_id=check_id,
                        severity=severity,
                        status="fail",
                        target=str(feature_dir.relative_to(root)),
                        message=f"Missing required artifact: {filename}"
                        + (" (stub feature — downgraded to P2)" if is_stub_feature else ""),
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

    for doc_rel in REQUIRED_GOVERNANCE_DOCS:
        doc_path = root / doc_rel
        check_id = f"REF-{doc_rel.replace('/', '-').replace('.', '-')}"

        if not doc_path.exists():
            results.append(
                GovernanceCheckResult(
                    check_id=check_id,
                    severity="P1",
                    status="fail",
                    target=doc_rel,
                    message=f"Required governance document missing: {doc_rel}",
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
                    message=f"Governance document is a stub: {doc_rel}",
                )
            )
        else:
            results.append(
                GovernanceCheckResult(
                    check_id=check_id,
                    severity="P1",
                    status="pass",
                    target=doc_rel,
                    message=f"Governance document present: {doc_rel}",
                )
            )

    return results


# ---------------------------------------------------------------------------
# Check 4: Constitution sync  (P1)
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
        # P0-only mode skips P1 checks
        all_results.extend(check_reference_integrity(root))
        all_results.extend(check_constitution_sync(root))
    else:
        # Still run all checks but only return P0 ones
        all_results.extend(check_reference_integrity(root))
        all_results.extend(check_constitution_sync(root))
        all_results = [r for r in all_results if r.severity == "P0"]

    return all_results


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Run Feature 007 governance checks for joyus-ai",
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
