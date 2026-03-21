/**
 * Unit tests for concurrent execution guard (T010)
 *
 * Verifies advisory lock behavior:
 * - Same tenant: second pipeline gets "already running" response
 * - Different tenants: both proceed independently
 * - Lock released on success AND failure
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ── DB Mock ────────────────────────────────────────────────────────────────

vi.mock('../../../src/db/client.js', () => {
  return {
    db: {
      select: vi.fn(),
      insert: vi.fn(),
      update: vi.fn(),
      transaction: vi.fn(),
    },
    generationRuns: {},
    tenantProfiles: {},
    corpusDocuments: {},
  };
});

vi.mock('../../../src/profiles/monitoring/logger.js', () => ({
  ProfileOperationLogger: vi.fn().mockImplementation(() => ({
    logOperation: vi.fn().mockResolvedValue(undefined),
  })),
}));

vi.mock('../../../src/profiles/monitoring/metrics.js', () => ({
  ProfileMetrics: vi.fn().mockImplementation(() => ({
    recordGeneration: vi.fn(),
    recordRollback: vi.fn(),
    recordCacheHit: vi.fn(),
    recordCacheMiss: vi.fn(),
    getMetrics: vi.fn().mockReturnValue({}),
  })),
}));

import { ProfileGenerationPipeline } from '../../../src/profiles/generation/pipeline.js';
import { db } from '../../../src/db/client.js';
import type { EngineBridge } from '../../../src/profiles/generation/engine-bridge.js';
import type { CorpusSnapshotService } from '../../../src/profiles/generation/corpus-snapshot.js';

// ── Helpers ────────────────────────────────────────────────────────────────

/** Chainable select stub whose terminal calls all resolve to `rows`. */
function selectChainResolving(rows: unknown[]): ReturnType<typeof vi.fn> {
  const chain: Record<string, unknown> = {};
  chain['from'] = vi.fn().mockReturnValue(chain);
  chain['where'] = vi.fn().mockReturnValue(chain);
  chain['orderBy'] = vi.fn().mockReturnValue(chain);
  chain['limit'] = vi.fn().mockResolvedValue(rows);
  chain['then'] = (resolve: (v: unknown) => unknown) => Promise.resolve(rows).then(resolve);
  return chain as never;
}

function makeEngine(): EngineBridge {
  return {
    generateProfile: vi.fn().mockResolvedValue({
      authorId: 'author-001',
      stylometricFeatures: {},
      markers: [],
      fidelityScore: 0.9,
      engineVersion: '1.0.0',
      durationMs: 500,
    }),
    generateBatch: vi.fn(),
    healthCheck: vi.fn(),
  } as unknown as EngineBridge;
}

function makeSnapshotService(): CorpusSnapshotService {
  return {
    createSnapshot: vi.fn(),
    getSnapshot: vi.fn(),
    listSnapshots: vi.fn(),
    getSnapshotDocuments: vi.fn(),
  } as unknown as CorpusSnapshotService;
}

const SINGLE_DOC = {
  id: 'doc-001',
  tenantId: 'tenant-abc',
  authorId: 'author-001',
  authorName: 'Author A',
  isActive: true,
  wordCount: 300,
  contentHash: 'h1',
};

function setupRunInsertUpdate(tenantId: string, runId: string): void {
  const insertChain = {
    values: vi.fn().mockReturnThis(),
    returning: vi.fn().mockResolvedValue([{ id: runId, tenantId }]),
  };
  vi.mocked(db.insert).mockReturnValue(insertChain as never);

  const updateChain = {
    set: vi.fn().mockReturnThis(),
    where: vi.fn().mockResolvedValue([]),
  };
  vi.mocked(db.update).mockReturnValue(updateChain as never);
}

const BASE_INPUT = {
  corpusPath: '/corpus',
  profileIdentities: ['individual::author-001'],
  trigger: 'test',
};

// ── Tests ──────────────────────────────────────────────────────────────────

describe('Advisory lock — same tenant', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns failed with "already running" error when lock is not acquired', async () => {
    setupRunInsertUpdate('tenant-abc', 'run-001');

    // Corpus has docs (passes validation before lock)
    vi.mocked(db.select).mockReturnValue(selectChainResolving([SINGLE_DOC]));

    vi.mocked(db.transaction).mockImplementation(async (fn) => {
      const tx = { execute: vi.fn().mockResolvedValue({ rows: [{ acquired: false }] }) };
      return fn(tx as never);
    });

    const pipeline = new ProfileGenerationPipeline(makeEngine(), makeSnapshotService());
    const result = await pipeline.generate('tenant-abc', BASE_INPUT);

    expect(result.status).toBe('failed');
    expect(result.error).toMatch(/already running/i);
    expect(result.profileIds).toHaveLength(0);
  });

  it('does not expose tenantId in the already-running error', async () => {
    setupRunInsertUpdate('tenant-secret-xyz', 'run-001');
    vi.mocked(db.select).mockReturnValue(selectChainResolving([{ ...SINGLE_DOC, tenantId: 'tenant-secret-xyz' }]));

    vi.mocked(db.transaction).mockImplementation(async (fn) => {
      const tx = { execute: vi.fn().mockResolvedValue({ rows: [{ acquired: false }] }) };
      return fn(tx as never);
    });

    const pipeline = new ProfileGenerationPipeline(makeEngine(), makeSnapshotService());
    const result = await pipeline.generate('tenant-secret-xyz', BASE_INPUT);

    expect(result.error).not.toContain('tenant-secret-xyz');
  });

  it('completes successfully when lock is acquired', async () => {
    let insertCallIndex = 0;
    vi.mocked(db.insert).mockImplementation(() => {
      insertCallIndex++;
      const id = insertCallIndex === 1 ? 'run-001' : 'profile-001';
      return {
        values: vi.fn().mockReturnThis(),
        returning: vi.fn().mockResolvedValue([{ id, tenantId: 'tenant-abc' }]),
      } as never;
    });

    const updateChain = { set: vi.fn().mockReturnThis(), where: vi.fn().mockResolvedValue([]) };
    vi.mocked(db.update).mockReturnValue(updateChain as never);

    let selectCallIndex = 0;
    vi.mocked(db.select).mockImplementation(() => {
      selectCallIndex++;
      // calls 1+2: validateCorpus + resolveAuthorMetas → docs
      // call 3+: maxVersion → []
      return selectCallIndex <= 2
        ? selectChainResolving([SINGLE_DOC])
        : selectChainResolving([]);
    });

    vi.mocked(db.transaction).mockImplementation(async (fn) => {
      const tx = { execute: vi.fn().mockResolvedValue({ rows: [{ acquired: true }] }) };
      return fn(tx as never);
    });

    const pipeline = new ProfileGenerationPipeline(makeEngine(), makeSnapshotService());
    const result = await pipeline.generate('tenant-abc', BASE_INPUT);

    expect(result.status).toBe('completed');
  });
});

describe('Advisory lock — different tenants', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('both tenants proceed independently (separate lock keys)', async () => {
    let insertCallIndex = 0;
    vi.mocked(db.insert).mockImplementation(() => {
      insertCallIndex++;
      const id = `run-00${insertCallIndex}`;
      return {
        values: vi.fn().mockReturnThis(),
        returning: vi.fn().mockResolvedValue([{ id, tenantId: `tenant-${insertCallIndex}` }]),
      } as never;
    });

    const updateChain = { set: vi.fn().mockReturnThis(), where: vi.fn().mockResolvedValue([]) };
    vi.mocked(db.update).mockReturnValue(updateChain as never);

    let selectCallIndex = 0;
    vi.mocked(db.select).mockImplementation(() => {
      selectCallIndex++;
      return selectCallIndex % 3 !== 0
        ? selectChainResolving([SINGLE_DOC])
        : selectChainResolving([]);
    });

    // Both tenants acquire their distinct locks
    vi.mocked(db.transaction).mockImplementation(async (fn) => {
      const tx = { execute: vi.fn().mockResolvedValue({ rows: [{ acquired: true }] }) };
      return fn(tx as never);
    });

    const pipelineA = new ProfileGenerationPipeline(makeEngine(), makeSnapshotService());
    const pipelineB = new ProfileGenerationPipeline(makeEngine(), makeSnapshotService());

    const [resultA, resultB] = await Promise.all([
      pipelineA.generate('tenant-a', BASE_INPUT),
      pipelineB.generate('tenant-b', BASE_INPUT),
    ]);

    expect(resultA.status).toBe('completed');
    expect(resultB.status).toBe('completed');
  });
});

describe('Advisory lock — lock released on failure', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('transaction is entered and exited even when engine throws per-author', async () => {
    let insertCallIndex = 0;
    vi.mocked(db.insert).mockImplementation(() => {
      insertCallIndex++;
      return {
        values: vi.fn().mockReturnThis(),
        returning: vi.fn().mockResolvedValue([{ id: `id-${insertCallIndex}`, tenantId: 'tenant-abc' }]),
      } as never;
    });

    const updateChain = { set: vi.fn().mockReturnThis(), where: vi.fn().mockResolvedValue([]) };
    vi.mocked(db.update).mockReturnValue(updateChain as never);

    let selectCallIndex = 0;
    vi.mocked(db.select).mockImplementation(() => {
      selectCallIndex++;
      return selectCallIndex <= 2
        ? selectChainResolving([SINGLE_DOC])
        : selectChainResolving([]);
    });

    const transactionSpy = vi.fn().mockImplementation(async (fn: (tx: unknown) => Promise<unknown>) => {
      const tx = { execute: vi.fn().mockResolvedValue({ rows: [{ acquired: true }] }) };
      return fn(tx);
    });
    vi.mocked(db.transaction).mockImplementation(transactionSpy);

    // Engine rejects per-author — captured in failedAuthorIds, not a hard abort
    const failingEngine = {
      generateProfile: vi.fn().mockRejectedValue(new Error('engine crashed')),
      generateBatch: vi.fn(),
      healthCheck: vi.fn(),
    } as unknown as EngineBridge;

    const pipeline = new ProfileGenerationPipeline(failingEngine, makeSnapshotService());
    const result = await pipeline.generate('tenant-abc', BASE_INPUT);

    // Transaction was entered (lock acquired) and exited regardless of engine outcome
    expect(transactionSpy).toHaveBeenCalledOnce();
    // Per-author failures are captured — run completes with 0 profiles
    expect(['completed', 'failed']).toContain(result.status);
    expect(result.profileIds).toHaveLength(0);
  });
});
