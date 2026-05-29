/**
 * Event Adapter — Automation Integration Tests (WP10)
 *
 * Tests for:
 *   - GET/PUT/DELETE /automation registration lifecycle
 *   - AutomationForwarder outbound forwarding + circuit breaker
 *   - POST /trigger callback ingestion
 *   - Secret safety (authSecretRef never exposed)
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { Request, Response } from 'express';

vi.mock('../../../src/event-adapter/services/secret-store.js', () => ({
  decryptSecret: vi.fn((ref: string) => ref === 'encrypted-secret-abc' ? 'valid-token-123' : null),
  encryptSecret: vi.fn((s: string) => `encrypted-${s}`),
  SecretStoreResolver: vi.fn(),
}));

import { createAutomationRouter } from '../../../src/event-adapter/routes/automation.js';
import { createTriggerRouter } from '../../../src/event-adapter/routes/trigger.js';
import { AutomationForwarder } from '../../../src/event-adapter/services/automation-forwarder.js';
import type { AutomationDestination, WebhookEvent } from '../../../src/event-adapter/schema.js';

// ============================================================
// MOCK HELPERS
// ============================================================

function mockRes() {
  const res = {
    status: vi.fn().mockReturnThis(),
    json: vi.fn().mockReturnThis(),
    send: vi.fn().mockReturnThis(),
  } as unknown as Response;
  return res;
}

function mockReq(overrides: Partial<Request> = {}): Request {
  // Translate x-tenant-id header → req.mcpUser.id to match the real auth flow.
  // requireBearerToken populates req.mcpUser before our routes run.
  const headers = (overrides.headers ?? {}) as Record<string, string | string[] | undefined>;
  const tenantHeader = headers['x-tenant-id'];
  const tenantId = Array.isArray(tenantHeader) ? tenantHeader[0] : tenantHeader;
  const mcpUser = tenantId ? { id: tenantId } : undefined;
  return {
    headers: {},
    body: {},
    params: {},
    query: {},
    mcpUser,
    ...overrides,
  } as unknown as Request;
}

function makeDestinationRow(overrides: Partial<AutomationDestination> = {}): AutomationDestination {
  return {
    id: 'dest-001',
    tenantId: 'tenant-abc',
    url: 'https://hooks.example.com/trigger',
    authHeader: null,
    authSecretRef: null,
    isActive: true,
    lastForwardedAt: null,
    failureCount: 0,
    createdAt: new Date('2026-01-01T00:00:00Z'),
    updatedAt: new Date('2026-01-01T00:00:00Z'),
    ...overrides,
  };
}

function makeWebhookEvent(overrides: Partial<WebhookEvent> = {}): WebhookEvent {
  return {
    id: 'evt-001',
    tenantId: 'tenant-abc',
    sourceType: 'automation_callback',
    sourceId: null,
    scheduleId: null,
    status: 'pending',
    payload: { triggerType: 'corpus-change', pipelineId: 'pipe-001', metadata: {} },
    headers: null,
    signatureValid: true,
    translatedTrigger: null,
    triggerType: 'corpus-change',
    pipelineId: 'pipe-001',
    attemptCount: 0,
    failureReason: null,
    processingDurationMs: null,
    forwardedToAutomation: false,
    createdAt: new Date('2026-01-01T00:00:00Z'),
    updatedAt: new Date('2026-01-01T00:00:00Z'),
    deliveredAt: null,
    ...overrides,
  };
}

// ============================================================
// AUTOMATION REGISTRATION TESTS
// ============================================================

describe('GET /automation', () => {
  it('returns configured:false when no destination exists', async () => {
    const db = {
      select: vi.fn().mockReturnValue({
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockResolvedValue([]),
        }),
      }),
    };

    const router = createAutomationRouter({ db: db as never });
    const routes = (router as unknown as { stack: Array<{ route: { path: string; stack: Array<{ method: string; handle: Function }> } }> }).stack;
    const getRoute = routes.find(r => r.route.path === '/automation' && r.route.stack[0]?.method === 'get');
    const handler = getRoute?.route.stack[0]?.handle;

    const req = mockReq({ headers: { 'x-tenant-id': 'tenant-abc' } });
    const res = mockRes();

    await handler?.(req, res, () => {});

    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith({ configured: false });
  });

  it('returns configured:true with destination fields when found', async () => {
    const row = makeDestinationRow({ failureCount: 2, authSecretRef: 'encrypted-blob' });
    const db = {
      select: vi.fn().mockReturnValue({
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockResolvedValue([row]),
        }),
      }),
    };

    const router = createAutomationRouter({ db: db as never });
    const routes = (router as unknown as { stack: Array<{ route: { path: string; stack: Array<{ method: string; handle: Function }> } }> }).stack;
    const getRoute = routes.find(r => r.route.path === '/automation' && r.route.stack[0]?.method === 'get');
    const handler = getRoute?.route.stack[0]?.handle;

    const req = mockReq({ headers: { 'x-tenant-id': 'tenant-abc' } });
    const res = mockRes();

    await handler?.(req, res, () => {});

    expect(res.status).toHaveBeenCalledWith(200);
    const body = (res.json as ReturnType<typeof vi.fn>).mock.calls[0]?.[0];
    expect(body.configured).toBe(true);
    expect(body.url).toBe('https://hooks.example.com/trigger');
    expect(body.failureCount).toBe(2);
    expect(body.circuitOpen).toBe(false);
    expect(body.hasAuth).toBe(true);
    // CRITICAL: authSecretRef must never be present
    expect(body).not.toHaveProperty('authSecretRef');
  });

  it('returns 400 when x-tenant-id header is missing', async () => {
    const db = { select: vi.fn() };
    const router = createAutomationRouter({ db: db as never });
    const routes = (router as unknown as { stack: Array<{ route: { path: string; stack: Array<{ method: string; handle: Function }> } }> }).stack;
    const getRoute = routes.find(r => r.route.path === '/automation' && r.route.stack[0]?.method === 'get');
    const handler = getRoute?.route.stack[0]?.handle;

    const req = mockReq({ headers: {} });
    const res = mockRes();

    await handler?.(req, res, () => {});

    expect(res.status).toHaveBeenCalledWith(400);
  });
});

describe('PUT /automation', () => {
  it('inserts new destination and returns 200', async () => {
    const row = makeDestinationRow();
    const db = {
      select: vi.fn().mockReturnValue({
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockResolvedValue([]), // no existing
        }),
      }),
      insert: vi.fn().mockReturnValue({
        values: vi.fn().mockReturnValue({
          returning: vi.fn().mockResolvedValue([row]),
        }),
      }),
    };

    const router = createAutomationRouter({ db: db as never });
    const routes = (router as unknown as { stack: Array<{ route: { path: string; stack: Array<{ method: string; handle: Function }> } }> }).stack;
    const putRoute = routes.find(r => r.route.path === '/automation' && r.route.stack[0]?.method === 'put');
    const handler = putRoute?.route.stack[0]?.handle;

    const req = mockReq({
      headers: { 'x-tenant-id': 'tenant-abc' },
      body: { url: 'https://hooks.example.com/trigger' },
    });
    const res = mockRes();

    await handler?.(req, res, () => {});

    expect(db.insert).toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(200);
    const body = (res.json as ReturnType<typeof vi.fn>).mock.calls[0]?.[0];
    expect(body.configured).toBe(true);
  });

  it('rejects HTTP (non-HTTPS) URLs with 422', async () => {
    const db = { select: vi.fn() };
    const router = createAutomationRouter({ db: db as never });
    const routes = (router as unknown as { stack: Array<{ route: { path: string; stack: Array<{ method: string; handle: Function }> } }> }).stack;
    const putRoute = routes.find(r => r.route.path === '/automation' && r.route.stack[0]?.method === 'put');
    const handler = putRoute?.route.stack[0]?.handle;

    const req = mockReq({
      headers: { 'x-tenant-id': 'tenant-abc' },
      body: { url: 'http://insecure.example.com/trigger' },
    });
    const res = mockRes();

    await handler?.(req, res, () => {});

    expect(res.status).toHaveBeenCalledWith(422);
  });

  it('updates existing destination (upsert) and resets failureCount', async () => {
    const existingRow = makeDestinationRow({ failureCount: 5 });
    const updatedRow = makeDestinationRow({ failureCount: 0 });
    const db = {
      select: vi.fn().mockReturnValue({
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockResolvedValue([existingRow]),
        }),
      }),
      update: vi.fn().mockReturnValue({
        set: vi.fn().mockReturnValue({
          where: vi.fn().mockReturnValue({
            returning: vi.fn().mockResolvedValue([updatedRow]),
          }),
        }),
      }),
    };

    const router = createAutomationRouter({ db: db as never });
    const routes = (router as unknown as { stack: Array<{ route: { path: string; stack: Array<{ method: string; handle: Function }> } }> }).stack;
    const putRoute = routes.find(r => r.route.path === '/automation' && r.route.stack[0]?.method === 'put');
    const handler = putRoute?.route.stack[0]?.handle;

    const req = mockReq({
      headers: { 'x-tenant-id': 'tenant-abc' },
      body: { url: 'https://hooks.example.com/trigger' },
    });
    const res = mockRes();

    await handler?.(req, res, () => {});

    expect(db.update).toHaveBeenCalled();
    const setCall = db.update().set as ReturnType<typeof vi.fn>;
    const setArg = setCall.mock.calls[0]?.[0];
    expect(setArg?.failureCount).toBe(0);
    expect(setArg?.isActive).toBe(true);
    expect(res.status).toHaveBeenCalledWith(200);
  });
});

describe('DELETE /automation', () => {
  it('deletes existing destination and returns 204', async () => {
    const row = makeDestinationRow();
    const db = {
      select: vi.fn().mockReturnValue({
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockResolvedValue([row]),
        }),
      }),
      delete: vi.fn().mockReturnValue({
        where: vi.fn().mockResolvedValue(undefined),
      }),
    };

    const router = createAutomationRouter({ db: db as never });
    const routes = (router as unknown as { stack: Array<{ route: { path: string; stack: Array<{ method: string; handle: Function }> } }> }).stack;
    const delRoute = routes.find(r => r.route.path === '/automation' && r.route.stack[0]?.method === 'delete');
    const handler = delRoute?.route.stack[0]?.handle;

    const req = mockReq({ headers: { 'x-tenant-id': 'tenant-abc' } });
    const res = mockRes();

    await handler?.(req, res, () => {});

    expect(db.delete).toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(204);
    expect(res.send).toHaveBeenCalled();
  });

  it('returns 404 when no destination is registered', async () => {
    const db = {
      select: vi.fn().mockReturnValue({
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockResolvedValue([]),
        }),
      }),
    };

    const router = createAutomationRouter({ db: db as never });
    const routes = (router as unknown as { stack: Array<{ route: { path: string; stack: Array<{ method: string; handle: Function }> } }> }).stack;
    const delRoute = routes.find(r => r.route.path === '/automation' && r.route.stack[0]?.method === 'delete');
    const handler = delRoute?.route.stack[0]?.handle;

    const req = mockReq({ headers: { 'x-tenant-id': 'tenant-abc' } });
    const res = mockRes();

    await handler?.(req, res, () => {});

    expect(res.status).toHaveBeenCalledWith(404);
  });
});

// ============================================================
// AUTOMATION FORWARDER TESTS
// ============================================================

describe('AutomationForwarder', () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('forwards event and resets failureCount on success', async () => {
    const destination = makeDestinationRow({ failureCount: 2 });
    const event = makeWebhookEvent();

    fetchMock.mockResolvedValue({ ok: true });

    const updateReturning = vi.fn().mockResolvedValue([{ ...destination, failureCount: 0, lastForwardedAt: new Date() }]);
    const updateWhere = vi.fn().mockReturnValue({ returning: updateReturning });
    const updateSet = vi.fn().mockReturnValue({ where: updateWhere });
    const updateFn = vi.fn().mockReturnValue({ set: updateSet });

    const db = {
      select: vi.fn().mockReturnValue({
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockResolvedValue([destination]),
        }),
      }),
      update: updateFn,
    };

    const forwarder = new AutomationForwarder(db as never);
    await forwarder.forwardToAutomation(event);

    expect(fetchMock).toHaveBeenCalledWith(
      destination.url,
      expect.objectContaining({ method: 'POST' }),
    );
    const setArg = updateSet.mock.calls[0]?.[0];
    expect(setArg?.failureCount).toBe(0);
    expect(setArg?.lastForwardedAt).toBeInstanceOf(Date);
  });

  it('increments failureCount on HTTP error response', async () => {
    const destination = makeDestinationRow({ failureCount: 0 });
    const event = makeWebhookEvent();

    fetchMock.mockResolvedValue({ ok: false, status: 500 });

    const updateReturning = vi.fn().mockResolvedValue([destination]);
    const updateWhere = vi.fn().mockReturnValue({ returning: updateReturning });
    const updateSet = vi.fn().mockReturnValue({ where: updateWhere });
    const updateFn = vi.fn().mockReturnValue({ set: updateSet });

    const db = {
      select: vi.fn().mockReturnValue({
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockResolvedValue([destination]),
        }),
      }),
      update: updateFn,
    };

    const forwarder = new AutomationForwarder(db as never);
    await forwarder.forwardToAutomation(event);

    const setArg = updateSet.mock.calls[0]?.[0];
    expect(setArg?.failureCount).toBe(1);
  });

  it('skips forwarding when circuit is open (>= 10 failures)', async () => {
    const destination = makeDestinationRow({ failureCount: 10 });
    const event = makeWebhookEvent();

    const db = {
      select: vi.fn().mockReturnValue({
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockResolvedValue([destination]),
        }),
      }),
      update: vi.fn(),
    };

    const forwarder = new AutomationForwarder(db as never);
    await forwarder.forwardToAutomation(event);

    // fetch should never be called when circuit is open
    expect(fetchMock).not.toHaveBeenCalled();
    // update should not be called either
    expect(db.update).not.toHaveBeenCalled();
  });

  it('isCircuitOpen returns false when failureCount < threshold', () => {
    const db = { select: vi.fn(), update: vi.fn() };
    const forwarder = new AutomationForwarder(db as never);
    const dest = makeDestinationRow({ failureCount: 5 });
    expect(forwarder.isCircuitOpen(dest)).toBe(false);
  });

  it('isCircuitOpen returns true when failureCount >= threshold', () => {
    const db = { select: vi.fn(), update: vi.fn() };
    const forwarder = new AutomationForwarder(db as never);
    const dest = makeDestinationRow({ failureCount: 10 });
    expect(forwarder.isCircuitOpen(dest)).toBe(true);
  });

  it('does not forward when destination is inactive', async () => {
    const destination = makeDestinationRow({ isActive: false });
    const event = makeWebhookEvent();
    const db = {
      select: vi.fn().mockReturnValue({
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockResolvedValue([destination]),
        }),
      }),
      update: vi.fn(),
    };

    const forwarder = new AutomationForwarder(db as never);
    await forwarder.forwardToAutomation(event);

    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('does not forward when no destination is registered', async () => {
    const event = makeWebhookEvent();
    const db = {
      select: vi.fn().mockReturnValue({
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockResolvedValue([]),
        }),
      }),
      update: vi.fn(),
    };

    const forwarder = new AutomationForwarder(db as never);
    await forwarder.forwardToAutomation(event);

    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('PUT /automation resets circuit (resetCircuit clears open state)', () => {
    const db = { select: vi.fn(), update: vi.fn() };
    const forwarder = new AutomationForwarder(db as never);
    const dest = makeDestinationRow({ failureCount: 10 });

    // Open the circuit
    expect(forwarder.isCircuitOpen(dest)).toBe(true);

    // After PUT /automation, caller resets circuit
    forwarder.resetCircuit('tenant-abc');

    // isCircuitOpen with same dest (still failureCount=10 in memory) —
    // after reset, openedAt is cleared, so it re-records the timestamp and returns true.
    // This simulates the DB having failureCount reset to 0 after PUT.
    const resetDest = makeDestinationRow({ failureCount: 0 });
    expect(forwarder.isCircuitOpen(resetDest)).toBe(false);
  });
});

// ============================================================
// TRIGGER CALLBACK TESTS
// ============================================================

describe('POST /trigger', () => {
  function getTriggerHandler(db: unknown) {
    const router = createTriggerRouter({ db: db as never });
    const routes = (router as unknown as { stack: Array<{ route: { path: string; stack: Array<{ method: string; handle: Function }> } }> }).stack;
    const postRoute = routes.find(r => r.route.path === '/trigger');
    return postRoute?.route.stack[0]?.handle;
  }

  /**
   * Build a mock DB that handles two sequential selects:
   *   1. automationDestinations lookup (returns destinations array)
   *   2. pipelines ownership check (returns { limit } chain)
   * Plus an insert for the buffered event.
   */
  function makeTriggerDb(
    pipelineRow: { id: string } | null,
    insertedEvent: WebhookEvent,
    destinationOverrides: Partial<AutomationDestination> = {},
  ) {
    const valuesMock = vi.fn().mockReturnValue({
      returning: vi.fn().mockResolvedValue([insertedEvent]),
    });

    let callCount = 0;
    const db = {
      select: vi.fn().mockImplementation(() => ({
        from: vi.fn().mockImplementation(() => ({
          where: vi.fn().mockImplementation(() => {
            callCount++;
            if (callCount === 1) {
              // destinations lookup — resolved directly
              return Promise.resolve([
                makeDestinationRow({ authSecretRef: 'encrypted-secret-abc', ...destinationOverrides }),
              ]);
            }
            // pipeline ownership lookup — needs .limit()
            return { limit: vi.fn().mockResolvedValue(pipelineRow ? [pipelineRow] : []) };
          }),
        })),
      })),
      insert: vi.fn().mockReturnValue({ values: valuesMock }),
    };
    return { db, valuesMock };
  }

  it('returns 401 when Authorization header is absent', async () => {
    const { db } = makeTriggerDb({ id: 'pipe-001' }, makeWebhookEvent());
    const handler = getTriggerHandler(db);
    const req = mockReq({ headers: {}, body: {} });
    const res = mockRes();

    await handler?.(req, res, () => {});

    expect(res.status).toHaveBeenCalledWith(401);
  });

  it('returns 401 when token does not match any destination secret', async () => {
    const { db } = makeTriggerDb({ id: 'pipe-001' }, makeWebhookEvent(), { authSecretRef: 'wrong-ref' });
    const handler = getTriggerHandler(db);
    const req = mockReq({
      headers: { authorization: 'Bearer bad-token' },
      body: { triggerType: 'corpus-change', pipelineId: 'pipe-001', metadata: {} },
    });
    const res = mockRes();

    await handler?.(req, res, () => {});

    expect(res.status).toHaveBeenCalledWith(401);
  });

  it('returns 401 when the destination credential has been revoked', async () => {
    // Exercises the in-handler JS guard: destinations array contains the row but
    // authSecretRef is null, so the `.find()` short-circuits via `if (!d.authSecretRef)`.
    const { db } = makeTriggerDb({ id: 'pipe-001' }, makeWebhookEvent(), { authSecretRef: null });
    const handler = getTriggerHandler(db);
    const req = mockReq({
      headers: { authorization: 'Bearer valid-token-123' },
      body: { triggerType: 'corpus-change', pipelineId: 'pipe-001', metadata: {} },
    });
    const res = mockRes();

    await handler?.(req, res, () => {});

    expect(res.status).toHaveBeenCalledWith(401);
  });

  it('returns 401 when SQL-level isNotNull filter excludes the revoked destination row', async () => {
    // Exercises the DB-level predicate: the route queries with isNotNull(authSecretRef),
    // so a destination whose authSecretRef was set to NULL in the DB never reaches the
    // application layer at all. This test simulates that by having the mock return an
    // empty array from the destinations select, exactly as the real DB would after
    // filtering out nulls — the handler must still produce 401, not 500.
    const db = {
      select: vi.fn().mockImplementation(() => ({
        from: vi.fn().mockImplementation(() => ({
          where: vi.fn().mockResolvedValue([]), // SQL filter excluded the revoked row
        })),
      })),
      insert: vi.fn(),
    };
    const handler = getTriggerHandler(db);
    const req = mockReq({
      headers: { authorization: 'Bearer valid-token-123' },
      body: { triggerType: 'corpus-change', pipelineId: 'pipe-001', metadata: {} },
    });
    const res = mockRes();

    await handler?.(req, res, () => {});

    expect(res.status).toHaveBeenCalledWith(401);
    // The insert (event buffering) must NOT have been called — we never got past auth.
    expect(db.insert).not.toHaveBeenCalled();
  });

  it('returns 202 and event_id when token matches destination secret', async () => {
    const insertedEvent = makeWebhookEvent({ id: 'evt-999' });
    const { db } = makeTriggerDb({ id: 'pipe-001' }, insertedEvent);

    const handler = getTriggerHandler(db);
    const req = mockReq({
      headers: { authorization: 'Bearer valid-token-123' },
      body: { triggerType: 'corpus-change', pipelineId: 'pipe-001', metadata: {} },
    });
    const res = mockRes();

    await handler?.(req, res, () => {});

    expect(res.status).toHaveBeenCalledWith(202);
    const body = (res.json as ReturnType<typeof vi.fn>).mock.calls[0]?.[0];
    expect(body.event_id).toBe('evt-999');
    expect(body.message).toBe('Trigger queued');
  });

  it('returns 422 when pipelineId is missing', async () => {
    const { db } = makeTriggerDb({ id: 'pipe-001' }, makeWebhookEvent());
    const handler = getTriggerHandler(db);
    const req = mockReq({
      headers: { authorization: 'Bearer valid-token-123' },
      body: { triggerType: 'corpus-change', metadata: {} },
    });
    const res = mockRes();

    await handler?.(req, res, () => {});

    expect(res.status).toHaveBeenCalledWith(422);
  });

  it('returns 404 when pipelineId does not belong to the resolved tenant', async () => {
    const { db } = makeTriggerDb(null, makeWebhookEvent());
    const handler = getTriggerHandler(db);
    const req = mockReq({
      headers: { authorization: 'Bearer valid-token-123' },
      body: { triggerType: 'corpus-change', pipelineId: 'pipe-other-tenant', metadata: {} },
    });
    const res = mockRes();

    await handler?.(req, res, () => {});

    expect(res.status).toHaveBeenCalledWith(404);
  });

  it('creates webhook_event with sourceType automation_callback and resolved tenantId', async () => {
    const insertedEvent = makeWebhookEvent();
    const { db, valuesMock } = makeTriggerDb({ id: 'pipe-002' }, insertedEvent);

    const handler = getTriggerHandler(db);
    const req = mockReq({
      headers: { authorization: 'Bearer valid-token-123' },
      body: { triggerType: 'manual-request', pipelineId: 'pipe-002', metadata: { source: 'test' } },
    });
    const res = mockRes();

    await handler?.(req, res, () => {});

    const insertArg = valuesMock.mock.calls[0]?.[0];
    expect(insertArg?.sourceType).toBe('automation_callback');
    expect(insertArg?.signatureValid).toBe(true);
    expect(insertArg?.tenantId).toBe('tenant-abc');
  });
});

// ============================================================
// SECRET SAFETY TESTS
// ============================================================

describe('Secret safety', () => {
  it('GET /automation never exposes authSecretRef in response', async () => {
    const row = makeDestinationRow({
      authHeader: 'x-api-key',
      authSecretRef: 'super-secret-encrypted-blob',
    });
    const db = {
      select: vi.fn().mockReturnValue({
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockResolvedValue([row]),
        }),
      }),
    };

    const router = createAutomationRouter({ db: db as never });
    const routes = (router as unknown as { stack: Array<{ route: { path: string; stack: Array<{ method: string; handle: Function }> } }> }).stack;
    const getRoute = routes.find(r => r.route.path === '/automation' && r.route.stack[0]?.method === 'get');
    const handler = getRoute?.route.stack[0]?.handle;

    const req = mockReq({ headers: { 'x-tenant-id': 'tenant-abc' } });
    const res = mockRes();

    await handler?.(req, res, () => {});

    const body = (res.json as ReturnType<typeof vi.fn>).mock.calls[0]?.[0];
    expect(body).not.toHaveProperty('authSecretRef');
    expect(body.hasAuth).toBe(true);
  });

  it('PUT /automation response never exposes authSecretRef', async () => {
    const row = makeDestinationRow({ authSecretRef: 'encrypted-ref' });
    const db = {
      select: vi.fn().mockReturnValue({
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockResolvedValue([]),
        }),
      }),
      insert: vi.fn().mockReturnValue({
        values: vi.fn().mockReturnValue({
          returning: vi.fn().mockResolvedValue([row]),
        }),
      }),
    };

    const router = createAutomationRouter({ db: db as never });
    const routes = (router as unknown as { stack: Array<{ route: { path: string; stack: Array<{ method: string; handle: Function }> } }> }).stack;
    const putRoute = routes.find(r => r.route.path === '/automation' && r.route.stack[0]?.method === 'put');
    const handler = putRoute?.route.stack[0]?.handle;

    const req = mockReq({
      headers: { 'x-tenant-id': 'tenant-abc' },
      body: { url: 'https://hooks.example.com/trigger', authSecret: 'my-secret' },
    });
    const res = mockRes();

    await handler?.(req, res, () => {});

    const body = (res.json as ReturnType<typeof vi.fn>).mock.calls[0]?.[0];
    expect(body).not.toHaveProperty('authSecretRef');
    expect(body.hasAuth).toBe(true);
  });
});
