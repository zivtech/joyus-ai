---
work_package_id: WP03
title: Event System & Notification Routing
dependencies:
- WP01
requirement_refs:
- FR-004
- FR-013
planning_base_branch: claude/platform-core-orchestrator
merge_target_branch: claude/platform-core-orchestrator
branch_strategy: Planning artifacts for this feature were generated on claude/platform-core-orchestrator. During /spec-kitty.implement this WP may branch from a dependency-specific base, but completed changes must merge back into claude/platform-core-orchestrator unless the human explicitly redirects the landing branch.
subtasks:
- T022
- T023
- T024
- T025
- T026
- T027
agent: "claude:opus:orchestrator:reviewer"
shell_pid: "2892"
history:
- date: '2026-05-12'
  action: created
  agent: planner
authoritative_surface: joyus-ai-mcp-server/src/orchestrator/
execution_mode: code_change
owned_files:
- joyus-ai-mcp-server/src/orchestrator/event.service.ts
- joyus-ai-mcp-server/src/orchestrator/notification.service.ts
- joyus-ai-mcp-server/src/db/schema/events.ts
tags: []
---

# WP03: Event System & Notification Routing

## Objective

Build the typed event system that records all state changes and supports real-time external subscription via SSE. After this WP, every session lifecycle transition, tool call result, and error is recorded as a typed event, and external consumers can subscribe to filtered event streams.

## Context

- **WP01 provides:** Session service, tenant middleware, database infrastructure
- **Runs in parallel with WP02** — no dependency on the agent loop
- **FR-004 (Event System)** and **FR-013 (Notification Routing)** — one emission path, two consumers
- **Gas City pattern:** Typed event registry where every event type is explicitly registered with a schema
- **Data model:** Events table is append-only with BIGSERIAL sequence for replay

## Subtasks

### T022: Add Events Table to Drizzle Schema

**Purpose:** Define the append-only events table.

**Steps:**
1. Create `src/db/schema/events.ts` (or extend `orchestrator.ts` from WP01)
2. Define `events` table per data-model.md:
   - id (UUID, PK), tenantId (UUID, NOT NULL), sessionId (UUID, nullable), type (VARCHAR(100), NOT NULL), payload (JSONB, NOT NULL), sequence (BIGSERIAL, NOT NULL), createdAt (TIMESTAMP, NOT NULL)
   - Indexes: (tenantId, type, createdAt), (sessionId, sequence), (sequence)
3. This table is append-only: no UPDATE or DELETE operations. Enforce via service layer (no DB-level constraint needed).

**Files:** `src/db/schema/events.ts` (new, ~30 lines)

### T023: Create Database Migration

**Purpose:** Generate migration for the events table.

**Steps:**
1. Run `pnpm drizzle-kit generate`
2. Review generated SQL — verify indexes and sequence
3. Run migration against dev database
4. Verify: `\d events` shows correct structure

**Files:** `src/db/migrations/XXXX_events_table.sql` (generated)

### T024: Implement Typed Event Registry

**Purpose:** Enforce that every event type has a registered schema — no ad hoc events.

**Steps:**
1. In `src/orchestrator/event.service.ts`, create an event registry:
   ```typescript
   const eventRegistry = new Map<string, ZodSchema>();

   function registerEventType(type: string, payloadSchema: ZodSchema) {
     eventRegistry.set(type, payloadSchema);
   }
   ```
2. Register core event types:
   - `session.created` — `{ sessionId, tenantId, userId }`
   - `session.status_changed` — `{ sessionId, tenantId, previousStatus, newStatus }`
   - `session.completed` — `{ sessionId, tenantId, turnCount, totalTokens }`
   - `session.failed` — `{ sessionId, tenantId, error }`
   - `tool.called` — `{ sessionId, tenantId, toolName, input }`
   - `tool.completed` — `{ sessionId, tenantId, toolName, durationMs }`
   - `tool.failed` — `{ sessionId, tenantId, toolName, error }`
   - `orchestrator.context_window.high_utilization` — `{ sessionId, tenantId, utilizationPct }`
3. `emitEvent()` must validate the payload against the registered schema before inserting
4. Attempting to emit an unregistered event type throws an error

**Files:** `src/orchestrator/event.service.ts` (new, ~100 lines)

### T025: Implement Event Emission and Query Service

**Purpose:** Emit events to the database and query them with filters.

**Steps:**
1. `emitEvent(tenantId, type, payload, sessionId?)`:
   - Validate payload against registered schema
   - Insert into events table
   - Return the created event with its sequence number
2. `queryEvents(tenantId, filters: { sessionId?, types?, since?, limit?, afterSequence? })`:
   - Always filter by tenantId
   - Optional filters: sessionId, event types (array), createdAt since, after sequence number
   - Order by sequence ASC
   - Cursor-based pagination using sequence number
3. `replayEvents(tenantId, fromSequence)`:
   - Return all events with sequence > fromSequence for the tenant
   - Used for SSE reconnection (client sends `Last-Event-ID`)

**Files:** `src/orchestrator/event.service.ts` (extend, ~60 lines additional)

### T026: Implement SSE Streaming for External Consumers

**Purpose:** External systems can subscribe to event streams in real time.

**Steps:**
1. Create SSE endpoint handler (used by WP06 to wire up routes):
   - Accept filters: sessionId, event types, Last-Event-ID for resumption
   - On connection: send any events since Last-Event-ID (replay gap)
   - Then: poll for new events every 1 second (simple polling; PostgreSQL LISTEN/NOTIFY is Phase 2)
   - Send events as SSE format: `id: {sequence}\nevent: {type}\ndata: {JSON payload}\n\n`
2. Handle client disconnect: clean up polling interval
3. Send heartbeat comment every 15 seconds: `: heartbeat\n\n`
4. Respect tenant isolation: only events for the authenticated tenant

**SSE format:**
```
id: 42
event: session.status_changed
data: {"sessionId":"...","tenantId":"...","previousStatus":"pending","newStatus":"running"}

: heartbeat

id: 43
event: tool.completed
data: {"sessionId":"...","tenantId":"...","toolName":"search","durationMs":234}
```

**Files:** `src/orchestrator/event.service.ts` (extend with SSE handler, ~60 lines)

### T027: Implement Notification Routing

**Purpose:** Forward eligible FR-004 events to the gateway event bus for external notification delivery.

**Steps:**
1. Create `src/orchestrator/notification.service.ts`
2. Define routable event classes (configurable per tenant, hardcoded defaults for now):
   - `session.completed` → routable
   - `session.failed` → routable
   - `tool.failed` → routable (after circuit breaker triggers)
3. After each event is emitted (in `emitEvent()`), check if it's routable
4. If routable: forward to the gateway event bus
   - For now: stub the gateway call (log the event that would be forwarded)
   - Real gateway integration comes when Spec 014 is ready
5. Notification routing MUST NOT delay the primary event emission — fire-and-forget pattern

**Files:** `src/orchestrator/notification.service.ts` (new, ~40 lines)

## Definition of Done

- [ ] Events are emitted for all session lifecycle transitions
- [ ] Unregistered event types are rejected with an error
- [ ] Event payloads are validated against their registered Zod schema
- [ ] External consumer can subscribe via SSE and receive events in real time
- [ ] SSE reconnection with Last-Event-ID replays missed events
- [ ] Routable events are forwarded to the notification service (stubbed gateway)
- [ ] All event queries are tenant-scoped

## Risks

| Risk | Mitigation |
|------|-----------|
| Polling-based SSE has latency vs LISTEN/NOTIFY | 1-second polling is acceptable for v1; upgrade to LISTEN/NOTIFY in Phase 2 |
| Event table grows unbounded | Not a v1 concern; add retention policy when table exceeds 10M rows |

## Reviewer Guidance

- **Append-only enforcement:** Verify no UPDATE or DELETE on the events table anywhere in the code.
- **Schema validation:** Every `emitEvent` call should pass through schema validation. No bypass.
- **SSE format:** Verify `id:`, `event:`, and `data:` fields are correctly formatted. Missing newlines break SSE parsing.
- **Tenant isolation:** Event queries MUST filter by tenantId. SSE streams MUST only send tenant-scoped events.

## Activity Log

- 2026-05-12T21:05:13Z – claude:opus:orchestrator:implementer – shell_pid=75358 – Started implementation via action command
- 2026-05-12T21:13:18Z – claude:opus:orchestrator:implementer – shell_pid=75358 – Event system complete: typed registry, SSE subscription, notification routing
- 2026-05-12T21:13:35Z – claude:opus:orchestrator:reviewer – shell_pid=2892 – Started review via action command
