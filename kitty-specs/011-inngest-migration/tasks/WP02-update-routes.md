---
work_package_id: WP02
title: Update Routes to inngest.send()
lane: "done"
dependencies: []
subtasks: [T005, T006, T007, T008]
phase: Phase B - Routes
assignee: ''
agent: "claude-sonnet"
shell_pid: "54258"
review_status: "approved"
reviewed_by: "Alex Urevick-Ackelsberg"
history:
- timestamp: '2026-03-19T00:00:00Z'
  lane: planned
  agent: system
  action: Prompt generated via /spec-kitty.tasks
---

# WP02: Update Routes to inngest.send()

## Objective

Replace the `EventBus` dependency in `pipelines/routes.ts` with direct `inngest.send()` dispatch. The manual pipeline trigger route currently calls `eventBus.publish()` to enqueue execution. After this WP, it calls `inngest.send()` instead. Route response contracts remain unchanged.

## Implementation Command

```bash
spec-kitty implement WP02 --base WP01
```

## Context

`src/pipelines/routes.ts` exports a `createPipelineRouter(deps)` factory. The `deps` interface (`PipelineRouterDeps`) currently includes:

```typescript
export interface PipelineRouterDeps {
  db: NodePgDatabase;
  stepRegistry: StepRegistry;
  decisionRecorder: DecisionRecorder;
  eventBus: EventBus;           // ← remove this
}
```

The `eventBus` is used in exactly one place: the manual pipeline trigger route, which calls `eventBus.publish(eventType, payload)` to kick off execution. This call becomes `inngest.send({ name: eventType, data: payload })`.

**Key constraint**: Route response shapes must not change. The caller receives the same JSON regardless of whether dispatch uses the old event bus or Inngest.

## Subtasks

### T005: Remove `EventBus` from `PipelineRouterDeps`

**File**: `src/pipelines/routes.ts`

**Purpose**: Clean up the interface to remove the now-unused `eventBus` dependency.

**Steps**:
1. Remove `import type { EventBus } from './event-bus/interface.js'` from the import block
2. Remove `eventBus: EventBus` from the `PipelineRouterDeps` interface
3. Remove `eventBus` from the destructuring of `deps` in `createPipelineRouter`

Do **not** remove the `eventBus` parameter from call sites yet — that happens in T006/T007 or after WP03 cleans up `init.ts`. Focus only on the interface and internal usage here.

**Validation**:
- [ ] `PipelineRouterDeps` no longer has `eventBus` field
- [ ] No remaining reference to `EventBus` type in `routes.ts`

---

### T006: Replace `eventBus.publish()` with `inngest.send()`

**File**: `src/pipelines/routes.ts`

**Purpose**: The manual trigger route dispatches pipeline execution by publishing to the event bus. Replace with `inngest.send()`.

**Steps**:
1. Find the manual trigger handler (grep for `eventBus.publish` — it appears once at line ~450)
2. The current call looks like:
   ```typescript
   const eventId = await eventBus.publish(
     'pipeline/corpus.changed',
     { tenantId, corpusId, changeType }
   );
   ```
3. Replace with:
   ```typescript
   await inngest.send({
     name: 'pipeline/corpus.changed',
     data: { tenantId, corpusId: payload.corpusId, changeType: payload.changeType },
   });
   const eventId = createId(); // generate a local event reference id
   ```
4. The route response that returns `eventId` should still return a string id — generate it with `createId()` from `@paralleldrive/cuid2` (already imported in the file).

**Validation**:
- [ ] No remaining `eventBus.publish` call in `routes.ts`
- [ ] `inngest.send()` called with correct event name and typed payload
- [ ] Route response shape unchanged (still returns `{ eventId }` or equivalent)

---

### T007: Update imports in `routes.ts`

**File**: `src/pipelines/routes.ts`

**Purpose**: Add `inngest` client import; confirm all removed imports are gone.

**Steps**:
1. Add `import { inngest } from '../inngest/client.js';`
2. Verify `EventBus` import line is removed (done in T005)
3. Confirm `createId` is already imported (it is — used elsewhere in the file)

**Validation**:
- [ ] `inngest` imported from correct path
- [ ] No dangling `EventBus` or `event-bus` imports

---

### T008: Update route tests

**File**: Whichever test file covers `routes.ts` (grep for `createPipelineRouter` in `tests/`)

**Purpose**: Remove `eventBus` mock from test setup since it's no longer a dependency.

**Steps**:
1. Find the test file(s) that construct `PipelineRouterDeps` with an `eventBus` mock
2. Remove the `eventBus` mock and the `eventBus` field from deps objects
3. For tests that assert `eventBus.publish` was called, replace with an assertion that the mock `inngest` client's `send` was called:
   ```typescript
   // Mock inngest at the top of the test file
   vi.mock('../../src/inngest/client.js', () => ({
     inngest: { send: vi.fn().mockResolvedValue(undefined) },
   }));

   // In the test assertion
   const { inngest } = await import('../../src/inngest/client.js');
   expect(inngest.send).toHaveBeenCalledWith(expect.objectContaining({
     name: 'pipeline/corpus.changed',
   }));
   ```
4. Run vitest — all existing route tests must pass

**Validation**:
- [ ] No `eventBus` in any test deps object
- [ ] `inngest.send` mock in place where pipeline dispatch is tested
- [ ] `npx vitest run` passes for route tests

## Definition of Done

- [ ] `PipelineRouterDeps` has no `eventBus` field
- [ ] Manual trigger route calls `inngest.send()` instead of `eventBus.publish()`
- [ ] Route response contracts unchanged
- [ ] Route tests updated and passing
- [ ] `npx tsc --noEmit` passes
- [ ] `npx vitest run` passes

## Risks

- **`init.ts` still passes `eventBus` to `createPipelineRouter`**: This will cause a TypeScript error after T005. That's expected — `init.ts` is deleted in WP03. For now, add a `// @ts-ignore` or remove the `eventBus` from the `init.ts` call site in this WP to keep compilation clean. Coordinate with WP03 agent.
- **Other routes using `eventBus`**: Double-check that `eventBus` is used only in the manual trigger route. If found elsewhere, apply the same replacement pattern.

## Reviewer Guidance

1. Verify the `inngest.send()` payload matches the `PipelineEvents['pipeline/corpus.changed']` type in `inngest/client.ts` — TypeScript should enforce this, but confirm no `as any` casts were added.
2. Confirm the route response body is byte-for-byte identical before and after (same JSON key names, same types).
3. Check that `eventBus` does not appear anywhere in `routes.ts` after this WP.

## Activity Log

- 2026-03-19T13:52:51Z – claude-sonnet – shell_pid=50072 – lane=doing – Started implementation via workflow command
- 2026-03-19T13:57:30Z – claude-sonnet – shell_pid=50072 – lane=for_review – Ready for review: EventBus removed from PipelineRouterDeps; inngest.send() with pipeline/manual.triggered event; route response shape unchanged; tests updated; tsc 0 errors; vitest 372/372
- 2026-03-19T13:57:35Z – claude-sonnet – shell_pid=54258 – lane=doing – Started review via workflow command
- 2026-03-19T13:58:12Z – claude-sonnet – shell_pid=54258 – lane=done – Review passed: no eventBus in routes.ts; inngest.send typed via PipelineEvents; response shape unchanged; no as-any/ts-ignore; tsc 0 errors; vitest 372/372
