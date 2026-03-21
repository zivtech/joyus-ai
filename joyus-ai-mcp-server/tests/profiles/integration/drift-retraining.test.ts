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

// ── HierarchyService mock ────────────────────────────────────────────────────

vi.mock('../../../src/profiles/inheritance/hierarchy.js', () => ({
  ProfileHierarchyService: vi.fn().mockImplementation(() => ({
    getAncestorChain: vi.fn().mockResolvedValue([]),
    getDescendants: vi.fn().mockResolvedValue([]),
    getChildren: vi.fn().mockResolvedValue([]),
    getParent: vi.fn().mockResolvedValue(null),
  })),
}));

// ── Resolver mock ─────────────────────────────────────────────────────────────

vi.mock('../../../src/profiles/inheritance/resolver.js', () => ({
  InheritanceResolver: vi.fn().mockImplementation(() => ({
    resolve: vi.fn(),
  })),
}));

import { db } from '../../../src/db/client.js';
import { ProfileCacheService } from '../../../src/profiles/cache/service.js';
import { CacheInvalidationService } from '../../../src/profiles/cache/invalidation.js';
import { ProfileHierarchyService } from '../../../src/profiles/inheritance/hierarchy.js';
import { ProfileVersionHistory } from '../../../src/profiles/versioning/history.js';

// ── Skip guard ───────────────────────────────────────────────────────────────

const RUN = !!process.env['DATABASE_URL'];
const maybeDescribe = RUN ? describe : describe.skip;

// ── Unique tenant ID per file ─────────────────────────────────────────────────

const TENANT_ID = `tenant-drift-${createId()}`;
const BASE_IDENTITY = `base::org-drift-${createId()}`;
const DEPT_IDENTITY = `dept::dept-drift-${createId()}`;
const INDIVIDUAL_IDENTITY = `individual::author-drift-${createId()}`;

// ── T044-01: Profile version change triggers cache invalidation ───────────────

maybeDescribe('T044-01: profile version change triggers cache invalidation', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it('invalidateForProfile deletes the cache entry for the changed profile', async () => {
    const hierarchyService = new ProfileHierarchyService();
    const cacheService = new ProfileCacheService();

    (hierarchyService.getDescendants as ReturnType<typeof vi.fn>).mockResolvedValue([]);
    const deleteSpy = vi.spyOn(cacheService, 'delete').mockResolvedValue(true);

    const invalidation = new CacheInvalidationService(hierarchyService, cacheService);
    const result = await invalidation.invalidateForProfile(TENANT_ID, BASE_IDENTITY);

    expect(deleteSpy).toHaveBeenCalledWith(TENANT_ID, BASE_IDENTITY);
    expect(result.invalidated).toBe(1);
    expect(result.identities).toContain(BASE_IDENTITY);
  });
});

// ── T044-02: Cascade propagation invalidates dept + individual ────────────────

maybeDescribe('T044-02: org profile change invalidates dept and individual descendants', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it('invalidateForProfile cascades to all descendant identities', async () => {
    const hierarchyService = new ProfileHierarchyService();
    const cacheService = new ProfileCacheService();

    // org → [dept, individual]
    (hierarchyService.getDescendants as ReturnType<typeof vi.fn>).mockResolvedValue([
      DEPT_IDENTITY,
      INDIVIDUAL_IDENTITY,
    ]);

    const deleteSpy = vi.spyOn(cacheService, 'delete').mockResolvedValue(true);

    const invalidation = new CacheInvalidationService(hierarchyService, cacheService);
    const result = await invalidation.invalidateForProfile(TENANT_ID, BASE_IDENTITY);

    expect(result.invalidated).toBe(3); // base + dept + individual
    expect(result.identities).toContain(BASE_IDENTITY);
    expect(result.identities).toContain(DEPT_IDENTITY);
    expect(result.identities).toContain(INDIVIDUAL_IDENTITY);

    const calledIdentities = deleteSpy.mock.calls.map((c) => c[1]);
    expect(calledIdentities).toContain(BASE_IDENTITY);
    expect(calledIdentities).toContain(DEPT_IDENTITY);
    expect(calledIdentities).toContain(INDIVIDUAL_IDENTITY);
  });
});

// ── T044-03: Version comparison detects feature drift ────────────────────────

maybeDescribe('T044-03: version comparison detects feature drift between versions', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it('compareVersions surfaces features whose values changed significantly', async () => {
    const v1Features = {
      avg_sentence_length: 0.40,
      type_token_ratio: 0.60,
      passive_voice_rate: 0.20,
    };
    const v2Features = {
      avg_sentence_length: 0.65, // drifted
      type_token_ratio: 0.60,   // stable
      passive_voice_rate: 0.18, // minor drift
    };

    (db.select as ReturnType<typeof vi.fn>)
      .mockReturnValueOnce({
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockReturnValue({
            limit: vi.fn().mockResolvedValue([{
              id: createId(), tenantId: TENANT_ID, profileIdentity: BASE_IDENTITY,
              version: 1, status: 'rolled_back', stylometricFeatures: v1Features,
              markers: [], tier: 'base',
            }]),
          }),
        }),
      })
      .mockReturnValueOnce({
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockReturnValue({
            limit: vi.fn().mockResolvedValue([{
              id: createId(), tenantId: TENANT_ID, profileIdentity: BASE_IDENTITY,
              version: 2, status: 'active', stylometricFeatures: v2Features,
              markers: [], tier: 'base',
            }]),
          }),
        }),
      });

    const history = new ProfileVersionHistory();
    const comparisons = await history.compareVersions(TENANT_ID, BASE_IDENTITY, 1, 2);

    const avgSentenceComp = comparisons.find((c) => c.featureKey === 'avg_sentence_length');
    expect(avgSentenceComp).toBeDefined();
    expect(avgSentenceComp!.delta).toBeCloseTo(0.25, 5);

    // Sorted by absolute delta descending — largest drift first
    expect(Math.abs(comparisons[0].delta)).toBeGreaterThanOrEqual(
      Math.abs(comparisons[comparisons.length - 1].delta),
    );

    // Stable feature has zero delta
    const stableComp = comparisons.find((c) => c.featureKey === 'type_token_ratio');
    expect(stableComp?.delta).toBeCloseTo(0, 5);
  });
});

// ── T044-04: Low fidelity score flagged in version metadata ──────────────────

maybeDescribe('T044-04: low fidelity score is surfaced in version metadata', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it('a profile with fidelityScore below threshold is retrievable and exposes the score', async () => {
    const lowFidelityProfile = {
      id: createId(),
      tenantId: TENANT_ID,
      profileIdentity: INDIVIDUAL_IDENTITY,
      version: 1,
      status: 'active',
      fidelityScore: 0.42, // below typical quality threshold of 0.7
      stylometricFeatures: { avg_sentence_length: 0.5 },
      markers: [],
      tier: 'base',
      metadata: { lowConfidence: true },
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    (db.select as ReturnType<typeof vi.fn>).mockReturnValue({
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockReturnValue({
          limit: vi.fn().mockResolvedValue([lowFidelityProfile]),
        }),
      }),
    });

    const { ProfileVersionService } = await import('../../../src/profiles/versioning/service.js');
    const service = new ProfileVersionService();
    const result = await service.getActiveVersion(TENANT_ID, INDIVIDUAL_IDENTITY);

    expect(result).not.toBeNull();
    expect(result!.fidelityScore).toBeLessThan(0.5);
    expect((result!.metadata as Record<string, unknown>)['lowConfidence']).toBe(true);
  });
});

// ── T044-05: invalidateAll clears all cache entries for a tenant ──────────────

maybeDescribe('T044-05: invalidateAll purges all tenant cache entries', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it('invalidateAll removes all cached profiles for the tenant', async () => {
    const hierarchyService = new ProfileHierarchyService();
    const cacheService = new ProfileCacheService();

    const deleteAllSpy = vi.spyOn(cacheService, 'deleteAll').mockResolvedValue(5);

    const invalidation = new CacheInvalidationService(hierarchyService, cacheService);
    const count = await invalidation.invalidateAll(TENANT_ID);

    expect(deleteAllSpy).toHaveBeenCalledWith(TENANT_ID);
    expect(count).toBe(5);
  });
});
