#!/usr/bin/env python3
"""Kitty Pride status - cross-repo feature overview.

Reads the local pride registry and walks each repo's kitty-specs/
to produce a unified feature status table with integrity signals.

Usage:
    python scripts/pride-status.py
    python scripts/pride-status.py --registry ~/.config/kitty-pride/joyus.yaml
    python scripts/pride-status.py --json
"""

from __future__ import annotations

import argparse
import json
import re
import sys
from pathlib import Path

DEFAULT_REGISTRY = Path.home() / ".config" / "kitty-pride" / "joyus.yaml"

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


def _parse_simple_yaml(path: Path) -> dict:
    """Minimal YAML parser supporting up to 2 levels of nesting."""
    data: dict = {}
    l0_key: str | None = None
    l1_key: str | None = None

    def _clean(v: str) -> str:
        return v.strip().strip('"').strip("'")

    for line in path.read_text().splitlines():
        stripped = line.strip()
        if not stripped or stripped.startswith("#"):
            continue

        indent = len(line) - len(line.lstrip())

        if indent == 0:
            m = re.match(r"^([\w][\w.-]*):\s*(.*)", stripped)
            if m:
                key, val = m.group(1), _clean(m.group(2))
                l0_key = key
                l1_key = None
                data[key] = val if val else {}
            continue

        if indent <= 2 and l0_key and isinstance(data.get(l0_key), dict):
            m = re.match(r"^([\w][\w.-]*):\s*(.*)", stripped)
            if m:
                key, val = m.group(1), _clean(m.group(2))
                l1_key = key
                data[l0_key][key] = val if val else {}
                continue

        if indent > 2 and l0_key and l1_key and isinstance(data.get(l0_key), dict):
            m = re.match(r"^([\w][\w.-]*):\s*(.*)", stripped)
            if m:
                key, val = m.group(1), _clean(m.group(2))
                entry = data[l0_key].get(l1_key)
                if isinstance(entry, dict):
                    entry[key] = val
                continue

    return data


def _load_registry(path: Path) -> dict[str, Path]:
    """Load registry and return {repo_id: path} mapping."""
    try:
        import yaml  # type: ignore

        raw = yaml.safe_load(path.read_text())
    except ImportError:
        raw = _parse_simple_yaml(path)

    repos = {}
    raw_repos = raw.get("repos", {})
    for repo_id, info in raw_repos.items():
        if isinstance(info, dict):
            repo_path = Path(info.get("path", "")).expanduser()
        else:
            repo_path = Path(str(info)).expanduser()
        if repo_path.is_dir():
            repos[repo_id] = repo_path
    return repos


def _normalize_constitution(text: str) -> str:
    lines = [ln.rstrip() for ln in text.splitlines()]
    normalized: list[str] = []
    for idx, line in enumerate(lines):
        if idx == 0 and line.startswith("#") and "Constitution" in line:
            normalized.append("# Constitution")
            continue
        normalized.append(line)
    return "\n".join(normalized).strip()


def _constitution_sync(repo_path: Path) -> dict:
    public_path = repo_path / "spec" / "constitution.md"
    memory_path = repo_path / ".kittify" / "memory" / "constitution.md"

    if not public_path.exists() or not memory_path.exists():
        return {
            "status": "n/a",
            "message": "constitution files not both present",
        }

    public_text = _normalize_constitution(public_path.read_text())
    memory_text = _normalize_constitution(memory_path.read_text())

    if public_text == memory_text:
        return {"status": "ok", "message": "in sync"}

    return {"status": "drift", "message": "content mismatch"}


def _auto_lifecycle(status: str) -> str:
    if status == "done":
        return "done"
    if status in {"in-progress", "planned"}:
        return "execution"
    return "spec-only"


def _scan_features(repo_path: Path) -> list[dict]:
    """Scan kitty-specs/ for features and status plus integrity details."""
    specs_dir = repo_path / "kitty-specs"
    if not specs_dir.is_dir():
        return []

    features = []
    for feature_dir in sorted(specs_dir.iterdir()):
        if not feature_dir.is_dir():
            continue

        meta_path = feature_dir / "meta.json"
        tasks_dir = feature_dir / "tasks"

        info: dict = {
            "slug": feature_dir.name,
            "number": "",
            "name": feature_dir.name,
            "wps_done": 0,
            "wps_total": 0,
            "deps": [],
            "meta_missing": [],
            "missing_required": [],
            "lifecycle_state": "",
            "risk_class": "",
            "measurement_owner": "",
            "review_cadence": "",
        }

        meta: dict = {}
        if meta_path.exists():
            try:
                meta = json.loads(meta_path.read_text())
                info["number"] = str(meta.get("feature_number", ""))
                info["name"] = meta.get("friendly_name", feature_dir.name)
                info["risk_class"] = str(meta.get("risk_class", ""))
                info["measurement_owner"] = str(meta.get("measurement_owner", ""))
                info["review_cadence"] = str(meta.get("review_cadence", ""))
            except json.JSONDecodeError:
                pass

        for key in REQUIRED_META_KEYS:
            if not meta.get(key):
                info["meta_missing"].append(key)

        if tasks_dir.is_dir():
            for wp_file in tasks_dir.iterdir():
                if wp_file.name.startswith("WP") and wp_file.suffix == ".md":
                    info["wps_total"] += 1
                    try:
                        content = wp_file.read_text()
                        if re.search(r'lane:\s*"?done"?', content):
                            info["wps_done"] += 1
                    except OSError:
                        pass

        if info["wps_total"] == 0:
            info["status"] = "spec-only"
        elif info["wps_done"] == info["wps_total"]:
            info["status"] = "done"
        elif info["wps_done"] > 0:
            info["status"] = "in-progress"
        else:
            info["status"] = "planned"

        lifecycle = str(meta.get("lifecycle_state", "")).strip() or _auto_lifecycle(info["status"])
        info["lifecycle_state"] = lifecycle

        required_files = REQUIRED_BY_LIFECYCLE.get(lifecycle, REQUIRED_BY_LIFECYCLE["spec-only"])
        for rel in required_files:
            if not (feature_dir / rel).exists():
                info["missing_required"].append(rel)

        info["integrity_ok"] = not info["meta_missing"] and not info["missing_required"]

        spec_path = feature_dir / "spec.md"
        if spec_path.exists():
            try:
                spec_text = spec_path.read_text()
                deps = re.findall(r"pride_dependencies:\s*\[([^\]]*)\]", spec_text)
                if deps:
                    info["deps"] = [d.strip().strip('"').strip("'") for d in deps[0].split(",") if d.strip()]
            except OSError:
                pass

        features.append(info)

    return features


def _read_pride_yaml(repo_path: Path) -> dict:
    pride_path = repo_path / ".kittify" / "pride.yaml"
    if not pride_path.exists():
        return {}
    try:
        import yaml  # type: ignore

        return yaml.safe_load(pride_path.read_text()) or {}
    except ImportError:
        return _parse_simple_yaml(pride_path)


def main() -> None:
    parser = argparse.ArgumentParser(description="Kitty Pride cross-repo status")
    parser.add_argument("--registry", type=Path, default=DEFAULT_REGISTRY)
    parser.add_argument("--json", action="store_true", help="Output JSON")
    args = parser.parse_args()

    if not args.registry.exists():
        print(f"Registry not found: {args.registry}", file=sys.stderr)
        sys.exit(1)

    repos = _load_registry(args.registry)
    if not repos:
        print("No repos found in registry.", file=sys.stderr)
        sys.exit(1)

    output = {
        "pride": "joyus",
        "registry": str(args.registry),
        "repos": [],
        "dependencies": [],
    }

    all_deps: list[tuple[str, str]] = []

    for repo_id, repo_path in repos.items():
        meta = _read_pride_yaml(repo_path)
        visibility = meta.get("visibility", "unknown")
        constitution = _constitution_sync(repo_path)
        features = _scan_features(repo_path)

        for f in features:
            for dep in f.get("deps", []):
                all_deps.append((f"{repo_id}#{f.get('number', '')}", dep))

        output["repos"].append(
            {
                "repo_id": repo_id,
                "path": str(repo_path),
                "visibility": visibility,
                "constitution_sync": constitution,
                "features": features,
            }
        )

    output["dependencies"] = [{"from": src, "to": dep} for src, dep in all_deps]

    if args.json:
        print(json.dumps(output, indent=2))
        return

    print("\nKitty Pride Status")
    print("==================")

    for repo in output["repos"]:
        print(f"\n{repo['repo_id']} ({repo['visibility']})")
        print(f"  constitution_sync: {repo['constitution_sync']['status']} ({repo['constitution_sync']['message']})")

        features = repo["features"]
        if not features:
            print("  (no features)")
            continue

        for f in features:
            num = str(f.get("number", "")).rjust(3) if f.get("number") else "   "
            name = str(f.get("name", ""))[:40]
            status = str(f.get("status", ""))
            wp_info = f"({f.get('wps_done', 0)}/{f.get('wps_total', 0)} WPs)" if f.get("wps_total", 0) > 0 else ""
            integrity = "ok" if f.get("integrity_ok") else "issues"
            lifecycle = f.get("lifecycle_state", "")
            print(
                f"  {num} {name:<42} {status:<12} {wp_info:<12} lifecycle={lifecycle:<10} integrity={integrity}"
            )
            if f.get("missing_required"):
                print(f"     missing_required: {', '.join(f['missing_required'])}")
            if f.get("meta_missing"):
                print(f"     meta_missing: {', '.join(f['meta_missing'])}")

    if all_deps:
        print("\nCross-repo dependencies:")
        for src, dep in all_deps:
            print(f"  {src} -> {dep}")
    else:
        print("\nCross-repo dependencies: (none declared)")

    print()


if __name__ == "__main__":
    main()
