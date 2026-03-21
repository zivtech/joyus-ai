#!/usr/bin/env python3
"""Governance Status summary wrapper for pride-status integration.

Calls governance-check.py --format json, parses results, and prints a
Governance Status summary showing pass/warn/fail counts and P0 failures.
"""

from __future__ import annotations

import json
import subprocess
import sys
from pathlib import Path


def main() -> None:
    script_dir = Path(__file__).parent
    governance_check = script_dir / "governance-check.py"
    root = Path(__file__).parent.parent

    result = subprocess.run(
        [sys.executable, str(governance_check), "--format", "json", "--root", str(root)],
        capture_output=True,
        text=True,
    )

    try:
        data = json.loads(result.stdout)
    except json.JSONDecodeError:
        print("Governance Status: ERROR (could not parse governance-check output)")
        if result.stderr:
            print(result.stderr.strip())
        sys.exit(1)

    results = data.get("results", [])
    passes = [r for r in results if r["status"] == "pass"]
    fails = [r for r in results if r["status"] == "fail"]
    warns = [r for r in results if r["status"] == "warn"]
    p0_fails = [r for r in fails if r["severity"] == "P0"]
    p1_fails = [r for r in fails if r["severity"] == "P1"]

    print("=== Governance Status ===")
    print(f"Pass: {len(passes)}  Fail: {len(fails)}  Warn: {len(warns)}")
    print(f"P0 failures: {len(p0_fails)}  P1 failures: {len(p1_fails)}")

    if p0_fails:
        print("\nP0 Failures (must fix before merge):")
        for r in p0_fails:
            print(f"  [{r['check_id']}] {r['target']}: {r['message']}")

    if not fails and not warns:
        print("\nStatus: PASS — all governance checks clean")
    elif not p0_fails and not p1_fails:
        print("\nStatus: WARN — warnings present but no blocking failures")
    else:
        print("\nStatus: FAIL — blocking governance failures must be resolved")
        sys.exit(1)


if __name__ == "__main__":
    main()
