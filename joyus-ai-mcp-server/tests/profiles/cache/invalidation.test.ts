/**
 * Unit tests for profiles/cache/invalidation.ts (T030)
 *
 * Stubs HierarchyService, ProfileCacheService, and the logger.
 * No real database required.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ── Logger mock ────────────────────────────────────────────────────────────

vi.mock('../../../src/profiles/monitoring/logger.js', () => ({
  ProfileOperationLogger: vi.fn().mockImplementation(() => ({
    logOperation: vi.fn().mockResolvedValue(undefined),
  })),
}));

// ── Resolver mock (transitively required by ProfileCacheService) ───────────

vi.mock('../../../src/profiles/inheritance/resolver.js', () => ({
  InheritanceResolver: vi.fn().mockImplementation(() => ({
    resolve: vi.fn(),
  })),
}));

// ── DB mock (transitively required by ProfileCacheService) ────────────────

vi.mock('../../../src/db/client.js', () => ({
  db: {
    select: vi.fn(),
    insert: vi.fn(),
    delete: vi.fn(),
  },
  profileCache: {},
  tenantProfiles: {},
}));

// ── Metrics mock ───────────────────────────────────────────────────────────

vi.mock('../../../src/profiles/monitoring/metrics.js', () => ({
  ProfileMetrics: vi.fn().mockImplementation(() => ({
    recordCacheHit: vi.fn(),
    recordCacheMiss: vi.fn(),
  })),
}));

import { CacheInvalidationService } from '../../../src/profiles/cache/invalidation.js';
import { ProfileHierarchyService } from '../../../src/profiles/inheritance/hierarchy.js';
import { ProfileCacheService } from '../../../src/profiles/cache/service.js';

// ── Helpers ────────────────────────────────────────────────────────────────

function makeHierarchyService(
  overrides: Partial<ProfileHierarchyService> = {},
): ProfileHierarchyService {
  return {
    createRelationship: vi.fn(),
    removeRelationship: vi.fn(),
    getParent: vi.fn(),
    getChildren: vi.fn(),
    getAncestorChain: vi.fn().mockResolvedValue([]),
    getDescendants: vi.fn().mockResolvedValue([]),
    getFullHierarchy: vi.fn().mockResolvedValue([]),
    ...overrides,
  } as unknown as ProfileHierarchyService;
}

function makeCacheService(
  overrides: Partial<ProfileCacheService> = {},
): ProfileCacheService {
  return {
    get: vi.fn(),
    getOrResolve: vi.fn(),
    set: vi.fn(),
    delete: vi.fn().mockResolvedValue(true),
    deleteAll: vi.fn().mockResolvedValue(0),
    getCacheStats: vi.fn(),
    warmCache: vi.fn().mockResolvedValue({ warmed: 0, failed: 0, durationMs: 0 }),
    ...overrides,
  } as unknown as ProfileCacheService;
}

// ── invalidateForProfile ───────────────────────────────────────────────────

describe('CacheInvalidationService.invalidateForProfile', () => {
  let hierarchyService: ProfileHierarchyService;
  let cacheService: ProfileCacheService;
  let service: CacheInvalidationService;

  beforeEach(() => {
    vi.clearAllMocks();
    hierarchyService = makeHierarchyService();
    cacheService = makeCacheService();
    service = new CacheInvalidationService(hierarchyService, cacheService);
  });

  it('throws when tenantId is empty', async () => {
    await expect(
      service.invalidateForProfile('', 'org::root'),
    ).rejects.toThrow('tenantId is required');
  });

  it('invalidates only the changed profile when it has no descendants', async () => {
    vi.mocked(hierarchyService.getDescendants).mockResolvedValue([]);
    vi.mocked(cacheService.delete).mockResolvedValue(true);

    const result = await service.invalidateForProfile('tenant-abc', 'org::root');

    expect(hierarchyService.getDescendants).toHaveBeenCalledWith('tenant-abc', 'org::root');
    expect(cacheService.delete).toHaveBeenCalledWith('tenant-abc', 'org::root');
    expect(result.invalidated).toBe(1);
    expect(result.identities).toEqual(['org::root']);
  });

  it('invalidates changed profile and all descendants', async () => {
    vi.mocked(hierarchyService.getDescendants).mockResolvedValue([
      'dept::child-a',
      'dept::child-b',
      'individual::leaf',
    ]);
    vi.mocked(cacheService.delete).mockResolvedValue(true);

    const result = await service.invalidateForProfile('tenant-abc', 'org::root');

    expect(cacheService.delete).toHaveBeenCalledTimes(4);
    expect(result.invalidated).toBe(4);
    expect(result.identities).toEqual([
      'org::root',
      'dept::child-a',
      'dept::child-b',
      'individual::leaf',
    ]);
  });

  it('counts only entries that actually existed in cache (delete returns false)', async () => {
    vi.mocked(hierarchyService.getDescendants).mockResolvedValue(['dept::child-a']);
    // changed profile exists in cache, child does not
    vi.mocked(cacheService.delete)
      .mockResolvedValueOnce(true)   // org::root
      .mockResolvedValueOnce(false); // dept::child-a (was not cached)

    const result = await service.invalidateForProfile('tenant-abc', 'org::root');

    expect(result.invalidated).toBe(1);
    expect(result.identities).toEqual(['org::root', 'dept::child-a']);
  });

  it('falls back to deleteAll when descendant count exceeds 1000', async () => {
    const manyDescendants = Array.from({ length: 1001 }, (_, i) => `individual::leaf-${i}`);
    vi.mocked(hierarchyService.getDescendants).mockResolvedValue(manyDescendants);
    vi.mocked(cacheService.deleteAll).mockResolvedValue(500);

    const writeSpy = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);

    const result = await service.invalidateForProfile('tenant-abc', 'org::root');

    expect(cacheService.deleteAll).toHaveBeenCalledWith('tenant-abc');
    expect(cacheService.delete).not.toHaveBeenCalled();
    expect(result.invalidated).toBe(500);
    // identities still reports the full set
    expect(result.identities).toHaveLength(1002); // changed + 1001 descendants
    // Warning was emitted
    expect(writeSpy).toHaveBeenCalled();
    writeSpy.mockRestore();
  });
});

// ── invalidateAll ──────────────────────────────────────────────────────────

describe('CacheInvalidationService.invalidateAll', () => {
  let cacheService: ProfileCacheService;
  let service: CacheInvalidationService;

  beforeEach(() => {
    vi.clearAllMocks();
    cacheService = makeCacheService();
    service = new CacheInvalidationService(undefined, cacheService);
  });

  it('throws when tenantId is empty', async () => {
    await expect(service.invalidateAll('')).rejects.toThrow('tenantId is required');
  });

  it('calls deleteAll and returns the count', async () => {
    vi.mocked(cacheService.deleteAll).mockResolvedValue(7);

    const count = await service.invalidateAll('tenant-abc');
    expect(cacheService.deleteAll).toHaveBeenCalledWith('tenant-abc');
    expect(count).toBe(7);
  });

  it('returns 0 when cache is empty', async () => {
    vi.mocked(cacheService.deleteAll).mockResolvedValue(0);

    const count = await service.invalidateAll('tenant-abc');
    expect(count).toBe(0);
  });
});

// ── invalidateAndMaybeWarm ─────────────────────────────────────────────────

describe('CacheInvalidationService.invalidateAndMaybeWarm', () => {
  let hierarchyService: ProfileHierarchyService;
  let cacheService: ProfileCacheService;
  let service: CacheInvalidationService;

  beforeEach(() => {
    vi.clearAllMocks();
    hierarchyService = makeHierarchyService();
    cacheService = makeCacheService();
    service = new CacheInvalidationService(hierarchyService, cacheService);
  });

  it('does not warm cache when activeProfileCount is below threshold (20)', async () => {
    vi.mocked(hierarchyService.getDescendants).mockResolvedValue([]);
    vi.mocked(cacheService.delete).mockResolvedValue(true);

    await service.invalidateAndMaybeWarm('tenant-abc', 'org::root', 19);

    expect(cacheService.warmCache).not.toHaveBeenCalled();
  });

  it('warms cache when activeProfileCount meets threshold (20)', async () => {
    vi.mocked(hierarchyService.getDescendants).mockResolvedValue([]);
    vi.mocked(cacheService.delete).mockResolvedValue(true);

    await service.invalidateAndMaybeWarm('tenant-abc', 'org::root', 20);

    expect(cacheService.warmCache).toHaveBeenCalledWith('tenant-abc');
  });

  it('warms cache when activeProfileCount exceeds threshold', async () => {
    vi.mocked(hierarchyService.getDescendants).mockResolvedValue(['dept::child']);
    vi.mocked(cacheService.delete).mockResolvedValue(true);

    await service.invalidateAndMaybeWarm('tenant-abc', 'org::root', 100);

    expect(cacheService.warmCache).toHaveBeenCalledWith('tenant-abc');
  });

  it('returns the invalidation result', async () => {
    vi.mocked(hierarchyService.getDescendants).mockResolvedValue(['dept::child']);
    vi.mocked(cacheService.delete).mockResolvedValue(true);

    const result = await service.invalidateAndMaybeWarm('tenant-abc', 'org::root', 5);

    expect(result.identities).toEqual(['org::root', 'dept::child']);
    expect(result.invalidated).toBe(2);
  });
});
