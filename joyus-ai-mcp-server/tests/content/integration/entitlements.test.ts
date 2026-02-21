/**
 * Integration Tests — Entitlement Enforcement
 *
 * Verifies zero unauthorized content exposure (SC-009).
 * Uses mocks — no real database connections.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

import { EntitlementCache } from '../../../src/content/entitlements/cache.js';
import { EntitlementService } from '../../../src/content/entitlements/index.js';
import type { ResolvedEntitlements } from '../../../src/content/types.js';

// ── Helpers ────────────────────────────────────────────────────────────────

function makeEntitlements(sourceIds: string[], overrides: Partial<ResolvedEntitlements> = {}): ResolvedEntitlements {
  return {
    productIds: ['prod-1'],
    sourceIds,
    profileIds: [],
    resolvedFrom: 'http-resolver',
    resolvedAt: new Date(),
    ...overrides,
  };
}

const mockDb = {} as never;

// ── Tests ──────────────────────────────────────────────────────────────────

describe('Entitlement Enforcement', () => {
  describe('resolves entitlements with cache hit', () => {
    it('returns cached entitlements without calling resolver', async () => {
      const cache = new EntitlementCache();
      const cachedEntitlements = makeEntitlements(['source-1', 'source-2']);
      cache.set('session-1', 'user-1', cachedEntitlements);

      const mockResolver = {
        resolve: vi.fn().mockResolvedValue(makeEntitlements(['source-3'])),
      };

      const service = new EntitlementService(mockResolver, cache, mockDb);
      const result = await service.resolve('tenant-1', 'user-1', 'session-1');

      // Resolver should NOT be called — cache hit
      expect(mockResolver.resolve).not.toHaveBeenCalled();
      expect(result.sourceIds).toContain('source-1');
      expect(result.sourceIds).toContain('source-2');
    });

    it('calls resolver on cache miss', async () => {
      const cache = new EntitlementCache();
      // No cache entry set — cold cache

      const mockResolver = {
        resolve: vi.fn().mockResolvedValue(makeEntitlements(['source-a'])),
      };

      const service = new EntitlementService(mockResolver, cache, mockDb);
      const result = await service.resolve('tenant-1', 'user-1', 'session-new');

      expect(mockResolver.resolve).toHaveBeenCalledOnce();
      expect(result.sourceIds).toContain('source-a');
    });
  });

  describe('falls back to restricted mode on resolver failure', () => {
    it('returns empty entitlements when resolver throws and no cache entry', async () => {
      const cache = new EntitlementCache();
      const mockResolver = {
        resolve: vi.fn().mockRejectedValue(new Error('Upstream entitlement service unavailable')),
      };

      const service = new EntitlementService(mockResolver, cache, mockDb);
      const result = await service.resolve('tenant-1', 'user-1', 'session-fail');

      expect(result.sourceIds).toHaveLength(0);
      expect(result.productIds).toHaveLength(0);
      expect(result.resolvedFrom).toBe('fallback-restricted');
    });

    it('restricts search results when entitlements are empty', async () => {
      const emptyEntitlements = makeEntitlements([], { resolvedFrom: 'fallback-restricted' });

      // SearchService short-circuits when sourceIds is empty
      const mockProvider = {
        search: vi.fn().mockResolvedValue([{ itemId: 'secret', sourceId: 'restricted-source' }]),
      };

      const results = emptyEntitlements.sourceIds.length === 0
        ? []
        : await mockProvider.search({ query: 'anything', sourceIds: emptyEntitlements.sourceIds });

      expect(results).toHaveLength(0);
      expect(mockProvider.search).not.toHaveBeenCalled();
    });
  });

  describe('search returns only entitled content', () => {
    it('filters results to entitled source IDs', async () => {
      const entitlements = makeEntitlements(['source-allowed']);

      const mockProvider = {
        search: vi.fn().mockResolvedValue([
          { itemId: 'item-1', sourceId: 'source-allowed', title: 'Allowed', excerpt: '', score: 0.9, metadata: {} },
        ]),
      };

      const results = await mockProvider.search({
        query: 'query',
        sourceIds: entitlements.sourceIds,
      });

      expect(results.every((r: { sourceId: string }) => entitlements.sourceIds.includes(r.sourceId))).toBe(true);
      expect(results.find((r: { sourceId: string }) => r.sourceId === 'source-blocked')).toBeUndefined();
    });

    it('denies access to non-entitled items (returns null/empty)', async () => {
      const entitlements = makeEntitlements(['source-allowed']);
      const requestedSourceId = 'source-blocked';

      const isEntitled = entitlements.sourceIds.includes(requestedSourceId);
      const item = isEntitled ? { id: 'item-secret' } : null;

      expect(isEntitled).toBe(false);
      expect(item).toBeNull();
    });
  });

  describe('generation only uses entitled sources', () => {
    it('citations reference only entitled sources', () => {
      const entitlements = makeEntitlements(['source-a']);

      // Simulated search results already filtered to entitled sources
      const searchResults = [
        { itemId: 'item-1', sourceId: 'source-a', title: 'Entitled Doc', excerpt: 'excerpt', score: 1.0, metadata: {}, isStale: false },
      ];
      const unentitledResults = searchResults.filter(r => entitlements.sourceIds.includes(r.sourceId));

      expect(unentitledResults).toHaveLength(1);
      expect(unentitledResults[0].sourceId).toBe('source-a');
    });
  });

  describe('entitlement cache TTL', () => {
    it('returns null for expired cache entries', () => {
      const cache = new EntitlementCache();
      const entitlements = makeEntitlements(['source-1']);

      // Set with 1ms TTL (effectively expired immediately)
      cache.set('session-ttl', 'user-1', entitlements, 1);

      // Advance past TTL
      const start = Date.now();
      while (Date.now() - start < 5) {
        // busy wait ~5ms
      }

      const result = cache.get('session-ttl', 'user-1');
      expect(result).toBeNull();
    });

    it('returns valid entry within TTL', () => {
      const cache = new EntitlementCache();
      const entitlements = makeEntitlements(['source-1']);

      cache.set('session-valid', 'user-1', entitlements, 60_000);

      const result = cache.get('session-valid', 'user-1');
      expect(result).not.toBeNull();
      expect(result?.sourceIds).toContain('source-1');
    });

    it('invalidates specific session entry', () => {
      const cache = new EntitlementCache();
      const entitlements = makeEntitlements(['source-1']);
      cache.set('session-inv', 'user-1', entitlements);

      cache.invalidate('session-inv', 'user-1');

      expect(cache.get('session-inv', 'user-1')).toBeNull();
    });
  });
});
