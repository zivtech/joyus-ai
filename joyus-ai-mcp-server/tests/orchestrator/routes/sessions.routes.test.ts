/**
 * Unit tests for session route handlers.
 *
 * Tests use mock req/res objects to call route handlers directly,
 * matching the existing orchestrator test style (no HTTP server, no supertest).
 *
 * Mocks: SessionService methods, getTenantId middleware helper.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ── Mock helpers ────────────────────────────────────────────────────────────

type MockRes = {
  status: ReturnType<typeof vi.fn>;
  json: ReturnType<typeof vi.fn>;
  headersSent?: boolean;
};

function buildMockRes(): MockRes {
  const res = {} as MockRes;
  res.status = vi.fn().mockReturnValue(res);
  res.json = vi.fn().mockReturnValue(res);
  return res;
}

function buildMockReq(overrides: Record<string, unknown> = {}) {
  return {
    params: {},
    query: {},
    body: {},
    tenantId: 'tenant-1',
    ...overrides,
  };
}

function buildSession(overrides: Record<string, unknown> = {}) {
  return {
    id: 'session-1',
    tenantId: 'tenant-1',
    userId: 'user-1',
    status: 'pending',
    metadata: {},
    inngestRunId: null,
    createdAt: new Date('2026-01-01T00:00:00Z'),
    updatedAt: new Date('2026-01-01T00:00:00Z'),
    completedAt: null,
    ...overrides,
  };
}

// ── Import under test ───────────────────────────────────────────────────────

// We import createSessionsRouter and call the underlying handler via mocked request/response.
// Since Express router handlers are plain async functions, we can invoke them directly.
import { createSessionsRouter } from '../../../src/orchestrator/routes/sessions.js';

// ── Tests ───────────────────────────────────────────────────────────────────

describe('Session Routes', () => {
  let mockSessionService: {
    createSession: ReturnType<typeof vi.fn>;
    getSession: ReturnType<typeof vi.fn>;
    listSessions: ReturnType<typeof vi.fn>;
    updateSessionStatus: ReturnType<typeof vi.fn>;
  };

  beforeEach(() => {
    mockSessionService = {
      createSession: vi.fn(),
      getSession: vi.fn(),
      listSessions: vi.fn(),
      updateSessionStatus: vi.fn(),
    };
  });

  // ─── createSessionsRouter returns an Express router ──────────────────────

  it('creates a router without throwing', () => {
    const router = createSessionsRouter(mockSessionService as never);
    expect(router).toBeDefined();
    // Express routers are functions
    expect(typeof router).toBe('function');
  });

  // ─── Schemas: createSessionRequestSchema ─────────────────────────────────

  it('validates createSession request — rejects missing userId', async () => {
    const router = createSessionsRouter(mockSessionService as never);
    const req = buildMockReq({ body: { metadata: {} } }); // no userId
    const res = buildMockRes();

    // Find and call the POST / handler
    // Express Router stores handlers in router.stack; use layer matching
    const layer = router.stack.find(
      (l: { route?: { methods?: Record<string, boolean>; path?: string } }) =>
        l.route?.methods?.post && l.route?.path === '/',
    );
    expect(layer).toBeDefined();
    await layer!.route.stack[0].handle(req, res, vi.fn());

    expect(res.status).toHaveBeenCalledWith(400);
    const body = res.json.mock.calls[0][0] as { error: { code: string } };
    expect(body.error.code).toBe('VALIDATION_ERROR');
  });

  it('createSession calls service with tenantId from middleware, never from body', async () => {
    const session = buildSession();
    mockSessionService.createSession.mockResolvedValue(session);

    const router = createSessionsRouter(mockSessionService as never);
    const req = buildMockReq({
      body: { userId: 'user-1' },
      tenantId: 'tenant-1',
    });
    const res = buildMockRes();

    const layer = router.stack.find(
      (l: { route?: { methods?: Record<string, boolean>; path?: string } }) =>
        l.route?.methods?.post && l.route?.path === '/',
    );
    await layer!.route.stack[0].handle(req, res, vi.fn());

    expect(mockSessionService.createSession).toHaveBeenCalledWith(
      expect.objectContaining({ tenantId: 'tenant-1', userId: 'user-1' }),
    );
    expect(res.status).toHaveBeenCalledWith(201);
    expect(res.json).toHaveBeenCalledWith(session);
  });

  it('createSession returns 400 when userId does not reference an existing user', async () => {
    mockSessionService.createSession.mockRejectedValue({
      cause: {
        code: '23503',
        constraint: 'orchestrator_sessions_user_id_fkey',
      },
    });

    const router = createSessionsRouter(mockSessionService as never);
    const req = buildMockReq({
      body: { userId: 'missing-user' },
      tenantId: 'tenant-1',
    });
    const res = buildMockRes();
    const next = vi.fn();

    const layer = router.stack.find(
      (l: { route?: { methods?: Record<string, boolean>; path?: string } }) =>
        l.route?.methods?.post && l.route?.path === '/',
    );
    await layer!.route.stack[0].handle(req, res, next);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith({
      error: {
        code: 'INVALID_USER_ID',
        message: 'userId must reference an existing user for the authenticated tenant',
      },
    });
    expect(next).not.toHaveBeenCalled();
  });

  it('getSession returns 404 when session is null (not found or cross-tenant)', async () => {
    mockSessionService.getSession.mockResolvedValue(null);

    const router = createSessionsRouter(mockSessionService as never);
    const req = buildMockReq({ params: { sessionId: 'missing-id' } });
    const res = buildMockRes();

    const layer = router.stack.find(
      (l: { route?: { methods?: Record<string, boolean>; path?: string } }) =>
        l.route?.methods?.get && l.route?.path === '/:sessionId',
    );
    await layer!.route.stack[0].handle(req, res, vi.fn());

    expect(res.status).toHaveBeenCalledWith(404);
    const body = res.json.mock.calls[0][0] as { error: { code: string } };
    expect(body.error.code).toBe('NOT_FOUND');
  });

  it('getSession returns session when found', async () => {
    const session = buildSession({ id: 'session-99', status: 'running' });
    mockSessionService.getSession.mockResolvedValue(session);

    const router = createSessionsRouter(mockSessionService as never);
    const req = buildMockReq({ params: { sessionId: 'session-99' } });
    const res = buildMockRes();

    const layer = router.stack.find(
      (l: { route?: { methods?: Record<string, boolean>; path?: string } }) =>
        l.route?.methods?.get && l.route?.path === '/:sessionId',
    );
    await layer!.route.stack[0].handle(req, res, vi.fn());

    expect(res.status).not.toHaveBeenCalled();
    expect(res.json).toHaveBeenCalledWith(session);
  });

  it('listSessions passes filters and returns paginated results', async () => {
    const sessions = [buildSession(), buildSession({ id: 'session-2' })];
    mockSessionService.listSessions.mockResolvedValue({ items: sessions, cursor: undefined });

    const router = createSessionsRouter(mockSessionService as never);
    const req = buildMockReq({ query: { status: 'running', limit: '5' } });
    const res = buildMockRes();

    const layer = router.stack.find(
      (l: { route?: { methods?: Record<string, boolean>; path?: string } }) =>
        l.route?.methods?.get && l.route?.path === '/',
    );
    await layer!.route.stack[0].handle(req, res, vi.fn());

    expect(mockSessionService.listSessions).toHaveBeenCalledWith(
      'tenant-1',
      expect.objectContaining({ status: 'running', limit: 5 }),
    );
    expect(res.json).toHaveBeenCalledWith({ items: sessions, cursor: undefined });
  });

  it('PATCH /sessions/:id maps action to status (suspend → suspended)', async () => {
    const updated = buildSession({ status: 'suspended' });
    mockSessionService.updateSessionStatus.mockResolvedValue(updated);

    const router = createSessionsRouter(mockSessionService as never);
    const req = buildMockReq({
      params: { sessionId: 'session-1' },
      body: { action: 'suspend' },
    });
    const res = buildMockRes();

    const layer = router.stack.find(
      (l: { route?: { methods?: Record<string, boolean>; path?: string } }) =>
        l.route?.methods?.patch && l.route?.path === '/:sessionId',
    );
    await layer!.route.stack[0].handle(req, res, vi.fn());

    expect(mockSessionService.updateSessionStatus).toHaveBeenCalledWith(
      expect.objectContaining({ newStatus: 'suspended' }),
    );
    expect(res.json).toHaveBeenCalledWith(updated);
  });

  it('PATCH /sessions/:id returns 400 for invalid action', async () => {
    const router = createSessionsRouter(mockSessionService as never);
    const req = buildMockReq({
      params: { sessionId: 'session-1' },
      body: { action: 'delete' }, // not a valid action
    });
    const res = buildMockRes();

    const layer = router.stack.find(
      (l: { route?: { methods?: Record<string, boolean>; path?: string } }) =>
        l.route?.methods?.patch && l.route?.path === '/:sessionId',
    );
    await layer!.route.stack[0].handle(req, res, vi.fn());

    expect(res.status).toHaveBeenCalledWith(400);
  });
});
