/**
 * Unit tests for profiles/cache/service.ts (T029 + T031)
 *
 * Stubs the DB client, InheritanceResolver, and loggers.
 * No real database required.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ── DB Mock ────────────────────────────────────────────────────────────────

vi.mock('../../../src/db/client.js', () => ({
  db: {
    select: vi.fn(),
    insert: vi.fn(),
    delete: vi.fn(),
  },
  profileCache: {},
  tenantProfiles: {},
}));

// ── Logger mock ─────────────────────────────────────────────────────────────

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

// ── Resolver mock ────────────────────────────────────────────────────────────

vi.mock('../../../src/profiles/inheritance/resolver.js', () => ({
  InheritanceResolver: vi.fn().mockImplementation(() => ({
    resolve: vi.fn(),
  })),
}));

import { ProfileCacheService, CACHE_WARM_THRESHOLD } from '../../../src/profiles/cache/service.js';
import { InheritanceResolver } from '../../../src/profiles/inheritance/resolver.js';
import { ProfileMetrics } from '../../../src/profiles/monitoring/metrics.js';
import { db } from '../../../src/db/client.js';

// ── Helpers ────────────────────────────────────────────────────────────────

function makeResolvedProfile(featureValue = 0.5) {
  return {
    features: new Map([
      ['feature_000', { value: featureValue, sourceTier: 'base' as const, sourceProfileId: 'org::root', sourceVersion: 1 }],
    ]),
    markers: [],
    overrideSources: {},
  };
}

function makeCacheRow(tenantId: string, profileIdentity: string, featureValue = 0.5) {
  return {
    id: `cache-${profileIdentity}`,
    tenantId,
    profileIdentity,
    resolvedFeatures: {
      feature_000: { value: featureValue, sourceTier: 'base', sourceProfileId: 'org::root', sourceVersion: 1 },
    },
    resolvedMarkers: [],
    overrideSources: {},
    ancestorVersions: {},
    resolvedAt: new Date(),
  };
}

/** Chainable select stub resolving to rows. */
function selectChain(rows: unknown[]) {
  const chain: Record<string, unknown> = {};
  chain['from'] = vi.fn().mockReturnValue(chain);
  chain['where'] = vi.fn().mockReturnValue(chain);
  chain['limit'] = vi.fn().mockResolvedValue(rows);
  chain['then'] = (resolve: (v: unknown) => unknown) => Promise.resolve(rows).then(resolve);
  return chain as never;
}

/** Chainable insert stub. */
function insertChain() {
  const chain: Record<string, unknown> = {};
  chain['values'] = vi.fn().mockReturnValue(chain);
  chain['onConflictDoUpdate'] = vi.fn().mockResolvedValue([]);
  return chain as never;
}

/** Chainable delete stub returning rows. */
function deleteChain(rows: unknown[]) {
  const chain: Record<string, unknown> = {};
  chain['where'] = vi.fn().mockReturnValue(chain);
  chain['returning'] = vi.fn().mockResolvedValue(rows);
  return chain as never;
}

// ── get ────────────────────────────────────────────────────────────────────

describe('ProfileCacheService.get', () => {
  let service: ProfileCacheService;

  beforeEach(() => {
    vi.clearAllMocks();
    service = new ProfileCacheService();
  });

  it('throws when tenantId is empty', async () => {
    await expect(service.get('', 'org::root')).rejects.toThrow('tenantId is required');
  });

  it('returns null on cache miss', async () => {
    vi.mocked(db.select).mockReturnValue(selectChain([]));
    const result = await service.get('tenant-abc', 'org::root');
    expect(result).toBeNull();
  });

  it('returns a deserialized ResolvedProfile on cache hit', async () => {
    vi.mocked(db.select).mockReturnValue(
      selectChain([makeCacheRow('tenant-abc', 'org::root', 0.7)]),
    );

    const result = await service.get('tenant-abc', 'org::root');
    expect(result).not.toBeNull();
    expect(result!.features.get('feature_000')!.value).toBe(0.7);
    expect(result!.markers).toEqual([]);
    expect(result!.overrideSources).toEqual({});
  });
});

// ── getOrResolve ───────────────────────────────────────────────────────────

describe('ProfileCacheService.getOrResolve', () => {
  let resolver: InheritanceResolver;
  let metrics: ProfileMetrics;
  let service: ProfileCacheService;

  beforeEach(() => {
    vi.clearAllMocks();
    resolver = new InheritanceResolver();
    metrics = new ProfileMetrics();
    service = new ProfileCacheService(resolver, undefined, metrics);
  });

  it('returns cached value and records hit on cache hit', async () => {
    vi.mocked(db.select).mockReturnValue(
      selectChain([makeCacheRow('tenant-abc', 'org::root', 0.5)]),
    );

    const result = await service.getOrResolve('tenant-abc', 'org::root');
    expect(result.features.get('feature_000')!.value).toBe(0.5);
    expect(metrics.recordCacheHit).toHaveBeenCalledWith('tenant-abc');
    expect(metrics.recordCacheMiss).not.toHaveBeenCalled();
    expect(resolver.resolve).not.toHaveBeenCalled();
  });

  it('calls resolver on miss, stores result, records miss', async () => {
    const resolved = makeResolvedProfile(0.9);
    vi.mocked(db.select).mockReturnValue(selectChain([]));
    vi.mocked(resolver.resolve).mockResolvedValue(resolved);
    vi.mocked(db.insert).mockReturnValue(insertChain());

    const result = await service.getOrResolve('tenant-abc', 'org::root');
    expect(result.features.get('feature_000')!.value).toBe(0.9);
    expect(metrics.recordCacheMiss).toHaveBeenCalledWith('tenant-abc');
    expect(resolver.resolve).toHaveBeenCalledWith('tenant-abc', 'org::root');
    expect(db.insert).toHaveBeenCalled();
  });
});

// ── set ────────────────────────────────────────────────────────────────────

describe('ProfileCacheService.set', () => {
  let service: ProfileCacheService;

  beforeEach(() => {
    vi.clearAllMocks();
    service = new ProfileCacheService();
  });

  it('throws when tenantId is empty', async () => {
    const resolved = makeResolvedProfile();
    await expect(service.set('', 'org::root', resolved, {})).rejects.toThrow('tenantId is required');
  });

  it('calls db.insert with onConflictDoUpdate', async () => {
    const chain = insertChain();
    vi.mocked(db.insert).mockReturnValue(chain);
    const resolved = makeResolvedProfile(0.6);

    await service.set('tenant-abc', 'org::root', resolved, { 'org::root': 3 });

    expect(db.insert).toHaveBeenCalled();
    expect((chain as Record<string, ReturnType<typeof vi.fn>>)['values']).toHaveBeenCalled();
    expect((chain as Record<string, ReturnType<typeof vi.fn>>)['onConflictDoUpdate']).toHaveBeenCalled();
  });
});

// ── delete ─────────────────────────────────────────────────────────────────

describe('ProfileCacheService.delete', () => {
  let service: ProfileCacheService;

  beforeEach(() => {
    vi.clearAllMocks();
    service = new ProfileCacheService();
  });

  it('returns true when a row is deleted', async () => {
    vi.mocked(db.delete).mockReturnValue(
      deleteChain([makeCacheRow('tenant-abc', 'org::root')]),
    );
    const result = await service.delete('tenant-abc', 'org::root');
    expect(result).toBe(true);
  });

  it('returns false when no row matched', async () => {
    vi.mocked(db.delete).mockReturnValue(deleteChain([]));
    const result = await service.delete('tenant-abc', 'org::missing');
    expect(result).toBe(false);
  });

  it('throws when tenantId is empty', async () => {
    await expect(service.delete('', 'org::root')).rejects.toThrow('tenantId is required');
  });
});

// ── deleteAll ──────────────────────────────────────────────────────────────

describe('ProfileCacheService.deleteAll', () => {
  let service: ProfileCacheService;

  beforeEach(() => {
    vi.clearAllMocks();
    service = new ProfileCacheService();
  });

  it('returns count of deleted rows', async () => {
    vi.mocked(db.delete).mockReturnValue(
      deleteChain([
        makeCacheRow('tenant-abc', 'org::root'),
        makeCacheRow('tenant-abc', 'dept::mid'),
      ]),
    );
    const count = await service.deleteAll('tenant-abc');
    expect(count).toBe(2);
  });

  it('returns 0 when no rows exist', async () => {
    vi.mocked(db.delete).mockReturnValue(deleteChain([]));
    const count = await service.deleteAll('tenant-abc');
    expect(count).toBe(0);
  });

  it('throws when tenantId is empty', async () => {
    await expect(service.deleteAll('')).rejects.toThrow('tenantId is required');
  });
});

// ── getCacheStats ──────────────────────────────────────────────────────────

describe('ProfileCacheService.getCacheStats', () => {
  let service: ProfileCacheService;

  beforeEach(() => {
    vi.clearAllMocks();
    service = new ProfileCacheService();
  });

  it('returns zero stats when no entries exist', async () => {
    const chain: Record<string, unknown> = {};
    chain['from'] = vi.fn().mockReturnValue(chain);
    chain['where'] = vi.fn().mockResolvedValue([{ totalEntries: 0, oldestResolvedAt: null, newestResolvedAt: null }]);
    vi.mocked(db.select).mockReturnValue(chain as never);

    const stats = await service.getCacheStats('tenant-abc');
    expect(stats.totalEntries).toBe(0);
    expect(stats.oldestResolvedAt).toBeNull();
    expect(stats.newestResolvedAt).toBeNull();
  });

  it('returns populated stats', async () => {
    const oldest = new Date('2025-01-01');
    const newest = new Date('2025-03-01');
    const chain: Record<string, unknown> = {};
    chain['from'] = vi.fn().mockReturnValue(chain);
    chain['where'] = vi.fn().mockResolvedValue([{ totalEntries: 5, oldestResolvedAt: oldest, newestResolvedAt: newest }]);
    vi.mocked(db.select).mockReturnValue(chain as never);

    const stats = await service.getCacheStats('tenant-abc');
    expect(stats.totalEntries).toBe(5);
    expect(stats.oldestResolvedAt).toEqual(oldest);
    expect(stats.newestResolvedAt).toEqual(newest);
  });

  it('throws when tenantId is empty', async () => {
    await expect(service.getCacheStats('')).rejects.toThrow('tenantId is required');
  });
});

// ── warmCache ──────────────────────────────────────────────────────────────

describe('ProfileCacheService.warmCache', () => {
  let resolver: InheritanceResolver;
  let service: ProfileCacheService;

  beforeEach(() => {
    vi.clearAllMocks();
    resolver = new InheritanceResolver();
    service = new ProfileCacheService(resolver);
  });

  it('throws when tenantId is empty', async () => {
    await expect(service.warmCache('')).rejects.toThrow('tenantId is required');
  });

  it('warms specified identities and returns correct counts', async () => {
    const resolved = makeResolvedProfile();
    vi.mocked(resolver.resolve).mockResolvedValue(resolved);
    vi.mocked(db.insert).mockReturnValue(insertChain());

    const result = await service.warmCache('tenant-abc', ['org::root', 'dept::mid']);
    expect(result.warmed).toBe(2);
    expect(result.failed).toBe(0);
    expect(result.durationMs).toBeGreaterThanOrEqual(0);
  });

  it('fetches active profiles from DB when no identities provided', async () => {
    const resolved = makeResolvedProfile();
    vi.mocked(resolver.resolve).mockResolvedValue(resolved);
    vi.mocked(db.insert).mockReturnValue(insertChain());

    // First select call is fetchActiveProfileIdentities
    const profileSelectChain: Record<string, unknown> = {};
    profileSelectChain['from'] = vi.fn().mockReturnValue(profileSelectChain);
    profileSelectChain['where'] = vi.fn().mockResolvedValue([
      { profileIdentity: 'org::root' },
      { profileIdentity: 'dept::mid' },
    ]);
    vi.mocked(db.select).mockReturnValue(profileSelectChain as never);

    const result = await service.warmCache('tenant-abc');
    expect(result.warmed).toBe(2);
    expect(result.failed).toBe(0);
  });

  it('continues on per-profile failure and counts correctly', async () => {
    vi.mocked(resolver.resolve)
      .mockResolvedValueOnce(makeResolvedProfile())
      .mockRejectedValueOnce(new Error('profile engine unavailable'));
    vi.mocked(db.insert).mockReturnValue(insertChain());

    const result = await service.warmCache('tenant-abc', ['org::root', 'dept::broken']);
    expect(result.warmed).toBe(1);
    expect(result.failed).toBe(1);
  });

  it('exports CACHE_WARM_THRESHOLD constant as 20', () => {
    expect(CACHE_WARM_THRESHOLD).toBe(20);
  });
});
