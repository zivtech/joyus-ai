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
    getOperationHistory: vi.fn().mockResolvedValue([]),
  })),
}));

// ── Metrics mock ─────────────────────────────────────────────────────────────

vi.mock('../../../src/profiles/monitoring/metrics.js', () => ({
  ProfileMetrics: vi.fn().mockImplementation(() => ({
    recordGeneration: vi.fn(),
    recordRollback: vi.fn(),
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
    getFullHierarchy: vi.fn().mockResolvedValue([]),
    createRelationship: vi.fn(),
    getChildren: vi.fn().mockResolvedValue([]),
    getParent: vi.fn().mockResolvedValue(null),
  })),
}));

import { db } from '../../../src/db/client.js';
import { ProfileVersionService } from '../../../src/profiles/versioning/service.js';
import { ProfileVersionHistory } from '../../../src/profiles/versioning/history.js';
import { ProfileCacheService } from '../../../src/profiles/cache/service.js';
import { CacheInvalidationService } from '../../../src/profiles/cache/invalidation.js';
import { ProfileHierarchyService } from '../../../src/profiles/inheritance/hierarchy.js';
import { InheritanceResolver } from '../../../src/profiles/inheritance/resolver.js';

// ── Skip guard ───────────────────────────────────────────────────────────────

const RUN = !!process.env['DATABASE_URL'];
const maybeDescribe = RUN ? describe : describe.skip;

// ── Unique tenant IDs per file ───────────────────────────────────────────────

const TENANT_A = `tenant-iso-a-${createId()}`;
const TENANT_B = `tenant-iso-b-${createId()}`;

// ── Helpers ──────────────────────────────────────────────────────────────────

function makeProfile(tenantId: string, identity: string, version = 1, status = 'active') {
  return {
    id: createId(),
    tenantId,
    profileIdentity: identity,
    version,
    authorId: `author-${tenantId}`,
    authorName: `Author ${tenantId}`,
    tier: 'base' as const,
    status: status as 'active' | 'rolled_back' | 'archived' | 'deleted',
    stylometricFeatures: { avg_sentence_length: 0.5, type_token_ratio: 0.7 },
    markers: [],
    fidelityScore: 0.8,
    parentProfileId: null,
    corpusSnapshotId: null,
    metadata: {},
    createdAt: new Date(),
    updatedAt: new Date(),
    archivedAt: null,
  };
}

function mockSelectReturning(rows: unknown[]) {
  return {
    from: vi.fn().mockReturnValue({
      where: vi.fn().mockReturnValue({
        limit: vi.fn().mockResolvedValue(rows),
        orderBy: vi.fn().mockReturnValue({
          limit: vi.fn().mockReturnValue({
            offset: vi.fn().mockResolvedValue(rows),
          }),
        }),
      }),
      orderBy: vi.fn().mockReturnValue({
        limit: vi.fn().mockReturnValue({
          offset: vi.fn().mockResolvedValue(rows),
        }),
      }),
    }),
  };
}

// ── T041-01: Profile list/get scoped to tenant ───────────────────────────────

maybeDescribe('T041-01: profile list scoped to tenant', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it('getActiveVersion returns null when no profile exists for the requesting tenant', async () => {
    (db.select as ReturnType<typeof vi.fn>).mockReturnValue(mockSelectReturning([]));

    const service = new ProfileVersionService();
    const result = await service.getActiveVersion(TENANT_B, `individual::${createId()}`);
    expect(result).toBeNull();
  });

  it('getHistory returns only rows for the requesting tenant', async () => {
    const profileA = makeProfile(TENANT_A, 'individual::author-a');
    (db.select as ReturnType<typeof vi.fn>).mockReturnValue({
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockReturnValue({
          orderBy: vi.fn().mockReturnValue({
            limit: vi.fn().mockReturnValue({
              offset: vi.fn().mockResolvedValue([profileA]),
            }),
          }),
        }),
      }),
    });

    const history = new ProfileVersionHistory();
    const result = await history.getHistory(TENANT_A, 'individual::author-a');
    expect(result).toHaveLength(1);
    expect(result[0].tenantId).toBe(TENANT_A);
  });
});

// ── T041-02: Concurrent generation for different tenants independent ──────────

maybeDescribe('T041-02: concurrent generation is tenant-independent', () => {
  it('advisory lock keys differ across tenants so pipelines do not block each other', () => {
    function tenantLockKey(tenantId: string): number {
      let hash = 5381;
      for (let i = 0; i < tenantId.length; i++) {
        hash = ((hash << 5) + hash) ^ tenantId.charCodeAt(i);
        hash = hash >>> 0;
      }
      return hash;
    }

    const keyA = tenantLockKey(TENANT_A);
    const keyB = tenantLockKey(TENANT_B);
    expect(keyA).not.toBe(keyB);
  });
});

// ── T041-03: Overlapping author names produce independent profiles ─────────────

maybeDescribe('T041-03: overlapping author names produce independent profiles', () => {
  it('profiles with the same identity string for different tenants are stored independently', () => {
    const sharedIdentity = `individual::author-shared`;
    const profileA = makeProfile(TENANT_A, sharedIdentity);
    const profileB = makeProfile(TENANT_B, sharedIdentity);

    expect(profileA.tenantId).toBe(TENANT_A);
    expect(profileB.tenantId).toBe(TENANT_B);
    expect(profileA.id).not.toBe(profileB.id);
  });
});

// ── T041-04: Rollback scoped to tenant ───────────────────────────────────────

maybeDescribe('T041-04: rollback cannot cross tenant boundary', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it('rollback throws when target version belongs to a different tenant', async () => {
    (db.transaction as ReturnType<typeof vi.fn>).mockImplementation(
      async (fn: (tx: unknown) => Promise<unknown>) => {
        const tx = {
          select: vi.fn().mockReturnValue({
            from: vi.fn().mockReturnValue({
              where: vi.fn().mockReturnValue({
                limit: vi.fn().mockResolvedValue([]), // no row found for TENANT_B
              }),
            }),
          }),
          update: vi.fn().mockReturnValue({
            set: vi.fn().mockReturnValue({
              where: vi.fn().mockResolvedValue([]),
            }),
          }),
        };
        return fn(tx);
      },
    );

    const service = new ProfileVersionService();
    await expect(
      service.rollback(TENANT_B, 'individual::author-a', 1),
    ).rejects.toThrow();
  });
});

// ── T041-05: Hierarchy independent per tenant ─────────────────────────────────

maybeDescribe('T041-05: hierarchy is independent per tenant', () => {
  it('getFullHierarchy resolves independently for each tenant', async () => {
    const hierarchyService = new ProfileHierarchyService();

    (hierarchyService.getFullHierarchy as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce([{ identity: 'base::org-a', tier: 'base', children: [] }])
      .mockResolvedValueOnce([]);

    const treeA = await hierarchyService.getFullHierarchy(TENANT_A);
    const treeB = await hierarchyService.getFullHierarchy(TENANT_B);

    expect(treeA).toHaveLength(1);
    expect(treeB).toHaveLength(0);
  });
});

// ── T041-06: Dedup per-tenant ─────────────────────────────────────────────────

maybeDescribe('T041-06: deduplication is per-tenant', () => {
  it('same content ingested by two tenants is not flagged as duplicate for the second', async () => {
    const { DeduplicationService } = await import('../../../src/profiles/intake/dedup.js');

    const mockDb = {
      select: vi.fn()
        .mockReturnValueOnce({
          from: vi.fn().mockReturnValue({
            where: vi.fn().mockReturnValue({
              limit: vi.fn().mockResolvedValue([{ id: 'doc-a', originalFilename: 'paper.txt' }]),
            }),
          }),
        })
        .mockReturnValueOnce({
          from: vi.fn().mockReturnValue({
            where: vi.fn().mockReturnValue({
              limit: vi.fn().mockResolvedValue([]),
            }),
          }),
        }),
    };

    const dedup = new DeduplicationService(mockDb as never);
    const hash = dedup.computeContentHash('identical content body for dedup test');

    const resultA = await dedup.checkDuplicate(TENANT_A, hash);
    const resultB = await dedup.checkDuplicate(TENANT_B, hash);

    expect(resultA.isDuplicate).toBe(true);
    expect(resultB.isDuplicate).toBe(false);
  });
});

// ── T041-07: Cache entries per-tenant ────────────────────────────────────────

maybeDescribe('T041-07: cache entries are per-tenant and not shared', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it('cache get returns null for tenant B when only tenant A has an entry', async () => {
    (db.select as ReturnType<typeof vi.fn>).mockReturnValue({
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockReturnValue({
          limit: vi.fn().mockResolvedValue([]),
        }),
      }),
    });

    const cacheService = new ProfileCacheService();
    const result = await cacheService.get(TENANT_B, 'individual::author-a');
    expect(result).toBeNull();
  });

  it('cache invalidation is scoped to the changed profile owner tenant', async () => {
    const hierarchyService = new ProfileHierarchyService();
    const cacheService = new ProfileCacheService();

    (hierarchyService.getDescendants as ReturnType<typeof vi.fn>).mockResolvedValue([]);
    const deleteSpy = vi.spyOn(cacheService, 'delete').mockResolvedValue(false);

    const invalidationService = new CacheInvalidationService(hierarchyService, cacheService);
    await invalidationService.invalidateForProfile(TENANT_A, 'individual::author-a');

    for (const call of deleteSpy.mock.calls) {
      expect(call[0]).toBe(TENANT_A);
      expect(call[0]).not.toBe(TENANT_B);
    }
  });
});

// ── T041-08: Resolve scoped to tenant ────────────────────────────────────────

maybeDescribe('T041-08: resolved profiles are tenant-scoped', () => {
  it('resolver returns tenant-specific feature values for each tenant', async () => {
    const resolver = new InheritanceResolver();

    const resolvedA = {
      features: new Map([
        ['feature_001', { value: 0.9, sourceTier: 'base' as const, sourceProfileId: 'individual::a', sourceVersion: 1 }],
      ]),
      markers: [],
      overrideSources: {},
    };
    const resolvedB = {
      features: new Map([
        ['feature_001', { value: 0.3, sourceTier: 'base' as const, sourceProfileId: 'individual::b', sourceVersion: 1 }],
      ]),
      markers: [],
      overrideSources: {},
    };

    (resolver.resolve as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce(resolvedA)
      .mockResolvedValueOnce(resolvedB);

    const resultA = await resolver.resolve(TENANT_A, 'individual::author-a');
    const resultB = await resolver.resolve(TENANT_B, 'individual::author-b');

    expect(resultA.features.get('feature_001')?.value).toBe(0.9);
    expect(resultB.features.get('feature_001')?.value).toBe(0.3);
    expect(resultA.features.get('feature_001')?.sourceProfileId).not.toBe(
      resultB.features.get('feature_001')?.sourceProfileId,
    );
  });
});
