/**
 * Unit tests for IntakeService.
 *
 * Parsers and DB operations are stubbed — no real PDF/DOCX/DB required.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { IntakeService } from '../../../src/profiles/intake/service.js';
import { ParserRegistry } from '../../../src/profiles/intake/parsers/registry.js';
import type { DocumentParser } from '../../../src/profiles/intake/parsers/interface.js';
import type { ParseResult } from '../../../src/profiles/types.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Create a simple mock parser that returns configurable results. */
function makeParser(
  ext: string,
  parseResult: ParseResult | Error,
): DocumentParser {
  return {
    name: ext,
    supportedExtensions: [ext],
    supportedMimeTypes: [],
    parse: vi.fn(async () => {
      if (parseResult instanceof Error) throw parseResult;
      return parseResult;
    }),
  };
}

/**
 * Build a DB stub that handles the full call chain used by IntakeService:
 *
 *   Dedup check:    select().from().where().limit(1)  → dupRows
 *   Snapshot fetch: select().from().where()           → snapshotFetchRows
 *   insert().values()                                 → resolves undefined
 *
 * Each call to `select()` is tracked via an internal counter so the correct
 * stub is returned for each query.
 */
function makeDb(opts: {
  dupRows?: Array<{ id: string; originalFilename: string }>;
  snapshotFetchRows?: Array<{ contentHash: string; authorId: string; wordCount: number }>;
} = {}) {
  const dupRows = opts.dupRows ?? [];
  const snapshotFetchRows = opts.snapshotFetchRows ?? [];

  let selectCount = 0;

  const select = vi.fn(() => {
    selectCount++;

    if (selectCount === 1) {
      // Dedup single-check: needs .limit()
      return {
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockReturnValue({
            limit: vi.fn().mockResolvedValue(dupRows),
          }),
        }),
      };
    }

    // Snapshot fetch: resolves directly after .where()
    return {
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockResolvedValue(snapshotFetchRows),
      }),
    };
  });

  const insert = vi.fn().mockReturnValue({
    values: vi.fn().mockResolvedValue(undefined),
  });

  return { select, insert, _selectCount: () => selectCount };
}

function buf(text: string): Buffer {
  return Buffer.from(text, 'utf8');
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('IntakeService', () => {
  let registry: ParserRegistry;

  beforeEach(() => {
    registry = new ParserRegistry();
  });

  // ------------------------------------------------------------------
  // Empty batch
  // ------------------------------------------------------------------

  describe('empty batch', () => {
    it('returns zero counts and no snapshot when documents array is empty', async () => {
      const db = makeDb();
      const svc = new IntakeService(db as never, registry);

      const result = await svc.ingest('tenant-1', [], 'snap-empty');

      expect(result.processed).toBe(0);
      expect(result.stored).toBe(0);
      expect(result.duplicates).toBe(0);
      expect(result.rejected).toBe(0);
      expect(result.snapshotId).toBeUndefined();
      expect(result.documentResults).toHaveLength(0);
    });
  });

  // ------------------------------------------------------------------
  // Unsupported format
  // ------------------------------------------------------------------

  describe('unsupported format', () => {
    it('marks unsupported files as rejected and continues', async () => {
      const db = makeDb();
      const svc = new IntakeService(db as never, registry);
      // No parsers registered — everything is unsupported

      const result = await svc.ingest(
        'tenant-1',
        [{ buffer: buf('data'), filename: 'data.xlsx' }],
        'snap-1',
      );

      expect(result.processed).toBe(1);
      expect(result.stored).toBe(0);
      expect(result.rejected).toBe(1);
      expect(result.snapshotId).toBeUndefined();
      expect(result.documentResults[0].status).toBe('unsupported');
    });

    it('continues processing remaining docs after an unsupported one', async () => {
      const txtParser = makeParser('txt', {
        text: 'hello world',
        metadata: { wordCount: 2 },
        warnings: [],
      });
      registry.register(txtParser);

      const db = makeDb({
        dupRows: [],
        snapshotFetchRows: [{ contentHash: 'h', authorId: 'author-a', wordCount: 2 }],
      });
      const svc = new IntakeService(db as never, registry);

      const result = await svc.ingest(
        'tenant-1',
        [
          { buffer: buf('garbage'), filename: 'data.xlsx' }, // unsupported
          { buffer: buf('hello world'), filename: 'note.txt' },
        ],
        'snap-1',
      );

      expect(result.processed).toBe(2);
      expect(result.rejected).toBe(1);
      expect(result.stored).toBe(1);
      expect(result.documentResults[0].status).toBe('unsupported');
      expect(result.documentResults[1].status).toBe('stored');
    });
  });

  // ------------------------------------------------------------------
  // Parse error
  // ------------------------------------------------------------------

  describe('parse error', () => {
    it('marks document as parse_error and continues', async () => {
      const failParser = makeParser('pdf', new Error('Corrupt file'));
      registry.register(failParser);

      const db = makeDb();
      const svc = new IntakeService(db as never, registry);

      const result = await svc.ingest(
        'tenant-1',
        [{ buffer: buf('bad'), filename: 'bad.pdf' }],
        'snap-1',
      );

      expect(result.processed).toBe(1);
      expect(result.rejected).toBe(1);
      expect(result.snapshotId).toBeUndefined();
      expect(result.documentResults[0].status).toBe('parse_error');
    });
  });

  // ------------------------------------------------------------------
  // Empty document after parsing
  // ------------------------------------------------------------------

  describe('empty document after parsing', () => {
    it('marks document as empty and does not store it', async () => {
      const emptyParser = makeParser('txt', {
        text: '',
        metadata: {},
        warnings: ['No text'],
      });
      registry.register(emptyParser);

      const db = makeDb();
      const svc = new IntakeService(db as never, registry);

      const result = await svc.ingest(
        'tenant-1',
        [{ buffer: buf('   '), filename: 'blank.txt' }],
        'snap-1',
      );

      expect(result.documentResults[0].status).toBe('empty');
      expect(result.stored).toBe(0);
      expect(result.snapshotId).toBeUndefined();
    });
  });

  // ------------------------------------------------------------------
  // Duplicate detection
  // ------------------------------------------------------------------

  describe('duplicate detection', () => {
    it('marks duplicate documents without storing them', async () => {
      const parser = makeParser('txt', {
        text: 'existing content',
        metadata: { wordCount: 2 },
        warnings: [],
      });
      registry.register(parser);

      const db = makeDb({
        dupRows: [{ id: 'existing-doc-id', originalFilename: 'original.txt' }],
      });
      const svc = new IntakeService(db as never, registry);

      const result = await svc.ingest(
        'tenant-1',
        [{ buffer: buf('existing content'), filename: 'copy.txt' }],
        'snap-1',
      );

      expect(result.duplicates).toBe(1);
      expect(result.stored).toBe(0);
      expect(result.snapshotId).toBeUndefined();
      expect(result.documentResults[0].status).toBe('duplicate');
      expect(result.documentResults[0].duplicateOf).toBe('existing-doc-id');
    });

    it('does not create snapshot when all documents are duplicates', async () => {
      const parser = makeParser('txt', {
        text: 'dup text',
        metadata: {},
        warnings: [],
      });
      registry.register(parser);

      // Both dedup checks return the same existing document
      let selectCount = 0;
      const db = {
        select: vi.fn(() => {
          selectCount++;
          return {
            from: vi.fn().mockReturnValue({
              where: vi.fn().mockReturnValue({
                limit: vi.fn().mockResolvedValue([
                  { id: 'doc-orig', originalFilename: 'orig.txt' },
                ]),
              }),
            }),
          };
        }),
        insert: vi.fn().mockReturnValue({
          values: vi.fn().mockResolvedValue(undefined),
        }),
      };

      const svc = new IntakeService(db as never, registry);

      const result = await svc.ingest(
        'tenant-1',
        [
          { buffer: buf('dup text'), filename: 'a.txt' },
          { buffer: buf('dup text'), filename: 'b.txt' },
        ],
        'snap-all-dups',
      );

      expect(result.snapshotId).toBeUndefined();
      expect(result.duplicates).toBe(2);
      expect(db.insert).not.toHaveBeenCalled();
    });
  });

  // ------------------------------------------------------------------
  // Successful storage
  // ------------------------------------------------------------------

  describe('successful storage', () => {
    it('stores document and creates a snapshot', async () => {
      const parser = makeParser('txt', {
        text: 'unique content',
        metadata: { wordCount: 2 },
        warnings: [],
      });
      registry.register(parser);

      const db = makeDb({
        dupRows: [],
        snapshotFetchRows: [
          { contentHash: 'somehash', authorId: 'author-a', wordCount: 2 },
        ],
      });

      const svc = new IntakeService(db as never, registry);

      const result = await svc.ingest(
        'tenant-1',
        [{
          buffer: buf('unique content'),
          filename: 'unique.txt',
          authorId: 'author-a',
          authorName: 'Author A',
        }],
        'snap-new',
      );

      expect(result.stored).toBe(1);
      expect(result.documentResults[0].status).toBe('stored');
      expect(result.documentResults[0].documentId).toBeDefined();
      expect(result.documentIds).toHaveLength(1);
      expect(result.snapshotId).toBeDefined();
      // insert called twice: once for corpus_documents, once for corpus_snapshots
      expect(db.insert).toHaveBeenCalledTimes(2);
    });
  });

  // ------------------------------------------------------------------
  // Mixed batch
  // ------------------------------------------------------------------

  describe('mixed batch', () => {
    it('handles mix of stored / unsupported in one call', async () => {
      const txtParser = makeParser('txt', {
        text: 'new content',
        metadata: { wordCount: 2 },
        warnings: [],
      });
      registry.register(txtParser);

      const db = makeDb({
        dupRows: [],
        snapshotFetchRows: [{ contentHash: 'h', authorId: 'a', wordCount: 2 }],
      });

      const svc = new IntakeService(db as never, registry);

      const result = await svc.ingest(
        'tenant-1',
        [
          { buffer: buf('new content'), filename: 'doc.txt' },
          { buffer: buf('anything'), filename: 'data.xlsx' }, // unsupported
        ],
        'snap-mixed',
      );

      expect(result.processed).toBe(2);
      expect(result.stored).toBe(1);
      expect(result.rejected).toBe(1);
      expect(result.snapshotId).toBeDefined();
    });
  });

  // ------------------------------------------------------------------
  // Tenant isolation
  // ------------------------------------------------------------------

  describe('tenant isolation', () => {
    it('throws when tenantId is empty', async () => {
      const db = makeDb();
      const svc = new IntakeService(db as never, registry);

      await expect(
        svc.ingest('', [{ buffer: buf('data'), filename: 'doc.txt' }], 'snap'),
      ).rejects.toThrow('tenantId is required');
    });
  });
});
