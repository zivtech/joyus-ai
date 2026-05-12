---
work_package_id: WP01
title: Session & Tenant Foundation
dependencies:
- WP00
requirement_refs:
- FR-001
- FR-005
- FR-006
planning_base_branch: claude/platform-core-orchestrator
merge_target_branch: claude/platform-core-orchestrator
branch_strategy: Planning artifacts for this feature were generated on claude/platform-core-orchestrator. During /spec-kitty.implement this WP may branch from a dependency-specific base, but completed changes must merge back into claude/platform-core-orchestrator unless the human explicitly redirects the landing branch.
subtasks:
- T009
- T010
- T011
- T012
- T013
- T014
- T015
agent: "claude:opus:orchestrator:reviewer"
shell_pid: "1980"
history:
- date: '2026-05-12'
  action: created
  agent: planner
authoritative_surface: joyus-ai-mcp-server/src/orchestrator/
execution_mode: code_change
owned_files:
- joyus-ai-mcp-server/src/orchestrator/session.service.ts
- joyus-ai-mcp-server/src/orchestrator/middleware/tenant.ts
- joyus-ai-mcp-server/src/orchestrator/types.ts
- joyus-ai-mcp-server/src/db/schema/orchestrator.ts
- joyus-ai-mcp-server/src/inngest/functions/orchestrator/session-run.ts
tags: []
---

# WP01: Session & Tenant Foundation

## Objective

Build the foundational data layer and session lifecycle for the orchestrator. After this WP, sessions can be created, tracked through status transitions, persisted to PostgreSQL, and recovered after crashes — all scoped to a tenant.

## Context

- **Architecture decision from WP00** determines whether the agent semantics layer uses Mastra or custom TypeScript. This WP builds the foundation that both paths share.
- **Existing DB:** `joyus-ai-mcp-server/src/db/schema.ts` and `src/db/client.ts` — extend, don't replace
- **Existing Inngest:** `src/inngest/client.ts`, `src/inngest/registry.ts` — register new functions here
- **Existing auth:** `src/auth/` — tenant context extraction already exists; wrap it for orchestrator use
- **Data model:** See `data-model.md` for schema definitions

## Subtasks

### T009: Add Orchestrator Tables to Drizzle Schema

**Purpose:** Define the sessions and turns tables that all other WPs build on.

**Steps:**
1. Create `src/db/schema/orchestrator.ts` (new file — don't modify existing schema.ts directly)
2. Define `sessions` table per data-model.md:
   - id (UUID, PK), tenantId (UUID, FK, NOT NULL), userId (UUID, NOT NULL), status (enum: pending/running/suspended/completed/failed), metadata (JSONB), inngestRunId (VARCHAR, nullable), createdAt, updatedAt, completedAt (nullable)
   - Indexes: (tenantId, status), (tenantId, userId, createdAt DESC)
3. Define `turns` table per data-model.md:
   - id (UUID, PK), sessionId (UUID, FK), tenantId (UUID, denormalized), sequence (INTEGER), role (enum: user/assistant/tool), content (TEXT, nullable), toolCalls (JSONB, nullable), toolResults (JSONB, nullable), tokenUsage (JSONB, nullable), createdAt
   - Indexes: (sessionId, sequence), UNIQUE (sessionId, sequence)
4. Export from `src/db/schema/orchestrator.ts` and re-export from `src/db/schema.ts` (or index)
5. Define Zod schemas for the enum types and JSONB fields in `src/orchestrator/types.ts`

**Files:**
- `src/db/schema/orchestrator.ts` (new, ~80 lines)
- `src/orchestrator/types.ts` (new, ~60 lines)

### T010: Create Database Migration

**Purpose:** Generate and verify the migration that creates the orchestrator tables.

**Steps:**
1. Run `pnpm drizzle-kit generate` to create the migration SQL
2. Review the generated SQL — verify indexes, constraints, enum types
3. Run `pnpm drizzle-kit migrate` against the dev database
4. Verify tables exist with correct structure: `\dt` and `\d sessions`

**Files:** `src/db/migrations/XXXX_orchestrator_tables.sql` (generated)

### T011: Implement Session Service

**Purpose:** Core CRUD service for session lifecycle, all queries tenant-scoped.

**Steps:**
1. Create `src/orchestrator/session.service.ts`
2. Implement methods:
   - `createSession(tenantId, userId, metadata?)` → Session
   - `getSession(tenantId, sessionId)` → Session | null (always filter by tenantId)
   - `updateSessionStatus(tenantId, sessionId, newStatus)` → Session (validate state transition)
   - `listSessions(tenantId, filters: { status?, userId?, limit, cursor })` → { items, cursor }
3. State transition validation: enforce the state machine from data-model.md
   - Valid: pending→running, running→suspended, running→completed, running→failed, suspended→running, pending→cancelled
   - Invalid: completed→running, failed→pending, etc.
4. All queries MUST include `WHERE tenantId = ?` — never query sessions without tenant scope
5. Use Drizzle's query builder, not raw SQL

**Files:** `src/orchestrator/session.service.ts` (new, ~120 lines)

### T012: Implement Tenant Scoping Middleware

**Purpose:** Extract tenantId from JWT and make it available to all orchestrator handlers.

**Steps:**
1. Create `src/orchestrator/middleware/tenant.ts`
2. Middleware extracts tenantId from the JWT claims (existing auth infrastructure provides JWT parsing)
3. Attach tenantId to `req.tenantId` (extend Express Request type)
4. If tenantId is missing from JWT, return 401
5. Never read tenantId from request body, query params, or headers — only from JWT claims
6. Export a typed helper: `getTenantId(req: Request): string` that throws if missing

**Files:** `src/orchestrator/middleware/tenant.ts` (new, ~40 lines)

### T013: Create Inngest Session-Run Function

**Purpose:** Model each session as a durable Inngest function run.

**Steps:**
1. Create `src/inngest/functions/orchestrator/session-run.ts`
2. Define function triggered by event `orchestrator/session.created`
3. Event payload: `{ sessionId, tenantId, userId }`
4. Function body:
   - `step.run("init")`: Update session status to "running", record inngestRunId
   - Main loop placeholder (WP02 fills this in): await messages, invoke agent
   - `step.run("complete")`: Update session status to "completed"
5. On function failure: Update session status to "failed"
6. Register in `src/inngest/registry.ts`

**Files:**
- `src/inngest/functions/orchestrator/session-run.ts` (new, ~60 lines)
- `src/inngest/registry.ts` (modify — add registration)

### T014: Implement Crash Recovery

**Purpose:** Ensure sessions survive orchestrator process crashes.

**Steps:**
1. Design checkpoint strategy: each meaningful state change is a separate `step.run()` call
2. After crash + restart, Inngest replays the function from the last completed step
3. Verify: session status is updated before the checkpoint, not after
4. Add startup recovery check: on service start, query for sessions with status "running" that have no active Inngest run — these are orphaned from a previous crash
5. Orphaned sessions: either re-dispatch to Inngest or mark as "failed" with a recovery event

**Files:** `src/orchestrator/session.service.ts` (extend with recovery methods)

### T015: Per-Tenant Concurrency Controls

**Purpose:** Prevent one tenant from consuming all orchestrator capacity.

**Steps:**
1. Configure Inngest function concurrency using the `concurrency` option:
   ```typescript
   concurrency: [{
     scope: "env",
     key: "tenant/{{ event.data.tenantId }}",
     limit: 10  // configurable per deployment
   }]
   ```
2. When a tenant exceeds the limit, new sessions are queued (not rejected)
3. Add a global concurrency limit as well (total across all tenants)
4. Log when a tenant hits their concurrency limit (emit a typed event for observability)

**Files:** `src/inngest/functions/orchestrator/session-run.ts` (modify — add concurrency config)

## Definition of Done

- [ ] Sessions can be created, queried, and transitioned through all valid statuses
- [ ] All session queries are tenant-scoped (no query runs without tenantId)
- [ ] Invalid state transitions are rejected with clear error messages
- [ ] Inngest session-run function registers and triggers on session creation
- [ ] After simulated process crash, orphaned sessions are detected on restart
- [ ] Per-tenant concurrency limits prevent one tenant from starving others
- [ ] Database migration runs cleanly on a fresh database

## Risks

| Risk | Mitigation |
|------|-----------|
| Existing schema.ts structure doesn't support separate schema files | Check existing pattern; may need to adjust import structure |
| Inngest concurrency config syntax changes between versions | Pin Inngest SDK version; test concurrency in spike (WP00) |

## Reviewer Guidance

- **Tenant isolation is the #1 check:** Every query MUST include tenantId. Grep for any query that touches sessions/turns without a tenantId filter.
- **State machine:** Verify all valid transitions are implemented and all invalid ones are rejected.
- **No raw SQL:** All queries through Drizzle query builder.

## Activity Log

- 2026-05-12T20:27:51Z – claude:opus:orchestrator:implementer – shell_pid=62861 – Started implementation via action command
- 2026-05-12T20:36:06Z – claude:opus:orchestrator:implementer – shell_pid=62861 – Ready for review: session foundation complete — schema, state-machine service, tenant middleware, durable Inngest function, crash recovery, concurrency controls. 25 unit tests passing.
- 2026-05-12T20:36:29Z – claude:opus:orchestrator:reviewer – shell_pid=21064 – Started review via action command
- 2026-05-12T20:41:18Z – claude:opus:orchestrator:reviewer – shell_pid=21064 – Moved to planned
- 2026-05-12T20:41:41Z – claude:opus:orchestrator:implementer – shell_pid=65789 – Started implementation via action command
- 2026-05-12T20:48:05Z – claude:opus:orchestrator:implementer – shell_pid=65789 – Cycle 2: fixed all 3 blocking issues — cancelled status, crash recovery wired, queued event emitted
- 2026-05-12T20:48:25Z – claude:opus:orchestrator:reviewer – shell_pid=1980 – Started review via action command
- 2026-05-12T20:49:55Z – claude:opus:orchestrator:reviewer – shell_pid=1980 – Review passed: all 3 cycle-1 blocking issues resolved — cancelled status in enum/transitions/migration SQL; orchestrator/session.queued emitted from createSession when tenant hits concurrency limit; crash recovery wired into server startup via runCrashRecovery(). Non-blocking items also addressed: markOrphanedAsFailed merges metadata via COALESCE+|| rather than overwriting; concurrency scope deviation (fn vs env) is documented with rationale.
