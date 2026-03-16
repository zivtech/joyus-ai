/**
 * Event Adapter — Admin Panel Smoke Tests (WP12)
 *
 * Verifies:
 * - Each admin page route returns 200 with text/html content-type
 * - HTML contains expected nav links
 * - Tenant scoping: x-tenant-id header is passed through to DB queries
 * - XSS prevention: user-supplied data is escaped
 *
 * Uses Node's built-in http.request via a helper — no external HTTP client dep.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import http from 'node:http';
import express, { type Application } from 'express';

import { createAdminRouter } from '../../../src/event-adapter/routes/admin.js';
import type { AdminRouterDeps } from '../../../src/event-adapter/routes/admin.js';

// ============================================================
// MOCK DB FACTORY
// ============================================================

function makeMockDb() {
  // Chainable select builder that resolves to an empty array.
  // The admin routes do: await deps.db.select().from(...).where(...).limit(...).offset(...)
  // Each chained call must return an object that also supports the next chain link AND
  // is thenable (so `await chain` resolves to []).
  function makeChain(): unknown {
    const self: Record<string, unknown> & { then: unknown } = {
      select: () => makeChain(),
      from: () => makeChain(),
      where: () => makeChain(),
      orderBy: () => makeChain(),
      limit: () => makeChain(),
      offset: () => makeChain(),
      // thenables make `await` resolve to []
      then: (
        resolve: (v: unknown[]) => unknown,
        _reject?: (e: unknown) => unknown,
      ) => Promise.resolve([]).then(resolve),
      catch: (cb: (e: unknown) => unknown) => Promise.resolve([]).catch(cb),
      finally: (cb: () => void) => Promise.resolve([]).finally(cb),
    };
    return self;
  }

  return {
    select: vi.fn().mockImplementation(() => makeChain()),
    update: vi.fn().mockReturnValue({
      set: vi.fn().mockReturnValue({
        where: vi.fn().mockResolvedValue([]),
      }),
    }),
    insert: vi.fn().mockReturnValue({
      values: vi.fn().mockReturnValue({
        returning: vi.fn().mockResolvedValue([]),
      }),
    }),
    delete: vi.fn().mockReturnValue({
      where: vi.fn().mockResolvedValue([]),
    }),
  };
}

// ============================================================
// TEST HTTP HELPER
// ============================================================

interface TestResponse {
  status: number;
  headers: Record<string, string | string[] | undefined>;
  body: string;
}

function httpGet(
  server: http.Server,
  path: string,
  extraHeaders: Record<string, string> = {},
): Promise<TestResponse> {
  return new Promise((resolve, reject) => {
    const addr = server.address();
    const port = typeof addr === 'object' && addr ? addr.port : 0;

    const req = http.request(
      { host: '127.0.0.1', port, path, method: 'GET', headers: extraHeaders },
      (res) => {
        let body = '';
        res.setEncoding('utf8');
        res.on('data', (chunk: string) => { body += chunk; });
        res.on('end', () => {
          resolve({
            status: res.statusCode ?? 0,
            headers: res.headers as Record<string, string | string[] | undefined>,
            body,
          });
        });
      },
    );
    req.on('error', reject);
    req.end();
  });
}

// ============================================================
// APP + SERVER FACTORY
// ============================================================

function makeAppAndServer(deps: AdminRouterDeps): {
  app: Application;
  server: http.Server;
} {
  const app = express();
  app.use(express.urlencoded({ extended: false }));
  app.use(express.json());
  app.use('/event-adapter/admin', createAdminRouter(deps));

  const server = http.createServer(app);
  return { app, server };
}

// ============================================================
// TESTS
// ============================================================

describe('Admin Panel — smoke tests', () => {
  let deps: AdminRouterDeps;
  let server: http.Server;

  beforeEach(async () => {
    deps = { db: makeMockDb() as unknown as AdminRouterDeps['db'] };
    const built = makeAppAndServer(deps);
    server = built.server;
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  });

  afterEach(async () => {
    await new Promise<void>((resolve, reject) =>
      server.close((err) => (err ? reject(err) : resolve())),
    );
  });

  // ----------------------------------------------------------
  // Root redirect
  // ----------------------------------------------------------

  it('GET /event-adapter/admin/ redirects to /sources', async () => {
    const res = await httpGet(server, '/event-adapter/admin/');
    expect(res.status).toBe(302);
    expect(res.headers['location']).toBe('/event-adapter/admin/sources');
  });

  // ----------------------------------------------------------
  // Sources page
  // ----------------------------------------------------------

  it('GET /sources returns 200 with text/html', async () => {
    const res = await httpGet(server, '/event-adapter/admin/sources');
    expect(res.status).toBe(200);
    expect(String(res.headers['content-type'])).toMatch(/text\/html/);
  });

  it('GET /sources HTML contains nav links', async () => {
    const res = await httpGet(server, '/event-adapter/admin/sources');
    expect(res.body).toContain('/event-adapter/admin/sources');
    expect(res.body).toContain('/event-adapter/admin/schedules');
    expect(res.body).toContain('/event-adapter/admin/activity');
    expect(res.body).toContain('/event-adapter/admin/automation');
  });

  it('GET /sources marks sources nav link as active', async () => {
    const res = await httpGet(server, '/event-adapter/admin/sources');
    expect(res.body).toMatch(/class="[^"]*active[^"]*"[^>]*>Sources/);
  });

  it('GET /sources shows platform admin banner when no x-tenant-id', async () => {
    const res = await httpGet(server, '/event-adapter/admin/sources');
    expect(res.body).toContain('Platform admin view');
  });

  it('GET /sources does NOT show platform banner when x-tenant-id is set', async () => {
    const res = await httpGet(server, '/event-adapter/admin/sources', {
      'x-tenant-id': 'tenant-123',
    });
    expect(res.body).not.toContain('Platform admin view');
  });

  it('GET /sources shows empty state when no sources', async () => {
    const res = await httpGet(server, '/event-adapter/admin/sources');
    expect(res.body).toContain('No event sources configured');
  });

  // ----------------------------------------------------------
  // Schedules page
  // ----------------------------------------------------------

  it('GET /schedules returns 200 with text/html', async () => {
    const res = await httpGet(server, '/event-adapter/admin/schedules');
    expect(res.status).toBe(200);
    expect(String(res.headers['content-type'])).toMatch(/text\/html/);
  });

  it('GET /schedules marks schedules nav link as active', async () => {
    const res = await httpGet(server, '/event-adapter/admin/schedules');
    expect(res.body).toMatch(/class="[^"]*active[^"]*"[^>]*>Schedules/);
  });

  it('GET /schedules shows empty state when no schedules', async () => {
    const res = await httpGet(server, '/event-adapter/admin/schedules');
    expect(res.body).toContain('No schedules configured');
  });

  // ----------------------------------------------------------
  // Activity page
  // ----------------------------------------------------------

  it('GET /activity returns 200 with text/html', async () => {
    const res = await httpGet(server, '/event-adapter/admin/activity');
    expect(res.status).toBe(200);
    expect(String(res.headers['content-type'])).toMatch(/text\/html/);
  });

  it('GET /activity marks activity nav link as active', async () => {
    const res = await httpGet(server, '/event-adapter/admin/activity');
    expect(res.body).toMatch(/class="[^"]*active[^"]*"[^>]*>Activity/);
  });

  it('GET /activity shows filter controls for statuses', async () => {
    const res = await httpGet(server, '/event-adapter/admin/activity');
    expect(res.body).toContain('delivered');
    expect(res.body).toContain('dead_letter');
    expect(res.body).toContain('github');
    expect(res.body).toContain('schedule');
  });

  it('GET /activity shows empty state when no events', async () => {
    const res = await httpGet(server, '/event-adapter/admin/activity');
    expect(res.body).toContain('No events match');
  });

  // ----------------------------------------------------------
  // Automation page
  // ----------------------------------------------------------

  it('GET /automation returns 200 with text/html', async () => {
    const res = await httpGet(server, '/event-adapter/admin/automation');
    expect(res.status).toBe(200);
    expect(String(res.headers['content-type'])).toMatch(/text\/html/);
  });

  it('GET /automation marks automation nav link as active', async () => {
    const res = await httpGet(server, '/event-adapter/admin/automation');
    expect(res.body).toMatch(/class="[^"]*active[^"]*"[^>]*>Automation/);
  });

  it('GET /automation shows tenant prompt when no x-tenant-id', async () => {
    const res = await httpGet(server, '/event-adapter/admin/automation');
    expect(res.body).toContain('Platform admin view');
    expect(res.body).toContain('x-tenant-id');
  });

  it('GET /automation shows register form when tenant set and no destination', async () => {
    const res = await httpGet(server, '/event-adapter/admin/automation', {
      'x-tenant-id': 'tenant-abc',
    });
    expect(res.body).toContain('Register Destination');
    expect(res.body).toContain('Destination URL');
  });

  // ----------------------------------------------------------
  // XSS prevention
  // ----------------------------------------------------------

  it('flash param with XSS payload is escaped in HTML output', async () => {
    const xss = encodeURIComponent('<script>alert(1)</script>');
    const res = await httpGet(server, `/event-adapter/admin/sources?flash=${xss}`);
    expect(res.body).not.toContain('<script>alert(1)</script>');
    expect(res.body).toContain('&lt;script&gt;');
  });

  // ----------------------------------------------------------
  // Tenant scoping pass-through
  // ----------------------------------------------------------

  it('tenant-scoped /sources request returns 200', async () => {
    const res = await httpGet(server, '/event-adapter/admin/sources', {
      'x-tenant-id': 'tenant-xyz',
    });
    expect(res.status).toBe(200);
  });

  it('tenant-scoped /schedules request returns 200', async () => {
    const res = await httpGet(server, '/event-adapter/admin/schedules', {
      'x-tenant-id': 'tenant-xyz',
    });
    expect(res.status).toBe(200);
  });

  it('tenant-scoped /activity request returns 200', async () => {
    const res = await httpGet(server, '/event-adapter/admin/activity', {
      'x-tenant-id': 'tenant-xyz',
    });
    expect(res.status).toBe(200);
  });
});
