/**
 * Tests for ProfileVersionService.rollback (T013)
 *
 * Uses stub DB objects that simulate Drizzle query chain results.
 * No real database connections.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ── DB Mock ────────────────────────────────────────────────────────────────

vi.mock('../../../src/db/client.js', () => {
  const mockSelect = vi.fn();
  const mockUpdate = vi.fn();
  const mockInsert = vi.fn();
  const mockTransaction = vi.fn();

  return {
    db: {
      select: mockSelect,
      update: mockUpdate,
      insert: mockInsert,
      transaction: mockTransaction,
    },
    tenantProfiles: { tenantId: 'tenantId', profileIdentity: 'profileIdentity', version: 'version', status: 'status', id: 'id' },
  };
});

vi.mock('../../../src/profiles/monitoring/logger.js', () => ({
  ProfileOperationLogger: vi.fn().mockImplementation(() => ({
    logOperation: vi.fn().mockResolvedValue(undefined),
  })),
}));

import { ProfileVersionService, ProfileNotFoundError, RollbackError } from '../../../src/profiles/versioning/service.js';
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
    status: 'rolled_back',
    stylometricFeatures: { avg_sentence_length: 0.4 },
    markers: [],
    fidelityScore: 0.8,
    createdAt: new Date('2025-01-01'),
    updatedAt: new Date('2025-01-01'),
    archivedAt: null,
    ...overrides,
  };
}

/** Chainable select stub that resolves to `rows` at the `.limit()` stage. */
function selectChain(rows: unknown[]): ReturnType<typeof vi.fn> {
  const chain: Record<string, unknown> = {};
  chain['from'] = vi.fn().mockReturnValue(chain);
  chain['where'] = vi.fn().mockReturnValue(chain);
  chain['orderBy'] = vi.fn().mockReturnValue(chain);
  chain['limit'] = vi.fn().mockResolvedValue(rows);
  chain['then'] = (resolve: (v: unknown) => unknown) => Promise.resolve(rows).then(resolve);
  return chain as never;
}

/** Chainable update stub that resolves to `rows` at `.returning()`. */
function updateChain(rows: unknown[] = []): ReturnType<typeof vi.fn> {
  return {
    set: vi.fn().mockReturnThis(),
    where: vi.fn().mockReturnThis(),
    returning: vi.fn().mockResolvedValue(rows),
  } as never;
}

// ── Tests ──────────────────────────────────────────────────────────────────

describe('ProfileVersionService.rollback', () => {
  beforeEach(() => {
    vi.clearAllMocks();

    // Default: transaction passes through to the callback with a tx stub
    vi.mocked(db.transaction).mockImplementation(async (fn) => {
      return fn(db as never);
    });
  });

  it('throws when tenantId is empty', async () => {
    const service = new ProfileVersionService();
    await expect(
      service.rollback('', 'individual::author-001', 1),
    ).rejects.toThrow('tenantId is required');
  });

  it('throws ProfileNotFoundError when target version does not exist', async () => {
    vi.mocked(db.select).mockReturnValue(selectChain([]));

    const service = new ProfileVersionService();
    await expect(
      service.rollback('tenant-abc', 'individual::author-001', 99),
    ).rejects.toBeInstanceOf(ProfileNotFoundError);
  });

  it('throws RollbackError when target version is already active', async () => {
    const activeProfile = makeProfile({ status: 'active', version: 1 });
    vi.mocked(db.select).mockReturnValue(selectChain([activeProfile]));

    const service = new ProfileVersionService();
    await expect(
      service.rollback('tenant-abc', 'individual::author-001', 1),
    ).rejects.toBeInstanceOf(RollbackError);
  });

  it('throws RollbackError when target version is deleted', async () => {
    const deletedProfile = makeProfile({ status: 'deleted', version: 1 });
    vi.mocked(db.select).mockReturnValue(selectChain([deletedProfile]));

    const service = new ProfileVersionService();
    await expect(
      service.rollback('tenant-abc', 'individual::author-001', 1),
    ).rejects.toBeInstanceOf(RollbackError);
  });

  it('rolls back v3 to v1: v3 becomes rolled_back, v1 becomes active', async () => {
    const v1 = makeProfile({ id: 'profile-v1', version: 1, status: 'rolled_back' });
    const v3Active = { id: 'profile-v3', version: 3, tenantId: 'tenant-abc' };
    const v1Restored = makeProfile({ id: 'profile-v1', version: 1, status: 'active' });

    let selectCallCount = 0;
    vi.mocked(db.select).mockImplementation(() => {
      selectCallCount += 1;
      if (selectCallCount === 1) {
        // Fetch target (v1 — rolled_back)
        return selectChain([v1]);
      }
      // Fetch current active (v3)
      return selectChain([v3Active]);
    });

    vi.mocked(db.update).mockReturnValue(updateChain([v1Restored]));

    const service = new ProfileVersionService();
    const result = await service.rollback('tenant-abc', 'individual::author-001', 1);

    expect(result.version).toBe(1);
    // update called twice: once for v3→rolled_back, once for v1→active
    expect(db.update).toHaveBeenCalledTimes(2);
  });

  it('handles rollback when there is no current active version (all rolled_back)', async () => {
    const v1 = makeProfile({ id: 'profile-v1', version: 1, status: 'rolled_back' });
    const v1Restored = makeProfile({ id: 'profile-v1', version: 1, status: 'active' });

    let selectCallCount = 0;
    vi.mocked(db.select).mockImplementation(() => {
      selectCallCount += 1;
      if (selectCallCount === 1) {
        return selectChain([v1]);
      }
      // No current active version
      return selectChain([]);
    });

    vi.mocked(db.update).mockReturnValue(updateChain([v1Restored]));

    const service = new ProfileVersionService();
    const result = await service.rollback('tenant-abc', 'individual::author-001', 1);

    // Only one update call (for target → active), since no active to deactivate
    expect(db.update).toHaveBeenCalledTimes(1);
    expect(result.version).toBe(1);
  });

  it('can rollback from archived status', async () => {
    const archivedV2 = makeProfile({ id: 'profile-v2', version: 2, status: 'archived' });
    const restoredV2 = makeProfile({ id: 'profile-v2', version: 2, status: 'active' });

    let selectCallCount = 0;
    vi.mocked(db.select).mockImplementation(() => {
      selectCallCount += 1;
      if (selectCallCount === 1) return selectChain([archivedV2]);
      return selectChain([]); // no current active
    });

    vi.mocked(db.update).mockReturnValue(updateChain([restoredV2]));

    const service = new ProfileVersionService();
    const result = await service.rollback('tenant-abc', 'individual::author-001', 2);
    expect(result.status).toBe('active');
  });

  it('does not allow cross-tenant rollback', async () => {
    // The tenantWhere helper ensures the tenant-scoped query returns nothing
    // for a different tenant — simulate by returning empty for target fetch
    vi.mocked(db.select).mockReturnValue(selectChain([]));

    const service = new ProfileVersionService();
    await expect(
      service.rollback('tenant-other', 'individual::author-001', 1),
    ).rejects.toBeInstanceOf(ProfileNotFoundError);
  });

  it('logs the rollback operation with fromVersion and toVersion', async () => {
    const v1 = makeProfile({ id: 'profile-v1', version: 1, status: 'rolled_back' });
    const v3Active = { id: 'profile-v3', version: 3, tenantId: 'tenant-abc' };
    const v1Restored = makeProfile({ id: 'profile-v1', version: 1, status: 'active' });

    let selectCallCount = 0;
    vi.mocked(db.select).mockImplementation(() => {
      selectCallCount += 1;
      if (selectCallCount === 1) return selectChain([v1]);
      return selectChain([v3Active]);
    });

    vi.mocked(db.update).mockReturnValue(updateChain([v1Restored]));

    const logger = { logOperation: vi.fn().mockResolvedValue(undefined) };
    const service = new ProfileVersionService(logger as never);
    await service.rollback('tenant-abc', 'individual::author-001', 1);

    expect(logger.logOperation).toHaveBeenCalledOnce();
    const call = logger.logOperation.mock.calls[0][0] as Record<string, unknown>;
    expect(call['operation']).toBe('rollback');
    const meta = call['metadata'] as Record<string, unknown>;
    expect(meta['fromVersion']).toBe(3);
    expect(meta['toVersion']).toBe(1);
  });
});
