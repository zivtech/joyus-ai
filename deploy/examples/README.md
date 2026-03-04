# Deploy Examples

Reference workflows and configurations for deploying Joyus AI platform components.

These files are **not live** — they won't run from this location. They exist as
starting points for teams setting up their own deployment pipelines.

## Usage

1. Copy the relevant file to your private deployment repo (e.g., `.github/workflows/`)
2. Replace all `<placeholder>` values with your org's configuration
3. Configure the required secrets documented in each file's header

## Why here instead of `.github/workflows/`?

This is a public open-source repo. Live deployment workflows contain org-specific
configuration and would fail on every push. Reference examples with placeholders
keep the repo clean while still sharing the deployment patterns.

See: `spec/constitution.md` §2.10 — org-specific deployment config belongs in
private repos.
