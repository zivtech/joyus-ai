# Changelog

All notable changes to this project are documented in this file. The format is
based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this
project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Fixed

- **Migration chain repair for stale-environment catch-up** (#96) — databases
  that recorded migrations 0000–0007 against the pre-rewrite chain (production)
  crashed on `0008` because the `pipelines` schema objects, created by the
  rewritten `0001` they never actually ran, were missing. `0008` is now guarded,
  and a new `0013_pipelines_baseline_repair` migration recreates the complete
  final-state `pipelines` schema with existence guards (a no-op on healthy
  databases). Journal `when` timestamps are monotonic again (`0009` and `0012`
  were out of order and could be silently skipped by environments that migrated
  past them), and `0009`/`0012` are idempotent so the reposition cannot
  double-apply destructively.

### Added

- **Migration replay check** (#96) — `npm run db:replay-check`
  (`scripts/migration-replay-check.mjs`) lints the journal, replays the full
  chain against a scratch Postgres 16, verifies a second run applies nothing,
  and replays the stale-environment catch-up shape that broke the v0.1.0
  deploy. Runs in CI as the `migration-replay` job.

## [0.1.0] - 2026-06-10

First tagged release of the open-core Joyus AI platform. Everything below was
previously available only as unversioned `main`.

### Added

- **`joyus-ai-state`** — local MCP server for session/context state and
  workflow enforcement (features `002`, `004`): canonical context store,
  divergence detection, state sharing, quality gates, skill enforcement, git
  guardrails, audit trail, kill switch.
- **`joyus-ai-mcp-server`** — remote multi-tenant MCP server (features `006`,
  `009`, `010`): content infrastructure (connectors, sync, search,
  entitlements, content-aware generation, mediation API), automated pipelines
  runtime with review gates and scheduling, Inngest evaluation spike.
- **Gateway event bus and multi-channel delivery** (#90).
- **Mediation judge layer foundation** (#82) and AGUI mediation approval
  evaluation (#83), with atomic cost accounting and per-session token-cost
  tracking.
- **Workflow approval state tools** (#87) — proposal-gated automation
  primitives with clock-injectable approval lifecycle.
- **GitHub MCP PR tools** (#85) and **CI check observability tools** (#93) —
  PR creation, reviewer assignment, check-status snapshots, watch/polling, and
  annotations for automated remediation loops.
- **Jira MCP reviewer proposal helpers** (#86) and **Jira a11y triage
  scheduler** (#89).
- **Profile engine contract wiring** (#84) — subprocess bridge to the private
  stylometric profile engine (`generate` / `health-check` CLI contract).
- **Export download token persistence** (#80) — DB-backed signed download
  tokens replacing in-memory tokens.
- **Shared tenant resolution** with fail-closed lookup and tenant-scoped env
  allowlisting.
- CI now validates **both** public packages: `validate` (mcp-server) and
  `validate-state` (state package) jobs.

### Changed

- README feature-status table reconciled against canonical `tasks.md` state
  (feature `009` is complete; orchestrator and headroom missions labeled
  honestly).

### Closed evaluations

- **Headroom MCP compression layer: NO_GO.** The WP01 spike and WP06
  retrieval-rate re-gate showed the reversible compress→retrieve loop does not
  engage on the real `/v1/messages` proxying path
  (`eval/headroom-spike/FINDINGS-WP06.md`).

[0.1.0]: https://github.com/zivtech/joyus-ai/releases/tag/v0.1.0
