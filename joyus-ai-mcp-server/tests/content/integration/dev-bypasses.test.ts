import type { NextFunction, Request, Response } from 'express';
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';

import { createAuthMiddleware } from '../../../src/content/mediation/auth.js';
import { EntitlementCache } from '../../../src/content/entitlements/cache.js';
import { EntitlementService } from '../../../src/content/entitlements/index.js';
import { assertContentDevBypassesAreSafe } from '../../../src/content/dev-guards.js';
import type { ResolvedEntitlements } from '../../../src/content/types.js';

function createMockReq(overrides: Partial<Request> = {}): Request {
  return {
    headers: {},
    ...overrides,
  } as Request;
}

function createMockRes() {
  const res = {
    _status: 0,
    _json: null as unknown,
    status(code: number) {
      res._status = code;
      return res;
    },
    json(data: unknown) {
      res._json = data;
      return res;
    },
  };

  return res as Response & { _status: number; _json: unknown };
}

function makeEntitlements(sourceIds: string[]): ResolvedEntitlements {
  return {
    productIds: ['prod-1'],
    sourceIds,
    profileIds: [],
    resolvedFrom: 'cache',
    resolvedAt: new Date(),
  };
}

describe('Content dev bypasses', () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    vi.restoreAllMocks();
    process.env = { ...originalEnv };
  });

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  it('allows the dev JWT bypass only for the exact configured bearer token', async () => {
    process.env.JOYUS_DEV_SKIP_JWT = 'true';
    process.env.JOYUS_DEV_JWT_TOKEN = 'dev-token';

    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const req = createMockReq({
      headers: { authorization: 'Bearer dev-token' },
    });
    const res = createMockRes();
    const next: NextFunction = vi.fn();

    await createAuthMiddleware({} as never).validateUserToken(req, res, next);

    expect(warnSpy).toHaveBeenCalledWith('Dev JWT bypass used - DO NOT run this in production');
    expect(req.userId).toBe('dev-user');
    expect(req.user).toEqual({
      sub: 'dev-user',
      aud: 'joyus-mediation-dev',
      iss: 'joyus-dev',
    });
    expect(next).toHaveBeenCalledOnce();
  });

  it('does not activate the JWT bypass for a non-matching token', async () => {
    process.env.JOYUS_DEV_SKIP_JWT = 'true';
    process.env.JOYUS_DEV_JWT_TOKEN = 'dev-token';

    const req = createMockReq({
      headers: { authorization: 'Bearer wrong-token' },
    });
    const res = createMockRes();
    const next: NextFunction = vi.fn();

    await createAuthMiddleware({} as never).validateUserToken(req, res, next);

    expect(res._status).toBe(401);
    expect(res._json).toEqual({
      error: 'missing_api_key',
      message: 'API key validation must precede user token validation',
    });
    expect(next).not.toHaveBeenCalled();
  });

  it('returns all sources for the current tenant when the entitlement bypass is enabled', async () => {
    process.env.JOYUS_DEV_ENTITLEMENT_MODE = 'all-tenant-sources';

    const cache = new EntitlementCache();
    cache.set('session-1', makeEntitlements(['cached-source']));

    const mockResolver = {
      resolve: vi.fn(),
    };
    const mockDb = {
      select: vi.fn().mockReturnValue({
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockResolvedValue([{ id: 'source-a' }, { id: 'source-b' }]),
        }),
      }),
    } as never;

    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const service = new EntitlementService(mockResolver, cache, mockDb);
    const result = await service.resolve('user-1', 'tenant-1', { sessionId: 'session-1' });

    expect(warnSpy).toHaveBeenCalledWith(
      'Dev entitlement bypass active - returns ALL sources for tenant. DO NOT run in production'
    );
    expect(mockResolver.resolve).not.toHaveBeenCalled();
    expect(result).toMatchObject({
      productIds: [],
      sourceIds: ['source-a', 'source-b'],
      profileIds: [],
      resolvedFrom: 'dev-all-tenant-sources',
    });
  });

  it('rejects dev bypass flags in production', () => {
    process.env.NODE_ENV = 'production';
    process.env.JOYUS_DEV_SKIP_JWT = 'true';

    expect(() => assertContentDevBypassesAreSafe()).toThrow(
      'JOYUS_DEV_SKIP_JWT=true cannot be set in production'
    );

    process.env.JOYUS_DEV_SKIP_JWT = 'false';
    process.env.JOYUS_DEV_ENTITLEMENT_MODE = 'all-tenant-sources';

    expect(() => assertContentDevBypassesAreSafe()).toThrow(
      'JOYUS_DEV_ENTITLEMENT_MODE=all-tenant-sources cannot be set in production'
    );
  });
});
