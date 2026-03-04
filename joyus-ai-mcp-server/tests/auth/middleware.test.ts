/**
 * Unit tests for shared auth middleware
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Request, Response, NextFunction } from 'express';

import { requireBearerToken, requireSession, requireSessionOrRedirect } from '../../src/auth/middleware.js';

// Mock the verify module
vi.mock('../../src/auth/verify.js', () => ({
  getUserFromToken: vi.fn(),
}));

import { getUserFromToken } from '../../src/auth/verify.js';

const mockGetUserFromToken = vi.mocked(getUserFromToken);

function createMockReq(overrides: Record<string, unknown> = {}): Request {
  return {
    headers: {},
    query: {},
    session: {},
    ...overrides,
  } as unknown as Request;
}

function createMockRes() {
  const res = {
    _status: 0,
    _json: null as unknown,
    _redirect: null as string | null,
    status(code: number) {
      res._status = code;
      return res;
    },
    json(data: unknown) {
      res._json = data;
      return res;
    },
    redirect(url: string) {
      res._redirect = url;
      return res;
    },
  };
  return res as unknown as Response & { _status: number; _json: unknown; _redirect: string | null };
}

describe('Auth Middleware', () => {
  let next: NextFunction;

  beforeEach(() => {
    next = vi.fn();
    vi.clearAllMocks();
  });

  describe('requireBearerToken', () => {
    it('returns 401 when no token is provided', async () => {
      const req = createMockReq();
      const res = createMockRes();

      await requireBearerToken(req, res, next);

      expect(res._status).toBe(401);
      expect(res._json).toEqual({ error: 'Missing or invalid authorization' });
      expect(next).not.toHaveBeenCalled();
    });

    it('returns 401 for invalid token', async () => {
      const req = createMockReq({
        headers: { authorization: 'Bearer bad-token' },
      });
      mockGetUserFromToken.mockResolvedValue(null);

      const res = createMockRes();
      await requireBearerToken(req, res, next);

      expect(mockGetUserFromToken).toHaveBeenCalledWith('bad-token');
      expect(res._status).toBe(401);
      expect(res._json).toEqual({ error: 'Invalid token' });
      expect(next).not.toHaveBeenCalled();
    });

    it('attaches user and calls next for valid Bearer header', async () => {
      const mockUser = { id: 'u1', email: 'a@b.com', name: 'Test', connections: [] };
      const req = createMockReq({
        headers: { authorization: 'Bearer good-token' },
      });
      mockGetUserFromToken.mockResolvedValue(mockUser);

      const res = createMockRes();
      await requireBearerToken(req, res, next);

      expect(req.mcpUser).toBe(mockUser);
      expect(next).toHaveBeenCalled();
    });

    it('falls back to query param token for SSE', async () => {
      const mockUser = { id: 'u1', email: 'a@b.com', name: 'Test', connections: [] };
      const req = createMockReq({
        query: { token: 'sse-token' },
      });
      mockGetUserFromToken.mockResolvedValue(mockUser);

      const res = createMockRes();
      await requireBearerToken(req, res, next);

      expect(mockGetUserFromToken).toHaveBeenCalledWith('sse-token');
      expect(req.mcpUser).toBe(mockUser);
      expect(next).toHaveBeenCalled();
    });

    it('prefers Authorization header over query param', async () => {
      const mockUser = { id: 'u1', email: 'a@b.com', name: 'Test', connections: [] };
      const req = createMockReq({
        headers: { authorization: 'Bearer header-token' },
        query: { token: 'query-token' },
      });
      mockGetUserFromToken.mockResolvedValue(mockUser);

      const res = createMockRes();
      await requireBearerToken(req, res, next);

      expect(mockGetUserFromToken).toHaveBeenCalledWith('header-token');
    });
  });

  describe('requireSession', () => {
    it('returns 401 JSON when session has no userId', () => {
      const req = createMockReq({ session: {} });
      const res = createMockRes();

      requireSession(req, res, next);

      expect(res._status).toBe(401);
      expect(res._json).toEqual({ error: 'Unauthorized' });
      expect(next).not.toHaveBeenCalled();
    });

    it('calls next when session has userId', () => {
      const req = createMockReq({ session: { userId: 'u1' } });
      const res = createMockRes();

      requireSession(req, res, next);

      expect(next).toHaveBeenCalled();
    });
  });

  describe('requireSessionOrRedirect', () => {
    it('redirects to /auth when session has no userId', () => {
      const req = createMockReq({ session: {} });
      const res = createMockRes();

      requireSessionOrRedirect(req, res, next);

      expect(res._redirect).toBe('/auth');
      expect(next).not.toHaveBeenCalled();
    });

    it('calls next when session has userId', () => {
      const req = createMockReq({ session: { userId: 'u1' } });
      const res = createMockRes();

      requireSessionOrRedirect(req, res, next);

      expect(next).toHaveBeenCalled();
    });
  });
});
