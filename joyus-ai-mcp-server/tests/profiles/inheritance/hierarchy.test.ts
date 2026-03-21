/**
 * Unit tests for profiles/inheritance/hierarchy.ts (T017)
 *
 * All DB operations are stubbed — no real database required.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ── DB Mock ────────────────────────────────────────────────────────────────

vi.mock('../../../src/db/client.js', () => {
  return {
    db: {
      select: vi.fn(),
      insert: vi.fn(),
      delete: vi.fn(),
    },
    profileInheritance: {},
  };
});

// ── Logger mock ────────────────────────────────────────────────────────────

vi.mock('../../../src/profiles/monitoring/logger.js', () => ({
  ProfileOperationLogger: vi.fn().mockImplementation(() => ({
    logOperation: vi.fn().mockResolvedValue(undefined),
  })),
}));

import { ProfileHierarchyService } from '../../../src/profiles/inheritance/hierarchy.js';
import { db } from '../../../src/db/client.js';

// ── Helpers ────────────────────────────────────────────────────────────────

function makeRow(
  parentProfileIdentity: string,
  childProfileIdentity: string,
  tenantId = 'tenant-abc',
) {
  return {
    id: `row-${parentProfileIdentity}-${childProfileIdentity}`,
    tenantId,
    parentProfileIdentity,
    childProfileIdentity,
    createdAt: new Date(),
  };
}

/** Chainable select stub that resolves to `rows`. */
function selectChain(rows: unknown[]) {
  const chain: Record<string, unknown> = {};
  chain['from'] = vi.fn().mockReturnValue(chain);
  chain['where'] = vi.fn().mockReturnValue(chain);
  chain['orderBy'] = vi.fn().mockReturnValue(chain);
  chain['limit'] = vi.fn().mockResolvedValue(rows);
  chain['then'] = (resolve: (v: unknown) => unknown) => Promise.resolve(rows).then(resolve);
  return chain as never;
}

function makeInsertChain(returning: unknown[]) {
  return {
    values: vi.fn().mockReturnThis(),
    returning: vi.fn().mockResolvedValue(returning),
  };
}

function makeDeleteChain(rows: unknown[]) {
  return {
    where: vi.fn().mockResolvedValue(rows),
  };
}

// ── Tests ──────────────────────────────────────────────────────────────────

describe('ProfileHierarchyService.createRelationship', () => {
  let service: ProfileHierarchyService;

  beforeEach(() => {
    vi.clearAllMocks();
    service = new ProfileHierarchyService();
  });

  it('throws when tenantId is empty', async () => {
    await expect(
      service.createRelationship('', 'org::parent', 'dept::child'),
    ).rejects.toThrow('tenantId is required');
  });

  it('throws when parent and child are the same identity', async () => {
    await expect(
      service.createRelationship('tenant-abc', 'org::same', 'org::same'),
    ).rejects.toThrow('Cannot create self-referential hierarchy');
  });

  it('inserts and returns the new row on success', async () => {
    const expectedRow = makeRow('org::parent', 'dept::child');

    // getAncestorChain will call getParent once for 'org::parent' → null (root)
    vi.mocked(db.select)
      .mockReturnValueOnce(selectChain([])); // getParent for 'org::parent' → no parent

    vi.mocked(db.insert).mockReturnValue(makeInsertChain([expectedRow]) as never);

    const result = await service.createRelationship('tenant-abc', 'org::parent', 'dept::child');
    expect(result.parentProfileIdentity).toBe('org::parent');
    expect(result.childProfileIdentity).toBe('dept::child');
  });

  it('detects circular reference: child is ancestor of parent', async () => {
    // Relationship: org::root → dept::mid → individual::leaf
    // Now trying: individual::leaf → org::root (cycle)
    // getAncestorChain('individual::leaf'): [individual::leaf, dept::mid, org::root]
    vi.mocked(db.select)
      // getParent('individual::leaf') → dept::mid
      .mockReturnValueOnce(selectChain([makeRow('dept::mid', 'individual::leaf')]))
      // getParent('dept::mid') → org::root
      .mockReturnValueOnce(selectChain([makeRow('org::root', 'dept::mid')]))
      // getParent('org::root') → null
      .mockReturnValueOnce(selectChain([]));

    await expect(
      service.createRelationship('tenant-abc', 'individual::leaf', 'org::root'),
    ).rejects.toThrow('Circular reference detected');
  });

  it('rejects when resulting depth would exceed MAX_HIERARCHY_DEPTH', async () => {
    // Build an ancestor chain of 10 profiles (at the max) so adding 1 more would exceed
    const chain = Array.from({ length: 10 }, (_, i) => `org::level-${i}`);

    // Each getParent call returns the next ancestor
    for (let i = 0; i < 10; i++) {
      if (i < 9) {
        vi.mocked(db.select).mockReturnValueOnce(
          selectChain([makeRow(chain[i + 1], chain[i])]),
        );
      } else {
        vi.mocked(db.select).mockReturnValueOnce(selectChain([])); // root
      }
    }

    await expect(
      service.createRelationship('tenant-abc', chain[0], 'individual::new'),
    ).rejects.toThrow('depth limit exceeded');
  });
});

describe('ProfileHierarchyService.removeRelationship', () => {
  let service: ProfileHierarchyService;

  beforeEach(() => {
    vi.clearAllMocks();
    service = new ProfileHierarchyService();
  });

  it('returns true when a row is deleted', async () => {
    vi.mocked(db.delete).mockReturnValue(
      makeDeleteChain([makeRow('org::parent', 'dept::child')]) as never,
    );

    const result = await service.removeRelationship('tenant-abc', 'org::parent', 'dept::child');
    expect(result).toBe(true);
  });

  it('returns false when the relationship does not exist', async () => {
    vi.mocked(db.delete).mockReturnValue(makeDeleteChain([]) as never);

    const result = await service.removeRelationship('tenant-abc', 'org::parent', 'dept::missing');
    expect(result).toBe(false);
  });

  it('throws when tenantId is empty', async () => {
    await expect(
      service.removeRelationship('', 'org::parent', 'dept::child'),
    ).rejects.toThrow('tenantId is required');
  });
});

describe('ProfileHierarchyService.getParent', () => {
  let service: ProfileHierarchyService;

  beforeEach(() => {
    vi.clearAllMocks();
    service = new ProfileHierarchyService();
  });

  it('returns parent identity when found', async () => {
    vi.mocked(db.select).mockReturnValue(
      selectChain([makeRow('org::parent', 'dept::child')]),
    );

    const parent = await service.getParent('tenant-abc', 'dept::child');
    expect(parent).toBe('org::parent');
  });

  it('returns null when no parent exists', async () => {
    vi.mocked(db.select).mockReturnValue(selectChain([]));

    const parent = await service.getParent('tenant-abc', 'org::root');
    expect(parent).toBeNull();
  });
});

describe('ProfileHierarchyService.getChildren', () => {
  let service: ProfileHierarchyService;

  beforeEach(() => {
    vi.clearAllMocks();
    service = new ProfileHierarchyService();
  });

  it('returns all child identities', async () => {
    vi.mocked(db.select).mockReturnValue(
      selectChain([
        makeRow('org::parent', 'dept::child-a'),
        makeRow('org::parent', 'dept::child-b'),
      ]),
    );

    const children = await service.getChildren('tenant-abc', 'org::parent');
    expect(children).toEqual(['dept::child-a', 'dept::child-b']);
  });

  it('returns empty array when no children', async () => {
    vi.mocked(db.select).mockReturnValue(selectChain([]));

    const children = await service.getChildren('tenant-abc', 'individual::leaf');
    expect(children).toEqual([]);
  });
});

describe('ProfileHierarchyService.getAncestorChain', () => {
  let service: ProfileHierarchyService;

  beforeEach(() => {
    vi.clearAllMocks();
    service = new ProfileHierarchyService();
  });

  it('returns [self] for a root profile with no parent', async () => {
    vi.mocked(db.select).mockReturnValue(selectChain([]));

    const chain = await service.getAncestorChain('tenant-abc', 'org::root');
    expect(chain).toEqual(['org::root']);
  });

  it('returns [self, parent, root] for a 3-level chain', async () => {
    vi.mocked(db.select)
      // getParent('individual::leaf') → dept::mid
      .mockReturnValueOnce(selectChain([makeRow('dept::mid', 'individual::leaf')]))
      // getParent('dept::mid') → org::root
      .mockReturnValueOnce(selectChain([makeRow('org::root', 'dept::mid')]))
      // getParent('org::root') → null
      .mockReturnValueOnce(selectChain([]));

    const chain = await service.getAncestorChain('tenant-abc', 'individual::leaf');
    expect(chain).toEqual(['individual::leaf', 'dept::mid', 'org::root']);
  });
});

describe('ProfileHierarchyService.getDescendants', () => {
  let service: ProfileHierarchyService;

  beforeEach(() => {
    vi.clearAllMocks();
    service = new ProfileHierarchyService();
  });

  it('returns empty array for a leaf profile', async () => {
    vi.mocked(db.select).mockReturnValue(selectChain([]));

    const descendants = await service.getDescendants('tenant-abc', 'individual::leaf');
    expect(descendants).toEqual([]);
  });

  it('returns all descendants via breadth-first traversal', async () => {
    vi.mocked(db.select)
      // getChildren('org::root') → [dept::child-a, dept::child-b]
      .mockReturnValueOnce(selectChain([
        makeRow('org::root', 'dept::child-a'),
        makeRow('org::root', 'dept::child-b'),
      ]))
      // getChildren('dept::child-a') → [individual::leaf-a]
      .mockReturnValueOnce(selectChain([makeRow('dept::child-a', 'individual::leaf-a')]))
      // getChildren('dept::child-b') → []
      .mockReturnValueOnce(selectChain([]))
      // getChildren('individual::leaf-a') → []
      .mockReturnValueOnce(selectChain([]));

    const descendants = await service.getDescendants('tenant-abc', 'org::root');
    expect(descendants).toEqual(['dept::child-a', 'dept::child-b', 'individual::leaf-a']);
  });
});

describe('ProfileHierarchyService.getFullHierarchy', () => {
  let service: ProfileHierarchyService;

  beforeEach(() => {
    vi.clearAllMocks();
    service = new ProfileHierarchyService();
  });

  it('returns empty array when no relationships exist', async () => {
    vi.mocked(db.select).mockReturnValue(selectChain([]));

    const tree = await service.getFullHierarchy('tenant-abc');
    expect(tree).toEqual([]);
  });

  it('returns correct tree structure for a simple hierarchy', async () => {
    vi.mocked(db.select).mockReturnValue(
      selectChain([
        makeRow('org::root', 'dept::child-a'),
        makeRow('dept::child-a', 'individual::leaf'),
      ]),
    );

    const tree = await service.getFullHierarchy('tenant-abc');
    expect(tree).toHaveLength(1);
    expect(tree[0].identity).toBe('org::root');
    expect(tree[0].children).toHaveLength(1);
    expect(tree[0].children[0].identity).toBe('dept::child-a');
    expect(tree[0].children[0].children[0].identity).toBe('individual::leaf');
  });
});
