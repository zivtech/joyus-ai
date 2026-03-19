# Spec 010: Inngest Evaluation Spike

## Overview

Feature 009 ships a custom pipeline execution engine (~3,000 LOC of generic plumbing: event bus, executor, retry/backoff, idempotency, cron scheduling, review-gate pause/resume, execution state management). Inngest is an open-source durable workflow platform for TypeScript that provides all of this out of the box.

This spike evaluates whether Inngest can replace the custom execution plumbing while preserving all domain-specific pipeline logic.

**Outcome**: A go/no-go decision with evidence, plus a migration plan if the decision is "go".

---

## Goals

1. Confirm Inngest can run self-hosted alongside the existing Express/MCP server.
2. Validate that domain-specific logic (step handlers, review gates, templates, cycle detection) can be retained as-is.
3. Verify correctness of pause/resume, per-tenant concurrency, and cron scheduling.
4. Measure execution latency impact.
5. Produce a deletion inventory: what lines of Feature 009 can be removed.

---

## Non-Goals

- Full migration to Inngest (this is a spike only).
- Changes to domain logic: step handlers, review decision recording, template store, quality signals, cycle detection, API routes.
- Changes to the database schema (pipelines, pipeline_steps, execution records remain as-is for now).

---

## Proposed Architecture

### What Inngest replaces (~3,000 LOC)

| Component | Feature 009 LOC | Inngest equivalent |
|---|---|---|
| Event bus (PgNotifyBus) | ~250 | Native event system with delivery guarantees |
| Execution engine (executor.ts) | ~270 | Durable function execution with step-level memoization |
| Retry + exponential backoff | ~230 | Built-in per-step retries, `NonRetriableError`, `RetryAfterError` |
| Step runner + idempotency | ~215 | Step-level memoization (inherently idempotent) |
| Cron scheduling | ~220 | Native `cron` trigger (one line of config) |
| Review gate pause/resume plumbing | ~150 | `step.waitForEvent()` with timeout |
| Execution tracking tables | ~300 | Managed by Inngest (traces, metrics, dashboard) |

### What we keep (~2,000 LOC domain logic)

- Step handlers (profile-generation, fidelity-check, content-generation, source-query, notification)
- Review decision schema, recorder, and escalation checker
- Quality signal emitter
- Pipeline templates + template store
- Cycle detection (DFS-based; Inngest does not know pipelines can trigger each other)
- API routes (REST + MCP tools) — simplified
- Zod validation schemas

### Deployment model

Inngest mounts as a single route handler on the existing Express server (`serve()` adapter). Self-hosted option requires Postgres + Redis (Postgres already available); cloud option has no additional infra.

---

## Success Criteria

| Criterion | Pass condition |
|---|---|
| Self-host boots | Inngest server starts, MCP server connects, functions register |
| Pipeline executes | One ported pipeline runs end-to-end via Inngest |
| Review gate works | `step.waitForEvent()` pauses and resumes correctly with existing DecisionRecorder |
| Tenant isolation | Concurrency key `event.data.tenantId` prevents cross-tenant queue contamination |
| Cron fires | Schedule trigger fires on cron, overlap detection confirmed |
| Latency acceptable | Step execution p95 within 2x of custom implementation |
| Deletion inventory complete | Clear list of 009 files/classes deletable post-migration |

---

## Risks

- **Self-hosted maturity**: Inngest cloud is more polished than self-hosted; Redis dependency adds infra.
- **Schema coupling**: Current `pipeline_executions` table is tightly coupled to the custom executor. Migration would need schema reconciliation.
- **Concurrency semantics**: Custom executor uses `skip_if_running` policy stored in DB; Inngest uses virtual queues with concurrency keys — semantics differ slightly.
- **Vendor dependency**: Adopting Inngest adds a runtime dependency on an external project.
- **Decision outcome**: Spike may conclude "keep custom" if self-hosted is too immature or latency is unacceptable.

---

## Checklist

- [x] Feature is platform-generic (no client names, no org-specific terminology)
- [x] No implementation details in spec
- [ ] Plan created
- [ ] Tasks created
