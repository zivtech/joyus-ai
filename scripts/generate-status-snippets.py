#!/usr/bin/env python3
"""Generate status markdown snippets from status/feature-readiness.json.

Usage:
  python scripts/generate-status-snippets.py         # write files
  python scripts/generate-status-snippets.py --check # fail if out of date
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
STATUS_FILE = ROOT / "status" / "feature-readiness.json"
OUTPUT_FILE = ROOT / "status" / "generated" / "feature-table.md"


def load_status() -> dict:
    return json.loads(STATUS_FILE.read_text())


def render_table(status: dict) -> str:
    rows = []
    features: dict[str, dict] = status["features"]
    for fid in sorted(features.keys()):
        item = features[fid]
        rows.append(
            f"| {fid} | {item['lifecycle_state']} | {item['implementation_state']} | "
            f"{item['production_readiness']} | {item['notes']} |"
        )

    header = [
        "# Generated Feature Readiness",
        "",
        f"Source: `status/feature-readiness.json` (updated_at: {status['updated_at']})",
        "",
        "| Feature | Lifecycle | Implementation | Readiness | Notes |",
        "|---|---|---|---|---|",
    ]

    return "\n".join(header + rows) + "\n"


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--check", action="store_true", help="verify generated files are up to date")
    args = parser.parse_args()

    if not STATUS_FILE.exists():
        print(f"ERROR: missing status file: {STATUS_FILE}", file=sys.stderr)
        return 1

    status = load_status()
    content = render_table(status)

    if args.check:
        if not OUTPUT_FILE.exists():
            print(f"ERROR: missing generated file: {OUTPUT_FILE}", file=sys.stderr)
            return 1
        current = OUTPUT_FILE.read_text()
        if current != content:
            print("ERROR: generated status snippets are out of date", file=sys.stderr)
            return 1
        print("Generated status snippets are up to date")
        return 0

    OUTPUT_FILE.parent.mkdir(parents=True, exist_ok=True)
    OUTPUT_FILE.write_text(content)
    print(f"Wrote {OUTPUT_FILE}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
