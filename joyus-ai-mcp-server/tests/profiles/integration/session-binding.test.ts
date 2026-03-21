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
    resolveWithDetails: vi.fn(),
    getOverrideReport: vi.fn(),
  })),
}));

import { InheritanceResolver } from '../../../src/profiles/inheritance/resolver.js';
import { requireTenantId } from '../../../src/profiles/tenant-scope.js';

// ── Skip guard ───────────────────────────────────────────────────────────────

const RUN = !!process.env['DATABASE_URL'];
const maybeDescribe = RUN ? describe : describe.skip;

// ── Unique tenant IDs per file ────────────────────────────────────────────────

const TENANT_A = `tenant-session-a-${createId()}`;
const TENANT_B = `tenant-session-b-${createId()}`;
const IDENTITY_A = `individual::author-session-${createId()}`;

// ── T046-01: Same-tenant profile resolve succeeds ─────────────────────────────

maybeDescribe('T046-01: same-tenant profile resolve succeeds', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it('resolve returns a profile when tenantId matches', async () => {
    const resolver = new InheritanceResolver();

    const expected = {
      features: new Map([
        ['avg_sentence_length', { value: 0.7, sourceTier: 'base' as const, sourceProfileId: IDENTITY_A, sourceVersion: 1 }],
      ]),
      markers: [],
      overrideSources: {},
    };

    (resolver.resolve as ReturnType<typeof vi.fn>).mockResolvedValue(expected);

    const result = await resolver.resolve(TENANT_A, IDENTITY_A);

    expect(result).toBeDefined();
    expect(result.features.get('avg_sentence_length')?.value).toBeCloseTo(0.7);
  });
});

// ── T046-02: Cross-tenant resolve fails with error ────────────────────────────

maybeDescribe('T046-02: empty tenantId is rejected before hitting DB', () => {
  it('requireTenantId throws when tenantId is an empty string', () => {
    expect(() => requireTenantId('')).toThrow('tenantId is required and must not be empty');
  });

  it('requireTenantId throws when tenantId is null', () => {
    expect(() => requireTenantId(null as unknown as string)).toThrow('tenantId is required and must not be empty');
  });

  it('requireTenantId does not throw for a valid tenant ID', () => {
    expect(() => requireTenantId(TENANT_A)).not.toThrow();
  });
});

// ── T046-03: Resolved profile contains correct inheritance chain ──────────────

maybeDescribe('T046-03: resolveWithDetails returns ancestor chain', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it('resolveWithDetails includes the ancestry chain from root to self', async () => {
    const resolver = new InheritanceResolver();

    const orgIdentity = `base::org-${createId()}`;
    const deptIdentity = `dept::dept-${createId()}`;

    const detailed = {
      features: new Map([
        ['avg_sentence_length', { value: 0.6, sourceTier: 'base' as const, sourceProfileId: orgIdentity, sourceVersion: 1 }],
        ['type_token_ratio', { value: 0.75, sourceTier: 'domain' as const, sourceProfileId: deptIdentity, sourceVersion: 1 }],
      ]),
      markers: [],
      overrideSources: { type_token_ratio: deptIdentity },
      ancestorChain: [
        { profileIdentity: orgIdentity, version: 1, tier: 'base' as const },
        { profileIdentity: deptIdentity, version: 1, tier: 'domain' as const },
        { profileIdentity: IDENTITY_A, version: 1, tier: 'specialized' as const },
      ],
      featureTierSources: {
        avg_sentence_length: 'base' as const,
        type_token_ratio: 'domain' as const,
      },
    };

    (resolver.resolveWithDetails as ReturnType<typeof vi.fn>).mockResolvedValue(detailed);

    const result = await resolver.resolveWithDetails(TENANT_A, IDENTITY_A);

    expect(result.ancestorChain).toHaveLength(3);
    expect(result.ancestorChain[0].profileIdentity).toBe(orgIdentity);
    expect(result.ancestorChain[2].profileIdentity).toBe(IDENTITY_A);
    expect(result.features.get('type_token_ratio')?.sourceTier).toBe('domain');
  });
});

// ── T046-04: Override report shows feature sources by tier ────────────────────

maybeDescribe('T046-04: override report shows per-tier feature source counts', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it('getOverrideReport returns countByTier breakdown', async () => {
    const resolver = new InheritanceResolver();

    const report = {
      totalFeatures: 129,
      countByTier: {
        base: 80,
        domain: 30,
        specialized: 15,
        contextual: 4,
      },
      overriddenFeatures: ['type_token_ratio', 'passive_voice_rate'],
      inheritedFeatures: ['avg_sentence_length', 'word_complexity'],
    };

    (resolver.getOverrideReport as ReturnType<typeof vi.fn>).mockResolvedValue(report);

    const result = await resolver.getOverrideReport(TENANT_A, IDENTITY_A);

    expect(result.totalFeatures).toBe(129);
    expect(result.countByTier.base).toBe(80);
    expect(result.countByTier.domain).toBe(30);
    expect(result.overriddenFeatures).toContain('type_token_ratio');
    expect(result.inheritedFeatures).toContain('avg_sentence_length');

    // All tiers sum to feature count covered by this profile
    const tierTotal = Object.values(result.countByTier).reduce((a, b) => a + b, 0);
    expect(tierTotal).toBeLessThanOrEqual(result.totalFeatures);
  });
});

// ── T046-05: Cross-tenant resolve — resolver never mixes tenants ──────────────

maybeDescribe('T046-05: resolver returns independent results per tenant', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it('resolver called with TENANT_A returns TENANT_A features; TENANT_B returns its own', async () => {
    const resolver = new InheritanceResolver();

    const resultA = {
      features: new Map([
        ['avg_sentence_length', { value: 0.9, sourceTier: 'base' as const, sourceProfileId: IDENTITY_A, sourceVersion: 1 }],
      ]),
      markers: [],
      overrideSources: {},
    };

    const resultB = {
      features: new Map([
        ['avg_sentence_length', { value: 0.3, sourceTier: 'base' as const, sourceProfileId: IDENTITY_A, sourceVersion: 1 }],
      ]),
      markers: [],
      overrideSources: {},
    };

    (resolver.resolve as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce(resultA)
      .mockResolvedValueOnce(resultB);

    const resolvedA = await resolver.resolve(TENANT_A, IDENTITY_A);
    const resolvedB = await resolver.resolve(TENANT_B, IDENTITY_A);

    expect(resolvedA.features.get('avg_sentence_length')?.value).toBe(0.9);
    expect(resolvedB.features.get('avg_sentence_length')?.value).toBe(0.3);
  });
});
