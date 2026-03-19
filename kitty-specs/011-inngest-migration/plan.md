# Implementation Plan: Inngest Migration

**Branch**: `011-inngest-migration-WP##` (per work package) | **Date**: 2026-03-19 | **Spec**: [spec.md](spec.md)
**Input**: Feature specification from `kitty-specs/011-inngest-migration/spec.md`

---

## Summary

Replace the Feature 009 custom pipeline execution engine (~1,493 LOC across `engine/`, `event-bus/`, `triggers/`, `init.ts`) with Inngest in a clean cutover. The foundation is already live on `main` from Feature 010 (client, adapter, `corpus-update-pipeline`, `schedule-tick-pipeline`). This feature ports the two remaining pipeline templates, updates API routes to dispatch via `inngest.send()`, then deletes the custom plumbing in one atomic cleanup.

**4 work packages**: WP01 (port remaining pipelines) → WP02 (route updates) → WP03 (delete custom plumbing) → WP04 (integration tests + acceptance).

---

## Technical Context

**Language/Version**: TypeScript 5.x, Node.js 20+
**Primary Dependencies**: Inngest v3, Express, Drizzle ORM (Postgres), vitest
**Storage**: PostgreSQL (existing schema — no changes)
**Testing**: vitest (unit + integration); mocked Inngest step execution (no live server required)
**Target Platform**: Linux server (Docker Compose self-hosted)
**Project Type**: Single project (`joyus-ai-mcp-server/`)
**Performance Goals**: Checkpoint overhead ≤30ms p50 per step (per Feature 010 WP05 findings)
**Constraints**: Clean cutover — no parallel execution paths after WP03; `tsc --noEmit` must pass after deletion
**Scale/Scope**: 3 pipeline templates, ~1,493 LOC removed, existing test suite must pass unmodified

---

## Constitution Check

| Principle | Status | Notes |
|-----------|--------|-------|
| §2.1 Multi-tenant from day one | ✅ PASS | Inngest per-tenant concurrency key (`event.data.tenantId`) preserves isolation |
| §2.7 Automated pipelines as first-class citizens | ✅ PASS | This feature IS the automated pipeline infrastructure; Inngest adds crash recovery + retries |
| §2.4 Monitor everything | ✅ PASS | Inngest dashboard replaces custom execution tracking routes; observability improves |
| §5.3 Reliability | ✅ PASS | Inngest checkpointing provides crash recovery not present in custom executor |
| §2.10 Client-informed, platform-generic | ✅ PASS | No client names, domain-specific terminology, or org-specific examples anywhere |
| §2.8 Open source by default | ✅ PASS | All code in public `joyus-ai` repo; no private dependency introduced |

No violations. No complexity justifications required.

---

## Project Structure

### Documentation (this feature)

```
kitty-specs/011-inngest-migration/
├── plan.md              # This file
├── research.md          # Phase 0 output
├── data-model.md        # N/A — no new data entities
├── contracts/           # N/A — route contracts unchanged
└── tasks.md             # Phase 2 output (/spec-kitty.tasks — NOT created here)
```

### Source Code (repository root)

```
joyus-ai-mcp-server/
├── src/
│   ├── inngest/
│   │   ├── client.ts                          # Existing — unchanged
│   │   ├── adapter.ts                         # Existing — unchanged
│   │   ├── index.ts                           # Updated: register new functions
│   │   └── functions/
│   │       ├── corpus-update-pipeline.ts      # Existing (Feature 010) — unchanged
│   │       ├── schedule-tick-pipeline.ts      # Existing (Feature 010) — unchanged
│   │       ├── content-audit-pipeline.ts      # NEW in WP01
│   │       └── regulatory-change-monitor-pipeline.ts  # NEW in WP01
│   └── pipelines/
│       ├── routes.ts                          # Updated in WP02: inngest.send() dispatch
│       ├── engine/         ← DELETED in WP03
│       ├── event-bus/      ← DELETED in WP03
│       ├── triggers/       ← DELETED in WP03
│       └── init.ts         ← DELETED in WP03
└── tests/
    └── pipelines/
        └── integration/                       # NEW in WP04
```

**Structure Decision**: Single project. All changes in `joyus-ai-mcp-server/`. No new top-level packages.

---

## Work Package Summary

| WP | Title | Deliverables | Dependencies |
|----|-------|--------------|--------------|
| WP01 | Port Remaining Pipeline Functions | `content-audit-pipeline.ts`, `regulatory-change-monitor-pipeline.ts`, updated `inngest/index.ts`, unit tests | Feature 010 on main |
| WP02 | Update Routes to inngest.send() | Updated `pipelines/routes.ts`, route handler tests | WP01 |
| WP03 | Delete Custom Execution Plumbing | Remove `engine/`, `event-bus/`, `triggers/`, `init.ts`; fix all imports; `tsc --noEmit` passing | WP02 |
| WP04 | Integration Tests + Acceptance | Full-lifecycle integration test suite; acceptance criteria validation | WP03 |

---

## Phase 0: Research

All decisions resolved from Feature 010 spike. No outstanding unknowns.

See [research.md](research.md) for a concise summary of spike findings that inform this implementation.

---

## Phase 1: Design

### No new data model

This feature introduces no new database tables or entities. The existing pipeline execution schema (Feature 009) is retained as-is during this migration. Schema cleanup (removing custom execution state columns that Inngest now manages) is deferred to a future cleanup feature.

### No new API contracts

Route signatures are unchanged. Callers receive the same response shape before and after the migration. Internal dispatch changes from `executor.run()` to `inngest.send()` — this is invisible to route consumers.

### Inngest function pattern (WP01 reference)

Each new pipeline function follows the same pattern established in `corpus-update-pipeline.ts`:

```
createXxxPipeline(registry: StepHandlerRegistry) → Inngest function
  Trigger: pipeline/corpus.changed (or appropriate event type)
  Concurrency: { key: 'event.data.tenantId', limit: 1 }
  Steps: one step.run() per step type via InngestStepHandlerAdapter
  Review gate (if applicable): step.waitForEvent('wait-for-review', { timeout: '7d' })
```

### Deletion checklist (WP03 reference)

Files to delete:

| Path | LOC | Reason |
|------|-----|--------|
| `src/pipelines/engine/executor.ts` | 371 | Replaced by Inngest durable execution |
| `src/pipelines/engine/step-runner.ts` | 190 | Replaced by InngestStepHandlerAdapter |
| `src/pipelines/engine/idempotency.ts` | 47 | Replaced by Inngest step memoization |
| `src/pipelines/engine/retry.ts` | 38 | Replaced by Inngest built-in retries |
| `src/pipelines/engine/index.ts` | 9 | — |
| `src/pipelines/event-bus/pg-notify-bus.ts` | 177 | Replaced by Inngest event system |
| `src/pipelines/event-bus/interface.ts` | 102 | Replaced by PipelineEvents typed schema |
| `src/pipelines/event-bus/index.ts` | 36 | — |
| `src/pipelines/triggers/schedule.ts` | 220 | Replaced by schedule-tick-pipeline |
| `src/pipelines/triggers/corpus-change.ts` | 73 | Replaced by corpus-update-pipeline trigger |
| `src/pipelines/triggers/manual-request.ts` | 47 | Replaced by inngest.send() in routes |
| `src/pipelines/triggers/interface.ts` | 37 | — |
| `src/pipelines/triggers/registry.ts` | 32 | Replaced by allFunctions array |
| `src/pipelines/triggers/index.ts` | 4 | — |
| `src/pipelines/init.ts` | 110 | Replaced by serve() in src/index.ts |
| **Total** | **1,493** | |

Post-deletion gate: `npx tsc --noEmit` must pass with zero errors.

---

## Complexity Tracking

No constitution violations. No complexity justification required.
