/**
 * Unit tests for DeduplicationService.
 *
 * Uses a stub DB object instead of a real Drizzle connection.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { DeduplicationService } from '../../../src/profiles/intake/dedup.js';

// ---------------------------------------------------------------------------
// DB stub helpers
// ---------------------------------------------------------------------------

function makeDbStub(rows: Array<{ id: string; contentHash: string; originalFilename: string }> = []) {
  const limitFn = vi.fn().mockResolvedValue(rows.slice(0, 1));
  const whereFn = vi.fn().mockReturnValue({ limit: limitFn });
  const fromFn = vi.fn().mockReturnValue({ where: whereFn });
  const selectFn = vi.fn().mockReturnValue({ from: fromFn });

  return {
    select: selectFn,
    _whereFn: whereFn,
    _limitFn: limitFn,
    _rows: rows,
  };
}

function makeDbStubForBatch(rows: Array<{ id: string; contentHash: string; originalFilename: string }>) {
  const whereFn = vi.fn().mockResolvedValue(rows);
  const fromFn = vi.fn().mockReturnValue({ where: whereFn });
  const selectFn = vi.fn().mockReturnValue({ from: fromFn });

  return {
    select: selectFn,
    _whereFn: whereFn,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('DeduplicationService', () => {
  describe('computeContentHash', () => {
    let svc: DeduplicationService;

    beforeEach(() => {
      // DB is not used by computeContentHash — pass a minimal stub
      svc = new DeduplicationService({} as never);
    });

    it('returns a 64-character hex string (SHA-256)', () => {
      const hash = svc.computeContentHash('hello world');
      expect(hash).toMatch(/^[0-9a-f]{64}$/);
    });

    it('is deterministic for the same input', () => {
      const a = svc.computeContentHash('same text');
      const b = svc.computeContentHash('same text');
      expect(a).toBe(b);
    });

    it('produces different hashes for different inputs', () => {
      const a = svc.computeContentHash('text A');
      const b = svc.computeContentHash('text B');
      expect(a).not.toBe(b);
    });

    it('produces a known SHA-256 hash for empty string', () => {
      // SHA-256('') = e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855
      const hash = svc.computeContentHash('');
      expect(hash).toBe('e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855');
    });
  });

  describe('checkDuplicate', () => {
    it('returns isDuplicate false when no row found', async () => {
      const db = makeDbStub([]);
      const svc = new DeduplicationService(db as never);

      const result = await svc.checkDuplicate('tenant-1', 'abc123');

      expect(result.isDuplicate).toBe(false);
      expect(result.existingDocumentId).toBeUndefined();
    });

    it('returns isDuplicate true with existing doc details when row found', async () => {
      const db = makeDbStub([
        { id: 'doc-1', contentHash: 'abc123', originalFilename: 'report.pdf' },
      ]);
      const svc = new DeduplicationService(db as never);

      const result = await svc.checkDuplicate('tenant-1', 'abc123');

      expect(result.isDuplicate).toBe(true);
      expect(result.existingDocumentId).toBe('doc-1');
      expect(result.existingFilename).toBe('report.pdf');
    });

    it('throws when tenantId is empty (fail-closed)', async () => {
      const db = makeDbStub([]);
      const svc = new DeduplicationService(db as never);

      await expect(svc.checkDuplicate('', 'abc123')).rejects.toThrow('tenantId is required');
    });
  });

  describe('checkDuplicateBatch', () => {
    it('returns empty array for empty input without querying DB', async () => {
      const db = makeDbStubForBatch([]);
      const svc = new DeduplicationService(db as never);

      const results = await svc.checkDuplicateBatch('tenant-1', []);

      expect(results).toEqual([]);
      expect(db.select).not.toHaveBeenCalled();
    });

    it('returns isDuplicate false for hashes not in corpus', async () => {
      const db = makeDbStubForBatch([]);
      const svc = new DeduplicationService(db as never);

      const results = await svc.checkDuplicateBatch('tenant-1', ['hash-a', 'hash-b']);

      expect(results).toHaveLength(2);
      expect(results[0]).toMatchObject({ contentHash: 'hash-a', isDuplicate: false });
      expect(results[1]).toMatchObject({ contentHash: 'hash-b', isDuplicate: false });
    });

    it('returns isDuplicate true for hashes that exist in corpus', async () => {
      const db = makeDbStubForBatch([
        { id: 'doc-99', contentHash: 'hash-a', originalFilename: 'existing.pdf' },
      ]);
      const svc = new DeduplicationService(db as never);

      const results = await svc.checkDuplicateBatch('tenant-1', ['hash-a', 'hash-b']);

      expect(results[0]).toMatchObject({
        contentHash: 'hash-a',
        isDuplicate: true,
        existingDocumentId: 'doc-99',
        existingFilename: 'existing.pdf',
      });
      expect(results[1]).toMatchObject({ contentHash: 'hash-b', isDuplicate: false });
    });

    it('preserves input order in results', async () => {
      const db = makeDbStubForBatch([
        { id: 'doc-2', contentHash: 'hash-b', originalFilename: 'b.pdf' },
        { id: 'doc-1', contentHash: 'hash-a', originalFilename: 'a.pdf' },
      ]);
      const svc = new DeduplicationService(db as never);

      const results = await svc.checkDuplicateBatch('tenant-1', ['hash-a', 'hash-b', 'hash-c']);

      expect(results[0].contentHash).toBe('hash-a');
      expect(results[1].contentHash).toBe('hash-b');
      expect(results[2].contentHash).toBe('hash-c');
    });

    it('throws when tenantId is empty (fail-closed)', async () => {
      const db = makeDbStubForBatch([]);
      const svc = new DeduplicationService(db as never);

      await expect(svc.checkDuplicateBatch('', ['abc'])).rejects.toThrow('tenantId is required');
    });
  });
});
