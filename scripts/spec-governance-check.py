#!/usr/bin/env python3
"""Spec governance checks for joyus-ai.

Checks:
1. Required artifact presence by lifecycle state.
2. Broken local markdown references.
3. Constitution drift between spec and .kittify memory.
4. Checklist/spec consistency for "no implementation details" claims.
5. Platform-level required sections for new platform/critical features.
6. Metadata contract completeness.
"""

from __future__ import annotations

import argparse
import json
import re
import sys
from dataclasses import dataclass
from pathlib import Path
from typing import Iterable

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
    status: str  # fail/warn
    target: str
    message: str


def _normalize_constitution(text: str) -> str:
    lines = [ln.rstrip() for ln in text.splitlines()]
    normalized = []
    for idx, line in enumerate(lines):
        if idx == 0 and line.startswith("#") and "Constitution" in line:
            normalized.append("# Constitution")
            continue
        normalized.append(line)
    return "\n".join(normalized).strip()


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


def check_markdown_links(root: Path) -> list[Finding]:
    findings: list[Finding] = []

    for md_file in _iter_markdown_files(root):
        text = md_file.read_text()
        for target in _extract_local_link_targets(text):
            if _is_placeholder_target(target):
                continue

            candidates: list[Path] = []
            if target.startswith("/"):
                candidates.append(Path(target))
            else:
                candidates.append((md_file.parent / target).resolve())
                if target.startswith(("spec/", "kitty-specs/", ".claude/", ".kittify/", "scripts/", "deploy/")):
                    candidates.append((root / target).resolve())

            if not any(c.exists() for c in candidates):
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
    source = root / "spec" / "constitution.md"
    memory = root / ".kittify" / "memory" / "constitution.md"

    if not source.exists() or not memory.exists():
        findings.append(
            Finding(
                "CONST-001",
                "P0",
                "fail",
                "spec/constitution.md",
                "Constitution source or .kittify memory copy is missing",
            )
        )
        return findings

    source_norm = _normalize_constitution(source.read_text())
    memory_norm = _normalize_constitution(memory.read_text())

    if source_norm != memory_norm:
        findings.append(
            Finding(
                "CONST-002",
                "P0",
                "fail",
                "spec/constitution.md vs .kittify/memory/constitution.md",
                "Constitution drift detected beyond allowed title normalization",
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


def _to_markdown_report(root: Path, findings: list[Finding]) -> str:
    fails = [f for f in findings if f.status == "fail"]
    warns = [f for f in findings if f.status == "warn"]
    p0 = [f for f in findings if f.severity == "P0" and f.status == "fail"]

    lines = []
    lines.append("# Spec Governance Verification Report")
    lines.append("")
    lines.append(f"Generated from `{root}`")
    lines.append("")
    lines.append("## Summary")
    lines.append(f"- Total findings: {len(findings)}")
    lines.append(f"- Fails: {len(fails)}")
    lines.append(f"- Warnings: {len(warns)}")
    lines.append(f"- P0 fails: {len(p0)}")
    lines.append("")

    if not findings:
        lines.append("No findings. Governance checks passed.")
        return "\n".join(lines)

    lines.append("## Findings")
    lines.append("")
    lines.append("| Check | Severity | Status | Target | Message |")
    lines.append("|---|---|---|---|---|")
    for f in findings:
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
    args = parser.parse_args()

    root = Path(args.root).resolve()

    findings: list[Finding] = []
    findings.extend(check_artifacts_and_metadata(root))
    findings.extend(check_markdown_links(root))
    findings.extend(check_constitution_sync(root))
    findings.extend(check_checklist_consistency(root))
    findings.extend(check_platform_sections(root))

    if args.report:
        report_path = Path(args.report)
        if not report_path.is_absolute():
            report_path = root / report_path
        report_path.parent.mkdir(parents=True, exist_ok=True)
        report_path.write_text(_to_markdown_report(root, findings))

    if args.json:
        print(
            json.dumps(
                {
                    "root": str(root),
                    "findings": [f.__dict__ for f in findings],
                },
                indent=2,
            )
        )
    else:
        print(_to_markdown_report(root, findings))

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
