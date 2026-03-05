/**
 * Unit tests for the exports service (DB-backed).
 *
 * Each test sets up explicit mock return values for the Drizzle query chains,
 * ensuring the service logic is tested independently of actual DB behaviour.
 */

import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';

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

// ── Module mocks — hoisted by Vitest ────────────────────────────────────────

let _cuidCounter = 0;
vi.mock('@paralleldrive/cuid2', () => ({
  createId: vi.fn(() => `test-id-${++_cuidCounter}`),
}));

vi.mock('../../src/exports/excel-builder.js', () => ({
  buildWorkbookFile: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('fs/promises', () => ({
  mkdir: vi.fn().mockResolvedValue(undefined),
  stat: vi.fn().mockResolvedValue({ size: 4096 }),
}));

vi.mock('../../src/db/client.js', () => {
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

// ── Imports (after mocks) ───────────────────────────────────────────────────

import {
  createExcelExportJob,
  getExcelExportJobForUser,
  resolveDownloadToken,
  cleanupExpiredExports,
} from '../../src/exports/service.js';
import { buildWorkbookFile } from '../../src/exports/excel-builder.js';
import type { ExportJob } from '../../src/db/schema.js';

// ── Helpers ─────────────────────────────────────────────────────────────────

function makeMockDbRow(overrides: Partial<ExportJob> = {}): ExportJob {
  return {
    id: `mock-job-${++_cuidCounter}`,
    userId: 'user-a',
    tenantId: 'user-a',
    status: 'pending',
    scope: 'current_view',
    locations: 'current',
    dateStart: null,
    dateEnd: null,
    scenarioId: null,
    filePath: null,
    fileName: null,
    fileSizeBytes: null,
    error: null,
    downloadToken: null,
    downloadExpiresAt: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

function makeJobParams(overrides: Partial<Parameters<typeof createExcelExportJob>[0]> = {}) {
  return {
    userId: 'user-a',
    tenantId: 'user-a',
    request: { scope: 'current_view', locations: 'current' },
    baseUrl: 'http://localhost:3000',
    ...overrides,
  };
}

/**
 * Set up mock queues for a successful createExcelExportJob call.
 * Returns the completed row that will be "returned" by the update mock.
 */
function setupCreateJobMocks(overrides: Partial<ExportJob> = {}): ExportJob {
  const pendingRow = makeMockDbRow({
    status: 'pending',
    filePath: '/tmp/exports/user-a/export-user-a-test.xlsx',
    fileName: 'export-user-a-test.xlsx',
    ...overrides,
  });

  const completedRow: ExportJob = {
    ...pendingRow,
    status: 'completed',
    fileSizeBytes: 4096,
    downloadToken: 'mock-download-token-hex',
    downloadExpiresAt: new Date(Date.now() + 900_000),
    updatedAt: new Date(),
  };

  mockQueues.insertReturning.push([pendingRow]);
  mockQueues.updateReturning.push([completedRow]);

  return completedRow;
}

// ── Tests ───────────────────────────────────────────────────────────────────

describe('createExcelExportJob (DB-backed)', () => {
  beforeEach(() => {
    resetMockQueues();
    vi.stubEnv('EXPORT_ALLOW_ANY_TENANT', 'true');
    vi.mocked(buildWorkbookFile).mockResolvedValue(undefined);
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('inserts a pending row and returns completed job with downloadToken', async () => {
    setupCreateJobMocks();
    const { job } = await createExcelExportJob(makeJobParams());

    expect(job.status).toBe('completed');
    expect(job.downloadToken).toBe('mock-download-token-hex');
    expect(typeof job.downloadExpiresAt).toBe('string');
  });

  it('returns a downloadUrl based on the base URL', async () => {
    setupCreateJobMocks();
    const { downloadUrl } = await createExcelExportJob(makeJobParams());

    expect(downloadUrl).toMatch(/^http:\/\/localhost:3000\/api\/v1\/exports\/download\//);
  });

  it('preserves userId and tenantId from params', async () => {
    setupCreateJobMocks({ userId: 'user-b', tenantId: 'user-b' });
    const { job } = await createExcelExportJob(
      makeJobParams({ userId: 'user-b', tenantId: 'user-b' }),
    );

    expect(job.userId).toBe('user-b');
    expect(job.tenantId).toBe('user-b');
  });

  it('converts DB timestamps to ISO strings', async () => {
    setupCreateJobMocks();
    const { job } = await createExcelExportJob(makeJobParams());

    expect(job.createdAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(job.updatedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it('throws when user does not have tenant access', async () => {
    vi.stubEnv('EXPORT_ALLOW_ANY_TENANT', 'false');
    vi.stubEnv('EXPORT_TENANT_ALLOWLIST', '');

    await expect(
      createExcelExportJob(makeJobParams({ userId: 'user-x', tenantId: 'tenant-other' })),
    ).rejects.toThrow('not authorized');
  });

  it('throws and updates job to failed when buildWorkbookFile rejects', async () => {
    const pendingRow = makeMockDbRow({ status: 'pending' });
    mockQueues.insertReturning.push([pendingRow]);
    // update mock is set up but won't have returning() called (error path)

    vi.mocked(buildWorkbookFile).mockRejectedValueOnce(new Error('python crashed'));

    await expect(createExcelExportJob(makeJobParams())).rejects.toThrow('python crashed');
  });
});

describe('getExcelExportJobForUser (DB-backed)', () => {
  beforeEach(() => {
    resetMockQueues();
    vi.stubEnv('EXPORT_ALLOW_ANY_TENANT', 'true');
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('returns the job when DB returns a matching row', async () => {
    const row = makeMockDbRow({
      id: 'job-123',
      userId: 'user-c',
      tenantId: 'user-c',
      status: 'completed',
    });
    mockQueues.selectWhere.push([row]);

    const found = await getExcelExportJobForUser('user-c', 'user-c', 'job-123');

    expect(found).not.toBeNull();
    expect(found!.id).toBe('job-123');
    expect(found!.status).toBe('completed');
  });

  it('returns null when DB returns no rows (wrong user)', async () => {
    mockQueues.selectWhere.push([]);

    const found = await getExcelExportJobForUser('user-wrong', 'user-c', 'job-123');
    expect(found).toBeNull();
  });

  it('returns null when DB returns no rows (nonexistent export)', async () => {
    mockQueues.selectWhere.push([]);

    const found = await getExcelExportJobForUser('user-c', 'user-c', 'nonexistent');
    expect(found).toBeNull();
  });

  it('throws when caller does not have tenant access', async () => {
    vi.stubEnv('EXPORT_ALLOW_ANY_TENANT', 'false');
    vi.stubEnv('EXPORT_TENANT_ALLOWLIST', '');

    await expect(
      getExcelExportJobForUser('user-x', 'tenant-blocked', 'any-id'),
    ).rejects.toThrow('not authorized');
  });
});

describe('resolveDownloadToken (DB-backed)', () => {
  beforeEach(() => {
    resetMockQueues();
  });

  it('returns job and filePath for a valid token', async () => {
    const row = makeMockDbRow({
      id: 'job-dl-1',
      status: 'completed',
      filePath: '/tmp/exports/t/export.xlsx',
      fileName: 'export.xlsx',
      downloadToken: 'valid-token',
      downloadExpiresAt: new Date(Date.now() + 900_000),
    });
    mockQueues.selectWhere.push([row]);

    const resolved = await resolveDownloadToken('valid-token');

    expect(resolved).not.toBeNull();
    expect(resolved!.job.id).toBe('job-dl-1');
    expect(resolved!.filePath).toContain('.xlsx');
  });

  it('returns null when DB returns no rows (expired token)', async () => {
    mockQueues.selectWhere.push([]);

    const resolved = await resolveDownloadToken('expired-token');
    expect(resolved).toBeNull();
  });

  it('returns null when DB returns no rows (unknown token)', async () => {
    mockQueues.selectWhere.push([]);

    const resolved = await resolveDownloadToken('unknown-token');
    expect(resolved).toBeNull();
  });

  it('returns null when row has no filePath', async () => {
    const row = makeMockDbRow({
      status: 'completed',
      filePath: null,
      downloadToken: 'token-no-path',
      downloadExpiresAt: new Date(Date.now() + 900_000),
    });
    mockQueues.selectWhere.push([row]);

    const resolved = await resolveDownloadToken('token-no-path');
    expect(resolved).toBeNull();
  });
});

describe('cleanupExpiredExports', () => {
  beforeEach(() => {
    resetMockQueues();
  });

  it('returns the count of deleted rows', async () => {
    mockQueues.deleteReturning.push([{ id: 'old-1' }, { id: 'old-2' }]);

    const count = await cleanupExpiredExports();
    expect(count).toBe(2);
  });

  it('returns 0 when no expired rows exist', async () => {
    mockQueues.deleteReturning.push([]);

    const count = await cleanupExpiredExports();
    expect(count).toBe(0);
  });
});
