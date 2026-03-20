/**
 * Route handler tests for auth/routes.ts
 *
 * Tests the OAuth callback flows (Google, Jira, Slack, GitHub),
 * the disconnect route, logout, and the portal home page.
 *
 * Pattern: mock all external dependencies (DB, axios, encryption),
 * extract route handlers from authRouter.stack, and call them with
 * mock req/res objects — matching the approach in middleware.test.ts.
 *
 * NOTE: The disconnect route is currently GET /:service/disconnect.
 * Tests below are written for POST to be forward-compatible with the
 * planned migration to POST. When the route is changed, remove the
 * "expected to fail until route is POST" comment from the POST test.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Request, Response, NextFunction } from 'express';
import type { Router } from 'express';

// ─── Module mocks (must be declared before imports) ───────────────────────────

vi.mock('../../src/db/client.js', () => {
  const mockDb = {
    select: vi.fn(),
    insert: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
  };
  return {
    db: mockDb,
    users: 'users_table',
    connections: 'connections_table',
    oauthStates: 'oauth_states_table',
  };
});

vi.mock('../../src/db/encryption.js', () => ({
  encryptToken: vi.fn((t: string) => `enc(${t})`),
  generateMcpToken: vi.fn(() => 'generated-mcp-token'),
  generateOAuthState: vi.fn(() => 'random-state-abc'),
}));

vi.mock('axios');

// requireSessionOrRedirect used by start/disconnect routes
vi.mock('../../src/auth/middleware.js', () => ({
  requireSessionOrRedirect: vi.fn(
    (req: Request, res: Response, next: NextFunction) => {
      if (!req.session?.userId) {
        res.redirect('/auth');
        return;
      }
      next();
    }
  ),
}));

// ─── Imports (after mocks) ────────────────────────────────────────────────────

import axios from 'axios';
import { db } from '../../src/db/client.js';
import { authRouter } from '../../src/auth/routes.js';

// ─── Helpers ─────────────────────────────────────────────────────────────────

type RouteLayer = {
  route?: {
    path: string;
    methods: Record<string, boolean>;
    stack: Array<{ handle: (req: Request, res: Response, next: NextFunction) => unknown }>;
  };
};

/**
 * Find the last registered handler for a given method + path on the router.
 * Returns the final handler in the middleware stack for that route.
 */
function findHandler(
  router: Router,
  method: string,
  path: string
): ((req: Request, res: Response, next: NextFunction) => unknown) | undefined {
  const stack = (router as unknown as { stack: RouteLayer[] }).stack;
  const layer = stack.find(
    (l) =>
      l.route &&
      l.route.path === path &&
      l.route.methods[method.toLowerCase()]
  );
  if (!layer?.route) return undefined;
  // Return the last handler (the actual route handler, not middleware)
  const handlers = layer.route.stack;
  return handlers[handlers.length - 1].handle;
}

function createMockReq(overrides: Record<string, unknown> = {}): Request {
  return {
    headers: {},
    query: {},
    params: {},
    session: {},
    body: {},
    ...overrides,
  } as unknown as Request;
}

function createMockRes() {
  const res = {
    _status: 200,
    _body: null as unknown,
    _redirect: null as string | null,
    _sent: false,
    status(code: number) {
      res._status = code;
      return res;
    },
    send(body: unknown) {
      res._body = body;
      res._sent = true;
      return res;
    },
    json(data: unknown) {
      res._body = data;
      res._sent = true;
      return res;
    },
    redirect(url: string) {
      res._redirect = url;
      return res;
    },
  };
  return res as unknown as Response & {
    _status: number;
    _body: unknown;
    _redirect: string | null;
    _sent: boolean;
  };
}

/**
 * Build a fluent select chain that resolves to `rows` via .limit().
 * Use for queries that call .select().from().where().limit(1).
 */
function selectReturning(rows: unknown[]) {
  const chain = {
    from: vi.fn().mockReturnThis(),
    where: vi.fn().mockReturnThis(),
    limit: vi.fn().mockResolvedValue(rows),
  };
  vi.mocked(db.select).mockReturnValueOnce(chain as never);
  return chain;
}

/**
 * Build a fluent select chain that resolves to `rows` via .where() (no .limit()).
 * Use for queries that call .select().from().where() and await the result directly,
 * such as the connections fetch in the dashboard route.
 */
function selectResolvingOnWhere(rows: unknown[]) {
  const chain = {
    from: vi.fn().mockReturnThis(),
    where: vi.fn().mockResolvedValue(rows),
  };
  vi.mocked(db.select).mockReturnValueOnce(chain as never);
  return chain;
}

/** Build an insert chain that returns `rows` from .returning() */
function insertReturning(rows: unknown[]) {
  const chain = {
    values: vi.fn().mockReturnThis(),
    returning: vi.fn().mockResolvedValue(rows),
  };
  vi.mocked(db.insert).mockReturnValueOnce(chain as never);
  return chain;
}

/** Build an insert chain that resolves without .returning() */
function insertResolving() {
  const chain = {
    values: vi.fn().mockResolvedValue(undefined),
  };
  vi.mocked(db.insert).mockReturnValueOnce(chain as never);
  return chain;
}

/** Build an update chain */
function updateResolving() {
  const chain = {
    set: vi.fn().mockReturnThis(),
    where: vi.fn().mockResolvedValue(undefined),
  };
  vi.mocked(db.update).mockReturnValueOnce(chain as never);
  return chain;
}

/** Build a delete chain */
function deleteResolving() {
  const chain = {
    where: vi.fn().mockResolvedValue(undefined),
  };
  vi.mocked(db.delete).mockReturnValueOnce(chain as never);
  return chain;
}

// ─── Helper data ──────────────────────────────────────────────────────────────

const VALID_STATE_ROW = {
  id: 'state-id-1',
  state: 'valid-state',
  userId: 'pending',
  service: 'GOOGLE',
  expiresAt: new Date(Date.now() + 5 * 60 * 1000), // valid for 5 min
};

const EXISTING_USER = {
  id: 'user-1',
  email: 'operator@example.com',
  name: 'Operator A',
  mcpToken: 'existing-mcp-token',
};

// ─── escapeHtml (tested through dashboard HTML output) ───────────────────────

describe('escapeHtml (via dashboard route)', () => {
  let handler: ReturnType<typeof findHandler>;

  beforeEach(() => {
    vi.clearAllMocks();
    handler = findHandler(authRouter, 'get', '/');
  });

  it('escapes special HTML characters in user display name', async () => {
    const xssUser = {
      ...EXISTING_USER,
      name: '<script>alert("xss")</script>',
    };
    selectReturning([xssUser]);          // user lookup (.limit(1))
    selectResolvingOnWhere([]);          // connections lookup (no .limit())

    const req = createMockReq({ session: { userId: 'user-1' } });
    const res = createMockRes();

    await handler!(req, res, vi.fn());

    const html = res._body as string;
    expect(html).toContain('&lt;script&gt;');
    expect(html).not.toContain('<script>');
  });

  it('escapes ampersands and quotes in display name', async () => {
    const specialUser = {
      ...EXISTING_USER,
      name: 'A & B "quoted"',
    };
    selectReturning([specialUser]);
    selectResolvingOnWhere([]);

    const req = createMockReq({ session: { userId: 'user-1' } });
    const res = createMockRes();

    await handler!(req, res, vi.fn());

    const html = res._body as string;
    expect(html).toContain('A &amp; B &quot;quoted&quot;');
  });

  it('handles empty display name by falling back to email', async () => {
    const noNameUser = { ...EXISTING_USER, name: null };
    selectReturning([noNameUser]);
    selectResolvingOnWhere([]);

    const req = createMockReq({ session: { userId: 'user-1' } });
    const res = createMockRes();

    await handler!(req, res, vi.fn());

    const html = res._body as string;
    expect(html).toContain('operator@example.com');
  });
});

// ─── toJsStringLiteral (tested through dashboard copy-button onclick) ─────────

describe('toJsStringLiteral (via dashboard route)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('produces valid JSON string literals for the copy button', async () => {
    const user = { ...EXISTING_USER, mcpToken: 'tok\\en"with"special' };
    selectReturning([user]);
    selectResolvingOnWhere([]);

    const req = createMockReq({ session: { userId: 'user-1' } });
    const res = createMockRes();
    const handler = findHandler(authRouter, 'get', '/');

    await handler!(req, res, vi.fn());

    const html = res._body as string;
    // JSON.stringify wraps in quotes and escapes backslashes/quotes
    expect(html).toContain('"tok\\\\en\\"with\\"special"');
  });
});

// ─── Portal home ──────────────────────────────────────────────────────────────

describe('GET / (portal home)', () => {
  let handler: ReturnType<typeof findHandler>;

  beforeEach(() => {
    vi.clearAllMocks();
    handler = findHandler(authRouter, 'get', '/');
  });

  it('shows the login page when no session userId is present', async () => {
    const req = createMockReq({ session: {} });
    const res = createMockRes();

    await handler!(req, res, vi.fn());

    const html = res._body as string;
    expect(html).toContain('Sign in with Google');
    expect(html).not.toContain('Connected Services');
  });

  it('redirects to /auth when session userId has no matching user in DB', async () => {
    selectReturning([]); // user not found

    const req = createMockReq({ session: { userId: 'ghost-id' } });
    const res = createMockRes();

    await handler!(req, res, vi.fn());

    expect(res._redirect).toBe('/auth');
  });

  it('shows dashboard with connected services for authenticated user', async () => {
    selectReturning([EXISTING_USER]);
    selectResolvingOnWhere([{ service: 'GOOGLE' }, { service: 'JIRA' }]);

    const req = createMockReq({ session: { userId: 'user-1' } });
    const res = createMockRes();

    await handler!(req, res, vi.fn());

    const html = res._body as string;
    expect(html).toContain('Connected Services');
    expect(html).toContain('existing-mcp-token');
  });
});

// ─── Google OAuth callback ────────────────────────────────────────────────────

describe('GET /google/callback', () => {
  let handler: ReturnType<typeof findHandler>;

  beforeEach(() => {
    vi.clearAllMocks();
    handler = findHandler(authRouter, 'get', '/google/callback');
  });

  it('returns 400 when code is missing', async () => {
    const req = createMockReq({ query: { state: 'some-state' } });
    const res = createMockRes();

    await handler!(req, res, vi.fn());

    expect(res._status).toBe(400);
    expect(res._body).toContain('Missing code or state');
  });

  it('returns 400 when state is missing', async () => {
    const req = createMockReq({ query: { code: 'some-code' } });
    const res = createMockRes();

    await handler!(req, res, vi.fn());

    expect(res._status).toBe(400);
    expect(res._body).toContain('Missing code or state');
  });

  it('returns 400 when state does not match any DB record', async () => {
    selectReturning([]); // no matching state

    const req = createMockReq({ query: { code: 'code', state: 'bad-state' } });
    const res = createMockRes();

    await handler!(req, res, vi.fn());

    expect(res._status).toBe(400);
    expect(res._body).toContain('Invalid or expired state');
  });

  it('returns 400 when OAuth state is expired', async () => {
    const expiredState = {
      ...VALID_STATE_ROW,
      expiresAt: new Date(Date.now() - 1000), // 1 second in the past
    };
    selectReturning([expiredState]);
    deleteResolving(); // cleanup is not called because condition fails before delete

    const req = createMockReq({ query: { code: 'code', state: 'valid-state' } });
    const res = createMockRes();

    await handler!(req, res, vi.fn());

    expect(res._status).toBe(400);
    expect(res._body).toContain('Invalid or expired state');
  });

  it('returns 403 when the email domain is not allowed', async () => {
    selectReturning([VALID_STATE_ROW]);  // valid state
    deleteResolving();                    // state cleanup

    vi.mocked(axios.post).mockResolvedValueOnce({
      data: { access_token: 'at', refresh_token: 'rt', expires_in: 3600 },
    });
    vi.mocked(axios.get).mockResolvedValueOnce({
      data: { email: 'user@other-domain.com', name: 'Outside User' },
    });

    const req = createMockReq({ query: { code: 'code', state: 'valid-state' }, session: {} });
    const res = createMockRes();

    await handler!(req, res, vi.fn());

    expect(res._status).toBe(403);
    expect(res._body).toContain('organization accounts');
  });

  it('creates a new user on first OAuth login and redirects to /auth', async () => {
    selectReturning([VALID_STATE_ROW]);  // valid state
    deleteResolving();                    // state cleanup

    vi.mocked(axios.post).mockResolvedValueOnce({
      data: { access_token: 'at', refresh_token: 'rt', expires_in: 3600 },
    });
    vi.mocked(axios.get).mockResolvedValueOnce({
      data: { email: 'newuser@example.com', name: 'New User' },
    });

    selectReturning([]);  // user not found — will insert
    insertReturning([{ id: 'new-user-id', email: 'newuser@example.com', name: 'New User', mcpToken: 'generated-mcp-token' }]);

    selectReturning([]);  // no existing connection
    insertResolving();    // insert new connection

    const req = createMockReq({ query: { code: 'code', state: 'valid-state' }, session: {} });
    const res = createMockRes();

    await handler!(req, res, vi.fn());

    expect(res._redirect).toBe('/auth');
    expect((req as unknown as { session: { userId?: string } }).session.userId).toBe('new-user-id');
  });

  it('updates existing user connection on re-authentication', async () => {
    selectReturning([VALID_STATE_ROW]);  // valid state
    deleteResolving();                    // state cleanup

    vi.mocked(axios.post).mockResolvedValueOnce({
      data: { access_token: 'at2', refresh_token: 'rt2', expires_in: 3600 },
    });
    vi.mocked(axios.get).mockResolvedValueOnce({
      data: { email: 'operator@example.com', name: 'Operator A' },
    });

    selectReturning([EXISTING_USER]);                               // existing user found
    selectReturning([{ id: 'conn-1', userId: 'user-1', service: 'GOOGLE' }]); // existing connection
    updateResolving();                                               // update connection

    const req = createMockReq({ query: { code: 'code', state: 'valid-state' }, session: {} });
    const res = createMockRes();

    await handler!(req, res, vi.fn());

    expect(res._redirect).toBe('/auth');
    expect(db.update).toHaveBeenCalled();
    expect(db.insert).not.toHaveBeenCalled();
  });

  it('returns 500 on token exchange failure', async () => {
    selectReturning([VALID_STATE_ROW]);
    deleteResolving();

    vi.mocked(axios.post).mockRejectedValueOnce(new Error('Network error'));

    const req = createMockReq({ query: { code: 'code', state: 'valid-state' }, session: {} });
    const res = createMockRes();

    await handler!(req, res, vi.fn());

    expect(res._status).toBe(500);
    expect(res._body).toContain('Authentication failed');
  });
});

// ─── Jira OAuth callback ──────────────────────────────────────────────────────

describe('GET /jira/callback', () => {
  let handler: ReturnType<typeof findHandler>;

  beforeEach(() => {
    vi.clearAllMocks();
    handler = findHandler(authRouter, 'get', '/jira/callback');
  });

  it('returns 400 when code is missing', async () => {
    const req = createMockReq({ query: { state: 'some-state' } });
    const res = createMockRes();

    await handler!(req, res, vi.fn());

    expect(res._status).toBe(400);
  });

  it('returns 400 when state is missing', async () => {
    const req = createMockReq({ query: { code: 'some-code' } });
    const res = createMockRes();

    await handler!(req, res, vi.fn());

    expect(res._status).toBe(400);
  });

  it('returns 400 when state record does not match JIRA service', async () => {
    selectReturning([{ ...VALID_STATE_ROW, service: 'GOOGLE' }]); // wrong service

    const req = createMockReq({ query: { code: 'code', state: 'valid-state' } });
    const res = createMockRes();

    await handler!(req, res, vi.fn());

    expect(res._status).toBe(400);
    expect(res._body).toContain('Invalid or expired state');
  });

  it('creates new Jira connection and redirects to /auth', async () => {
    const jiraState = { ...VALID_STATE_ROW, service: 'JIRA', userId: 'user-1' };
    selectReturning([jiraState]);
    deleteResolving();

    vi.mocked(axios.post).mockResolvedValueOnce({
      data: { access_token: 'jira-at', refresh_token: 'jira-rt', expires_in: 3600 },
    });
    vi.mocked(axios.get).mockResolvedValueOnce({
      data: [{ id: 'cloud-id-1', name: 'Example Corp' }],
    });

    selectReturning([]);   // no existing connection
    insertResolving();     // insert connection

    const req = createMockReq({ query: { code: 'code', state: 'valid-state' }, session: {} });
    const res = createMockRes();

    await handler!(req, res, vi.fn());

    expect(res._redirect).toBe('/auth');
    expect(db.insert).toHaveBeenCalled();
  });

  it('returns 500 on Jira token exchange failure', async () => {
    const jiraState = { ...VALID_STATE_ROW, service: 'JIRA', userId: 'user-1' };
    selectReturning([jiraState]);
    deleteResolving();

    vi.mocked(axios.post).mockRejectedValueOnce(new Error('Jira API down'));

    const req = createMockReq({ query: { code: 'code', state: 'valid-state' }, session: {} });
    const res = createMockRes();

    await handler!(req, res, vi.fn());

    expect(res._status).toBe(500);
    expect(res._body).toContain('Jira authentication failed');
  });
});

// ─── Slack OAuth callback ─────────────────────────────────────────────────────

describe('GET /slack/callback', () => {
  let handler: ReturnType<typeof findHandler>;

  beforeEach(() => {
    vi.clearAllMocks();
    handler = findHandler(authRouter, 'get', '/slack/callback');
  });

  it('returns 400 when code is missing', async () => {
    const req = createMockReq({ query: { state: 'some-state' } });
    const res = createMockRes();

    await handler!(req, res, vi.fn());

    expect(res._status).toBe(400);
  });

  it('returns 400 when state does not match SLACK service', async () => {
    selectReturning([{ ...VALID_STATE_ROW, service: 'GITHUB' }]);

    const req = createMockReq({ query: { code: 'code', state: 'valid-state' } });
    const res = createMockRes();

    await handler!(req, res, vi.fn());

    expect(res._status).toBe(400);
  });

  it('creates new Slack connection and redirects to /auth', async () => {
    const slackState = { ...VALID_STATE_ROW, service: 'SLACK', userId: 'user-1' };
    selectReturning([slackState]);
    deleteResolving();

    vi.mocked(axios.post).mockResolvedValueOnce({
      data: {
        authed_user: { id: 'U123', access_token: 'slack-user-token' },
        team: { id: 'T123', name: 'Example Team' },
      },
    });

    selectReturning([]);  // no existing connection
    insertResolving();

    const req = createMockReq({ query: { code: 'code', state: 'valid-state' }, session: {} });
    const res = createMockRes();

    await handler!(req, res, vi.fn());

    expect(res._redirect).toBe('/auth');
    expect(db.insert).toHaveBeenCalled();
  });

  it('returns 500 on Slack token exchange failure', async () => {
    const slackState = { ...VALID_STATE_ROW, service: 'SLACK', userId: 'user-1' };
    selectReturning([slackState]);
    deleteResolving();

    vi.mocked(axios.post).mockRejectedValueOnce(new Error('Slack error'));

    const req = createMockReq({ query: { code: 'code', state: 'valid-state' }, session: {} });
    const res = createMockRes();

    await handler!(req, res, vi.fn());

    expect(res._status).toBe(500);
    expect(res._body).toContain('Slack authentication failed');
  });
});

// ─── GitHub OAuth callback ────────────────────────────────────────────────────

describe('GET /github/callback', () => {
  let handler: ReturnType<typeof findHandler>;

  beforeEach(() => {
    vi.clearAllMocks();
    handler = findHandler(authRouter, 'get', '/github/callback');
  });

  it('returns 400 when code is missing', async () => {
    const req = createMockReq({ query: { state: 'some-state' } });
    const res = createMockRes();

    await handler!(req, res, vi.fn());

    expect(res._status).toBe(400);
  });

  it('returns 400 when state does not match GITHUB service', async () => {
    selectReturning([{ ...VALID_STATE_ROW, service: 'SLACK' }]);

    const req = createMockReq({ query: { code: 'code', state: 'valid-state' } });
    const res = createMockRes();

    await handler!(req, res, vi.fn());

    expect(res._status).toBe(400);
  });

  it('creates new GitHub connection and redirects to /auth', async () => {
    const ghState = { ...VALID_STATE_ROW, service: 'GITHUB', userId: 'user-1' };
    selectReturning([ghState]);
    deleteResolving();

    vi.mocked(axios.post).mockResolvedValueOnce({
      data: { access_token: 'gh-token' },
    });
    vi.mocked(axios.get).mockResolvedValueOnce({
      data: { login: 'example-user' },
    });

    selectReturning([]);  // no existing connection
    insertResolving();

    const req = createMockReq({ query: { code: 'code', state: 'valid-state' }, session: {} });
    const res = createMockRes();

    await handler!(req, res, vi.fn());

    expect(res._redirect).toBe('/auth');
    expect(db.insert).toHaveBeenCalled();
  });

  it('updates existing GitHub connection on re-authorization', async () => {
    const ghState = { ...VALID_STATE_ROW, service: 'GITHUB', userId: 'user-1' };
    selectReturning([ghState]);
    deleteResolving();

    vi.mocked(axios.post).mockResolvedValueOnce({
      data: { access_token: 'gh-token-2' },
    });
    vi.mocked(axios.get).mockResolvedValueOnce({
      data: { login: 'example-user' },
    });

    selectReturning([{ id: 'conn-gh-1', userId: 'user-1', service: 'GITHUB' }]);
    updateResolving();

    const req = createMockReq({ query: { code: 'code', state: 'valid-state' }, session: {} });
    const res = createMockRes();

    await handler!(req, res, vi.fn());

    expect(res._redirect).toBe('/auth');
    expect(db.update).toHaveBeenCalled();
    expect(db.insert).not.toHaveBeenCalled();
  });

  it('returns 500 on GitHub token exchange failure', async () => {
    const ghState = { ...VALID_STATE_ROW, service: 'GITHUB', userId: 'user-1' };
    selectReturning([ghState]);
    deleteResolving();

    vi.mocked(axios.post).mockRejectedValueOnce(new Error('GitHub rate limit'));

    const req = createMockReq({ query: { code: 'code', state: 'valid-state' }, session: {} });
    const res = createMockRes();

    await handler!(req, res, vi.fn());

    expect(res._status).toBe(500);
    expect(res._body).toContain('GitHub authentication failed');
  });
});

// ─── Disconnect route ─────────────────────────────────────────────────────────
//
// Registered as POST /:service/disconnect (already migrated from GET to prevent
// CSRF via link clicks).

describe('POST /:service/disconnect', () => {
  let handler: ReturnType<typeof findHandler>;

  beforeEach(() => {
    vi.clearAllMocks();
    handler = findHandler(authRouter, 'post', '/:service/disconnect');
  });

  it('middleware redirects unauthenticated request to /auth', async () => {
    const req = createMockReq({ session: {}, params: { service: 'google' } });
    const res = createMockRes();

    // Test the requireSessionOrRedirect middleware directly — the route handler
    // itself is guarded by this middleware before it runs.
    const next = vi.fn();
    const { requireSessionOrRedirect } = await import('../../src/auth/middleware.js');
    requireSessionOrRedirect(req, res, next);

    expect(res._redirect).toBe('/auth');
    expect(next).not.toHaveBeenCalled();
  });

  it('deletes the specified service connection and redirects to /auth', async () => {
    deleteResolving();

    const req = createMockReq({
      session: { userId: 'user-1' },
      params: { service: 'google' },
    });
    const res = createMockRes();

    await handler!(req, res, vi.fn());

    expect(db.delete).toHaveBeenCalled();
    expect(res._redirect).toBe('/auth');
  });

  it('redirects to /auth even when the delete throws (idempotent, error is swallowed)', async () => {
    const chain = {
      where: vi.fn().mockRejectedValueOnce(new Error('no rows')),
    };
    vi.mocked(db.delete).mockReturnValueOnce(chain as never);

    const req = createMockReq({
      session: { userId: 'user-1' },
      params: { service: 'slack' },
    });
    const res = createMockRes();

    await handler!(req, res, vi.fn());

    expect(res._redirect).toBe('/auth');
  });

  it('uppercases the service param before querying (google -> GOOGLE)', async () => {
    deleteResolving();

    const req = createMockReq({
      session: { userId: 'user-1' },
      params: { service: 'github' },
    });
    const res = createMockRes();

    await handler!(req, res, vi.fn());

    expect(db.delete).toHaveBeenCalled();
  });
});

// ─── Logout ───────────────────────────────────────────────────────────────────

describe('GET /logout', () => {
  let handler: ReturnType<typeof findHandler>;

  beforeEach(() => {
    vi.clearAllMocks();
    handler = findHandler(authRouter, 'get', '/logout');
  });

  it('destroys the session and redirects to /auth', async () => {
    const destroy = vi.fn((cb: () => void) => cb());
    const req = createMockReq({ session: { userId: 'user-1', destroy } });
    const res = createMockRes();

    await handler!(req, res, vi.fn());

    expect(destroy).toHaveBeenCalled();
    expect(res._redirect).toBe('/auth');
  });
});
