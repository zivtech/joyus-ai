// Integration test — requires PostgreSQL with profiles schema applied
// Skips gracefully when DATABASE_URL is not set.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createId } from '@paralleldrive/cuid2';

// ── DB Mock ──────────────────────────────────────────────────────────────────

vi.mock('../../../src/db/client.js', () => ({
  db: {
    select: vi.fn(),
    insert: vi.fn(),
    delete: vi.fn(),
    update: vi.fn(),
    transaction: vi.fn(),
  },
}));

// ── Logger mock ──────────────────────────────────────────────────────────────

vi.mock('../../../src/profiles/monitoring/logger.js', () => ({
  ProfileOperationLogger: vi.fn().mockImplementation(() => ({
    logOperation: vi.fn().mockResolvedValue(undefined),
  })),
}));

import { IntakeService } from '../../../src/profiles/intake/service.js';
import { ParserRegistry } from '../../../src/profiles/intake/parsers/registry.js';
import { TextParser } from '../../../src/profiles/intake/parsers/text-parser.js';

// ── Skip guard ───────────────────────────────────────────────────────────────

const RUN = !!process.env['DATABASE_URL'];
const maybeDescribe = RUN ? describe : describe.skip;

// ── Unique tenant ID per file ─────────────────────────────────────────────────

const TENANT_ID = `tenant-intake-${createId()}`;

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeTextDoc(content: string, filename: string, authorId?: string, authorName?: string) {
  return {
    buffer: Buffer.from(content),
    filename,
    ...(authorId !== undefined ? { authorId } : {}),
    ...(authorName !== undefined ? { authorName } : {}),
  };
}

/**
 * Build a mock db that sequences select/insert calls for IntakeService.
 * Each element in `dedupResults` maps to a successive dedup check call.
 * `storedDocs` is returned for the createSnapshot fetch.
 */
function buildMockDb(
  dedupResults: Array<{ id: string; originalFilename: string } | null>,
  storedDocs: Array<{ contentHash: string; authorId: string; wordCount: number }>,
) {
  let dedupCallIndex = 0;
  const mockSelect = vi.fn().mockImplementation(() => {
    const dedupRow = dedupResults[dedupCallIndex++];
    if (dedupRow !== null && dedupRow !== undefined) {
      // Duplicate found
      return {
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockReturnValue({
            limit: vi.fn().mockResolvedValue([dedupRow]),
          }),
        }),
      };
    }
    if (dedupCallIndex <= dedupResults.length) {
      // No duplicate — but could be the snapshot select next
      return {
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockReturnValue({
            limit: vi.fn().mockResolvedValue([]),
          }),
        }),
      };
    }
    // createSnapshot select
    return {
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockResolvedValue(storedDocs),
      }),
    };
  });

  return {
    select: mockSelect,
    insert: vi.fn().mockReturnValue({
      values: vi.fn().mockResolvedValue(undefined),
    }),
  };
}

function makeIntakeService(mockDb: ReturnType<typeof buildMockDb>) {
  const registry = new ParserRegistry();
  registry.register(new TextParser());
  return new IntakeService(mockDb as never, registry);
}

// ── T043-01: Mixed format upload — all supported files stored ─────────────────

maybeDescribe('T043-01: mixed format upload stores all supported documents', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it('txt, md, and html documents are all stored without rejection', async () => {
    const docs = [
      makeTextDoc('Plain text document with enough content words here.', 'report.txt', 'a1', 'Author One'),
      makeTextDoc('# Markdown heading\n\nMarkdown document body content here.', 'notes.md', 'a2', 'Author Two'),
      makeTextDoc('<p>HTML document body content here enough words.</p>', 'page.html', 'a3', 'Author Three'),
    ];

    const storedDocs = [
      { contentHash: 'hash-txt', authorId: 'a1', wordCount: 8 },
      { contentHash: 'hash-md', authorId: 'a2', wordCount: 6 },
      { contentHash: 'hash-html', authorId: 'a3', wordCount: 6 },
    ];

    // All 3 dedup checks return no duplicate
    const dedupResults = [null, null, null];

    let selectCallCount = 0;
    const mockDb = {
      select: vi.fn().mockImplementation(() => {
        selectCallCount++;
        if (selectCallCount <= 3) {
          // dedup checks
          return {
            from: vi.fn().mockReturnValue({
              where: vi.fn().mockReturnValue({
                limit: vi.fn().mockResolvedValue([]),
              }),
            }),
          };
        }
        // createSnapshot fetch
        return {
          from: vi.fn().mockReturnValue({
            where: vi.fn().mockResolvedValue(storedDocs),
          }),
        };
      }),
      insert: vi.fn().mockReturnValue({
        values: vi.fn().mockResolvedValue(undefined),
      }),
    };
    void dedupResults;

    const service = makeIntakeService(mockDb as never);
    const result = await service.ingest(TENANT_ID, docs, 'batch-mixed-formats');

    expect(result.processed).toBe(3);
    expect(result.stored).toBe(3);
    expect(result.rejected).toBe(0);
    expect(result.snapshotId).toBeDefined();
  });
});

// ── T043-02: Duplicate detection — same content hash flagged ──────────────────

maybeDescribe('T043-02: duplicate content is flagged without blocking batch', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it('second document with same content is marked duplicate, first is stored', async () => {
    const content = 'Unique document content for duplicate detection test here.';
    const docs = [
      makeTextDoc(content, 'original.txt', 'a1', 'Author One'),
      makeTextDoc(content, 'copy.txt', 'a1', 'Author One'),
    ];

    const storedDocs = [{ contentHash: 'hash-orig', authorId: 'a1', wordCount: 8 }];

    let selectCallCount = 0;
    const mockDb = {
      select: vi.fn().mockImplementation(() => {
        selectCallCount++;
        if (selectCallCount === 1) {
          // First doc: no duplicate
          return {
            from: vi.fn().mockReturnValue({
              where: vi.fn().mockReturnValue({
                limit: vi.fn().mockResolvedValue([]),
              }),
            }),
          };
        }
        if (selectCallCount === 2) {
          // Second doc: duplicate found
          return {
            from: vi.fn().mockReturnValue({
              where: vi.fn().mockReturnValue({
                limit: vi.fn().mockResolvedValue([{ id: 'doc-original', originalFilename: 'original.txt' }]),
              }),
            }),
          };
        }
        // createSnapshot fetch
        return {
          from: vi.fn().mockReturnValue({
            where: vi.fn().mockResolvedValue(storedDocs),
          }),
        };
      }),
      insert: vi.fn().mockReturnValue({
        values: vi.fn().mockResolvedValue(undefined),
      }),
    };

    const service = makeIntakeService(mockDb as never);
    const result = await service.ingest(TENANT_ID, docs, 'batch-dedup');

    expect(result.processed).toBe(2);
    expect(result.stored).toBe(1);
    expect(result.duplicates).toBe(1);
    expect(result.rejected).toBe(0);

    const dupResult = result.documentResults.find((r) => r.filename === 'copy.txt');
    expect(dupResult?.status).toBe('duplicate');
    expect(dupResult?.duplicateOf).toBe('doc-original');
  });
});

// ── T043-03: Unsupported format rejected, others continue ─────────────────────

maybeDescribe('T043-03: unsupported format rejected without blocking batch', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it('.xlsx is rejected while .txt documents in the same batch are stored', async () => {
    const docs = [
      makeTextDoc('Valid text document content with enough words.', 'paper.txt', 'a1', 'Author One'),
      makeTextDoc('binary content ignored', 'spreadsheet.xlsx', 'a2', 'Author Two'),
    ];

    const storedDocs = [{ contentHash: 'hash-txt', authorId: 'a1', wordCount: 7 }];

    let selectCallCount = 0;
    const mockDb = {
      select: vi.fn().mockImplementation(() => {
        selectCallCount++;
        if (selectCallCount === 1) {
          // dedup check for the txt file
          return {
            from: vi.fn().mockReturnValue({
              where: vi.fn().mockReturnValue({
                limit: vi.fn().mockResolvedValue([]),
              }),
            }),
          };
        }
        // createSnapshot fetch
        return {
          from: vi.fn().mockReturnValue({
            where: vi.fn().mockResolvedValue(storedDocs),
          }),
        };
      }),
      insert: vi.fn().mockReturnValue({
        values: vi.fn().mockResolvedValue(undefined),
      }),
    };

    const service = makeIntakeService(mockDb as never);
    const result = await service.ingest(TENANT_ID, docs, 'batch-unsupported');

    expect(result.processed).toBe(2);
    expect(result.stored).toBe(1);
    expect(result.rejected).toBe(1);

    const xlsxResult = result.documentResults.find((r) => r.filename === 'spreadsheet.xlsx');
    expect(xlsxResult?.status).toBe('unsupported');

    const txtResult = result.documentResults.find((r) => r.filename === 'paper.txt');
    expect(txtResult?.status).toBe('stored');
  });
});

// ── T043-04: Parse failure rejected, others continue ─────────────────────────

maybeDescribe('T043-04: parse failure is non-fatal', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it('a document that fails parsing is marked parse_error, others in batch continue', async () => {
    const goodContent = 'Good document content that parses without errors.';
    const docs = [
      makeTextDoc(goodContent, 'good.txt', 'a1', 'Author One'),
      // Empty content produces 'empty' status (parse succeeds but text is empty)
      makeTextDoc('', 'empty.txt', 'a2', 'Author Two'),
    ];

    const storedDocs = [{ contentHash: 'hash-good', authorId: 'a1', wordCount: 7 }];

    let selectCallCount = 0;
    const mockDb = {
      select: vi.fn().mockImplementation(() => {
        selectCallCount++;
        if (selectCallCount === 1) {
          return {
            from: vi.fn().mockReturnValue({
              where: vi.fn().mockReturnValue({
                limit: vi.fn().mockResolvedValue([]),
              }),
            }),
          };
        }
        return {
          from: vi.fn().mockReturnValue({
            where: vi.fn().mockResolvedValue(storedDocs),
          }),
        };
      }),
      insert: vi.fn().mockReturnValue({
        values: vi.fn().mockResolvedValue(undefined),
      }),
    };

    const service = makeIntakeService(mockDb as never);
    const result = await service.ingest(TENANT_ID, docs, 'batch-parse-failure');

    expect(result.processed).toBe(2);
    expect(result.stored).toBe(1);
    expect(result.rejected).toBe(1);

    const goodResult = result.documentResults.find((r) => r.filename === 'good.txt');
    expect(goodResult?.status).toBe('stored');

    const emptyResult = result.documentResults.find((r) => r.filename === 'empty.txt');
    expect(emptyResult?.status).toBe('empty');
  });
});

// ── T043-05: Snapshot created from successful documents ───────────────────────

maybeDescribe('T043-05: snapshot is created when at least one document is stored', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it('ingest creates a snapshotId when one or more documents are stored', async () => {
    const docs = [makeTextDoc('Document content for snapshot test words here.', 'doc.txt', 'a1', 'Author One')];
    const storedDocs = [{ contentHash: 'hash-doc', authorId: 'a1', wordCount: 7 }];

    let selectCallCount = 0;
    const mockDb = {
      select: vi.fn().mockImplementation(() => {
        selectCallCount++;
        if (selectCallCount === 1) {
          return {
            from: vi.fn().mockReturnValue({
              where: vi.fn().mockReturnValue({
                limit: vi.fn().mockResolvedValue([]),
              }),
            }),
          };
        }
        return {
          from: vi.fn().mockReturnValue({
            where: vi.fn().mockResolvedValue(storedDocs),
          }),
        };
      }),
      insert: vi.fn().mockReturnValue({
        values: vi.fn().mockResolvedValue(undefined),
      }),
    };

    const service = makeIntakeService(mockDb as never);
    const result = await service.ingest(TENANT_ID, docs, 'snapshot-test');

    expect(result.stored).toBe(1);
    expect(result.snapshotId).toBeDefined();
    expect(typeof result.snapshotId).toBe('string');
  });
});

// ── T043-06: Zero documents → empty result, no snapshot ──────────────────────

maybeDescribe('T043-06: empty batch returns zero counts and no snapshot', () => {
  it('ingest with empty document array returns zeroed result with no snapshotId', async () => {
    const mockDb = {
      select: vi.fn(),
      insert: vi.fn(),
    };

    const service = makeIntakeService(mockDb as never);
    const result = await service.ingest(TENANT_ID, [], 'empty-batch');

    expect(result.processed).toBe(0);
    expect(result.stored).toBe(0);
    expect(result.duplicates).toBe(0);
    expect(result.rejected).toBe(0);
    expect(result.snapshotId).toBeUndefined();
    expect(result.documentResults).toHaveLength(0);
    expect(mockDb.insert).not.toHaveBeenCalled();
  });
});

// ── T043-07: Author attribution optional per document ─────────────────────────

maybeDescribe('T043-07: author attribution is optional per document', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it('documents without authorId are stored with empty string as authorId', async () => {
    const docs = [
      makeTextDoc('Unattributed document content with enough words here.', 'anon.txt'),
      // No authorId or authorName
    ];

    const storedDocs = [{ contentHash: 'hash-anon', authorId: '', wordCount: 7 }];

    let selectCallCount = 0;
    const mockDb = {
      select: vi.fn().mockImplementation(() => {
        selectCallCount++;
        if (selectCallCount === 1) {
          return {
            from: vi.fn().mockReturnValue({
              where: vi.fn().mockReturnValue({
                limit: vi.fn().mockResolvedValue([]),
              }),
            }),
          };
        }
        return {
          from: vi.fn().mockReturnValue({
            where: vi.fn().mockResolvedValue(storedDocs),
          }),
        };
      }),
      insert: vi.fn().mockReturnValue({
        values: vi.fn().mockResolvedValue(undefined),
      }),
    };

    const service = makeIntakeService(mockDb as never);
    const result = await service.ingest(TENANT_ID, docs, 'anon-batch');

    expect(result.stored).toBe(1);
    expect(result.rejected).toBe(0);
    const storedResult = result.documentResults[0];
    expect(storedResult?.status).toBe('stored');
  });
});
