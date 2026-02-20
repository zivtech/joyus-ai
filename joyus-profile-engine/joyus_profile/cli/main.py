"""CLI entry point for joyus-profile-engine."""

from __future__ import annotations

import click


@click.group()
@click.version_option(package_name="joyus-profile-engine")
def main() -> None:
    """Joyus Profile Engine: Stylometric profiling, attribution, and fidelity verification."""


if __name__ == "__main__":
    main()
