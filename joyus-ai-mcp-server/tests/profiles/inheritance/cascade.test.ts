/**
 * Unit tests for cascade propagation (T021) via InheritanceResolver.propagateChange
 *
 * Focused tests on subtree propagation correctness.
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

// ── Helpers ────────────────────────────────────────────────────────────────

function makeProfileRow(identity: string, features: Record<string, number>, overrides: Record<string, unknown> = {}) {
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

// ── Tests ──────────────────────────────────────────────────────────────────

describe('propagateChange — subtree correctness', () => {
  let hierarchyService: ProfileHierarchyService;
  let resolver: InheritanceResolver;

  beforeEach(() => {
    vi.clearAllMocks();
    hierarchyService = makeHierarchyService();
    resolver = new InheritanceResolver(hierarchyService);
  });

  it('only propagates to descendants of the changed profile, not unrelated profiles', async () => {
    // Changed: org::root; descendants: dept::child-a
    // unrelated: org::other (not a descendant)
    vi.mocked(hierarchyService.getDescendants).mockResolvedValue(['dept::child-a']);

    vi.mocked(hierarchyService.getAncestorChain).mockResolvedValue([
      'dept::child-a', 'org::root',
    ]);

    vi.mocked(db.select)
      .mockReturnValueOnce(selectChain([makeProfileRow('org::root', { feature_000: 0.1 })]))
      .mockReturnValueOnce(selectChain([makeProfileRow('dept::child-a', { feature_000: 0.2 })]));

    const result = await resolver.propagateChange('tenant-abc', 'org::root');

    expect(result.affected).toEqual(['dept::child-a']);
    expect(result.affected).not.toContain('org::other');
    expect(result.reresolved).toBe(1);
  });

  it('propagates through the full subtree (multi-level)', async () => {
    // org::root → dept::mid → individual::leaf
    vi.mocked(hierarchyService.getDescendants).mockResolvedValue([
      'dept::mid', 'individual::leaf',
    ]);

    vi.mocked(hierarchyService.getAncestorChain)
      .mockResolvedValueOnce(['dept::mid', 'org::root'])
      .mockResolvedValueOnce(['individual::leaf', 'dept::mid', 'org::root']);

    vi.mocked(db.select)
      // resolve dept::mid → [org::root, dept::mid]
      .mockReturnValueOnce(selectChain([makeProfileRow('org::root', { feature_000: 0.1 })]))
      .mockReturnValueOnce(selectChain([makeProfileRow('dept::mid', { feature_000: 0.2 })]))
      // resolve individual::leaf → [org::root, dept::mid, individual::leaf]
      .mockReturnValueOnce(selectChain([makeProfileRow('org::root', { feature_000: 0.1 })]))
      .mockReturnValueOnce(selectChain([makeProfileRow('dept::mid', { feature_000: 0.2 })]))
      .mockReturnValueOnce(selectChain([makeProfileRow('individual::leaf', { feature_000: 0.3 })]));

    const result = await resolver.propagateChange('tenant-abc', 'org::root');

    expect(result.affected).toContain('dept::mid');
    expect(result.affected).toContain('individual::leaf');
    expect(result.reresolved).toBe(2);
  });

  it('handles a large subtree without error', async () => {
    const descendants = Array.from({ length: 20 }, (_, i) => `individual::member-${i}`);
    vi.mocked(hierarchyService.getDescendants).mockResolvedValue(descendants);

    // Each descendant resolve: ancestor chain = [self, org::root]
    for (const identity of descendants) {
      vi.mocked(hierarchyService.getAncestorChain).mockResolvedValueOnce([identity, 'org::root']);
    }

    // db.select: for each descendant, 2 calls (org::root + self)
    for (const identity of descendants) {
      vi.mocked(db.select)
        .mockReturnValueOnce(selectChain([makeProfileRow('org::root', { feature_000: 0.1 })]))
        .mockReturnValueOnce(selectChain([makeProfileRow(identity, { feature_000: 0.5 })]));
    }

    const result = await resolver.propagateChange('tenant-abc', 'org::root');
    expect(result.affected).toHaveLength(20);
    expect(result.reresolved).toBe(20);
  });

  it('returns correct reresolved count even when some descendants have no active version', async () => {
    vi.mocked(hierarchyService.getDescendants).mockResolvedValue([
      'dept::child-a', 'dept::child-b',
    ]);

    vi.mocked(hierarchyService.getAncestorChain)
      .mockResolvedValueOnce(['dept::child-a'])
      .mockResolvedValueOnce(['dept::child-b']);

    // child-a has no active version (empty result)
    vi.mocked(db.select)
      .mockReturnValueOnce(selectChain([]))
      .mockReturnValueOnce(selectChain([makeProfileRow('dept::child-b', { feature_000: 0.2 })]));

    // Resolve still succeeds (features map is empty for child-a but no error)
    const result = await resolver.propagateChange('tenant-abc', 'org::root');
    expect(result.reresolved).toBe(2); // both were re-resolved (even if result is empty)
  });
});
