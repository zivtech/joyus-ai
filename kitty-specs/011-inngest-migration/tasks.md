# Tasks: Inngest Migration (Feature 011)

**Feature**: 011-inngest-migration
**Plan**: [plan.md](plan.md)
**Total subtasks**: 18 across 4 work packages

---

## Subtask Inventory

| ID | Description | WP |
|----|-------------|-----|
| T001 | Create `content-audit-pipeline.ts` Inngest function (schedule_tick, 3 steps + review gate) | WP01 |
| T002 | Create `regulatory-change-monitor-pipeline.ts` Inngest function (schedule_tick, 3 steps + review gate) | WP01 |
| T003 | Register both new functions in `inngest/index.ts` `allFunctions` array | WP01 |
| T004 | Unit tests for both new functions (stub path + handler path, review gate approve/reject) | WP01 |
| T005 | Remove `eventBus: EventBus` from `PipelineRouterDeps` and constructor params | WP02 |
| T006 | Replace `eventBus.publish()` dispatch in manual trigger route with `inngest.send()` | WP02 |
| T007 | Update route file imports (remove EventBus import, add inngest client) | WP02 |
| T008 | Update route tests to reflect removed eventBus dependency | WP02 |
| T009 | Delete `src/pipelines/engine/` (5 files, 655 LOC) | WP03 |
| T010 | Delete `src/pipelines/event-bus/` (3 files, 315 LOC) | WP03 |
| T011 | Delete `src/pipelines/triggers/` (6 files, 413 LOC) | WP03 |
| T012 | Delete `src/pipelines/init.ts` (110 LOC) | WP03 |
| T013 | Fix all import errors and verify `tsc --noEmit` passes with zero errors | WP03 |
| T014 | Integration test: full corpus-update-pipeline lifecycle (trigger → steps → complete) | WP04 |
| T015 | Integration test: content-audit-pipeline with review gate (pause → approve → resume) | WP04 |
| T016 | Integration test: regulatory-change-monitor-pipeline with review gate (pause → reject → terminate) | WP04 |
| T017 | Integration test: per-tenant concurrency (second trigger for same tenant queues behind first) | WP04 |
| T018 | Acceptance gate: `tsc --noEmit`, vitest run, LOC deletion count verified | WP04 |

---

## Work Packages

### WP01 — Port Remaining Pipeline Functions

**Goal**: Port `content-audit-pipeline` and `regulatory-change-monitor-pipeline` to Inngest functions, register them, add unit tests.
**Priority**: High — foundation for WP02 and WP03
**Dependencies**: None (Feature 010 foundation already on main)
**Estimated prompt size**: ~380 lines
**Subtasks**: T001, T002, T003, T004
**Prompt**: [WP01-port-remaining-pipelines.md](tasks/WP01-port-remaining-pipelines.md)

Implementation sequence:
1. Create `content-audit-pipeline.ts` following `corpus-update-pipeline.ts` pattern
2. Create `regulatory-change-monitor-pipeline.ts` following the same pattern
3. Add both to `allFunctions` in `inngest/index.ts`
4. Write unit tests (vitest) for both functions

Parallel opportunity: T001 and T002 can be developed concurrently (different files).

---

### WP02 — Update Routes to inngest.send()

**Goal**: Replace `eventBus.publish()` dispatch in `pipelines/routes.ts` with `inngest.send()`. Remove `EventBus` dependency from `PipelineRouterDeps`.
**Priority**: High
**Dependencies**: WP01
**Estimated prompt size**: ~280 lines
**Subtasks**: T005, T006, T007, T008
**Prompt**: [WP02-update-routes.md](tasks/WP02-update-routes.md)

Implementation sequence:
1. Remove `EventBus` import and `eventBus` field from `PipelineRouterDeps`
2. Import `inngest` client in `routes.ts`
3. Replace `eventBus.publish()` call with `inngest.send()` in manual trigger handler
4. Update route tests

---

### WP03 — Delete Custom Execution Plumbing

**Goal**: Delete `engine/`, `event-bus/`, `triggers/`, `init.ts`. Fix all resulting import errors. Verify TypeScript compilation passes.
**Priority**: High
**Dependencies**: WP02
**Estimated prompt size**: ~300 lines
**Subtasks**: T009, T010, T011, T012, T013
**Prompt**: [WP03-delete-custom-plumbing.md](tasks/WP03-delete-custom-plumbing.md)

Implementation sequence:
1. Delete all four module groups
2. Find and fix all import references to deleted modules
3. Run `npx tsc --noEmit` — must pass with zero errors

---

### WP04 — Integration Tests and Acceptance

**Goal**: Full-lifecycle integration test suite covering all three pipeline types + concurrency. Final acceptance gate.
**Priority**: High
**Dependencies**: WP03
**Estimated prompt size**: ~420 lines
**Subtasks**: T014, T015, T016, T017, T018
**Prompt**: [WP04-integration-tests.md](tasks/WP04-integration-tests.md)

Implementation sequence:
1. Write integration tests for all three pipelines
2. Write concurrency test
3. Run acceptance gate (tsc + vitest + LOC verification)

---

## Parallelization Opportunities

- **WP01 T001 and T002**: Both pipeline functions can be written in parallel (different files, same pattern).
- **WP03 deletions**: T009, T010, T011, T012 can all be executed in parallel (different directories).
- **WP04 T014–T017**: Integration tests for different pipelines can be written in parallel.

## MVP Scope

WP01 + WP02 + WP03 is the migration. WP04 is the verification. All 4 WPs must complete for the feature to be accepted.
