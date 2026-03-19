# Work Packages: Inngest Evaluation Spike
*Feature 010 — Task decomposition*

**Total**: 6 work packages, 30 subtasks
**Parallelization**: 4 layers — WP03 and WP04 can run concurrently

## Dependency Graph

```
Layer 0: WP01 (environment setup)
Layer 1: WP02 (pipeline port — depends on WP01)
Layer 2: WP03, WP04 (parallel — both depend on WP02)
Layer 3: WP05 (perf — depends on WP02-WP04)
Layer 4: WP06 (decision — depends on all)
```

---

## Phase A: Environment

### WP01 — Local Inngest Server Setup
**Prompt**: [`tasks/WP01-environment-setup.md`](tasks/WP01-environment-setup.md)
**Priority**: P0 (blocks everything) | **Dependencies**: none | **Est. ~200 lines**

**Subtasks**:
- [ ] T001: Add `inngest` npm package to `joyus-ai-mcp-server`
- [ ] T002: Create `docker-compose.inngest.yml` (Inngest server + Redis) using existing Postgres
- [ ] T003: Create `src/inngest/client.ts` — Inngest client configured for self-hosted server
- [ ] T004: Register stub Inngest function in Express server (`serve()` adapter at `/api/inngest`)
- [ ] T005: Verify Inngest dev UI shows registered function, dev server connects

---

## Phase B: Core Validation

### WP02 — Port One Pipeline to Inngest Functions
**Prompt**: [`tasks/WP02-pipeline-port.md`](tasks/WP02-pipeline-port.md)
**Priority**: P1 | **Dependencies**: WP01 | **Est. ~300 lines**

**Subtasks**:
- [ ] T006: Define `InngestStepHandlerAdapter` — wraps existing `PipelineStepHandler` interface for use with `step.run()`
- [ ] T007: Port corpus-update-to-profiles pipeline as Inngest function (`src/inngest/functions/corpus-update-pipeline.ts`)
- [ ] T008: Wire corpus_change event → Inngest function trigger (event name: `pipeline/corpus.changed`)
- [ ] T009: Run end-to-end execution via Inngest UI, confirm step traces appear
- [ ] T010: Write unit tests for adapter and function structure

### WP03 — Review Gate via step.waitForEvent()
**Prompt**: [`tasks/WP03-review-gate.md`](tasks/WP03-review-gate.md)
**Priority**: P1 | **Dependencies**: WP02 | **Est. ~250 lines**

**Subtasks**:
- [ ] T011: Implement review gate step using `step.waitForEvent('pipeline/review.decided', { timeout: '7d' })`
- [ ] T012: Update `DecisionRecorder` to send Inngest event after recording decision
- [ ] T013: Test approve path — execution resumes with approved artifacts
- [ ] T014: Test reject path — execution receives rejection feedback, records failure
- [ ] T015: Test timeout path — execution escalates after 7-day timeout

### WP04 — Per-Tenant Concurrency and Cron Scheduling
**Prompt**: [`tasks/WP04-concurrency-cron.md`](tasks/WP04-concurrency-cron.md)
**Priority**: P1 | **Dependencies**: WP02 | **Est. ~200 lines**

**Subtasks**:
- [ ] T016: Add `concurrency: { key: 'event.data.tenantId', limit: 1 }` to pipeline function
- [ ] T017: Test cross-tenant isolation — two tenants trigger simultaneously, no contamination
- [ ] T018: Implement schedule_tick pipeline as Inngest cron function
- [ ] T019: Confirm overlap detection — concurrent cron runs blocked by concurrency key
- [ ] T020: Confirm timezone support for schedule configurations

---

## Phase C: Assessment

### WP05 — Performance Comparison
**Prompt**: [`tasks/WP05-performance-comparison.md`](tasks/WP05-performance-comparison.md)
**Priority**: P2 | **Dependencies**: WP02, WP03, WP04 | **Est. ~150 lines**

**Subtasks**:
- [ ] T021: Benchmark custom executor — 50 sequential executions, record p50/p95/p99 step latency
- [ ] T022: Benchmark Inngest — same 50 sequential executions, same metrics
- [ ] T023: Measure cold-start time for both (first execution after server restart)
- [ ] T024: Document results in `research/performance-comparison.md`
- [ ] T025: Flag any latency anomalies (self-hosted Redis overhead, polling intervals)

### WP06 — Decision Document and Migration Plan
**Prompt**: [`tasks/WP06-decision-doc.md`](tasks/WP06-decision-doc.md)
**Priority**: P2 | **Dependencies**: WP01-WP05 | **Est. ~200 lines**

**Subtasks**:
- [ ] T026: Summarize spike findings across all WPs (environment, correctness, performance)
- [ ] T027: Score against success criteria matrix from spec
- [ ] T028: Write go/no-go recommendation with rationale
- [ ] T029: If "go": produce deletion inventory (009 files/LOC removable), migration sequence, Feature 011 scope estimate
- [ ] T030: If "no-go": document blockers and recommended fixes for custom implementation
