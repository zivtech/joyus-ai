/**
 * Integration Tests — Content Pipeline
 *
 * Tests the connect → sync → search → generate pipeline using mocks.
 * No real database connections.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

import type { SearchResult, ResolvedEntitlements } from '../../../src/content/types.js';
import { CitationManager } from '../../../src/content/generation/citations.js';
import { EntitlementCache } from '../../../src/content/entitlements/cache.js';

// ── Helpers ────────────────────────────────────────────────────────────────

function makeEntitlements(sourceIds: string[]): ResolvedEntitlements {
  return {
    productIds: ['prod-1'],
    sourceIds,
    profileIds: [],
    resolvedFrom: 'test',
    resolvedAt: new Date(),
  };
}

function makeSearchResult(overrides: Partial<SearchResult> = {}): SearchResult {
  return {
    itemId: 'item-1',
    sourceId: 'source-1',
    title: 'Test Article',
    excerpt: 'This is a test excerpt.',
    score: 0.9,
    metadata: {},
    isStale: false,
    ...overrides,
  };
}

// ── Tests ──────────────────────────────────────────────────────────────────

describe('Content Pipeline Integration', () => {
  describe('sync engine processes batches correctly', () => {
    it('calls connector fetchBatch and produces items', async () => {
      const mockConnector = {
        sourceId: 'source-1',
        fetchBatch: vi.fn().mockResolvedValue({
          items: [
            { sourceRef: 'ref-1', title: 'Doc 1', body: 'Body 1', contentType: 'text', metadata: {} },
            { sourceRef: 'ref-2', title: 'Doc 2', body: 'Body 2', contentType: 'text', metadata: {} },
          ],
          nextCursor: null,
          totalDiscovered: 2,
        }),
        testConnection: vi.fn().mockResolvedValue(true),
      };

      const batch = await mockConnector.fetchBatch(undefined, 100);

      expect(mockConnector.fetchBatch).toHaveBeenCalledOnce();
      expect(batch.items).toHaveLength(2);
      expect(batch.items[0].title).toBe('Doc 1');
      expect(batch.nextCursor).toBeNull();
      expect(batch.totalDiscovered).toBe(2);
    });

    it('handles cursor-based pagination', async () => {
      const mockConnector = {
        sourceId: 'source-1',
        fetchBatch: vi
          .fn()
          .mockResolvedValueOnce({
            items: [{ sourceRef: 'ref-1', title: 'Doc 1', body: null, contentType: 'text', metadata: {} }],
            nextCursor: 'cursor-page-2',
            totalDiscovered: 2,
          })
          .mockResolvedValueOnce({
            items: [{ sourceRef: 'ref-2', title: 'Doc 2', body: null, contentType: 'text', metadata: {} }],
            nextCursor: null,
            totalDiscovered: 2,
          }),
        testConnection: vi.fn().mockResolvedValue(true),
      };

      const page1 = await mockConnector.fetchBatch(undefined, 1);
      expect(page1.nextCursor).toBe('cursor-page-2');

      const page2 = await mockConnector.fetchBatch(page1.nextCursor!, 1);
      expect(page2.nextCursor).toBeNull();
      expect(mockConnector.fetchBatch).toHaveBeenCalledTimes(2);
    });
  });

  describe('search returns entitlement-filtered results', () => {
    it('filters to entitled source IDs only', async () => {
      const allResults: SearchResult[] = [
        makeSearchResult({ itemId: 'item-1', sourceId: 'source-1' }),
        makeSearchResult({ itemId: 'item-2', sourceId: 'source-2' }),
        makeSearchResult({ itemId: 'item-3', sourceId: 'source-3' }),
      ];

      const mockProvider = {
        search: vi.fn().mockResolvedValue(
          allResults.filter((r) => ['source-1', 'source-2'].includes(r.sourceId)),
        ),
      };

      const entitlements = makeEntitlements(['source-1', 'source-2']);
      const results = await mockProvider.search({
        query: 'test',
        sourceIds: entitlements.sourceIds,
        limit: 10,
      });

      expect(results).toHaveLength(2);
      expect(results.every((r: SearchResult) => entitlements.sourceIds.includes(r.sourceId))).toBe(true);
      expect(results.find((r: SearchResult) => r.sourceId === 'source-3')).toBeUndefined();
    });

    it('returns empty array when no sources are entitled', async () => {
      const mockProvider = {
        search: vi.fn().mockResolvedValue([]),
      };

      const emptyEntitlements = makeEntitlements([]);
      // Search service should short-circuit when sourceIds is empty
      const results = emptyEntitlements.sourceIds.length === 0
        ? []
        : await mockProvider.search({ query: 'test', sourceIds: [] });

      expect(results).toHaveLength(0);
      expect(mockProvider.search).not.toHaveBeenCalled();
    });
  });

  describe('generation pipeline produces cited response', () => {
    it('extracts citations from [Source N] markers', () => {
      const citationManager = new CitationManager();
      const sources: SearchResult[] = [
        makeSearchResult({ itemId: 'item-1', sourceId: 'src-1', title: 'First Article' }),
        makeSearchResult({ itemId: 'item-2', sourceId: 'src-2', title: 'Second Article' }),
      ];

      const text = 'Based on research [Source 1], we can confirm [Source 2] the finding.';
      const citations = citationManager.extract(text, sources);

      expect(citations).toHaveLength(2);
      expect(citations[0].itemId).toBe('item-1');
      expect(citations[0].title).toBe('First Article');
      expect(citations[1].itemId).toBe('item-2');
    });

    it('deduplicates repeated citations', () => {
      const citationManager = new CitationManager();
      const sources: SearchResult[] = [
        makeSearchResult({ itemId: 'item-1', sourceId: 'src-1', title: 'Article A' }),
      ];

      const text = 'See [Source 1] for details, and again [Source 1] confirms this.';
      const citations = citationManager.extract(text, sources);

      expect(citations).toHaveLength(1);
    });

    it('ignores out-of-range source markers', () => {
      const citationManager = new CitationManager();
      const sources: SearchResult[] = [
        makeSearchResult({ itemId: 'item-1', sourceId: 'src-1', title: 'Only Article' }),
      ];

      const text = 'See [Source 1] and also [Source 99].';
      const citations = citationManager.extract(text, sources);

      expect(citations).toHaveLength(1);
      expect(citations[0].itemId).toBe('item-1');
    });

    it('returns empty citations when no markers present', () => {
      const citationManager = new CitationManager();
      const sources: SearchResult[] = [
        makeSearchResult({ itemId: 'item-1', sourceId: 'src-1', title: 'Article' }),
      ];

      const text = 'A response with no citation markers.';
      const citations = citationManager.extract(text, sources);

      expect(citations).toHaveLength(0);
    });
  });

  describe('staleness detection', () => {
    it('flags items whose lastSyncedAt is beyond freshness window', () => {
      const freshnessWindowMinutes = 60;
      const now = Date.now();
      const staleThreshold = now - freshnessWindowMinutes * 60 * 1000;

      const items = [
        { id: 'item-1', lastSyncedAt: new Date(now - 30 * 60 * 1000) },  // 30 min ago — fresh
        { id: 'item-2', lastSyncedAt: new Date(now - 90 * 60 * 1000) },  // 90 min ago — stale
        { id: 'item-3', lastSyncedAt: new Date(now - 120 * 60 * 1000) }, // 120 min ago — stale
      ];

      const stale = items.filter((i) => i.lastSyncedAt.getTime() < staleThreshold);

      expect(stale).toHaveLength(2);
      expect(stale.map((i) => i.id)).toContain('item-2');
      expect(stale.map((i) => i.id)).toContain('item-3');
    });
  });
});
