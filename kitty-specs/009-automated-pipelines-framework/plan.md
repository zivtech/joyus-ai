# Implementation Plan: Automated Pipelines Framework
*Path: [kitty-specs/009-automated-pipelines-framework/plan.md](kitty-specs/009-automated-pipelines-framework/plan.md)*

**Branch**: `009-automated-pipelines-framework` | **Date**: 2026-03-10 | **Spec**: [spec.md](spec.md)
**Input**: Feature specification from `/kitty-specs/009-automated-pipelines-framework/spec.md`

## Summary

Build the event-driven pipeline execution framework for the Joyus AI platform: an async event bus backed by PostgreSQL LISTEN/NOTIFY (with interface abstraction for future broker swap), a pipeline execution engine with sequential step orchestration, configurable retry with exponential backoff, human-in-the-loop review gates with escalation, circular dependency detection at configuration time and runtime, cron-scheduled triggers, pipeline templates, and execution analytics. All new code extends the existing `joyus-ai-mcp-server` package (TypeScript/Express), storing pipeline data in a schema-separated PostgreSQL `pipelines` schema via Drizzle ORM. Pipelines are scoped to content-and-profile workflows only — not a general-purpose workflow engine.

## Technical Context

**Language/Version**: TypeScript 5.3+, Node.js >=20.0.0
**Primary Dependencies**: Express 4.x, Drizzle ORM 0.45+, @modelcontextprotocol/sdk 1.x, pg 8.x, node-cron 3.x (already in use), cron-parser 4.x (already in use), Zod (validation)
**Storage**: PostgreSQL (same instance as existing MCP server, schema-separated via `pipelines` pgSchema)
**Testing**: Vitest 1.x (unit + integration), existing `validate` script (`typecheck && lint && test`)
**Target Platform**: Linux server (Docker), macOS development
**Project Type**: Single package extension (`joyus-ai-mcp-server/`)
**Performance Goals**: Pipeline execution initiates within 5 minutes of trigger event; review gate routes artifacts within 30 seconds; execution history queryable with sub-second response for 90-day window
**Constraints**: Content-and-profile workflows only, sequential step execution within a pipeline, async batch processing (no real-time streaming), soft tenant isolation via application-scoped tenant_id filtering (ADR-0002 Leash pattern)
**Scale/Scope**: Up to 20 active pipelines per tenant, concurrent execution across tenants, single-instance worker for MVP

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| Principle | Status | Notes |
|-----------|--------|-------|
| §2.1 Multi-Tenant from Day One | PASS | All pipeline data (configurations, executions, events, review decisions) is tenant-scoped via mandatory `tenant_id`. Cross-tenant access denied at the data layer. Same Leash pattern as Spec 008. |
| §2.2 Skills as Encoded Knowledge | PASS | Pipeline steps consume profile engine capabilities (Spec 005/008) and content infrastructure (Spec 006). Step types encode operational workflows as reusable, composable pipeline definitions. |
| §2.3 Sandbox by Default | PASS | Pipelines execute within tenant-scoped context. Default concurrency policy prevents uncontrolled parallel execution. Pipeline creation limits enforced per tenant (default: 20). |
| §2.4 Monitor Everything | PASS | Every pipeline execution is logged with trigger reference, step outcomes, timing, error details, and output artifact references. Analytics track success rate, duration, failure modes, and reviewer approval rate. |
| §2.5 Feedback Loops | PASS | Reviewer rejection feedback stored as structured signals linked to artifacts, profiles, and pipeline executions. High rejection rates (>30%) emit quality signals to governance layer (Spec 007). |
| §2.6 Mediated AI Access | PASS | Pipeline steps that invoke AI (content generation, profile regeneration) go through the platform's existing mediation layer. No direct AI model access from pipeline executor. |
| §2.7 Automated Pipelines | PASS | This is the primary implementation of §2.7. Pipelines use the same skills, quality gates, and audit trail as human-initiated sessions. Review gates enforce human oversight for content destined for external use. |
| §2.8 Open Source | PASS | Pipeline framework is platform core — lives in the public repo. No client data in pipeline definitions, templates, or execution logic. Templates use generic examples. |
| §2.9 Assumption Awareness | PASS | Pipeline templates document their assumptions (e.g., "assumes corpus-change events include affected author IDs"). Template metadata includes assumption references that can be flagged for staleness review. |
| §2.10 Client-Informed, Platform-Generic | PASS | All templates use generic terminology ("Author A", "Example Corp"). Pipeline step types are domain-agnostic (profile_generation, fidelity_check, content_generation). No client names in any artifact. |
| §3.1 Data Governance | PASS | Pipeline executions inherit data tier from the content and profiles they operate on. Output artifacts carry forward the highest data tier of their inputs. |
| §3.2 Compliance Framework | PASS | Review gate enforcement respects compliance framework declarations on tenant config. Pipelines operating on Tier 3-4 data require review gates — creation without them is rejected. |
| §3.3 Non-Negotiables | PASS | Full audit trail for all pipeline executions (append-only execution logs). All pipeline outputs are reviewable via review gates. Tenant retains approval authority via configurable review gates. No organizational data used for training. |

**Post-design re-check**: All principles remain satisfied. The `pipelines` schema separation reinforces tenant isolation (§2.1, §2.3). The event bus interface abstraction supports future infrastructure evolution (§2.8). Review gate enforcement at pipeline creation time ensures §2.7 and §3.3 compliance.

## Project Structure

### Documentation (this feature)

```
kitty-specs/009-automated-pipelines-framework/
├── plan.md              # This file
├── research.md          # Phase 0 output
├── data-model.md        # Phase 1 output
├── spec.md              # Feature specification
└── tasks.md             # Phase 2 output (NOT created by /spec-kitty.plan)
```

### Source Code (repository root)

```
joyus-ai-mcp-server/
├── src/
│   ├── pipelines/                        # NEW — Pipeline framework
│   │   ├── schema.ts                     # Pipeline schema (Drizzle, pgSchema 'pipelines')
│   │   ├── types.ts                      # Shared types, enums, constants
│   │   ├── validation.ts                 # Zod schemas for pipeline configuration
│   │   ├── index.ts                      # Module barrel export
│   │   ├── event-bus/                    # Event bus abstraction
│   │   │   ├── interface.ts              # EventBus interface + EventEnvelope type
│   │   │   ├── pg-notify-bus.ts          # PostgreSQL LISTEN/NOTIFY implementation
│   │   │   └── index.ts                  # Bus factory + registration
│   │   ├── engine/                       # Pipeline execution engine
│   │   │   ├── executor.ts               # PipelineExecutor — picks up trigger events, runs steps
│   │   │   ├── step-runner.ts            # StepRunner — executes individual steps with retry
│   │   │   ├── retry.ts                  # Retry policy with exponential backoff
│   │   │   ├── idempotency.ts            # Idempotency key generation + dedup check
│   │   │   └── index.ts                  # Engine barrel export
│   │   ├── triggers/                     # Trigger handling
│   │   │   ├── interface.ts              # TriggerHandler interface
│   │   │   ├── corpus-change.ts          # Corpus-change trigger handler
│   │   │   ├── manual-request.ts         # Manual-request trigger handler
│   │   │   ├── schedule.ts              # Cron schedule trigger (wraps node-cron)
│   │   │   └── registry.ts              # Trigger type → handler registry
│   │   ├── steps/                        # Built-in step type implementations
│   │   │   ├── interface.ts              # PipelineStepHandler interface
│   │   │   ├── profile-generation.ts     # Invokes profile engine (Spec 008)
│   │   │   ├── fidelity-check.ts         # Runs attribution scoring (Spec 005)
│   │   │   ├── content-generation.ts     # Content generation via mediation (Spec 006)
│   │   │   ├── source-query.ts           # Queries content sources (Spec 006)
│   │   │   ├── notification.ts           # Sends notifications (reuses scheduler/notifications)
│   │   │   └── registry.ts              # Step type → handler registry
│   │   ├── review/                       # Review gate integration
│   │   │   ├── gate.ts                   # ReviewGate — pauses execution, routes to queue
│   │   │   ├── decision.ts               # Decision recording + pipeline resumption
│   │   │   ├── escalation.ts             # Timeout-based escalation logic
│   │   │   └── index.ts                  # Review barrel export
│   │   ├── graph/                        # Dependency analysis
│   │   │   ├── cycle-detector.ts         # DFS-based circular dependency detection
│   │   │   ├── dependency-graph.ts       # Directed graph builder from pipeline configs
│   │   │   └── index.ts                  # Graph barrel export
│   │   ├── templates/                    # Pipeline template system
│   │   │   ├── store.ts                  # Template CRUD + instantiation
│   │   │   ├── definitions/              # Built-in template JSON definitions
│   │   │   │   ├── corpus-update-to-profiles.json
│   │   │   │   ├── regulatory-change-monitor.json
│   │   │   │   └── content-audit.json
│   │   │   └── index.ts                  # Template barrel export
│   │   ├── analytics/                    # Execution analytics
│   │   │   ├── aggregator.ts             # Metrics computation from execution history
│   │   │   ├── quality-signals.ts        # Rejection rate → governance signal emitter
│   │   │   └── index.ts                  # Analytics barrel export
│   │   └── routes.ts                     # Express routes for pipeline management API
│   ├── tools/
│   │   ├── pipeline-tools.ts             # NEW — MCP tools for pipeline operations
│   │   └── ... (existing tools unchanged)
│   ├── db/
│   │   ├── client.ts                     # EXTEND — import and spread pipelines schema
│   │   └── schema.ts                     # UNCHANGED — existing public schema tables
│   └── ... (existing auth, scheduler, content, exports, index.ts unchanged)
├── tests/
│   ├── pipelines/                        # NEW — Pipeline framework tests
│   │   ├── event-bus/
│   │   │   └── pg-notify-bus.test.ts
│   │   ├── engine/
│   │   │   ├── executor.test.ts
│   │   │   ├── step-runner.test.ts
│   │   │   └── retry.test.ts
│   │   ├── triggers/
│   │   │   ├── corpus-change.test.ts
│   │   │   └── schedule.test.ts
│   │   ├── steps/
│   │   │   └── built-in-steps.test.ts
│   │   ├── review/
│   │   │   ├── gate.test.ts
│   │   │   └── escalation.test.ts
│   │   ├── graph/
│   │   │   └── cycle-detector.test.ts
│   │   ├── templates/
│   │   │   └── store.test.ts
│   │   └── analytics/
│   │       └── aggregator.test.ts
│   └── ... (existing tests unchanged)
└── drizzle/                              # Migration files (auto-generated)
```

**Structure Decision**: Extend the existing `joyus-ai-mcp-server` package with a new `src/pipelines/` module, following the same pattern established by `src/content/` for Feature 006. All pipeline infrastructure lives under this single namespace. The `pipelines` PostgreSQL schema keeps tables physically separated from `public` and `content` schemas. No new packages or projects are required.

## Work Breakdown

### Phase 0: Research (this plan + research.md)

Already captured in [research.md](research.md). Key decisions:

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Event bus | PostgreSQL LISTEN/NOTIFY behind `EventBus` interface | Same database, no external broker needed for MVP. Interface abstraction enables future swap to Redis Streams or RabbitMQ. |
| Pipeline executor | Async worker polling from queue table | Trigger events land in `trigger_events` table, worker picks them up. Decouples event receipt from execution. |
| Step execution | Sequential within pipeline, parallel across pipelines | Matches spec FR-005 (forward-only, pause-on-failure). Parallel within pipeline is not required and adds complexity. |
| Retry strategy | Custom implementation with configurable exponential backoff | Simple enough that a library is unnecessary. Backoff intervals stored per retry policy. |
| Circular dependency detection | DFS cycle detection on directed graph | Standard algorithm, runs at configuration time (O(V+E)). Runtime fallback tracks execution chain depth. |
| Cron scheduling | Reuse existing `node-cron` + `cron-parser` | Already in `package.json`, proven in scheduler module. No new dependency. |
| Review gate integration | Pipeline pauses with `paused_at_gate` status, decision table drives resumption | Simple state machine. Does not implement the review queue UI — only the pipeline's interface to it. |

### Phase 1: Foundation — Schema, Event Bus, Core Executor (P1 requirements)

**Goal**: Pipeline definitions can be created, validated, and stored. Trigger events flow through the event bus. The executor picks them up and runs pipeline steps sequentially. Failed steps retry with backoff. Tenant isolation enforced on all operations.

**Delivers**: FR-001 (event triggers: corpus-change, manual-request), FR-003 (execution logging), FR-004 (retry with backoff), FR-005 (forward-only, pause-on-failure), FR-009 (cycle detection at creation), FR-010 (tenant scoping), FR-014 (idempotent steps), FR-015 (concurrency control)

| Work Item | Description | Files |
|-----------|-------------|-------|
| WP-01: Drizzle schema | Define `pipelines` pgSchema with all tables: pipelines, pipeline_steps, pipeline_executions, execution_steps, trigger_events, review_decisions, pipeline_templates, pipeline_metrics. Enums, indexes, relations, type exports. Migration. | `src/pipelines/schema.ts`, `drizzle/` |
| WP-02: Types and validation | Shared TypeScript types, Zod schemas for pipeline configuration (trigger config, step config, retry policy, concurrency policy). | `src/pipelines/types.ts`, `src/pipelines/validation.ts` |
| WP-03: Event bus interface + PG implementation | `EventBus` interface (publish, subscribe, unsubscribe). `PgNotifyBus` implementation using PostgreSQL LISTEN/NOTIFY. Event envelope type with `eventId`, `tenantId`, `eventType`, `payload`, `timestamp`. Delivery guarantee via trigger_events table (publish writes row + NOTIFY, consumer acknowledges by updating status). | `src/pipelines/event-bus/` |
| WP-04: Trigger handlers | `TriggerHandler` interface. `CorpusChangeTriggerHandler` — evaluates corpus-change events, identifies affected pipelines, creates trigger_event rows. `ManualRequestTriggerHandler` — creates trigger_event from API request. Trigger registry mapping type strings to handlers. | `src/pipelines/triggers/` |
| WP-05: Pipeline executor | `PipelineExecutor` class — polls trigger_events table for pending events, matches to pipeline definitions, creates execution records, runs steps sequentially via StepRunner. Handles concurrency policy (skip_if_running, queue, allow_concurrent). Worker loop with configurable poll interval. | `src/pipelines/engine/executor.ts` |
| WP-06: Step runner + retry | `StepRunner` — executes a single step, applies retry policy with exponential backoff (default: 3 retries, 30s/60s/120s). Classifies errors as transient vs non-transient. Non-transient errors skip retries. Updates execution_step status on each attempt. Idempotency key generation for dedup. | `src/pipelines/engine/step-runner.ts`, `src/pipelines/engine/retry.ts`, `src/pipelines/engine/idempotency.ts` |
| WP-07: Built-in step handlers | `PipelineStepHandler` interface. Initial implementations: `profile-generation` (calls Spec 008), `fidelity-check` (calls Spec 005), `content-generation` (calls Spec 006), `source-query` (queries content sources), `notification` (reuses `scheduler/notifications.ts`). Step registry. | `src/pipelines/steps/` |
| WP-08: Circular dependency detection | `DependencyGraph` builder — constructs directed graph from pipeline trigger→output mappings across all tenant pipelines. `CycleDetector` — DFS-based cycle detection. Runs at pipeline creation/update time. Runtime fallback: execution chain depth counter (max depth configurable, default: 10). | `src/pipelines/graph/` |
| WP-09: DB client integration | Extend `src/db/client.ts` to import and spread `pipelinesSchema`. | `src/db/client.ts` |
| WP-10: Phase 1 tests | Unit tests for event bus, executor, step runner, retry logic, cycle detector, trigger handlers. Integration tests for end-to-end pipeline execution (corpus-change trigger → steps → completion). | `tests/pipelines/` |

### Phase 2: Review Gates + Schedule Triggers (P1 + P2 requirements)

**Goal**: Pipelines can pause at review gates, route artifacts for human review, resume on approval, and handle rejection with structured feedback. Cron-scheduled pipelines fire on schedule. Pipeline templates are instantiable.

**Delivers**: FR-006 (review gates), FR-007 (escalation on timeout), FR-008 (structured rejection feedback), FR-002 (schedule triggers), FR-011 (pipeline templates), FR-012 (template independence)

| Work Item | Description | Files |
|-----------|-------------|-------|
| WP-11: Review gate mechanism | `ReviewGate` — when executor hits a review_gate step, sets execution status to `paused_at_gate`, creates pending review_decision rows for each artifact, routes artifact references to tenant's review queue interface. | `src/pipelines/review/gate.ts` |
| WP-12: Decision recording + resumption | Decision API — records reviewer approval/rejection with structured feedback. On approval: marks artifact as approved, checks if all gate artifacts are decided, resumes pipeline if so. On rejection: stores feedback linked to artifact + profile version + execution, removes artifact from forward path, continues with remaining approved artifacts. | `src/pipelines/review/decision.ts` |
| WP-13: Escalation logic | Background job (cron) checks for review gates past their timeout (default: 48h, configurable per pipeline). On timeout: escalates to secondary reviewer or admin notification per tenant's escalation config. Never auto-approves or auto-rejects. | `src/pipelines/review/escalation.ts` |
| WP-14: Schedule trigger handler | `ScheduleTriggerHandler` — registers cron jobs via `node-cron` for each pipeline with a schedule trigger. On tick: creates trigger_event with `schedule_tick` type. Handles overlap detection (skip if previous execution still running). Respects pipeline enabled/disabled status. | `src/pipelines/triggers/schedule.ts` |
| WP-15: Pipeline templates | `TemplateStore` — CRUD for pipeline templates stored as JSON definitions with parameterized placeholders. Instantiation: copies template definition, substitutes tenant parameters, creates a tenant-owned pipeline. Template updates do not propagate to existing instances. 3 built-in templates: corpus-update-to-profiles, regulatory-change-monitor, content-audit. | `src/pipelines/templates/` |
| WP-16: Pipeline management API | Express routes for pipeline CRUD, manual trigger, execution history, review decision submission, template listing + instantiation. All routes enforce tenant scoping. | `src/pipelines/routes.ts` |
| WP-17: MCP tools | MCP tool definitions for pipeline operations: `pipeline_create`, `pipeline_list`, `pipeline_trigger`, `pipeline_status`, `pipeline_history`, `review_decide`, `template_list`, `template_instantiate`. | `src/tools/pipeline-tools.ts` |
| WP-18: Phase 2 tests | Unit tests for review gates, escalation, schedule triggers, templates. Integration tests for review gate flow (pause → decide → resume), scheduled execution, template instantiation. | `tests/pipelines/` |

### Phase 3: Analytics + Quality Signals (P3 requirements)

**Goal**: Pipeline execution metrics are tracked, aggregated, and available to tenants. High rejection rates emit quality signals to the governance layer.

**Delivers**: FR-013 (execution metrics)

| Work Item | Description | Files |
|-----------|-------------|-------|
| WP-19: Metrics aggregation | `MetricsAggregator` — computes per-pipeline and per-tenant metrics from execution history: success rate, mean/p95 execution duration, failure breakdown by step and error type, reviewer approval rate. Materialized into `pipeline_metrics` table, refreshed on execution completion events. | `src/pipelines/analytics/aggregator.ts` |
| WP-20: Quality signal emitter | `QualitySignalEmitter` — monitors reviewer rejection patterns. When rejection rate exceeds threshold (>30% over 10 executions), emits a structured quality signal to the governance layer (Spec 007). Signal includes pipeline ID, step ID, rejection rate, sample rejection reasons. | `src/pipelines/analytics/quality-signals.ts` |
| WP-21: Analytics API + tools | Express route for pipeline analytics queries (per-pipeline, per-tenant, date range filtering). MCP tool `pipeline_analytics`. | `src/pipelines/routes.ts`, `src/tools/pipeline-tools.ts` |
| WP-22: Phase 3 tests | Unit tests for metrics aggregation accuracy. Integration test: run 20 executions with varying outcomes, verify aggregate metrics match. Quality signal emission test. | `tests/pipelines/` |

## Risks

| Risk | Likelihood | Impact | Mitigation |
|------|-----------|--------|------------|
| PostgreSQL LISTEN/NOTIFY message loss under heavy load (connection drop, long-running transactions) | Medium | Medium | Trigger events are persisted to the queue table before NOTIFY. The executor polls the table as primary mechanism; NOTIFY is an optimization to reduce poll latency. If NOTIFY is lost, the next poll picks up the event within the poll interval (default: 30s). |
| Pipeline executor becomes a bottleneck with many concurrent tenants | Low (MVP scale) | Medium | Single-instance worker is sufficient for MVP scale. The executor interface supports future horizontal scaling via worker ID claiming (similar to SQS visibility timeout). Monitor execution queue depth as a scaling signal. |
| Review gate timeout escalation creates notification fatigue | Medium | Low | Default timeout is 48 hours (generous). Escalation is configurable per pipeline. Tenants can adjust timeout and escalation path. Analytics track time-to-review to surface patterns. |
| Circular dependency detection false negatives (indirect cycles via external events) | Low | High | DFS cycle detection catches all cycles within the platform's pipeline graph. Runtime depth counter (default: 10) catches cycles that involve external systems. Both checks must pass — belt and suspenders. |
| Spec 008 (Profile Isolation) not ready when 009 implementation starts | Medium | High | 009 depends on 008 for profile generation step handler. Mitigation: Phase 1 of 009 can proceed without 008 by using mock step handlers. Real step handlers are wired in Phase 2 when 008 is available. Step handler interface is the decoupling point. |

## Exit Criteria

| Criterion | Verification |
|-----------|-------------|
| Pipeline executes end-to-end from corpus-change trigger to completion | Integration test: upload documents → corpus-change event → pipeline triggers → steps execute → artifacts produced |
| Retry policy works correctly (transient vs non-transient errors) | Unit test suite: 100 simulated failure scenarios with correct retry/no-retry behavior |
| Review gate pauses and resumes correctly | Integration test: pipeline pauses at gate → reviewer approves → pipeline resumes from gate |
| Reviewer rejection feedback is stored as structured signal | Unit test: reject with feedback → verify signal stored with artifact ref, profile version, execution ref |
| Circular dependency detection catches all cycles | Test suite: 50 pipeline configurations including indirect cycles of depth 5+ → 100% detection rate |
| Scheduled pipelines fire on time and handle overlap | Integration test: schedule pipeline → advance clock → verify execution. Schedule overlap → verify skip + warning log |
| Pipeline templates are instantiable and independently editable | Integration test: instantiate template → modify instance → verify template unchanged |
| Tenant isolation prevents cross-tenant access | Integration test: create pipelines for tenant A and B → verify A cannot see B's pipelines, executions, or events |
| Execution history queryable within latency target | Performance test: 1000 executions over 90 days → query returns in <1s |
| Analytics accurately reflect execution outcomes | Integration test: 20 executions (15 success, 3 retry-then-success, 2 failed) → verify aggregate metrics |
| All existing tests still pass | CI: `npm run validate` passes with zero regressions |

## Deferred Items

| Item | Reason | When to Revisit |
|------|--------|----------------|
| External webhook triggers with authentication | Spec explicitly defers to P3. Requires webhook registration, signature verification, replay protection. | After core pipeline framework is validated in production. |
| Horizontal scaling of pipeline executor | Single-instance worker is sufficient for MVP. Scaling signal: execution queue depth consistently >100. | When tenant count exceeds single-worker throughput. |
| Custom step types (arbitrary external API calls) | Spec scope: content-and-profile workflows only. Step interface does not preclude custom steps. | When tenants request integrations beyond platform-managed content/profiles. |
| Review queue UI | This spec defines pipeline-to-review-queue interface, not the queue UI. | Separate feature spec for review queue management. |
| Redis/RabbitMQ event bus implementation | PostgreSQL LISTEN/NOTIFY is sufficient for MVP. EventBus interface enables swap. | When event volume exceeds PostgreSQL's NOTIFY throughput (~10K events/sec). |
| Pipeline versioning and migration | Pipeline definitions are currently mutable. Version-on-edit semantics would enable safe rollback of pipeline configuration changes. | When tenants request pipeline config rollback. |
| Parallel step execution within a pipeline | Currently sequential only. Some workflows would benefit from fan-out/fan-in (e.g., regenerate 5 profiles in parallel then merge). | When sequential execution becomes a bottleneck for pipelines with many independent steps. |

## Complexity Tracking

*No constitution violations requiring justification.*

No additional complexity beyond what the spec requires. The `EventBus` interface and step handler interface are mandated by the spec's extensibility requirements (event bus swap, custom step types) — each has a concrete MVP implementation alongside the interface. The circular dependency detector uses a standard DFS algorithm, not a custom graph library. Pipeline templates are stored as JSON — no template engine dependency.
