---
work_package_id: WP02
title: Event Bus
lane: planned
dependencies: []
subtasks: [T008, T009, T010, T011]
phase: Phase B - Event & Trigger Layer
assignee: ''
agent: ''
shell_pid: ''
review_status: ''
reviewed_by: ''
history:
- timestamp: '2026-03-10T00:00:00Z'
  lane: planned
  agent: system
  action: Prompt generated via /spec-kitty.tasks
---

# WP02: Event Bus

## Objective

Build the event bus abstraction layer and its PostgreSQL LISTEN/NOTIFY implementation. The event bus provides delivery-guaranteed event publishing and subscription, using the `trigger_events` table as the source of truth and NOTIFY as a low-latency wakeup signal for the executor's poll loop.

## Implementation Command

```bash
spec-kitty implement WP02 --base WP01
```

## Context

- **Spec**: `kitty-specs/009-automated-pipelines-framework/spec.md` (FR-001: event-driven triggers)
- **Research**: `kitty-specs/009-automated-pipelines-framework/research.md` (R1: Event Bus Patterns)
- **Data Model**: `kitty-specs/009-automated-pipelines-framework/data-model.md` (TriggerEvent table)

The event bus is the pipeline framework's primary event delivery mechanism. It sits between trigger handlers (which detect events like corpus changes) and the pipeline executor (which picks up events and runs pipelines). The `EventBus` interface abstracts the transport so it can be swapped to Redis Streams or RabbitMQ in the future without changing any consumer code.

**Key design decisions from research.md (R1)**:
- Events are persisted to `trigger_events` table BEFORE NOTIFY is sent (delivery guarantee)
- NOTIFY is an optimization — reduces poll latency but is not required for correctness
- Poll loop is the primary consumption mechanism (handles NOTIFY loss on connection drop)
- LISTEN requires a dedicated `pg.Client` (not from the connection pool)
- NOTIFY payload is limited to 8000 bytes — pass only the event ID, not the full payload

---

## Subtask T008: Define EventBus Interface and EventEnvelope Types

**Purpose**: Define the transport-agnostic event bus contract that all implementations must fulfill.

**Steps**:
1. Create `joyus-ai-mcp-server/src/pipelines/event-bus/interface.ts`
2. Define the `EventBus` interface:
   ```typescript
   export interface EventBus {
     /** Publish an event. MUST persist before returning (delivery guarantee). */
     publish(event: EventEnvelope): Promise<string>; // returns event ID

     /** Subscribe to events of a given type. */
     subscribe(eventType: string, handler: EventHandler): void;

     /** Remove a subscription. */
     unsubscribe(eventType: string): void;

     /** Start listening. Call after all subscriptions are registered. */
     start(): Promise<void>;

     /** Stop listening and clean up resources. */
     stop(): Promise<void>;
   }
   ```
3. Import and re-export `EventEnvelope` from `../types.js` (already defined in T002)
4. Define `EventHandler` type:
   ```typescript
   export type EventHandler = (event: EventEnvelope) => Promise<void>;
   ```
5. Define `EventBusConfig` interface:
   ```typescript
   export interface EventBusConfig {
     pollIntervalMs?: number;      // Default: 30000 (30s)
     staleEventThresholdMs?: number; // Default: 10000 (10s) — events older than this are picked up by poll
     channelName?: string;          // Default: 'pipeline_events'
   }
   ```

**Files**:
- `joyus-ai-mcp-server/src/pipelines/event-bus/interface.ts` (new, ~50 lines)

**Validation**:
- [ ] `npm run typecheck` passes
- [ ] Interface is importable from `../event-bus/interface.js`

---

## Subtask T009: Implement PgNotifyBus

**Purpose**: Implement the EventBus interface using PostgreSQL LISTEN/NOTIFY with the trigger_events table as the durable queue.

**Steps**:
1. Create `joyus-ai-mcp-server/src/pipelines/event-bus/pg-notify-bus.ts`
2. Implement `PgNotifyBus` class implementing `EventBus`:
3. **Constructor**: Accept a `pg.Pool` and optional `EventBusConfig`. Store handler map (`Map<string, EventHandler>`).
4. **publish(event)**:
   - INSERT the event into the `trigger_events` table with status `pending` using the Drizzle client
   - After successful insert, execute `NOTIFY pipeline_events, '<event_id>'` via raw SQL
   - Return the event ID
   - If INSERT fails, throw (caller handles)
   - If NOTIFY fails after INSERT succeeds, log warning but don't throw (event is persisted, poll will pick it up)
5. **subscribe(eventType, handler)**:
   - Store the handler in the internal map keyed by eventType
6. **unsubscribe(eventType)**:
   - Remove the handler from the internal map
7. **start()**:
   - Acquire a dedicated `pg.Client` from the pool (call `pool.connect()` — this client is held for the lifetime of the bus)
   - Execute `LISTEN pipeline_events` on the dedicated client
   - Register notification handler: `client.on('notification', async (msg) => { ... })`
     - On notification: extract event_id from `msg.payload`
     - Query `trigger_events` by ID
     - If event exists and status is `pending`: update status to `acknowledged`, update `acknowledgedAt`
     - Look up handler by `event.eventType`, call it
     - After handler completes: update status to `processed`, update `processedAt`
     - On handler error: update status to `failed`, log error
   - Start poll loop (`setInterval`):
     - Query `trigger_events` WHERE `status = 'pending'` AND `receivedAt < now() - staleEventThresholdMs` ORDER BY `receivedAt` ASC LIMIT 10
     - Process each event same as notification handler above
     - This catches events where NOTIFY was lost
8. **stop()**:
   - Clear the poll interval
   - Execute `UNLISTEN pipeline_events` on the dedicated client
   - Release the dedicated client back to the pool
   - Clear the handler map

**Important implementation details**:
- The dedicated LISTEN client must handle disconnection: on `error` event, attempt to reconnect and re-LISTEN
- NOTIFY payload is just the event ID string (not JSON) — keeps under 8000 byte limit
- Poll loop and NOTIFY handler must not process the same event twice — the `status = 'pending'` check in the WHERE clause prevents this (once acknowledged, it won't be polled)
- Use a simple mutex/flag to prevent concurrent poll executions if a poll cycle takes longer than the interval

**Files**:
- `joyus-ai-mcp-server/src/pipelines/event-bus/pg-notify-bus.ts` (new, ~200 lines)

**Validation**:
- [ ] `npm run typecheck` passes
- [ ] publish() persists event to trigger_events table before NOTIFY
- [ ] start() acquires dedicated client and begins LISTEN
- [ ] Notification handler processes events and updates status
- [ ] Poll loop picks up stale pending events
- [ ] stop() cleans up resources properly

---

## Subtask T010: Create Bus Factory and Barrel Export

**Purpose**: Provide a factory function for creating the event bus and a barrel export for the module.

**Steps**:
1. Create `joyus-ai-mcp-server/src/pipelines/event-bus/index.ts`
2. Implement factory function:
   ```typescript
   import { Pool } from 'pg';
   import { EventBus, EventBusConfig } from './interface.js';
   import { PgNotifyBus } from './pg-notify-bus.js';

   export function createEventBus(pool: Pool, config?: EventBusConfig): EventBus {
     return new PgNotifyBus(pool, config);
   }
   ```
3. Re-export all types from interface:
   ```typescript
   export type { EventBus, EventHandler, EventBusConfig } from './interface.js';
   export { PgNotifyBus } from './pg-notify-bus.js';
   ```
4. Update `src/pipelines/index.ts` to export from event-bus:
   ```typescript
   export * from './event-bus/index.js';
   ```

**Files**:
- `joyus-ai-mcp-server/src/pipelines/event-bus/index.ts` (new, ~15 lines)
- `joyus-ai-mcp-server/src/pipelines/index.ts` (modify — add event-bus export)

**Validation**:
- [ ] `npm run typecheck` passes
- [ ] `createEventBus` is importable from `../pipelines/index.js`

---

## Subtask T011: Unit Tests for PgNotifyBus

**Purpose**: Verify event bus correctness: publish persists, notifications trigger handlers, poll loop catches stale events.

**Steps**:
1. Create `joyus-ai-mcp-server/tests/pipelines/event-bus/pg-notify-bus.test.ts`
2. Test cases:
   - **publish() persists event**: Call publish, verify trigger_events row exists with status `pending`
   - **publish() returns event ID**: Verify returned ID matches the row in trigger_events
   - **subscribe() registers handler**: Subscribe to 'corpus_change', publish a corpus_change event, verify handler is called with correct EventEnvelope
   - **unsubscribe() removes handler**: Subscribe, unsubscribe, publish — verify handler is NOT called
   - **poll loop picks up stale events**: Insert a trigger_event with status `pending` and old receivedAt timestamp, start the bus with a short poll interval, verify the event is processed
   - **duplicate processing prevention**: Process an event via notification, verify poll loop does NOT reprocess it (status is no longer `pending`)
   - **error handling**: Subscribe a handler that throws, publish an event — verify trigger_event status is updated to `failed`
   - **stop() cleans up**: Start the bus, stop it, verify no more events are processed
3. Use Vitest mocking for the pg.Pool and pg.Client — mock `pool.connect()`, `client.on('notification')`, `client.query()`
4. For integration-style tests, mock the Drizzle db operations (insert, update, query on trigger_events table)

**Files**:
- `joyus-ai-mcp-server/tests/pipelines/event-bus/pg-notify-bus.test.ts` (new, ~200 lines)

**Validation**:
- [ ] All tests pass via `npm run test`
- [ ] Tests cover publish, subscribe, unsubscribe, poll, error handling, and cleanup
- [ ] No flaky timing-dependent tests (use fake timers for poll interval)

---

## Definition of Done

- [ ] `EventBus` interface defined with publish, subscribe, unsubscribe, start, stop
- [ ] `PgNotifyBus` implements EventBus using PostgreSQL LISTEN/NOTIFY
- [ ] Events are persisted to trigger_events table before NOTIFY (delivery guarantee)
- [ ] Poll loop catches events where NOTIFY was lost
- [ ] Factory function and barrel exports in place
- [ ] Unit tests cover all paths
- [ ] `npm run validate` passes with zero errors

## Risks

- **Dedicated LISTEN client**: Must be held for the bus lifetime. If the pool is exhausted, this client reduces available connections by 1. Mitigation: ensure pool `max` is at least 2 higher than expected concurrent queries.
- **NOTIFY payload size**: Limited to 8000 bytes. Mitigation: only send event ID in the NOTIFY payload, never the full event data.
- **Poll loop timing**: If poll interval is too short, it wastes database queries. If too long, stale events sit unprocessed. Default 30s is a reasonable compromise.

## Reviewer Guidance

- Verify publish() writes to trigger_events table BEFORE sending NOTIFY
- Check that NOTIFY payload is just the event ID (not full JSON)
- Confirm dedicated client is acquired from pool (not created as new Client)
- Verify poll loop only picks up events with `status = 'pending'` and age > staleEventThresholdMs
- Check error handling: handler errors should update event status to `failed`, not crash the bus
- Verify stop() releases the dedicated client and clears the interval
- Confirm no race condition between NOTIFY handler and poll loop processing the same event

## Activity Log
