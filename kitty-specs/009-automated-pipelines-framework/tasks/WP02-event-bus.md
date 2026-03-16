---
work_package_id: WP02
title: Event Bus
lane: "doing"
dependencies: [WP01]
base_branch: 009-automated-pipelines-framework-WP01
base_commit: 5df73eb05e3ceb65f97fdc2b2dc81790126c74e3
created_at: '2026-03-16T16:55:37.698289+00:00'
subtasks: [T008, T009, T010, T011]
shell_pid: "84181"
history:
- date: '2026-03-14'
  action: created
  agent: claude-opus
---

# WP02: Event Bus

**Implementation command**: `spec-kitty implement WP02 --base WP01`
**Target repo**: `joyus-ai`
**Dependencies**: WP01 (Schema & Foundation)
**Priority**: P1 | Can run in parallel with WP03

## Objective

Build the event bus abstraction and its PostgreSQL LISTEN/NOTIFY implementation. Events are the nervous system of the pipeline engine: corpus-change events from Spec 006, manual trigger requests, and schedule firings all flow through the bus. Delivery is guaranteed via the `trigger_events` queue table — NOTIFY wakes up listeners, but the queue is the source of truth.

## Context

The platform already uses PostgreSQL (Drizzle + pg pool) for all persistence. Rather than introducing a new message broker (Redis, RabbitMQ), the event bus uses PostgreSQL's native LISTEN/NOTIFY for low-latency wake-ups combined with the `trigger_events` table as a durable queue. This is the same pattern used by many production Node.js + Postgres systems.

**Key constraint**: `LISTEN` requires a dedicated, persistent `pg.Client` — it cannot use a connection from the pool because the pool may recycle connections, killing the listener. The `PgNotifyBus` must manage its own dedicated client with reconnect logic.

**Key constraint**: `NOTIFY` payloads are limited to 8000 bytes. The bus passes only the event ID in the NOTIFY payload, not the full event. Consumers query the `trigger_events` table to fetch the full payload.

WP02 runs in parallel with WP03 (Trigger System). Both depend only on WP01.

---

## Subtasks

### T008: Define EventBus interface and EventEnvelope types (`src/pipelines/event-bus/interface.ts`)

**Purpose**: Establish the contract that all event bus implementations must satisfy so that tests can use an in-memory stub and production uses `PgNotifyBus`.

**Steps**:
1. Create `src/pipelines/event-bus/interface.ts`
2. Define `EventEnvelope` — the typed container for all events passing through the bus
3. Define `EventBus` interface with `publish`, `subscribe`, `unsubscribe`, and `close`
4. Define `EventHandler` callback type

```typescript
// src/pipelines/event-bus/interface.ts
import type { TriggerType } from '../types';

export interface EventEnvelope {
  id: string;           // UUID — matches trigger_events.id
  tenantId: string;     // UUID
  eventType: TriggerType;
  payload: Record<string, unknown>;
  createdAt: Date;
}

export type EventHandler = (event: EventEnvelope) => Promise<void>;

export interface EventBus {
  /**
   * Publish an event. Persists to trigger_events table and sends NOTIFY.
   * Returns the persisted event ID.
   */
  publish(
    tenantId: string,
    eventType: TriggerType,
    payload: Record<string, unknown>,
  ): Promise<string>;

  /**
   * Subscribe to all events matching the given type.
   * Handler is called with the full EventEnvelope after DB fetch.
   * Returns a subscription ID for unsubscribing.
   */
  subscribe(eventType: TriggerType, handler: EventHandler): string;

  /**
   * Remove a subscription by ID.
   */
  unsubscribe(subscriptionId: string): void;

  /**
   * Gracefully shut down the bus (close LISTEN connection, flush pending).
   */
  close(): Promise<void>;
}

/**
 * In-memory event bus for testing. Calls handlers synchronously in-process.
 */
export class InMemoryEventBus implements EventBus {
  private handlers = new Map<TriggerType, Map<string, EventHandler>>();
  private counter = 0;

  async publish(tenantId: string, eventType: TriggerType, payload: Record<string, unknown>): Promise<string> {
    const id = `test-event-${++this.counter}`;
    const envelope: EventEnvelope = { id, tenantId, eventType, payload, createdAt: new Date() };
    const subs = this.handlers.get(eventType);
    if (subs) {
      for (const handler of subs.values()) {
        await handler(envelope);
      }
    }
    return id;
  }

  subscribe(eventType: TriggerType, handler: EventHandler): string {
    if (!this.handlers.has(eventType)) this.handlers.set(eventType, new Map());
    const id = `sub-${++this.counter}`;
    this.handlers.get(eventType)!.set(id, handler);
    return id;
  }

  unsubscribe(subscriptionId: string): void {
    for (const subs of this.handlers.values()) {
      subs.delete(subscriptionId);
    }
  }

  async close(): Promise<void> {
    this.handlers.clear();
  }
}
```

**Files**:
- `src/pipelines/event-bus/interface.ts` (new, ~65 lines)

**Validation**:
- [ ] `tsc --noEmit` passes on `interface.ts`
- [ ] `InMemoryEventBus` implements `EventBus` without TypeScript errors
- [ ] `EventEnvelope.id` is a `string`, not `uuid` Drizzle type — this is plain TypeScript

**Edge Cases**:
- `EventHandler` returns `Promise<void>`. Bus implementations must not swallow errors — use `try/catch` around handler invocation and emit an error event or log.

---

### T009: Implement PgNotifyBus (`src/pipelines/event-bus/pg-notify-bus.ts`)

**Purpose**: Production event bus using PostgreSQL LISTEN/NOTIFY for wake-up and `trigger_events` table for durable queuing. Handles reconnection on connection loss.

**Steps**:
1. Create `src/pipelines/event-bus/pg-notify-bus.ts`
2. On construction, acquire a dedicated `pg.Client` (not from pool) and call `LISTEN pipelines_events`
3. On `publish`: INSERT into `trigger_events`, then send `NOTIFY pipelines_events, '<event_id>'`
4. On `notification` event from the pg client: fetch the full event from `trigger_events`, dispatch to matching handlers, mark `processed_at`
5. Implement reconnect: on client `error` or `end`, wait 2s and re-establish the LISTEN connection

```typescript
// src/pipelines/event-bus/pg-notify-bus.ts
import { Client } from 'pg';
import { eq, isNull } from 'drizzle-orm';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { triggerEvents } from '../schema';
import type { EventBus, EventEnvelope, EventHandler } from './interface';
import type { TriggerType } from '../types';

const NOTIFY_CHANNEL = 'pipelines_events';
const RECONNECT_DELAY_MS = 2000;

export class PgNotifyBus implements EventBus {
  private handlers = new Map<TriggerType, Map<string, EventHandler>>();
  private listenClient: Client | null = null;
  private subscriptionCounter = 0;
  private closed = false;

  constructor(
    private readonly db: NodePgDatabase<Record<string, unknown>>,
    private readonly connectionString: string,
  ) {}

  async start(): Promise<void> {
    await this.connect();
  }

  private async connect(): Promise<void> {
    if (this.closed) return;
    const client = new Client({ connectionString: this.connectionString });
    client.on('error', (err) => {
      console.error('[PgNotifyBus] LISTEN client error:', err.message);
      this.scheduleReconnect();
    });
    client.on('end', () => {
      if (!this.closed) this.scheduleReconnect();
    });
    client.on('notification', (msg) => {
      if (msg.channel === NOTIFY_CHANNEL && msg.payload) {
        void this.handleNotification(msg.payload);
      }
    });
    await client.connect();
    await client.query(`LISTEN ${NOTIFY_CHANNEL}`);
    this.listenClient = client;
  }

  private scheduleReconnect(): void {
    setTimeout(() => void this.connect(), RECONNECT_DELAY_MS);
  }

  private async handleNotification(eventId: string): Promise<void> {
    // Fetch the full event from the DB queue
    const rows = await this.db
      .select()
      .from(triggerEvents)
      .where(eq(triggerEvents.id, eventId));

    if (rows.length === 0) return;
    const row = rows[0];

    // Mark as processed first (at-least-once delivery — idempotent handlers required)
    await this.db
      .update(triggerEvents)
      .set({ processedAt: new Date() })
      .where(eq(triggerEvents.id, eventId));

    const envelope: EventEnvelope = {
      id: row.id,
      tenantId: row.tenantId,
      eventType: row.eventType as TriggerType,
      payload: row.payload as Record<string, unknown>,
      createdAt: row.createdAt,
    };

    const subs = this.handlers.get(envelope.eventType);
    if (!subs) return;

    for (const handler of subs.values()) {
      try {
        await handler(envelope);
      } catch (err) {
        console.error('[PgNotifyBus] Handler error for event', eventId, err);
      }
    }
  }

  async publish(
    tenantId: string,
    eventType: TriggerType,
    payload: Record<string, unknown>,
  ): Promise<string> {
    const [row] = await this.db
      .insert(triggerEvents)
      .values({ tenantId, eventType, payload })
      .returning({ id: triggerEvents.id });

    // NOTIFY payload is just the event ID — stays well under 8000-byte limit
    await this.db.execute(
      sql`SELECT pg_notify(${NOTIFY_CHANNEL}, ${row.id})`
    );

    return row.id;
  }

  subscribe(eventType: TriggerType, handler: EventHandler): string {
    if (!this.handlers.has(eventType)) this.handlers.set(eventType, new Map());
    const id = `sub-${++this.subscriptionCounter}`;
    this.handlers.get(eventType)!.set(id, handler);
    return id;
  }

  unsubscribe(subscriptionId: string): void {
    for (const subs of this.handlers.values()) {
      subs.delete(subscriptionId);
    }
  }

  async close(): Promise<void> {
    this.closed = true;
    if (this.listenClient) {
      await this.listenClient.end();
      this.listenClient = null;
    }
  }
}
```

**Files**:
- `src/pipelines/event-bus/pg-notify-bus.ts` (new, ~95 lines)

**Validation**:
- [ ] `tsc --noEmit` passes on `pg-notify-bus.ts`
- [ ] `PgNotifyBus` implements `EventBus` interface without TypeScript errors
- [ ] `LISTEN` call uses the `NOTIFY_CHANNEL` constant, not a hardcoded string
- [ ] `publish` inserts into `trigger_events` before sending `pg_notify`
- [ ] `handleNotification` marks `processed_at` before dispatching to handlers

**Edge Cases**:
- `pg.Client` vs pool: The LISTEN client must be a standalone `Client` — using a pool connection will break because the pool recycles connections. Do not use `db` (the Drizzle pool) for LISTEN.
- At-least-once delivery: if the server restarts between NOTIFY and `handleNotification`, the event stays in `trigger_events` with `processed_at = null`. The executor's poll loop (WP04) recovers unprocessed events on startup.
- The `sql` template tag for `pg_notify` must be imported from `drizzle-orm`.

---

### T010: Create bus factory and barrel export (`src/pipelines/event-bus/index.ts`)

**Purpose**: Provide a factory function that returns the correct `EventBus` implementation based on environment, and re-export all public types.

**Steps**:
1. Create `src/pipelines/event-bus/index.ts`
2. Export `createEventBus` factory: returns `PgNotifyBus` in production, `InMemoryEventBus` in test
3. Re-export `EventBus`, `EventEnvelope`, `EventHandler`, `InMemoryEventBus`

```typescript
// src/pipelines/event-bus/index.ts
export type { EventBus, EventEnvelope, EventHandler } from './interface';
export { InMemoryEventBus } from './interface';
export { PgNotifyBus } from './pg-notify-bus';

import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { PgNotifyBus } from './pg-notify-bus';
import { InMemoryEventBus } from './interface';
import type { EventBus } from './interface';

export function createEventBus(
  db: NodePgDatabase<Record<string, unknown>>,
  connectionString: string,
  options?: { useInMemory?: boolean },
): EventBus {
  if (options?.useInMemory || process.env.NODE_ENV === 'test') {
    return new InMemoryEventBus();
  }
  const bus = new PgNotifyBus(db, connectionString);
  // Caller is responsible for calling bus.start() before use
  return bus;
}
```

**Files**:
- `src/pipelines/event-bus/index.ts` (new, ~25 lines)

**Validation**:
- [ ] `createEventBus(db, connStr, { useInMemory: true })` returns `InMemoryEventBus` instance
- [ ] `createEventBus(db, connStr)` returns `PgNotifyBus` when `NODE_ENV !== 'test'`
- [ ] All types re-exported from `index.ts` are accessible via `import { EventBus } from '../event-bus'`

**Edge Cases**:
- `createEventBus` returns `EventBus` interface, not concrete type. Callers should not cast to `PgNotifyBus` — if they need to call `.start()`, accept it as `PgNotifyBus` explicitly or add `start()` to the `EventBus` interface.

---

### T011: Unit tests for PgNotifyBus (`tests/pipelines/event-bus/pg-notify-bus.test.ts`)

**Purpose**: Verify `PgNotifyBus` behavior — publish persists to DB, subscribe/unsubscribe works, handler is called after notification, handler errors do not crash the bus.

**Steps**:
1. Create `tests/pipelines/event-bus/pg-notify-bus.test.ts`
2. Use `InMemoryEventBus` for the majority of tests (no DB required)
3. For DB-dependent tests, use the project's test database setup (check existing integration tests for the pattern)
4. Test: `publish` returns a string ID
5. Test: `subscribe` adds a handler, `unsubscribe` removes it
6. Test: published event calls matching handler
7. Test: event type mismatch — handler not called for wrong event type
8. Test: handler throwing does not prevent other handlers from being called
9. Test: `InMemoryEventBus.close()` clears all subscriptions

```typescript
// tests/pipelines/event-bus/pg-notify-bus.test.ts
import { describe, it, expect, vi } from 'vitest';
import { InMemoryEventBus } from '../../../src/pipelines/event-bus';
import type { EventEnvelope } from '../../../src/pipelines/event-bus';

describe('InMemoryEventBus', () => {
  it('publish returns an event id', async () => {
    const bus = new InMemoryEventBus();
    const id = await bus.publish('tenant-1', 'manual', {});
    expect(typeof id).toBe('string');
    expect(id.length).toBeGreaterThan(0);
  });

  it('calls subscribed handler on matching event type', async () => {
    const bus = new InMemoryEventBus();
    const handler = vi.fn().mockResolvedValue(undefined);
    bus.subscribe('manual', handler);
    await bus.publish('tenant-1', 'manual', { key: 'value' });
    expect(handler).toHaveBeenCalledOnce();
    const envelope = handler.mock.calls[0][0] as EventEnvelope;
    expect(envelope.tenantId).toBe('tenant-1');
    expect(envelope.eventType).toBe('manual');
    expect(envelope.payload).toEqual({ key: 'value' });
  });

  it('does not call handler for a different event type', async () => {
    const bus = new InMemoryEventBus();
    const handler = vi.fn().mockResolvedValue(undefined);
    bus.subscribe('schedule', handler);
    await bus.publish('tenant-1', 'manual', {});
    expect(handler).not.toHaveBeenCalled();
  });

  it('unsubscribe removes the handler', async () => {
    const bus = new InMemoryEventBus();
    const handler = vi.fn().mockResolvedValue(undefined);
    const subId = bus.subscribe('manual', handler);
    bus.unsubscribe(subId);
    await bus.publish('tenant-1', 'manual', {});
    expect(handler).not.toHaveBeenCalled();
  });

  it('handler error does not prevent other handlers from being called', async () => {
    const bus = new InMemoryEventBus();
    const errorHandler = vi.fn().mockRejectedValue(new Error('boom'));
    const okHandler = vi.fn().mockResolvedValue(undefined);
    bus.subscribe('manual', errorHandler);
    bus.subscribe('manual', okHandler);
    // InMemoryEventBus does not catch errors — document this behavior in test
    await expect(bus.publish('tenant-1', 'manual', {})).rejects.toThrow('boom');
    // Note: PgNotifyBus wraps each handler in try/catch; InMemoryEventBus does not.
    // This test documents the behavioral difference.
  });

  it('close clears all subscriptions', async () => {
    const bus = new InMemoryEventBus();
    const handler = vi.fn().mockResolvedValue(undefined);
    bus.subscribe('manual', handler);
    await bus.close();
    await bus.publish('tenant-1', 'manual', {});
    expect(handler).not.toHaveBeenCalled();
  });
});
```

**Files**:
- `tests/pipelines/event-bus/pg-notify-bus.test.ts` (new, ~65 lines)

**Validation**:
- [ ] `npm test tests/pipelines/event-bus/` exits 0 with all tests passing
- [ ] Tests cover: publish, subscribe, unsubscribe, type mismatch, close
- [ ] No real database connection needed for unit tests — `InMemoryEventBus` only

**Edge Cases**:
- The error-handler test documents a known behavioral difference between `InMemoryEventBus` (propagates errors) and `PgNotifyBus` (catches errors per handler). This asymmetry is intentional — tests use InMemoryEventBus for simplicity, production needs resilience.
- If the project uses a global test database setup file (e.g., `tests/setup.ts`), import it in integration test files. Do not duplicate DB setup logic.

---

## Definition of Done

- [ ] `src/pipelines/event-bus/interface.ts` — `EventBus`, `EventEnvelope`, `EventHandler`, `InMemoryEventBus`
- [ ] `src/pipelines/event-bus/pg-notify-bus.ts` — `PgNotifyBus` with LISTEN/NOTIFY + queue table
- [ ] `src/pipelines/event-bus/index.ts` — factory and barrel exports
- [ ] `tests/pipelines/event-bus/pg-notify-bus.test.ts` — unit tests passing
- [ ] `npm run typecheck` exits 0
- [ ] `npm test` exits 0 with no regressions

## Risks

- **LISTEN connection loss**: If the PostgreSQL connection drops (network glitch, server restart), NOTIFY events will be missed. The recovery path is the poll loop in WP04 scanning `trigger_events WHERE processed_at IS NULL`. The reconnect logic in `PgNotifyBus` covers transient failures.
- **8000-byte NOTIFY limit**: Passing only the event ID in the NOTIFY payload (not the full event) is the correct pattern. If someone changes `publish` to pass the full payload, large events will silently truncate.
- **pg vs pg-pool**: Using `pg.Client` directly for LISTEN means the developer must manage connection lifecycle. Ensure `close()` is called during graceful shutdown to avoid hanging processes.

## Reviewer Guidance

- Verify the LISTEN client is `new Client(...)` from `pg`, not a connection from the Drizzle pool — this is the most common mistake with NOTIFY implementations.
- Check that `handleNotification` marks `processed_at` before calling handlers (at-least-once, not exactly-once). If the process crashes after marking but before the handler runs, the event is lost. This tradeoff is acceptable for this use case.
- Confirm `publish` uses a transaction if NOTIFY must be atomic with the INSERT — if the INSERT succeeds but NOTIFY fails, the event is still in the queue and will be picked up by the poll loop.
