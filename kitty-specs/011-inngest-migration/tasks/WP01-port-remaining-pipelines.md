---
work_package_id: "WP01"
title: "Port Remaining Pipeline Functions"
lane: "done"
dependencies: []
subtasks: ["T001", "T002", "T003", "T004"]
phase: "Phase A - Port"
assignee: ""
agent: "claude-sonnet"
shell_pid: "47229"
review_status: "approved"
reviewed_by: "Alex Urevick-Ackelsberg"
history:
  - timestamp: "2026-03-19T00:00:00Z"
    lane: "planned"
    agent: "system"
    action: "Prompt generated via /spec-kitty.tasks"
---

# WP01: Port Remaining Pipeline Functions

## Objective

Create Inngest function factories for the two remaining pipeline templates (`content-audit` and `regulatory-change-monitor`). Register them alongside the existing functions. Add unit tests verifying both stub and handler execution paths, including review gate pause/resume behaviour.

## Implementation Command

```bash
spec-kitty implement WP01
```

## Context

The following are already on `main` from Feature 010 and must NOT be re-implemented:

- `src/inngest/client.ts` — Inngest v3 client with typed `PipelineEvents`
- `src/inngest/adapter.ts` — `InngestStepHandlerAdapter` / `createInngestAdapter`
- `src/inngest/functions/corpus-update-pipeline.ts` — reference implementation
- `src/inngest/functions/schedule-tick-pipeline.ts` — cron reference
- `src/inngest/index.ts` — exports `allFunctions` array and `inngest` client

**Pattern to follow**: `corpus-update-pipeline.ts` is the authoritative reference. Both new functions follow the same factory pattern: `createXxxPipeline(registry: StepHandlerRegistry) → Inngest function`.

## Pipeline Specs

### content-audit-pipeline

Trigger: `pipeline/schedule.tick` event (fired by `schedule-tick-pipeline` cron)
Steps (in order):
1. `fidelity_check` — check profile quality against threshold
2. `content_generation` — generate audit digest
3. `review_gate` — pause and wait for human approval (timeout: 72h per template)
4. `notification` — notify content team

Concurrency key: `event.data.tenantId`, limit 1
Event type to trigger on: `pipeline/schedule.tick`

### regulatory-change-monitor-pipeline

Trigger: `pipeline/schedule.tick` event
Steps (in order):
1. `source_query` — query regulatory source for updates
2. `content_generation` — generate change summary
3. `review_gate` — pause and wait for human approval (timeout: 48h per template)
4. `notification` — notify stakeholders

Concurrency key: `event.data.tenantId`, limit 1

### Review gate pattern

Both pipelines include a review gate. Implement it using `step.waitForEvent()` as established in Feature 010 WP03:

```typescript
const reviewResult = await step.waitForEvent('wait-for-review', {
  event: 'pipeline/review.decided',
  timeout: '72h',  // or '48h' for regulatory
  if: `async.data.executionId == '${executionId}'`,
});

if (!reviewResult || reviewResult.data.decision === 'rejected') {
  return { status: 'rejected', executionId };
}
```

After approval, run the `notification` step.

## Subtasks

### T001: Create `content-audit-pipeline.ts`

**File**: `src/inngest/functions/content-audit-pipeline.ts`

**Purpose**: Inngest function factory for the scheduled content audit pipeline.

**Steps**:
1. Copy the header/factory pattern from `corpus-update-pipeline.ts`
2. Function id: `'content-audit-pipeline'`, name: `'Content Audit Pipeline'`
3. Trigger on `{ event: 'pipeline/schedule.tick' }` (not a cron — the schedule-tick-pipeline fires this event)
4. Concurrency: `{ key: 'event.data.tenantId', limit: 1 }`
5. Generate `executionId` with `createId()` from `@paralleldrive/cuid2`
6. Build `baseContext` from `event.data.tenantId`
7. Run steps in order: fidelity_check → content_generation → (review gate) → notification
8. Each step uses `createInngestAdapter(handler).run(step, stepName, config, context)` or stub if handler missing
9. After review gate: if approved run notification step; if rejected/timeout return early
10. Return `{ status: 'completed'|'rejected'|'timed_out', executionId, steps: {...} }`

**Step configs** (mirror template definitions):
```typescript
// fidelity_check
{ type: 'fidelity_check', thresholds: { minScore: 0.8 } }

// content_generation (audit digest)
{ type: 'content_generation', prompt: 'Produce a concise audit digest...' }

// notification
{ type: 'notification', channel: 'email', message: 'Content audit complete...' }
```

**Validation**:
- [ ] Function id is `'content-audit-pipeline'`
- [ ] Triggers on `pipeline/schedule.tick`
- [ ] Concurrency key is `event.data.tenantId`
- [ ] Review gate uses `step.waitForEvent` with 72h timeout
- [ ] Returns `{ status, executionId, steps }` shape

---

### T002: Create `regulatory-change-monitor-pipeline.ts`

**File**: `src/inngest/functions/regulatory-change-monitor-pipeline.ts`

**Purpose**: Inngest function factory for the scheduled regulatory change monitoring pipeline.

**Steps**: Same factory pattern as T001.
1. Function id: `'regulatory-change-monitor-pipeline'`, name: `'Regulatory Change Monitor Pipeline'`
2. Trigger on `{ event: 'pipeline/schedule.tick' }`
3. Concurrency: `{ key: 'event.data.tenantId', limit: 1 }`
4. Steps: source_query → content_generation → (review gate 48h) → notification
5. Review gate timeout: `'48h'`

**Step configs**:
```typescript
// source_query
{ type: 'source_query', query: 'recent regulatory changes', sourceIds: [], maxResults: 20 }

// content_generation (change summary)
{ type: 'content_generation', prompt: 'Summarise the most significant regulatory changes...' }

// notification
{ type: 'notification', channel: 'email', message: 'Regulatory change summary is ready...' }
```

**Validation**: Same checklist as T001, with `'regulatory-change-monitor-pipeline'` id and 48h timeout.

---

### T003: Register new functions in `inngest/index.ts`

**File**: `src/inngest/index.ts`

**Purpose**: Add both new factory functions to the `allFunctions` export so they are registered with `serve()`.

**Steps**:
1. Import `createContentAuditPipeline` from `./functions/content-audit-pipeline.js`
2. Import `createRegulatoryChangeMonitorPipeline` from `./functions/regulatory-change-monitor-pipeline.js`
3. The `allFunctions` array is assembled with a `registry` (or similar). Add both factories alongside `createCorpusUpdatePipeline` and `createScheduleTickPipeline`
4. Check that `serve({ client: inngest, functions: allFunctions })` in `src/index.ts` picks them up automatically (no change needed there if `allFunctions` is already spread)

**Validation**:
- [ ] Both new factories imported
- [ ] Both appear in `allFunctions` array
- [ ] `tsc --noEmit` passes on `src/inngest/index.ts`

---

### T004: Unit tests for both new pipeline functions

**File**: `src/inngest/functions/content-audit-pipeline.test.ts` and `regulatory-change-monitor-pipeline.test.ts` (or extend `adapter.test.ts`)

**Purpose**: Verify function definition, stub path, handler path, and review gate branches.

**Test cases to cover** (per function):

1. **Can be created without throwing**
   ```typescript
   expect(() => createContentAuditPipeline(makeRegistry())).not.toThrow();
   ```

2. **Returns correct function id and concurrency config**
   ```typescript
   const fn = createContentAuditPipeline(makeRegistry()) as { opts?: { concurrency?: {...} } };
   expect(fn.opts?.concurrency?.key).toBe('event.data.tenantId');
   expect(fn.opts?.concurrency?.limit).toBe(1);
   ```

3. **Stub path (no handlers): all steps return isNoOp: true**

4. **Handler path: steps called with correct config and context**

5. **Review gate — approved: notification step executes**
   Mock `step.waitForEvent` to return `{ data: { decision: 'approved' } }`.
   Assert notification handler was called.

6. **Review gate — rejected: returns `status: 'rejected'` without running notification**
   Mock `step.waitForEvent` to return `{ data: { decision: 'rejected' } }`.
   Assert notification handler NOT called.

7. **Review gate — timeout (null result): returns `status: 'timed_out'`**
   Mock `step.waitForEvent` to return `null`.

**Helpers**: Reuse `makeRegistry`, `makeStep`, `makeHandler` from `adapter.test.ts` (or copy the pattern).

**Validation**:
- [ ] All 7 test cases exist per function
- [ ] `npx vitest run` passes with no failures

## Definition of Done

- [ ] `src/inngest/functions/content-audit-pipeline.ts` exists and compiles
- [ ] `src/inngest/functions/regulatory-change-monitor-pipeline.ts` exists and compiles
- [ ] Both functions registered in `src/inngest/index.ts`
- [ ] Unit tests written and passing
- [ ] `npx tsc --noEmit` passes
- [ ] `npx vitest run` passes

## Risks

- **`pipeline/schedule.tick` event type**: Confirm this event type is in `PipelineEvents` in `inngest/client.ts`. If not, add it.
- **`step.waitForEvent` typing**: The `InngestStep` interface in `adapter.ts` intentionally excludes `waitForEvent` (SDK generic incompatibility). Call `step.waitForEvent(...)` directly using the real Inngest `step` type from the function handler parameter — not through the adapter interface.

## Reviewer Guidance

Check that both functions:
1. Follow the exact factory pattern from `corpus-update-pipeline.ts`
2. Have correct concurrency key (`event.data.tenantId`, NOT a static string like `schedule-tick-global`)
3. Review gate uses `step.waitForEvent` with correct timeout strings (`'72h'`/`'48h'`)
4. Tests cover the reject and timeout branches (easy to miss)

## Activity Log

- 2026-03-19T13:20:06Z – claude-sonnet – shell_pid=24254 – lane=doing – Started implementation via workflow command
- 2026-03-19T13:47:13Z – claude-sonnet – shell_pid=24254 – lane=for_review – Ready for review: content-audit + regulatory-change-monitor pipelines ported; 22 new tests (approve/reject/timeout branches); tsc 0 errors; vitest 372/372 passing
- 2026-03-19T13:50:23Z – claude-sonnet – shell_pid=47229 – lane=doing – Started review via workflow command
- 2026-03-19T13:51:02Z – claude-sonnet – shell_pid=47229 – lane=done – Review passed: both pipelines follow corpus-update-pipeline pattern exactly; content-audit 72h / regulatory-change-monitor 48h timeouts correct; all 3 gate branches (approved/rejected/timed_out) tested; concurrency key event.data.tenantId on both; tsc 0 errors; vitest 372/372
