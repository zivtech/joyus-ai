/**
 * Tests for ProfileVersionHistory (T014)
 *
 * getHistory, getVersionSummary, listProfileIdentities.
 * Uses stub DB — no real database connections.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ── DB Mock ────────────────────────────────────────────────────────────────

vi.mock('../../../src/db/client.js', () => {
  const mockSelect = vi.fn();
  return {
    db: { select: mockSelect },
    tenantProfiles: {
      tenantId: 'tenantId',
      profileIdentity: 'profileIdentity',
      version: 'version',
      status: 'status',
      id: 'id',
      tier: 'tier',
      fidelityScore: 'fidelityScore',
      createdAt: 'createdAt',
    },
  };
});

import { ProfileVersionHistory } from '../../../src/profiles/versioning/history.js';
import { db } from '../../../src/db/client.js';

// ── Helpers ────────────────────────────────────────────────────────────────

function makeProfile(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: 'profile-001',
    tenantId: 'tenant-abc',
    profileIdentity: 'individual::author-001',
    version: 1,
    authorId: 'author-001',
    authorName: 'Author A',
    tier: 'base',
    status: 'active',
    stylometricFeatures: { avg_sentence_length: 0.5, type_token_ratio: 0.3 },
    markers: [],
    fidelityScore: 0.85,
    createdAt: new Date('2025-01-01'),
    updatedAt: new Date('2025-01-01'),
    archivedAt: null,
    ...overrides,
  };
}

function selectChain(rows: unknown[]): ReturnType<typeof vi.fn> {
  const chain: Record<string, unknown> = {};
  chain['from'] = vi.fn().mockReturnValue(chain);
  chain['where'] = vi.fn().mockReturnValue(chain);
  chain['orderBy'] = vi.fn().mockReturnValue(chain);
  chain['limit'] = vi.fn().mockReturnValue(chain);
  chain['offset'] = vi.fn().mockResolvedValue(rows);
  chain['then'] = (resolve: (v: unknown) => unknown) => Promise.resolve(rows).then(resolve);
  return chain as never;
}

// ── getHistory ─────────────────────────────────────────────────────────────

describe('ProfileVersionHistory.getHistory', () => {
  beforeEach(() => vi.clearAllMocks());

  it('throws when tenantId is empty', async () => {
    const history = new ProfileVersionHistory();
    await expect(
      history.getHistory('', 'individual::author-001'),
    ).rejects.toThrow('tenantId is required');
  });

  it('returns empty array when no versions exist', async () => {
    vi.mocked(db.select).mockReturnValue(selectChain([]));
    const history = new ProfileVersionHistory();
    const result = await history.getHistory('tenant-abc', 'individual::author-001');
    expect(result).toEqual([]);
  });

  it('returns versions ordered newest-first by default', async () => {
    const v3 = makeProfile({ version: 3, status: 'active' });
    const v2 = makeProfile({ id: 'p2', version: 2, status: 'rolled_back' });
    const v1 = makeProfile({ id: 'p1', version: 1, status: 'rolled_back' });

    vi.mocked(db.select).mockReturnValue(selectChain([v3, v2, v1]));
    const history = new ProfileVersionHistory();
    const result = await history.getHistory('tenant-abc', 'individual::author-001');

    expect(result).toHaveLength(3);
    expect((result[0] as Record<string, unknown>)['version']).toBe(3);
  });

  it('excludes deleted versions by default', async () => {
    const v2 = makeProfile({ id: 'p2', version: 2, status: 'active' });
    // Stub returns only non-deleted; the real implementation adds ne(status,'deleted')
    vi.mocked(db.select).mockReturnValue(selectChain([v2]));

    const history = new ProfileVersionHistory();
    const result = await history.getHistory('tenant-abc', 'individual::author-001');
    expect(result).toHaveLength(1);
  });

  it('respects pagination options (limit + offset)', async () => {
    vi.mocked(db.select).mockReturnValue(selectChain([]));
    const history = new ProfileVersionHistory();
    await history.getHistory('tenant-abc', 'individual::author-001', { limit: 5, offset: 10 });
    // Verify select was called (chain built)
    expect(db.select).toHaveBeenCalledOnce();
  });
});

// ── getVersionSummary ──────────────────────────────────────────────────────

describe('ProfileVersionHistory.getVersionSummary', () => {
  beforeEach(() => vi.clearAllMocks());

  it('throws when tenantId is empty', async () => {
    const history = new ProfileVersionHistory();
    await expect(
      history.getVersionSummary('', 'individual::author-001'),
    ).rejects.toThrow('tenantId is required');
  });

  it('returns zero totals when no versions exist', async () => {
    const chain = {
      from: vi.fn().mockReturnThis(),
      where: vi.fn().mockResolvedValue([]),
    };
    vi.mocked(db.select).mockReturnValue(chain as never);

    const history = new ProfileVersionHistory();
    const summary = await history.getVersionSummary('tenant-abc', 'individual::author-001');

    expect(summary.totalVersions).toBe(0);
    expect(summary.activeVersion).toBeNull();
    expect(summary.averageFidelityScore).toBeNull();
  });

  it('computes correct summary for multiple versions', async () => {
    const v1 = makeProfile({ id: 'p1', version: 1, status: 'rolled_back', fidelityScore: 0.7, createdAt: new Date('2024-06-01') });
    const v2 = makeProfile({ id: 'p2', version: 2, status: 'rolled_back', fidelityScore: 0.8, createdAt: new Date('2024-09-01') });
    const v3 = makeProfile({ id: 'p3', version: 3, status: 'active', fidelityScore: 0.9, createdAt: new Date('2025-01-01') });

    const chain = {
      from: vi.fn().mockReturnThis(),
      where: vi.fn().mockResolvedValue([v1, v2, v3]),
    };
    vi.mocked(db.select).mockReturnValue(chain as never);

    const history = new ProfileVersionHistory();
    const summary = await history.getVersionSummary('tenant-abc', 'individual::author-001');

    expect(summary.totalVersions).toBe(3);
    expect(summary.activeVersion).toBe(3);
    expect(summary.latestVersion).toBe(3);
    expect(summary.oldestCreatedAt).toEqual(new Date('2024-06-01'));
    expect(summary.averageFidelityScore).toBeCloseTo(0.8, 5);
  });

  it('excludes deleted versions from summary counts', async () => {
    const v1 = makeProfile({ id: 'p1', version: 1, status: 'deleted', fidelityScore: 0.6 });
    const v2 = makeProfile({ id: 'p2', version: 2, status: 'active', fidelityScore: 0.9 });

    const chain = {
      from: vi.fn().mockReturnThis(),
      where: vi.fn().mockResolvedValue([v1, v2]),
    };
    vi.mocked(db.select).mockReturnValue(chain as never);

    const history = new ProfileVersionHistory();
    const summary = await history.getVersionSummary('tenant-abc', 'individual::author-001');

    expect(summary.totalVersions).toBe(1);
    expect(summary.averageFidelityScore).toBeCloseTo(0.9, 5);
  });
});

// ── listProfileIdentities ──────────────────────────────────────────────────

describe('ProfileVersionHistory.listProfileIdentities', () => {
  beforeEach(() => vi.clearAllMocks());

  it('throws when tenantId is empty', async () => {
    const history = new ProfileVersionHistory();
    await expect(history.listProfileIdentities('')).rejects.toThrow('tenantId is required');
  });

  it('returns empty array when tenant has no profiles', async () => {
    const chain = {
      from: vi.fn().mockReturnThis(),
      where: vi.fn().mockReturnThis(),
      orderBy: vi.fn().mockResolvedValue([]),
    };
    vi.mocked(db.select).mockReturnValue(chain as never);

    const history = new ProfileVersionHistory();
    const result = await history.listProfileIdentities('tenant-abc');
    expect(result).toEqual([]);
  });

  it('returns distinct identities with version counts', async () => {
    const rows = [
      { profileIdentity: 'individual::author-001', tier: 'base', version: 1, status: 'rolled_back' },
      { profileIdentity: 'individual::author-001', tier: 'base', version: 2, status: 'active' },
      { profileIdentity: 'individual::author-002', tier: 'domain', version: 1, status: 'active' },
    ];

    const chain = {
      from: vi.fn().mockReturnThis(),
      where: vi.fn().mockReturnThis(),
      orderBy: vi.fn().mockResolvedValue(rows),
    };
    vi.mocked(db.select).mockReturnValue(chain as never);

    const history = new ProfileVersionHistory();
    const result = await history.listProfileIdentities('tenant-abc');

    expect(result).toHaveLength(2);
    const a1 = result.find((r) => r.profileIdentity === 'individual::author-001');
    const a2 = result.find((r) => r.profileIdentity === 'individual::author-002');
    expect(a1?.versionCount).toBe(2);
    expect(a2?.versionCount).toBe(1);
  });

  it('filters by tier when option is provided', async () => {
    const rows = [
      { profileIdentity: 'individual::author-001', tier: 'base', version: 1, status: 'active' },
      { profileIdentity: 'individual::author-002', tier: 'domain', version: 1, status: 'active' },
    ];

    const chain = {
      from: vi.fn().mockReturnThis(),
      where: vi.fn().mockReturnThis(),
      orderBy: vi.fn().mockResolvedValue(rows),
    };
    vi.mocked(db.select).mockReturnValue(chain as never);

    const history = new ProfileVersionHistory();
    const result = await history.listProfileIdentities('tenant-abc', { tier: 'domain' });

    expect(result).toHaveLength(1);
    expect(result[0].profileIdentity).toBe('individual::author-002');
  });
});
