/**
 * Integration tests for Activity Log and Health endpoints (WP09).
 *
 * Covers:
 * - GET /events  — paginated query, tenant scoping, filter params, payload exclusion (T046)
 * - POST /events/:id/replay — replay failed/dead_letter, reject delivered, 404 cross-tenant (T047)
 * - GET /health  — 200 always, correct shape, status computation (T048)
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Request, Response } from 'express';

import { createEventsRouter } from '../../../src/event-adapter/routes/events.js';
import { createHealthRouter } from '../../../src/event-adapter/routes/health.js';
import type { WebhookEvent } from '../../../src/event-adapter/schema.js';

// ============================================================
// MOCK HELPERS
// ============================================================

function makeEvent(overrides: Partial<WebhookEvent> = {}): WebhookEvent {
  return {
    id: 'evt-001',
    tenantId: 'tenant-abc',
    sourceType: 'github',
    sourceId: 'src-001',
    scheduleId: null,
    status: 'delivered',
    payload: { action: 'push', ref: 'refs/heads/main' },
    headers: { 'x-github-event': 'push' },
    signatureValid: true,
    translatedTrigger: { triggerType: 'corpus-change' },
    triggerType: 'corpus-change',
    pipelineId: 'pipe-001',
    attemptCount: 1,
    failureReason: null,
    processingDurationMs: 42,
    forwardedToAutomation: false,
    createdAt: new Date('2026-01-01T10:00:00Z'),
    updatedAt: new Date('2026-01-01T10:00:01Z'),
    deliveredAt: new Date('2026-01-01T10:00:01Z'),
    ...overrides,
  };
}

function makeReq(opts: {
  body?: unknown;
  params?: Record<string, string>;
  query?: Record<string, unknown>;
  headers?: Record<string, string>;
}): Request {
  return {
    body: opts.body ?? {},
    params: opts.params ?? {},
    query: opts.query ?? {},
    headers: opts.headers ?? {},
  } as unknown as Request;
}

function makeRes(): { res: Response; captured: { status: number | null; body: unknown } } {
  const captured: { status: number | null; body: unknown } = { status: null, body: null };
  const res = {
    status(code: number) {
      captured.status = code;
      return res;
    },
    json(data: unknown) {
      captured.body = data;
      return res;
    },
  } as unknown as Response;
  return { res, captured };
}

// ============================================================
// ROUTE INVOCATION HELPERS
// ============================================================

type RouterLike = {
  stack: Array<{
    route?: {
      path: string;
      methods: Record<string, boolean>;
      stack: Array<{ handle: (req: Request, res: Response, next: () => void) => void }>;
    };
  }>;
};

function matchPath(routePath: string, actualPath: string): Record<string, string> | null {
  const routeParts = routePath.split('/');
  const actualParts = actualPath.split('/');
  if (routeParts.length !== actualParts.length) return null;
  const params: Record<string, string> = {};
  for (let i = 0; i < routeParts.length; i++) {
    const rp = routeParts[i] ?? '';
    const ap = actualParts[i] ?? '';
    if (rp.startsWith(':')) {
      params[rp.slice(1)] = ap;
    } else if (rp !== ap) {
      return null;
    }
  }
  return params;
}

async function runHandlers(
  handlers: Array<(req: Request, res: Response, next: () => void) => void>,
  req: Request,
  res: Response,
): Promise<void> {
  let i = 0;
  const next = async (): Promise<void> => {
    if (i < handlers.length) {
      const handler = handlers[i++];
      await handler(req, res, next as () => void);
    }
  };
  await next();
}

async function invokeEventsRoute(
  db: ReturnType<typeof buildMockDb>,
  method: 'get' | 'post',
  path: string,
  opts: {
    body?: unknown;
    headers?: Record<string, string>;
    params?: Record<string, string>;
    query?: Record<string, unknown>;
  } = {},
): Promise<{ status: number | null; body: unknown }> {
  const router = createEventsRouter({ db: db as never });
  const layers = (router as unknown as RouterLike).stack;

  for (const layer of layers) {
    if (!layer.route) continue;
    const route = layer.route;
    if (!route.methods[method]) continue;
    const match = matchPath(route.path, path);
    if (!match) continue;

    const req = makeReq({
      body: opts.body,
      headers: opts.headers ?? {},
      params: { ...opts.params, ...match },
      query: opts.query ?? {},
    });
    const { res, captured } = makeRes();
    await runHandlers(route.stack.map((s) => s.handle), req, res);
    return captured;
  }

  return { status: 404, body: { error: 'route_not_found_in_test' } };
}

async function invokeHealthRoute(
  db: ReturnType<typeof buildHealthMockDb>,
  schedulerLastTickAt?: Date | null,
): Promise<{ status: number | null; body: unknown }> {
  const scheduler = schedulerLastTickAt !== undefined
    ? { lastTickAt: schedulerLastTickAt } as never
    : undefined;
  const router = createHealthRouter({ db: db as never, scheduler });
  const layers = (router as unknown as RouterLike).stack;

  for (const layer of layers) {
    if (!layer.route) continue;
    const route = layer.route;
    if (!route.methods['get']) continue;
    if (route.path !== '/health') continue;

    const req = makeReq({ headers: {}, query: {} });
    const { res, captured } = makeRes();
    await runHandlers(route.stack.map((s) => s.handle), req, res);
    return captured;
  }

  return { status: 404, body: { error: 'route_not_found_in_test' } };
}

// ============================================================
// MOCK DB FOR EVENTS ROUTES
// ============================================================

function buildMockDb() {
  const db = {
    _queryEventsResult: { events: [] as WebhookEvent[], total: 0 },
    _getByIdResult: null as WebhookEvent | null,
    _replayError: null as string | null,
    _selectCallIndex: 0,

    select: vi.fn(),
    update: vi.fn(),
  };

  // Routes call select in this order:
  //
  // GET /events (queryEvents):
  //   Promise.all([
  //     call 0: .from().where().orderBy().limit().offset()  -> events[]
  //     call 1: .from().where()                             -> [{ count }]
  //   ])
  //
  // POST /events/:id/replay (getEventById then replayEvent):
  //   call 0: getEventById  -> .from().where()              -> event[] | []
  //   call 1: replayEvent internal select -> .from().where()-> event[] | []
  //
  // Each where() result is a Promise that also exposes .orderBy() so both
  // patterns work.

  db.select.mockImplementation(() => {
    const callIndex = db._selectCallIndex++;
    return {
      from: vi.fn(() => ({
        where: vi.fn((..._args: unknown[]) => {
          // Decide what to resolve for a direct await
          let directResult: unknown[];
          if (callIndex === 0) {
            // Could be: events list (queryEvents) OR getEventById (replay route).
            // Replay tests don't set _queryEventsResult, list tests don't set _getByIdResult.
            // Return the events list if populated; otherwise fall back to _getByIdResult.
            directResult = db._queryEventsResult.events.length > 0
              ? db._queryEventsResult.events
              : db._getByIdResult
              ? [db._getByIdResult]
              : [];
          } else if (callIndex === 1) {
            // Could be: count (queryEvents) OR replayEvent internal select.
            // If queryEvents populated total, return count; otherwise return event.
            directResult = db._queryEventsResult.total > 0
              ? [{ count: db._queryEventsResult.total }]
              : db._getByIdResult
              ? [db._getByIdResult]
              : [{ count: 0 }];
          } else {
            directResult = db._getByIdResult ? [db._getByIdResult] : [];
          }

          // Return a Promise that also supports .orderBy() chaining
          const p = Promise.resolve(directResult);
          return Object.assign(p, {
            orderBy: vi.fn(() => ({
              limit: vi.fn(() => ({
                offset: vi.fn(() => Promise.resolve(db._queryEventsResult.events)),
              })),
            })),
          });
        }),
      })),
    };
  });

  // replayEvent: update().set().where().returning()
  db.update.mockImplementation(() => ({
    set: vi.fn(() => ({
      where: vi.fn(() => ({
        returning: vi.fn(() => {
          if (db._replayError) {
            throw new Error(db._replayError);
          }
          const updated = db._getByIdResult
            ? { ...db._getByIdResult, status: 'pending', attemptCount: 0, failureReason: null }
            : null;
          return Promise.resolve(updated ? [updated] : []);
        }),
      })),
    })),
  }));

  return db;
}

// ============================================================
// MOCK DB FOR HEALTH ROUTE
// ============================================================

interface HealthCounts {
  lastHour: number;
  last24h: number;
  delivered: number;
  failed: number;
  pending: number;
  processing: number;
  deadLetter: number;
  activeSchedules: number;
  overdueSchedules: number;
  avgLatencyMs: number | null;
}

function buildHealthMockDb(counts: Partial<HealthCounts> = {}) {
  const c: HealthCounts = {
    lastHour: 10,
    last24h: 100,
    delivered: 90,
    failed: 5,
    pending: 3,
    processing: 1,
    deadLetter: 2,
    activeSchedules: 5,
    overdueSchedules: 0,
    avgLatencyMs: 55,
    ...counts,
  };

  let callIndex = 0;
  const countResults = [
    [{ count: c.lastHour }],
    [{ count: c.last24h }],
    [{ count: c.delivered }],
    [{ count: c.failed }],
    [{ count: c.pending }],
    [{ count: c.processing }],
    [{ count: c.deadLetter }],
    [{ count: c.activeSchedules }],
    [{ count: c.overdueSchedules }],
    [{ avg: c.avgLatencyMs }],
  ];

  const db = {
    select: vi.fn(() => ({
      from: vi.fn(() => ({
        where: vi.fn(() => Promise.resolve(countResults[callIndex++] ?? [{ count: 0 }])),
      })),
    })),
  };

  return db;
}

// ============================================================
// T046: GET /events
// ============================================================

describe('GET /events', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns 200 with data, total, limit, offset', async () => {
    const db = buildMockDb();
    const event = makeEvent();
    db._queryEventsResult = { events: [event], total: 1 };

    const result = await invokeEventsRoute(db, 'get', '/events', {
      headers: { 'x-tenant-id': 'tenant-abc' },
    });

    expect(result.status).toBe(200);
    const body = result.body as Record<string, unknown>;
    expect(Array.isArray(body['data'])).toBe(true);
    expect(body['total']).toBe(1);
    expect(body['limit']).toBe(50);
    expect(body['offset']).toBe(0);
  });

  it('does NOT include payload or headers in response items', async () => {
    const db = buildMockDb();
    db._queryEventsResult = { events: [makeEvent()], total: 1 };

    const result = await invokeEventsRoute(db, 'get', '/events', {
      headers: { 'x-tenant-id': 'tenant-abc' },
    });

    const body = result.body as Record<string, unknown>;
    const items = body['data'] as Record<string, unknown>[];
    expect(items[0]).not.toHaveProperty('payload');
    expect(items[0]).not.toHaveProperty('headers');
  });

  it('includes expected EventSummary fields', async () => {
    const db = buildMockDb();
    db._queryEventsResult = { events: [makeEvent()], total: 1 };

    const result = await invokeEventsRoute(db, 'get', '/events', {
      headers: { 'x-tenant-id': 'tenant-abc' },
    });

    const items = ((result.body as Record<string, unknown>)['data'] as Record<string, unknown>[]);
    const item = items[0];
    expect(item).toHaveProperty('id');
    expect(item).toHaveProperty('tenantId');
    expect(item).toHaveProperty('sourceType');
    expect(item).toHaveProperty('status');
    expect(item).toHaveProperty('attemptCount');
    expect(item).toHaveProperty('createdAt');
  });

  it('respects custom limit and offset', async () => {
    const db = buildMockDb();
    db._queryEventsResult = { events: [], total: 0 };

    const result = await invokeEventsRoute(db, 'get', '/events', {
      headers: { 'x-tenant-id': 'tenant-abc' },
      query: { limit: '10', offset: '20' },
    });

    const body = result.body as Record<string, unknown>;
    expect(body['limit']).toBe(10);
    expect(body['offset']).toBe(20);
  });

  it('returns 400 for invalid status filter', async () => {
    const db = buildMockDb();

    const result = await invokeEventsRoute(db, 'get', '/events', {
      headers: { 'x-tenant-id': 'tenant-abc' },
      query: { status: 'invalid_status' },
    });

    expect(result.status).toBe(400);
    expect((result.body as Record<string, unknown>)['error']).toBe('validation_error');
  });

  it('returns empty data for cross-tenant query (no matching events)', async () => {
    const db = buildMockDb();
    // queryEvents returns empty when tenant-xyz has no events
    db._queryEventsResult = { events: [], total: 0 };

    const result = await invokeEventsRoute(db, 'get', '/events', {
      headers: { 'x-tenant-id': 'tenant-xyz' },
    });

    expect(result.status).toBe(200);
    const body = result.body as Record<string, unknown>;
    expect((body['data'] as unknown[]).length).toBe(0);
    expect(body['total']).toBe(0);
  });
});

// ============================================================
// T047: POST /events/:id/replay
// ============================================================

describe('POST /events/:id/replay', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns 202 for a failed event', async () => {
    const db = buildMockDb();
    db._getByIdResult = makeEvent({ id: 'evt-fail', status: 'failed' });

    const result = await invokeEventsRoute(db, 'post', '/events/evt-fail/replay', {
      headers: { 'x-tenant-id': 'tenant-abc' },
    });

    expect(result.status).toBe(202);
    const body = result.body as Record<string, unknown>;
    expect(body['event_id']).toBe('evt-fail');
    expect(body['status']).toBe('pending');
    expect(typeof body['message']).toBe('string');
  });

  it('returns 202 for a dead_letter event', async () => {
    const db = buildMockDb();
    db._getByIdResult = makeEvent({ id: 'evt-dl', status: 'dead_letter' });

    const result = await invokeEventsRoute(db, 'post', '/events/evt-dl/replay', {
      headers: { 'x-tenant-id': 'tenant-abc' },
    });

    expect(result.status).toBe(202);
  });

  it('returns 422 for a delivered event (not replayable)', async () => {
    const db = buildMockDb();
    db._getByIdResult = makeEvent({ id: 'evt-delivered', status: 'delivered' });
    // replayEvent throws naturally when event status is not failed/dead_letter

    const result = await invokeEventsRoute(db, 'post', '/events/evt-delivered/replay', {
      headers: { 'x-tenant-id': 'tenant-abc' },
    });

    expect(result.status).toBe(422);
    const body = result.body as Record<string, unknown>;
    expect(body['error']).toBe('Event cannot be replayed');
    expect(typeof body['detail']).toBe('string');
  });

  it('returns 404 for unknown event id', async () => {
    const db = buildMockDb();
    db._getByIdResult = null;

    const result = await invokeEventsRoute(db, 'post', '/events/nonexistent/replay', {
      headers: { 'x-tenant-id': 'tenant-abc' },
    });

    expect(result.status).toBe(404);
    expect((result.body as Record<string, unknown>)['error']).toBe('not_found');
  });

  it('returns 404 for cross-tenant access', async () => {
    const db = buildMockDb();
    // Event exists for tenant-abc but query scoped to tenant-xyz returns null
    db._getByIdResult = null;

    const result = await invokeEventsRoute(db, 'post', '/events/evt-001/replay', {
      headers: { 'x-tenant-id': 'tenant-xyz' },
    });

    expect(result.status).toBe(404);
  });
});

// ============================================================
// T048: GET /health
// ============================================================

describe('GET /health', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('always returns HTTP 200', async () => {
    const db = buildHealthMockDb();
    const result = await invokeHealthRoute(db);
    expect(result.status).toBe(200);
  });

  it('returns the correct response shape', async () => {
    const db = buildHealthMockDb();
    const result = await invokeHealthRoute(db);

    const body = result.body as Record<string, unknown>;
    expect(body).toHaveProperty('status');
    expect(body).toHaveProperty('timestamp');
    expect(body).toHaveProperty('events');
    expect(body).toHaveProperty('delivery');
    expect(body).toHaveProperty('queue');
    expect(body).toHaveProperty('schedules');
    expect(body).toHaveProperty('latency');
    expect(body).toHaveProperty('scheduler');

    const events = body['events'] as Record<string, unknown>;
    expect(events).toHaveProperty('last_hour');
    expect(events).toHaveProperty('last_24h');

    const delivery = body['delivery'] as Record<string, unknown>;
    expect(delivery).toHaveProperty('delivered');
    expect(delivery).toHaveProperty('failed');
    expect(delivery).toHaveProperty('success_rate_pct');

    const queue = body['queue'] as Record<string, unknown>;
    expect(queue).toHaveProperty('pending');
    expect(queue).toHaveProperty('processing');
    expect(queue).toHaveProperty('dead_letter');

    const schedules = body['schedules'] as Record<string, unknown>;
    expect(schedules).toHaveProperty('active');
    expect(schedules).toHaveProperty('overdue');

    const latency = body['latency'] as Record<string, unknown>;
    expect(latency).toHaveProperty('avg_ms');
    expect(latency).toHaveProperty('p95_ms');

    const scheduler = body['scheduler'] as Record<string, unknown>;
    expect(scheduler).toHaveProperty('last_tick');
    expect(scheduler).toHaveProperty('healthy');
  });

  it('reports healthy status when metrics are within thresholds', async () => {
    const db = buildHealthMockDb({
      pending: 10,
      deadLetter: 5,
      delivered: 90,
      failed: 5,
      overdueSchedules: 0,
    });
    const recentTick = new Date(Date.now() - 30_000); // 30 seconds ago
    const result = await invokeHealthRoute(db, recentTick);

    const body = result.body as Record<string, unknown>;
    expect(body['status']).toBe('healthy');
  });

  it('reports degraded when dead_letter > 50', async () => {
    const db = buildHealthMockDb({
      deadLetter: 51,
      pending: 5,
      delivered: 90,
      failed: 5,
    });
    const recentTick = new Date(Date.now() - 30_000);
    const result = await invokeHealthRoute(db, recentTick);

    expect((result.body as Record<string, unknown>)['status']).toBe('degraded');
  });

  it('reports degraded when success_rate < 90%', async () => {
    const db = buildHealthMockDb({
      delivered: 80,
      failed: 20, // 80% success rate
      deadLetter: 0,
      pending: 5,
      overdueSchedules: 0,
    });
    const recentTick = new Date(Date.now() - 30_000);
    const result = await invokeHealthRoute(db, recentTick);

    expect((result.body as Record<string, unknown>)['status']).toBe('degraded');
  });

  it('reports degraded when overdue schedules > 0', async () => {
    const db = buildHealthMockDb({
      overdueSchedules: 1,
      pending: 5,
      delivered: 95,
      failed: 5,
      deadLetter: 0,
    });
    const recentTick = new Date(Date.now() - 30_000);
    const result = await invokeHealthRoute(db, recentTick);

    expect((result.body as Record<string, unknown>)['status']).toBe('degraded');
  });

  it('reports unhealthy when pending > 1000', async () => {
    const db = buildHealthMockDb({ pending: 1001 });
    const recentTick = new Date(Date.now() - 30_000);
    const result = await invokeHealthRoute(db, recentTick);

    expect((result.body as Record<string, unknown>)['status']).toBe('unhealthy');
  });

  it('reports unhealthy when scheduler last tick is too old', async () => {
    const db = buildHealthMockDb({ pending: 5 });
    const oldTick = new Date(Date.now() - 5 * 60_000); // 5 minutes ago (> 2 min threshold)
    const result = await invokeHealthRoute(db, oldTick);

    expect((result.body as Record<string, unknown>)['status']).toBe('unhealthy');
  });

  it('reports scheduler healthy: true when no scheduler provided', async () => {
    const db = buildHealthMockDb();
    // Pass undefined to skip scheduler dep
    const result = await invokeHealthRoute(db, undefined);

    const body = result.body as Record<string, unknown>;
    const scheduler = body['scheduler'] as Record<string, unknown>;
    expect(scheduler['healthy']).toBe(true);
    expect(scheduler['last_tick']).toBeNull();
  });

  it('returns null avg_ms when no delivered events', async () => {
    const db = buildHealthMockDb({ avgLatencyMs: null });
    const result = await invokeHealthRoute(db);

    const body = result.body as Record<string, unknown>;
    const latency = body['latency'] as Record<string, unknown>;
    expect(latency['avg_ms']).toBeNull();
  });

  it('timestamp is ISO 8601 string', async () => {
    const db = buildHealthMockDb();
    const result = await invokeHealthRoute(db);

    const body = result.body as Record<string, unknown>;
    expect(typeof body['timestamp']).toBe('string');
    expect(() => new Date(body['timestamp'] as string)).not.toThrow();
  });
});
