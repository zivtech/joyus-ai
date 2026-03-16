# Specification: Automated Pipelines Framework

**Project:** Joyus AI Platform
**Phase:** 2.7+ — Automation Layer
**Date:** March 14, 2026
**Status:** Specification Complete

---

## 1. Overview

### Problem

The joyus-ai platform executes content intelligence operations — profile generation, fidelity checks, content creation, source queries — as ad-hoc, manually-initiated actions. There is no mechanism to chain these operations into repeatable workflows, trigger them automatically on platform events, enforce human review before sensitive outputs are published, or schedule them on a calendar basis. As tenant workloads scale, the absence of automation creates operational bottlenecks:

1. **No composition**: Operations exist as isolated endpoints. A sequence such as "query new sources → generate profiles → fidelity check → notify reviewer" requires manual orchestration by the caller.
2. **No event-driven triggers**: Changes in the content corpus (new sources ingested, documents updated) do not automatically initiate downstream processing. Operators must poll and manually re-run stale workflows.
3. **No human-in-the-loop control**: AI-generated content — particularly outreach and executive communications — requires human approval before use. There is no structured mechanism to pause execution, route artifacts for review, record decisions, and resume.
4. **No scheduling**: Time-based recurring workflows (daily briefs, weekly digests, scheduled profile refreshes) must be managed externally.
5. **No operational visibility**: Without a pipeline layer, there is no aggregate view of what automation ran, when, whether it succeeded, and why it failed.

### Solution

Build the Automated Pipelines Framework as a first-class module of the `joyus-ai` platform. The framework provides:

- A **pipeline definition model** — tenant-owned named sequences of typed steps with trigger conditions, retry policies, and concurrency controls
- An **event bus** — PostgreSQL LISTEN/NOTIFY with at-least-once delivery for intra-platform event propagation
- A **trigger system** — corpus-change, manual, and schedule trigger handlers with circular dependency detection
- An **execution engine** — poll-driven recovery plus event-driven execution, step-by-step progress tracking, idempotency, and exponential backoff retry
- **Built-in step handlers** — profile generation, fidelity check, content generation, source query, and notification; each integrating with existing platform capabilities via injected service interfaces
- **Review gates** — structured pause-and-resume mechanism with per-artifact approval, structured rejection feedback, and timeout escalation
- **Pipeline templates** — reusable starting points including three built-in definitions
- **Analytics** — materialized per-pipeline metrics (success rate, p95 duration, rejection rate) with quality signal emission when thresholds are breached
- **REST API and MCP tools** — full CRUD and operational surface accessible to humans and Claude agents alike

The framework operates entirely within the existing Express/Drizzle/PostgreSQL stack. No additional infrastructure is required. All data is tenant-scoped; the `pipelines` PostgreSQL schema isolates this feature's tables from the rest of the platform.

### Users

- **Tenant administrators** — define and manage pipelines, configure triggers and step sequences, review execution history
- **Content reviewers** — receive pending review decisions, approve or reject AI-generated artifacts, provide structured feedback
- **Claude agents (MCP)** — create, trigger, and monitor pipelines conversationally; access analytics; manage review queues
- **Platform operators** — monitor pipeline health across tenants, observe quality signals, manage escalations
- **Platform itself (internal)** — Spec 008 (Profile Isolation) uses pipelines as the execution substrate for drift-triggered retraining

---

## 2. Functional Requirements

### FR-001: Pipeline Definition Model

Tenants can define named pipelines, each with:
- A **trigger** (one of: corpus-change, manual, schedule) with type-specific configuration
- An ordered list of **steps** (1–20), each specifying a step type, display name, step-specific configuration, whether human review is required after completion, and an optional review timeout window (1–168 hours; default 24)
- A **concurrency policy** governing behavior when a new trigger fires while an execution is already in progress: `skip` (discard new trigger), `queue` (enqueue for later), or `allow` (run simultaneously)
- A **retry policy** (max attempts 1–10, initial delay, backoff multiplier, max delay) applied to transient step failures
- A **status** (`active`, `paused`, `archived`) controlling whether triggers fire

Pipelines are owned by exactly one tenant. All queries filter by `tenantId` at the database level.

### FR-002: Event Bus with Delivery Guarantee

An internal event bus abstracts trigger event propagation. The implementation uses PostgreSQL LISTEN/NOTIFY for low-latency delivery, backed by a `trigger_events` queue table for at-least-once delivery across server restarts.

- Events carry: event type, tenant ID, payload (JSON), and creation timestamp
- NOTIFY payloads contain only the event ID — full payload is fetched from the queue table (avoids the 8KB NOTIFY limit)
- A dedicated persistent `pg.Client` (not from the connection pool) handles `LISTEN`
- On server startup, unprocessed events in the queue table are recovered and replayed before the poll loop begins

### FR-003: Trigger System

Three trigger types are supported. Each type has a handler registered in a central trigger registry.

**Corpus-change trigger**: Fires when new documents are ingested or existing documents are updated in the content corpus (Spec 006). Configuration specifies an optional list of source IDs to watch (empty = all sources for the tenant) and an optional minimum-change threshold (number of documents that must change before the trigger fires).

**Manual trigger**: Fires when an authenticated user or MCP tool explicitly requests execution. Configuration specifies an optional list of allowed roles. Returns an event ID immediately; execution is asynchronous.

**Schedule trigger**: Fires according to a cron expression. Configuration specifies the cron expression (e.g., `0 9 * * 1-5`), an IANA timezone, and whether overlapping executions are allowed. Cron jobs are registered dynamically when pipelines are created or updated, and removed when pipelines are deleted. If `allowOverlap` is false and an execution is already running, the scheduled trigger is skipped.

### FR-004: Circular Dependency Detection

Before any pipeline is created or updated, a DFS-based cycle detector validates that the new or modified pipeline does not introduce a circular dependency within the tenant's pipeline graph. A corpus-change trigger firing pipeline A can, via a notification step, cause pipeline B to fire — which in turn could re-trigger pipeline A. The detector builds the dependency graph and rejects cycles at creation time with a 422 response. A runtime depth counter caps cascading execution depth at 10 levels.

### FR-005: Execution Engine

The `PipelineExecutor` manages the full execution lifecycle:

- **Event-driven path**: receives trigger events from the event bus, matches them to active pipelines via trigger handlers, enforces concurrency policy, generates idempotency keys, and starts execution
- **Poll-driven recovery path**: on startup and on each poll interval (default 5 seconds), scans for unprocessed trigger events and pending executions to resume interrupted work after server restarts or crashes
- **Execution lifecycle**: `pending` → `running` → `completed` (or `failed` or `cancelled`)
- **Idempotency**: a deterministic key is computed from `pipelineId + triggerType + stable payload fields`. Executions with duplicate keys are skipped (unless the prior execution failed)
- **Graceful shutdown**: on `SIGTERM`, the executor stops accepting new triggers and waits up to 30 seconds for in-flight executions to complete before shutting down

Executions that are already `running` or `waiting_review` count as "in progress" for concurrency policy enforcement.

### FR-006: Step Execution with Retry

The `StepRunner` executes a pipeline's steps in sequence, one at a time:

- Each step is recorded in `step_executions` with status, input data, output data, attempt count, and timestamps
- Before executing a step, the runner checks whether the step was already completed in a prior run (enabling idempotent recovery without re-executing successful steps)
- Transient errors (network timeouts, connection failures, service unavailability) are retried with exponential backoff and jitter up to the pipeline's configured `maxAttempts`
- Non-transient errors (invalid configuration, resource not found, validation failures) are re-thrown immediately without retry
- Steps carry output data forward; the `outputData` field of each `step_executions` row is available to subsequent steps via the execution context

### FR-007: Built-in Step Handler Types

Six step types are available out of the box. Each handler implements a common interface (`PipelineStepHandler`) and is registered in a step handler registry.

| Step Type | Purpose | Integration |
|-----------|---------|-------------|
| `profile_generation` | Generate a writing profile for a target person or organization | Spec 008 (Profile Engine) |
| `fidelity_check` | Score an artifact's fidelity against a profile; flag low-quality outputs | Spec 005 (Fidelity Monitor) |
| `content_generation` | Generate content (emails, summaries, reports) using the content infrastructure | Spec 006 (Content Infrastructure) |
| `source_query` | Query the content corpus for documents matching a search string | Spec 006 (Content Infrastructure) |
| `notification` | Send a message via Slack, email, or webhook | Notification service |
| `review_gate` | Pause execution and route artifacts for human review (see FR-008) | Internal — handled by StepRunner directly |

All handlers accept a service client interface (not a concrete class) via constructor injection. Where a platform service is unavailable (e.g., during early rollout), a `NullServiceClient` stub logs a warning and returns a no-op result, allowing the pipeline module to ship and be tested independently of service availability.

Step handlers must be idempotent: they use `executionId + stepIndex` as an idempotency key when calling external services.

### FR-008: Review Gates (Human-in-the-Loop)

Any step can be configured with `requiresReview: true`. When such a step completes:

1. The execution status transitions to `waiting_review`
2. A `review_decisions` row is created in `pending` state with a timeout timestamp
3. Artifact paths produced by the step are recorded in the decision row for per-artifact approval tracking
4. The `StepRunner` halts — execution does not continue until a reviewer acts

**Decision outcomes:**
- `approved`: the decision is recorded, the execution resumes from the next step
- `rejected`: the decision is recorded with structured feedback text; the execution is cancelled
- `partial`: per-artifact approvals are recorded (`true` = approved, `false` = rejected); the execution resumes (only approved artifacts proceed to downstream steps)

Re-submitting a decision on an already-decided review returns 409. Decision recording must validate that the reviewer's tenant matches the review decision's tenant.

### FR-009: Review Timeout Escalation

Pending review decisions that exceed their `timeoutAt` timestamp are escalated by a background cron process running every 15 minutes. Escalation:

- Sets `escalation_status` from `pending` to `escalated`
- Sends a notification to the tenant's configured escalation channel via the `EscalationNotifier` interface
- Does **not** auto-approve or auto-reject — the pipeline remains paused
- Is idempotent: already-escalated reviews are skipped on subsequent cron runs

Resolving an escalation requires a human to submit an explicit decision.

### FR-010: Schedule Triggers with Overlap Detection

Schedule-triggered pipelines fire according to their cron expression in their configured timezone. The platform:

- Registers a cron job for each active schedule-triggered pipeline on startup and on pipeline create/update
- Removes the cron job when a schedule-triggered pipeline is deleted or archived
- Detects and suppresses overlapping executions when `allowOverlap: false` (default): if an execution is already `running` or `waiting_review`, the scheduled firing is skipped

### FR-011: Pipeline Templates

A template system allows tenants to instantiate pipelines from pre-defined starting points.

**Built-in templates** (platform-wide, visible to all tenants, `tenantId: null`):
1. **Profile + Fidelity Check** — corpus-change trigger → profile generation → fidelity check
2. **Scheduled Content Brief** — schedule trigger → source query → content generation → notification
3. **Reviewed Outreach** — manual trigger → content generation → review gate → notification

**Tenant templates** — tenants can save their own pipeline definitions as reusable templates.

Template instantiation deep-clones the definition to prevent cross-tenant contamination. Built-in template definitions cannot be modified by tenants.

### FR-012: Pipeline CRUD API

Express REST routes for pipeline management, all tenant-scoped via `requireTenant` middleware. All routes return 401 if `tenantId` is absent from the session.

| Method | Path | Description |
|--------|------|-------------|
| `POST` | `/pipelines` | Create pipeline; runs cycle detection; returns 422 on cycle |
| `GET` | `/pipelines` | List pipelines for tenant; supports `status` filter |
| `GET` | `/pipelines/:id` | Get single pipeline |
| `PATCH` | `/pipelines/:id` | Update pipeline; re-runs cycle detection if step config or trigger changed |
| `DELETE` | `/pipelines/:id` | Delete pipeline; removes schedule registration |
| `POST` | `/pipelines/:id/trigger` | Manual trigger; returns 202 with event ID |
| `GET` | `/pipelines/:id/executions` | Paginated execution history |
| `GET` | `/executions/:executionId/steps` | Step-level detail for an execution |
| `GET` | `/review-decisions/:decisionId` | Get a pending review decision |
| `POST` | `/review-decisions/:decisionId/decide` | Submit a review decision |
| `GET` | `/pipelines/:id/metrics` | Current aggregate metrics for a pipeline |
| `GET` | `/pipelines/:id/quality-signals` | Unacknowledged quality signals for a pipeline |
| `POST` | `/quality-signals/:signalId/acknowledge` | Acknowledge a quality signal |

### FR-013: MCP Tool Surface

Eight MCP tools expose pipeline management to Claude agents. All tools receive `tenantId` from the authenticated MCP gateway context — never from tool input.

| Tool Name | Description |
|-----------|-------------|
| `pipeline_list` | List pipelines for the tenant; optional status filter |
| `pipeline_get` | Get a single pipeline with trigger config and step configs |
| `pipeline_create` | Create a pipeline; runs cycle detection before persisting |
| `pipeline_update` | Update pipeline config, steps, or status |
| `pipeline_delete` | Delete pipeline and cancel pending executions |
| `pipeline_trigger` | Manually trigger a manual-type pipeline |
| `pipeline_execution_history` | Get paginated execution history with step detail |
| `pipeline_analytics` | Get aggregate metrics: success rate, avg duration, p95, rejection rate |

### FR-014: Analytics and Metrics Aggregation

Per-pipeline aggregate metrics are maintained in the `pipeline_metrics` table and refreshed asynchronously after each execution completes (fire-and-forget, non-blocking to the execution path):

- `totalExecutions` — all terminal executions (completed + failed + cancelled)
- `successfulExecutions` — executions with status `completed`
- `failedExecutions` — executions with status `failed` or `cancelled`
- `avgDurationMs` — mean duration of completed executions (null if none exist)
- `p95DurationMs` — 95th-percentile duration; computed by sorting durations and taking the value at index `floor(N * 0.95)`; null if fewer than 20 completed executions exist
- `reviewRejectionRate` — stored in basis points (0–10000); computed from the last 10 decided review decisions for the pipeline

### FR-015: Quality Signal Emission

After each metrics refresh, the `QualitySignalEmitter` checks whether the pipeline's rejection rate exceeds the configured threshold. A `quality_signals` row is emitted when:

- `totalExecutions >= 10` (minimum sample size for meaningful signal)
- `reviewRejectionRate > 3000` (>30% rejection rate, in basis points)
- No unacknowledged signal of type `high_rejection_rate` already exists for the pipeline

Signals carry a severity (`info`, `warning`, `critical`), a human-readable message including the current rejection rate and threshold, and metadata. Signals are informational — they do not block execution. Tenants can acknowledge signals via the API; acknowledgment suppresses deduplication so a new signal can be emitted if the condition persists.

---

## 3. Non-Functional Requirements

### Performance

- Trigger event processing latency (event published → execution started): < 1 second p95 under normal load
- Step execution overhead (StepRunner bookkeeping per step, excluding handler logic): < 50ms p95
- API response time for list/get routes: < 100ms p95 (DB-backed, no computation)
- Review decision recording (including async execution resume): < 200ms p95 for the synchronous portion
- Metrics refresh (per-pipeline, triggered after completion): < 500ms p95; must not block the execution path
- Poll interval default: 5 seconds; must be configurable at initialization time
- Escalation cron overhead: negligible — runs at most once every 15 minutes, bounded to 50 timed-out reviews per run

### Security

- All pipeline data is tenant-scoped. No query path returns pipelines, executions, steps, review decisions, metrics, or quality signals from another tenant.
- `tenantId` is always sourced from the authenticated session (`req.tenantId`), never from request body or MCP tool input parameters.
- Cycle detection is enforced server-side at creation and update time — it cannot be bypassed by API callers.
- Review decisions validate tenant membership before recording. A reviewer from Tenant A cannot decide on a review decision belonging to Tenant B.
- Idempotency keys are computed server-side from pipeline and trigger context — they are not accepted as caller-supplied values (except as an optional hint in manual trigger payloads, which is namespaced and cannot override the computed key).
- Pipeline deletion uses `AND tenantId = :tenantId` on all `DELETE` operations — ownership is verified at the database level, not just in application code.
- Schedule trigger payloads are system-generated and do not contain user-supplied data. Manual trigger payloads are caller-supplied and must be treated as untrusted input; they are stored as JSON but never executed as code.
- `NullServiceClient` stubs must not be used in production environments; startup checks must log an error if null clients are detected outside of test mode.

### Availability

- The event bus degrades gracefully: if the PostgreSQL LISTEN connection drops, in-flight events are not lost — they remain in the `trigger_events` queue table and are recovered on reconnect or server restart.
- The execution engine survives server restarts: `pending` executions are resumed by the recovery poll on next startup; completed steps are not re-executed (step-level idempotency).
- Review gate escalation runs on an interval; a single missed cron cycle does not cause data loss — the next run picks up timed-out reviews.
- Metrics refresh failures are logged but do not fail the execution itself — analytics are non-critical to the operational path.
- Built-in template seeding is idempotent: re-running `seedBuiltInTemplates` on startup does not create duplicate templates.

### Cost

- No additional infrastructure beyond the existing PostgreSQL instance and Express process
- The `trigger_events` queue table must be periodically cleaned of processed events to prevent unbounded growth; retention window defaults to 7 days
- `pipeline_metrics` stores exactly one row per pipeline (upsert pattern) — no unbounded growth
- `quality_signals` rows accumulate over time; implement periodic archival after acknowledgment (90-day default retention)
- In-memory cron job map for schedule triggers: O(N) where N is the number of active schedule-triggered pipelines per process; expected to be small (< 1,000 per tenant, < 10,000 platform-wide)
- p95 computation in application code is acceptable for < 10,000 executions per pipeline; for high-throughput pipelines, migrate to PostgreSQL `percentile_disc` aggregation

---

## 4. User Scenarios

### Scenario 1: Automating Weekly Executive Briefs

A tenant administrator defines a pipeline: schedule trigger (every Monday at 9am, America/New_York) → source query ("executive communications last 7 days") → content generation (brief format, CEO voice profile) → review gate (requires editor approval, 48-hour timeout) → notification (email to distribution list). The pipeline runs automatically each Monday. If the editor does not approve within 48 hours, the escalation cron notifies the head of operations. The editor reviews the draft, requests one revision (rejected with feedback), the pipeline is re-triggered manually, and the revised brief is approved and sent.

### Scenario 2: Corpus-Change Profile Refresh

A tenant has configured a corpus-change trigger pipeline that watches their "sales team" source group. When the content ingestion system (Spec 006) processes 10 or more new documents from that source group, the pipeline fires: source query (retrieve new documents) → profile generation (refresh the team's voice profile using the latest samples) → fidelity check (score the updated profile against recent outputs). The fidelity check flags a low score (below 0.7), setting `flagForReview: true` on the step result. A quality signal is not emitted (rejection rate is unrelated to fidelity score), but the flag surfaces in the execution detail so an operator can investigate.

### Scenario 3: Cross-Tenant Isolation Enforcement

A user at Tenant B attempts to manually trigger a pipeline belonging to Tenant A by guessing its UUID and calling `POST /pipelines/{id}/trigger`. The route handler queries `WHERE id = :id AND tenantId = :sessionTenantId` — the pipeline is not found for Tenant B's session, and a 404 is returned. No data from Tenant A is exposed.

An MCP tool call `pipeline_trigger({ pipelineId: "..." })` made by a Claude agent with a Tenant B session token follows the same code path: `context.tenantId` is Tenant B's ID, the ownership check fails, and the tool returns a not-found error.

### Scenario 4: Review Gate Partial Approval

A content pipeline generates five draft emails for a sales campaign (content_generation step produces 5 artifact paths). The step is configured with `requiresReview: true`. The execution pauses at `waiting_review`. A reviewer opens the review decision via the API, approves 4 drafts and rejects 1 with feedback ("tone too aggressive"). The reviewer submits a `partial` decision with `artifactApprovals: { "content/draft-1": true, "content/draft-2": true, "content/draft-3": true, "content/draft-4": true, "content/draft-5": false }`. The decision is recorded, and the execution resumes. Downstream steps receive the set of approved artifact paths — the rejected draft does not proceed.

### Scenario 5: Graceful Degradation on Service Unavailability

The profile engine (Spec 008) is temporarily unavailable due to a deployment. A corpus-change trigger fires and starts a pipeline whose first step is `profile_generation`. The step handler calls the `ProfileServiceClient` interface, which throws a transient `Error` (connection refused). The `RetryExecutor` retries 3 times with exponential backoff (1s, 2s, 4s). The service is still down. After exhausting max attempts, the step is marked `failed` and the execution is marked `failed`. An operator sees the failure in the execution history and can manually re-trigger once the service recovers. The `trigger_events` row was already marked processed when the execution was created — retry is at the execution level, not the event level.

### Scenario 6: Claude Agent Pipeline Management

During a planning session, a Claude agent invoked with a tenant's MCP credentials uses `pipeline_list` to see the tenant has no active pipelines. The agent uses `pipeline_create` with a manual trigger, a source query step, and a content generation step. The platform validates the config, runs cycle detection (passes — no cycles in a single-pipeline tenant), and returns the created pipeline. The agent immediately uses `pipeline_trigger` to fire the pipeline and then polls `pipeline_execution_history` to confirm the execution completed. Finally, `pipeline_analytics` is called to confirm the first execution registered in metrics.

### Scenario 7: Quality Signal and Governance Response

A pipeline generating prospecting emails has been running for two weeks. Of its 12 completed executions, 5 were rejected at the review gate (41.7% rejection rate — above the 30% threshold). After the 12th execution, `MetricsAggregator.refreshMetrics` runs, updating `reviewRejectionRate` to 4167 basis points. Then `QualitySignalEmitter.checkAndEmit` finds no existing unacknowledged signal and inserts a `high_rejection_rate` quality signal at `warning` severity. A platform operator is notified. The operator reviews the pipeline's step configurations and rejection feedback, identifies that the content generation template needs updating, updates the pipeline's step config, and acknowledges the quality signal.

---

## 5. Key Entities

| Entity | Description |
|--------|-------------|
| Pipeline | Tenant-owned definition of a trigger + ordered step sequence + concurrency and retry policy |
| PipelineExecution | A single run of a pipeline, tracking status, trigger payload, timing, and idempotency key |
| StepExecution | The result of executing one step within an execution — status, input/output data, attempt count, timestamps |
| ReviewDecision | A pending or decided human review associated with a step execution — decision, per-artifact approvals, feedback, escalation status, timeout |
| TriggerEvent | Queue table row for an emitted trigger event — type, payload, processed flag |
| PipelineTemplate | A reusable pipeline definition — built-in (tenantId null) or tenant-created |
| PipelineMetrics | One-row-per-pipeline materialized aggregate — total executions, success/failure counts, avg/p95 duration, rejection rate |
| QualitySignal | Emitted when a pipeline's metrics breach a governance threshold — type, severity, message, acknowledged flag |
| EventBus | Interface abstracting intra-platform event propagation (PostgreSQL NOTIFY implementation) |
| TriggerHandler | Per-trigger-type handler: determines which pipelines match an incoming event |
| PipelineStepHandler | Per-step-type handler: executes one step and returns a `StepResult` with output data and artifact paths |
| StepHandlerRegistry | Map from step type string to `PipelineStepHandler` instance |
| RetryExecutor | Wraps step handler execution with configurable exponential backoff and transient/non-transient error classification |
| ReviewGate | Creates pending review decisions and tracks per-artifact approval sets |
| DecisionService | Records reviewer decisions and triggers execution resumption or cancellation |
| EscalationService | Finds timed-out pending reviews and escalates them via the `EscalationNotifier` interface |
| MetricsAggregator | Computes and upserts aggregate metrics after execution completion |
| QualitySignalEmitter | Checks metrics thresholds and emits quality signal rows when breached; deduplicates against existing unacknowledged signals |

---

## 6. Success Criteria

1. **End-to-end pipeline execution verified** — integration test confirms a corpus-change event triggers a pipeline, all steps execute in order, metrics are refreshed, and the execution record shows `completed`
2. **Review gate flow complete** — integration test confirms pause → reviewer submits decision → execution resumes (approve path) and pause → reviewer rejects → execution is cancelled (reject path), including partial approval with per-artifact tracking
3. **Schedule trigger fires correctly** — integration test with clock manipulation confirms a schedule-triggered pipeline fires at the configured cron time and skips when overlap detection is active
4. **Tenant isolation enforced** — integration test confirms a Tenant B session cannot read or trigger pipelines, executions, review decisions, metrics, or quality signals belonging to Tenant A across all routes and MCP tools
5. **Circular dependency rejected** — unit test confirms creating a pipeline that would form a cycle returns 422 with a descriptive error message
6. **Retry and recovery work** — unit tests confirm transient errors are retried with backoff, non-transient errors fail immediately, and a server restart does not re-execute already-completed steps
7. **Analytics accurate** — integration test with 20 controlled executions verifies `avgDurationMs`, `p95DurationMs`, and `reviewRejectionRate` match expected values computed independently
8. **Quality signal deduplication correct** — integration test confirms a second quality signal is not emitted when an unacknowledged signal already exists; a new signal is emitted after the first is acknowledged
9. **MCP tools operational** — unit tests confirm all 8 tools have unique `pipeline_`-prefixed names, valid Zod input schemas, and accept representative valid input
10. **Zero regressions** — `npm run validate` (typecheck + lint + tests) passes with no failures in the existing test suite

---

## 7. Assumptions

- The platform uses Drizzle ORM with PostgreSQL. The `pipelines` PostgreSQL schema namespace is created via migration before server startup. Drizzle Kit may not auto-generate `CREATE SCHEMA IF NOT EXISTS` — migration files must be inspected and patched if needed.
- The content corpus (Spec 006) emits events when documents are ingested or updated. Those events reach the pipeline event bus via the existing corpus change notification mechanism. If Spec 006's event emission interface differs from what this spec assumes, the `CorpusChangeTriggerHandler` must be adapted accordingly.
- The `requireTenant` Express middleware exists and attaches `req.tenantId` from the authenticated session. If the middleware uses a different property path (e.g., `req.auth.tenantId`), all tenant scope references must be updated.
- Spec 005 (fidelity monitor) and Spec 006 (content infrastructure) expose TypeScript service interfaces that the step handlers can consume. Where real interfaces are not available, `NullServiceClient` stubs are used and must be replaced before production use of the affected step types.
- PostgreSQL advisory locks or `FOR UPDATE SKIP LOCKED` may be needed to make concurrency policy enforcement atomic under high-concurrency conditions. The initial implementation uses a read-then-write pattern that is acceptable at low concurrency but should be hardened before production.
- IANA timezone identifiers are valid and the cron library supports them. Verify timezone support in the chosen cron implementation before WP07.
- `JSON.stringify` on the stable payload subset used for idempotency key generation produces consistent output because the `stablePayload` object's properties are always defined in the same explicit order in source code.

---

## 8. Dependencies

- **Spec 005** (Content Intelligence): Fidelity check step handler (`fidelity_check`) depends on Spec 005's drift monitoring and fidelity scoring interfaces. Spec 009 can ship with null client stubs; real integration requires Spec 005 to be deployed.
- **Spec 006** (Content Infrastructure): Corpus-change trigger depends on Spec 006's document ingestion events. Content generation and source query step handlers depend on Spec 006's content service and search abstraction. All three use interface-based injection with null client fallbacks.
- **Spec 007** (Org-Scale Agentic Governance): Pipeline operations emit governance-compatible audit events. The pipeline module must follow the platform's existing auth middleware and access control patterns. Review gate escalation integrates with governance-level notification.
- **Spec 008** (Profile Isolation and Scale): Profile generation step handler depends on Spec 008's `ProfileServiceClient` interface. Spec 008 references Spec 009 as the execution substrate for drift-triggered retraining pipeline steps. Mutual soft dependency — each can ship without the other by using interface stubs.
- **Platform conventions**: Drizzle ORM + `pgSchema`, Zod-first validation, Express router pattern, `ToolDefinition` interface for MCP tools, `requireTenant` middleware — all must match the patterns already established in the codebase.
- **External libraries**: A cron library (e.g., `node-cron`) for schedule trigger management; must support IANA timezones and dynamic job registration/cancellation.

---

## 9. Edge Cases

- **Cycle in a multi-pipeline graph**: Tenant creates Pipeline A (corpus-change → notification to Pipeline B trigger) and then creates Pipeline B (corpus-change → notification to Pipeline A trigger). The DFS cycle detector must traverse the full dependency graph — not just direct trigger relationships — to detect this indirect cycle before Pipeline B is persisted.
- **Server crash mid-step**: The recovery poll on restart finds the execution in `running` status and calls `runExecution` again. The `StepRunner` checks each step's existing `step_executions` row: steps with `status = 'completed'` are skipped; the failed or incomplete step is re-run. Step handlers must be idempotent to tolerate this recovery pattern.
- **Concurrent trigger events for the same pipeline**: Two corpus-change events fire within the same poll interval. Both event handlers call `createAndRunExecution` for the same pipeline. The concurrency policy (`skip` by default) detects the in-progress execution and discards the second trigger. The idempotency key provides a second layer: if the stable payload is identical, the second execution is rejected as a duplicate.
- **Review decision on cancelled execution**: If a pipeline execution is cancelled externally (e.g., via the `pipeline_delete` route) while a review decision is pending, the decision record becomes orphaned. The review API should return a 404 or `gone` status for decisions on cancelled executions rather than allowing the reviewer to submit a decision that will have no effect.
- **Schedule overlap with long-running review gates**: A pipeline's schedule fires hourly, but one execution is paused at a review gate for 90 minutes. With `allowOverlap: false`, all subsequent scheduled firings are suppressed until the execution completes or is cancelled. Administrators must set appropriate `reviewTimeoutHours` for pipelines with schedule triggers to prevent indefinite schedule suppression.
- **Template instantiation for an unavailable service**: A built-in template references `profile_generation`, but Spec 008 is not deployed and the handler is a null client. Instantiation succeeds; the null client logs a warning at runtime. Templates are validated structurally, not by service availability.
- **Empty `artifactApprovals` on partial decision**: A reviewer submits `decision: 'partial'` without specifying `artifactApprovals`. The server treats this as approval of all artifacts (conservative default: do not silently discard work) and resumes the execution. This behavior is documented in the API response schema.
- **Escalation cron concurrency**: If the 15-minute escalation cron takes longer than 15 minutes (e.g., thousands of timed-out reviews), a second cron run begins before the first completes. The `WHERE escalation_status = 'pending'` clause prevents double-escalation of the same row, but two concurrent runs may fetch overlapping sets. Implement a mutex flag in the escalation service to prevent concurrent runs.
- **Metrics refresh on simultaneous completions**: Ten executions of the same pipeline complete within one second. Each completion fires `refreshMetrics` asynchronously. The last write wins (upsert pattern). This is acceptable — metrics are eventually consistent, not transactionally exact.
- **Pipeline updated while execution is running**: A tenant updates a pipeline's step configs while an execution is in progress. The running execution fetches its step configs at the start of `runAllSteps` and holds them in memory for the duration of the run — it completes with the old configuration. The new configuration applies to the next execution. In-flight executions are not interrupted by configuration changes.
- **`trigger_events` queue growth**: The queue table is append-only. If processed events are not cleaned up, the table grows without bound and the partial index on unprocessed events degrades. A cleanup job or TTL-based archival must be implemented; this is outside the scope of Spec 009 but must be tracked as a follow-on operational task.

---

## 10. Out of Scope

- **Dynamic step output wiring**: Passing the output of step N as structured input to step N+1 via a declared data-flow DSL is a future enhancement. Today, step handlers can access prior step outputs by querying `step_executions` using the `executionId`, but there is no built-in output-chaining mechanism in the pipeline definition.
- **Parallel step execution**: Steps execute sequentially. Parallel branches within a single pipeline (fan-out/fan-in) are not supported in this version.
- **Custom step handler registration**: Tenants cannot define custom step types. Only the six built-in handlers are available. A plugin API for tenant-defined handlers is a future feature.
- **Pipeline versioning**: Pipelines do not have semantic versions. When a pipeline is updated, all subsequent executions use the new configuration. Historical executions retain their step output data, but there is no formal version history for the pipeline definition itself.
- **Cross-tenant pipeline dependencies**: Pipelines are strictly tenant-isolated. A pipeline in Tenant A cannot trigger a pipeline in Tenant B, even with explicit permission.
- **Real-time execution streaming**: Execution status and step progress are queryable via the REST API but are not streamed. WebSocket or SSE-based real-time execution monitoring is out of scope.
- **UI/dashboard**: No frontend interface for pipeline management is included. The API and MCP tools are the operational surface; a UI is a future feature.
- **Pipeline marketplace or sharing**: Tenants cannot publish their pipeline templates for other tenants to discover or import.
- **Saga/compensation pattern**: Failed executions are marked `failed` and must be re-triggered manually. There is no automatic rollback or compensation for steps already completed in a failed execution.
- **External webhook triggers**: Trigger types are limited to corpus-change, manual, and schedule. Accepting inbound HTTP webhooks as triggers (e.g., from a GitHub push event or a Zapier integration) is out of scope.
- **Rate limiting on manual triggers**: Manual triggers are accepted without rate limiting in this version. Rate limiting is a future operational concern.
- **Audit log for pipeline CRUD operations**: Pipeline create, update, and delete operations are not written to a structured audit log in this spec. Spec 007 (Governance) may introduce a unified audit log that pipeline operations emit to; this integration is deferred.
