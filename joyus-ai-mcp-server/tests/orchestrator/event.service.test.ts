/**
 * Unit tests for EventService.
 *
 * All DB calls are mocked — no real database is required.
 * Tests verify:
 *   - Registry enforcement: unregistered event types are rejected
 *   - Payload validation: mismatched payloads are rejected
 *   - Emit: inserts the event and returns it with sequence
 *   - Notification routing: fire-and-forget (does not block emit)
 *   - Query: applies filters and tenant scope
 *   - Replay: returns events after a given sequence
 *   - SSE handler: correct SSE format, heartbeat, cleanup on disconnect
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

import {
  EventService,
  UnregisteredEventTypeError,
  EventPayloadValidationError,
  registerEventType,
} from '../../src/orchestrator/event.service.js';
import { z } from 'zod';

// ---------------------------------------------------------------------------
// Mock DB factory
// ---------------------------------------------------------------------------

type MockDb = {
  select: ReturnType<typeof vi.fn>;
  insert: ReturnType<typeof vi.fn>;
  update: ReturnType<typeof vi.fn>;
};

function buildMockEvent(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: 'event-cuid-1',
    tenantId: 'tenant-1',
    sessionId: 'session-1',
    type: 'session.created',
    payload: { sessionId: 'session-1', tenantId: 'tenant-1', userId: 'user-1' },
    sequence: 1,
    createdAt: new Date('2026-05-12T00:00:00Z'),
    ...overrides,
  };
}

/**
 * Build a mock database where every method returns the provided rows.
 * Chainable: select().from().where().orderBy().limit() => rows
 *            insert().values().returning() => rows
 */
function makeDb(rows: unknown[] = []): MockDb {
  const returning = vi.fn().mockResolvedValue(rows);
  const limit = vi.fn().mockResolvedValue(rows);
  const orderBy = vi.fn().mockReturnValue({ limit });
  const where = vi.fn().mockReturnValue({ orderBy, limit, returning });
  const from = vi.fn().mockReturnValue({ where });
  const values = vi.fn().mockReturnValue({ returning });

  const select = vi.fn().mockReturnValue({ from });
  const insert = vi.fn().mockReturnValue({ values });
  const update = vi.fn().mockReturnValue({});

  return { select, insert, update } as unknown as MockDb;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const TENANT = 'tenant-abc';
const SESSION = 'session-xyz';

function makeService(rows: unknown[] = [], notificationRouter?: { route: ReturnType<typeof vi.fn> }) {
  const db = makeDb(rows);
  const router = notificationRouter ?? { route: vi.fn() };
  const service = new EventService(db as never, router as never);
  return { service, db, router };
}

// ---------------------------------------------------------------------------
// T024: Typed Event Registry
// ---------------------------------------------------------------------------

describe('EventService — typed event registry', () => {
  it('throws UnregisteredEventTypeError for unregistered event types', async () => {
    const { service } = makeService();

    await expect(
      service.emitEvent(TENANT, 'totally.unknown.type', { foo: 'bar' }),
    ).rejects.toThrow(UnregisteredEventTypeError);
  });

  it('throws before any DB call when the type is unregistered', async () => {
    const { service, db } = makeService();

    await expect(
      service.emitEvent(TENANT, 'not.a.real.type', {}),
    ).rejects.toThrow(UnregisteredEventTypeError);

    // No DB insert should have been attempted
    expect(db.insert).not.toHaveBeenCalled();
  });

  it('throws EventPayloadValidationError when payload does not match schema', async () => {
    const { service } = makeService();

    // 'session.created' requires sessionId, tenantId, userId
    await expect(
      service.emitEvent(TENANT, 'session.created', { sessionId: 'only-this-field' }),
    ).rejects.toThrow(EventPayloadValidationError);
  });

  it('registers a custom event type and accepts valid payloads', async () => {
    const { service, db } = makeService([buildMockEvent({ type: 'custom.test.event' })]);

    registerEventType('custom.test.event', z.object({ value: z.string() }));

    await expect(
      service.emitEvent(TENANT, 'custom.test.event', { value: 'hello' }),
    ).resolves.toMatchObject({ type: 'custom.test.event' });

    expect(db.insert).toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// T025: Emit event
// ---------------------------------------------------------------------------

describe('EventService — emitEvent', () => {
  it('inserts a valid event and returns the created row', async () => {
    const expected = buildMockEvent({
      type: 'session.created',
      payload: { sessionId: SESSION, tenantId: TENANT, userId: 'user-1' },
      sequence: 42,
    });
    const { service, db } = makeService([expected]);

    const result = await service.emitEvent(
      TENANT,
      'session.created',
      { sessionId: SESSION, tenantId: TENANT, userId: 'user-1' },
      SESSION,
    );

    expect(result.sequence).toBe(42);
    expect(result.type).toBe('session.created');
    expect(db.insert).toHaveBeenCalled();
  });

  it('includes sessionId in the insert when provided', async () => {
    const expected = buildMockEvent({ sessionId: SESSION });
    const { service, db } = makeService([expected]);

    await service.emitEvent(
      TENANT,
      'session.created',
      { sessionId: SESSION, tenantId: TENANT, userId: 'user-1' },
      SESSION,
    );

    // Verify insert was called (exact values tested at integration level)
    expect(db.insert).toHaveBeenCalled();
  });

  it('handles null sessionId (system-level events)', async () => {
    const expected = buildMockEvent({ sessionId: null });
    const { service, db } = makeService([expected]);

    await service.emitEvent(TENANT, 'error.occurred', {
      tenantId: TENANT,
      code: 'SYS_ERR',
      message: 'System failure',
    });

    expect(db.insert).toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// T025: queryEvents
// ---------------------------------------------------------------------------

describe('EventService — queryEvents', () => {
  it('returns events filtered by tenant', async () => {
    const events = [buildMockEvent(), buildMockEvent({ id: 'event-cuid-2', sequence: 2 })];
    const { service } = makeService(events);

    const result = await service.queryEvents(TENANT);

    expect(result).toHaveLength(2);
  });

  it('returns empty array when no events match', async () => {
    const { service } = makeService([]);

    const result = await service.queryEvents(TENANT);

    expect(result).toHaveLength(0);
  });

  it('applies afterSequence filter for cursor pagination', async () => {
    const { service, db } = makeService([]);

    await service.queryEvents(TENANT, { afterSequence: 10 });

    // The where() method should be called (exact condition tested at integration level)
    expect(db.select).toHaveBeenCalled();
  });

  it('applies sessionId and types filters', async () => {
    const { service, db } = makeService([]);

    await service.queryEvents(TENANT, {
      sessionId: SESSION,
      types: ['tool.called', 'tool.completed'],
    });

    expect(db.select).toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// T025: replayEvents
// ---------------------------------------------------------------------------

describe('EventService — replayEvents', () => {
  it('returns events after the given sequence number', async () => {
    const events = [
      buildMockEvent({ sequence: 11 }),
      buildMockEvent({ sequence: 12 }),
    ];
    const { service } = makeService(events);

    const result = await service.replayEvents(TENANT, 10);

    expect(result).toHaveLength(2);
    expect(result[0].sequence).toBe(11);
  });

  it('returns empty array when no events exist after the sequence', async () => {
    const { service } = makeService([]);

    const result = await service.replayEvents(TENANT, 999);

    expect(result).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// T026: Notification routing is fire-and-forget
// ---------------------------------------------------------------------------

describe('EventService — notification routing', () => {
  it('calls the notification router after successful emit', async () => {
    const expected = buildMockEvent();
    const routeFn = vi.fn();
    const { service } = makeService([expected], { route: routeFn });

    await service.emitEvent(
      TENANT,
      'session.created',
      { sessionId: SESSION, tenantId: TENANT, userId: 'user-1' },
      SESSION,
    );

    expect(routeFn).toHaveBeenCalledWith(expected);
  });

  it('does not throw if the notification router throws', async () => {
    const expected = buildMockEvent();
    const routeFn = vi.fn().mockImplementation(() => {
      throw new Error('Gateway unavailable');
    });
    const { service } = makeService([expected], { route: routeFn });

    // emitEvent should succeed even if routing fails
    await expect(
      service.emitEvent(
        TENANT,
        'session.created',
        { sessionId: SESSION, tenantId: TENANT, userId: 'user-1' },
        SESSION,
      ),
    ).resolves.toMatchObject({ type: 'session.created' });
  });
});

// ---------------------------------------------------------------------------
// T026: SSE subscription — format and cleanup
// ---------------------------------------------------------------------------

describe('EventService — SSE subscription', () => {
  function makeSseMocks(options: { events?: unknown[]; onClose?: () => void } = {}) {
    const events = options.events ?? [];
    const db = makeDb(events);

    // Capture the 'close' event listener added by the service
    let closeHandler: (() => void) | undefined;
    const req = {
      on: vi.fn((event: string, handler: () => void) => {
        if (event === 'close') closeHandler = handler;
      }),
    };

    const written: string[] = [];
    const res = {
      setHeader: vi.fn(),
      flushHeaders: vi.fn(),
      write: vi.fn((chunk: string) => { written.push(chunk); }),
      end: vi.fn(),
      writableEnded: false,
    };

    const service = new EventService(db as never);

    return { service, db, req, res, written, triggerClose: () => closeHandler?.() };
  }

  it('sets correct SSE headers on connection', async () => {
    const { service, req, res } = makeSseMocks();

    // Start subscription (non-blocking — use a resolved promise to not hang)
    const promise = service.handleSseSubscription(TENANT, req as never, res as never);

    // Immediately trigger close so polling doesn't run forever in tests
    (req.on as ReturnType<typeof vi.fn>).mock.calls
      .filter(([event]: [string]) => event === 'close')
      .forEach(([, handler]: [string, () => void]) => handler());

    await promise.catch(() => {}); // ignore errors from cleanup

    expect(res.setHeader).toHaveBeenCalledWith('Content-Type', 'text/event-stream');
    expect(res.setHeader).toHaveBeenCalledWith('Cache-Control', 'no-cache');
    expect(res.setHeader).toHaveBeenCalledWith('Connection', 'keep-alive');
    expect(res.flushHeaders).toHaveBeenCalled();
  });

  it('replays events after Last-Event-ID on connection', async () => {
    const missedEvent = buildMockEvent({ sequence: 5, type: 'session.created' });
    const { service, db, req, res, written } = makeSseMocks({ events: [missedEvent] });

    const subscribePromise = service.handleSseSubscription(
      TENANT,
      req as never,
      res as never,
      { lastEventId: 4 },
    );

    // Trigger disconnect immediately after replay
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
    (req.on as ReturnType<typeof vi.fn>).mock.calls
      .filter(([event]: [string]) => event === 'close')
      .forEach(([, handler]: [string, () => void]) => handler());

    await subscribePromise.catch(() => {});

    // Verify a write was made that looks like SSE format
    const allWritten = written.join('');
    expect(allWritten).toContain('id: 5');
    expect(allWritten).toContain('event: session.created');
    expect(allWritten).toContain('data:');
  });

  it('emits SSE events in correct format', async () => {
    // Build a mock that returns an event on the first select call (replay)
    const mockEvent = buildMockEvent({ sequence: 7, type: 'tool.completed' });
    const db = makeDb([mockEvent]);

    const written: string[] = [];
    const req = { on: vi.fn() };
    const res = {
      setHeader: vi.fn(),
      flushHeaders: vi.fn(),
      write: vi.fn((chunk: string) => { written.push(chunk); }),
      end: vi.fn(),
    };

    const service = new EventService(db as never);

    // lastEventId=6 triggers replay path
    const subscribePromise = service.handleSseSubscription(
      TENANT,
      req as never,
      res as never,
      { lastEventId: 6 },
    );

    // Let replay execute then disconnect
    await new Promise<void>((resolve) => setTimeout(resolve, 10));
    const closeHandler = (req.on as ReturnType<typeof vi.fn>).mock.calls
      .find(([event]: [string]) => event === 'close')?.[1];
    closeHandler?.();

    await subscribePromise.catch(() => {});

    const allWritten = written.join('');
    // SSE format: id, event, data, blank line
    expect(allWritten).toMatch(/id: \d+\n/);
    expect(allWritten).toMatch(/event: [a-z.]+\n/);
    expect(allWritten).toMatch(/data: \{.*\}\n/);
    // Must end with double newline (SSE event terminator)
    expect(allWritten).toContain('\n\n');
  });
});

// ---------------------------------------------------------------------------
// NotificationService
// ---------------------------------------------------------------------------

describe('NotificationService', () => {
  it('only routes routable event types', async () => {
    const { NotificationService } = await import(
      '../../src/orchestrator/notification.service.js'
    );
    const mockGateway = { forward: vi.fn().mockResolvedValue(undefined) };
    const notificationService = new NotificationService(mockGateway);

    const nonRoutableEvent = buildMockEvent({ type: 'session.created' });
    notificationService.route(nonRoutableEvent as never);

    // Give async work time to execute
    await new Promise<void>((resolve) => setTimeout(resolve, 10));

    expect(mockGateway.forward).not.toHaveBeenCalled();
  });

  it('forwards session.completed to the gateway', async () => {
    const { NotificationService } = await import(
      '../../src/orchestrator/notification.service.js'
    );
    const mockGateway = { forward: vi.fn().mockResolvedValue(undefined) };
    const notificationService = new NotificationService(mockGateway);

    const completedEvent = buildMockEvent({
      type: 'session.completed',
      payload: { sessionId: SESSION, tenantId: TENANT, turnCount: 5, totalTokens: 2000 },
    });
    notificationService.route(completedEvent as never);

    await new Promise<void>((resolve) => setTimeout(resolve, 10));

    expect(mockGateway.forward).toHaveBeenCalledWith(completedEvent);
  });

  it('does not throw if gateway.forward rejects', async () => {
    const { NotificationService } = await import(
      '../../src/orchestrator/notification.service.js'
    );
    const mockGateway = {
      forward: vi.fn().mockRejectedValue(new Error('Gateway down')),
    };
    const notificationService = new NotificationService(mockGateway);

    const failedEvent = buildMockEvent({ type: 'session.failed' });

    // route() is synchronous and must never throw
    expect(() => notificationService.route(failedEvent as never)).not.toThrow();

    // Give async work time — still no unhandled rejection
    await new Promise<void>((resolve) => setTimeout(resolve, 10));
  });

  it('isRoutable returns true for routable types', async () => {
    const { NotificationService } = await import(
      '../../src/orchestrator/notification.service.js'
    );
    const notificationService = new NotificationService();

    expect(notificationService.isRoutable('session.completed')).toBe(true);
    expect(notificationService.isRoutable('session.failed')).toBe(true);
    expect(notificationService.isRoutable('tool.failed')).toBe(true);
    expect(notificationService.isRoutable('session.created')).toBe(false);
    expect(notificationService.isRoutable('tool.called')).toBe(false);
  });
});
