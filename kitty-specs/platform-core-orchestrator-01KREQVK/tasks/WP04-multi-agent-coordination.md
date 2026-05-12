---
work_package_id: WP04
title: Multi-Agent Coordination
dependencies:
- WP01
- WP03
requirement_refs:
- FR-003
planning_base_branch: claude/platform-core-orchestrator
merge_target_branch: claude/platform-core-orchestrator
branch_strategy: Planning artifacts for this feature were generated on claude/platform-core-orchestrator. During /spec-kitty.implement this WP may branch from a dependency-specific base, but completed changes must merge back into claude/platform-core-orchestrator unless the human explicitly redirects the landing branch.
subtasks:
- T028
- T029
- T030
- T031
- T032
- T033
agent: "claude:opus:orchestrator:reviewer"
shell_pid: "15496"
history:
- date: '2026-05-12'
  action: created
  agent: planner
authoritative_surface: joyus-ai-mcp-server/src/orchestrator/
execution_mode: code_change
owned_files:
- joyus-ai-mcp-server/src/orchestrator/coordination.service.ts
- joyus-ai-mcp-server/src/db/schema/coordination.ts
- joyus-ai-mcp-server/src/inngest/functions/orchestrator/coordination.ts
tags: []
---

# WP04: Multi-Agent Coordination

## Objective

Build the work unit and coordination group system that allows multiple agents to collaborate on complex tasks. After this WP, work units can be created with dependencies, grouped into coordination groups with completion policies, and agents can send typed messages to each other via Inngest events.

## Context

- **WP01 provides:** Session service, tenant middleware, database layer
- **WP03 provides:** Event system for coordination lifecycle events
- **Gas City pattern:** Beads (work units) with status, dependencies, labels, metadata
- **Temporal pattern:** Signals for inter-agent messaging without shared mutable state
- **Data model:** work_units and coordination_groups tables from data-model.md

## Subtasks

### T028: Add Coordination Tables to Drizzle Schema

**Purpose:** Define work_units and coordination_groups tables.

**Steps:**
1. Create `src/db/schema/coordination.ts`
2. Define `coordination_groups` table:
   - id (UUID, PK), tenantId (UUID, NOT NULL), title (VARCHAR(255)), completionPolicy (enum: all/any/majority), status (enum: active/completed/failed), metadata (JSONB), createdAt, completedAt (nullable)
   - Index: (tenantId, status)
3. Define `work_units` table:
   - id (UUID, PK), tenantId (UUID, NOT NULL), sessionId (UUID, nullable FK), coordinationGroupId (UUID, nullable FK), status (enum: pending/assigned/running/completed/failed/cancelled), title (VARCHAR(255)), type (VARCHAR(100)), assignee (VARCHAR(255), nullable), dependencies (UUID array), labels (VARCHAR array), metadata (JSONB), createdAt, updatedAt, completedAt (nullable)
   - Indexes: (tenantId, status), (coordinationGroupId), (tenantId, sessionId)

**Files:** `src/db/schema/coordination.ts` (new, ~60 lines)

### T029: Create Database Migration

**Purpose:** Generate and run migration for coordination tables.

**Steps:**
1. Run `pnpm drizzle-kit generate`
2. Review SQL — check UUID array type, enum definitions
3. Run migration, verify table structure

**Files:** `src/db/migrations/XXXX_coordination_tables.sql` (generated)

### T030: Implement Work Unit Service

**Purpose:** CRUD operations for work units with dependency tracking.

**Steps:**
1. Create `src/orchestrator/coordination.service.ts`
2. Implement methods:
   - `createWorkUnit(tenantId, { title, type, sessionId?, coordinationGroupId?, dependencies?, labels?, metadata? })` → WorkUnit
   - `getWorkUnit(tenantId, workUnitId)` → WorkUnit | null
   - `updateWorkUnit(tenantId, workUnitId, { status?, assignee?, metadata? })` → WorkUnit
   - `listWorkUnits(tenantId, filters: { sessionId?, coordinationGroupId?, status? })` → WorkUnit[]
3. Dependency enforcement:
   - Before transitioning a work unit to "running", verify all dependencies are "completed"
   - If any dependency is "failed" or "cancelled", prevent the work unit from running
   - Use simple topological validation: check for cycles at creation time (reject if found)
4. Status transitions: validate against the work unit state machine
5. On status change: emit a typed event via the event service (WP03)

**Cycle detection approach:** At creation time, build a directed graph of dependencies and check for cycles using DFS. Keep it simple — O(V+E) with the small number of work units per group.

**Files:** `src/orchestrator/coordination.service.ts` (new, ~120 lines)

### T031: Implement Coordination Group Service

**Purpose:** Manage groups of work units with completion policies.

**Steps:**
1. Add to `src/orchestrator/coordination.service.ts`:
   - `createCoordinationGroup(tenantId, { title, completionPolicy?, metadata? })` → CoordinationGroup
   - `getCoordinationGroup(tenantId, groupId)` → CoordinationGroup with work units
   - `evaluateCompletion(tenantId, groupId)` → { isComplete, policy, summary }
2. Completion policies:
   - `all`: Group completes when ALL work units are completed. Fails if ANY fails.
   - `any`: Group completes when the FIRST work unit completes. Others are cancelled.
   - `majority`: Group completes when >50% of work units complete.
3. Call `evaluateCompletion` after every work unit status change within the group
4. On group completion/failure: emit a typed event, update group status

**Files:** `src/orchestrator/coordination.service.ts` (extend, ~60 lines)

### T032: Implement Inter-Agent Messaging

**Purpose:** Agents can send typed messages to other agents without shared mutable state.

**Steps:**
1. Define signal events in the event registry (from WP03):
   - `agent.signal.sent` — `{ fromSessionId, toSessionId, tenantId, signalType, payload }`
   - `agent.signal.received` — `{ sessionId, tenantId, signalType, payload }`
2. Implement `sendSignal(tenantId, fromSessionId, toSessionId, signalType, payload)`:
   - Emit an Inngest event: `orchestrator/agent.signal`
   - The target session's Inngest function receives it via `step.waitForEvent()`
3. The receiving agent's loop (WP02) checks for pending signals between tool calls
4. Signals are typed: the `signalType` determines the payload schema

**Pattern:** This mirrors Temporal's signals — fire-and-forget messages between workflows. No shared state, no locks, no races.

**Files:**
- `src/orchestrator/coordination.service.ts` (extend with signal methods, ~40 lines)
- `src/inngest/functions/orchestrator/coordination.ts` (new, signal handling)

### T033: Create Inngest Coordination Lifecycle Function

**Purpose:** Manage work unit lifecycle as durable functions.

**Steps:**
1. Create `src/inngest/functions/orchestrator/coordination.ts`
2. Define function triggered by `orchestrator/work_unit.status_changed`
3. On work unit completion or failure:
   - Check if the work unit belongs to a coordination group
   - If yes, evaluate the group's completion policy
   - If group is now complete: emit `coordination_group.completed` event
   - If group has failed: emit `coordination_group.failed` event
4. Register in the Inngest function registry

**Files:**
- `src/inngest/functions/orchestrator/coordination.ts` (new, ~50 lines)
- `src/inngest/registry.ts` (modify — add registration)

## Definition of Done

- [ ] Work units can be created with typed dependencies
- [ ] Dependency cycles are detected and rejected at creation time
- [ ] Work units cannot start until all dependencies are completed
- [ ] Coordination groups correctly evaluate all/any/majority completion policies
- [ ] Agents can send signals to other agents via Inngest events
- [ ] All coordination operations are tenant-scoped
- [ ] Status changes emit typed events via the event service

## Risks

| Risk | Mitigation |
|------|-----------|
| UUID array type may have ORM quirks | Test with Drizzle's array support; fall back to junction table if needed |
| Inngest waitForEvent timeout for signals | Set reasonable timeout (5 min default); expired signals logged as warnings |

## Reviewer Guidance

- **Dependency cycles:** Verify cycle detection runs on creation, not just on status transition.
- **Completion policy edge cases:** What happens if a group has zero work units? (Should reject at creation.)
- **Signal isolation:** Verify signals cannot be sent across tenants.

## Activity Log

- 2026-05-12T21:17:48Z – claude:opus:orchestrator:implementer – shell_pid=24004 – Started implementation via action command
- 2026-05-12T21:30:36Z – claude:opus:orchestrator:implementer – shell_pid=24004 – Coordination system: work units, groups, completion policies, 35+ tests
- 2026-05-12T21:30:42Z – claude:opus:orchestrator:reviewer – shell_pid=63688 – Started review via action command
- 2026-05-12T21:35:13Z – claude:opus:orchestrator:reviewer – shell_pid=63688 – Moved to planned
- 2026-05-12T21:35:36Z – claude:opus:orchestrator:implementer – shell_pid=96229 – Started implementation via action command
- 2026-05-12T21:40:18Z – claude:opus:orchestrator:implementer – shell_pid=96229 – Cycle 2: DB mocks fixed, 38/38 tests pass
- 2026-05-12T21:40:19Z – claude:opus:orchestrator:reviewer – shell_pid=15496 – Started review via action command
- 2026-05-12T21:41:30Z – claude:opus:orchestrator:reviewer – shell_pid=15496 – Review passed: coordination system with 38/38 tests
