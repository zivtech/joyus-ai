/**
 * Unit tests for profiles/inheritance/resolver.ts (T018 + T020 + T021)
 *
 * Stubs the DB client and hierarchy service — no real database required.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ── DB Mock ────────────────────────────────────────────────────────────────

vi.mock('../../../src/db/client.js', () => ({
  db: {
    select: vi.fn(),
  },
  tenantProfiles: {},
}));

// ── Logger mock ────────────────────────────────────────────────────────────

vi.mock('../../../src/profiles/monitoring/logger.js', () => ({
  ProfileOperationLogger: vi.fn().mockImplementation(() => ({
    logOperation: vi.fn().mockResolvedValue(undefined),
  })),
}));

import { InheritanceResolver } from '../../../src/profiles/inheritance/resolver.js';
import { ProfileHierarchyService } from '../../../src/profiles/inheritance/hierarchy.js';
import { db } from '../../../src/db/client.js';
import { FEATURE_COUNT } from '../../../src/profiles/types.js';

// ── Helpers ────────────────────────────────────────────────────────────────

function makeFeatures(count: number, baseValue = 0.5): Record<string, number> {
  const features: Record<string, number> = {};
  for (let i = 0; i < count; i++) {
    features[`feature_${i.toString().padStart(3, '0')}`] = baseValue;
  }
  return features;
}

function makeProfileRow(
  identity: string,
  features: Record<string, number>,
  overrides: Record<string, unknown> = {},
) {
  return {
    id: `id-${identity}`,
    profileIdentity: identity,
    version: 1,
    tier: 'base',
    stylometricFeatures: features,
    markers: [],
    ...overrides,
  };
}

/** Chainable select stub that resolves to rows. */
function selectChain(rows: unknown[]) {
  const chain: Record<string, unknown> = {};
  chain['from'] = vi.fn().mockReturnValue(chain);
  chain['where'] = vi.fn().mockReturnValue(chain);
  chain['limit'] = vi.fn().mockResolvedValue(rows);
  chain['then'] = (resolve: (v: unknown) => unknown) => Promise.resolve(rows).then(resolve);
  return chain as never;
}

function makeHierarchyService(overrides: Partial<ProfileHierarchyService> = {}): ProfileHierarchyService {
  return {
    createRelationship: vi.fn(),
    removeRelationship: vi.fn(),
    getParent: vi.fn(),
    getChildren: vi.fn(),
    getAncestorChain: vi.fn().mockResolvedValue(['self']),
    getDescendants: vi.fn().mockResolvedValue([]),
    getFullHierarchy: vi.fn().mockResolvedValue([]),
    ...overrides,
  } as unknown as ProfileHierarchyService;
}

// ── resolve ────────────────────────────────────────────────────────────────

describe('InheritanceResolver.resolve', () => {
  let hierarchyService: ProfileHierarchyService;
  let resolver: InheritanceResolver;

  beforeEach(() => {
    vi.clearAllMocks();
    hierarchyService = makeHierarchyService();
    resolver = new InheritanceResolver(hierarchyService);
  });

  it('throws when tenantId is empty', async () => {
    await expect(resolver.resolve('', 'individual::self')).rejects.toThrow('tenantId is required');
  });

  it('resolves orphan profile (no ancestors) using its own features', async () => {
    const feats = makeFeatures(FEATURE_COUNT, 0.5);
    vi.mocked(hierarchyService.getAncestorChain).mockResolvedValue(['individual::self']);
    vi.mocked(db.select).mockReturnValue(
      selectChain([makeProfileRow('individual::self', feats)]),
    );

    const result = await resolver.resolve('tenant-abc', 'individual::self');
    expect(result.features.size).toBe(FEATURE_COUNT);
    expect(result.overrideSources).toEqual({});
  });

  it('merges 3-tier hierarchy with nearest-ancestor-wins', async () => {
    // org sets all features; dept overrides first 3; individual overrides first 1
    const orgFeats = makeFeatures(FEATURE_COUNT, 0.10);
    const deptFeats: Record<string, number> = {
      feature_000: 0.20,
      feature_001: 0.21,
      feature_002: 0.22,
    };
    const indivFeats: Record<string, number> = { feature_000: 0.30 };

    vi.mocked(hierarchyService.getAncestorChain).mockResolvedValue([
      'individual::self', 'dept::mid', 'org::root',
    ]);

    // fetchActiveVersions calls db.select once per identity, ordered [root, dept, self]
    vi.mocked(db.select)
      .mockReturnValueOnce(selectChain([makeProfileRow('org::root', orgFeats, { tier: 'base' })]))
      .mockReturnValueOnce(selectChain([makeProfileRow('dept::mid', deptFeats, { tier: 'domain' })]))
      .mockReturnValueOnce(selectChain([makeProfileRow('individual::self', indivFeats, { tier: 'specialized' })]));

    const result = await resolver.resolve('tenant-abc', 'individual::self');

    // feature_000: individual wins (0.30)
    expect(result.features.get('feature_000')!.value).toBe(0.30);
    expect(result.features.get('feature_000')!.sourceTier).toBe('specialized');

    // feature_001: dept wins (0.21)
    expect(result.features.get('feature_001')!.value).toBe(0.21);
    expect(result.features.get('feature_001')!.sourceTier).toBe('domain');

    // feature_004: org wins (0.10)
    expect(result.features.get('feature_004')!.value).toBe(0.10);
    expect(result.features.get('feature_004')!.sourceTier).toBe('base');

    expect(result.features.size).toBe(FEATURE_COUNT);
  });

  it('handles missing active version for a profile gracefully (skips)', async () => {
    vi.mocked(hierarchyService.getAncestorChain).mockResolvedValue(['individual::self', 'org::root']);

    // org has no active version
    vi.mocked(db.select)
      .mockReturnValueOnce(selectChain([]))
      .mockReturnValueOnce(selectChain([makeProfileRow('individual::self', { feature_000: 0.5 })]));

    const result = await resolver.resolve('tenant-abc', 'individual::self');
    expect(result.features.get('feature_000')!.value).toBe(0.5);
  });
});

// ── resolveMultiple ────────────────────────────────────────────────────────

describe('InheritanceResolver.resolveMultiple', () => {
  let hierarchyService: ProfileHierarchyService;
  let resolver: InheritanceResolver;

  beforeEach(() => {
    vi.clearAllMocks();
    hierarchyService = makeHierarchyService();
    resolver = new InheritanceResolver(hierarchyService);
  });

  it('returns a map with one resolved profile per identity', async () => {
    vi.mocked(hierarchyService.getAncestorChain)
      .mockResolvedValueOnce(['org::a'])
      .mockResolvedValueOnce(['dept::b']);

    vi.mocked(db.select)
      .mockReturnValueOnce(selectChain([makeProfileRow('org::a', { feature_000: 0.1 })]))
      .mockReturnValueOnce(selectChain([makeProfileRow('dept::b', { feature_000: 0.2 })]));

    const result = await resolver.resolveMultiple('tenant-abc', ['org::a', 'dept::b']);
    expect(result.size).toBe(2);
    expect(result.get('org::a')!.features.get('feature_000')!.value).toBe(0.1);
    expect(result.get('dept::b')!.features.get('feature_000')!.value).toBe(0.2);
  });

  it('returns empty map for empty input array', async () => {
    const result = await resolver.resolveMultiple('tenant-abc', []);
    expect(result.size).toBe(0);
  });
});

// ── getOverrideReport ──────────────────────────────────────────────────────

describe('InheritanceResolver.getOverrideReport', () => {
  let hierarchyService: ProfileHierarchyService;
  let resolver: InheritanceResolver;

  beforeEach(() => {
    vi.clearAllMocks();
    hierarchyService = makeHierarchyService();
    resolver = new InheritanceResolver(hierarchyService);
  });

  it('reports totalFeatures as FEATURE_COUNT (129)', async () => {
    vi.mocked(hierarchyService.getAncestorChain).mockResolvedValue(['individual::self']);
    vi.mocked(db.select).mockReturnValue(
      selectChain([makeProfileRow('individual::self', makeFeatures(FEATURE_COUNT, 0.5))]),
    );

    const report = await resolver.getOverrideReport('tenant-abc', 'individual::self');
    expect(report.totalFeatures).toBe(FEATURE_COUNT);
  });

  it('counts features by tier correctly for a 3-tier hierarchy', async () => {
    const orgFeats = makeFeatures(FEATURE_COUNT, 0.10); // 129 features at base
    // dept overrides features 000, 001, 002 (3 overrides)
    const deptFeats = { feature_000: 0.20, feature_001: 0.21, feature_002: 0.22 };
    // individual overrides feature_000 only (1 override, stealing from dept)
    const indivFeats = { feature_000: 0.30 };

    vi.mocked(hierarchyService.getAncestorChain).mockResolvedValue([
      'individual::self', 'dept::mid', 'org::root',
    ]);

    vi.mocked(db.select)
      .mockReturnValueOnce(selectChain([makeProfileRow('org::root', orgFeats, { tier: 'base' })]))
      .mockReturnValueOnce(selectChain([makeProfileRow('dept::mid', deptFeats, { tier: 'domain' })]))
      .mockReturnValueOnce(selectChain([makeProfileRow('individual::self', indivFeats, { tier: 'specialized' })]));

    const report = await resolver.getOverrideReport('tenant-abc', 'individual::self');

    // feature_000: individual (specialized) wins
    // feature_001, feature_002: dept (domain) wins
    // remaining 126 features: base (org)
    expect(report.countByTier.specialized).toBe(1);
    expect(report.countByTier.domain).toBe(2);
    expect(report.countByTier.base).toBe(FEATURE_COUNT - 3);

    // feature_000 overridden twice (dept→individual); feature_001, feature_002 overridden by dept
    expect(report.overriddenFeatures).toContain('feature_000');
    expect(report.overriddenFeatures).toContain('feature_001');
    expect(report.overriddenFeatures).toContain('feature_002');
  });
});

// ── propagateChange ────────────────────────────────────────────────────────

describe('InheritanceResolver.propagateChange', () => {
  let hierarchyService: ProfileHierarchyService;
  let resolver: InheritanceResolver;

  beforeEach(() => {
    vi.clearAllMocks();
    hierarchyService = makeHierarchyService();
    resolver = new InheritanceResolver(hierarchyService);
  });

  it('returns empty affected list when profile has no descendants', async () => {
    vi.mocked(hierarchyService.getDescendants).mockResolvedValue([]);

    const result = await resolver.propagateChange('tenant-abc', 'individual::leaf');
    expect(result.affected).toEqual([]);
    expect(result.reresolved).toBe(0);
  });

  it('re-resolves all descendants and returns correct counts', async () => {
    vi.mocked(hierarchyService.getDescendants).mockResolvedValue([
      'dept::child-a', 'dept::child-b',
    ]);

    // getAncestorChain called once per descendant resolve
    vi.mocked(hierarchyService.getAncestorChain)
      .mockResolvedValueOnce(['dept::child-a', 'org::root'])
      .mockResolvedValueOnce(['dept::child-b', 'org::root']);

    vi.mocked(db.select)
      .mockReturnValueOnce(selectChain([makeProfileRow('org::root', makeFeatures(5, 0.1), { tier: 'base' })]))
      .mockReturnValueOnce(selectChain([makeProfileRow('dept::child-a', { feature_000: 0.2 }, { tier: 'domain' })]))
      .mockReturnValueOnce(selectChain([makeProfileRow('org::root', makeFeatures(5, 0.1), { tier: 'base' })]))
      .mockReturnValueOnce(selectChain([makeProfileRow('dept::child-b', { feature_000: 0.3 }, { tier: 'domain' })]));

    const result = await resolver.propagateChange('tenant-abc', 'org::root');
    expect(result.affected).toEqual(['dept::child-a', 'dept::child-b']);
    expect(result.reresolved).toBe(2);
  });

  it('throws when tenantId is empty', async () => {
    await expect(
      resolver.propagateChange('', 'org::root'),
    ).rejects.toThrow('tenantId is required');
  });
});
