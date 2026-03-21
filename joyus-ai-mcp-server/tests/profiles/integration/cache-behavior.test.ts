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

// ── Metrics mock ─────────────────────────────────────────────────────────────

vi.mock('../../../src/profiles/monitoring/metrics.js', () => ({
  ProfileMetrics: vi.fn().mockImplementation(() => ({
    recordCacheHit: vi.fn(),
    recordCacheMiss: vi.fn(),
  })),
}));

// ── Resolver mock ─────────────────────────────────────────────────────────────

vi.mock('../../../src/profiles/inheritance/resolver.js', () => ({
  InheritanceResolver: vi.fn().mockImplementation(() => ({
    resolve: vi.fn(),
  })),
}));

// ── HierarchyService mock ────────────────────────────────────────────────────

vi.mock('../../../src/profiles/inheritance/hierarchy.js', () => ({
  ProfileHierarchyService: vi.fn().mockImplementation(() => ({
    getAncestorChain: vi.fn().mockResolvedValue([]),
    getDescendants: vi.fn().mockResolvedValue([]),
  })),
}));

import { db } from '../../../src/db/client.js';
import { ProfileCacheService } from '../../../src/profiles/cache/service.js';
import { InheritanceResolver } from '../../../src/profiles/inheritance/resolver.js';
import type { ResolvedProfile } from '../../../src/profiles/types.js';

// ── Skip guard ───────────────────────────────────────────────────────────────

const RUN = !!process.env['DATABASE_URL'];
const maybeDescribe = RUN ? describe : describe.skip;

// ── Unique tenant ID per file ─────────────────────────────────────────────────

const TENANT_ID = `tenant-cache-${createId()}`;

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeResolvedProfile(featureValue = 0.7): ResolvedProfile {
  return {
    features: new Map([
      ['avg_sentence_length', { value: featureValue, sourceTier: 'base', sourceProfileId: 'base::org', sourceVersion: 1 }],
    ]),
    markers: [],
    overrideSources: {},
  };
}

function makeCacheRow(tenantId: string, identity: string, featureValue = 0.7) {
  return {
    id: createId(),
    tenantId,
    profileIdentity: identity,
    resolvedFeatures: { avg_sentence_length: { value: featureValue, sourceTier: 'base', sourceProfileId: 'base::org', sourceVersion: 1 } },
    resolvedMarkers: [],
    overrideSources: {},
    ancestorVersions: {},
    resolvedAt: new Date(),
  };
}

// ── T045-01: Cache miss → resolve → cache set ────────────────────────────────

maybeDescribe('T045-01: cache miss triggers resolver and then caches result', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it('getOrResolve calls resolver on miss and stores the result', async () => {
    const identity = `individual::author-${createId()}`;
    const resolved = makeResolvedProfile(0.65);

    const resolver = new InheritanceResolver();
    (resolver.resolve as ReturnType<typeof vi.fn>).mockResolvedValue(resolved);

    // First select: cache miss
    (db.select as ReturnType<typeof vi.fn>).mockReturnValue({
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockReturnValue({
          limit: vi.fn().mockResolvedValue([]),
        }),
      }),
    });

    // insert (cache set)
    (db.insert as ReturnType<typeof vi.fn>).mockReturnValue({
      values: vi.fn().mockReturnValue({
        onConflictDoUpdate: vi.fn().mockResolvedValue(undefined),
      }),
    });

    const cacheService = new ProfileCacheService(resolver);
    const result = await cacheService.getOrResolve(TENANT_ID, identity);

    expect(resolver.resolve).toHaveBeenCalledWith(TENANT_ID, identity);
    expect(db.insert).toHaveBeenCalled();
    expect(result.features.get('avg_sentence_length')?.value).toBeCloseTo(0.65);
  });
});

// ── T045-02: Cache hit → return cached (no resolve) ──────────────────────────

maybeDescribe('T045-02: cache hit returns cached value without calling resolver', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it('getOrResolve returns cached profile and does not call resolver', async () => {
    const identity = `individual::author-${createId()}`;
    const cacheRow = makeCacheRow(TENANT_ID, identity, 0.8);

    const resolver = new InheritanceResolver();

    (db.select as ReturnType<typeof vi.fn>).mockReturnValue({
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockReturnValue({
          limit: vi.fn().mockResolvedValue([cacheRow]),
        }),
      }),
    });

    const cacheService = new ProfileCacheService(resolver);
    const result = await cacheService.getOrResolve(TENANT_ID, identity);

    expect(resolver.resolve).not.toHaveBeenCalled();
    // deserialised from cacheRow.resolvedFeatures
    expect(result.features.get('avg_sentence_length')).toBeDefined();
  });
});

// ── T045-03: Profile update → cache invalidated → next fetch is miss ──────────

maybeDescribe('T045-03: after invalidation, next get returns null (miss)', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it('delete removes cache entry; subsequent get returns null', async () => {
    const identity = `individual::author-${createId()}`;

    // delete returns deleted row → true
    (db.delete as ReturnType<typeof vi.fn>).mockReturnValue({
      where: vi.fn().mockReturnValue({
        returning: vi.fn().mockResolvedValue([{ id: 'cache-row-001' }]),
      }),
    });

    const cacheService = new ProfileCacheService();
    const deleted = await cacheService.delete(TENANT_ID, identity);
    expect(deleted).toBe(true);

    // Next get returns null (miss)
    (db.select as ReturnType<typeof vi.fn>).mockReturnValue({
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockReturnValue({
          limit: vi.fn().mockResolvedValue([]),
        }),
      }),
    });

    const miss = await cacheService.get(TENANT_ID, identity);
    expect(miss).toBeNull();
  });
});

// ── T045-04: Cache warming fills entries for all active profiles ──────────────

maybeDescribe('T045-04: warmCache resolves and caches all active profiles', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it('warmCache with explicit identities resolves each and stores in cache', async () => {
    const id1 = `individual::author-${createId()}`;
    const id2 = `individual::author-${createId()}`;
    const identities = [id1, id2];

    const resolver = new InheritanceResolver();
    (resolver.resolve as ReturnType<typeof vi.fn>).mockResolvedValue(makeResolvedProfile(0.7));

    (db.insert as ReturnType<typeof vi.fn>).mockReturnValue({
      values: vi.fn().mockReturnValue({
        onConflictDoUpdate: vi.fn().mockResolvedValue(undefined),
      }),
    });

    const cacheService = new ProfileCacheService(resolver);
    const result = await cacheService.warmCache(TENANT_ID, identities);

    expect(result.warmed).toBe(2);
    expect(result.failed).toBe(0);
    expect(resolver.resolve).toHaveBeenCalledTimes(2);
    expect(resolver.resolve).toHaveBeenCalledWith(TENANT_ID, id1);
    expect(resolver.resolve).toHaveBeenCalledWith(TENANT_ID, id2);
  });
});

// ── T045-05: deleteAll clears entire tenant cache ─────────────────────────────

maybeDescribe('T045-05: deleteAll removes all cache entries for tenant', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it('deleteAll returns count of removed entries and leaves cache empty', async () => {
    (db.delete as ReturnType<typeof vi.fn>).mockReturnValue({
      where: vi.fn().mockReturnValue({
        returning: vi.fn().mockResolvedValue([
          { id: 'cache-001' },
          { id: 'cache-002' },
          { id: 'cache-003' },
        ]),
      }),
    });

    const cacheService = new ProfileCacheService();
    const count = await cacheService.deleteAll(TENANT_ID);

    expect(count).toBe(3);
    expect(db.delete).toHaveBeenCalled();
  });
});
