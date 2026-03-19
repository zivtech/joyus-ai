# Research: Inngest Migration

All open questions were resolved by the Feature 010 evaluation spike. This document summarises the findings that directly inform Feature 011 implementation decisions.

---

## Decision: Inngest v3 self-hosted (confirmed viable)

**Rationale**: Docker Compose overlay boots cleanly alongside existing Express/Postgres stack. Three env vars (`INNGEST_BASE_URL`, `INNGEST_EVENT_KEY`, `INNGEST_SIGNING_KEY`) are the only configuration requirement. SDK mounts as a single route handler via `serve()`.

**Evidence**: Feature 010 WP01 (`research/inngest-setup.md`, `deploy/docker-compose.inngest.yml`)

---

## Decision: InngestStepHandlerAdapter pattern (no handler changes required)

**Rationale**: Step handlers (`PipelineStepHandler.execute()`) are fully decoupled from the execution engine. The adapter wraps any handler in `step.run()` without modifying handler logic. Migration is additive — handlers require zero changes.

**Evidence**: Feature 010 WP02 (`src/inngest/adapter.ts`, `src/inngest/adapter.test.ts`)

---

## Decision: step.waitForEvent() replaces review gate plumbing

**Rationale**: `step.waitForEvent('wait-for-review', { event: 'pipeline/review.decided', timeout: '7d', if: ... })` correctly implements pause/resume. `DecisionRecorder.recordDecision()` sends the event via `inngest.send()` with idempotency key `review-decided-{executionId}`.

**Evidence**: Feature 010 WP03 (`src/pipelines/review/decision.ts`, `tests/pipelines/review/gate.test.ts`)

---

## Decision: Concurrency key strategy

- **Event-triggered pipelines**: `concurrency: { key: 'event.data.tenantId', limit: 1 }` — enforces per-tenant serialisation.
- **Cron-triggered pipelines**: `concurrency: { key: '"schedule-tick-global"', limit: 1 }` — static string required (cron events carry no tenantId; using `event.data.tenantId` silently disables enforcement).

**Evidence**: Feature 010 WP04 — T019 test, cron key anomaly fix

---

## Decision: Latency is acceptable

Custom executor p50: 5.34ms (handler work only). Inngest estimated p50 overhead: 10–30ms per checkpoint. For step work of 10–30s (profile generation), overhead is 0.1–0.3% — well within the 2× success criterion.

**Tuning**: Set `INNGEST_POLL_INTERVAL=10` in self-hosted deployment to keep overhead in the 10–20ms range.

**Evidence**: Feature 010 WP05 (`research/performance-comparison.md`)

---

## Alternatives considered

| Alternative | Rejected because |
|-------------|-----------------|
| Inngest Cloud instead of self-hosted | Adds managed infrastructure dependency; self-hosted works and is already validated |
| Parallel operation (run both systems simultaneously) | Adds complexity for no benefit; clean cutover is simpler and lower risk given test coverage |
| Incremental deletion (delete as each pipeline is ported) | More complex to coordinate; single atomic deletion is easier to verify |
