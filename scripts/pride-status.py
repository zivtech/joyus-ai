#!/usr/bin/env python3
"""Kitty Pride status — cross-repo feature overview.

Reads the local pride registry and walks each repo's kitty-specs/
to produce a unified feature status table.

Usage:
    python scripts/pride-status.py
    python scripts/pride-status.py --registry ~/.config/kitty-pride/joyus.yaml
"""

from __future__ import annotations

import argparse
import json
import re
import sys
from pathlib import Path

DEFAULT_REGISTRY = Path.home() / ".config" / "kitty-pride" / "joyus.yaml"


def _parse_simple_yaml(path: Path) -> dict:
    """Minimal YAML parser — handles up to 2 levels of nesting.

    Supports the registry format::

        pride: joyus
        repos:
          joyus-ai:
            path: /some/path
            visibility: public
    """
    data: dict = {}
    # Track nesting: level-0 key and level-1 key
    l0_key: str | None = None
    l1_key: str | None = None

    def _clean(v: str) -> str:
        return v.strip().strip('"').strip("'")

    for line in path.read_text().splitlines():
        stripped = line.strip()
        if not stripped or stripped.startswith("#"):
            continue

        # Measure indent (number of leading spaces)
        indent = len(line) - len(line.lstrip())

        # Level 0 — top-level key (no indent)
        if indent == 0:
            m = re.match(r"^([\w][\w.-]*):\s*(.*)", stripped)
            if m:
                key, val = m.group(1), _clean(m.group(2))
                l0_key = key
                l1_key = None
                data[key] = val if val else {}
            continue

        # Level 1 — 2-space indent (e.g. repo names under "repos:")
        if indent <= 2 and l0_key and isinstance(data.get(l0_key), dict):
            m = re.match(r"^([\w][\w.-]*):\s*(.*)", stripped)
            if m:
                key, val = m.group(1), _clean(m.group(2))
                l1_key = key
                if val:
                    data[l0_key][key] = val
                else:
                    data[l0_key][key] = {}
                continue

        # Level 2 — 4+ space indent (e.g. path/visibility under a repo)
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
        import yaml
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


def _scan_features(repo_path: Path) -> list[dict]:
    """Scan kitty-specs/ for features and their status."""
    specs_dir = repo_path / "kitty-specs"
    if not specs_dir.is_dir():
        return []

    features = []
    for feature_dir in sorted(specs_dir.iterdir()):
        if not feature_dir.is_dir():
            continue

        meta_path = feature_dir / "meta.json"
        tasks_dir = feature_dir / "tasks"

        info: dict = {"slug": feature_dir.name, "number": "", "name": "", "wps_done": 0, "wps_total": 0}

        # Read meta.json
        if meta_path.exists():
            try:
                meta = json.loads(meta_path.read_text())
                info["number"] = str(meta.get("feature_number", ""))
                info["name"] = meta.get("friendly_name", feature_dir.name)
            except (json.JSONDecodeError, KeyError):
                info["name"] = feature_dir.name

        # Count WPs from tasks directory
        if tasks_dir.is_dir():
            for wp_file in tasks_dir.iterdir():
                if wp_file.name.startswith("WP") and wp_file.suffix == ".md":
                    info["wps_total"] += 1
                    # Check frontmatter for lane status
                    try:
                        content = wp_file.read_text()
                        if re.search(r'lane:\s*"?done"?', content):
                            info["wps_done"] += 1
                    except OSError:
                        pass

        # Determine overall status
        if info["wps_total"] == 0:
            info["status"] = "spec-only"
        elif info["wps_done"] == info["wps_total"]:
            info["status"] = "done"
        elif info["wps_done"] > 0:
            info["status"] = "in-progress"
        else:
            info["status"] = "planned"

        # Check for pride_dependencies in spec.md
        spec_path = feature_dir / "spec.md"
        info["deps"] = []
        if spec_path.exists():
            try:
                spec_text = spec_path.read_text()
                deps = re.findall(r"pride_dependencies:\s*\[([^\]]*)\]", spec_text)
                if deps:
                    info["deps"] = [d.strip().strip('"').strip("'") for d in deps[0].split(",")]
            except OSError:
                pass

        features.append(info)

    return features


def _read_pride_yaml(repo_path: Path) -> dict:
    """Read .kittify/pride.yaml for repo metadata."""
    pride_path = repo_path / ".kittify" / "pride.yaml"
    if not pride_path.exists():
        return {}
    try:
        import yaml
        return yaml.safe_load(pride_path.read_text()) or {}
    except ImportError:
        return _parse_simple_yaml(pride_path)


def main() -> None:
    parser = argparse.ArgumentParser(description="Kitty Pride cross-repo status")
    parser.add_argument("--registry", type=Path, default=DEFAULT_REGISTRY)
    args = parser.parse_args()

    if not args.registry.exists():
        print(f"Registry not found: {args.registry}", file=sys.stderr)
        sys.exit(1)

    repos = _load_registry(args.registry)
    if not repos:
        print("No repos found in registry.", file=sys.stderr)
        sys.exit(1)

    pride_name = "Kitty Pride"
    all_deps: list[tuple[str, str]] = []

    print(f"\n{pride_name} Status")
    print("=" * (len(pride_name) + 7))

    for repo_id, repo_path in repos.items():
        meta = _read_pride_yaml(repo_path)
        visibility = meta.get("visibility", "unknown")
        print(f"\n{repo_id} ({visibility})")

        features = _scan_features(repo_path)
        if not features:
            print("  (no features)")
            continue

        for f in features:
            num = f["number"].rjust(3) if f["number"] else "   "
            name = f["name"][:40]
            status = f["status"]
            wp_info = f"({f['wps_done']}/{f['wps_total']} WPs)" if f["wps_total"] > 0 else ""
            print(f"  {num} {name:<42} {status:<12} {wp_info}")

            for dep in f.get("deps", []):
                all_deps.append((f"{repo_id}#{f['number']}", dep))

    if all_deps:
        print("\nCross-repo dependencies:")
        for src, dep in all_deps:
            print(f"  {src} -> {dep}")
    else:
        print("\nCross-repo dependencies: (none declared)")

    print()


if __name__ == "__main__":
    main()
