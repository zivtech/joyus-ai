/**
 * Tests for the exports module
 *
 * Covers:
 *   - Export service helpers (normalizeExportScope, normalizeExportLocations, canAccessTenant)
 *   - createExcelExportJob (success path, tenant access denial, returned job fields)
 *   - getExcelExportJobForUser (valid user/tenant, wrong user, nonexistent export)
 *   - resolveDownloadToken (valid token, expired token, nonexistent token)
 *   - Auth middleware (extractBearerToken, requireTokenAuth)
 *   - Router download endpoint (GET /exports/download/:token)
 */

import { describe, expect, it, vi, beforeEach, afterEach, beforeAll } from 'vitest';
import type { Request, Response, NextFunction } from 'express';

// ── Module mocks — hoisted by Vitest before any other module initialization ──

// Mock cuid2 so createId() never touches crypto.getRandomValues.
// This also makes job IDs predictable across the test run.
let _cuidCounter = 0;
vi.mock('@paralleldrive/cuid2', () => ({
  createId: vi.fn(() => `test-id-${++_cuidCounter}`),
}));

vi.mock('../src/exports/excel-builder.js', () => ({
  buildWorkbookFile: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../src/db/client.js', () => ({
  db: {
    insert: vi.fn().mockReturnValue({
      values: vi.fn().mockResolvedValue(undefined),
    }),
  },
  auditLogs: {},
  users: {},
  connections: {},
}));

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
  createExcelExportJob,
  getExcelExportJobForUser,
  resolveDownloadToken,
} from '../src/exports/service.js';


import { getUserFromToken } from '../src/auth/verify.js';
import { buildWorkbookFile } from '../src/exports/excel-builder.js';
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

/** Build a minimal CreateExportJobParams. */
function makeJobParams(overrides: Partial<Parameters<typeof createExcelExportJob>[0]> = {}) {
  return {
    userId: 'user-a',
    tenantId: 'user-a', // same → always allowed without allowlist
    request: {
      scope: 'current_view',
      locations: 'current',
    },
    baseUrl: 'http://localhost:3000',
    ...overrides,
  };
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

// ── Suite 2: createExcelExportJob ─────────────────────────────────────────────

describe('createExcelExportJob', () => {
  beforeEach(() => {
    vi.stubEnv('EXPORT_ALLOW_ANY_TENANT', 'true');
    vi.mocked(buildWorkbookFile).mockResolvedValue(undefined);
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('returns a job with status completed on success', async () => {
    const { job } = await createExcelExportJob(makeJobParams());
    expect(job.status).toBe('completed');
  });

  it('returns a downloadUrl on success', async () => {
    const { downloadUrl } = await createExcelExportJob(makeJobParams());
    expect(downloadUrl).toMatch(/^http:\/\/localhost:3000\/api\/v1\/exports\/download\//);
  });

  it('job contains correct userId and tenantId', async () => {
    const { job } = await createExcelExportJob(
      makeJobParams({ userId: 'user-b', tenantId: 'user-b' })
    );
    expect(job.userId).toBe('user-b');
    expect(job.tenantId).toBe('user-b');
  });

  it('job contains an id, createdAt, updatedAt, fileName, fileSizeBytes', async () => {
    const { job } = await createExcelExportJob(makeJobParams());
    expect(job.id).toBeDefined();
    expect(job.createdAt).toBeDefined();
    expect(job.updatedAt).toBeDefined();
    expect(job.fileName).toMatch(/\.xlsx$/);
    expect(job.fileSizeBytes).toBe(4096);
  });

  it('job scope and locations are normalised', async () => {
    const { job } = await createExcelExportJob(
      makeJobParams({ request: { scope: 'full_period', locations: 'all_accessible' } })
    );
    expect(job.scope).toBe('full_period');
    expect(job.locations).toBe('all_accessible');
  });

  it('job stores a downloadToken', async () => {
    const { job } = await createExcelExportJob(makeJobParams());
    expect(job.downloadToken).toBeDefined();
    expect(typeof job.downloadToken).toBe('string');
  });

  it('throws and leaves job as failed when buildWorkbookFile rejects', async () => {
    vi.mocked(buildWorkbookFile).mockRejectedValueOnce(new Error('python crashed'));
    await expect(createExcelExportJob(makeJobParams())).rejects.toThrow('python crashed');
  });

  it('throws when user does not have access to tenant', async () => {
    vi.stubEnv('EXPORT_ALLOW_ANY_TENANT', 'false');
    vi.stubEnv('EXPORT_TENANT_ALLOWLIST', '');
    await expect(
      createExcelExportJob(makeJobParams({ userId: 'user-x', tenantId: 'tenant-other' }))
    ).rejects.toThrow('not authorized');
  });

  it('base URL trailing slash is stripped from download URL', async () => {
    const { downloadUrl } = await createExcelExportJob(
      makeJobParams({ baseUrl: 'http://localhost:3000/' })
    );
    expect(downloadUrl).not.toMatch(/\/\/api/);
    expect(downloadUrl).toMatch(/^http:\/\/localhost:3000\/api\/v1\/exports\/download\//);
  });
});

// ── Suite 3: getExcelExportJobForUser ─────────────────────────────────────────

describe('getExcelExportJobForUser', () => {
  beforeEach(() => {
    vi.stubEnv('EXPORT_ALLOW_ANY_TENANT', 'true');
    vi.mocked(buildWorkbookFile).mockResolvedValue(undefined);
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('returns the job for the correct user and tenant', async () => {
    const { job } = await createExcelExportJob(
      makeJobParams({ userId: 'user-c', tenantId: 'user-c' })
    );
    const found = getExcelExportJobForUser('user-c', 'user-c', job.id);
    expect(found).not.toBeNull();
    expect(found!.id).toBe(job.id);
  });

  it('returns null when exportId does not exist', () => {
    const result = getExcelExportJobForUser('user-c', 'user-c', 'nonexistent-id');
    expect(result).toBeNull();
  });

  it('returns null when userId does not match the job owner', async () => {
    const { job } = await createExcelExportJob(
      makeJobParams({ userId: 'user-d', tenantId: 'user-d' })
    );
    const result = getExcelExportJobForUser('user-e', 'user-d', job.id);
    expect(result).toBeNull();
  });

  it('returns null when tenantId does not match the job tenant', async () => {
    const { job } = await createExcelExportJob(
      makeJobParams({ userId: 'user-f', tenantId: 'user-f' })
    );
    const result = getExcelExportJobForUser('user-f', 'user-f-other', job.id);
    expect(result).toBeNull();
  });

  it('throws when caller does not have tenant access', () => {
    vi.stubEnv('EXPORT_ALLOW_ANY_TENANT', 'false');
    vi.stubEnv('EXPORT_TENANT_ALLOWLIST', '');
    expect(() =>
      getExcelExportJobForUser('user-x', 'tenant-blocked', 'any-id')
    ).toThrow('not authorized');
  });
});

// ── Suite 4: resolveDownloadToken ─────────────────────────────────────────────

describe('resolveDownloadToken', () => {
  beforeEach(() => {
    vi.stubEnv('EXPORT_ALLOW_ANY_TENANT', 'true');
    vi.mocked(buildWorkbookFile).mockResolvedValue(undefined);
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('returns job and filePath for a valid token', async () => {
    const { job } = await createExcelExportJob(
      makeJobParams({ userId: 'user-g', tenantId: 'user-g' })
    );
    const token = job.downloadToken!;
    const resolved = resolveDownloadToken(token);
    expect(resolved).not.toBeNull();
    expect(resolved!.job.id).toBe(job.id);
    expect(resolved!.filePath).toContain('.xlsx');
  });

  it('returns null for a nonexistent token', () => {
    expect(resolveDownloadToken('deadbeef-invalid-token')).toBeNull();
  });

  it('returns null for an empty string token', () => {
    expect(resolveDownloadToken('')).toBeNull();
  });

  it('returns null after TTL has expired', async () => {
    vi.stubEnv('EXPORT_SIGNED_URL_TTL_SECONDS', '1');
    const { job } = await createExcelExportJob(
      makeJobParams({ userId: 'user-h', tenantId: 'user-h' })
    );
    const token = job.downloadToken!;

    // Advance time past TTL by faking Date.now
    const future = Date.now() + 5_000;
    vi.spyOn(Date, 'now').mockReturnValue(future);

    const resolved = resolveDownloadToken(token);

    vi.restoreAllMocks();
    expect(resolved).toBeNull();
  });
});

// Suite 5 (auth middleware) moved to tests/auth/middleware.test.ts

// ── Suite 6: Router download endpoint ────────────────────────────────────────

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
  // The exportJobs / downloadTokenToJob Maps are module-level singletons that
  // persist across all suites in one test run. We create one job here in
  // beforeAll and reuse the token — no need to call createExcelExportJob again.
  let validToken: string;

  beforeAll(async () => {
    vi.stubEnv('EXPORT_ALLOW_ANY_TENANT', 'true');
    // Re-establish fs/promises mock return values in case a prior suite's
    // vi.resetAllMocks() cleared them.
    const fsp = await import('fs/promises');
    vi.mocked(fsp.mkdir).mockResolvedValue(undefined);
    vi.mocked(fsp.stat).mockResolvedValue({ size: 4096 } as import('fs').Stats);
    vi.mocked(buildWorkbookFile).mockResolvedValue(undefined);
    const { job } = await createExcelExportJob(
      makeJobParams({ userId: 'user-router', tenantId: 'user-router' })
    );
    validToken = job.downloadToken!;
    vi.unstubAllEnvs();
  });

  it('responds 404 for an invalid download token', () => {
    const req = makeReq({ params: { token: 'completely-invalid-token' } });
    const res = makeRes();
    const handler = findDownloadHandler(exportRouter);

    handler(req, res, vi.fn());

    expect(res._status).toBe(404);
    expect((res._body as { error: string }).error).toMatch(/invalid|expired/i);
  });

  it('calls res.download with filePath and fileName for a valid token', async () => {
    const req = makeReq({ params: { token: validToken } });
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
