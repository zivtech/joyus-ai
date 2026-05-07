#!/usr/bin/env python3
"""Lint staged markdown link syntax that can break governance checks."""

from __future__ import annotations

import argparse
import subprocess
import sys
from dataclasses import dataclass


MAX_TARGET_LENGTH = 240


@dataclass
class Finding:
    path: str
    line: int
    message: str
    text: str


def _run_git(args: list[str]) -> subprocess.CompletedProcess[str]:
    return subprocess.run(
        ["git", *args],
        check=False,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        text=True,
    )


def _staged_markdown_files() -> list[str]:
    result = _run_git(["diff", "--cached", "--name-only", "--diff-filter=ACMR"])
    if result.returncode != 0:
        print(result.stderr, file=sys.stderr, end="")
        sys.exit(result.returncode)
    return [path for path in result.stdout.splitlines() if path.endswith(".md")]


def _read_staged(path: str) -> str | None:
    result = _run_git(["show", f":{path}"])
    if result.returncode != 0:
        return None
    return result.stdout


def _read_worktree(path: str) -> str | None:
    try:
        with open(path, encoding="utf-8") as handle:
            return handle.read()
    except OSError:
        return None


def _lint_text(path: str, text: str) -> list[Finding]:
    findings: list[Finding] = []
    in_fence = False

    for line_number, line in enumerate(text.splitlines(), start=1):
        stripped = line.lstrip()
        if stripped.startswith("```") or stripped.startswith("~~~"):
            in_fence = not in_fence
            continue
        if in_fence:
            continue

        search_from = 0
        while True:
            start = line.find("](", search_from)
            if start == -1:
                break

            target_start = start + 2
            target_end = line.find(")", target_start)
            if target_end == -1:
                findings.append(
                    Finding(
                        path,
                        line_number,
                        "Inline markdown link is missing a closing ')'",
                        line.rstrip(),
                    )
                )
                break

            target = line[target_start:target_end]
            if not target.strip():
                findings.append(
                    Finding(path, line_number, "Inline markdown link target is empty", line.rstrip())
                )
            elif target != target.strip():
                findings.append(
                    Finding(
                        path,
                        line_number,
                        "Inline markdown link target has surrounding whitespace",
                        line.rstrip(),
                    )
                )
            elif len(target) > MAX_TARGET_LENGTH:
                findings.append(
                    Finding(
                        path,
                        line_number,
                        f"Inline markdown link target exceeds {MAX_TARGET_LENGTH} characters",
                        line.rstrip(),
                    )
                )

            search_from = target_end + 1

    return findings


def main() -> int:
    parser = argparse.ArgumentParser(description="Lint markdown inline links")
    parser.add_argument("--staged", action="store_true", help="Lint staged markdown files")
    parser.add_argument("files", nargs="*", help="Markdown files to lint from the worktree")
    args = parser.parse_args()

    if args.staged:
        files = _staged_markdown_files()
        reader = _read_staged
    else:
        files = [path for path in args.files if path.endswith(".md")]
        reader = _read_worktree

    findings: list[Finding] = []
    for path in files:
        text = reader(path)
        if text is None:
            continue
        findings.extend(_lint_text(path, text))

    if not findings:
        return 0

    print("Markdown link lint failed:", file=sys.stderr)
    for finding in findings:
        print(
            f"{finding.path}:{finding.line}: {finding.message}",
            file=sys.stderr,
        )
        print(f"  {finding.text}", file=sys.stderr)
    return 1


if __name__ == "__main__":
    raise SystemExit(main())
