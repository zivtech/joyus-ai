# PR #69 Integration Remediation Plan

> **For Claude:** Use plan-writer protocol. Proposal-critic review checkpoints marked with [REVIEW].
> **Status:** Draft
> **Consequence level:** Internal Tool / Production API (medium-high: wiring bugs leave production API non-functional)
> **PR:** zivtech/joyus-ai#69 — Platform Core Orchestrator
> **Branch:** claude/platform-core-orchestrator

**Goal:** Fix five integration gaps identified in review where unit-tested services are not wired into the production API path, so the orchestrator routes exercise the full service stack end-to-end.

**Timeframe:** Next working session. All five fixes are bounded by existing service code — no new services or schema changes required.

**Audience:** Implementer (Claude Code agent in Sonnet mode) executing against this plan, plus the PR reviewer (grndlvl) who will re-review.

**Scope:**
- IN SCOPE: All five reviewer-identified issues, plus one latent TDZ bug discovered during code analysis, plus integration tests to prevent recurrence.
- OUT OF SCOPE: Mastra migration (still Anthropic SDK), new tools for the tool router (ToolRouterService wired as-is), DB schema changes, client-specific content (per CLAUDE.md client abstraction rule).

---

## Competing Alternatives Analysis

We explored 2 approaches before choosing Approach A:

### Approach A: Fix-in-place on the existing branch

**How it works:** Address each issue as a targeted edit to the existing service and route files. The code is already structured for dependency injection — the gaps are at wiring points, not architectural.

**Cost:** Low. Each fix is 5-40 lines of code changes. No new files except integration tests.

**Risk:** Low. All services have passing unit tests. The risk is regression in existing tests when wiring changes land.

**Precedent:** This is the standard approach for "services tested but not wired" — the services are correct, the mount point is incomplete.

**Why chosen:** The reviewer explicitly confirmed the service surfaces are correct. The gap is wiring, not design.

### Approach B: Refactor to centralized DI container

**How it works:** Introduce a service container that constructs the full dependency graph once at startup, ensuring all services are wired by construction.

**Cost:** High. Would touch src/index.ts, all route factories, all service constructors. ~200+ lines changed, new abstraction introduced.

**Risk:** Medium. A DI container is a good long-term pattern, but introducing it during a review remediation risks expanding the PR scope and triggering a fresh architecture review.

**Why rejected:** Scope creep. The reviewer asked for specific wiring fixes, not an architectural refactor. A DI container is a valid follow-up but would delay this PR further and change the review surface.

**Decision:** We chose Approach A because the reviewer confirmed the service code is correct and the gaps are at wiring points. Approach B remains viable as a follow-up PR to prevent this class of bug structurally.

---

## Pre-Mortem Analysis

Imagining failure: it is one week from now and this remediation was executed exactly as written — and the PR is rejected again.

### Day 1 Failures

- **Scenario:** Fix for Issue 4 (safety hooks) introduces a runtime TDZ error because `messages` is referenced before declaration at line 411 of agent-loop.service.ts.
  - Root cause: The variable `messages` is used in the `runPreHooks` call (line 411) but declared at line 427. TypeScript compiles this but it throws at runtime.
  - Severity: FATAL — blocks the processMessage path entirely.
  - Addressed in plan? Yes — Task 3.3 calls this out as a mandatory sequencing fix alongside the safety hook changes.

- **Scenario:** Inngest event send after session creation fails silently and sessions stay `pending` forever with no recovery path.
  - Root cause: `session.queued` event send is fire-and-forget but `session.created` is critical-path for the durable runner. If send fails, the session is created in DB but the Inngest function never triggers.
  - Severity: MAJOR — sessions silently stuck.
  - Addressed in plan? Yes — Task 1.2 specifies best-effort send with try/catch + console.error, AND Task 1.4 extends crash recovery to sweep `pending` sessions (safety net).

### 1-Month Failures

- **Scenario:** Dual-write to event log AND Inngest for work_unit.status_changed diverges — one succeeds, the other fails — creating inconsistent state.
  - Root cause: Two writes to different systems without transactional guarantees.
  - Severity: MINOR — Inngest has retry logic; event log failures are logged. Both writes are already fire-and-forget in the existing code.
  - Addressed in plan? Yes — Task 1.3 documents the dual-write contract explicitly and keeps both writes non-blocking.

### 6-Month Failures

- **Scenario:** New service added to the orchestrator (e.g., a billing hook) but not wired into the production mount, repeating the exact class of bug this PR fixes.
  - Root cause: No structural enforcement that service deps are wired.
  - Severity: MAJOR — same review finding repeats.
  - Addressed in plan? Partially — Task 6 adds integration tests that assert the mount wires specific deps. A DI container (Approach B) would structurally prevent this. Noted as follow-up.

### Black Swans

- **Scenario:** Inngest SDK version used in the project has a bug where `send()` silently drops events when the Inngest server is unreachable during development, making it impossible to test the wiring locally.
  - Mitigation: Tests mock the Inngest client and verify `.send()` is called with correct event names. Integration testing with the Inngest dev server is a separate concern.

---

## Assumption Register

| # | Assumption | Rating | Evidence | Risk if Wrong | Mitigation |
|---|-----------|--------|----------|---------------|------------|
| A1 | All existing unit tests pass on the current branch | VERIFIED | PR is green in CI; clean git status | Fixes would conflict with broken tests | Run test suite before starting |
| A2 | Service constructors accept optional deps without breaking callers | VERIFIED | AgentLoopService constructor uses `deps.safetyService ?? null` pattern (line 324) | Would need constructor changes | Confirmed in code |
| A3 | `createSessionsRouter` already accepts optional `memoryService` and `usageService` | VERIFIED | sessions.ts line 38-42: `createSessionsRouter(sessionService, memoryService?, usageService?)` | Would need route factory signature changes | Confirmed in code |
| A4 | The SSE route path issue is purely at the mount point (router.use path arg) | VERIFIED | events.ts:63 — `createTenantEventsRouter` handler is `GET /`, and it's mounted at `'/'` in index.ts:69. OpenAPI says `/events`. The mount needs to be `/events` | Could be the handler path instead | Confirmed: handler is `GET /`, mount path is the issue |
| A5 | Inngest client `.send()` is safe to call multiple times (idempotent delivery) | REASONABLE | Inngest docs state events are at-least-once delivered; `send()` is documented as fire-and-forget | Double sends could trigger duplicate function runs | Inngest functions are already idempotent by design (step.run checkpoints) |
| A6 | `assertDependenciesCompleted` silently drops missing IDs because `inArray` only returns rows that exist | FRAGILE | coordination.service.ts lines 706-728: fetches deps by `inArray(workUnits.id, dependencyIds)`. If a dep ID doesn't exist, it simply won't be in the result set. The `unmet` filter only checks `status !== 'completed'` on rows that ARE returned. Missing IDs are not in `deps` at all, so they're not in `unmet`, so they pass. | Downstream work units run when a declared prerequisite doesn't exist — DAG integrity violated | Task 5 fixes both creation-time validation AND transition-time validation |
| A7 | The `messages` variable TDZ at line 411 of agent-loop.service.ts doesn't crash today only because `safetyService` is null in the production mount | FRAGILE | The production mount at src/index.ts:333 creates `AgentLoopService({ db: pipelineDb })` with no safetyService. The `if (this.safetyService)` guard at line 405 prevents the TDZ access. Once Issue 2 wires a real SafetyService, this will throw. | Immediate runtime crash on first message send after Issue 2 is wired | Task 3.3 moves `messages` declaration before the pre-hook call |

---

## Dependency Map

```
Issue 3 (SSE path) ─── no dependencies ─── can start immediately
Issue 5 (DAG validation) ─── no dependencies ─── can start immediately
Issue 4 (Safety hooks + TDZ) ─── no dependencies ─── can start immediately
Issue 1 (Inngest wiring) ─── no dependencies ─── can start immediately
Issue 2 (Production mount) ─── depends on Issues 1, 3, 4 being coded first
       └── needs SafetyService, UsageService, SkillLoaderService, MemoryService, ToolRouterService
       └── needs Inngest event wiring done so wired stack can be exercised
Task 6 (Integration tests) ─── depends on all five issues being coded
```

**Critical dependency:** Issue 2 depends on Issues 1, 3, and 4. The production mount wiring cannot be tested until the services it wires are correct.

**Fallback:** If any individual issue fix breaks tests, it can be isolated in its own commit and reverted without affecting the others.

---

## Failure Mode & Rollback Design

| Step | Success State | Failure Detection | Rollback | Recovery Time |
|------|--------------|-------------------|----------|---------------|
| Issue 3 (SSE path) | `GET /api/v1/orchestrator/events` hits the SSE handler | Route returns 404 or hits wrong handler | Revert the one-line mount path change | < 1 min |
| Issue 5 (DAG validation) | Missing dep IDs cause creation-time error; transition check also catches them | Tests for missing-dep rejection fail | Revert coordination.service.ts changes | < 5 min |
| Issue 4 (Safety hooks + TDZ) | Pre-hook modifies prompt used by agent; post-hook modifies persisted text; streaming deferred for final iteration | processMessage throws TDZ error, or tests fail | Revert agent-loop.service.ts changes | < 5 min |
| Issue 1 (Inngest wiring) | session.created sends Inngest event; work_unit changes send Inngest event + event log | Session created but Inngest function never triggers | Revert session.service.ts + coordination.service.ts Inngest send additions | < 5 min |
| Issue 2 (Mount deps) | AgentLoopService constructed with real deps in src/index.ts | Tests asserting non-null deps fail | Revert src/index.ts wiring changes | < 2 min |
| Task 6 (Integration tests) | All integration tests pass | Tests fail | Revert test file | < 1 min |

---

## Implementation Phases

[REVIEW] **Checkpoint 1: After reading this plan, before starting any code changes** — **PRE-FLIGHT: Run the full test suite NOW to confirm Assumption A1.** If anything is red on a clean branch, fix that first — do not start remediation work on a failing baseline or you will waste time chasing "regressions" that were already there. Then: confirm Issue 3 by hitting `GET /api/v1/orchestrator/events` (should 404 or misroute). Confirm Assumption A7 by checking that `this.safetyService` is null in the production path.

### Phase 1: Issue 3 — SSE Route Path Mismatch (Trivial)

**Goal:** Make tenant-wide SSE available at `GET /api/v1/orchestrator/events` per the OpenAPI contract.

**Duration:** < 5 minutes.

**What's wrong:** In `src/orchestrator/routes/index.ts:69`, `createTenantEventsRouter` is mounted at `'/'`. The handler inside (events.ts:63) responds to `GET /`. The OpenAPI spec at openapi.ts:420 documents the path as `/events`. Since the handler is `GET /` and it's mounted at `/`, it responds to `GET /api/v1/orchestrator/` — not `/api/v1/orchestrator/events`.

**Fix:**
- File: `src/orchestrator/routes/index.ts`
- Line 69: Change `router.use('/', createTenantEventsRouter(deps.eventService));` to `router.use('/events', createTenantEventsRouter(deps.eventService));`

**Risk:** The coordination router is also mounted at `'/'` (line 72). Must verify this doesn't cause route conflicts. It won't because the coordination router defines specific sub-paths (`/work-units`, `/coordination-groups`), not `GET /`.

**Success criteria:** A GET to `/api/v1/orchestrator/events` returns SSE headers (Content-Type: text/event-stream).

**Tests to update:** Check if any existing route tests reference the old path.

---

### Phase 2: Issue 5 — Work-Unit Dependency DAG Validation

**Goal:** Reject work units that declare non-existent dependencies at creation time, and catch missing deps at transition time.

**Duration:** 30-45 minutes.

**What's wrong (two bugs):**

**Bug 5a — Creation time (coordination.service.ts:229-282):** `createWorkUnit` validates for cycles but never checks whether the listed dependency IDs actually exist in the DB. A work unit can declare a dependency on `"nonexistent-id-123"` and it will be accepted.

**Bug 5b — Transition time (coordination.service.ts:706-728):** `assertDependenciesCompleted` queries deps via `inArray(workUnits.id, dependencyIds)`. If a dep ID doesn't exist, it's simply absent from the result set. The `unmet` filter checks `status !== 'completed'` on returned rows only. Missing IDs are never in `deps`, never in `unmet`, and thus silently treated as satisfied.

**Fix for Bug 5a — validate existence at creation:**
- File: `src/orchestrator/coordination.service.ts`
- In `createWorkUnit`, after the cycle check and before the DB insert, add an existence check:
  - Query `SELECT id FROM work_units WHERE tenant_id = :tenantId AND id IN (:dependencyIds)`
  - Compare returned IDs against the input `dependencies` array
  - If any IDs are missing, throw a new `DependencyNotFoundError` listing the missing IDs
- Add new error class `DependencyNotFoundError` in the errors section (~line 147)

**Fix for Bug 5b — validate existence at transition:**
- File: `src/orchestrator/coordination.service.ts`
- In `assertDependenciesCompleted`, after the query, compare `deps.length` against `dependencyIds.length`
- If `deps.length < dependencyIds.length`, compute the missing IDs (set difference) and throw `DependencyNotFoundError`
- This goes BEFORE the existing `unmet` check

**Success criteria:**
- Creating a work unit with `dependencies: ["does-not-exist"]` returns an error
- Transitioning a work unit to `running` when a dependency ID has been deleted returns an error
- Existing cycle detection tests still pass

**Tests:**
- Add unit test: `createWorkUnit` with non-existent dep ID throws `DependencyNotFoundError`
- Add unit test: `assertDependenciesCompleted` with missing dep ID throws `DependencyNotFoundError`
- Existing tests remain green

---

### Phase 3: Issue 4 — Safety Hook Enforcement

**Goal:** Pre-hook prompt modifications are used by the agent, post-hook output modifications are persisted, and the TDZ bug is fixed.

**Duration:** 45-60 minutes.

**What's wrong (three bugs):**

**Bug 4a — TDZ: `messages` referenced before declaration (LATENT, NOT IN REVIEW):**
- File: `src/orchestrator/agent-loop.service.ts`
- Line 411: `runPreHooks` is called with `{ ..., messages }` — but `messages` (const) is declared at line 427.
- This doesn't crash today because `this.safetyService` is null in the production mount (the `if` guard at line 405 protects it). Once Issue 2 wires a real SafetyService, this will be a runtime TDZ error.
- **Fix:** Move the `messages` array construction (currently at line 427) to BEFORE the pre-hook call. Specifically:
  - Build `const messages: AgentMessage[]` after loading history (after line 372) and before the pre-hook block (line 405)
  - The `historyTokenEstimate` calculation already uses `historyMessages`, not `messages`, so it's unaffected

**Bug 4b — Pre-hook prompt modification ignored:**
- File: `src/orchestrator/agent-loop.service.ts`
- Lines 405-415: The pre-hook result is checked for `action === 'block'` but the `effectiveSystemPrompt` is never used. When a pre-hook modifies the prompt, the original `systemPrompt` is still passed to `agentClient.generate`.
- **Fix:** After the pre-hook check, if the result has `effectiveSystemPrompt`, use it:
  ```
  let effectiveSystemPrompt = systemPrompt;
  if (preResult.action === 'allow' || preResult.action === 'modify') {
    effectiveSystemPrompt = preResult.effectiveSystemPrompt;
  }
  ```
  Then use `effectiveSystemPrompt` in the `agentClient.generate` call and the context window monitor.

**Bug 4c — Post-hook modification not persisted, streaming order wrong:**
- File: `src/orchestrator/agent-loop.service.ts`
- Two sub-problems:
  1. **Persisted text:** Line 511-517 saves `content: output.text` — should be `content: finalText` (which holds the post-hook-modified text after line 506).
  2. **Streaming order:** Line 486-488 streams `output.text` via `stream.sendToken()` before the post-hook runs (lines 494-508). If a post-hook modifies the text, the client has already received the original.
- **Fix for persistence:** Change `content: output.text` to `content: finalText` at line 515.
- **Fix for streaming:** Split behavior by iteration. The key insight: mid-loop iterations stream immediately (no post-hook involved); only the final iteration defers until after the post-hook. Concrete shape:
  ```
  const isFinal = output.stopReason === 'end_turn' || output.toolCalls.length === 0;
  if (!isFinal && stream && !stream.isClosed && output.text) {
    stream.sendToken(output.text);  // mid-loop text — no post-hook applies
  }
  // ... if isFinal: run post-hook → resolve finalText → stream.sendToken(finalText) → save turn → stream.done()
  ```
  - **UX tradeoff:** During tool-use iterations (non-final), text IS streamed immediately (no post-hook runs mid-loop). Only the final-response iteration is deferred. This means a brief delay on the last chunk only, not the entire response.

**Success criteria:**
- Pre-hook that returns `{ action: 'modify', modifiedPrompt: '...' }` causes the modified prompt to be passed to `agentClient.generate`
- Post-hook that returns `{ action: 'modify', modifiedResponse: '...' }` causes the modified text to be persisted AND streamed
- No TDZ error when safetyService is non-null
- Existing agent-loop tests pass

**Tests:**
- Add unit test: pre-hook modify outcome results in modified system prompt reaching agentClient
- Add unit test: post-hook modify outcome results in modified text in persisted turn
- Add unit test: post-hook modify outcome results in modified text on the SSE stream
- Verify no TDZ by running processMessage with a real (mock) SafetyService

---

### Phase 4: Issue 1 — Inngest Event Wiring

**Goal:** Session creation fires `orchestrator/session.created` Inngest event. Work-unit status changes fire `orchestrator/work_unit.status_changed` Inngest event. Both ALSO retain the existing event-log emission for SSE consumers.

**Duration:** 45-60 minutes.

**What's wrong:**

**Bug 1a — Session creation never sends `orchestrator/session.created`:**
- File: `src/orchestrator/session.service.ts`
- `createSession` (line 76) inserts the session row and optionally emits `session.queued` for observability. It never sends the `orchestrator/session.created` Inngest event that the durable session-run function subscribes to (session-run.ts:98: `{ event: 'orchestrator/session.created' }`).
- The messages route (messages.ts:59-66) transitions pending sessions to running via `updateSessionStatus`, which also never sends the Inngest event.
- **Result:** Sessions are created in the DB but the Inngest durable runner never starts. The only way a session gets to `running` is via the messages endpoint's implicit transition, which bypasses the durable runner entirely.

**Bug 1b — Work-unit status changes emit event-log type, not Inngest event name:**
- File: `src/orchestrator/coordination.service.ts`
- `updateWorkUnit` (line 353) emits `'work_unit.status_changed'` to the event log via `eventService.emitEvent`. The coordination Inngest function (coordination.ts:62) subscribes to `'orchestrator/work_unit.status_changed'`. These are different systems — the event log does not trigger Inngest functions.
- **Result:** Work-unit status changes are recorded for SSE consumers but the coordination group lifecycle function never triggers.

**Fix for Bug 1a — emit Inngest event on session creation:**
- File: `src/orchestrator/session.service.ts`
- After the session insert and before the return, add an `inngestClient.send()` call:
  ```
  await this.inngestClient.send({
    name: 'orchestrator/session.created',
    data: { sessionId: id, tenantId: validated.tenantId, userId: validated.userId },
  });
  ```
- **Error handling strategy:** Best-effort send with try/catch + console.error. Rationale:
  - Matches the existing `session.queued` pattern in the same file (line 107-137)
  - An outbox pattern would require a new DB table and drain worker — scope creep for this remediation
  - The safety net is extending crash recovery to also sweep `pending` sessions (Task 1.4 below)

**Fix for Bug 1b — add Inngest send to work-unit status changes (DUAL-WRITE):**
- File: `src/orchestrator/coordination.service.ts`
- **IMPLEMENTER NOTE (mocking pattern):** `CoordinationService` does NOT take an injectable Inngest client via constructor (unlike SessionService). It imports `inngest` directly at the module level (line 41: `import { inngest } from '../inngest/client.js';`). Tests for this side need module-level mocking (`vi.mock('../inngest/client.js')`) rather than constructor injection. Do NOT copy the SessionService test pattern verbatim — it won't work here.
- In `updateWorkUnit`, after the existing `eventService.emitEvent` call (line 353-369), add an `inngest.send()` call:
  ```
  await inngest.send({
    name: 'orchestrator/work_unit.status_changed',
    data: {
      workUnitId: updated.id,
      tenantId,
      previousStatus: current.status,
      newStatus: updated.status,
      ...(updated.coordinationGroupId ? { coordinationGroupId: updated.coordinationGroupId } : {}),
    },
  });
  ```
- **DUAL-WRITE CONTRACT:** The event-log emit (eventService.emitEvent) is RETAINED for SSE consumers. The Inngest send is ADDED for the durable lifecycle function. Both writes are non-blocking; both failures are logged but do not roll back the status change. This is intentional — the DB status is the source of truth; events are eventually-consistent notifications.

**Fix 1c — extend crash recovery to sweep `pending` sessions:**
- File: `src/orchestrator/recovery.ts` (and `session.service.ts`)
- Currently, `findAllOrphanedSessions` only looks for `status = 'running'` sessions. If the Inngest send fails after session creation, the session is stuck in `pending` with no recovery path.
- **Fix:** Add a separate sweep in `runCrashRecovery` for sessions that are `pending` and older than the cutoff. These should either be re-dispatched (re-send the Inngest event) or marked as failed.
- **Recommended approach:** Mark them as failed with `recoveredFromCrash: true` metadata, same as running sessions. The user can retry by creating a new session. Re-dispatching is riskier (could double-send if the original event is just delayed).
- Add `findOrphanedPendingSessions` method to SessionService (mirrors `findAllOrphanedSessions` but with `status = 'pending'`).

**Success criteria:**
- Creating a session via POST /sessions triggers an Inngest event with name `orchestrator/session.created`
- Updating a work unit status triggers an Inngest event with name `orchestrator/work_unit.status_changed`
- Both ALSO record in the event log for SSE consumers
- Pending sessions older than cutoff are recovered on startup

**Tests:**
- Unit test: `createSession` calls `inngestClient.send` with `orchestrator/session.created`
- Unit test: `updateWorkUnit` with a status change calls `inngest.send` with `orchestrator/work_unit.status_changed`
- Unit test: crash recovery sweeps pending sessions
- Existing session and coordination tests pass

---

### Phase 5: Issue 2 — Production Route Mount Dependencies

**Goal:** The production mount in `src/index.ts` constructs `AgentLoopService` with real dependencies: `ToolRouterService`, `SafetyService`, `UsageService`, `SkillLoaderService`. The sessions router receives `MemoryService` and `UsageService`.

**Duration:** 30-45 minutes.

**What's wrong:**
- File: `src/index.ts`, lines 328-337
- The orchestrator mount creates `AgentLoopService({ db: pipelineDb })` with no other deps. This means:
  - `toolRouter` defaults to `StubToolRouter` (returns empty tools, mock results)
  - `safetyService` defaults to null (all hooks skipped)
  - `usageService` defaults to null (no usage tracking)
  - `skillLoader` defaults to null (no constitution or skills injected)
- The sessions router is called as `createSessionsRouter(deps.sessionService)` without `memoryService` or `usageService`, so the `/turns` endpoint returns 501 and the session detail endpoint omits usage data.

**Fix — wire real service instances:**
- File: `src/index.ts`
- Import the additional services:
  ```
  import { MemoryService } from './orchestrator/memory.service.js';
  import { ToolRouterService } from './orchestrator/tool-router.service.js';
  import { createDefaultSafetyService } from './orchestrator/safety.service.js';
  import { UsageService } from './orchestrator/usage.service.js';
  import { SkillLoaderService } from './orchestrator/skill-loader.service.js';
  ```
- Construct instances before the mount:
  ```
  const orchestratorEventService = new EventService(pipelineDb);
  const orchestratorMemoryService = new MemoryService(pipelineDb);
  const orchestratorToolRouter = new ToolRouterService(orchestratorEventService);
  const orchestratorSafetyService = createDefaultSafetyService(orchestratorEventService);
  const orchestratorUsageService = new UsageService(pipelineDb, orchestratorEventService);
  const orchestratorSkillLoader = new SkillLoaderService();
  ```
- Pass to AgentLoopService:
  ```
  agentLoopService: new AgentLoopService({
    db: pipelineDb,
    toolRouter: orchestratorToolRouter,
    safetyService: orchestratorSafetyService,
    usageService: orchestratorUsageService,
    skillLoader: orchestratorSkillLoader,
  }),
  ```
- **Also:** Update the `OrchestratorRouterDeps` interface and `createOrchestratorRoutes` to accept `memoryService` and `usageService`, then pass them through to `createSessionsRouter`:
  - File: `src/orchestrator/routes/index.ts` — add `memoryService?: MemoryService` and `usageService?: UsageService` to `OrchestratorRouterDeps`
  - Line 60: Change `createSessionsRouter(deps.sessionService)` to `createSessionsRouter(deps.sessionService, deps.memoryService, deps.usageService)`
- **Alternative check:** Verify `ToolRouterService` constructor signature. If it needs `db` or other deps, adjust accordingly. (From the file header, it takes an optional `EventService`.)
- **Alternative check:** Verify `SkillLoaderService` constructor. It likely takes a basePath. Check and provide the correct path (default: `skills/`).

**Success criteria:**
- `AgentLoopService` in production has a real `ToolRouterService`, `SafetyService`, `UsageService`, and `SkillLoaderService`
- `GET /sessions/:id` includes usage data when available
- `GET /sessions/:id/turns` returns turn history (not 501)
- Existing tests pass

**Tests:** See Task 6 (integration tests).

---

### Phase 6: Integration Tests to Prevent Recurrence

**Goal:** Add tests that verify the production wiring exercises the full service stack, preventing this class of bug from recurring.

**Duration:** 45-60 minutes.

**What's wrong (meta-issue):** Unit tests with mocked deps pass even when the production mount doesn't wire those deps. The reviewer's core complaint is this gap.

**Tests to add:**

**Test 6a — Mount wiring assertion (behavioral, not field inspection):**
- File: new test file `tests/orchestrator/integration/mount-wiring.test.ts`
- **IMPLEMENTER NOTE:** The service deps on `AgentLoopService` are private fields — you cannot check them directly. Use behavioral assertions instead:
  - Spy on `inngest.send` -> POST /sessions via supertest -> assert spy was called with `orchestrator/session.created`
  - Register a probe pre-hook on the SafetyService instance before mounting -> POST /messages -> assert the probe hook ran
  - Hit `GET /events` and assert `Content-Type: text/event-stream` in response headers
- Construct the orchestrator routes using `createOrchestratorRoutes` with all deps, then use supertest to verify:
  - POST /sessions creates a session AND calls `inngestClient.send` with the correct event name
  - GET /sessions/:id/turns does NOT return 501
  - GET /events returns SSE headers (Content-Type: text/event-stream)

**Test 6b — Inngest event emission assertion:**
- In existing session.service tests: add a test that verifies `inngestClient.send` is called with `{ name: 'orchestrator/session.created', data: { sessionId, tenantId, userId } }` when a session is created
- In existing coordination.service tests: add a test that verifies `inngest.send` is called with `{ name: 'orchestrator/work_unit.status_changed', ... }` when a work unit status changes

**Test 6c — Route existence assertion:**
- Use express route inspection or supertest probing to verify:
  - `GET /api/v1/orchestrator/events` resolves (not 404)
  - `GET /api/v1/orchestrator/sessions/:id/events` resolves (not 404)

**Test 6d — OpenAPI conformance assertion:**
- Extend `tests/orchestrator/routes/openapi.test.ts` to verify every operationId in the generated spec has a corresponding mounted route. This generalizes the existing T047 spec validity check to "spec matches reality."

**Success criteria:** All integration tests pass. Adding a new service dep that isn't wired would cause Test 6a to fail.

---

[REVIEW] **Checkpoint 2: After all phases are coded, before pushing** — Run the full test suite. Verify:
1. All existing tests pass (no regressions)
2. New integration tests pass
3. The five specific reviewer findings are addressed
4. No client-specific content in any new test fixtures or examples

---

## Backcasting Verification

**Goal state:** All five reviewer findings resolved, PR approved on re-review.

Working backward:

1. **PR approved** requires all five issues verified by reviewer + no new findings
2. **No new findings** requires integration tests (Task 6) catching wiring gaps + TDZ fix (Task 3.3)
3. **Issue 2 resolved** requires production mount wiring all deps (Task 5) -- depends on SafetyService fix (Task 3) and Inngest wiring (Task 4) being correct
4. **Issue 1 resolved** requires session.created Inngest event + work_unit.status_changed Inngest event + crash recovery for pending sessions (Task 4)
5. **Issue 4 resolved** requires pre-hook prompt used + post-hook text persisted + TDZ fixed + streaming order corrected (Task 3)
6. **Issue 5 resolved** requires existence validation at creation + existence validation at transition (Task 2)
7. **Issue 3 resolved** requires mount path changed from `'/'` to `'/events'` (Task 1)
8. **All tasks start from** clean branch with passing tests (verified by pre-flight check)

**Verified:** No broken links. No circular dependencies. Each phase produces what the next phase needs.

---

## Commit Strategy

**Separate commits, single PR review round.** Six commits:

1. `fix(orchestrator): mount tenant SSE route at /events to match OpenAPI spec`
2. `fix(orchestrator): validate dependency existence in work-unit DAG`
3. `fix(orchestrator): enforce safety hook modifications in agent loop`
4. `fix(orchestrator): wire Inngest events for session creation and work-unit status changes`
5. `fix(orchestrator): pass full service deps to production route mount`
6. `test(orchestrator): add integration tests for production wiring`

Each commit is independently revertable. The reviewer can step through them in order.

---

## Key Risks & Assumptions

**Highest-risk assumptions:**
1. **FRAGILE (A6):** `assertDependenciesCompleted` treats missing IDs as satisfied — Mitigation: Task 2 fixes both creation-time and transition-time validation
2. **FRAGILE (A7):** `messages` TDZ at line 411 will crash once SafetyService is wired — Mitigation: Task 3.3 fixes the declaration order before Task 5 wires the service

**Unknowns:**
1. `SkillLoaderService` constructor may require a basePath or other config — Resolution: read the constructor before wiring in Task 5
2. `ToolRouterService` constructor signature — Resolution: already read (takes optional `EventService`), confirmed

---

## Success Criteria

- All five reviewer findings are resolved with code changes
- No new runtime errors introduced (TDZ fix prevents the latent crash)
- All existing tests pass (zero regressions)
- New integration tests verify production wiring
- Each fix is in its own commit for reviewability
- No client-specific content in any new code or test fixtures
- Crash recovery covers both `running` AND `pending` orphaned sessions

---

## Review Checkpoints & Proposal-Critic Gates

[REVIEW] **Checkpoint 1:** Before starting implementation
- Verify all assumptions by running test suite
- Confirm SSE route mismatch by inspecting Express route table or making a test request

[REVIEW] **Checkpoint 2:** After all phases coded, before push
- Full test suite green
- No regressions
- Client abstraction rule compliance (no client names/specifics)

[REVIEW] **Final Review:** Before requesting re-review
- Walk through each of the 5 reviewer findings
- For each: cite the commit, the file:line changed, and what it fixes
- Update PR description with a remediation summary

---

## Contract Appendix (for spec-kitty-bridge WP translation)

### Architecture Overview

Fix-in-place remediation of five integration wiring gaps in the Platform Core Orchestrator. No architectural changes — services are correct, mount points and event wiring are not. Risk posture: low (targeted edits to existing code with comprehensive test coverage).

### Implementation Tasks

#### Task 1: SSE Route Path Fix
Estimated Effort: low
Depends on: none

#### Test Strategy for Task 1
Verify GET /api/v1/orchestrator/events returns SSE headers.

#### Acceptance Criteria for Task 1
- OpenAPI spec path `/events` matches the mounted route
- Existing session-scoped SSE still works at `/sessions/:id/events`

---

#### Task 2: Dependency DAG Existence Validation
Estimated Effort: medium
Depends on: none

#### Test Strategy for Task 2
- Unit test: creation with non-existent dep ID throws DependencyNotFoundError
- Unit test: transition with deleted dep ID throws DependencyNotFoundError
- Existing cycle detection tests pass

#### Acceptance Criteria for Task 2
- Non-existent dependency IDs rejected at creation
- Deleted dependency IDs caught at transition to running
- Existing DAG tests pass

---

#### Task 3: Safety Hook Enforcement + TDZ Fix
Estimated Effort: medium
Depends on: none

#### Test Strategy for Task 3
- Unit test: pre-hook modify reaches agent client
- Unit test: post-hook modify persisted in turn
- Unit test: post-hook modify sent on SSE stream
- Unit test: processMessage with non-null SafetyService does not TDZ

#### Acceptance Criteria for Task 3
- Pre-hook modifiedPrompt used by agent
- Post-hook modifiedResponse persisted and streamed
- No TDZ error when SafetyService is non-null

---

#### Task 4: Inngest Event Wiring
Estimated Effort: medium
Depends on: none

#### Test Strategy for Task 4
- Unit test: createSession calls inngest.send with orchestrator/session.created
- Unit test: updateWorkUnit calls inngest.send with orchestrator/work_unit.status_changed
- Unit test: crash recovery sweeps pending sessions

#### Acceptance Criteria for Task 4
- Session creation triggers Inngest durable function
- Work-unit status changes trigger coordination lifecycle function
- Event-log emissions retained for SSE consumers (dual-write)
- Pending orphaned sessions recovered on startup

---

#### Task 5: Production Mount Dependencies
Estimated Effort: medium
Depends on: [Task 3, Task 4]

#### Test Strategy for Task 5
- Integration test: AgentLoopService has non-stub deps
- Integration test: /turns endpoint does not return 501
- Integration test: /sessions/:id includes usage data

#### Acceptance Criteria for Task 5
- All service deps wired in production mount
- No stub/null services in the deployed path

---

#### Task 6: Integration Tests
Estimated Effort: medium
Depends on: [Task 1, Task 2, Task 3, Task 4, Task 5]

#### Test Strategy for Task 6
- Mount wiring assertions
- Inngest event emission assertions
- Route existence assertions
- OpenAPI conformance assertions

#### Acceptance Criteria for Task 6
- All integration tests pass
- Removing a dep wire causes a test failure (verified manually during development)

### Failure Modes
- Inngest send fails after session insert: mitigated by best-effort + crash recovery sweep
- Dual-write divergence (event log vs Inngest): both non-blocking; DB status is source of truth
- TDZ crash: fixed by declaration reordering (Task 3.3); verified by new test
- Route path mismatch: fixed by mount point change (Task 1); verified by route existence test
