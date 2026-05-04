import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Request, Response, NextFunction } from 'express';
import * as jose from 'jose';

import { createAuthMiddleware } from '../../../src/content/mediation/auth.js';
import { sessionMatchesRequestContext } from '../../../src/content/mediation/router.js';

vi.mock('jose', () => {
  class JWTExpired extends Error {}

  return {
    createRemoteJWKSet: vi.fn(() => Symbol('jwks')),
    jwtVerify: vi.fn(),
    errors: { JWTExpired },
  };
});

type KeyRecord = {
  id: string;
  tenantId: string;
  keyHash: string;
  isActive: boolean;
  jwksUri: string | null;
  issuer: string | null;
  audience: string | null;
};

function makeResponse(): Response {
  const res = {} as Response;
  (res as Response & { statusCode: number }).statusCode = 200;
  res.status = vi.fn((code: number) => {
    (res as Response & { statusCode: number }).statusCode = code;
    return res;
  }) as unknown as Response['status'];
  res.json = vi.fn(() => res) as unknown as Response['json'];
  return res;
}

function makeDb(rows: KeyRecord[] = [], rejectSelect = false) {
  const limit = vi.fn(async () => {
    if (rejectSelect) throw new Error('db unavailable');
    return rows;
  });
  const where = vi.fn(() => ({ limit }));
  const from = vi.fn(() => ({ where }));
  const select = vi.fn(() => ({ from }));

  const updateWhere = vi.fn(() => Promise.resolve(undefined));
  const set = vi.fn(() => ({ where: updateWhere }));
  const update = vi.fn(() => ({ set }));

  return { select, update };
}

describe('Mediation auth middleware', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('rejects missing API key', async () => {
    const db = makeDb();
    const { validateApiKey } = createAuthMiddleware(db as never);
    const req = { headers: {} } as unknown as Request;
    const res = makeResponse();
    const next = vi.fn<Parameters<NextFunction>, ReturnType<NextFunction>>();

    await validateApiKey(req, res, next);

    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ error: 'missing_api_key' }),
    );
    expect(next).not.toHaveBeenCalled();
  });

  it('rejects invalid API key', async () => {
    const db = makeDb([]);
    const { validateApiKey } = createAuthMiddleware(db as never);
    const req = { headers: { 'x-api-key': 'invalid' } } as unknown as Request;
    const res = makeResponse();
    const next = vi.fn<Parameters<NextFunction>, ReturnType<NextFunction>>();

    await validateApiKey(req, res, next);

    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ error: 'invalid_api_key' }),
    );
    expect(next).not.toHaveBeenCalled();
  });

  it('fails closed when API key lookup is unavailable', async () => {
    const db = makeDb([], true);
    const { validateApiKey } = createAuthMiddleware(db as never);
    const req = { headers: { 'x-api-key': 'test-key' } } as unknown as Request;
    const res = makeResponse();
    const next = vi.fn<Parameters<NextFunction>, ReturnType<NextFunction>>();

    await validateApiKey(req, res, next);

    expect(res.status).toHaveBeenCalledWith(503);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ error: 'auth_service_unavailable' }),
    );
    expect(next).not.toHaveBeenCalled();
  });

  it('accepts valid API key and sets tenant context', async () => {
    const db = makeDb([
      {
        id: 'key-1',
        tenantId: 'tenant-1',
        keyHash: 'hash',
        isActive: true,
        jwksUri: 'https://example.com/jwks',
        issuer: null,
        audience: null,
      },
    ]);
    const { validateApiKey } = createAuthMiddleware(db as never);
    const req = { headers: { 'x-api-key': 'valid-key' } } as unknown as Request;
    const res = makeResponse();
    const next = vi.fn<Parameters<NextFunction>, ReturnType<NextFunction>>();

    await validateApiKey(req, res, next);

    expect(next).toHaveBeenCalledOnce();
    expect((req as Request & { tenantId?: string }).tenantId).toBe('tenant-1');
    expect((req as Request & { apiKeyRecord?: { id: string } }).apiKeyRecord?.id).toBe('key-1');
  });

  it('rejects missing bearer token', async () => {
    const db = makeDb();
    const { validateUserToken } = createAuthMiddleware(db as never);
    const req = { headers: {} } as unknown as Request;
    const res = makeResponse();
    const next = vi.fn<Parameters<NextFunction>, ReturnType<NextFunction>>();

    await validateUserToken(req, res, next);

    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ error: 'missing_user_token' }),
    );
    expect(next).not.toHaveBeenCalled();
  });

  it('rejects token when API key context is missing', async () => {
    const db = makeDb();
    const { validateUserToken } = createAuthMiddleware(db as never);
    const req = {
      headers: { authorization: 'Bearer token' },
    } as unknown as Request;
    const res = makeResponse();
    const next = vi.fn<Parameters<NextFunction>, ReturnType<NextFunction>>();

    await validateUserToken(req, res, next);

    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ error: 'missing_api_key' }),
    );
    expect(next).not.toHaveBeenCalled();
  });

  it('rejects token when JWKS URI is not configured', async () => {
    const db = makeDb();
    const { validateUserToken } = createAuthMiddleware(db as never);
    const req = {
      headers: { authorization: 'Bearer token' },
      apiKeyRecord: {
        id: 'key-1',
        tenantId: 'tenant-1',
        jwksUri: null,
        issuer: null,
        audience: null,
      },
    } as unknown as Request;
    const res = makeResponse();
    const next = vi.fn<Parameters<NextFunction>, ReturnType<NextFunction>>();

    await validateUserToken(req, res, next);

    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ error: 'invalid_configuration' }),
    );
    expect(next).not.toHaveBeenCalled();
  });

  it('rejects expired token', async () => {
    const db = makeDb();
    const { validateUserToken } = createAuthMiddleware(db as never);
    const req = {
      headers: { authorization: 'Bearer expired-token' },
      apiKeyRecord: {
        id: 'key-1',
        tenantId: 'tenant-1',
        jwksUri: 'https://example.com/jwks',
        issuer: null,
        audience: null,
      },
    } as unknown as Request;
    const res = makeResponse();
    const next = vi.fn<Parameters<NextFunction>, ReturnType<NextFunction>>();

    const JWTExpired = (jose.errors as { JWTExpired: new (message?: string) => Error }).JWTExpired;
    vi.mocked(jose.jwtVerify).mockRejectedValueOnce(new JWTExpired('expired'));

    await validateUserToken(req, res, next);

    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ error: 'token_expired' }),
    );
    expect(next).not.toHaveBeenCalled();
  });

  it('accepts valid token and sets userId', async () => {
    const db = makeDb();
    const { validateUserToken } = createAuthMiddleware(db as never);
    const req = {
      headers: { authorization: 'Bearer ok-token' },
      apiKeyRecord: {
        id: 'key-1',
        tenantId: 'tenant-1',
        jwksUri: 'https://example.com/jwks',
        issuer: 'https://issuer.example.com',
        audience: 'aud-1',
      },
    } as unknown as Request;
    const res = makeResponse();
    const next = vi.fn<Parameters<NextFunction>, ReturnType<NextFunction>>();

    vi.mocked(jose.jwtVerify).mockResolvedValueOnce({
      payload: { sub: 'user-123' },
      protectedHeader: {},
      key: {} as never,
    });

    await validateUserToken(req, res, next);

    expect(next).toHaveBeenCalledOnce();
    expect((req as Request & { userId?: string }).userId).toBe('user-123');
  });
});

describe('session request scoping', () => {
  it('matches only when user, tenant, and api key all match', () => {
    const allowed = sessionMatchesRequestContext(
      { userId: 'user-1', tenantId: 'tenant-1', apiKeyId: 'key-1' },
      { userId: 'user-1', tenantId: 'tenant-1', apiKeyRecord: { id: 'key-1' } },
    );

    const tenantMismatch = sessionMatchesRequestContext(
      { userId: 'user-1', tenantId: 'tenant-2', apiKeyId: 'key-1' },
      { userId: 'user-1', tenantId: 'tenant-1', apiKeyRecord: { id: 'key-1' } },
    );

    const apiKeyMismatch = sessionMatchesRequestContext(
      { userId: 'user-1', tenantId: 'tenant-1', apiKeyId: 'key-2' },
      { userId: 'user-1', tenantId: 'tenant-1', apiKeyRecord: { id: 'key-1' } },
    );

    expect(allowed).toBe(true);
    expect(tenantMismatch).toBe(false);
    expect(apiKeyMismatch).toBe(false);
  });
});
