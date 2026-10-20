/**
 * Tests for POST /auth/introspect (auth/introspect.ts)
 *
 * Pattern: the db client is mocked (same approach as routes.test.ts); the
 * router is mounted on a real express app with the same body parser and
 * session middleware order as index.ts, then called over HTTP. That is the
 * only way to cover body-parser failures, response headers and cookies.
 *
 * The module is re-imported for every test so the in-memory rate limiter
 * starts empty.
 */

import http from 'node:http';
import type { AddressInfo } from 'node:net';

import { PgDialect } from 'drizzle-orm/pg-core';
import express from 'express';
import session from 'express-session';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('../../src/db/client.js', async () => {
  // Real table definitions so the where() clauses can be rendered to SQL.
  const schema = await vi.importActual<typeof import('../../src/db/schema.js')>(
    '../../src/db/schema.js'
  );
  return {
    db: { select: vi.fn() },
    users: schema.users,
    tenantMemberships: schema.tenantMemberships,
  };
});

type IntrospectModule = typeof import('../../src/auth/introspect.js');
type DbModule = typeof import('../../src/db/client.js');

const SERVICE_TOKEN = 'service-token-0123456789abcdef0123456789abcdef';
const USER_TOKEN = 'user-bearer-token-do-not-leak';
const USER = { id: 'user-1', email: 'person@example.test' };

const dialect = new PgDialect();

let server: http.Server;
let baseUrl: string;
let db: DbModule['db'];
let introspect: IntrospectModule;
let unhandled: unknown[];
let logged: string[];

function selectReturning(rows: unknown[]) {
  const chain = {
    from: vi.fn().mockReturnThis(),
    where: vi.fn().mockReturnThis(),
    limit: vi.fn().mockResolvedValue(rows),
  };
  vi.mocked(db.select).mockReturnValueOnce(chain as never);
  return chain;
}

function selectRejecting(error: Error) {
  const chain = {
    from: vi.fn().mockReturnThis(),
    where: vi.fn().mockReturnThis(),
    limit: vi.fn().mockRejectedValue(error),
  };
  vi.mocked(db.select).mockReturnValueOnce(chain as never);
  return chain;
}

function renderWhere(chain: { where: ReturnType<typeof vi.fn> }) {
  return dialect.sqlToQuery(chain.where.mock.calls[0][0]);
}

interface CallOptions {
  serviceToken?: string | null;
  body?: unknown;
  rawBody?: string;
  contentType?: string;
}

async function call(options: CallOptions = {}) {
  const { serviceToken = SERVICE_TOKEN, body, rawBody, contentType = 'application/json' } = options;
  const headers: Record<string, string> = { 'Content-Type': contentType };
  if (serviceToken !== null) headers.Authorization = `Bearer ${serviceToken}`;

  const res = await fetch(`${baseUrl}/auth/introspect`, {
    method: 'POST',
    headers,
    body: rawBody ?? JSON.stringify(body ?? { token: USER_TOKEN }),
  });
  const text = await res.text();
  return {
    status: res.status,
    headers: res.headers,
    text,
    json: text ? (JSON.parse(text) as Record<string, unknown>) : null,
  };
}

beforeEach(async () => {
  vi.resetModules();
  process.env.INTROSPECTION_SERVICE_TOKEN = SERVICE_TOKEN;

  logged = [];
  unhandled = [];
  for (const level of ['log', 'warn', 'error', 'info'] as const) {
    vi.spyOn(console, level).mockImplementation((...args: unknown[]) => {
      logged.push(args.map(String).join(' '));
    });
  }

  introspect = await import('../../src/auth/introspect.js');
  db = (await import('../../src/db/client.js')).db;
  vi.mocked(db.select).mockReset();

  // Same order as index.ts: json parser, session, introspect, global error handler.
  const app = express();
  app.use(express.json());
  app.use(session({ secret: 'test-secret', resave: false, saveUninitialized: false }));
  app.use('/auth/introspect', introspect.introspectRouter, introspect.introspectBodyErrorHandler);
  app.use(
    (err: Error, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
      unhandled.push(err);
      res.status(500).json({ error: 'Internal server error' });
    }
  );

  server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterEach(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
  delete process.env.INTROSPECTION_SERVICE_TOKEN;
  vi.restoreAllMocks();
});

// ============================================================
// Valid and invalid user tokens
// ============================================================

describe('POST /auth/introspect: user token lookup', () => {
  it('returns the user and default tenant for a valid token', async () => {
    const userQuery = selectReturning([USER]);
    const membershipQuery = selectReturning([{ tenantId: 'tenant-a' }]);

    const res = await call();

    expect(res.status).toBe(200);
    expect(res.json).toEqual({
      active: true,
      userId: 'user-1',
      email: 'person@example.test',
      defaultTenantId: 'tenant-a',
    });

    // The user is looked up by the presented token, the membership by that
    // user's id and is_default = true, so no other user's data can be returned.
    const userSql = renderWhere(userQuery);
    expect(userSql.params).toEqual([USER_TOKEN]);
    const membershipSql = renderWhere(membershipQuery);
    expect(membershipSql.sql).toContain('"user_id"');
    expect(membershipSql.sql).toContain('"is_default"');
    expect(membershipSql.params).toEqual(['user-1', true]);
  });

  it('returns defaultTenantId null when the user has no default membership', async () => {
    selectReturning([USER]);
    selectReturning([]);

    const res = await call();

    expect(res.status).toBe(200);
    expect(res.json).toEqual({
      active: true,
      userId: 'user-1',
      email: 'person@example.test',
      defaultTenantId: null,
    });
  });

  it('returns active false for an unknown token and does not look up memberships', async () => {
    selectReturning([]);

    const res = await call();

    expect(res.status).toBe(200);
    expect(res.json).toEqual({ active: false });
    expect(db.select).toHaveBeenCalledTimes(1);
  });

  it('never contains the presented token in a response', async () => {
    selectReturning([USER]);
    selectReturning([{ tenantId: 'tenant-a' }]);
    const active = await call();

    selectReturning([]);
    const inactive = await call();

    expect(active.text).not.toContain(USER_TOKEN);
    expect(inactive.text).not.toContain(USER_TOKEN);
  });

  it('answers 500, not active false, when the lookup fails', async () => {
    selectRejecting(new Error(`Failed query: select ... params: ${USER_TOKEN}`));

    const res = await call();

    expect(res.status).toBe(500);
    expect(res.json).toEqual({ error: 'internal_error' });
    expect(res.text).not.toContain(USER_TOKEN);
  });
});

// ============================================================
// Service authentication
// ============================================================

describe('POST /auth/introspect: service authentication', () => {
  it.each([
    ['no Authorization header', null],
    ['an empty bearer value', ''],
    ['a wrong service token', 'wrong-service-token'],
    ['a wrong token of the same length', SERVICE_TOKEN.replace(/.$/, 'X')],
    ['the user token in place of the service token', USER_TOKEN],
  ])('answers 401 for %s without touching the database', async (_label, serviceToken) => {
    const res = await call({ serviceToken });

    expect(res.status).toBe(401);
    expect(res.json).toEqual({ error: 'unauthenticated' });
    expect(db.select).not.toHaveBeenCalled();
  });

  it('answers 401 for a non-Bearer scheme', async () => {
    const res = await fetch(`${baseUrl}/auth/introspect`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Basic ${SERVICE_TOKEN}` },
      body: JSON.stringify({ token: USER_TOKEN }),
    });

    expect(res.status).toBe(401);
    expect(db.select).not.toHaveBeenCalled();
  });
});

// ============================================================
// Disabled route
// ============================================================

describe('POST /auth/introspect: disabled when no service token is configured', () => {
  it.each([
    ['unset', undefined],
    ['empty', ''],
    ['whitespace only', '   '],
  ])('answers 404 when the env var is %s, even with a matching header', async (_label, value) => {
    if (value === undefined) delete process.env.INTROSPECTION_SERVICE_TOKEN;
    else process.env.INTROSPECTION_SERVICE_TOKEN = value;

    const noHeader = await call({ serviceToken: null });
    const emptyBearer = await call({ serviceToken: '' });
    const spaces = await call({ serviceToken: '   ' });

    for (const res of [noHeader, emptyBearer, spaces]) {
      expect(res.status).toBe(404);
      expect(res.json).toEqual({ error: 'not_found' });
    }
    expect(db.select).not.toHaveBeenCalled();
  });

  it('stays disabled and warns when the service token is shorter than 32 characters', async () => {
    const short = 'a'.repeat(31);
    process.env.INTROSPECTION_SERVICE_TOKEN = short;
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});

    const res = await call({ serviceToken: short });

    expect(res.status).toBe(404);
    expect(db.select).not.toHaveBeenCalled();
    expect(warn).toHaveBeenCalledTimes(1);
    expect(String(warn.mock.calls[0][0])).not.toContain(short);
    warn.mockRestore();
  });

  it('also answers 404 for a malformed body when disabled', async () => {
    delete process.env.INTROSPECTION_SERVICE_TOKEN;

    const res = await call({ rawBody: '{not json' });

    expect(res.status).toBe(404);
    expect(unhandled).toEqual([]);
  });
});

// ============================================================
// Body validation
// ============================================================

describe('POST /auth/introspect: body validation', () => {
  it.each([
    ['a missing token', { other: 1 }],
    ['an empty token', { token: '' }],
    ['a non-string token', { token: 12345 }],
    ['a null token', { token: null }],
    ['a token over 4096 characters', { token: 'a'.repeat(4097) }],
    ['an array body', ['x']],
  ])('answers 400 for %s', async (_label, body) => {
    const res = await call({ body });

    expect(res.status).toBe(400);
    expect(res.json).toEqual({ error: 'bad_request' });
    expect(db.select).not.toHaveBeenCalled();
  });

  it('accepts a token of exactly 4096 characters', async () => {
    selectReturning([]);

    const res = await call({ body: { token: 'a'.repeat(4096) } });

    expect(res.status).toBe(200);
    expect(res.json).toEqual({ active: false });
  });

  it('answers 400 when the content type is not JSON', async () => {
    const res = await call({ rawBody: `token=${USER_TOKEN}`, contentType: 'text/plain' });

    expect(res.status).toBe(400);
    expect(db.select).not.toHaveBeenCalled();
  });

  it('answers 400 for malformed JSON without reaching the app-wide error handler or logging the body', async () => {
    const res = await call({ rawBody: `{"token": "${USER_TOKEN}"` });

    expect(res.status).toBe(400);
    expect(res.json).toEqual({ error: 'bad_request' });
    expect(unhandled).toEqual([]);
    expect(logged.join('\n')).not.toContain(USER_TOKEN);
    expect(res.text).not.toContain(USER_TOKEN);
  });

  it('answers 401, not 400, for malformed JSON from an unauthenticated caller', async () => {
    const res = await call({ serviceToken: 'wrong', rawBody: '{not json' });

    expect(res.status).toBe(401);
    expect(unhandled).toEqual([]);
  });
});

// ============================================================
// Response hygiene, logging, session interplay
// ============================================================

describe('POST /auth/introspect: headers, cookies and logs', () => {
  it('sends Cache-Control: no-store on every outcome', async () => {
    selectReturning([USER]);
    selectReturning([]);
    const active = await call();
    const unauthenticated = await call({ serviceToken: null });
    const badBody = await call({ body: {} });
    const malformed = await call({ rawBody: '{nope' });
    delete process.env.INTROSPECTION_SERVICE_TOKEN;
    const disabled = await call();

    for (const res of [active, unauthenticated, badBody, malformed, disabled]) {
      expect(res.headers.get('cache-control')).toBe('no-store');
    }
  });

  it('does not create a session or set a cookie', async () => {
    selectReturning([USER]);
    selectReturning([]);

    const res = await call();

    expect(res.status).toBe(200);
    expect(res.headers.get('set-cookie')).toBeNull();
  });

  it('logs outcome and user id only, never the user token or the service token', async () => {
    selectReturning([USER]);
    selectReturning([]);
    await call();
    selectReturning([]);
    await call();
    await call({ serviceToken: 'wrong-service-token' });
    await call({ body: {} });
    selectRejecting(new Error(`Failed query: params: ${USER_TOKEN}`));
    await call();

    const output = logged.join('\n');
    expect(output).toContain('outcome=active userId=user-1');
    expect(output).toContain('outcome=inactive');
    expect(output).toContain('outcome=unauthenticated');
    expect(output).toContain('outcome=bad_request');
    expect(output).toContain('outcome=error');
    expect(output).not.toContain(USER_TOKEN);
    expect(output).not.toContain(SERVICE_TOKEN);
    expect(output).not.toContain('wrong-service-token');
  });
});

// ============================================================
// Rate limiting
// ============================================================

describe('POST /auth/introspect: rate limiting', () => {
  it('answers 429 after the per-minute limit and reports limit headers', async () => {
    const limit = introspect.INTROSPECT_RATE_LIMIT_PER_MINUTE;
    vi.mocked(db.select).mockImplementation(() => {
      const chain = {
        from: vi.fn().mockReturnThis(),
        where: vi.fn().mockReturnThis(),
        limit: vi.fn().mockResolvedValue([]),
      };
      return chain as never;
    });

    const statuses: number[] = [];
    for (let batch = 0; batch < limit; batch += 100) {
      const results = await Promise.all(
        Array.from({ length: Math.min(100, limit - batch) }, () => call())
      );
      statuses.push(...results.map((r) => r.status));
    }
    expect(statuses.every((s) => s === 200)).toBe(true);

    const limited = await call();
    expect(limited.status).toBe(429);
    expect(limited.json).toEqual({ error: 'rate_limited' });
    expect(limited.headers.get('cache-control')).toBe('no-store');
    expect(logged.join('\n')).toContain('outcome=rate_limited');
  }, 30000);

  it('does not count unauthenticated requests against the service budget', async () => {
    for (let i = 0; i < 20; i++) {
      await call({ serviceToken: 'wrong' });
    }
    selectReturning([]);

    const res = await call();

    expect(res.status).toBe(200);
    expect(res.headers.get('ratelimit')).toContain(`remaining=${introspect.INTROSPECT_RATE_LIMIT_PER_MINUTE - 1}`);
  });
});
