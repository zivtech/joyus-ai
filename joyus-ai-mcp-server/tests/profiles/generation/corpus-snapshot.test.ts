/**
 * Unit tests for profiles/generation/corpus-snapshot.ts
 *
 * Uses a stub DB interface — no real database connections.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ── Stub DB ────────────────────────────────────────────────────────────────
//
// We mock the db/client module so CorpusSnapshotService never touches Postgres.

vi.mock('../../../src/db/client.js', () => {
  const mockSelect = vi.fn();
  const mockInsert = vi.fn();

  // Chainable select stub
  const selectChain = {
    from: vi.fn().mockReturnThis(),
    where: vi.fn().mockReturnThis(),
    orderBy: vi.fn().mockReturnThis(),
    limit: vi.fn().mockReturnThis(),
    offset: vi.fn().mockResolvedValue([]),
  };

  mockSelect.mockReturnValue(selectChain);

  // Chainable insert stub
  const insertChain = {
    values: vi.fn().mockReturnThis(),
    returning: vi.fn().mockResolvedValue([]),
  };
  mockInsert.mockReturnValue(insertChain);

  return {
    db: { select: mockSelect, insert: mockInsert },
    // Re-export schema tables as empty objects (structural only)
    corpusSnapshots: {},
    corpusDocuments: {},
  };
});

import { CorpusSnapshotService } from '../../../src/profiles/generation/corpus-snapshot.js';
import { db } from '../../../src/db/client.js';

// ── Helpers ────────────────────────────────────────────────────────────────

function makeSnapshot(overrides: Record<string, unknown> = {}) {
  return {
    id: 'snap-001',
    tenantId: 'tenant-abc',
    name: 'snapshot-2026',
    documentHashes: ['hash1', 'hash2'],
    documentCount: 2,
    authorCount: 1,
    totalWordCount: 500,
    createdAt: new Date(),
    ...overrides,
  };
}

function makeDoc(overrides: Record<string, unknown> = {}) {
  return {
    id: 'doc-001',
    tenantId: 'tenant-abc',
    contentHash: 'hash1',
    originalFilename: 'sample.txt',
    format: 'txt',
    authorId: 'author-001',
    authorName: 'Author A',
    wordCount: 250,
    isActive: true,
    dataTier: 1,
    metadata: {},
    createdAt: new Date(),
    ...overrides,
  };
}

// ── Tests ──────────────────────────────────────────────────────────────────

describe('CorpusSnapshotService.createSnapshot', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('throws when tenantId is empty', async () => {
    const svc = new CorpusSnapshotService();
    await expect(svc.createSnapshot('')).rejects.toThrow('tenantId is required');
  });

  it('inserts a snapshot and returns the row', async () => {
    const mockDocs = [makeDoc(), makeDoc({ id: 'doc-002', contentHash: 'hash2', wordCount: 250 })];
    const snap = makeSnapshot();

    const selectChain = {
      from: vi.fn().mockReturnThis(),
      where: vi.fn().mockResolvedValue(mockDocs),
      orderBy: vi.fn().mockReturnThis(),
      limit: vi.fn().mockReturnThis(),
      offset: vi.fn().mockResolvedValue([]),
    };
    vi.mocked(db.select).mockReturnValue(selectChain as never);

    const insertChain = {
      values: vi.fn().mockReturnThis(),
      returning: vi.fn().mockResolvedValue([snap]),
    };
    vi.mocked(db.insert).mockReturnValue(insertChain as never);

    const svc = new CorpusSnapshotService();
    const result = await svc.createSnapshot('tenant-abc');

    expect(result.tenantId).toBe('tenant-abc');
    expect(insertChain.values).toHaveBeenCalledOnce();
  });
});

describe('CorpusSnapshotService.getSnapshot', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns null when snapshot not found', async () => {
    const selectChain = {
      from: vi.fn().mockReturnThis(),
      where: vi.fn().mockReturnThis(),
      limit: vi.fn().mockResolvedValue([]),
    };
    vi.mocked(db.select).mockReturnValue(selectChain as never);

    const svc = new CorpusSnapshotService();
    const result = await svc.getSnapshot('tenant-abc', 'missing-id');
    expect(result).toBeNull();
  });

  it('throws when tenantId is empty', async () => {
    const svc = new CorpusSnapshotService();
    await expect(svc.getSnapshot('', 'snap-001')).rejects.toThrow('tenantId is required');
  });

  it('returns snapshot when found', async () => {
    const snap = makeSnapshot();
    const selectChain = {
      from: vi.fn().mockReturnThis(),
      where: vi.fn().mockReturnThis(),
      limit: vi.fn().mockResolvedValue([snap]),
    };
    vi.mocked(db.select).mockReturnValue(selectChain as never);

    const svc = new CorpusSnapshotService();
    const result = await svc.getSnapshot('tenant-abc', 'snap-001');
    expect(result?.id).toBe('snap-001');
  });
});

describe('CorpusSnapshotService.listSnapshots', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns empty array when no snapshots exist', async () => {
    const selectChain = {
      from: vi.fn().mockReturnThis(),
      where: vi.fn().mockReturnThis(),
      orderBy: vi.fn().mockReturnThis(),
      limit: vi.fn().mockReturnThis(),
      offset: vi.fn().mockResolvedValue([]),
    };
    vi.mocked(db.select).mockReturnValue(selectChain as never);

    const svc = new CorpusSnapshotService();
    const result = await svc.listSnapshots('tenant-abc');
    expect(result).toEqual([]);
  });

  it('throws when tenantId is empty', async () => {
    const svc = new CorpusSnapshotService();
    await expect(svc.listSnapshots('')).rejects.toThrow('tenantId is required');
  });
});

describe('CorpusSnapshotService.getSnapshotDocuments', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns empty array when snapshot not found', async () => {
    // getSnapshot returns null
    const selectChain = {
      from: vi.fn().mockReturnThis(),
      where: vi.fn().mockReturnThis(),
      limit: vi.fn().mockResolvedValue([]),
    };
    vi.mocked(db.select).mockReturnValue(selectChain as never);

    const svc = new CorpusSnapshotService();
    const result = await svc.getSnapshotDocuments('tenant-abc', 'missing');
    expect(result).toEqual([]);
  });

  it('filters documents to snapshot hashes', async () => {
    const snap = makeSnapshot({ documentHashes: ['hash1'] });
    const doc1 = makeDoc({ contentHash: 'hash1' });
    const doc2 = makeDoc({ id: 'doc-002', contentHash: 'hash2' });

    let callIndex = 0;
    vi.mocked(db.select).mockImplementation(() => {
      callIndex++;
      if (callIndex === 1) {
        // getSnapshot call
        return {
          from: vi.fn().mockReturnThis(),
          where: vi.fn().mockReturnThis(),
          limit: vi.fn().mockResolvedValue([snap]),
        } as never;
      }
      // getSnapshotDocuments call
      return {
        from: vi.fn().mockReturnThis(),
        where: vi.fn().mockResolvedValue([doc1, doc2]),
      } as never;
    });

    const svc = new CorpusSnapshotService();
    const result = await svc.getSnapshotDocuments('tenant-abc', 'snap-001');
    expect(result).toHaveLength(1);
    expect(result[0]?.contentHash).toBe('hash1');
  });
});

describe('CorpusSnapshotService.hashContent', () => {
  it('returns a hex string', () => {
    const hash = CorpusSnapshotService.hashContent('hello world');
    expect(hash).toMatch(/^[a-f0-9]{64}$/);
  });

  it('produces deterministic output', () => {
    const a = CorpusSnapshotService.hashContent('test');
    const b = CorpusSnapshotService.hashContent('test');
    expect(a).toBe(b);
  });

  it('produces different hashes for different content', () => {
    const a = CorpusSnapshotService.hashContent('content-a');
    const b = CorpusSnapshotService.hashContent('content-b');
    expect(a).not.toBe(b);
  });
});
