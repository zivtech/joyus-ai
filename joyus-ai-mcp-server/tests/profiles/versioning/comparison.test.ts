/**
 * Tests for ProfileVersionHistory.compareVersions and compareWithActive (T016)
 *
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
    },
  };
});

import { ProfileVersionHistory } from '../../../src/profiles/versioning/history.js';
import { ProfileNotFoundError } from '../../../src/profiles/versioning/service.js';
import { db } from '../../../src/db/client.js';

// ── Helpers ────────────────────────────────────────────────────────────────

function makeProfile(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: 'profile-001',
    tenantId: 'tenant-abc',
    profileIdentity: 'individual::author-001',
    version: 1,
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
  chain['limit'] = vi.fn().mockResolvedValue(rows);
  chain['then'] = (resolve: (v: unknown) => unknown) => Promise.resolve(rows).then(resolve);
  return chain as never;
}

// ── compareVersions ────────────────────────────────────────────────────────

describe('ProfileVersionHistory.compareVersions', () => {
  beforeEach(() => vi.clearAllMocks());

  it('throws when tenantId is empty', async () => {
    const history = new ProfileVersionHistory();
    await expect(
      history.compareVersions('', 'individual::author-001', 1, 2),
    ).rejects.toThrow('tenantId is required');
  });

  it('throws ProfileNotFoundError when versionA does not exist', async () => {
    vi.mocked(db.select).mockReturnValue(selectChain([]));

    const history = new ProfileVersionHistory();
    await expect(
      history.compareVersions('tenant-abc', 'individual::author-001', 1, 2),
    ).rejects.toBeInstanceOf(ProfileNotFoundError);
  });

  it('throws ProfileNotFoundError when versionB does not exist', async () => {
    const v1 = makeProfile({ version: 1, stylometricFeatures: { avg_sentence_length: 0.4 } });

    let selectCallCount = 0;
    vi.mocked(db.select).mockImplementation(() => {
      selectCallCount += 1;
      if (selectCallCount === 1) return selectChain([v1]); // versionA found
      return selectChain([]); // versionB not found
    });

    const history = new ProfileVersionHistory();
    await expect(
      history.compareVersions('tenant-abc', 'individual::author-001', 1, 2),
    ).rejects.toBeInstanceOf(ProfileNotFoundError);
  });

  it('returns empty array when both versions have no features', async () => {
    const v1 = makeProfile({ version: 1, stylometricFeatures: {} });
    const v2 = makeProfile({ version: 2, stylometricFeatures: {} });

    let callCount = 0;
    vi.mocked(db.select).mockImplementation(() => {
      callCount += 1;
      return selectChain(callCount === 1 ? [v1] : [v2]);
    });

    const history = new ProfileVersionHistory();
    const result = await history.compareVersions('tenant-abc', 'individual::author-001', 1, 2);
    expect(result).toEqual([]);
  });

  it('computes delta and percentChange for shared features', async () => {
    const v1 = makeProfile({ version: 1, stylometricFeatures: { avg_sentence_length: 0.4 } });
    const v2 = makeProfile({ version: 2, stylometricFeatures: { avg_sentence_length: 0.6 } });

    let callCount = 0;
    vi.mocked(db.select).mockImplementation(() => {
      callCount += 1;
      return selectChain(callCount === 1 ? [v1] : [v2]);
    });

    const history = new ProfileVersionHistory();
    const result = await history.compareVersions('tenant-abc', 'individual::author-001', 1, 2);

    expect(result).toHaveLength(1);
    expect(result[0].featureKey).toBe('avg_sentence_length');
    expect(result[0].oldValue).toBeCloseTo(0.4);
    expect(result[0].newValue).toBeCloseTo(0.6);
    expect(result[0].delta).toBeCloseTo(0.2);
    expect(result[0].percentChange).toBeCloseTo(50); // (0.2 / 0.4) * 100
  });

  it('handles features present in only one version (missing side = 0)', async () => {
    const v1 = makeProfile({ version: 1, stylometricFeatures: { feat_a: 0.5 } });
    const v2 = makeProfile({ version: 2, stylometricFeatures: { feat_b: 0.8 } });

    let callCount = 0;
    vi.mocked(db.select).mockImplementation(() => {
      callCount += 1;
      return selectChain(callCount === 1 ? [v1] : [v2]);
    });

    const history = new ProfileVersionHistory();
    const result = await history.compareVersions('tenant-abc', 'individual::author-001', 1, 2);

    const featA = result.find((r) => r.featureKey === 'feat_a');
    const featB = result.find((r) => r.featureKey === 'feat_b');

    expect(featA?.oldValue).toBeCloseTo(0.5);
    expect(featA?.newValue).toBeCloseTo(0);
    expect(featA?.delta).toBeCloseTo(-0.5);

    expect(featB?.oldValue).toBeCloseTo(0);
    expect(featB?.newValue).toBeCloseTo(0.8);
    expect(featB?.delta).toBeCloseTo(0.8);
  });

  it('handles division by zero: percentChange is Infinity when oldValue is 0 and delta is non-zero', async () => {
    const v1 = makeProfile({ version: 1, stylometricFeatures: { new_feat: 0 } });
    const v2 = makeProfile({ version: 2, stylometricFeatures: { new_feat: 0.5 } });

    let callCount = 0;
    vi.mocked(db.select).mockImplementation(() => {
      callCount += 1;
      return selectChain(callCount === 1 ? [v1] : [v2]);
    });

    const history = new ProfileVersionHistory();
    const result = await history.compareVersions('tenant-abc', 'individual::author-001', 1, 2);

    expect(result[0].percentChange).toBe(Infinity);
  });

  it('sets percentChange to 0 when both values are 0', async () => {
    const v1 = makeProfile({ version: 1, stylometricFeatures: { stable_feat: 0 } });
    const v2 = makeProfile({ version: 2, stylometricFeatures: { stable_feat: 0 } });

    let callCount = 0;
    vi.mocked(db.select).mockImplementation(() => {
      callCount += 1;
      return selectChain(callCount === 1 ? [v1] : [v2]);
    });

    const history = new ProfileVersionHistory();
    const result = await history.compareVersions('tenant-abc', 'individual::author-001', 1, 2);

    expect(result[0].percentChange).toBe(0);
    expect(result[0].delta).toBe(0);
  });

  it('sorts results by absolute delta descending', async () => {
    const v1 = makeProfile({
      version: 1,
      stylometricFeatures: { small: 0.1, large: 0.1, medium: 0.1 },
    });
    const v2 = makeProfile({
      version: 2,
      stylometricFeatures: { small: 0.15, large: 0.9, medium: 0.4 },
    });

    let callCount = 0;
    vi.mocked(db.select).mockImplementation(() => {
      callCount += 1;
      return selectChain(callCount === 1 ? [v1] : [v2]);
    });

    const history = new ProfileVersionHistory();
    const result = await history.compareVersions('tenant-abc', 'individual::author-001', 1, 2);

    expect(result[0].featureKey).toBe('large');   // delta = 0.8
    expect(result[1].featureKey).toBe('medium');  // delta = 0.3
    expect(result[2].featureKey).toBe('small');   // delta = 0.05
  });
});

// ── compareWithActive ──────────────────────────────────────────────────────

describe('ProfileVersionHistory.compareWithActive', () => {
  beforeEach(() => vi.clearAllMocks());

  it('throws ProfileNotFoundError when no active version exists', async () => {
    vi.mocked(db.select).mockReturnValue(selectChain([]));

    const history = new ProfileVersionHistory();
    await expect(
      history.compareWithActive('tenant-abc', 'individual::author-001', 1),
    ).rejects.toBeInstanceOf(ProfileNotFoundError);
  });

  it('compares the given version against the active version', async () => {
    const activeV3 = makeProfile({
      version: 3,
      status: 'active',
      stylometricFeatures: { avg_sentence_length: 0.7 },
    });
    const v1 = makeProfile({
      version: 1,
      status: 'rolled_back',
      stylometricFeatures: { avg_sentence_length: 0.4 },
    });

    let callCount = 0;
    vi.mocked(db.select).mockImplementation(() => {
      callCount += 1;
      if (callCount === 1) return selectChain([activeV3]); // lookup active
      if (callCount === 2) return selectChain([v1]);       // fetch versionA
      return selectChain([activeV3]);                       // fetch versionB (active)
    });

    const history = new ProfileVersionHistory();
    const result = await history.compareWithActive('tenant-abc', 'individual::author-001', 1);

    expect(result).toHaveLength(1);
    expect(result[0].featureKey).toBe('avg_sentence_length');
    // v1 is old (A), active v3 is new (B)
    expect(result[0].oldValue).toBeCloseTo(0.4);
    expect(result[0].newValue).toBeCloseTo(0.7);
  });

  it('throws when tenantId is empty', async () => {
    const history = new ProfileVersionHistory();
    await expect(
      history.compareWithActive('', 'individual::author-001', 1),
    ).rejects.toThrow('tenantId is required');
  });
});
