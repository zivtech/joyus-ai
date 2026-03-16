# Implementation Plan: Automated Pipelines Framework

**Branch**: `claude/009-automated-pipelines-framework` | **Date**: 2026-03-16 | **Spec**: [spec.md](spec.md)
**Input**: Feature specification from `spec/009-automated-pipelines-framework/`

---

## Summary

Build the automated pipelines framework in `joyus-ai` that lets tenants compose multi-step content workflows, triggered by corpus changes, schedules, or manual requests. Eight tables in a new `pipelines` PostgreSQL schema store pipeline definitions, executions, step results, review decisions, trigger events, and analytics. Execution is driven by a poll-loop engine with exponential-backoff retry, idempotency-key deduplication, circular-dependency detection, and tenant-scoped concurrency enforcement. Human-in-the-loop review gates pause execution until a decision is recorded, with timeout escalation. The feature integrates with Spec 005 (content intelligence), Spec 006 (content infrastructure), and Spec 008 (profile isolation) as first-class step handlers.

---

## Technical Context

**Language/Version**: TypeScript 5.x, Node.js 20 LTS
**Primary Dependencies**: Express.js, Drizzle ORM, Zod, `@paralleldrive/cuid2`, `node-cron`
**Storage**: PostgreSQL 16 — new `pipelines` schema (8 tables, 8 enums; follows `profiles` schema pattern from Spec 008)
**Testing**: Vitest (unit + integration), existing test infrastructure
**Target Platform**: Linux server (Docker), same deployment as Spec 001
**Project Type**: Platform module within `joyus-ai` monorepo
**Performance Goals**: < 100ms trigger-to-execution-start latency; < 500ms p95 step dispatch; >= 20 concurrent pipeline executions per tenant
**Constraints**: No new infrastructure — poll loop runs in-process; PostgreSQL LISTEN/NOTIFY for event delivery; no external message broker
**Scale/Scope**: Hundreds of pipelines per tenant, thousands of executions per day, millions of step result rows

---

## Constitution Check

*GATE: Must pass before implementation. Re-check after Phase A.*

| Principle | Status | Notes |
|-----------|--------|-------|
| 2.1 Multi-Tenant from Day One | **PASS** | `tenantId` on every table. All routes and MCP tools enforce tenant scoping at entry point. No single-tenant shortcuts. |
| 2.2 Skills as Guardrails | **PASS** | Pipeline operations exposed as 8 MCP tools with tenant-scoped validation and Zod input schemas. |
| 2.3 Sandbox by Default | **PASS** | Cross-tenant pipeline access denied at route and tool layer. Circular dependency detection prevents tenant from creating runaway trigger chains. |
| 2.4 Monitor Everything | **PASS** | Execution history table captures every run. Analytics aggregator computes p95/success rate/avg duration. Quality signal emitter monitors rejection rates. |
| 2.5 Feedback Loops | **PASS** | Corpus-change triggers create a closed loop: ingest → profile → generate → review → approve/reject → signal. Review decisions feed quality analytics. |
| 3.2 Data Governance | **PASS** | Execution artifacts stored in PostgreSQL with tenant isolation. Audit trail of review decisions is append-only. Step results reference source artifacts by ID, not by copy. |
| 5.1 Technology Choices | **PASS** | Express + Drizzle + PostgreSQL + node-cron — matches existing platform stack. Single new runtime dependency (`node-cron`). |
| 5.2 Cost Awareness | **PASS** | Poll loop and LISTEN/NOTIFY replace message broker. Queue table in PostgreSQL. Materialized metrics refresh on completion events — no background aggregation jobs. |
| 5.3 Reliability | **PASS** | Exponential-backoff retry with transient/non-transient error classification. Graceful poll-loop shutdown. Review gate timeout escalation never auto-approves. Idempotency keys prevent duplicate executions on restart. |

No violations. All gates pass.

---

## Project Structure

### Documentation (this feature)

```
spec/009-automated-pipelines-framework/
├── spec.md              # Feature specification
├── plan.md              # This file
├── tasks.md             # Task decomposition (10 WPs, 60 subtasks)
├── tasks/               # WP prompt files (WP01–WP10)
└── meta.json            # Spec metadata
```

### Source Code (in joyus-ai repository)

```
src/
├── pipelines/
│   ├── schema.ts                    # Drizzle schema — pipelines pgSchema, 8 tables, 8 enums
│   ├── types.ts                     # Shared TypeScript types, enums, constants
│   ├── validation.ts                # Zod schemas — pipeline config, trigger config, step config, retry policy
│   ├── index.ts                     # Module barrel export + initialization
│   │
│   ├── event-bus/
│   │   ├── interface.ts             # EventBus interface + EventEnvelope type
│   │   ├── pg-notify-bus.ts         # PostgreSQL LISTEN/NOTIFY impl with queue-table persistence
│   │   └── index.ts                 # Event bus barrel
│   │
│   ├── triggers/
│   │   ├── interface.ts             # TriggerHandler interface
│   │   ├── corpus-change.ts         # CorpusChangeTriggerHandler
│   │   ├── manual-request.ts        # ManualRequestTriggerHandler
│   │   ├── schedule.ts              # ScheduleTriggerHandler (cron + overlap detection)
│   │   └── registry.ts              # Trigger type registry + barrel
│   │
│   ├── graph/
│   │   ├── cycle-detector.ts        # DFS cycle detector over pipeline trigger chains
│   │   └── index.ts                 # Graph module barrel
│   │
│   ├── engine/
│   │   ├── executor.ts              # PipelineExecutor — poll loop, trigger matching, lifecycle
│   │   ├── step-runner.ts           # StepRunner — dispatch to step handlers
│   │   ├── retry.ts                 # Exponential backoff retry policy
│   │   ├── idempotency.ts           # Idempotency key generation + dedup checking
│   │   └── index.ts                 # Engine barrel
│   │
│   ├── steps/
│   │   ├── interface.ts             # PipelineStepHandler interface + StepResult type
│   │   ├── profile-generation.ts    # Profile generation step (integrates Spec 008)
│   │   ├── fidelity-check.ts        # Fidelity check step (integrates Spec 005)
│   │   ├── content-generation.ts    # Content generation step (integrates Spec 006)
│   │   ├── source-query.ts          # Source query step
│   │   ├── notification.ts          # Notification step
│   │   ├── registry.ts              # Step type registry
│   │   └── index.ts                 # Steps barrel
│   │
│   ├── review/
│   │   ├── gate.ts                  # ReviewGate — pause execution, create pending decisions
│   │   ├── decision.ts              # Decision recording + pipeline resumption
│   │   ├── escalation.ts            # Timeout escalation logic (never auto-approve)
│   │   └── index.ts                 # Review barrel
│   │
│   ├── templates/
│   │   ├── store.ts                 # TemplateStore — CRUD + instantiation (deep-clone)
│   │   ├── definitions/             # 3 built-in template definitions
│   │   └── index.ts                 # Templates barrel
│   │
│   ├── analytics/
│   │   ├── aggregator.ts            # MetricsAggregator — per-pipeline p95/success/avg
│   │   ├── quality-signals.ts       # QualitySignalEmitter — rejection rate monitoring
│   │   └── index.ts                 # Analytics barrel
│   │
│   └── routes.ts                    # Express routes — pipeline CRUD, execution history, review
│
├── tools/
│   └── pipeline-tools.ts            # 8 MCP tool definitions (registered in src/index.ts)
│
tests/
├── pipelines/
│   ├── event-bus/
│   │   └── pg-notify-bus.test.ts
│   ├── triggers/
│   │   ├── corpus-change.test.ts
│   │   ├── manual-request.test.ts
│   │   └── schedule.test.ts
│   ├── graph/
│   │   └── cycle-detector.test.ts
│   ├── engine/
│   │   ├── executor.test.ts
│   │   ├── step-runner.test.ts
│   │   ├── retry.test.ts
│   │   └── idempotency.test.ts
│   ├── steps/
│   │   ├── profile-generation.test.ts
│   │   ├── fidelity-check.test.ts
│   │   └── content-generation.test.ts
│   ├── review/
│   │   ├── gate.test.ts
│   │   ├── decision.test.ts
│   │   └── escalation.test.ts
│   ├── templates/
│   │   └── store.test.ts
│   ├── analytics/
│   │   ├── aggregator.test.ts
│   │   └── quality-signals.test.ts
│   ├── routes.test.ts
│   └── integration/
│       ├── e2e-execution.test.ts          # corpus-change → steps → completion
│       ├── review-gate-flow.test.ts       # pause → decide → resume, partial approval
│       ├── scheduled-execution.test.ts    # cron overlap detection
│       ├── analytics-accuracy.test.ts     # 20 executions → aggregate metrics
│       └── tenant-isolation.test.ts       # cross-tenant access denied on all paths
│
drizzle/
└── <timestamp>_pipelines_schema.sql       # Generated migration
```

**Structure Decision**: Module follows the established `src/profiles/` pattern from Spec 008 — dedicated directory with schema, types, validation, and focused submodules. The engine, event-bus, and graph subdirectories are separated because they form distinct technical layers (persistence, messaging, and computation), keeping each file well under 300 lines. Step handlers implement a shared interface and are registered at startup — adding a new step type requires no changes to the executor.

---

## Architecture

```
┌──────────────────────────────────────────────────────────────────────┐
│                      joyus-ai Express Server                          │
│                                                                        │
│  ┌──────────────────────────────────────────────────────────────────┐ │
│  │                  Pipeline Module (src/pipelines/)                 │ │
│  │                                                                    │ │
│  │  ┌──────────────┐  ┌──────────────┐  ┌────────────────────────┐  │ │
│  │  │  API Routes   │  │  MCP Tools   │  │   Cron / Event Entry   │  │ │
│  │  │  (routes.ts)  │  │ (tools.ts)   │  │  (scheduler + bus)     │  │ │
│  │  └──────┬────────┘  └──────┬───────┘  └───────────┬────────────┘  │ │
│  │         │                  │                       │                │ │
│  │         └──────────────────┼───────────────────────┘                │ │
│  │                            │  (tenant-scoped entry)                 │ │
│  │                            ▼                                         │ │
│  │  ┌─────────────────────────────────────────────────────────────┐    │ │
│  │  │                  PipelineExecutor (engine/)                   │    │ │
│  │  │  poll loop · trigger matching · concurrency policy           │    │ │
│  │  │  idempotency key dedup · graceful shutdown                   │    │ │
│  │  └───────────────────────────┬─────────────────────────────────┘    │ │
│  │                              │                                       │ │
│  │              ┌───────────────┼────────────────┐                      │ │
│  │              ▼               ▼                ▼                      │ │
│  │  ┌──────────────────┐  ┌──────────────┐  ┌──────────────────┐       │ │
│  │  │   StepRunner     │  │  ReviewGate  │  │  RetryPolicy     │       │ │
│  │  │  (engine/)       │  │  (review/)   │  │  (engine/)       │       │ │
│  │  └────────┬─────────┘  └──────┬───────┘  └──────────────────┘       │ │
│  │           │                   │                                       │ │
│  │           ▼                   ▼                                       │ │
│  │  ┌──────────────────────────────────────────────────────────────┐    │ │
│  │  │                  Step Handler Registry (steps/)               │    │ │
│  │  │                                                                │    │ │
│  │  │  profile-generation │ fidelity-check │ content-generation     │    │ │
│  │  │  source-query       │ notification                            │    │ │
│  │  └──────────────────────────────────────────────────────────────┘    │ │
│  │                                                                        │ │
│  │  ┌──────────────────┐  ┌──────────────────────────────────────────┐  │ │
│  │  │  Trigger System  │  │  Event Bus (event-bus/)                  │  │ │
│  │  │  (triggers/ +    │  │  PgNotifyBus: LISTEN/NOTIFY              │  │ │
│  │  │   graph/)        │  │  + trigger_events queue table            │  │ │
│  │  └──────────────────┘  └──────────────────────────────────────────┘  │ │
│  │                                                                        │ │
│  │  ┌──────────────────────────────────────────────────────────────┐    │ │
│  │  │        PostgreSQL  (pipelines schema)                         │    │ │
│  │  │  pipelines | executions | step_results | review_decisions     │    │ │
│  │  │  trigger_events | pipeline_templates | pipeline_metrics        │    │ │
│  │  └──────────────────────────────────────────────────────────────┘    │ │
│  │                                                                        │ │
│  └──────────────────────────────────────────────────────────────────────┘ │
│                                                                             │
│  Integration Points:                                                        │
│  ┌───────────────┐  ┌────────────────┐  ┌──────────────────────────────┐  │
│  │  Spec 005     │  │  Spec 006      │  │  Spec 008                    │  │
│  │  Content      │  │  Content       │  │  Profile Isolation           │  │
│  │  Intelligence │  │  Infrastructure│  │  (profile-generation step)   │  │
│  │  (fidelity    │  │  (content-gen  │  │                              │  │
│  │   check step) │  │   step)        │  │                              │  │
│  └───────────────┘  └────────────────┘  └──────────────────────────────┘  │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## Phase Breakdown

### Phase A: Foundation (WP01)
Schema, types, validation, and database migration. Creates the `pipelines` PostgreSQL schema with all 8 tables and 8 enums using Drizzle `pgSchema`. Wires the schema export into the existing database client. Nothing proceeds until typecheck and existing tests pass — this is the hard dependency for every subsequent WP.

**Key risk**: `pgSchema` must emit `CREATE SCHEMA IF NOT EXISTS pipelines;` before table DDL. Verify migration output before marking complete.

### Phase B: Event & Trigger Layer (WP02, WP03 — parallel)
Two independent work packages that can run concurrently:

- **WP02 (Event Bus)**: PostgreSQL LISTEN/NOTIFY with a dedicated persistent `pg.Client` (not from pool). NOTIFY payloads carry event ID only (8 KB limit). The `trigger_events` queue table provides delivery guarantee for events that arrive before a listener is attached.
- **WP03 (Trigger System)**: `CorpusChangeTriggerHandler`, `ManualRequestTriggerHandler`, trigger registry, and the DFS cycle detector. The cycle detector traverses the full `corpus_change` event chain to catch indirect cycles. A runtime depth counter is propagated through trigger chains to catch cycles that slip past static analysis.

### Phase C: Execution Engine (WP04, WP05 — sequential)
- **WP04 (Pipeline Executor)**: The core poll loop that claims queued executions, dispatches to `StepRunner`, enforces concurrency policy atomically, and handles graceful shutdown. Idempotency keys prevent re-execution on restart. Retry policy classifies errors as transient (retry with backoff) or non-transient (fail immediately).
- **WP05 (Built-in Step Handlers)**: Six step type implementations behind the `PipelineStepHandler` interface. Platform service dependencies (Spec 005/006/008) are injected — handlers ship with null/mock implementations so they compile and test independently of the referenced specs.

### Phase D: Review Gates & Scheduling (WP06, WP07 — parallel)
Two independent work packages that can run concurrently after WP04:

- **WP06 (Review Gates)**: Pause execution at configured gate points, route artifacts to the review queue, record approve/reject decisions (including partial approval of individual artifacts), resume on approval. Timeout escalation emits a governance signal but never auto-approves or auto-rejects.
- **WP07 (Schedule Triggers & Templates)**: Cron-based `ScheduleTriggerHandler` with overlap detection (skip if previous run still executing) and timezone support. `TemplateStore` with deep-clone instantiation to prevent cross-tenant contamination. Three built-in template definitions.

### Phase E: API & Tools (WP08)
Express routes for pipeline CRUD, execution history, manual trigger, and review decisions. Eight MCP tool definitions registered in `src/tools/pipeline-tools.ts`. Pipeline creation runs cycle detection before persisting. All routes and tools enforce tenant scoping. Module entry point wires initialization into `src/index.ts` server startup.

### Phase F: Analytics (WP09)
`MetricsAggregator` computes p95 latency, success rate, and average duration per pipeline from execution history. Metrics refresh on execution completion events (not on a polling schedule). `QualitySignalEmitter` monitors per-pipeline rejection rates — emits a governance signal when rejection exceeds 30% over the last 10 executions (threshold configurable). Analytics routes and `pipeline_analytics` MCP tool surface the data.

### Phase G: Integration & Validation (WP10)
Five independent integration test suites plus a full validation sweep:

1. End-to-end execution: `corpus_change` event → step dispatch → completion state
2. Review gate flow: pause → approve/reject (including partial) → resume
3. Scheduled execution: overlap detection prevents double-firing
4. Analytics accuracy: 20 seeded executions verify aggregate metric correctness
5. Tenant isolation: cross-tenant access denied on every route, tool, and DB query path

Final gate: `npm run validate` (typecheck + lint + test) with zero regressions against existing test suite.

---

## Security Considerations

1. **Tenant scoping is enforced at the entry point, not the storage layer.** Every route and MCP tool call validates `tenantId` against the authenticated session before any DB operation. Cycle detection runs in the context of the creating tenant — a pipeline cannot reference triggers from another tenant's pipelines.

2. **Circular dependency detection is a safety gate, not a hint.** Pipeline creation is rejected synchronously if the DFS detector finds a cycle. No partial writes occur — the transaction rolls back before the pipeline row is inserted.

3. **Review gate escalation is passive.** Timeout escalation emits a governance signal and records an `ESCALATED` state. It does not auto-approve, auto-reject, or modify artifact state. A human actor must always record the final decision.

4. **Template instantiation deep-clones definitions.** Built-in and stored templates are deep-cloned on instantiation to ensure one tenant's pipeline configuration cannot leak into another tenant's instantiated pipeline.

5. **NOTIFY payload carries only event IDs.** PostgreSQL NOTIFY payloads are capped at 8,000 bytes. The event bus passes only the `trigger_event.id` in the payload; the consumer fetches the full event row from the queue table. This prevents payload truncation silently dropping data.

6. **Idempotency keys prevent replay attacks on restart.** The executor generates a deterministic idempotency key from `(pipelineId, triggerEventId, runAttempt)`. A unique constraint on `executions.idempotency_key` prevents duplicate rows even if the process crashes mid-insert.

---

## Future Considerations (Not in Scope)

- **External webhook triggers**: Receive inbound HTTP payloads as pipeline trigger events
- **Fan-out step type**: Split execution into parallel branches that rejoin at a merge gate
- **Pipeline versioning**: Pin pipelines to a named configuration snapshot; roll back on regression
- **Cross-tenant pipeline templates**: Marketplace of shared templates with explicit opt-in
- **Step handler plugin system**: Register third-party step types from npm packages at runtime
- **Streaming execution log**: Real-time step log tailing over SSE or WebSocket
- **Execution replay**: Re-run a historical execution with the same inputs for debugging

---

## Complexity Tracking

No Constitution violations. All principles pass without exception.
