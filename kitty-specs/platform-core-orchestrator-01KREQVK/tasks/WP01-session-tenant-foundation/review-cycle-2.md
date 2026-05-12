---
affected_files: []
cycle_number: 2
mission_slug: platform-core-orchestrator-01KREQVK
reproduction_command:
reviewed_at: '2026-05-12T20:41:18Z'
reviewer_agent: unknown
verdict: rejected
wp_id: WP01
---

# WP01 Review Cycle 1 — Changes Requested

**Reviewer:** claude:opus:orchestrator:reviewer
**Date:** 2026-05-12
**Verdict:** Changes Required

---

## Summary

The implementation is structurally sound: tenant isolation is consistently enforced across all queries, the state machine is clean, the Inngest function registers correctly, crash recovery helpers are implemented, and the migration is complete. However, there are three blocking issues and two lower-priority gaps.

---

## Blocking Issues

### Issue 1: Missing `cancelled` status in the session state machine

**Location:** `src/orchestrator/types.ts`, `src/db/schema/orchestrator.ts`, `src/db/migrations/0005_orchestrator_tables.sql`

**Problem:** The spec (T011) explicitly lists `pending→cancelled` as a valid transition:
> Valid: pending→running, running→suspended, running→completed, running→failed, suspended→running, **pending→cancelled**

The data-model.md State Transitions diagram confirms it:
```
pending → cancelled
```

The implementation omits `cancelled` entirely from:
- `SESSION_STATUSES` array in `types.ts`
- `sessionStatusEnum` pg enum in `orchestrator.ts`
- `SESSION_TRANSITIONS.pending` allowed targets
- The migration SQL enum definition

**Fix:**
1. Add `'cancelled'` to `SESSION_STATUSES` in `types.ts`
2. Add `'cancelled'` to `sessionStatusEnum` in `orchestrator.ts`
3. Add `'cancelled'` to `SESSION_TRANSITIONS.pending: ['running', 'cancelled']` in `types.ts`
4. Add `'cancelled'` to the `orchestrator_session_status` enum in the migration SQL (or create a new migration to `ALTER TYPE ... ADD VALUE 'cancelled'`)
5. Add a test: `pending → cancelled` allowed, `running → cancelled` rejected

---

### Issue 2: T015 observability event never emitted

**Location:** `src/inngest/functions/orchestrator/session-run.ts`

**Problem:** T015 requires: "Log when a tenant hits their concurrency limit (emit a typed event for observability)". The `orchestrator/session.queued` event type is correctly defined in `client.ts`, but it is never sent/emitted anywhere. Inngest does not automatically emit events when a function is queued — the caller must send this event explicitly, typically before enqueuing the session-run trigger.

**Fix:** The event should be sent in the service layer when a session is created and its concurrency slot is not immediately available. Since Inngest queuing is transparent, the standard pattern is to emit this observability event unconditionally alongside `orchestrator/session.created`, or to instrument it at the session creation endpoint. At minimum, add a comment explaining the resolution and either implement the emit or document the deferral explicitly with a TODO referencing the specific tracking mechanism.

If full implementation is deferred, the `orchestrator/session.queued` event type should be removed from `client.ts` to avoid dead code.

---

### Issue 3: Crash recovery startup hook missing (`recovery.ts`)

**Location:** `src/inngest/functions/orchestrator/session-run.ts` (docstring references it), T014

**Problem:** T014 requires: "Add startup recovery check: on service start, query for sessions with status 'running' that have no active Inngest run — these are orphaned from a previous crash." The service implements `findAllOrphanedSessions()` and `markOrphanedAsFailed()` correctly, but there is no startup hook wiring them. The session-run docstring references `src/orchestrator/recovery.ts`, which does not exist.

The Definition of Done includes: "After simulated process crash, orphaned sessions are detected on restart." Without a startup hook, orphaned sessions are never acted upon.

**Fix:** Create `src/orchestrator/recovery.ts` with a `runCrashRecovery(sessionService: SessionService)` function that:
1. Calls `sessionService.findAllOrphanedSessions()`
2. For each orphaned session: either re-dispatches the Inngest event or calls `markOrphanedAsFailed()`
3. Returns a structured result (sessions recovered, sessions failed)

Wire this into the server startup sequence (e.g., after DB connection, before accepting requests). A test verifying the recovery flow is expected.

---

## Non-Blocking Issues (fix before next cycle or document explicitly)

### Issue 4: `markOrphanedAsFailed` overwrites existing metadata

**Location:** `src/orchestrator/session.service.ts` line ~243

**Problem:** The crash recovery path replaces the entire `metadata` column:
```typescript
metadata: { recoveredFromCrash: true, recoveredAt: now.toISOString() },
```
Any pre-existing metadata (model name, initial prompt, etc.) is silently lost. PostgreSQL JSONB supports merge via `jsonb_merge_patch` or `||` operator. Drizzle supports this via `sql` tagged template or a raw fragment.

**Fix:** Merge the recovery metadata into the existing value:
```typescript
// In Drizzle with raw SQL fragment:
metadata: sql`${orchestratorSessions.metadata} || ${JSON.stringify({ recoveredFromCrash: true, recoveredAt: now.toISOString() })}::jsonb`,
```

Or read-then-write if simpler. Alternatively, store recovery metadata in a separate `recoveryInfo` JSONB column if you prefer schema isolation.

---

### Issue 5: Inngest concurrency `scope` deviates from spec

**Location:** `src/inngest/functions/orchestrator/session-run.ts` lines 71-82

**Problem:** T015 specifies `scope: "env"` for the per-tenant concurrency key. The implementation uses `scope: 'fn'`. In Inngest v3:
- `scope: 'fn'` limits concurrency within this function (per-function key grouping)
- `scope: 'env'` limits concurrency across the entire Inngest environment (cross-function)

For a single-function orchestrator, `fn` scope is functionally equivalent for the current use case. However, it diverges from the spec's explicit example. The spec also uses `key: "tenant/{{ event.data.tenantId }}"` (Go template syntax) while the implementation uses `key: 'event.data.tenantId'` (CEL expression). Inngest v3 accepts both syntaxes — the CEL expression form is correct and more idiomatic for the SDK.

**Action required:** Either update the implementation to match the spec (`scope: 'env'`) with a code comment explaining the tradeoff, or update the spec to reflect the chosen approach. This is a documentation/alignment issue more than a functional bug.

---

## What Passed

- Tenant isolation: every query includes `tenantId` in the WHERE clause. `getSession` returns null on mismatch (no timing leak). `listSessions` always leads with `eq(orchestratorSessions.tenantId, tenantId)`.
- State machine: valid transitions are accepted; `completed` and `failed` are correctly terminal; `InvalidStatusTransitionError` is thrown with a clear message.
- Schema: tables match data-model.md (except missing `cancelled` — see Issue 1). Indexes are correct. UNIQUE constraint on `(sessionId, sequence)` is present.
- Drizzle query builder used throughout — no raw SQL in service layer.
- Inngest function registers in `createAllFunctions()`. Typed event schemas added to `client.ts`. Step-based design is correct for crash recovery via replay.
- Per-tenant and global concurrency limits are configurable via environment variables.
- `findAllOrphanedSessions()` uses correct heuristic (stale `updatedAt` on `running` status).
- cuid2 vs UUID deviation is correctly documented and consistent with the existing codebase convention.
- Migration is complete and matches the schema definition.
- Tests cover create, getSession isolation, all valid transitions, all invalid transitions, completedAt setting, pagination, and orphan detection.
- No scope creep: changes are limited to orchestrator files plus minimal additions to `client.ts`, `index.ts`, `db/client.ts`, and `drizzle.config.ts`.
