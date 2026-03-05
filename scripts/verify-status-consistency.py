#!/usr/bin/env python3
"""Validate canonical feature readiness and lifecycle consistency.

Checks:
1. status/feature-readiness.json structure and enum values
2. feature entries exist for every kitty-specs meta.json
3. lifecycle_state in status matches kitty-specs/*/meta.json
4. production_ready cannot coexist with placeholder/stub provider readiness
"""

from __future__ import annotations

import json
import re
import sys
from datetime import datetime
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
STATUS_FILE = ROOT / "status" / "feature-readiness.json"

LIFECYCLE_VALUES = {"spec-only", "planning", "execution", "done", "blocked", "deprecated"}
IMPL_VALUES = {"none", "scaffolded", "integrated", "validated"}
READINESS_VALUES = {"not_ready", "pilot_ready", "production_ready"}
GEN_PROVIDER_VALUES = {"n/a", "placeholder", "configured", "validated"}
VOICE_ANALYZER_VALUES = {"n/a", "stub", "configured", "validated"}


def parse_json(path: Path) -> dict:
    try:
        return json.loads(path.read_text())
    except Exception as exc:  # pragma: no cover
        raise RuntimeError(f"invalid JSON at {path}: {exc}") from exc


def parse_iso(ts: str) -> bool:
    try:
        datetime.fromisoformat(ts.replace("Z", "+00:00"))
        return True
    except Exception:
        return False


def collect_meta_states() -> dict[str, str]:
    states: dict[str, str] = {}
    for meta_path in sorted((ROOT / "kitty-specs").glob("*/meta.json")):
        data = parse_json(meta_path)
        fid = str(data.get("feature_number", "")).zfill(3)
        lifecycle = str(data.get("lifecycle_state", ""))
        if not re.fullmatch(r"\d{3}", fid):
            raise RuntimeError(f"invalid or missing feature_number in {meta_path}")
        if lifecycle not in LIFECYCLE_VALUES:
            raise RuntimeError(
                f"invalid lifecycle_state '{lifecycle}' in {meta_path}; expected one of {sorted(LIFECYCLE_VALUES)}"
            )
        states[fid] = lifecycle
    return states


def validate_status(status: dict, meta_states: dict[str, str]) -> list[str]:
    errors: list[str] = []

    if not isinstance(status, dict):
        return ["status file root must be an object"]

    updated_at = status.get("updated_at")
    features = status.get("features")

    if not isinstance(updated_at, str) or not parse_iso(updated_at):
        errors.append("updated_at must be a valid ISO 8601 timestamp")

    if not isinstance(features, dict):
        return errors + ["features must be an object"]

    for fid, entry in features.items():
        if not re.fullmatch(r"\d{3}", str(fid)):
            errors.append(f"feature key '{fid}' is not NNN format")
            continue
        if not isinstance(entry, dict):
            errors.append(f"feature {fid} entry must be an object")
            continue

        for key in ["lifecycle_state", "implementation_state", "production_readiness", "notes"]:
            if key not in entry:
                errors.append(f"feature {fid} missing required key '{key}'")

        lifecycle = entry.get("lifecycle_state")
        impl = entry.get("implementation_state")
        readiness = entry.get("production_readiness")
        notes = entry.get("notes")

        if lifecycle not in LIFECYCLE_VALUES:
            errors.append(f"feature {fid} invalid lifecycle_state '{lifecycle}'")
        if impl not in IMPL_VALUES:
            errors.append(f"feature {fid} invalid implementation_state '{impl}'")
        if readiness not in READINESS_VALUES:
            errors.append(f"feature {fid} invalid production_readiness '{readiness}'")
        if not isinstance(notes, str) or not notes.strip():
            errors.append(f"feature {fid} notes must be a non-empty string")

        provider = entry.get("provider_readiness")
        if provider is not None:
            if not isinstance(provider, dict):
                errors.append(f"feature {fid} provider_readiness must be an object")
            else:
                gen = provider.get("generation_provider")
                voice = provider.get("voice_analyzer")
                if gen is not None and gen not in GEN_PROVIDER_VALUES:
                    errors.append(f"feature {fid} invalid generation_provider '{gen}'")
                if voice is not None and voice not in VOICE_ANALYZER_VALUES:
                    errors.append(f"feature {fid} invalid voice_analyzer '{voice}'")
                if readiness == "production_ready" and gen == "placeholder":
                    errors.append(
                        f"feature {fid} cannot be production_ready with generation_provider=placeholder"
                    )
                if readiness == "production_ready" and voice == "stub":
                    errors.append(
                        f"feature {fid} cannot be production_ready with voice_analyzer=stub"
                    )

    status_ids = set(features.keys())
    meta_ids = set(meta_states.keys())

    missing_from_status = sorted(meta_ids - status_ids)
    for fid in missing_from_status:
        errors.append(f"feature {fid} exists in kitty-specs meta but missing in status registry")

    missing_from_meta = sorted(status_ids - meta_ids)
    for fid in missing_from_meta:
        errors.append(f"feature {fid} exists in status registry but has no kitty-specs meta.json")

    for fid in sorted(status_ids & meta_ids):
        status_lifecycle = features[fid].get("lifecycle_state")
        if status_lifecycle != meta_states[fid]:
            errors.append(
                f"feature {fid} lifecycle mismatch: status={status_lifecycle} meta={meta_states[fid]}"
            )

    return errors


def main() -> int:
    if not STATUS_FILE.exists():
        print(f"ERROR: missing status file: {STATUS_FILE}", file=sys.stderr)
        return 1

    try:
        status = parse_json(STATUS_FILE)
        meta_states = collect_meta_states()
    except Exception as exc:
        print(f"ERROR: {exc}", file=sys.stderr)
        return 1

    errors = validate_status(status, meta_states)
    if errors:
        print("Status consistency checks FAILED:", file=sys.stderr)
        for err in errors:
            print(f"- {err}", file=sys.stderr)
        return 1

    print("Status consistency checks PASSED")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
