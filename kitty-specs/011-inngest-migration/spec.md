# Spec 011: Inngest Migration

## Overview

Feature 009 ships a custom pipeline execution engine (~3,000 LOC of generic plumbing). Feature 010 confirmed Inngest is a viable replacement, with all success criteria passing. This feature performs the clean cutover: porting all pipeline templates to Inngest functions, updating API routes to dispatch via Inngest, and deleting the custom engine, event bus, and trigger layers (~1,493 LOC).

The foundation is already in place from Feature 010: Inngest client, typed event schemas, `InngestStepHandlerAdapter`, `corpus-update-pipeline`, and `schedule-tick-pipeline` are live on main.

**Outcome**: The custom execution plumbing is removed. All pipelines run durably via Inngest with crash recovery, per-step retries, per-tenant concurrency, and built-in observability.

---

## Goals

1. Port all remaining pipeline templates to Inngest functions.
2. Update API routes to dispatch pipeline execution via `inngest.send()` instead of the custom executor.
3. Delete the custom engine, event bus, trigger, and init layers.
4. Preserve all domain logic unchanged: step handlers, review gates, quality signals, templates, cycle detection, validation.
5. Verify the full pipeline lifecycle (trigger → execute → review gate → resume → complete) works end-to-end under Inngest.

---

## Non-Goals

- Changes to step handler logic (profile-generation, fidelity-check, content-generation, source-query, notification).
- Changes to the review decision schema, recorder, or escalation checker beyond what Feature 010 already introduced.
- Changes to the database schema for pipeline configuration tables.
- Introducing new pipeline types or templates not already defined.
- Migrating to Inngest Cloud (self-hosted deployment only).

---

## Proposed Approach

### What gets ported

Each pipeline template becomes an Inngest function. The three existing templates each map to one function:

| Template | Inngest function |
|----------|-----------------|
| `corpus-update-to-profiles` | `corpus-update-pipeline` (already done in WP02/Feature 010) |
| `content-audit` | `content-audit-pipeline` (new in this feature) |
| `regulatory-change-monitor` | `regulatory-change-monitor-pipeline` (new in this feature) |

The schedule tick pipeline (`createScheduleTickPipeline`) is already in place from Feature 010 WP04.

### What gets deleted

After all pipelines are ported and verified:

- `pipelines/engine/` (executor, step-runner, idempotency, retry) — 655 LOC
- `pipelines/event-bus/` (pg-notify-bus, interface) — 315 LOC
- `pipelines/triggers/` (corpus-change, schedule, manual-request, registry, interface) — 413 LOC
- `pipelines/init.ts` (orchestration wiring) — 110 LOC

**Total: ~1,493 LOC removed**

### Route changes

API routes that currently invoke the custom executor are updated to call `inngest.send()` with the appropriate event type. The route signatures do not change — only the internal dispatch mechanism.

### Cutover strategy

Clean cutover: no parallel operation period. All three pipeline templates are ported before any deletion occurs, so deletion is a single atomic cleanup step.

---

## Success Criteria

1. All three pipeline templates execute end-to-end via Inngest (trigger → steps → completion recorded).
2. The review gate pause/resume cycle completes correctly for pipelines that include a review step.
3. Per-tenant concurrency enforcement prevents overlapping pipeline executions for the same tenant.
4. A pipeline interrupted mid-execution (simulated crash) resumes from the last checkpoint on restart — no re-processing of completed steps.
5. All existing pipeline-related tests pass without modification to test logic.
6. The custom engine, event bus, and trigger layers are fully removed with no remaining imports or dead code.
7. TypeScript compilation passes with zero errors after deletion.

---

## Functional Requirements

### Pipeline Execution

- FR-01: Each pipeline template has a corresponding Inngest function that triggers on the appropriate event type.
- FR-02: All step handlers execute inside `step.run()` checkpoints via the `InngestStepHandlerAdapter`.
- FR-03: Failed steps retry automatically per Inngest's default retry policy. Non-retriable errors are surfaced without retry.
- FR-04: Pipeline executions triggered for the same tenant are serialised (at most one active execution per tenant per pipeline type at a time).

### Review Gate

- FR-05: Pipelines with a review step pause at the gate and wait for a `pipeline/review.decided` event (up to 7 days).
- FR-06: On approval, execution resumes from the checkpoint immediately following the gate.
- FR-07: On rejection or timeout, the pipeline records the outcome and terminates without re-running completed steps.

### Review Notification Delivery (Claude Channels Amendment)

*Source: [joyus-ai-internal Claude Channels Impact Analysis §4.3](https://github.com/zivtech/joyus-ai-internal/blob/main/planning/claude-channels-impact-analysis.md) — Issues: [#32](https://github.com/zivtech/joyus-ai-internal/issues/32), [#34](https://github.com/zivtech/joyus-ai-internal/issues/34)*

- FR-RND-001: The pipeline framework MUST define an explicit `ReviewNotificationDelivery` interface for review gate notifications, replacing the implicit escalation cron:

  ```typescript
  interface ReviewNotificationDelivery {
    /**
     * Called when a pipeline step enters waiting_review status.
     * Delivers the review request to the admin's configured delivery backends.
     */
    notifyReviewPending(params: {
      executionId: string;
      pipelineId: string;
      stepIndex: number;
      tenantId: string;
      artifacts: ReviewArtifact[];
      deadline: Date;
    }): Promise<void>;

    /**
     * Called when escalation threshold is reached.
     */
    notifyReviewEscalated(params: {
      executionId: string;
      tenantId: string;
      escalationLevel: number;
    }): Promise<void>;
  }
  ```

- FR-RND-002: The `ReviewNotificationDelivery` implementation MUST emit events to the Gateway Event Bus (Spec 014 FR-GEB-001): `review.pending` on review pending, `review.escalated` on escalation, `review.decided` on decision. The gateway handles multi-channel delivery; the pipeline framework does not own delivery logic.

- FR-RND-003: Review decisions MUST be accepted via the Gateway Decision Ingestion endpoint (Spec 014 FR-GEB-004). The pipeline framework registers a decision handler with the gateway that: (1) validates the decision against the pending review, (2) records the decision in `review_decisions`, (3) sends `pipeline/review.decided` event via `inngest.send()` to resume the paused function. If a decision comes from a Claude Code Channel, the Channel Server calls the gateway decision endpoint — same path as any other decision source.

- FR-RND-004: When the gateway is not yet deployed, the `ReviewNotificationDelivery` implementation MUST use a `NullDelivery` stub, consistent with the existing `NullServiceClient` pattern throughout the pipeline framework. This ensures the interface is wired at build time without requiring a running gateway.

### API Routes

- FR-08: The manual pipeline trigger route dispatches execution by sending the appropriate typed event via `inngest.send()`.
- FR-09: Route response contracts are unchanged — callers receive the same response shape as before.

### Deletion

- FR-10: After all pipelines are ported and verified, the custom engine, event bus, trigger, and init modules are removed.
- FR-11: No import references to deleted modules remain in the codebase after cleanup.

---

## User Scenarios

### Scenario 1: Corpus update triggers pipeline

1. A corpus change event arrives at the API route.
2. The route sends a `pipeline/corpus.changed` Inngest event.
3. The `corpus-update-pipeline` function runs the profile-generation step, then the fidelity-check step.
4. Both steps complete; the execution is recorded as complete.

### Scenario 2: Pipeline pauses for review

1. A `content-audit-pipeline` run reaches the review gate step.
2. The function pauses at `step.waitForEvent('wait-for-review', ...)`.
3. A reviewer approves via the review API route.
4. `DecisionRecorder` sends the `pipeline/review.decided` event; the function resumes and continues.

### Scenario 3: Server restart mid-pipeline

1. A pipeline is mid-execution (one step complete, second step in progress).
2. The server restarts.
3. Inngest re-invokes the function; the first step's result is replayed from checkpoint and the second step re-executes.
4. No data is re-processed from before the first checkpoint.

### Scenario 4: Tenant concurrency enforcement

1. Tenant A triggers two pipeline runs in quick succession.
2. The first run executes immediately.
3. The second run queues behind the first due to the per-tenant concurrency limit.
4. Once the first run completes, the second run executes.

---

## Key Entities

- **Inngest function** — durable function definition triggered by an event or cron schedule
- **Pipeline template** — JSON definition of pipeline steps and their types
- **Step handler** — domain logic unit implementing `PipelineStepHandler.execute()`
- **InngestStepHandlerAdapter** — shim wrapping step handler execution inside `step.run()`
- **PipelineEvents** — typed event schema for `pipeline/corpus.changed`, `pipeline/review.decided`, `pipeline/schedule.tick`
- **DecisionRecorder** — records reviewer decisions and dispatches `pipeline/review.decided`

---

## Dependencies

- **Feature 010** (complete): Inngest client, adapter, `corpus-update-pipeline`, `schedule-tick-pipeline`, `DecisionRecorder.inngest.send()` already on main.
- **Feature 009** (complete): Step handlers, review gate, templates, graph, analytics — all retained unchanged.

---

## Risks

| Risk | Severity | Mitigation |
|------|----------|------------|
| Missed import references after deletion | Medium | TypeScript compilation check as acceptance gate |
| Test fixtures coupled to custom executor internals | Low | Audit test files before deletion; update fixtures not logic |
| Redis polling latency in CI | Low | Tests use mocked step execution; no live Inngest server required |

---

## Assumptions

- Inngest self-hosted deployment (Docker Compose overlay from Feature 010 WP01) is the production target.
- `INNGEST_POLL_INTERVAL=10` is set in the self-hosted deployment config (per Feature 010 WP05 recommendation).
- The three existing pipeline templates represent the complete set requiring migration. New templates are out of scope.
- The `corpus-update-pipeline` Inngest function from Feature 010 is the authoritative implementation and is not re-implemented.

---

## Adoption Plan

This feature replaces internal infrastructure — no end-user-facing changes. Adoption is complete when the custom engine is deleted and CI passes. Required runbook updates:

- Add `INNGEST_POLL_INTERVAL=10` to deployment environment documentation.
- Note the Inngest re-registration window (1–5s) in the deploy runbook.
- Update observability runbook to reference the Inngest dashboard instead of custom execution tracking routes.

## ROI Metrics

- **LOC removed**: ~1,493 (target: ≥1,400)
- **Test suite runtime**: no regression (target: ±10% of pre-migration baseline)
- **Pipeline crash recovery**: zero data re-processing incidents in first 30 days post-migration
- **Owner**: platform team
- **Review cadence**: weekly for 4 weeks post-migration, then monthly

## Security + MCP Governance

- No new authentication surfaces introduced.
- `INNGEST_EVENT_KEY` and `INNGEST_SIGNING_KEY` remain environment variable–only secrets; never committed.
- Inngest signing key validates that only the authorised server can trigger functions.
- MCP tools that dispatch pipeline execution continue to route through the API layer; no direct Inngest access from MCP tool handlers.
- Approval required: platform team lead sign-off before the deletion step (FR-10) is merged.
- Audit trail: deletion commit referenced in feature changelog.

## Amendments

### Claude Channels: Review Notification Delivery (2026-03-31)

*Source: [joyus-ai-internal Claude Channels Impact Analysis §4.3](https://github.com/zivtech/joyus-ai-internal/blob/main/planning/claude-channels-impact-analysis.md)*

The following scope additions apply to the Inngest migration WPs:

1. Extract the escalation cron's notification logic into a `ReviewNotificationDelivery` implementation (FR-RND-001).
2. Wire the implementation to the Gateway Event Bus, or a `NullDelivery` stub if the gateway isn't deployed yet (FR-RND-002, FR-RND-004).
3. Add `review.pending` and `review.escalated` event types to the Inngest function's observable events.
4. Ensure `inngest.send()` for `pipeline/review.decided` works when called from the gateway decision handler, not just the direct API route (FR-RND-003).

**Tracking**: joyus-ai-internal issues [#32](https://github.com/zivtech/joyus-ai-internal/issues/32) (gateway event bus), [#34](https://github.com/zivtech/joyus-ai-internal/issues/34) (review gate delivery).
