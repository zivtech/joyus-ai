/**
 * Unit tests for profiles/generation/pipeline.ts (T009)
 *
 * Tests the core orchestration logic using stubbed engine, snapshot service,
 * DB client, and monitoring dependencies.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ── DB Mock ────────────────────────────────────────────────────────────────

vi.mock('../../../src/db/client.js', () => {
  const mockSelect = vi.fn();
  const mockInsert = vi.fn();
  const mockUpdate = vi.fn();
  const mockTransaction = vi.fn();

  return {
    db: {
      select: mockSelect,
      insert: mockInsert,
      update: mockUpdate,
      transaction: mockTransaction,
    },
    generationRuns: {},
    tenantProfiles: {},
    corpusDocuments: {},
  };
});

// ── Monitoring mocks ───────────────────────────────────────────────────────

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
import {
  EngineNotConfiguredError,
  type EngineBridge,
  type EngineResult,
} from '../../../src/profiles/generation/engine-bridge.js';
import type { CorpusSnapshotService } from '../../../src/profiles/generation/corpus-snapshot.js';

// ── Stubs ──────────────────────────────────────────────────────────────────

function makeEngineResult(authorId: string): EngineResult {
  return {
    authorId,
    stylometricFeatures: { avg_sentence_length: 0.5 },
    markers: [],
    fidelityScore: 0.88,
    engineVersion: '1.0.0',
    durationMs: 1200,
  };
}

function makeEngineBridge(authorId = 'author-001'): EngineBridge {
  return {
    generateProfile: vi.fn().mockResolvedValue(makeEngineResult(authorId)),
    generateBatch: vi.fn(),
    healthCheck: vi.fn().mockResolvedValue(true),
  } as unknown as EngineBridge;
}

function makeSnapshotService(): CorpusSnapshotService {
  return {
    createSnapshot: vi.fn().mockResolvedValue({ id: 'snap-001', tenantId: 'tenant-abc' }),
    getSnapshot: vi.fn(),
    listSnapshots: vi.fn(),
    getSnapshotDocuments: vi.fn(),
  } as unknown as CorpusSnapshotService;
}

function makePipeline(
  engine?: EngineBridge,
  snapshotService?: CorpusSnapshotService,
): ProfileGenerationPipeline {
  return new ProfileGenerationPipeline(
    engine ?? makeEngineBridge(),
    snapshotService ?? makeSnapshotService(),
  );
}

/** Chainable select stub whose `.where()` and `.limit()` both resolve to `rows`. */
function selectChainResolving(rows: unknown[]): ReturnType<typeof vi.fn> {
  const chain: Record<string, unknown> = {};
  chain['from'] = vi.fn().mockReturnValue(chain);
  chain['where'] = vi.fn().mockReturnValue(chain);
  chain['orderBy'] = vi.fn().mockReturnValue(chain);
  chain['limit'] = vi.fn().mockResolvedValue(rows);
  // Make chain itself thenable so bare `.where()` awaits resolve to rows
  chain['then'] = (resolve: (v: unknown) => unknown) => Promise.resolve(rows).then(resolve);
  return chain as never;
}

const BASE_INPUT = {
  corpusPath: '/corpus',
  profileIdentities: ['individual::author-001'],
  trigger: 'test',
};

const SINGLE_DOC = {
  id: 'doc-001',
  tenantId: 'tenant-abc',
  authorId: 'author-001',
  authorName: 'Author A',
  contentHash: 'h1',
  isActive: true,
  wordCount: 300,
};

function setupStandardInsertUpdate(): void {
  const insertChain = {
    values: vi.fn().mockReturnThis(),
    returning: vi.fn().mockResolvedValue([{ id: 'run-001', tenantId: 'tenant-abc' }]),
  };
  vi.mocked(db.insert).mockReturnValue(insertChain as never);

  const updateChain = {
    set: vi.fn().mockReturnThis(),
    where: vi.fn().mockResolvedValue([]),
  };
  vi.mocked(db.update).mockReturnValue(updateChain as never);
}

function setupTransactionWithLock(acquired: boolean): void {
  vi.mocked(db.transaction).mockImplementation(async (fn) => {
    const tx = { execute: vi.fn().mockResolvedValue({ rows: [{ acquired }] }) };
    return fn(tx as never);
  });
}

// ── Tests ──────────────────────────────────────────────────────────────────

describe('ProfileGenerationPipeline.generate', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('throws when tenantId is empty', async () => {
    const pipeline = makePipeline();
    await expect(pipeline.generate('', BASE_INPUT)).rejects.toThrow('tenantId is required');
  });

  it('returns failed status when corpus is empty', async () => {
    setupStandardInsertUpdate();
    setupTransactionWithLock(true);

    // validateCorpus: no docs
    vi.mocked(db.select).mockReturnValue(selectChainResolving([]));

    const pipeline = makePipeline();
    const result = await pipeline.generate('tenant-abc', BASE_INPUT);

    expect(result.status).toBe('failed');
    expect(result.error).toMatch(/corpus/i);
  });

  it('returns completed status when engine succeeds', async () => {
    setupStandardInsertUpdate();
    setupTransactionWithLock(true);

    let selectCallIndex = 0;
    vi.mocked(db.select).mockImplementation(() => {
      selectCallIndex++;
      // call 1: validateCorpus → 1 doc
      // call 2: resolveAuthorMetas → docs list
      // call 3: maxVersion query → empty (version = 1)
      // call 4: insert profile returning → handled by insert mock
      if (selectCallIndex <= 2) {
        return selectChainResolving([SINGLE_DOC]);
      }
      // maxVersion query — resolves to [] (no prior version)
      return selectChainResolving([]);
    });

    // Second insert call (profile insert) also returns a profile row
    let insertCallIndex = 0;
    vi.mocked(db.insert).mockImplementation(() => {
      insertCallIndex++;
      const id = insertCallIndex === 1 ? 'run-001' : 'profile-001';
      return {
        values: vi.fn().mockReturnThis(),
        returning: vi.fn().mockResolvedValue([{ id, tenantId: 'tenant-abc' }]),
      } as never;
    });

    const updateChain = {
      set: vi.fn().mockReturnThis(),
      where: vi.fn().mockResolvedValue([]),
    };
    vi.mocked(db.update).mockReturnValue(updateChain as never);

    const engine = makeEngineBridge();
    const pipeline = makePipeline(engine);
    const result = await pipeline.generate('tenant-abc', BASE_INPUT);

    expect(result.status).toBe('completed');
    expect(vi.mocked(db.update)).toHaveBeenCalledTimes(3);
  });

  it('marks the run failed when the engine fails for every requested profile', async () => {
    setupStandardInsertUpdate();
    setupTransactionWithLock(true);

    let selectCallIndex = 0;
    vi.mocked(db.select).mockImplementation(() => {
      selectCallIndex++;
      if (selectCallIndex <= 2) {
        return selectChainResolving([SINGLE_DOC]);
      }
      return selectChainResolving([]);
    });

    const engine = {
      generateProfile: vi.fn().mockRejectedValue(new Error('engine unavailable')),
      generateBatch: vi.fn(),
      healthCheck: vi.fn().mockResolvedValue(false),
    } as unknown as EngineBridge;

    const pipeline = makePipeline(engine);
    const result = await pipeline.generate('tenant-abc', BASE_INPUT);

    expect(result.status).toBe('failed');
    expect(result.profileIds).toEqual([]);
    expect(result.error).toMatch(/failed for 1 of 1/i);
  });

  it('fails clearly without creating profiles when the engine is not configured', async () => {
    setupStandardInsertUpdate();
    setupTransactionWithLock(true);
    const updateChain = {
      set: vi.fn().mockReturnThis(),
      where: vi.fn().mockResolvedValue([]),
    };
    vi.mocked(db.update).mockReturnValue(updateChain as never);

    let selectCallIndex = 0;
    vi.mocked(db.select).mockImplementation(() => {
      selectCallIndex++;
      if (selectCallIndex <= 2) {
        return selectChainResolving([SINGLE_DOC]);
      }
      return selectChainResolving([]);
    });

    const engine = {
      generateProfile: vi.fn().mockRejectedValue(new EngineNotConfiguredError()),
      generateBatch: vi.fn(),
      healthCheck: vi.fn().mockResolvedValue(false),
    } as unknown as EngineBridge;

    const pipeline = makePipeline(engine);
    const result = await pipeline.generate('tenant-abc', BASE_INPUT);

    expect(result.status).toBe('failed');
    expect(result.profileIds).toEqual([]);
    expect(result.error).toMatch(/not configured/i);
    expect(db.insert).toHaveBeenCalledTimes(1);
    expect(updateChain.set).toHaveBeenCalledWith(
      expect.objectContaining({
        status: 'failed',
        profilesCompleted: 0,
        profilesFailed: 1,
        profileIds: [],
      }),
    );
  });

  it('uses the selected corpus snapshot documents when resolving authors', async () => {
    setupStandardInsertUpdate();
    setupTransactionWithLock(true);
    vi.mocked(db.select).mockReturnValue(selectChainResolving([]));

    let insertCallIndex = 0;
    vi.mocked(db.insert).mockImplementation(() => {
      insertCallIndex++;
      const id = insertCallIndex === 1 ? 'run-001' : 'profile-001';
      return {
        values: vi.fn().mockReturnThis(),
        returning: vi.fn().mockResolvedValue([{ id, tenantId: 'tenant-abc' }]),
      } as never;
    });

    const snapshotDoc = {
      ...SINGLE_DOC,
      authorId: 'author-999',
      authorName: 'Snapshot Author',
    };
    const snapshotService = {
      createSnapshot: vi.fn(),
      getSnapshot: vi.fn(),
      listSnapshots: vi.fn(),
      getSnapshotDocuments: vi.fn().mockResolvedValue([snapshotDoc]),
    } as unknown as CorpusSnapshotService;
    const engine = makeEngineBridge('author-999');
    const pipeline = makePipeline(engine, snapshotService);

    const result = await pipeline.generate('tenant-abc', {
      ...BASE_INPUT,
      corpusSnapshotId: 'snap-001',
      profileIdentities: ['individual::author-999'],
    });

    expect(result.status).toBe('completed');
    expect(snapshotService.getSnapshotDocuments).toHaveBeenCalledWith('tenant-abc', 'snap-001');
    expect(engine.generateProfile).toHaveBeenCalledWith(
      '/corpus',
      'author-999',
      {},
    );
  });

  it('does not include tenantId in user-facing error messages', async () => {
    setupStandardInsertUpdate();

    // Corpus has docs (passes validation)
    vi.mocked(db.select).mockReturnValue(selectChainResolving([SINGLE_DOC]));

    // Lock not acquired → already running
    setupTransactionWithLock(false);

    const pipeline = makePipeline();
    const result = await pipeline.generate('tenant-secret-id', BASE_INPUT);

    expect(result.error).not.toContain('tenant-secret-id');
  });

  it('handles single-author corpus (lowConfidence flag in metadata)', async () => {
    setupStandardInsertUpdate();
    setupTransactionWithLock(true);

    let selectCallIndex = 0;
    vi.mocked(db.select).mockImplementation(() => {
      selectCallIndex++;
      if (selectCallIndex <= 2) {
        return selectChainResolving([SINGLE_DOC]);
      }
      return selectChainResolving([]);
    });

    let insertCallIndex = 0;
    vi.mocked(db.insert).mockImplementation(() => {
      insertCallIndex++;
      const id = insertCallIndex === 1 ? 'run-001' : 'profile-001';
      return {
        values: vi.fn().mockReturnThis(),
        returning: vi.fn().mockResolvedValue([{ id, tenantId: 'tenant-abc' }]),
      } as never;
    });

    const updateChain = {
      set: vi.fn().mockReturnThis(),
      where: vi.fn().mockResolvedValue([]),
    };
    vi.mocked(db.update).mockReturnValue(updateChain as never);

    const engine = makeEngineBridge();
    const pipeline = makePipeline(engine);
    const result = await pipeline.generate('tenant-abc', {
      ...BASE_INPUT,
      profileIdentities: ['individual::author-001'],
    });

    // lowConfidence doesn't cause failure
    expect(result.status).toBe('completed');
  });
});

describe('ProfileGenerationPipeline.getRunStatus', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns null when run not found', async () => {
    vi.mocked(db.select).mockReturnValue(selectChainResolving([]));

    const pipeline = makePipeline();
    const result = await pipeline.getRunStatus('tenant-abc', 'missing-run');
    expect(result).toBeNull();
  });

  it('returns the run record when found', async () => {
    const run = { id: 'run-001', tenantId: 'tenant-abc', status: 'completed' };
    vi.mocked(db.select).mockReturnValue(selectChainResolving([run]));

    const pipeline = makePipeline();
    const result = await pipeline.getRunStatus('tenant-abc', 'run-001');
    expect(result?.id).toBe('run-001');
  });

  it('throws when tenantId is empty', async () => {
    const pipeline = makePipeline();
    await expect(pipeline.getRunStatus('', 'run-001')).rejects.toThrow('tenantId is required');
  });
});
