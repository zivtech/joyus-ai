/**
 * Tests for the exports module
 *
 * Covers:
 *   - Export service helpers (normalizeExportScope, normalizeExportLocations, canAccessTenant)
 *   - Auth middleware (extractBearerToken, requireTokenAuth)
 *   - Router download endpoint (GET /exports/download/:token)
 */

import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import type { Request, Response, NextFunction } from 'express';

// ── Mock return queues ──────────────────────────────────────────────────────

const mockQueues = {
  insertReturning: [] as unknown[][],
  selectWhere: [] as unknown[][],
  updateReturning: [] as unknown[][],
  deleteReturning: [] as unknown[][],
};

function resetMockQueues() {
  mockQueues.insertReturning = [];
  mockQueues.selectWhere = [];
  mockQueues.updateReturning = [];
  mockQueues.deleteReturning = [];
}

// ── Module mocks — hoisted by Vitest before any other module initialization ──

vi.mock('../src/exports/excel-builder.js', () => ({
  buildWorkbookFile: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../src/db/client.js', () => {
  function makeInsertChain() {
    return {
      values: vi.fn(() => {
        const p = Promise.resolve(undefined);
        (p as any).returning = vi.fn(() =>
          Promise.resolve(mockQueues.insertReturning.shift() || []),
        );
        return p;
      }),
    };
  }

  function makeSelectChain() {
    return {
      from: vi.fn(() => ({
        where: vi.fn(() =>
          Promise.resolve(mockQueues.selectWhere.shift() || []),
        ),
      })),
    };
  }

  function makeUpdateChain() {
    return {
      set: vi.fn(() => ({
        where: vi.fn(() => {
          const p = Promise.resolve(undefined);
          (p as any).returning = vi.fn(() =>
            Promise.resolve(mockQueues.updateReturning.shift() || []),
          );
          return p;
        }),
      })),
    };
  }

  function makeDeleteChain() {
    return {
      where: vi.fn(() => ({
        returning: vi.fn(() =>
          Promise.resolve(mockQueues.deleteReturning.shift() || []),
        ),
      })),
    };
  }

  return {
    db: {
      insert: vi.fn(() => makeInsertChain()),
      select: vi.fn(() => makeSelectChain()),
      update: vi.fn(() => makeUpdateChain()),
      delete: vi.fn(() => makeDeleteChain()),
    },
    exportJobs: {},
    auditLogs: {},
    users: {},
    connections: {},
  };
});

vi.mock('../src/auth/verify.js', () => ({
  getUserFromToken: vi.fn(),
}));

// Mock fs/promises so createExcelExportJob does not touch the real filesystem.
vi.mock('fs/promises', () => ({
  mkdir: vi.fn().mockResolvedValue(undefined),
  stat: vi.fn().mockResolvedValue({ size: 4096 }),
}));

// ── Imports (after mocks) ────────────────────────────────────────────────────

import {
  canAccessTenant,
  normalizeExportLocations,
  normalizeExportScope,
} from '../src/exports/service.js';

import { extractBearerToken, requireTokenAuth } from '../src/auth/middleware.js';
import { getUserFromToken } from '../src/auth/verify.js';
import { exportRouter } from '../src/exports/router.js';

// ── Helpers ──────────────────────────────────────────────────────────────────

function makeReq(overrides: Partial<Request> = {}): Request {
  return {
    headers: {},
    params: {},
    body: {},
    protocol: 'http',
    get: vi.fn().mockReturnValue('localhost'),
    ...overrides,
  } as unknown as Request;
}

function makeRes(): Response & {
  _status: number;
  _body: unknown;
  _downloadFile?: string;
  _downloadName?: string;
} {
  const res = {
    _status: 200,
    _body: undefined as unknown,
    _downloadFile: undefined as string | undefined,
    _downloadName: undefined as string | undefined,
    status: vi.fn().mockReturnThis(),
    json: vi.fn().mockReturnThis(),
    setHeader: vi.fn().mockReturnThis(),
    download: vi.fn(),
  } as unknown as Response & {
    _status: number;
    _body: unknown;
    _downloadFile?: string;
    _downloadName?: string;
  };

  (res.status as ReturnType<typeof vi.fn>).mockImplementation((code: number) => {
    res._status = code;
    return res;
  });
  (res.json as ReturnType<typeof vi.fn>).mockImplementation((body: unknown) => {
    res._body = body;
    return res;
  });
  (res.download as ReturnType<typeof vi.fn>).mockImplementation((filePath: string, fileName: string) => {
    res._downloadFile = filePath;
    res._downloadName = fileName;
  });

  return res;
}

// ── Suite 1: Export Service Helpers ──────────────────────────────────────────

describe('Export Service Helpers', () => {
  describe('normalizeExportScope', () => {
    it('defaults to current_view when value is undefined', () => {
      expect(normalizeExportScope(undefined)).toBe('current_view');
    });

    it('defaults to current_view for an unrecognised value', () => {
      expect(normalizeExportScope('anything-else')).toBe('current_view');
    });

    it('accepts full_period', () => {
      expect(normalizeExportScope('full_period')).toBe('full_period');
    });
  });

  describe('normalizeExportLocations', () => {
    it('defaults to current when value is undefined', () => {
      expect(normalizeExportLocations(undefined)).toBe('current');
    });

    it('defaults to current for an unrecognised value', () => {
      expect(normalizeExportLocations('other')).toBe('current');
    });

    it('accepts all_accessible', () => {
      expect(normalizeExportLocations('all_accessible')).toBe('all_accessible');
    });
  });

  describe('canAccessTenant', () => {
    it('allows access when userId equals tenantId', () => {
      vi.stubEnv('EXPORT_ALLOW_ANY_TENANT', 'false');
      vi.stubEnv('EXPORT_TENANT_ALLOWLIST', '');
      expect(canAccessTenant('user-1', 'user-1')).toBe(true);
    });

    it('allows tenant explicitly listed in allowlist', () => {
      vi.stubEnv('EXPORT_ALLOW_ANY_TENANT', 'false');
      vi.stubEnv('EXPORT_TENANT_ALLOWLIST', 'user-1:tenant-a,user-2:tenant-b');
      expect(canAccessTenant('user-1', 'tenant-a')).toBe(true);
    });

    it('denies a tenant not in allowlist', () => {
      vi.stubEnv('EXPORT_ALLOW_ANY_TENANT', 'false');
      vi.stubEnv('EXPORT_TENANT_ALLOWLIST', 'user-1:tenant-a,user-2:tenant-b');
      expect(canAccessTenant('user-1', 'tenant-b')).toBe(false);
    });

    it('allows any tenant when EXPORT_ALLOW_ANY_TENANT is true', () => {
      vi.stubEnv('EXPORT_ALLOW_ANY_TENANT', 'true');
      vi.stubEnv('EXPORT_TENANT_ALLOWLIST', '');
      expect(canAccessTenant('user-1', 'tenant-x')).toBe(true);
    });
  });
});

// ── Suite 2: Auth middleware ──────────────────────────────────────────────────

describe('extractBearerToken', () => {
  it('returns the token when Authorization header is well-formed', () => {
    const req = makeReq({ headers: { authorization: 'Bearer abc123' } });
    expect(extractBearerToken(req)).toBe('abc123');
  });

  it('returns null when Authorization header is absent', () => {
    const req = makeReq({ headers: {} });
    expect(extractBearerToken(req)).toBeNull();
  });

  it('returns null when header does not start with Bearer', () => {
    const req = makeReq({ headers: { authorization: 'Basic abc123' } });
    expect(extractBearerToken(req)).toBeNull();
  });

  it('returns empty string when header is exactly "Bearer " with no token value', () => {
    // The implementation returns substring(7) unconditionally when startsWith('Bearer ') is true.
    // "Bearer " -> substring(7) -> ''. We document the actual behaviour here.
    const req = makeReq({ headers: { authorization: 'Bearer ' } });
    expect(extractBearerToken(req)).toBe('');
  });

  it('preserves token value exactly including special characters', () => {
    const token = 'tok_abc.def-ghi_123==';
    const req = makeReq({ headers: { authorization: `Bearer ${token}` } });
    expect(extractBearerToken(req)).toBe(token);
  });
});

describe('requireTokenAuth', () => {
  afterEach(() => {
    // Use clearAllMocks (not resetAllMocks) to preserve mock implementations
    // set up by vi.mock() factories at file scope (e.g. fs/promises stat).
    vi.clearAllMocks();
  });

  it('responds 401 when Authorization header is missing', async () => {
    const req = makeReq({ headers: {} }) as Parameters<typeof requireTokenAuth>[0];
    const res = makeRes();
    const next = vi.fn() as NextFunction;

    await requireTokenAuth(req, res, next);

    expect(res._status).toBe(401);
    expect((res._body as { error: string }).error).toMatch(/missing|invalid/i);
    expect(next).not.toHaveBeenCalled();
  });

  it('responds 401 when token is not found in DB', async () => {
    vi.mocked(getUserFromToken).mockResolvedValueOnce(null);

    const req = makeReq({ headers: { authorization: 'Bearer bad-token' } }) as Parameters<typeof requireTokenAuth>[0];
    const res = makeRes();
    const next = vi.fn() as NextFunction;

    await requireTokenAuth(req, res, next);

    expect(res._status).toBe(401);
    expect((res._body as { error: string }).error).toMatch(/invalid token/i);
    expect(next).not.toHaveBeenCalled();
  });

  it('sets authUser and calls next when token is valid', async () => {
    vi.mocked(getUserFromToken).mockResolvedValueOnce({
      id: 'user-z',
      email: 'user-z@example.com',
      name: 'User Z',
      connections: [],
    });

    const req = makeReq({ headers: { authorization: 'Bearer valid-token' } }) as Parameters<typeof requireTokenAuth>[0];
    const res = makeRes();
    const next = vi.fn() as NextFunction;

    await requireTokenAuth(req, res, next);

    expect(next).toHaveBeenCalledOnce();
    expect(req.authUser).toEqual({ id: 'user-z', email: 'user-z@example.com', name: 'User Z' });
  });

  it('passes the extracted token value to getUserFromToken', async () => {
    vi.mocked(getUserFromToken).mockResolvedValueOnce({
      id: 'user-z2',
      email: 'user-z2@example.com',
      name: null,
      connections: [],
    });

    const req = makeReq({ headers: { authorization: 'Bearer specific-token-value' } }) as Parameters<typeof requireTokenAuth>[0];
    const res = makeRes();
    const next = vi.fn() as NextFunction;

    await requireTokenAuth(req, res, next);

    expect(getUserFromToken).toHaveBeenCalledWith('specific-token-value');
  });

  it('preserves null name on authUser when user has no display name', async () => {
    vi.mocked(getUserFromToken).mockResolvedValueOnce({
      id: 'user-z3',
      email: 'user-z3@example.com',
      name: null,
      connections: [],
    });

    const req = makeReq({ headers: { authorization: 'Bearer tok' } }) as Parameters<typeof requireTokenAuth>[0];
    const res = makeRes();
    const next = vi.fn() as NextFunction;

    await requireTokenAuth(req, res, next);

    expect(req.authUser?.name).toBeNull();
  });
});

// ── Suite 3: Router download endpoint ────────────────────────────────────────

/**
 * Tests the download handler function directly without an HTTP server.
 * exportRouter is imported at module scope (above) so it uses the already-hoisted
 * mocks. We locate the handler on the Express Router's layer stack and call it
 * directly with fabricated req/res objects.
 */

type RouterLayer = {
  route?: {
    path: string;
    stack: { handle: (...args: unknown[]) => unknown }[];
  };
};

function findDownloadHandler(router: import('express').Router) {
  const layers = (router as unknown as { stack: RouterLayer[] }).stack;
  const layer = layers.find((l) => l.route?.path === '/exports/download/:token');
  if (!layer?.route) throw new Error('Download route not found on exportRouter');
  return layer.route.stack[0].handle;
}

describe('Router: GET /exports/download/:token', () => {
  // Pre-build a completed mock row for use across tests in this suite.
  const mockCompletedRow = {
    id: 'router-job-1',
    userId: 'user-router',
    tenantId: 'user-router',
    status: 'completed',
    filePath: '/tmp/exports/user-router/export-user-router-test.xlsx',
    fileName: 'export-user-router-test.xlsx',
    fileSizeBytes: 4096,
    downloadToken: 'router-valid-token',
    downloadExpiresAt: new Date(Date.now() + 900_000),
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  beforeEach(() => {
    resetMockQueues();
  });

  it('responds 404 for an invalid download token', async () => {
    // resolveDownloadToken will get empty results from DB
    mockQueues.selectWhere.push([]);

    const req = makeReq({ params: { token: 'completely-invalid-token' } });
    const res = makeRes();
    const handler = findDownloadHandler(exportRouter);

    await handler(req, res, vi.fn());

    expect(res._status).toBe(404);
    expect((res._body as { error: string }).error).toMatch(/invalid|expired/i);
  });

  it('calls res.download with filePath and fileName for a valid token', async () => {
    // resolveDownloadToken will find this row
    mockQueues.selectWhere.push([mockCompletedRow]);

    const req = makeReq({ params: { token: 'router-valid-token' } });
    const res = makeRes();
    const handler = findDownloadHandler(exportRouter);

    await handler(req, res, vi.fn());

    expect(res._downloadFile).toContain('.xlsx');
    expect(res._downloadName).toMatch(/\.xlsx$/);
    expect(res.setHeader).toHaveBeenCalledWith(
      'Content-Type',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
    );
  });
});
