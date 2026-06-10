#!/usr/bin/env python3
"""Spec governance checks for joyus-ai.

Checks:
1. Required artifact presence by lifecycle state.
2. Broken local markdown references.
3. Constitution and Spec Kitty charter layout.
4. Checklist/spec consistency for "no implementation details" claims.
5. Platform-level required sections for new platform/critical features.
6. Metadata contract completeness.
"""

from __future__ import annotations

import argparse
import json
import re
import subprocess
import sys
from dataclasses import dataclass
from pathlib import Path
from typing import Iterable

DEFAULT_BASELINE_PATH = "governance/spec-governance-baseline.json"

REQUIRED_META_KEYS = [
    "feature_number",
    "slug",
    "friendly_name",
    "mission",
    "created_at",
    "measurement_owner",
    "review_cadence",
    "risk_class",
    "lifecycle_state",
]

REQUIRED_BY_LIFECYCLE = {
    "spec-only": ["spec.md", "meta.json", "checklists/requirements.md"],
    "planning": [
        "spec.md",
        "meta.json",
        "checklists/requirements.md",
        "plan.md",
        "tasks.md",
        "research.md",
    ],
    "execution": [
        "spec.md",
        "meta.json",
        "checklists/requirements.md",
        "plan.md",
        "tasks.md",
        "research.md",
    ],
    "done": [
        "spec.md",
        "meta.json",
        "checklists/requirements.md",
        "plan.md",
        "tasks.md",
        "research.md",
    ],
}

TECH_KEYWORDS = [
    "node.js",
    "typescript",
    "python",
    "fastapi",
    "next.js",
    "express",
    "postgresql",
    "mysql",
    "docker",
    "aws",
    "ec2",
    "drizzle",
    "spacy",
    "jwt",
    "bcrypt",
    "redis",
    "mcp server",
]

PLATFORM_REQUIRED_SECTIONS = [
    "adoption plan",
    "roi metrics",
    "security + mcp governance",
]

MAX_LOCAL_LINK_TARGET_LENGTH = 240

SCOPE_MARKDOWN_DIRS = [
    "spec",
    "kitty-specs",
    ".claude/commands",
    ".kittify/memory",
]

SCOPE_MARKDOWN_FILES = [
    "README.md",
    "ROADMAP.md",
    ".kittify/AGENTS.md",
]


@dataclass
class Finding:
    check_id: str
    severity: str  # P0/P1/P2
    status: str  # fail/warn/accepted
    target: str
    message: str


def _finding_key(finding: Finding) -> tuple[str, str, str, str]:
    return (
        finding.check_id,
        finding.severity,
        finding.target,
        finding.message,
    )


def _normalize_status(finding: Finding) -> Finding:
    if finding.status == "fail" and finding.severity != "P0":
        return Finding(
            finding.check_id,
            finding.severity,
            "warn",
            finding.target,
            finding.message,
        )
    return finding


def _baseline_path(root: Path, baseline_arg: str, no_baseline: bool) -> Path | None:
    if no_baseline:
        return None
    baseline_path = Path(baseline_arg)
    if not baseline_path.is_absolute():
        baseline_path = root / baseline_path
    return baseline_path


def _load_baseline(root: Path, baseline_path: Path | None) -> tuple[set[tuple[str, str, str, str]], list[Finding]]:
    if baseline_path is None or not baseline_path.exists():
        return set(), []

    target = str(baseline_path.relative_to(root)) if baseline_path.is_relative_to(root) else str(baseline_path)

    try:
        data = json.loads(baseline_path.read_text())
    except Exception as exc:
        return set(), [
            Finding(
                "BASE-001",
                "P0",
                "fail",
                target,
                f"Baseline file is invalid JSON: {exc}",
            )
        ]

    entries = data.get("findings") if isinstance(data, dict) else data
    if not isinstance(entries, list):
        return set(), [
            Finding(
                "BASE-001",
                "P0",
                "fail",
                target,
                "Baseline file must contain a findings list",
            )
        ]

    baseline_keys: set[tuple[str, str, str, str]] = set()
    errors: list[Finding] = []
    required = ["check_id", "severity", "target", "message"]

    for index, entry in enumerate(entries):
        entry_target = f"{target}#{index + 1}"
        if not isinstance(entry, dict):
            errors.append(
                Finding("BASE-001", "P0", "fail", entry_target, "Baseline entry must be an object")
            )
            continue

        missing = [key for key in required if not entry.get(key)]
        if missing:
            errors.append(
                Finding(
                    "BASE-001",
                    "P0",
                    "fail",
                    entry_target,
                    "Baseline entry missing required keys: " + ", ".join(missing),
                )
            )
            continue

        severity = str(entry["severity"])
        if severity == "P0":
            errors.append(
                Finding(
                    "BASE-002",
                    "P0",
                    "fail",
                    entry_target,
                    "Baseline entries cannot accept P0 findings",
                )
            )
            continue

        baseline_keys.add(
            (
                str(entry["check_id"]),
                severity,
                str(entry["target"]),
                str(entry["message"]),
            )
        )

    return baseline_keys, errors


def _split_baselined_findings(
    findings: list[Finding], baseline_keys: set[tuple[str, str, str, str]]
) -> tuple[list[Finding], list[Finding]]:
    active: list[Finding] = []
    accepted: list[Finding] = []

    for finding in findings:
        if _finding_key(finding) in baseline_keys:
            accepted.append(
                Finding(
                    finding.check_id,
                    finding.severity,
                    "accepted",
                    finding.target,
                    finding.message,
                )
            )
        else:
            active.append(finding)

    return active, accepted


def _iter_feature_dirs(root: Path) -> Iterable[Path]:
    specs_dir = root / "kitty-specs"
    if not specs_dir.exists():
        return []
    return sorted([p for p in specs_dir.iterdir() if p.is_dir()])


def _parse_meta(meta_path: Path) -> dict:
    try:
        return json.loads(meta_path.read_text())
    except Exception:
        return {}


def check_artifacts_and_metadata(root: Path) -> list[Finding]:
    findings: list[Finding] = []

    for feature_dir in _iter_feature_dirs(root):
        feature_slug = feature_dir.name
        meta_path = feature_dir / "meta.json"
        if not meta_path.exists():
            findings.append(
                Finding(
                    "ART-001",
                    "P0",
                    "fail",
                    str(feature_dir),
                    "Missing meta.json",
                )
            )
            continue

        meta = _parse_meta(meta_path)
        if not meta:
            findings.append(
                Finding(
                    "ART-002",
                    "P0",
                    "fail",
                    str(meta_path),
                    "meta.json is invalid JSON",
                )
            )
            continue

        missing_meta = [k for k in REQUIRED_META_KEYS if not meta.get(k)]
        if missing_meta:
            findings.append(
                Finding(
                    "META-001",
                    "P0",
                    "fail",
                    str(meta_path),
                    f"Missing required metadata keys: {', '.join(missing_meta)}",
                )
            )

        lifecycle = str(meta.get("lifecycle_state", "spec-only"))
        required = REQUIRED_BY_LIFECYCLE.get(lifecycle, REQUIRED_BY_LIFECYCLE["spec-only"])

        missing_required = [rel for rel in required if not (feature_dir / rel).exists()]
        if missing_required:
            sev = "P0" if lifecycle in {"execution", "done"} else "P1"
            findings.append(
                Finding(
                    "ART-003",
                    sev,
                    "fail",
                    feature_slug,
                    f"Missing required artifacts for lifecycle '{lifecycle}': {', '.join(missing_required)}",
                )
            )

    return findings


def _extract_local_link_targets(md_text: str) -> list[str]:
    # Ignore links embedded in fenced code blocks.
    stripped = re.sub(r"```[\s\S]*?```", "", md_text)
    targets = []
    for match in re.finditer(r"\[[^\]]+\]\(([^)]+)\)", stripped):
        raw = match.group(1).strip()
        if not raw:
            continue
        if raw.startswith("http://") or raw.startswith("https://") or raw.startswith("mailto:"):
            continue
        if raw.startswith("#"):
            continue
        target = raw.split("#", 1)[0].strip()
        if target:
            targets.append(target)
    return targets


def _is_placeholder_target(target: str) -> bool:
    lowered = target.lower()
    if any(ch in target for ch in "{}"):
        return True
    if "'" in target or '"' in target:
        return True
    if target in {"path", "url", "link"}:
        return True
    if lowered.startswith(("tutorials/", "how-to/", "reference/", "explanation/")):
        return True
    if lowered.startswith("templates/commands/"):
        return True
    return False


def _invalid_local_link_target_reason(target: str) -> str:
    if any(ch in target for ch in "\r\n"):
        return "target contains a newline"
    if len(target) > MAX_LOCAL_LINK_TARGET_LENGTH:
        return f"target exceeds {MAX_LOCAL_LINK_TARGET_LENGTH} characters"
    return ""


def _iter_markdown_files(root: Path) -> Iterable[Path]:
    for rel_dir in SCOPE_MARKDOWN_DIRS:
        dir_path = root / rel_dir
        if dir_path.exists():
            for p in dir_path.rglob("*.md"):
                if p.is_file():
                    yield p
    for rel_file in SCOPE_MARKDOWN_FILES:
        file_path = root / rel_file
        if file_path.exists() and file_path.is_file():
            yield file_path


def _is_git_ignored(root: Path, path: Path) -> bool:
    try:
        result = subprocess.run(
            ["git", "check-ignore", "--quiet", str(path)],
            capture_output=True,
            cwd=str(root),
        )
        return result.returncode == 0
    except Exception:
        return False


def check_markdown_links(root: Path) -> list[Finding]:
    findings: list[Finding] = []

    for md_file in _iter_markdown_files(root):
        text = md_file.read_text()
        for target in _extract_local_link_targets(text):
            if _is_placeholder_target(target):
                continue

            invalid_reason = _invalid_local_link_target_reason(target)
            if invalid_reason:
                findings.append(
                    Finding(
                        "REF-002",
                        "P0",
                        "fail",
                        str(md_file.relative_to(root)),
                        f"Invalid local markdown reference ({invalid_reason}): {target}",
                    )
                )
                continue

            candidates: list[Path] = []
            if target.startswith("/"):
                candidates.append(Path(target))
            else:
                candidates.append((md_file.parent / target).resolve())
                if target.startswith(("spec/", "kitty-specs/", ".claude/", ".kittify/", "scripts/", "deploy/")):
                    candidates.append((root / target).resolve())

            try:
                target_exists = any(c.exists() for c in candidates)
            except OSError as exc:
                findings.append(
                    Finding(
                        "REF-002",
                        "P0",
                        "fail",
                        str(md_file.relative_to(root)),
                        f"Invalid local markdown reference ({exc.strerror}): {target}",
                    )
                )
                continue

            if not target_exists:
                if any(_is_git_ignored(root, c) for c in candidates):
                    continue
                findings.append(
                    Finding(
                        "REF-001",
                        "P0",
                        "fail",
                        str(md_file.relative_to(root)),
                        f"Broken local markdown reference: {target}",
                    )
                )

    return findings


def check_constitution_sync(root: Path) -> list[Finding]:
    findings: list[Finding] = []
    constitution = root / "spec" / "constitution.md"
    charter_dir = root / ".kittify" / "charter"
    charter = charter_dir / "charter.md"
    derived_files = [
        charter_dir / "governance.yaml",
        charter_dir / "directives.yaml",
        charter_dir / "metadata.yaml",
    ]
    legacy_files = [
        root / ".kittify" / "memory" / "constitution.md",
        root / ".kittify" / "constitution" / "constitution.md",
        root / ".kittify" / "constitution" / "governance.yaml",
        root / ".kittify" / "constitution" / "directives.yaml",
        root / ".kittify" / "constitution" / "metadata.yaml",
    ]

    if not constitution.exists():
        findings.append(
            Finding(
                "CONST-001",
                "P0",
                "fail",
                "spec/constitution.md",
                "Project constitution is missing",
            )
        )

    if not charter.exists():
        findings.append(
            Finding(
                "CONST-002",
                "P0",
                "fail",
                ".kittify/charter/charter.md",
                "Spec Kitty runtime charter is missing",
            )
        )

    missing_derived = [path for path in derived_files if not path.exists()]
    if missing_derived:
        findings.append(
            Finding(
                "CONST-003",
                "P0",
                "fail",
                ".kittify/charter",
                "Missing Spec Kitty derived charter files: "
                + ", ".join(str(path.relative_to(root)) for path in missing_derived),
            )
        )

    present_legacy = [path for path in legacy_files if path.exists()]
    if present_legacy:
        findings.append(
            Finding(
                "CONST-004",
                "P0",
                "fail",
                ".kittify",
                "Legacy Spec Kitty constitution files should be removed or migrated: "
                + ", ".join(str(path.relative_to(root)) for path in present_legacy),
            )
        )

    return findings


def check_checklist_consistency(root: Path) -> list[Finding]:
    findings: list[Finding] = []

    for feature_dir in _iter_feature_dirs(root):
        checklist = feature_dir / "checklists" / "requirements.md"
        spec = feature_dir / "spec.md"
        if not checklist.exists() or not spec.exists():
            continue

        checklist_text = checklist.read_text().lower()
        if "- [x] no implementation details" not in checklist_text:
            continue

        spec_text = spec.read_text().lower()
        found = [kw for kw in TECH_KEYWORDS if kw in spec_text]
        if found:
            findings.append(
                Finding(
                    "CHK-001",
                    "P1",
                    "fail",
                    str(spec.relative_to(root)),
                    "Checklist claims no implementation details, but spec contains technical terms: "
                    + ", ".join(sorted(set(found))[:8]),
                )
            )

    return findings


def _created_after_vnext(created_at: str) -> bool:
    # Lexicographic compare is sufficient for ISO date prefix.
    return created_at[:10] >= "2026-02-23"


def check_platform_sections(root: Path) -> list[Finding]:
    findings: list[Finding] = []

    for feature_dir in _iter_feature_dirs(root):
        meta_path = feature_dir / "meta.json"
        spec_path = feature_dir / "spec.md"
        if not meta_path.exists() or not spec_path.exists():
            continue

        meta = _parse_meta(meta_path)
        risk = str(meta.get("risk_class", "")).strip().lower()
        created_at = str(meta.get("created_at", ""))

        if risk not in {"platform", "critical"}:
            continue

        spec_text = spec_path.read_text().lower()
        missing = [
            sec
            for sec in PLATFORM_REQUIRED_SECTIONS
            if not re.search(rf"^##+\s+{re.escape(sec)}\b", spec_text, flags=re.MULTILINE)
        ]

        if not missing:
            continue

        if _created_after_vnext(created_at):
            findings.append(
                Finding(
                    "PLAT-001",
                    "P0",
                    "fail",
                    str(spec_path.relative_to(root)),
                    "Missing required platform sections: " + ", ".join(missing),
                )
            )
        else:
            findings.append(
                Finding(
                    "PLAT-002",
                    "P2",
                    "warn",
                    str(spec_path.relative_to(root)),
                    "Legacy platform feature missing vNext sections: " + ", ".join(missing),
                )
            )

    return findings


def _to_markdown_report(root: Path, findings: list[Finding], accepted_baseline: list[Finding]) -> str:
    fails = [f for f in findings if f.status == "fail"]
    warns = [f for f in findings if f.status == "warn"]
    p0 = [f for f in findings if f.severity == "P0" and f.status == "fail"]

    lines = []
    lines.append("# Spec Governance Verification Report")
    lines.append("")
    lines.append(f"Generated from `{root}`")
    lines.append("")
    lines.append("## Summary")
    lines.append(f"- Active findings: {len(findings)}")
    lines.append(f"- Blocking failures: {len(fails)}")
    lines.append(f"- Warnings: {len(warns)}")
    lines.append(f"- Accepted baseline findings: {len(accepted_baseline)}")
    lines.append(f"- P0 blocking failures: {len(p0)}")
    lines.append("")

    if not findings:
        lines.append("No active findings. Governance checks passed.")
    else:
        lines.append("## Active Findings")
        lines.append("")
        lines.append("| Check | Severity | Status | Target | Message |")
        lines.append("|---|---|---|---|---|")
        for f in findings:
            lines.append(
                f"| {f.check_id} | {f.severity} | {f.status} | `{f.target}` | {f.message.replace('|', '/')} |"
            )

    if accepted_baseline:
        lines.append("")
        lines.append("## Accepted Baseline Findings")
        lines.append("")
        lines.append("These findings are known legacy debt and do not block the P0 merge gate.")
        lines.append("")
        lines.append("| Check | Severity | Status | Target | Message |")
        lines.append("|---|---|---|---|---|")
        for f in accepted_baseline:
            lines.append(
                f"| {f.check_id} | {f.severity} | {f.status} | `{f.target}` | {f.message.replace('|', '/')} |"
            )

    return "\n".join(lines)


def main() -> None:
    parser = argparse.ArgumentParser(description="Run spec governance checks")
    parser.add_argument("--root", default=".", help="Repository root")
    parser.add_argument("--strict", action="store_true", help="Fail on any fail/warn finding")
    parser.add_argument("--report", default="", help="Optional markdown report output path")
    parser.add_argument("--json", action="store_true", help="Emit findings as JSON")
    parser.add_argument(
        "--baseline",
        default=DEFAULT_BASELINE_PATH,
        help=f"Accepted legacy finding baseline path (default: {DEFAULT_BASELINE_PATH})",
    )
    parser.add_argument("--no-baseline", action="store_true", help="Disable accepted legacy baseline")
    args = parser.parse_args()

    root = Path(args.root).resolve()

    raw_findings: list[Finding] = []
    raw_findings.extend(check_artifacts_and_metadata(root))
    raw_findings.extend(check_markdown_links(root))
    raw_findings.extend(check_constitution_sync(root))
    raw_findings.extend(check_checklist_consistency(root))
    raw_findings.extend(check_platform_sections(root))

    normalized_findings = [_normalize_status(finding) for finding in raw_findings]
    baseline_path = _baseline_path(root, args.baseline, args.no_baseline)
    baseline_keys, baseline_errors = _load_baseline(root, baseline_path)
    findings, accepted_baseline = _split_baselined_findings(normalized_findings, baseline_keys)
    findings = baseline_errors + findings

    if args.report:
        report_path = Path(args.report)
        if not report_path.is_absolute():
            report_path = root / report_path
        report_path.parent.mkdir(parents=True, exist_ok=True)
        report_path.write_text(_to_markdown_report(root, findings, accepted_baseline))

    if args.json:
        print(
            json.dumps(
                {
                    "root": str(root),
                    "baseline": str(baseline_path) if baseline_path else None,
                    "findings": [f.__dict__ for f in findings],
                    "accepted_baseline": [f.__dict__ for f in accepted_baseline],
                },
                indent=2,
            )
        )
    else:
        print(_to_markdown_report(root, findings, accepted_baseline))

    p0_fails = [f for f in findings if f.status == "fail" and f.severity == "P0"]
    any_fails = [f for f in findings if f.status == "fail"]
    any_warns = [f for f in findings if f.status == "warn"]

    if args.strict:
        if any_fails or any_warns:
            sys.exit(1)
        sys.exit(0)

    if p0_fails:
        sys.exit(1)

    sys.exit(0)


if __name__ == "__main__":
    main()
