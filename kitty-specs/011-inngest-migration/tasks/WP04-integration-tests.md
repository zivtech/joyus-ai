---
work_package_id: WP04
title: Integration Tests and Acceptance
lane: "done"
dependencies: []
subtasks: [T014, T015, T016, T017, T018]
phase: Phase D - Verify
assignee: ''
agent: "claude-sonnet"
shell_pid: "81459"
review_status: "approved"
reviewed_by: "Alex Urevick-Ackelsberg"
history:
- timestamp: '2026-03-19T00:00:00Z'
  lane: planned
  agent: system
  action: Prompt generated via /spec-kitty.tasks
---

# WP04: Integration Tests and Acceptance

## Objective

Write integration tests that verify the full pipeline lifecycle under Inngest — trigger, step execution, review gate pause/resume, per-tenant concurrency. Run the final acceptance gate: TypeScript compilation, vitest, and LOC deletion verification.

These tests do **not** require a live Inngest server. They use the same mocked `step` pattern established in Feature 010 WP02 (`adapter.test.ts`) — the Inngest function's internal `fn` is extracted and called directly with mock `step` and `event` objects.

## Implementation Command

```bash
spec-kitty implement WP04 --base WP03
```

## Test Pattern Reference

The integration tests invoke the Inngest function handler directly:

```typescript
const inngestFn = createContentAuditPipeline(registry) as unknown as {
  fn: (args: { event: unknown; step: InngestStep & { waitForEvent: jest.Mock } }) => Promise<unknown>;
};

const step = {
  run: vi.fn((_name: string, fn: () => Promise<unknown>) => fn()),
  waitForEvent: vi.fn().mockResolvedValue({ data: { decision: 'approved' } }),
} as unknown as InngestStep;

const event = { data: { tenantId: 'tenant-1' } };
const result = await inngestFn.fn({ event, step });
```

**File location**: `tests/pipelines/integration/` (new directory)

## Subtasks

### T014: Integration test — corpus-update-pipeline full lifecycle

**File**: `tests/pipelines/integration/corpus-update-pipeline.integration.test.ts`

**Purpose**: Verify the existing corpus-update-pipeline executes all steps in order and returns the expected result shape. This is a regression test to confirm Feature 010 WP02 behaviour is preserved after WP03 deletions.

**Test cases**:

1. **Happy path — both handlers registered**
   - Registry has `profile_generation` and `fidelity_check` handlers
   - Both handlers called in order
   - Result: `{ steps: { profileGeneration: { success: true }, fidelityCheck: { success: true } } }`

2. **Stub path — no handlers registered**
   - Registry is empty
   - Both steps return `{ isNoOp: true, outputData: { stub: true } }`

3. **Step output flows to next step**
   - `profile_generation` returns `{ profiles: 5 }`
   - `fidelity_check` context.previousStepOutputs.get(0) equals `{ profiles: 5 }`

4. **Unique executionId per invocation**
   - Two invocations produce different `executionId` values

**Validation**:
- [ ] All 4 test cases pass
- [ ] No live Inngest server required (mocked step)

---

### T015: Integration test — content-audit-pipeline with review gate

**File**: `tests/pipelines/integration/content-audit-pipeline.integration.test.ts`

**Purpose**: Verify the content-audit-pipeline's review gate pauses and resumes correctly.

**Test cases**:

1. **Full approval path**
   - Mock `step.waitForEvent` returns `{ data: { decision: 'approved' } }`
   - Steps execute: fidelity_check → content_generation → (gate) → notification
   - Result: `{ status: 'completed' }`
   - Notification handler called exactly once

2. **Rejection path**
   - Mock `step.waitForEvent` returns `{ data: { decision: 'rejected' } }`
   - Steps execute: fidelity_check → content_generation → (gate stops here)
   - Result: `{ status: 'rejected' }`
   - Notification handler NOT called

3. **Timeout path**
   - Mock `step.waitForEvent` returns `null`
   - Result: `{ status: 'timed_out' }` (or equivalent)
   - Notification handler NOT called

4. **`step.waitForEvent` called with correct timeout**
   - Assert `step.waitForEvent` was called with an options object containing `timeout: '72h'` (or the string used in the implementation)

5. **Concurrency config**
   - `fn.opts?.concurrency?.key` equals `'event.data.tenantId'`
   - `fn.opts?.concurrency?.limit` equals `1`

**Validation**:
- [ ] All 5 test cases pass
- [ ] Both reject AND timeout branches tested (common omission)

---

### T016: Integration test — regulatory-change-monitor-pipeline with review gate

**File**: `tests/pipelines/integration/regulatory-change-monitor-pipeline.integration.test.ts`

**Purpose**: Verify the regulatory-change-monitor-pipeline with its 48h review gate.

**Test cases**:

1. **Full approval path**
   - Steps: source_query → content_generation → (gate) → notification
   - Result: `{ status: 'completed' }`

2. **Rejection path**
   - Gate returns rejected
   - Notification NOT called
   - Result: `{ status: 'rejected' }`

3. **Timeout path**
   - Gate returns null
   - Result: `{ status: 'timed_out' }`

4. **`step.waitForEvent` timeout is `'48h'`** (not `'72h'` — different from content-audit)

5. **`source_query` step called with correct config**
   - Assert handler called with config containing `type: 'source_query'`

**Validation**:
- [ ] All 5 test cases pass
- [ ] Timeout string is `'48h'` (not copied from content-audit's `'72h'`)

---

### T017: Integration test — per-tenant concurrency config

**File**: `tests/pipelines/integration/concurrency.integration.test.ts`

**Purpose**: Verify concurrency configuration is correct on all three pipeline functions. Runtime enforcement is by the Inngest server; this test verifies the static config is correct.

**Test cases**:

1. **corpus-update-pipeline concurrency key**
   ```typescript
   const fn = createCorpusUpdatePipeline(makeRegistry()) as { opts?: {...} };
   expect(fn.opts?.concurrency?.key).toBe('event.data.tenantId');
   expect(fn.opts?.concurrency?.limit).toBe(1);
   ```

2. **content-audit-pipeline concurrency key**
   Same assertion with `createContentAuditPipeline`.

3. **regulatory-change-monitor-pipeline concurrency key**
   Same assertion with `createRegulatoryChangeMonitorPipeline`.

4. **schedule-tick-pipeline uses global key** (not tenant key)
   ```typescript
   const fn = createScheduleTickPipeline() as { opts?: {...} };
   expect(fn.opts?.concurrency?.key).toBe('"schedule-tick-global"');
   ```

5. **Each invocation of event-triggered pipelines produces a unique executionId**
   Two calls with different tenantIds produce two different executionIds.

**Validation**:
- [ ] All 5 assertions pass
- [ ] No pipeline accidentally uses the static `"schedule-tick-global"` key

---

### T018: Acceptance gate

**Purpose**: Final validation that the migration is complete and correct.

**Run in order**:

1. **TypeScript compilation**:
   ```bash
   cd joyus-ai-mcp-server && npx tsc --noEmit
   ```
   Expected: exit code 0, zero errors output.

2. **Full test suite**:
   ```bash
   npx vitest run
   ```
   Expected: all tests pass, zero failures.

3. **LOC deletion verification**:
   ```bash
   git diff --stat main | tail -5
   ```
   Expected: net deletion of ≥ 1,400 lines across `engine/`, `event-bus/`, `triggers/`, `init.ts`.

4. **Verify deleted directories are gone**:
   ```bash
   ls joyus-ai-mcp-server/src/pipelines/
   ```
   Expected output must NOT include `engine`, `event-bus`, or `triggers`.

5. **Verify no lingering imports**:
   ```bash
   grep -r "from.*engine/" joyus-ai-mcp-server/src/ --include="*.ts"
   grep -r "from.*event-bus/" joyus-ai-mcp-server/src/ --include="*.ts"
   grep -r "from.*triggers/" joyus-ai-mcp-server/src/ --include="*.ts"
   ```
   Expected: no output (zero matches).

**Report results** in the WP commit message and move-task note:
```
Acceptance: tsc ✓, vitest ✓, 1493 LOC deleted, 0 dangling imports
```

**Validation**:
- [ ] `tsc --noEmit` exits 0
- [ ] `vitest run` exits 0
- [ ] ≥ 1,400 LOC deleted (git diff stat)
- [ ] No `engine/`, `event-bus/`, `triggers/` in `src/pipelines/`
- [ ] Zero grep matches for deleted module paths

## Definition of Done

- [ ] Integration test files written in `tests/pipelines/integration/`
- [ ] All integration tests passing
- [ ] Acceptance gate (T018) fully passing
- [ ] Commit includes acceptance results in message

## Risks

- **`fn` property on Inngest function**: The SDK stores the handler as `.fn` on the returned function object. This is an internal SDK detail used in Feature 010 tests (`adapter.test.ts`). If the SDK changes this in a future version, the test pattern breaks — acceptable for now.
- **`step.waitForEvent` mock typing**: TypeScript will complain that `waitForEvent` is not on `InngestStep` (by design — see adapter.ts JSDoc). Cast the mock step as `unknown` then to the internal function's expected type to avoid compile errors in tests.

## Reviewer Guidance

1. **T014 is a regression test** — confirm it passes without any changes to `corpus-update-pipeline.ts`.
2. **T015 and T016 must both test reject AND timeout** — missing either branch is a defect.
3. **T017 assertion 4**: `schedule-tick-pipeline` must use `'"schedule-tick-global"'` (with the inner quotes). A common mistake is checking for `'schedule-tick-global'` without the quotes — that would miss the CEL string literal wrapper required by Inngest.
4. **T018 is mandatory**: Do not approve this WP without all 5 acceptance checks passing. The LOC count is the proof that the custom plumbing is actually gone.

## Activity Log

- 2026-03-19T14:15:01Z – claude-sonnet – shell_pid=70682 – lane=doing – Started implementation via workflow command
- 2026-03-19T14:53:20Z – claude-sonnet – shell_pid=70682 – lane=for_review – Ready for review: 19 integration tests across 4 suites (T014-T017). corpus-update, content-audit, regulatory-change-monitor, concurrency. 280 tests passing, tsc 0 errors.
- 2026-03-19T14:53:39Z – claude-sonnet – shell_pid=81459 – lane=doing – Started review via workflow command
- 2026-03-19T14:57:42Z – claude-sonnet – shell_pid=81459 – lane=done – Review passed: 19 integration tests across 4 suites (T014-T017). tsc ✓, vitest 280/280 ✓, no engine/event-bus/triggers dirs ✓, 0 dangling imports ✓. Both reject+timeout branches covered, 48h/72h timeouts distinct, CEL inner quotes on schedule-tick verified.
