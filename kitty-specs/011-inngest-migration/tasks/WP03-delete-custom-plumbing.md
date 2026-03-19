---
work_package_id: WP03
title: Delete Custom Execution Plumbing
lane: "done"
dependencies: []
subtasks: [T009, T010, T011, T012, T013]
phase: Phase C - Delete
assignee: ''
agent: "claude-sonnet"
shell_pid: "65888"
review_status: "approved"
reviewed_by: "Alex Urevick-Ackelsberg"
history:
- timestamp: '2026-03-19T00:00:00Z'
  lane: planned
  agent: system
  action: Prompt generated via /spec-kitty.tasks
---

# WP03: Delete Custom Execution Plumbing

## Objective

Delete the four custom execution modules (~1,493 LOC) that Inngest now replaces: `engine/`, `event-bus/`, `triggers/`, `init.ts`. Fix all resulting import errors. Verify TypeScript compilation passes with zero errors.

This is a deletion-only WP. No new behaviour is introduced. If `tsc --noEmit` passes and all tests pass, the WP is done.

## Implementation Command

```bash
spec-kitty implement WP03 --base WP02
```

## Deletion Inventory

| Path | LOC | Replaced by |
|------|-----|-------------|
| `src/pipelines/engine/executor.ts` | 371 | Inngest durable execution |
| `src/pipelines/engine/step-runner.ts` | 190 | `InngestStepHandlerAdapter` |
| `src/pipelines/engine/idempotency.ts` | 47 | Inngest step memoization |
| `src/pipelines/engine/retry.ts` | 38 | Inngest built-in retries |
| `src/pipelines/engine/index.ts` | 9 | — |
| `src/pipelines/event-bus/pg-notify-bus.ts` | 177 | Inngest event system |
| `src/pipelines/event-bus/interface.ts` | 102 | `PipelineEvents` typed schema |
| `src/pipelines/event-bus/index.ts` | 36 | — |
| `src/pipelines/triggers/schedule.ts` | 220 | `schedule-tick-pipeline` |
| `src/pipelines/triggers/corpus-change.ts` | 73 | `corpus-update-pipeline` trigger |
| `src/pipelines/triggers/manual-request.ts` | 47 | `inngest.send()` in routes |
| `src/pipelines/triggers/interface.ts` | 37 | — |
| `src/pipelines/triggers/registry.ts` | 32 | `allFunctions` array |
| `src/pipelines/triggers/index.ts` | 4 | — |
| `src/pipelines/init.ts` | 110 | `serve()` in `src/index.ts` |
| **Total** | **1,493** | |

## Subtasks

### T009: Delete `src/pipelines/engine/`

**Purpose**: Remove the custom executor, step-runner, idempotency, and retry modules.

**Steps**:
```bash
rm -rf joyus-ai-mcp-server/src/pipelines/engine/
```

Then immediately run:
```bash
npx tsc --noEmit 2>&1 | grep "engine"
```

Note every file that imports from `./engine/` or `../engine/` — these need fixing in T013.

**Expected import sites to fix**:
- `src/pipelines/index.ts` (likely re-exports from engine)
- `src/inngest/functions/corpus-update-pipeline.ts` (imports `StepHandlerRegistry`, `ExecutionContext` from `engine/step-runner`)
- Any test files that import directly from `engine/`

**Note on `corpus-update-pipeline.ts`**: It imports types from `../../pipelines/engine/step-runner.js`. After deletion, update this import to pull `StepHandlerRegistry` and `ExecutionContext` from wherever they're re-exported in `pipelines/index.ts` or `pipelines/types.ts`. If not re-exported there, move the type definitions to `pipelines/types.ts` or `inngest/adapter.ts`.

**Validation**:
- [ ] `src/pipelines/engine/` directory no longer exists
- [ ] All import errors from engine logged for T013

---

### T010: Delete `src/pipelines/event-bus/`

**Purpose**: Remove the PgNotifyBus and EventBus interface.

**Steps**:
```bash
rm -rf joyus-ai-mcp-server/src/pipelines/event-bus/
```

Then:
```bash
npx tsc --noEmit 2>&1 | grep "event-bus"
```

**Expected import sites**: `src/pipelines/routes.ts` import was removed in WP02. Check `src/pipelines/index.ts` and `src/pipelines/init.ts`.

**Validation**:
- [ ] `src/pipelines/event-bus/` directory no longer exists

---

### T011: Delete `src/pipelines/triggers/`

**Purpose**: Remove the custom trigger implementations and registry.

**Steps**:
```bash
rm -rf joyus-ai-mcp-server/src/pipelines/triggers/
```

Then:
```bash
npx tsc --noEmit 2>&1 | grep "triggers"
```

**Expected import sites**: `src/pipelines/init.ts`, `src/pipelines/index.ts`.

**Validation**:
- [ ] `src/pipelines/triggers/` directory no longer exists

---

### T012: Delete `src/pipelines/init.ts`

**Purpose**: Remove the orchestration wiring that initialised the custom engine, event bus, and trigger registry. `serve()` in `src/index.ts` (added in Feature 010 WP01) replaces this.

**Steps**:
```bash
rm joyus-ai-mcp-server/src/pipelines/init.ts
```

Then:
```bash
npx tsc --noEmit 2>&1 | grep "init"
```

**Expected import sites**: `src/index.ts` (check if it still imports `initPipelines` from `./pipelines/init.js`). If so, remove that import and call site.

**Validation**:
- [ ] `src/pipelines/init.ts` no longer exists
- [ ] `src/index.ts` does not import from `./pipelines/init.js`

---

### T013: Fix all import errors — `tsc --noEmit` must pass

**Purpose**: After T009–T012, fix every TypeScript compilation error caused by the deletions. This is the acceptance gate for WP03.

**Steps**:
1. Run `npx tsc --noEmit` and capture all errors
2. For each error:
   - **Import from deleted module** → remove the import and its usages, or redirect to the replacement
   - **Type used from deleted module** (`ExecutionContext`, `StepHandlerRegistry`, etc.) → relocate the type definition to `pipelines/types.ts` or keep it in `inngest/adapter.ts`
   - **Re-export in `pipelines/index.ts`** → remove re-exports of deleted modules

3. Common fixes:

   **`StepHandlerRegistry` and `ExecutionContext`** (from `engine/step-runner.ts`):
   These types are used in `corpus-update-pipeline.ts`, `content-audit-pipeline.ts`, `regulatory-change-monitor-pipeline.ts`, and `adapter.ts`. Options:
   - Move them to `src/pipelines/types.ts` (preferred — consolidates domain types)
   - Or keep them in `src/inngest/adapter.ts` and import from there

   **`pipelines/index.ts`** re-exports: Remove any `export * from './engine/index.js'`, `export * from './event-bus/index.js'`, `export * from './triggers/index.js'`

4. Run `npx tsc --noEmit` again. Repeat until zero errors.

5. Run `npx vitest run` to confirm no test regressions.

**Validation**:
- [ ] `npx tsc --noEmit` exits with code 0 (zero errors)
- [ ] `npx vitest run` passes
- [ ] No `// @ts-ignore` or `as any` added to make compilation pass

## Definition of Done

- [ ] All 15 files deleted (verify with `ls` — directories should not exist)
- [ ] `npx tsc --noEmit` exits with code 0
- [ ] `npx vitest run` passes
- [ ] No dangling imports to deleted modules anywhere in `src/`
- [ ] Total LOC removed ≥ 1,400 (verify: `git diff --stat main` should show large negative line count)

## Risks

- **`StepHandlerRegistry` / `ExecutionContext` type relocation**: These types are used by the Inngest function factories. Plan the relocation before deleting — move them to `src/pipelines/types.ts` first, update all imports, then delete `engine/step-runner.ts`.
- **`pipelines/index.ts` barrel exports**: If `pipelines/index.ts` re-exports from deleted modules, removing those re-exports may break other consumers. Check for downstream imports of `pipelines/index.ts` before removing exports.
- **Test files importing from engine**: Some tests import `PipelineStepHandler`, `ExecutionContext` etc. directly from the engine path. Update them to import from the relocated type file.

## Reviewer Guidance

1. **Mandatory**: Confirm `npx tsc --noEmit` shows 0 errors (not just "no new errors").
2. **No workarounds**: Reject if any `// @ts-ignore`, `as any`, or `@ts-expect-error` was added specifically to suppress deletion-related errors.
3. **Check git diff**: `git diff --stat` should show ~1,400–1,500 line deletions. If significantly less, files may not have been deleted.
4. **Verify directories**: Run `ls src/pipelines/` — `engine/`, `event-bus/`, `triggers/` must not appear.

## Activity Log

- 2026-03-19T14:00:46Z – claude-sonnet – shell_pid=58745 – lane=doing – Started implementation via workflow command
- 2026-03-19T14:12:20Z – claude-sonnet – shell_pid=58745 – lane=for_review – Ready for review: deleted engine/, event-bus/, triggers/, init.ts; relocated 3 types to pipelines/types.ts; fixed 17 import sites; replaced EventBus with inngest.send() in pipeline-executor.ts; tsc 0 errors, 261/261 tests pass
- 2026-03-19T14:12:31Z – claude-sonnet – shell_pid=65888 – lane=doing – Started review via workflow command
- 2026-03-19T14:14:41Z – claude-sonnet – shell_pid=65888 – lane=done – Review passed: engine/, event-bus/, triggers/, init.ts deleted (5012 LOC removed); 3 types relocated to pipelines/types.ts; 17 import sites fixed; EventBus replaced with inngest.send(); tsc 0 errors; 261/261 tests pass; no ts-ignore workarounds; fixed stale comment
