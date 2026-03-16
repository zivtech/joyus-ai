/**
 * Unit tests for Event Source Management (WP07, T040).
 *
 * Covers:
 * - Secret store: AES-256-GCM encrypt/decrypt round-trip (T039)
 * - SecretStoreResolver: implements SecretResolver interface
 * - CRUD route handlers via mock Express req/res (T035–T038)
 * - Slug generation: format and per-call uniqueness (T036)
 * - Tenant isolation: scoping by x-tenant-id header (T040)
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Request, Response } from 'express';

import {
  encryptSecret,
  decryptSecret,
  SecretStoreResolver,
} from '../../../src/event-adapter/services/secret-store.js';
import { createSourcesRouter } from '../../../src/event-adapter/routes/sources.js';
import type { EventSource } from '../../../src/event-adapter/schema.js';

// ============================================================
// MOCK HELPERS
// ============================================================

function makeSource(overrides: Partial<EventSource> = {}): EventSource {
  return {
    id: 'src-001',
    tenantId: 'tenant-abc',
    name: 'Test Source',
    sourceType: 'generic_webhook',
    endpointSlug: 'test-source-a1b2c3',
    authMethod: 'hmac_sha256',
    authConfig: {
      headerName: 'x-hub-signature-256',
      algorithm: 'sha256',
      secretRef: encryptSecret('my-secret'),
    },
    payloadMapping: null,
    targetPipelineId: 'pipe-1',
    targetTriggerType: 'corpus-change',
    lifecycleState: 'active',
    isPlatformWide: false,
    createdAt: new Date('2026-01-01T00:00:00Z'),
    updatedAt: new Date('2026-01-01T00:00:00Z'),
    ...overrides,
  };
}

/** Build a minimal mock Express Request */
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

/** Build a mock Express Response that captures status and JSON */
function makeRes(): { res: Response; status: number | null; body: unknown } {
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
  return { res, ...captured, get status() { return captured.status; }, get body() { return captured.body; } };
}

// ============================================================
// SECRET STORE TESTS (T039)
// ============================================================

describe('encryptSecret / decryptSecret', () => {
  it('round-trips a plaintext secret', () => {
    const plaintext = 'my-super-secret-key-value';
    const encrypted = encryptSecret(plaintext);
    expect(encrypted).not.toBe(plaintext);
    expect(decryptSecret(encrypted)).toBe(plaintext);
  });

  it('produces different ciphertext on each call due to random IV', () => {
    const enc1 = encryptSecret('same-secret');
    const enc2 = encryptSecret('same-secret');
    expect(enc1).not.toBe(enc2);
  });

  it('returns null for tampered ciphertext', () => {
    const encrypted = encryptSecret('secret');
    const bytes = Buffer.from(encrypted, 'base64');
    // Flip the last byte of ciphertext to invalidate the auth tag
    bytes[bytes.length - 1] ^= 0xff;
    expect(decryptSecret(bytes.toString('base64'))).toBeNull();
  });

  it('returns null for empty string', () => {
    expect(decryptSecret('')).toBeNull();
  });

  it('returns null for a truncated blob (too short)', () => {
    // A valid blob must be at least IV(12) + authTag(16) + 1 = 29 bytes
    const short = Buffer.alloc(10).toString('base64');
    expect(decryptSecret(short)).toBeNull();
  });

  it('round-trips unicode secrets', () => {
    const plaintext = 'unicode-secret-🔑-value';
    expect(decryptSecret(encryptSecret(plaintext))).toBe(plaintext);
  });
});

describe('SecretStoreResolver', () => {
  it('resolves an encrypted secret ref back to plaintext', async () => {
    const resolver = new SecretStoreResolver();
    const plaintext = 'webhook-secret-value';
    const encrypted = encryptSecret(plaintext);
    expect(await resolver.resolve(encrypted)).toBe(plaintext);
  });

  it('returns null for empty string ref', async () => {
    const resolver = new SecretStoreResolver();
    expect(await resolver.resolve('')).toBeNull();
  });

  it('returns null for invalid / non-encrypted ref', async () => {
    const resolver = new SecretStoreResolver();
    expect(await resolver.resolve('not-an-encrypted-blob')).toBeNull();
  });
});

// ============================================================
// ROUTE HANDLER TESTS VIA MOCK REQ/RES
// ============================================================

/**
 * Invoke a route registered on the sources router by matching path + method,
 * returning the captured status and response body.
 */
async function invokeRoute(
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

  // Find the matching layer
  const layers = (router as unknown as { stack: Array<{ route?: { path: string; methods: Record<string, boolean>; stack: Array<{ handle: (req: Request, res: Response, next: () => void) => void }> } }> }).stack;

  for (const layer of layers) {
    if (!layer.route) continue;
    const route = layer.route;
    if (!route.methods[method]) continue;

    // Match path with optional :id param
    const routePath: string = route.path;
    const match = matchPath(routePath, path);
    if (!match) continue;

    const req = makeReq({
      body: opts.body,
      headers: opts.headers ?? {},
      params: { ...opts.params, ...match },
      query: opts.query ?? {},
    });

    const captured: { status: number | null; body: unknown } = { status: null, body: null };
    const res = {
      status(code: number) { captured.status = code; return res; },
      json(data: unknown) { captured.body = data; return res; },
    } as unknown as Response;

    // Call each middleware in the route stack
    const handlers = route.stack.map((s) => s.handle);
    await runHandlers(handlers, req, res);
    return captured;
  }

  return { status: 404, body: { error: 'route_not_found_in_test' } };
}

function matchPath(routePath: string, actualPath: string): Record<string, string> | null {
  // Simple matcher for /sources and /sources/:id
  const routeParts = routePath.split('/');
  const actualParts = actualPath.split('/');
  if (routeParts.length !== actualParts.length) return null;
  const params: Record<string, string> = {};
  for (let i = 0; i < routeParts.length; i++) {
    if (routeParts[i].startsWith(':')) {
      params[routeParts[i].slice(1)] = actualParts[i];
    } else if (routeParts[i] !== actualParts[i]) {
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
  const next = async () => {
    if (i < handlers.length) {
      const handler = handlers[i++];
      await handler(req, res, next as () => void);
    }
  };
  await next();
}

// ============================================================
// MOCK DB BUILDER
// ============================================================

function buildMockDb() {
  const db = {
    _selectResults: [] as unknown[],
    _insertResults: [] as unknown[],
    _updateResults: [] as unknown[],
    _insertedValues: null as unknown,
    _updatedValues: null as unknown,

    select: vi.fn(),
    insert: vi.fn(),
    update: vi.fn(),
  };

  // select().from().where().limit().offset() -> rows
  // select().from().where() -> rows  (for count queries)
  db.select.mockImplementation(() => ({
    from: vi.fn(() => ({
      where: vi.fn(() => ({
        limit: vi.fn(() => ({
          offset: vi.fn(() => Promise.resolve(db._selectResults)),
        })),
        // For count query (no limit/offset)
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
    set: vi.fn((vals: unknown) => {
      db._updatedValues = vals;
      return {
        where: vi.fn(() => ({
          returning: vi.fn(() => Promise.resolve(db._updateResults)),
        })),
      };
    }),
  }));

  return db;
}

// ============================================================
// T035: GET /sources
// ============================================================

describe('GET /sources', () => {
  it('returns 200 with data array', async () => {
    const db = buildMockDb();
    const source = makeSource();
    db._selectResults = [source];

    const result = await invokeRoute(db, 'get', '/sources', {
      headers: { 'x-tenant-id': 'tenant-abc' },
    });

    expect(result.status).toBe(200);
    expect((result.body as Record<string, unknown>)['data']).toBeDefined();
  });

  it('omits authConfig and includes hasSecret: true when secretRef present', async () => {
    const db = buildMockDb();
    db._selectResults = [makeSource()];

    const result = await invokeRoute(db, 'get', '/sources', {
      headers: { 'x-tenant-id': 'tenant-abc' },
    });

    const items = (result.body as Record<string, unknown>)['data'] as Record<string, unknown>[];
    expect(items[0]).not.toHaveProperty('authConfig');
    expect(items[0]['hasSecret']).toBe(true);
  });

  it('returns hasSecret: false for ip_allowlist sources without secretRef', async () => {
    const db = buildMockDb();
    db._selectResults = [
      makeSource({ authMethod: 'ip_allowlist', authConfig: { allowedIps: ['10.0.0.1'] } }),
    ];

    const result = await invokeRoute(db, 'get', '/sources', {
      headers: { 'x-tenant-id': 'tenant-abc' },
    });

    const items = (result.body as Record<string, unknown>)['data'] as Record<string, unknown>[];
    expect(items[0]['hasSecret']).toBe(false);
  });

  it('includes limit and offset in response', async () => {
    const db = buildMockDb();
    db._selectResults = [];

    const result = await invokeRoute(db, 'get', '/sources', {
      headers: { 'x-tenant-id': 'tenant-abc' },
      query: { limit: '10', offset: '20' },
    });

    expect(result.status).toBe(200);
    expect((result.body as Record<string, unknown>)['limit']).toBe(10);
    expect((result.body as Record<string, unknown>)['offset']).toBe(20);
  });
});

// ============================================================
// T036: POST /sources
// ============================================================

describe('POST /sources', () => {
  it('returns 400 for missing required fields', async () => {
    const db = buildMockDb();

    const result = await invokeRoute(db, 'post', '/sources', {
      headers: { 'x-tenant-id': 'tenant-abc' },
      body: { name: 'Incomplete' },
    });

    expect(result.status).toBe(400);
    expect((result.body as Record<string, unknown>)['error']).toBe('validation_error');
  });

  it('returns 201 on successful creation', async () => {
    const db = buildMockDb();
    db._insertResults = [makeSource()];

    const result = await invokeRoute(db, 'post', '/sources', {
      headers: { 'x-tenant-id': 'tenant-abc' },
      body: {
        name: 'Test Source',
        sourceType: 'generic_webhook',
        authMethod: 'hmac_sha256',
        authSecret: 'my-webhook-secret',
      },
    });

    expect(result.status).toBe(201);
    expect((result.body as Record<string, unknown>)['id']).toBeDefined();
    expect(result.body).not.toHaveProperty('authConfig' as never);
  });

  it('generates a slug in format <name>-<6hex>', async () => {
    const db = buildMockDb();
    db._insertResults = [makeSource()];

    await invokeRoute(db, 'post', '/sources', {
      headers: { 'x-tenant-id': 'tenant-abc' },
      body: {
        name: 'My Webhook',
        sourceType: 'generic_webhook',
        authMethod: 'ip_allowlist',
      },
    });

    const vals = db._insertedValues as Record<string, unknown>;
    expect(typeof vals['endpointSlug']).toBe('string');
    expect(vals['endpointSlug']).toMatch(/^[a-z0-9-]+-[a-f0-9]{6}$/);
  });

  it('encrypts authSecret into authConfig.secretRef for hmac_sha256', async () => {
    const db = buildMockDb();
    db._insertResults = [makeSource()];

    await invokeRoute(db, 'post', '/sources', {
      headers: { 'x-tenant-id': 'tenant-abc' },
      body: {
        name: 'GitHub Webhook',
        sourceType: 'github',
        authMethod: 'hmac_sha256',
        authSecret: 'super-secret',
      },
    });

    const vals = db._insertedValues as Record<string, unknown>;
    const authConfig = vals['authConfig'] as Record<string, unknown>;
    expect(typeof authConfig['secretRef']).toBe('string');
    expect(decryptSecret(authConfig['secretRef'] as string)).toBe('super-secret');
  });

  it('stores allowedIps for ip_allowlist without secretRef', async () => {
    const db = buildMockDb();
    db._insertResults = [makeSource({ authMethod: 'ip_allowlist', authConfig: { allowedIps: ['10.0.0.1'] } })];

    await invokeRoute(db, 'post', '/sources', {
      headers: { 'x-tenant-id': 'tenant-abc' },
      body: {
        name: 'IP Source',
        sourceType: 'generic_webhook',
        authMethod: 'ip_allowlist',
        authConfig: { allowedIps: ['10.0.0.1', '192.168.1.0/24'] },
      },
    });

    const vals = db._insertedValues as Record<string, unknown>;
    const authConfig = vals['authConfig'] as Record<string, unknown>;
    expect(authConfig['allowedIps']).toEqual(['10.0.0.1', '192.168.1.0/24']);
    expect(authConfig['secretRef']).toBeUndefined();
  });

  it('slugs are unique across two calls with same name', async () => {
    const db = buildMockDb();
    db._insertResults = [makeSource()];

    const slugs: string[] = [];

    for (let i = 0; i < 2; i++) {
      await invokeRoute(db, 'post', '/sources', {
        headers: { 'x-tenant-id': 'tenant-abc' },
        body: { name: 'Duplicate', sourceType: 'generic_webhook', authMethod: 'ip_allowlist' },
      });
      slugs.push((db._insertedValues as Record<string, unknown>)['endpointSlug'] as string);
    }

    expect(slugs[0]).not.toBe(slugs[1]);
  });
});

// ============================================================
// T037: PATCH /sources/:id
// ============================================================

describe('PATCH /sources/:id', () => {
  it('returns 422 when endpointSlug is in request body', async () => {
    const db = buildMockDb();

    const result = await invokeRoute(db, 'patch', '/sources/src-001', {
      headers: { 'x-tenant-id': 'tenant-abc' },
      body: { endpointSlug: 'new-slug' },
    });

    expect(result.status).toBe(422);
    expect((result.body as Record<string, unknown>)['error']).toBe('immutable_field');
    expect((result.body as Record<string, unknown>)['field']).toBe('endpointSlug');
  });

  it('returns 404 when source not found', async () => {
    const db = buildMockDb();
    db._selectResults = []; // no source found

    const result = await invokeRoute(db, 'patch', '/sources/nonexistent', {
      headers: { 'x-tenant-id': 'tenant-abc' },
      body: { name: 'New Name' },
    });

    expect(result.status).toBe(404);
  });

  it('returns 200 and updated source on valid name update', async () => {
    const db = buildMockDb();
    const existing = makeSource();
    const updated = makeSource({ name: 'Updated Name' });

    // First select returns existing; update returns updated
    db._selectResults = [existing];
    db._updateResults = [updated];

    const result = await invokeRoute(db, 'patch', '/sources/src-001', {
      headers: { 'x-tenant-id': 'tenant-abc' },
      body: { name: 'Updated Name' },
    });

    expect(result.status).toBe(200);
    expect((result.body as Record<string, unknown>)['name']).toBe('Updated Name');
    expect(result.body).not.toHaveProperty('authConfig' as never);
  });

  it('re-encrypts secret on authSecret update (secret rotation)', async () => {
    const db = buildMockDb();
    db._selectResults = [makeSource()];
    db._updateResults = [makeSource()];

    await invokeRoute(db, 'patch', '/sources/src-001', {
      headers: { 'x-tenant-id': 'tenant-abc' },
      body: { authSecret: 'rotated-secret' },
    });

    const updatedVals = db._updatedValues as Record<string, unknown>;
    const authConfig = updatedVals['authConfig'] as Record<string, unknown>;
    expect(typeof authConfig['secretRef']).toBe('string');
    expect(decryptSecret(authConfig['secretRef'] as string)).toBe('rotated-secret');
  });

  it('updates lifecycleState to paused', async () => {
    const db = buildMockDb();
    db._selectResults = [makeSource()];
    db._updateResults = [makeSource({ lifecycleState: 'paused' })];

    const result = await invokeRoute(db, 'patch', '/sources/src-001', {
      headers: { 'x-tenant-id': 'tenant-abc' },
      body: { lifecycleState: 'paused' },
    });

    expect(result.status).toBe(200);
    expect((result.body as Record<string, unknown>)['lifecycleState']).toBe('paused');
  });

  it('returns 400 for invalid lifecycleState', async () => {
    const db = buildMockDb();

    const result = await invokeRoute(db, 'patch', '/sources/src-001', {
      headers: { 'x-tenant-id': 'tenant-abc' },
      body: { lifecycleState: 'invalid-state' },
    });

    expect(result.status).toBe(400);
    expect((result.body as Record<string, unknown>)['error']).toBe('validation_error');
  });
});

// ============================================================
// T038: DELETE /sources/:id
// ============================================================

describe('DELETE /sources/:id', () => {
  it('returns 404 when source not found', async () => {
    const db = buildMockDb();
    db._selectResults = [];

    const result = await invokeRoute(db, 'delete', '/sources/nonexistent', {
      headers: { 'x-tenant-id': 'tenant-abc' },
    });

    expect(result.status).toBe(404);
  });

  it('returns 409 when source is already archived', async () => {
    const db = buildMockDb();
    db._selectResults = [makeSource({ lifecycleState: 'archived' })];

    const result = await invokeRoute(db, 'delete', '/sources/src-001', {
      headers: { 'x-tenant-id': 'tenant-abc' },
    });

    expect(result.status).toBe(409);
    expect((result.body as Record<string, unknown>)['error']).toBe('already_archived');
  });

  it('returns 200 and archived source when delete succeeds', async () => {
    const db = buildMockDb();
    const existing = makeSource();
    const archived = makeSource({ lifecycleState: 'archived' });

    // Two selects: first for the source, second for subscriptions count
    let selectCount = 0;
    db.select.mockImplementation(() => ({
      from: vi.fn(() => ({
        where: vi.fn(() => {
          selectCount++;
          if (selectCount === 1) {
            // Fetch source
            return Promise.resolve([existing]);
          }
          // Count active subscriptions — zero
          return Promise.resolve([{ count: 0 }]);
        }),
      })),
    }));

    db._updateResults = [archived];

    const result = await invokeRoute(db, 'delete', '/sources/src-001', {
      headers: { 'x-tenant-id': 'tenant-abc' },
    });

    expect(result.status).toBe(200);
    expect((result.body as Record<string, unknown>)['lifecycleState']).toBe('archived');
  });

  it('returns 409 when active subscriptions exist', async () => {
    const db = buildMockDb();
    const existing = makeSource();

    let selectCount = 0;
    db.select.mockImplementation(() => ({
      from: vi.fn(() => ({
        where: vi.fn(() => {
          selectCount++;
          if (selectCount === 1) return Promise.resolve([existing]);
          return Promise.resolve([{ count: 3 }]);
        }),
      })),
    }));

    const result = await invokeRoute(db, 'delete', '/sources/src-001', {
      headers: { 'x-tenant-id': 'tenant-abc' },
    });

    expect(result.status).toBe(409);
    expect((result.body as Record<string, unknown>)['error']).toBe('active_subscriptions');
    expect((result.body as Record<string, unknown>)['activeSubscriptions']).toBe(3);
  });
});

// ============================================================
// TENANT ISOLATION (T040)
// ============================================================

describe('tenant isolation', () => {
  it('POST with no tenant header sets isPlatformWide: true', async () => {
    const db = buildMockDb();
    db._insertResults = [makeSource({ tenantId: null, isPlatformWide: true })];

    await invokeRoute(db, 'post', '/sources', {
      // No x-tenant-id header
      body: {
        name: 'Platform Source',
        sourceType: 'generic_webhook',
        authMethod: 'ip_allowlist',
      },
    });

    const vals = db._insertedValues as Record<string, unknown>;
    expect(vals['isPlatformWide']).toBe(true);
    expect(vals['tenantId']).toBeUndefined();
  });

  it('POST with tenant header sets isPlatformWide: false and tenantId', async () => {
    const db = buildMockDb();
    db._insertResults = [makeSource()];

    await invokeRoute(db, 'post', '/sources', {
      headers: { 'x-tenant-id': 'tenant-xyz' },
      body: {
        name: 'Tenant Source',
        sourceType: 'generic_webhook',
        authMethod: 'ip_allowlist',
      },
    });

    const vals = db._insertedValues as Record<string, unknown>;
    expect(vals['isPlatformWide']).toBe(false);
    expect(vals['tenantId']).toBe('tenant-xyz');
  });
});
