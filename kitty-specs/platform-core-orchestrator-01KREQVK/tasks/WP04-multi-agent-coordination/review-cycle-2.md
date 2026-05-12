---
affected_files: []
cycle_number: 2
mission_slug: platform-core-orchestrator-01KREQVK
reproduction_command:
reviewed_at: '2026-05-12T21:35:13Z'
reviewer_agent: unknown
verdict: rejected
wp_id: WP04
---

# WP04 Review — Cycle 1

**Result:** Changes Requested — 16 of 38 tests fail due to mock fidelity issues.

Tests were executed by running the WP04 test file against the implementation. Actual failures observed; this is not static analysis speculation.

---

## Issue 1 (BLOCKER): `makeDbMultiSelect` mock does not support non-limit queries — 10+ test failures

**Tests failing:** All `evaluateCompletion` tests (all/any/majority policies + empty group variants).

**Root cause:** `listWorkUnits` in the service calls:
```ts
this.db.select().from(workUnits).where(and(...conditions))
```
This awaits the result of `.where()` directly (no `.limit()` call). In Drizzle ORM this is valid and returns a Promise<row[]>.

The `makeDbMultiSelect` mock constructs `.where()` to return `{ limit, returning }` synchronously. When the service awaits `.where()`, it gets the plain object `{ limit, returning }` — not an array. Calling `.filter()` on a plain object throws `TypeError: units.filter is not a function`.

The `makeDb` helper has the same flaw for all queries that don't call `.limit()` (e.g., `listWorkUnits` and `assertDependenciesCompleted`).

**Fix:** The `.where()` mock must return a thenable/Promise when the chain doesn't continue with `.limit()`. The standard pattern is to use `mockReturnValue` returning a Promise for the "terminal" case:
```ts
const where = vi.fn().mockResolvedValue(rows);         // for queries that await .where() directly
// OR
const where = vi.fn().mockReturnValue({ limit, returning });  // for queries with .limit()/.returning()
```

Because the service uses both patterns, the mock needs to handle both. A practical fix is to make `where()` return an object that is itself a Promise AND has `.limit()` / `.returning()` chaining. For example:
```ts
const rowsPromise = Promise.resolve(rows);
const limit = vi.fn().mockResolvedValue(rows);
const returning = vi.fn().mockResolvedValue(rows);
// Make .where() thenable AND chainable:
const where = vi.fn().mockReturnValue(Object.assign(rowsPromise, { limit, returning }));
```

This applies to both `makeDb` and `makeDbMultiSelect`.

---

## Issue 2 (BLOCKER): Dependency-checking tests use incorrect initial work unit status — 2 test failures

**Tests failing:**
- `throws DependencyNotMetError if dependency is not completed when going to running`
- `allows running transition when all dependencies are completed`

**Root cause in the first test:** The mock unit has `status: 'assigned'` but the test tries to transition it to `running` via `updateWorkUnit`. The `makeDbMultiSelect` mock increments `callCount` in `select()` but the `.limit()` mock ignores `callCount` and always returns `rowSets[0]` for the first call. Because of the broken mock, the service gets the current unit (status='assigned'), then tries to call `assertDependenciesCompleted`, but `assertDependenciesCompleted` uses `inArray` without `.limit()` — same mock fidelity issue as Issue 1.

**Root cause in the second test:** The mock overrides involve a `completedDep` with `status: 'completed'` but the final `simpleDb` override patches `update` to return `updatedUnit` (status='running'). However, `simpleDb` is built with `makeDbMultiSelect([[currentUnit], [simpleDeps]])` and then `update` is patched. But the mock for `assertDependenciesCompleted` calls `.select().from().where()` without `.limit()` — it never returns an array. The test also creates multiple overlapping mock objects (`db`, `fromFn`, `simpleDb`) in a confusing way that defeats the intent.

**Fix:** Fix Issue 1 first (the `.where()` thenable pattern). Then simplify the dependency-checking tests to use a consistent mock approach.

---

## Issue 3 (BLOCKER): Cycle detection tests use `.limit()` as the expected return path — 3 test failures

**Tests failing:**
- `detects a self-cycle: unit A depends on itself`
- `detects a transitive cycle: A → B → C → A`
- `allows a valid DAG without cycles`

**Root cause:** `assertNoCycle` calls `.select().from().where()` and awaits the result directly. The cycle detection tests mock `.where()` returning `{ limit, returning }`. The service gets `{ limit, returning }` as `allUnits`, then tries `for (const unit of allUnits)` — throws `TypeError: allUnits is not iterable`, not `DependencyCycleError`.

The "self-cycle" and "transitive cycle" tests appear to pass in isolation only because the `TypeError` is unexpected by `rejects.toThrow(DependencyCycleError)` — but the actual result from running shows they fail with the wrong error class.

**Fix:** Same as Issue 1 — make `.where()` return a thenable that resolves to the rows array. With that fix, `assertNoCycle` will receive `existingUnits` as an array and the DFS logic will correctly detect the cycle.

---

## Non-blocking observations (implement with fixes)

1. **`pending → running` is not a valid direct transition.** The first dependency test creates a unit with `status: 'assigned'` (correct) but the test helper for "throws DependencyNotMetError" creates the mock with `status: 'pending'` but transitions to `running` directly. Fix the fixture to use `status: 'assigned'` to match what the state machine permits.

2. **Signal cross-tenant isolation not tested.** The spec's reviewer guidance notes: "Verify signals cannot be sent across tenants." No test covers `sendSignal` with mismatched tenantId. Add a test verifying the Inngest event payload includes tenantId, and that an agent receiving a signal can verify `event.data.tenantId === ownTenantId`.

3. **Empty group policy in `createCoordinationGroup`.** The spec says "should reject at creation" for zero work units. The implementation allows empty groups (documented in comments as intentional: "stays active until units are added"). This is a deliberate design choice documented in comments but diverges from the spec's reviewer guidance. The current behavior is acceptable — document it explicitly in the WP or clarify the spec.

---

## What is correct and well-implemented

- Schema (coordination.ts): enums, table structure, text[] for deps/labels, indexes — all match spec.
- Migration (0007): correct SQL, manually authored with clear explanation, follows project conventions.
- State machine transitions: WORK_UNIT_TRANSITIONS map is correct; terminal states have no transitions.
- Completion policy logic: the `evaluateCompletion` switch statement is correct for all/any/majority, including majority math (`Math.floor(total/2) + 1`) and impossibility detection.
- Inngest lifecycle function (T033): triggered by correct event, uses step.run() for crash safety, idempotent finalize call.
- Event registration: all 5 event types registered with correct Zod schemas.
- Inngest client: work_unit.status_changed and agent.signal events wired with correct type shapes.
- Signal isolation: tenantId baked into every Inngest event payload.
- Scope: only coordination files touched (no scope creep).
- 22 of 38 tests pass and cover valid happy paths adequately.

---

## Summary

The implementation logic is sound. The mocks need to be fixed to properly handle queries that await `.where()` directly (without chaining `.limit()`). This is a pervasive mock construction issue affecting cycle detection, completion policy, and dependency checking tests. Fix the mock helpers first; the tests will then validate the correct logic.
