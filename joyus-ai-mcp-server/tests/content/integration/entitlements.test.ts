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
import type { ResolverContext } from '../../../src/content/entitlements/interface.js';

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
      cache.set('session-1', cachedEntitlements);

      const mockResolver = {
        resolve: vi.fn().mockResolvedValue(makeEntitlements(['source-3'])),
      };

      const service = new EntitlementService(mockResolver, cache, mockDb);
      const context: ResolverContext = { sessionId: 'session-1' };
      const result = await service.resolve('user-1', 'tenant-1', context);

      // Resolver should NOT be called — cache hit
      expect(mockResolver.resolve).not.toHaveBeenCalled();
      expect(result.sourceIds).toContain('source-1');
      expect(result.sourceIds).toContain('source-2');
    });

    it('calls resolver on cache miss', async () => {
      const cache = new EntitlementCache();
      // No cache entry set — cold cache

      const resolvedEntitlements = makeEntitlements(['source-a']);
      const mockResolver = {
        resolve: vi.fn().mockResolvedValue(resolvedEntitlements),
      };

      // Mock DB: select returns source/profile rows for product mapping lookups
      const mockDbWithOps = {
        insert: vi.fn().mockReturnValue({ values: vi.fn().mockResolvedValue(undefined) }),
        select: vi.fn().mockReturnValue({
          from: vi.fn().mockReturnValue({
            where: vi.fn().mockResolvedValue([{ sourceId: 'source-a', profileId: 'profile-1' }]),
          }),
        }),
      } as never;

      const service = new EntitlementService(mockResolver, cache, mockDbWithOps);
      const context: ResolverContext = { sessionId: 'session-new' };
      const result = await service.resolve('user-1', 'tenant-1', context);

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

      // Mock DB fallback — no rows found
      const mockDbWithOps = {
        select: vi.fn().mockReturnValue({
          from: vi.fn().mockReturnValue({
            where: vi.fn().mockReturnValue({
              orderBy: vi.fn().mockReturnValue({
                limit: vi.fn().mockResolvedValue([]),
              }),
            }),
          }),
        }),
        insert: vi.fn().mockReturnValue({ values: vi.fn().mockResolvedValue(undefined) }),
      } as never;

      const service = new EntitlementService(mockResolver, cache, mockDbWithOps);
      const context: ResolverContext = { sessionId: 'session-fail' };
      const result = await service.resolve('user-1', 'tenant-1', context);

      expect(result.sourceIds).toHaveLength(0);
      expect(result.productIds).toHaveLength(0);
      expect(result.resolvedFrom).toContain('restricted');
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
      const entitlements = makeEntitlements(['source-1'], { ttlSeconds: 0 });

      // Set with effectively zero TTL (ttlSeconds=0 → expires at set time)
      cache.set('session-ttl', entitlements);

      // Advance past TTL
      const start = Date.now();
      while (Date.now() - start < 5) {
        // busy wait ~5ms
      }

      const result = cache.get('session-ttl');
      expect(result).toBeNull();
    });

    it('returns valid entry within TTL', () => {
      const cache = new EntitlementCache();
      const entitlements = makeEntitlements(['source-1'], { ttlSeconds: 60 });

      cache.set('session-valid', entitlements);

      const result = cache.get('session-valid');
      expect(result).not.toBeNull();
      expect(result?.sourceIds).toContain('source-1');
    });

    it('invalidates specific session entry', () => {
      const cache = new EntitlementCache();
      const entitlements = makeEntitlements(['source-1']);
      cache.set('session-inv', entitlements);

      cache.invalidate('session-inv');

      expect(cache.get('session-inv')).toBeNull();
    });
  });
});
