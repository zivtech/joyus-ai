# Work Packages: Automated Pipelines Framework
*Feature 009 — Task decomposition*

**Total**: 10 work packages, 60 subtasks
**Parallelization**: 8 layers — up to 2 WPs can run concurrently at peak

## Dependency Graph

```
Layer 0: WP01 (schema foundation)
Layer 1: WP02, WP03 (parallel — both depend only on WP01)
Layer 2: WP04 (depends on WP02, WP03)
Layer 3: WP05 (depends on WP04)
Layer 4: WP06, WP07 (parallel — both depend on WP04)
Layer 5: WP08 (depends on WP05, WP06, WP07)
Layer 6: WP09 (depends on WP08)
Layer 7: WP10 (depends on all)
```

---

## Phase A: Foundation

### WP01 — Schema & Foundation
**Prompt**: [`tasks/WP01-schema-foundation.md`](tasks/WP01-schema-foundation.md)
**Priority**: P0 (blocks everything) | **Dependencies**: none | **Est. ~500 lines**

Create the Drizzle ORM schema for the `pipelines` PostgreSQL schema (8 tables, 8 enums), Zod validation schemas, shared TypeScript types, and wire exports into the existing database client.

**Subtasks**:
- [x] T001: Create pipelines Drizzle schema (`src/pipelines/schema.ts`) — all 8 tables with pgSchema, enums, relations, indexes
- [x] T002: Create shared TypeScript types, enums, and constants (`src/pipelines/types.ts`)
- [x] T003: Create Zod validation schemas (`src/pipelines/validation.ts`) — pipeline config, trigger config, step config, retry policy
- [x] T004: Create module barrel export (`src/pipelines/index.ts`)
- [x] T005: Export pipelines schema from `src/db/client.ts`
- [x] T006: Generate Drizzle migration (`drizzle/`)
- [x] T007: Verify typecheck and existing tests pass

**Parallel opportunities**: None — this is the foundation.
**Risks**: Drizzle `pgSchema` must create the `pipelines` schema before tables. May need `CREATE SCHEMA IF NOT EXISTS pipelines;` in migration.

---

## Phase B: Event & Trigger Layer

### WP02 — Event Bus
**Prompt**: [`tasks/WP02-event-bus.md`](tasks/WP02-event-bus.md)
**Priority**: P1 | **Dependencies**: WP01 | **Est. ~350 lines**

Build the event bus abstraction and PostgreSQL LISTEN/NOTIFY implementation with delivery guarantee via the trigger_events queue table.

**Subtasks**:
- [x] T008: Define EventBus interface and EventEnvelope types (`src/pipelines/event-bus/interface.ts`)
- [x] T009: Implement PgNotifyBus — PostgreSQL LISTEN/NOTIFY with queue table persistence (`src/pipelines/event-bus/pg-notify-bus.ts`)
- [x] T010: Create bus factory and barrel export (`src/pipelines/event-bus/index.ts`)
- [x] T011: Unit tests for PgNotifyBus (`tests/pipelines/event-bus/pg-notify-bus.test.ts`)

**Parallel opportunities**: Can run in parallel with WP03.
**Risks**: LISTEN requires a dedicated persistent pg.Client (not from pool). NOTIFY payloads limited to 8000 bytes — pass event ID only.

### WP03 — Trigger System
**Prompt**: [`tasks/WP03-trigger-system.md`](tasks/WP03-trigger-system.md)
**Priority**: P1 | **Dependencies**: WP01 | **Est. ~400 lines**

Build trigger handlers, trigger registry, and the circular dependency detection system (DFS cycle detector + runtime depth counter).

**Subtasks**:
- [x] T012: Define TriggerHandler interface (`src/pipelines/triggers/interface.ts`)
- [x] T013: Implement CorpusChangeTriggerHandler (`src/pipelines/triggers/corpus-change.ts`)
- [x] T014: Implement ManualRequestTriggerHandler (`src/pipelines/triggers/manual-request.ts`)
- [x] T015: Create trigger registry (`src/pipelines/triggers/registry.ts`)
- [x] T016: Build DFS cycle detector and dependency graph builder (`src/pipelines/graph/`)
- [x] T017: Unit tests for cycle detector and trigger handlers (`tests/pipelines/graph/`, `tests/pipelines/triggers/`)

**Parallel opportunities**: Can run in parallel with WP02. T016 (graph) is independent of T012-T015 (triggers).
**Risks**: Graph construction must handle indirect cycles across corpus_change event chains. Runtime depth counter must be propagated through trigger chain.

---

## Phase C: Execution Engine

### WP04 — Pipeline Executor
**Prompt**: [`tasks/WP04-pipeline-executor.md`](tasks/WP04-pipeline-executor.md)
**Priority**: P1 | **Dependencies**: WP02, WP03 | **Est. ~500 lines**

Build the core execution engine: PipelineExecutor poll loop, StepRunner with retry and backoff, idempotency key generation, and concurrency policy enforcement.

**Subtasks**:
- [x] T018: Implement PipelineExecutor class (`src/pipelines/engine/executor.ts`) — poll loop, trigger matching, execution lifecycle
- [x] T019: Implement StepRunner (`src/pipelines/engine/step-runner.ts`) — single step execution with delegation to step handlers
- [x] T020: Implement retry policy with exponential backoff (`src/pipelines/engine/retry.ts`)
- [x] T021: Implement idempotency key generation and dedup checking (`src/pipelines/engine/idempotency.ts`)
- [x] T022: Create engine barrel export (`src/pipelines/engine/index.ts`)
- [x] T023: Unit tests for executor, step runner, retry logic (`tests/pipelines/engine/`)

**Parallel opportunities**: T020 (retry) and T021 (idempotency) are independent utilities.
**Risks**: Poll loop must handle graceful shutdown. Concurrency policy enforcement must check for running executions atomically. StepRunner must classify transient vs non-transient errors correctly.

### WP05 — Built-in Step Handlers
**Prompt**: [`tasks/WP05-step-handlers.md`](tasks/WP05-step-handlers.md)
**Priority**: P1 | **Dependencies**: WP04 | **Est. ~450 lines**

Implement the PipelineStepHandler interface and all 6 built-in step type handlers that integrate with platform capabilities (Spec 005, 006, 008).

**Subtasks**:
- [x] T024: Define PipelineStepHandler interface and StepResult type (`src/pipelines/steps/interface.ts`)
- [x] T025: Implement profile-generation step handler (`src/pipelines/steps/profile-generation.ts`)
- [x] T026: Implement fidelity-check step handler (`src/pipelines/steps/fidelity-check.ts`)
- [x] T027: Implement content-generation step handler (`src/pipelines/steps/content-generation.ts`)
- [x] T028: Implement source-query and notification step handlers (`src/pipelines/steps/source-query.ts`, `src/pipelines/steps/notification.ts`)
- [x] T029: Create step type registry and barrel export (`src/pipelines/steps/registry.ts`, `src/pipelines/steps/index.ts`)

**Parallel opportunities**: T025-T028 are independent step handlers implementing the same interface.
**Risks**: Step handlers depend on platform capabilities (Spec 005/006/008) that may not be fully available. Use interface-based dependency injection; ship with mock implementations for unavailable services.

---

## Phase D: Review Gates & Scheduling

### WP06 — Review Gates
**Prompt**: [`tasks/WP06-review-gates.md`](tasks/WP06-review-gates.md)
**Priority**: P1 | **Dependencies**: WP04 | **Est. ~400 lines**

Build the review gate mechanism: pause execution at gates, route artifacts to review queue, record decisions, resume on approval, handle rejection with structured feedback, and escalate on timeout.

**Subtasks**:
- [x] T030: Implement ReviewGate — pause execution, create pending review decisions (`src/pipelines/review/gate.ts`)
- [x] T031: Implement decision recording and pipeline resumption logic (`src/pipelines/review/decision.ts`)
- [x] T032: Implement structured rejection feedback storage and artifact path filtering
- [x] T033: Implement timeout escalation logic (`src/pipelines/review/escalation.ts`)
- [x] T034: Create escalation cron job and barrel export (`src/pipelines/review/index.ts`)
- [x] T035: Unit tests for review gate, decision, escalation (`tests/pipelines/review/`)

**Parallel opportunities**: Can run in parallel with WP07. T033-T034 (escalation) is independent of T030-T032 (gate + decision).
**Risks**: Decision recording must handle partial approval (some artifacts approved, some rejected). Escalation must never auto-approve or auto-reject.

### WP07 — Schedule Triggers & Templates
**Prompt**: [`tasks/WP07-schedule-templates.md`](tasks/WP07-schedule-templates.md)
**Priority**: P2 | **Dependencies**: WP04 | **Est. ~400 lines**

Build the schedule trigger handler (cron-based) and the pipeline template system (store, built-in definitions, instantiation).

**Subtasks**:
- [x] T036: Implement ScheduleTriggerHandler with cron job management (`src/pipelines/triggers/schedule.ts`)
- [x] T037: Implement overlap detection and timezone support
- [x] T038: Implement TemplateStore — CRUD and instantiation logic (`src/pipelines/templates/store.ts`)
- [x] T039: Create 3 built-in template definitions (`src/pipelines/templates/definitions/`)
- [x] T040: Create template barrel export (`src/pipelines/templates/index.ts`)
- [x] T041: Unit tests for schedule triggers and templates (`tests/pipelines/triggers/schedule.test.ts`, `tests/pipelines/templates/store.test.ts`)

**Parallel opportunities**: Can run in parallel with WP06. T036-T037 (schedule) and T038-T040 (templates) are independent.
**Risks**: Cron job map must be updated dynamically on pipeline create/update/delete. Template instantiation must deep-clone definitions to prevent cross-tenant contamination.

---

## Phase E: API & Tools

### WP08 — Pipeline API & MCP Tools
**Prompt**: [`tasks/WP08-api-mcp-tools.md`](tasks/WP08-api-mcp-tools.md)
**Priority**: P2 | **Dependencies**: WP05, WP06, WP07 | **Est. ~500 lines**

Implement Express routes for pipeline management, MCP tool definitions, tenant-scoped route enforcement, module entry point, and server mount.

**Subtasks**:
- [x] T042: Implement pipeline CRUD routes (`src/pipelines/routes.ts`) — create, list, get, update, delete, manual trigger
- [x] T043: Implement execution history and review decision routes
- [x] T044: Implement MCP tool definitions (`src/tools/pipeline-tools.ts`) — 8 tools
- [x] T045: Enforce tenant scoping on all routes and tools
- [x] T046: Create module entry point (`src/pipelines/index.ts`) — initialization, server wiring
- [x] T047: Mount pipeline routes and register tools in `src/index.ts`
- [x] T048: Unit tests for routes and tools

**Parallel opportunities**: T042-T043 (routes) and T044 (tools) are independent.
**Risks**: Must match existing tool registration pattern (ToolDefinition interface, prefix routing in executor). Pipeline creation must run cycle detection before persisting.

---

## Phase F: Analytics

### WP09 — Analytics & Quality Signals
**Prompt**: [`tasks/WP09-analytics.md`](tasks/WP09-analytics.md)
**Priority**: P3 | **Dependencies**: WP08 | **Est. ~350 lines**

Build metrics aggregation, quality signal emission, analytics API routes, and analytics MCP tool.

**Subtasks**:
- [x] T049: Implement MetricsAggregator — compute per-pipeline metrics from execution history (`src/pipelines/analytics/aggregator.ts`)
- [x] T050: Implement materialized metrics refresh on execution completion events
- [x] T051: Implement QualitySignalEmitter — rejection rate monitoring and governance signal emission (`src/pipelines/analytics/quality-signals.ts`)
- [x] T052: Add analytics Express routes and MCP tool (`pipeline_analytics`)
- [x] T053: Create analytics barrel export (`src/pipelines/analytics/index.ts`)
- [x] T054: Unit tests for aggregator and quality signals (`tests/pipelines/analytics/`)

**Parallel opportunities**: T049-T050 (aggregator) and T051 (quality signals) are independent.
**Risks**: p95 computation requires sorting execution durations — must handle efficiently. Quality signal threshold (>30% rejection over 10 executions) must be configurable.

---

## Phase G: Integration

### WP10 — Integration & Validation
**Prompt**: [`tasks/WP10-integration-validation.md`](tasks/WP10-integration-validation.md)
**Priority**: P2 | **Dependencies**: WP01-WP09 | **Est. ~400 lines**

End-to-end integration tests, review gate flow tests, scheduled execution tests, analytics accuracy tests, tenant isolation tests, and full validation sweep.

**Subtasks**:
- [x] T055: Integration test — end-to-end pipeline execution (corpus-change → steps → completion)
- [x] T056: Integration test — review gate flow (pause → decide → resume, including partial approval)
- [x] T057: Integration test — scheduled pipeline execution with overlap detection
- [x] T058: Integration test — analytics accuracy (20 executions → verify aggregate metrics)
- [x] T059: Integration test — tenant isolation (cross-tenant access denied on all paths)
- [x] T060: Validation sweep — `npm run validate` (typecheck + lint + test), zero regressions

**Parallel opportunities**: T055-T059 are independent test suites.
**Risks**: Integration tests need database fixtures, mock platform services (profile engine, content infrastructure), and clock manipulation for schedule tests. Must not interfere with existing tests.
