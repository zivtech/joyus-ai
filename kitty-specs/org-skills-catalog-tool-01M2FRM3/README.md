---
title: Organization skill catalog tool — public-candidate package
status: draft-not-yet-published
---

# Organization skill catalog tool — public-candidate package

Implementation contract for the organization skill catalog tool. WP01 and WP02 are planned; the generated mission identity and task graph live in this directory.

## Scope

Two work packages, sequential:

1. **WP01 — Catalog service and refresh** (`tasks/WP01-catalog-service-and-refresh.md`, T001–T009): source adapter, index/document validation, policy read port, in-process generation service, refresh lifecycle, operator refresh HTTP surface, startup wiring.
2. **WP02 — Tool and access boundary** (`tasks/WP02-tool-and-access-boundary.md`, T010–T017), depends on WP01: the `org_skills` MCP tool, tenant-membership + live-policy access boundary, opaque cursor, audit sanitizing, and tool registration.

## Explicit exclusions

This package documents requirements and design only. It does **not** contain, and does not claim:

- Runtime implementation, or any evidence that implementation has occurred.
- Real-corpus approval (AT-14) — an approved real content revision and retrieval receipt.
- Deployed live-policy authority proof (AT-16) — an actual two-instance policy deployment demonstration.
- Any work toward WP0 (interactive-client cross-turn persistence) or WP3 (authenticated session-identity lifecycle); both remain out of scope and gated.
- Any D1 (or other) storage rebuild, migration, or session/skill-enablement schema work.
- Private operator/deployment procedure, actual infrastructure coordinates, credentials, or role provisioning — these stay in the private repository.

Generic-fixture test evidence, once implementation happens, can close WP01/WP02 core requirements independently of the two readiness gates above.

## Files

| File | Contents |
|---|---|
| `spec.md` | Requirements (FR-01–FR-20), user scenarios, success criteria, scope/assumptions |
| `plan.md` | Generic engineering plan: architecture, technical context, sequence, test strategy, dependencies, risks |
| `data-model.md` | Entities and lifecycle constraints (no new database tables) |
| `contracts/org-skills.md` | `org_skills` MCP tool contract: arguments, results, cursors, error transport |
| `contracts/access-policy.md` | Generic policy-object schema and per-call authorization read order |
| `contracts/catalog-source.md` | Source adapter behavior, index/document schema, resource bounds |
| `contracts/refresh.md` | Refresh state machine and operator HTTP surface |
| `tasks/WP01-catalog-service-and-refresh.md` | T001–T009 |
| `tasks/WP02-tool-and-access-boundary.md` | T010–T017 |
| `checklists/acceptance.md` | AT-01–AT-16 acceptance matrix |
| `traceability.md` | FR → task/AT cross-reference |
| `wps.yaml` | Work-package manifest (id, title, dependencies, owned files, requirement refs, subtasks, prompt file) |

## Status

All normative requirements (FR-01–FR-20), acceptance tests (AT-01–AT-16) and subtasks (T001–T017) from the private planning package are preserved here without shortening. Runtime implementation has not started. Real-content and deployed-authority gates are tracked separately.
