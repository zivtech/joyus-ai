/**
 * Integration tests for Platform-Wide Sources & Subscriptions (WP11)
 *
 * Covers:
 * - Platform-wide source creation: platform admin can create, tenant admin cannot set isPlatformWide
 * - GET /sources/platform: returns only platform-wide sources
 * - GET /sources: tenant sees own + platform-wide sources
 * - Subscribe: 201 on success, 409 on duplicate, 422 on non-platform-wide source, 404 on missing source
 * - Unsubscribe: 204 on success, 404 if not subscribed, 403 if no tenant
 * - List subscriptions: platform admin only, tenant gets 403
 * - Fan-out: platform event creates per-tenant child events, one failure doesn't block others
 * - Isolation: tenant A can't unsubscribe tenant B's subscription
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Request, Response } from 'express';

import { createSubscriptionsRouter } from '../../../src/event-adapter/routes/subscriptions.js';
import { createSourcesRouter } from '../../../src/event-adapter/routes/sources.js';
import { fanOutPlatformEvent } from '../../../src/event-adapter/services/event-translator.js';
import type { EventSource, PlatformSubscription, WebhookEvent } from '../../../src/event-adapter/schema.js';
import type { TriggerCall } from '../../../src/event-adapter/services/trigger-forwarder.js';
import { TriggerForwarder } from '../../../src/event-adapter/services/trigger-forwarder.js';
import { encryptSecret } from '../../../src/event-adapter/services/secret-store.js';

// ============================================================
// FIXTURES
// ============================================================

function makeSource(overrides: Partial<EventSource> = {}): EventSource {
  return {
    id: 'src-platform-001',
    tenantId: null,
    name: 'Platform GitHub Source',
    sourceType: 'generic_webhook',
    endpointSlug: 'platform-github-a1b2c3',
    authMethod: 'hmac_sha256',
    authConfig: {
      headerName: 'x-hub-signature-256',
      algorithm: 'sha256',
      secretRef: encryptSecret('platform-secret'),
    },
    payloadMapping: null,
    targetPipelineId: 'pipe-platform',
    targetTriggerType: 'corpus-change',
    lifecycleState: 'active',
    isPlatformWide: true,
    createdAt: new Date('2026-01-01T00:00:00Z'),
    updatedAt: new Date('2026-01-01T00:00:00Z'),
    ...overrides,
  };
}

function makeTenantSource(overrides: Partial<EventSource> = {}): EventSource {
  return makeSource({
    id: 'src-tenant-001',
    tenantId: 'tenant-abc',
    isPlatformWide: false,
    ...overrides,
  });
}

function makeSubscription(overrides: Partial<PlatformSubscription> = {}): PlatformSubscription {
  return {
    id: 'sub-001',
    tenantId: 'tenant-abc',
    eventSourceId: 'src-platform-001',
    targetPipelineId: 'pipe-abc',
    isActive: true,
    createdAt: new Date('2026-01-01T00:00:00Z'),
    ...overrides,
  };
}

function makeWebhookEvent(overrides: Partial<WebhookEvent> = {}): WebhookEvent {
  return {
    id: 'evt-001',
    tenantId: 'tenant-platform',
    sourceType: 'generic_webhook',
    sourceId: 'src-platform-001',
    scheduleId: null,
    status: 'delivered',
    payload: { data: 'test' },
    headers: null,
    signatureValid: true,
    translatedTrigger: null,
    triggerType: null,
    pipelineId: null,
    attemptCount: 1,
    failureReason: null,
    processingDurationMs: null,
    forwardedToAutomation: false,
    createdAt: new Date('2026-01-01T00:00:00Z'),
    updatedAt: new Date('2026-01-01T00:00:00Z'),
    deliveredAt: new Date('2026-01-01T00:00:00Z'),
    ...overrides,
  };
}

// ============================================================
// MOCK HELPERS
// ============================================================

function makeReq(opts: {
  body?: unknown;
  params?: Record<string, string>;
  query?: Record<string, string>;
  headers?: Record<string, string>;
}): Request {
  return {
    body: opts.body ?? {},
    params: opts.params ?? {},
    query: opts.query ?? {},
    headers: opts.headers ?? {},
  } as unknown as Request;
}

function makeRes(): { res: Response; captured: { status: number | null; body: unknown; sent: boolean } } {
  const captured: { status: number | null; body: unknown; sent: boolean } = {
    status: null,
    body: null,
    sent: false,
  };
  const res = {
    status(code: number) {
      captured.status = code;
      return res;
    },
    json(data: unknown) {
      captured.body = data;
      return res;
    },
    send() {
      captured.sent = true;
      return res;
    },
  } as unknown as Response;
  return { res, captured };
}

// ============================================================
// ROUTER INVOCATION HELPERS
// ============================================================

function matchPath(routePath: string, actualPath: string): Record<string, string> | null {
  const routeParts = routePath.split('/');
  const actualParts = actualPath.split('/');
  if (routeParts.length !== actualParts.length) return null;
  const params: Record<string, string> = {};
  for (let i = 0; i < routeParts.length; i++) {
    const rp = routeParts[i];
    const ap = actualParts[i];
    if (rp === undefined || ap === undefined) return null;
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
      if (handler) await handler(req, res, next as () => void);
    }
  };
  await next();
}

type RouterStack = Array<{
  route?: {
    path: string;
    methods: Record<string, boolean>;
    stack: Array<{ handle: (req: Request, res: Response, next: () => void) => void }>;
  };
}>;

async function invokeSubscriptionsRoute(
  db: ReturnType<typeof buildMockDb>,
  method: 'get' | 'post' | 'delete',
  path: string,
  opts: {
    body?: unknown;
    headers?: Record<string, string>;
    params?: Record<string, string>;
    query?: Record<string, string>;
  } = {},
): Promise<{ status: number | null; body: unknown; sent: boolean }> {
  const router = createSubscriptionsRouter({ db: db as never });
  const layers = (router as unknown as { stack: RouterStack }).stack;

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
    const handlers = route.stack.map((s) => s.handle);
    await runHandlers(handlers, req, res);
    return captured;
  }

  return { status: 404, body: { error: 'route_not_found_in_test' }, sent: false };
}

async function invokeSourcesRoute(
  db: ReturnType<typeof buildMockDb>,
  method: 'get' | 'post' | 'patch' | 'delete',
  path: string,
  opts: {
    body?: unknown;
    headers?: Record<string, string>;
    params?: Record<string, string>;
    query?: Record<string, string>;
  } = {},
): Promise<{ status: number | null; body: unknown }> {
  const router = createSourcesRouter({ db: db as never });
  const layers = (router as unknown as { stack: RouterStack }).stack;

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
    const handlers = route.stack.map((s) => s.handle);
    await runHandlers(handlers, req, res);
    return { status: captured.status, body: captured.body };
  }

  return { status: 404, body: { error: 'route_not_found_in_test' } };
}

// ============================================================
// MOCK DB BUILDER
// ============================================================

function buildMockDb() {
  const db = {
    _selectResults: [] as unknown[],
    _insertResults: [] as unknown[],
    _deleteResults: [] as unknown[],
    _updateResults: [] as unknown[],
    _insertedValues: null as unknown,

    select: vi.fn(),
    insert: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
  };

  // select().from().where().limit().offset() -> rows
  // select().from().where() -> rows (for plain queries)
  db.select.mockImplementation(() => ({
    from: vi.fn(() => ({
      where: vi.fn(() => ({
        limit: vi.fn(() => ({
          offset: vi.fn(() => Promise.resolve(db._selectResults)),
        })),
        // awaitable for plain .where() calls
        then: (resolve: (v: unknown) => void) => resolve(db._selectResults),
        ...Promise.resolve(db._selectResults),
      })),
    })),
  }));

  // insert().values().returning() -> rows
  db.insert.mockImplementation(() => ({
    values: vi.fn((vals: unknown) => {
      db._insertedValues = vals;
      return {
        returning: vi.fn(() => Promise.resolve(db._insertResults)),
      };
    }),
  }));

  // update().set().where().returning() -> rows
  db.update.mockImplementation(() => ({
    set: vi.fn(() => ({
      where: vi.fn(() => ({
        returning: vi.fn(() => Promise.resolve(db._updateResults)),
      })),
    })),
  }));

  // delete().where().returning() -> rows
  db.delete.mockImplementation(() => ({
    where: vi.fn(() => ({
      returning: vi.fn(() => Promise.resolve(db._deleteResults)),
    })),
  }));

  return db;
}

// ============================================================
// PLATFORM-WIDE SOURCE CREATION (T057)
// ============================================================

describe('platform-wide source creation', () => {
  it('platform admin (no x-tenant-id) creates source with isPlatformWide: true', async () => {
    const db = buildMockDb();
    db._insertResults = [makeSource()];

    const result = await invokeSourcesRoute(db, 'post', '/sources', {
      // No x-tenant-id header — platform admin
      body: {
        name: 'Platform GitHub',
        sourceType: 'generic_webhook',
        authMethod: 'ip_allowlist',
      },
    });

    expect(result.status).toBe(201);
    const inserted = db._insertedValues as Record<string, unknown>;
    expect(inserted['isPlatformWide']).toBe(true);
    expect(inserted['tenantId']).toBeUndefined();
  });

  it('tenant admin (with x-tenant-id) creates source with isPlatformWide: false', async () => {
    const db = buildMockDb();
    db._insertResults = [makeTenantSource()];

    const result = await invokeSourcesRoute(db, 'post', '/sources', {
      headers: { 'x-tenant-id': 'tenant-abc' },
      body: {
        name: 'Tenant Webhook',
        sourceType: 'generic_webhook',
        authMethod: 'ip_allowlist',
      },
    });

    expect(result.status).toBe(201);
    const inserted = db._insertedValues as Record<string, unknown>;
    expect(inserted['isPlatformWide']).toBe(false);
    expect(inserted['tenantId']).toBe('tenant-abc');
  });
});

// ============================================================
// GET /sources/platform (T057)
// ============================================================

describe('GET /sources/platform', () => {
  it('returns only platform-wide sources for any authenticated user', async () => {
    const db = buildMockDb();
    db._selectResults = [makeSource()];

    const result = await invokeSourcesRoute(db, 'get', '/sources/platform', {
      headers: { 'x-tenant-id': 'tenant-abc' },
    });

    expect(result.status).toBe(200);
    const body = result.body as Record<string, unknown>;
    expect(Array.isArray(body['data'])).toBe(true);
    expect((body['data'] as unknown[]).length).toBe(1);
  });

  it('returns platform-wide sources without authConfig (hasSecret)', async () => {
    const db = buildMockDb();
    db._selectResults = [makeSource()];

    const result = await invokeSourcesRoute(db, 'get', '/sources/platform');

    const body = result.body as Record<string, unknown>;
    const items = body['data'] as Record<string, unknown>[];
    expect(items[0]).not.toHaveProperty('authConfig');
    expect(items[0]?.['hasSecret']).toBe(true);
  });

  it('returns empty array when no platform-wide sources exist', async () => {
    const db = buildMockDb();
    db._selectResults = [];

    const result = await invokeSourcesRoute(db, 'get', '/sources/platform');

    expect(result.status).toBe(200);
    expect((result.body as Record<string, unknown>)['data']).toEqual([]);
  });
});

// ============================================================
// GET /sources — tenant sees own + platform-wide (T057)
// ============================================================

describe('GET /sources — tenant sees own + platform-wide sources', () => {
  it('returns combined tenant own + platform-wide sources', async () => {
    const db = buildMockDb();
    const tenantSource = makeTenantSource();
    const platformSource = makeSource();
    db._selectResults = [tenantSource, platformSource];

    const result = await invokeSourcesRoute(db, 'get', '/sources', {
      headers: { 'x-tenant-id': 'tenant-abc' },
    });

    expect(result.status).toBe(200);
    const body = result.body as Record<string, unknown>;
    expect((body['data'] as unknown[]).length).toBe(2);
  });
});

// ============================================================
// POST /sources/:id/subscribe (T058)
// ============================================================

describe('POST /sources/:id/subscribe', () => {
  it('returns 201 with subscription record on success', async () => {
    const db = buildMockDb();
    const source = makeSource();
    const sub = makeSubscription();

    db._selectResults = [source];
    db._insertResults = [sub];

    const result = await invokeSubscriptionsRoute(db, 'post', '/sources/src-platform-001/subscribe', {
      headers: { 'x-tenant-id': 'tenant-abc' },
      body: { target_pipeline_id: 'pipe-abc' },
    });

    expect(result.status).toBe(201);
    expect((result.body as Record<string, unknown>)['id']).toBe('sub-001');
  });

  it('returns 404 when source does not exist', async () => {
    const db = buildMockDb();
    db._selectResults = [];

    const result = await invokeSubscriptionsRoute(db, 'post', '/sources/nonexistent/subscribe', {
      headers: { 'x-tenant-id': 'tenant-abc' },
      body: { target_pipeline_id: 'pipe-abc' },
    });

    expect(result.status).toBe(404);
    expect((result.body as Record<string, unknown>)['error']).toBe('not_found');
  });

  it('returns 422 when source is not platform-wide', async () => {
    const db = buildMockDb();
    db._selectResults = [makeTenantSource()]; // isPlatformWide: false

    const result = await invokeSubscriptionsRoute(db, 'post', '/sources/src-tenant-001/subscribe', {
      headers: { 'x-tenant-id': 'tenant-abc' },
      body: { target_pipeline_id: 'pipe-abc' },
    });

    expect(result.status).toBe(422);
    expect((result.body as Record<string, unknown>)['error']).toBe('not_platform_wide');
  });

  it('returns 400 when target_pipeline_id is missing', async () => {
    const db = buildMockDb();
    db._selectResults = [makeSource()];

    const result = await invokeSubscriptionsRoute(db, 'post', '/sources/src-platform-001/subscribe', {
      headers: { 'x-tenant-id': 'tenant-abc' },
      body: {},
    });

    expect(result.status).toBe(400);
    expect((result.body as Record<string, unknown>)['error']).toBe('validation_error');
  });

  it('returns 400 when target_pipeline_id is empty string', async () => {
    const db = buildMockDb();
    db._selectResults = [makeSource()];

    const result = await invokeSubscriptionsRoute(db, 'post', '/sources/src-platform-001/subscribe', {
      headers: { 'x-tenant-id': 'tenant-abc' },
      body: { target_pipeline_id: '   ' },
    });

    expect(result.status).toBe(400);
  });

  it('returns 403 when no tenant id (platform admin cannot subscribe)', async () => {
    const db = buildMockDb();

    const result = await invokeSubscriptionsRoute(db, 'post', '/sources/src-platform-001/subscribe', {
      // No x-tenant-id
      body: { target_pipeline_id: 'pipe-abc' },
    });

    expect(result.status).toBe(403);
  });

  it('returns 409 with already_subscribed and subscription_id on duplicate', async () => {
    const db = buildMockDb();
    const source = makeSource();
    const existingSub = makeSubscription({ id: 'sub-existing' });

    // First select: source lookup succeeds
    db._selectResults = [source];

    // Insert throws unique violation
    db.insert.mockImplementation(() => ({
      values: vi.fn(() => ({
        returning: vi.fn(() =>
          Promise.reject(Object.assign(new Error('duplicate key value violates unique constraint'), { code: '23505' })),
        ),
      })),
    }));

    // Second select for existing subscription lookup
    let selectCount = 0;
    db.select.mockImplementation(() => ({
      from: vi.fn(() => ({
        where: vi.fn(() => {
          selectCount++;
          if (selectCount === 1) return Promise.resolve([source]);
          return Promise.resolve([existingSub]);
        }),
      })),
    }));

    const result = await invokeSubscriptionsRoute(db, 'post', '/sources/src-platform-001/subscribe', {
      headers: { 'x-tenant-id': 'tenant-abc' },
      body: { target_pipeline_id: 'pipe-abc' },
    });

    expect(result.status).toBe(409);
    expect((result.body as Record<string, unknown>)['error']).toBe('already_subscribed');
    expect((result.body as Record<string, unknown>)['subscription_id']).toBe('sub-existing');
  });
});

// ============================================================
// DELETE /sources/:id/unsubscribe (T058)
// ============================================================

describe('DELETE /sources/:id/unsubscribe', () => {
  it('returns 204 on successful unsubscribe', async () => {
    const db = buildMockDb();
    db._deleteResults = [makeSubscription()];

    const result = await invokeSubscriptionsRoute(db, 'delete', '/sources/src-platform-001/unsubscribe', {
      headers: { 'x-tenant-id': 'tenant-abc' },
    });

    expect(result.status).toBe(204);
    expect(result.sent).toBe(true);
  });

  it('returns 404 when tenant is not subscribed', async () => {
    const db = buildMockDb();
    db._deleteResults = []; // no row deleted

    const result = await invokeSubscriptionsRoute(db, 'delete', '/sources/src-platform-001/unsubscribe', {
      headers: { 'x-tenant-id': 'tenant-abc' },
    });

    expect(result.status).toBe(404);
    expect((result.body as Record<string, unknown>)['error']).toBe('not_found');
  });

  it('returns 403 when no tenant id (platform admin cannot unsubscribe)', async () => {
    const db = buildMockDb();

    const result = await invokeSubscriptionsRoute(db, 'delete', '/sources/src-platform-001/unsubscribe', {
      // No x-tenant-id
    });

    expect(result.status).toBe(403);
  });
});

// ============================================================
// GET /sources/:id/subscriptions (T058 — platform admin only)
// ============================================================

describe('GET /sources/:id/subscriptions', () => {
  it('returns 200 with subscriptions list for platform admin', async () => {
    const db = buildMockDb();
    const subs = [
      makeSubscription({ id: 'sub-001', tenantId: 'tenant-a' }),
      makeSubscription({ id: 'sub-002', tenantId: 'tenant-b' }),
    ];
    db._selectResults = subs;

    const result = await invokeSubscriptionsRoute(db, 'get', '/sources/src-platform-001/subscriptions', {
      // No x-tenant-id — platform admin
    });

    expect(result.status).toBe(200);
    const body = result.body as Record<string, unknown>;
    expect((body['data'] as unknown[]).length).toBe(2);
  });

  it('returns 403 when tenant admin tries to list subscriptions', async () => {
    const db = buildMockDb();

    const result = await invokeSubscriptionsRoute(db, 'get', '/sources/src-platform-001/subscriptions', {
      headers: { 'x-tenant-id': 'tenant-abc' },
    });

    expect(result.status).toBe(403);
    expect((result.body as Record<string, unknown>)['error']).toBe('forbidden');
  });

  it('returns paginated results with limit and offset', async () => {
    const db = buildMockDb();
    db._selectResults = [makeSubscription()];

    const result = await invokeSubscriptionsRoute(db, 'get', '/sources/src-platform-001/subscriptions', {
      query: { limit: '10', offset: '5' },
    });

    const body = result.body as Record<string, unknown>;
    expect(body['limit']).toBe(10);
    expect(body['offset']).toBe(5);
  });
});

// ============================================================
// FAN-OUT (T059)
// ============================================================

describe('fanOutPlatformEvent', () => {
  it('creates child events for each active subscription', async () => {
    const db = buildMockDb();
    const event = makeWebhookEvent();
    const subs = [
      makeSubscription({ id: 'sub-001', tenantId: 'tenant-a', targetPipelineId: 'pipe-a' }),
      makeSubscription({ id: 'sub-002', tenantId: 'tenant-b', targetPipelineId: 'pipe-b' }),
    ];

    // select().from().where() returns subscriptions
    db.select.mockImplementation(() => ({
      from: vi.fn(() => ({
        where: vi.fn(() => Promise.resolve(subs)),
      })),
    }));

    // insert().values().returning() returns child event
    const insertedPayloads: unknown[] = [];
    db.insert.mockImplementation(() => ({
      values: vi.fn((vals: unknown) => {
        insertedPayloads.push(vals);
        return {
          returning: vi.fn(() => Promise.resolve([{ ...event, id: `child-${insertedPayloads.length}` }])),
        };
      }),
    }));

    const triggerCall: TriggerCall = {
      tenantId: 'tenant-platform',
      pipelineId: 'pipe-platform',
      triggerType: 'manual-request',
      metadata: {},
      sourceEventId: event.id,
    };
    const forwarder = new TriggerForwarder({ eventBusUrl: undefined });

    const result = await fanOutPlatformEvent(db as never, event, triggerCall, forwarder);

    expect(result.succeeded).toBe(2);
    expect(result.failed).toBe(0);
    expect(insertedPayloads.length).toBe(2);

    // Verify child events use subscription's tenantId
    const firstInsert = insertedPayloads[0] as Record<string, unknown>;
    const secondInsert = insertedPayloads[1] as Record<string, unknown>;
    expect(firstInsert['tenantId']).toBe('tenant-a');
    expect(secondInsert['tenantId']).toBe('tenant-b');

    // Verify signatureValid is set to true
    expect(firstInsert['signatureValid']).toBe(true);
  });

  it('returns succeeded:0 when there are no subscriptions', async () => {
    const db = buildMockDb();
    const event = makeWebhookEvent();

    db.select.mockImplementation(() => ({
      from: vi.fn(() => ({
        where: vi.fn(() => Promise.resolve([])),
      })),
    }));

    const triggerCall: TriggerCall = {
      tenantId: 'tenant-platform',
      pipelineId: 'pipe-platform',
      triggerType: 'manual-request',
      metadata: {},
      sourceEventId: event.id,
    };
    const forwarder = new TriggerForwarder({ eventBusUrl: undefined });

    const result = await fanOutPlatformEvent(db as never, event, triggerCall, forwarder);

    expect(result.succeeded).toBe(0);
    expect(result.failed).toBe(0);
  });

  it('one subscription failure does not block others (Promise.allSettled)', async () => {
    const db = buildMockDb();
    const event = makeWebhookEvent();
    const subs = [
      makeSubscription({ id: 'sub-001', tenantId: 'tenant-a' }),
      makeSubscription({ id: 'sub-002', tenantId: 'tenant-b' }),
      makeSubscription({ id: 'sub-003', tenantId: 'tenant-c' }),
    ];

    db.select.mockImplementation(() => ({
      from: vi.fn(() => ({
        where: vi.fn(() => Promise.resolve(subs)),
      })),
    }));

    let callCount = 0;
    db.insert.mockImplementation(() => ({
      values: vi.fn(() => {
        callCount++;
        if (callCount === 2) {
          // Second insertion fails
          return {
            returning: vi.fn(() => Promise.reject(new Error('DB write error'))),
          };
        }
        return {
          returning: vi.fn(() => Promise.resolve([{ ...event, id: `child-${callCount}` }])),
        };
      }),
    }));

    const triggerCall: TriggerCall = {
      tenantId: 'tenant-platform',
      pipelineId: 'pipe-platform',
      triggerType: 'manual-request',
      metadata: {},
      sourceEventId: event.id,
    };
    const forwarder = new TriggerForwarder({ eventBusUrl: undefined });

    const result = await fanOutPlatformEvent(db as never, event, triggerCall, forwarder);

    expect(result.succeeded).toBe(2);
    expect(result.failed).toBe(1);
  });

  it('skips inactive subscriptions', async () => {
    const db = buildMockDb();
    const event = makeWebhookEvent();
    const subs = [
      makeSubscription({ id: 'sub-001', tenantId: 'tenant-a', isActive: true }),
      makeSubscription({ id: 'sub-002', tenantId: 'tenant-b', isActive: false }),
    ];

    // Mock simulates DB-level isActive filter — returns only active subscriptions
    db.select.mockImplementation(() => ({
      from: vi.fn(() => ({
        where: vi.fn(() => Promise.resolve(subs.filter((s) => s.isActive))),
      })),
    }));

    const insertedTenants: string[] = [];
    db.insert.mockImplementation(() => ({
      values: vi.fn((vals: unknown) => {
        insertedTenants.push((vals as Record<string, unknown>)['tenantId'] as string);
        return {
          returning: vi.fn(() => Promise.resolve([{ ...event, id: 'child-1' }])),
        };
      }),
    }));

    const triggerCall: TriggerCall = {
      tenantId: 'tenant-platform',
      pipelineId: 'pipe-platform',
      triggerType: 'manual-request',
      metadata: {},
      sourceEventId: event.id,
    };
    const forwarder = new TriggerForwarder({ eventBusUrl: undefined });

    const result = await fanOutPlatformEvent(db as never, event, triggerCall, forwarder);

    expect(result.succeeded).toBe(1);
    expect(insertedTenants).toEqual(['tenant-a']); // tenant-b skipped
  });
});

// ============================================================
// TENANT ISOLATION
// ============================================================

describe('tenant isolation', () => {
  it('tenant A unsubscribe only affects their own subscription (scoped delete)', async () => {
    const db = buildMockDb();

    // Tenant A successfully deletes their own subscription
    db._deleteResults = [makeSubscription({ tenantId: 'tenant-a' })];

    // Mock delete to capture the where clause being called
    const whereSpy = vi.fn(() => ({
      returning: vi.fn(() => Promise.resolve(db._deleteResults)),
    }));
    db.delete.mockImplementation(() => ({ where: whereSpy }));

    const result = await invokeSubscriptionsRoute(db, 'delete', '/sources/src-platform-001/unsubscribe', {
      headers: { 'x-tenant-id': 'tenant-a' },
    });

    // Should succeed — scoped to tenant-a
    expect(result.status).toBe(204);
    // where() was called (enforces tenant+source scoping)
    expect(whereSpy).toHaveBeenCalled();
  });

  it('tenant A cannot list subscriptions for tenant B (admin-only endpoint)', async () => {
    const db = buildMockDb();

    // Both tenant A and tenant B try to list; only admin (no header) succeeds
    const resultTenantA = await invokeSubscriptionsRoute(db, 'get', '/sources/src-platform-001/subscriptions', {
      headers: { 'x-tenant-id': 'tenant-a' },
    });

    expect(resultTenantA.status).toBe(403);
  });

  it('tenant A cannot subscribe without a tenant id (platform admin identity is protected)', async () => {
    const db = buildMockDb();

    const result = await invokeSubscriptionsRoute(db, 'post', '/sources/src-platform-001/subscribe', {
      // No x-tenant-id — would impersonate platform admin
      body: { target_pipeline_id: 'pipe-abc' },
    });

    expect(result.status).toBe(403);
  });
});
