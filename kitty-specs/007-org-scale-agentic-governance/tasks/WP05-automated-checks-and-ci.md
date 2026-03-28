---
work_package_id: WP05
title: Automated Checks and CI
lane: planned
dependencies: [WP03, WP04]
subtasks: [T018, T019, T020, T021]
history:
- date: '2026-03-14'
  action: created
  agent: claude-sonnet
---

# WP05: Automated Checks and CI

**Implementation command**: `spec-kitty implement WP05`
**Target repo**: `joyus-ai`
**Dependencies**: WP03 (governance docs exist), WP04 (metadata fields populated)
**Priority**: P0/P1

## Objective

Implement a Python governance validation script, extend pride-status integrity reporting to surface governance results, add a CI workflow that runs checks on every pull request and blocks on P0 failures, and publish the final governance verification report that attests the spec 007 success criteria are met.

## Context

This is the only WP in Spec 007 that produces executable code. The primary deliverable is `scripts/governance-check.py` — a single-file Python script with no external dependencies beyond the standard library, that implements four check categories from FR-008 and NFR-001 through NFR-003.

The script must satisfy three constraints from the spec's non-functional requirements:
- **NFR-001**: Runnable locally and in CI (no secrets required for the checks themselves)
- **NFR-002**: Output must be human-readable (terminal) and machine-parseable (JSON)
- **NFR-003**: Governance policy updates must be versioned — the script checks for version headers, not just file existence

The `GovernanceCheckResult` schema from `data-model.md` defines the output record format:
- `check_id`: string (e.g., `ARTIFACT-001`)
- `status`: `pass` | `warn` | `fail`
- `severity`: `P0` | `P1` | `P2`
- `target`: string (file path or feature number)
- `message`: string (human-readable description)

P0 check failures must cause CI to exit non-zero. P1 and P2 failures produce warnings but do not block the merge.

---

## Subtasks

### T018: Implement governance validation Python script

**Purpose**: Write `scripts/governance-check.py` — the core governance validation tool that checks artifact completeness, metadata field presence, reference integrity, and constitution sync.

**Steps**:

1. Create `joyus-ai/scripts/governance-check.py`.
2. Implement four check categories (one function per category):
   - `check_artifact_completeness()`: verify each feature dir has required files
   - `check_metadata_fields()`: verify each `meta.json` has required governance fields
   - `check_reference_integrity()`: verify key cross-references resolve to existing files
   - `check_constitution_sync()`: verify constitution has §Governance section and version header
3. Implement output in two modes:
   - `--format terminal` (default): colored text output per check with pass/warn/fail indicators
   - `--format json`: JSON array of `GovernanceCheckResult` objects
4. Implement exit code logic:
   - Exit 0 if all checks pass or only P2 warn
   - Exit 1 if any P0 or P1 fail
5. Add a `--severity` filter flag: `--severity P0` runs only P0 checks (useful for fast CI pre-flight)

**Script structure**:

```python
#!/usr/bin/env python3
"""
governance-check.py — Joyus AI governance validation script
Spec: 007-org-scale-agentic-governance
NFR-001: Runnable locally and in CI (no secrets required)
NFR-002: Human-readable and machine-parseable output
"""

import argparse
import json
import os
import sys
from dataclasses import dataclass, asdict
from pathlib import Path
from typing import List, Optional

REPO_ROOT = Path(__file__).parent.parent
KITTY_SPECS_DIR = REPO_ROOT / "kitty-specs"
GOVERNANCE_DIR = REPO_ROOT / "governance"

REQUIRED_FEATURE_FILES = ["spec.md", "plan.md", "tasks.md"]
REQUIRED_META_FIELDS = ["measurement_owner", "review_cadence", "risk_class", "lifecycle_state"]
REQUIRED_GOVERNANCE_DOCS = [
    "governance/baseline-matrix.md",
    "governance/gap-register.md",
    "governance/remediation-backlog.md",
    "governance/policy-v1.0.md",
    "governance/roi-metrics-contract.md",
    "governance/mcp-integration-rubric.md",
    "governance/autonomy-levels.md",
]

@dataclass
class GovernanceCheckResult:
    check_id: str
    status: str  # pass | warn | fail
    severity: str  # P0 | P1 | P2
    target: str
    message: str


def check_artifact_completeness() -> List[GovernanceCheckResult]:
    """ARTIFACT-* checks: each feature dir must have required spec files."""
    results = []
    if not KITTY_SPECS_DIR.exists():
        results.append(GovernanceCheckResult(
            check_id="ARTIFACT-000",
            status="fail",
            severity="P0",
            target=str(KITTY_SPECS_DIR),
            message="kitty-specs/ directory not found"
        ))
        return results

    for feature_dir in sorted(KITTY_SPECS_DIR.iterdir()):
        if not feature_dir.is_dir():
            continue
        feature_num = feature_dir.name[:3]
        for required_file in REQUIRED_FEATURE_FILES:
            target_path = feature_dir / required_file
            check_id = f"ARTIFACT-{feature_num}-{required_file.replace('.', '-').upper()}"
            if target_path.exists():
                results.append(GovernanceCheckResult(
                    check_id=check_id,
                    status="pass",
                    severity="P0",
                    target=str(target_path.relative_to(REPO_ROOT)),
                    message=f"{required_file} present"
                ))
            else:
                results.append(GovernanceCheckResult(
                    check_id=check_id,
                    status="fail",
                    severity="P0",
                    target=str(target_path.relative_to(REPO_ROOT)),
                    message=f"Missing required file: {required_file}"
                ))
    return results


def check_metadata_fields() -> List[GovernanceCheckResult]:
    """META-* checks: each meta.json must have required governance fields."""
    results = []
    if not KITTY_SPECS_DIR.exists():
        return results

    for feature_dir in sorted(KITTY_SPECS_DIR.iterdir()):
        if not feature_dir.is_dir():
            continue
        feature_num = feature_dir.name[:3]
        meta_path = feature_dir / "meta.json"
        if not meta_path.exists():
            results.append(GovernanceCheckResult(
                check_id=f"META-{feature_num}-MISSING",
                status="fail",
                severity="P0",
                target=str(meta_path.relative_to(REPO_ROOT)),
                message="meta.json not found"
            ))
            continue

        with open(meta_path) as f:
            try:
                meta = json.load(f)
            except json.JSONDecodeError as e:
                results.append(GovernanceCheckResult(
                    check_id=f"META-{feature_num}-PARSE",
                    status="fail",
                    severity="P0",
                    target=str(meta_path.relative_to(REPO_ROOT)),
                    message=f"meta.json parse error: {e}"
                ))
                continue

        for field in REQUIRED_META_FIELDS:
            check_id = f"META-{feature_num}-{field.upper().replace('_', '-')}"
            if field in meta and meta[field]:
                results.append(GovernanceCheckResult(
                    check_id=check_id,
                    status="pass",
                    severity="P1",
                    target=str(meta_path.relative_to(REPO_ROOT)),
                    message=f"Field '{field}' present: {meta[field]}"
                ))
            else:
                results.append(GovernanceCheckResult(
                    check_id=check_id,
                    status="fail",
                    severity="P1",
                    target=str(meta_path.relative_to(REPO_ROOT)),
                    message=f"Missing required metadata field: {field}"
                ))
    return results


def check_reference_integrity() -> List[GovernanceCheckResult]:
    """REF-* checks: governance docs that must exist."""
    results = []
    for doc_path in REQUIRED_GOVERNANCE_DOCS:
        full_path = REPO_ROOT / doc_path
        check_id = f"REF-{doc_path.replace('/', '-').replace('.', '-').upper()}"
        if full_path.exists():
            results.append(GovernanceCheckResult(
                check_id=check_id,
                status="pass",
                severity="P1",
                target=doc_path,
                message=f"Governance doc present: {doc_path}"
            ))
        else:
            results.append(GovernanceCheckResult(
                check_id=check_id,
                status="fail",
                severity="P1",
                target=doc_path,
                message=f"Missing governance doc: {doc_path}"
            ))
    return results


def check_constitution_sync() -> List[GovernanceCheckResult]:
    """CONST-* checks: constitution.md must have version header and §Governance section."""
    results = []
    constitution_path = REPO_ROOT / "spec" / "constitution.md"

    if not constitution_path.exists():
        results.append(GovernanceCheckResult(
            check_id="CONST-MISSING",
            status="fail",
            severity="P0",
            target=str(constitution_path.relative_to(REPO_ROOT)),
            message="constitution.md not found"
        ))
        return results

    content = constitution_path.read_text()

    # Check version header
    if "**Version**:" in content or "version:" in content.lower():
        results.append(GovernanceCheckResult(
            check_id="CONST-VERSION",
            status="pass",
            severity="P1",
            target="spec/constitution.md",
            message="Version header present"
        ))
    else:
        results.append(GovernanceCheckResult(
            check_id="CONST-VERSION",
            status="warn",
            severity="P1",
            target="spec/constitution.md",
            message="Version header not found in constitution.md"
        ))

    # Check §Governance section
    if "§Governance" in content or "## Governance" in content or "# Governance" in content:
        results.append(GovernanceCheckResult(
            check_id="CONST-GOVERNANCE-SECTION",
            status="pass",
            severity="P1",
            target="spec/constitution.md",
            message="§Governance section present"
        ))
    else:
        results.append(GovernanceCheckResult(
            check_id="CONST-GOVERNANCE-SECTION",
            status="fail",
            severity="P1",
            target="spec/constitution.md",
            message="§Governance section missing from constitution.md — required by WP03 T009"
        ))

    return results


def format_terminal(results: List[GovernanceCheckResult]) -> str:
    """Human-readable terminal output."""
    lines = []
    counts = {"pass": 0, "warn": 0, "fail": 0}

    for r in results:
        counts[r.status] += 1
        icon = {"pass": "OK", "warn": "WARN", "fail": "FAIL"}[r.status]
        lines.append(f"[{icon}] [{r.severity}] {r.check_id}: {r.message} ({r.target})")

    lines.append("")
    lines.append(
        f"Summary: {counts['pass']} passed, {counts['warn']} warnings, {counts['fail']} failed"
    )
    p0_fails = [r for r in results if r.status == "fail" and r.severity == "P0"]
    if p0_fails:
        lines.append(f"BLOCKED: {len(p0_fails)} P0 failure(s) must be resolved before merge")
    return "\n".join(lines)


def main():
    parser = argparse.ArgumentParser(description="Joyus AI governance validation")
    parser.add_argument("--format", choices=["terminal", "json"], default="terminal")
    parser.add_argument("--severity", choices=["P0", "P1", "P2"], default=None,
                        help="Run only checks of this severity level")
    args = parser.parse_args()

    all_results = []
    all_results.extend(check_artifact_completeness())
    all_results.extend(check_metadata_fields())
    all_results.extend(check_reference_integrity())
    all_results.extend(check_constitution_sync())

    if args.severity:
        all_results = [r for r in all_results if r.severity == args.severity]

    if args.format == "json":
        print(json.dumps([asdict(r) for r in all_results], indent=2))
    else:
        print(format_terminal(all_results))

    p0_or_p1_fails = [r for r in all_results if r.status == "fail" and r.severity in ("P0", "P1")]
    sys.exit(1 if p0_or_p1_fails else 0)


if __name__ == "__main__":
    main()
```

**Files**:
- `joyus-ai/scripts/governance-check.py` (new, ~180 lines)

**Validation**:
- [ ] `python3 scripts/governance-check.py` runs without import errors
- [ ] `python3 scripts/governance-check.py --format json` produces valid JSON
- [ ] Script exits 1 when any P0 or P1 check fails
- [ ] Script exits 0 when all checks pass
- [ ] `--severity P0` flag filters to P0 checks only
- [ ] Script has no external dependencies (stdlib only)

---

### T019: Extend pride-status to surface governance check results

**Purpose**: Make governance check status visible in the existing pride-status integrity report so governance health is part of the routine platform health view.

**Steps**:

1. Locate the pride-status reporting mechanism in `joyus-ai` (look for `pride-status`, `status-report`, or similar in `scripts/`, CI workflows, or README).
2. Determine how pride-status currently collects and displays results.
3. Extend it to call `governance-check.py --format json` and include the results in its output:
   - Add a **Governance** section to the pride-status report
   - Show: total checks, pass count, warn count, fail count, and any P0 fails by name
4. If pride-status is a markdown report generated by a script, add the governance section to that script.
5. If pride-status is a CI job, add a step that calls the governance check and appends output.
6. If pride-status does not exist yet, create a minimal `scripts/pride-status.py` that runs the governance check and reports results — note that this is a stub and the full pride-status feature is out of scope for Spec 007.

**Minimum governance section format** (for terminal or markdown output):

```
## Governance Status

Checks run: N
Passed: N | Warnings: N | Failed: N

P0 failures:
  - ARTIFACT-007-SPEC-MD: Missing required file: spec.md (kitty-specs/007-.../spec.md)

P1 warnings:
  - META-003-REVIEW-CADENCE: Missing required metadata field: review_cadence (kitty-specs/003-.../meta.json)
```

**Files**:
- `joyus-ai/scripts/pride-status.py` or equivalent (updated or created as stub)

**Validation**:
- [ ] Running pride-status produces a Governance section
- [ ] The section shows pass/warn/fail counts
- [ ] P0 failures are individually listed by check_id and message
- [ ] If pride-status was pre-existing, its other sections are not broken

---

### T020: Add CI workflow for governance gates

**Purpose**: Add a GitHub Actions workflow that runs `governance-check.py` on every pull request targeting `main` and blocks merge on any P0 or P1 failure.

**Steps**:

1. Create `.github/workflows/governance.yml` in `joyus-ai`.
2. Trigger: `pull_request` targeting `main`.
3. Steps:
   - Checkout repository
   - Set up Python 3.12
   - Run `python3 scripts/governance-check.py --format terminal`
   - Run `python3 scripts/governance-check.py --format json > governance-results.json`
   - Upload `governance-results.json` as a workflow artifact
   - The check step must fail the job (non-zero exit) on P0 or P1 failures
4. Add a job summary step that posts the terminal output to the GitHub Actions job summary (visible in the PR check details).
5. The workflow must run in under 60 seconds (no external API calls, filesystem reads only).

**Workflow template**:

```yaml
# .github/workflows/governance.yml
name: Governance Checks

on:
  pull_request:
    branches: [main]
  push:
    branches: [main]

jobs:
  governance:
    name: Governance Validation
    runs-on: ubuntu-latest
    timeout-minutes: 5

    steps:
      - name: Checkout
        uses: actions/checkout@v4

      - name: Set up Python
        uses: actions/setup-python@v5
        with:
          python-version: "3.12"

      - name: Run governance checks (terminal)
        run: python3 scripts/governance-check.py --format terminal
        # Exit code 1 on P0/P1 failures — blocks merge

      - name: Run governance checks (JSON artifact)
        if: always()  # Run even if previous step failed
        run: python3 scripts/governance-check.py --format json > governance-results.json

      - name: Upload results artifact
        if: always()
        uses: actions/upload-artifact@v4
        with:
          name: governance-results
          path: governance-results.json
          retention-days: 30

      - name: Post summary
        if: always()
        run: |
          echo "## Governance Check Results" >> $GITHUB_STEP_SUMMARY
          python3 scripts/governance-check.py --format terminal >> $GITHUB_STEP_SUMMARY || true
```

**Files**:
- `joyus-ai/.github/workflows/governance.yml` (new, ~50 lines)

**Validation**:
- [ ] Workflow file parses as valid YAML (`python3 -c "import yaml; yaml.safe_load(open('.github/workflows/governance.yml'))"`)
- [ ] Workflow triggers on `pull_request` targeting `main`
- [ ] Terminal check step exits non-zero on P0/P1 failures (check exit code logic in T018)
- [ ] JSON artifact upload uses `if: always()` so it uploads even when checks fail
- [ ] Workflow has a 5-minute timeout
- [ ] No secrets or external API calls are required

---

### T021: Run full check suite and publish verification report

**Purpose**: Execute the complete governance check suite against the `joyus-ai` repository after WP03 and WP04 are complete, and publish the final verification report that attests the Spec 007 success criteria are met.

**Steps**:

1. Ensure WP03 and WP04 are complete (all governance docs exist, all meta.json fields populated).
2. Run `python3 scripts/governance-check.py --format json > governance/verification-run.json`.
3. Run `python3 scripts/governance-check.py --format terminal` and capture output.
4. Review results:
   - If any P0 or P1 failures remain, do not proceed — fix them first (these are WP03/WP04 items that weren't completed).
   - If only P2 warnings remain, document them and proceed.
5. Create `joyus-ai/governance/verification-report.md` using the template below.
6. This document is the formal sign-off artifact for Spec 007.

**Template**:

```markdown
# Governance Verification Report

**Date**: YYYY-MM-DD
**Spec**: 007-org-scale-agentic-governance
**Assessor**: [agent or human role]
**Check run**: governance-check.py v[VERSION] against commit [SHA]

## Check Summary

| Category | Total | Pass | Warn | Fail |
|----------|-------|------|------|------|
| ARTIFACT (artifact completeness) | N | N | N | N |
| META (metadata fields) | N | N | N | N |
| REF (reference integrity) | N | N | N | N |
| CONST (constitution sync) | N | N | N | N |
| **Total** | N | N | N | N |

**Overall status**: PASS / FAIL

## P0 Status

[ ] Zero P0 failures — required for success

## Spec 007 Success Criteria Attestation

Per spec.md §Success Criteria:

1. [ ] Rollout model is approved and documented in `governance/policy-v1.0.md`
2. [ ] ROI dashboard inputs are defined in `governance/roi-metrics-contract.md` with named owners
3. [ ] MCP integration rubric exists at `governance/mcp-integration-rubric.md`; blocks production deployments
4. [ ] Governance checks run in CI (`governance.yml`) and block merges on P0 failures
5. [ ] Autonomy level classification documented in `governance/autonomy-levels.md`
6. [ ] Level 4/5 scenario holdout policy documented in `governance/scenario-policy.md`
7. [ ] Measured vs perceived productivity tracking defined in roi-metrics-contract.md §M06

## Residual Open Items

| Item | Severity | WP | Description |
|------|---------|-----|-------------|
| (list any remaining P2 items or known gaps) | | | |

## Disposition

All P0 and P1 items resolved. Residual P2 items tracked in `remediation-backlog.md`.
Spec 007 implementation is complete and governance framework is operational.
```

**Files**:
- `joyus-ai/governance/verification-report.md` (new, ~50 lines)
- `joyus-ai/governance/verification-run.json` (generated check output, ~N lines)

**Validation**:
- [ ] Verification report is present and complete
- [ ] All 7 success criteria from spec.md are checked off (or explicitly deferred with justification)
- [ ] Zero P0 failures in the check run
- [ ] `verification-run.json` is committed alongside the report

---

## Definition of Done

- [ ] `scripts/governance-check.py` runs without errors on Python 3.12
- [ ] All four check categories are implemented and produce `GovernanceCheckResult` records
- [ ] JSON output is valid and matches `GovernanceCheckResult` schema
- [ ] Exit code is 1 on P0/P1 failures, 0 on pass/warn-only
- [ ] `.github/workflows/governance.yml` is present and valid YAML
- [ ] CI workflow runs governance check on PRs; P0/P1 failures block merge
- [ ] `governance/verification-report.md` published with all success criteria attested
- [ ] Zero P0 failures in the final check run

## Risks

- **Script false positives**: If the governance check script flags stubs or draft files as failures, CI will block all PRs. Add a `[STUB]` marker detection to downgrade stub-file failures from P0 to P2.
- **Pride-status coupling**: If pride-status does not exist as a script, creating a stub adds scope. Keep the stub minimal — a single Python script that calls governance-check.py and prints the result.
- **Verification timing**: T021 can only run after WP03 and WP04 are complete. If those WPs are blocked, T021 blocks too. Do not mark WP05 done until the verification report shows zero P0 failures.
- **CI permissions**: The governance workflow needs read access to the repo but no write access or secrets. Verify the `permissions` block in the workflow does not grant more than needed.

## Reviewer Guidance

- Run `python3 scripts/governance-check.py --format json | python3 -m json.tool` to verify JSON output is valid before merging.
- Check that the CI workflow's check step has no `continue-on-error: true` that would allow P0 failures to pass silently.
- The verification report is a formal sign-off document — check that all 7 success criteria are attested with evidence, not just checked off.
- Confirm the `--severity P0` filter works correctly: `python3 scripts/governance-check.py --severity P0 --format json` should return only P0 checks.
