/**
 * Profile Versioning — Version History and Comparison
 *
 * T014: Paginated history, summary, and identity listing
 * T016: Feature-level version comparison (delta + percentChange)
 */

import { asc, countDistinct, desc, eq, max, min, ne } from 'drizzle-orm';

import { db } from '../../db/client.js';
import { tenantProfiles, type TenantProfile } from '../schema.js';
import { requireTenantId, tenantWhere } from '../tenant-scope.js';
import type { ProfileTier, VersionComparison } from '../types.js';
import { ProfileNotFoundError } from './service.js';

// ============================================================
// TYPES
// ============================================================

export interface VersionHistoryOptions {
  /** Maximum rows to return (default 20, max 100). */
  limit?: number;
  /** Row offset for pagination (default 0). */
  offset?: number;
  /** When true, include deleted versions. Default: false. */
  includeDeleted?: boolean;
}

export interface VersionSummary {
  profileIdentity: string;
  totalVersions: number;
  activeVersion: number | null;
  latestVersion: number | null;
  oldestCreatedAt: Date | null;
  averageFidelityScore: number | null;
}

export interface ListProfileIdentitiesOptions {
  /** Filter by profile tier. */
  tier?: ProfileTier;
  /** Maximum rows to return (default 50). */
  limit?: number;
  /** Row offset for pagination (default 0). */
  offset?: number;
}

export interface ProfileIdentitySummary {
  profileIdentity: string;
  tier: ProfileTier;
  versionCount: number;
}

// ============================================================
// HISTORY SERVICE
// ============================================================

export class ProfileVersionHistory {
  // ----------------------------------------------------------
  // T014: History, summary, identity listing
  // ----------------------------------------------------------

  /**
   * Return all versions for a (tenantId, profileIdentity) pair, ordered
   * newest-first. Deleted versions are excluded by default.
   */
  async getHistory(
    tenantId: string,
    profileIdentity: string,
    options?: VersionHistoryOptions,
  ): Promise<TenantProfile[]> {
    requireTenantId(tenantId);

    const limit = Math.min(options?.limit ?? 20, 100);
    const offset = options?.offset ?? 0;
    const includeDeleted = options?.includeDeleted ?? false;

    const baseConditions = [eq(tenantProfiles.profileIdentity, profileIdentity)];

    if (!includeDeleted) {
      baseConditions.push(ne(tenantProfiles.status, 'deleted'));
    }

    const whereClause = tenantWhere(
      tenantProfiles,
      tenantId,
      ...baseConditions,
    );

    return db
      .select()
      .from(tenantProfiles)
      .where(whereClause)
      .orderBy(desc(tenantProfiles.version))
      .limit(limit)
      .offset(offset);
  }

  /**
   * Return aggregate statistics for a (tenantId, profileIdentity) pair.
   */
  async getVersionSummary(
    tenantId: string,
    profileIdentity: string,
  ): Promise<VersionSummary> {
    requireTenantId(tenantId);

    const rows = await db
      .select()
      .from(tenantProfiles)
      .where(
        tenantWhere(
          tenantProfiles,
          tenantId,
          eq(tenantProfiles.profileIdentity, profileIdentity),
        ),
      );

    const nonDeleted = rows.filter((r) => r.status !== 'deleted');
    const activeRow = rows.find((r) => r.status === 'active');

    const fidelityScores = nonDeleted
      .map((r) => r.fidelityScore)
      .filter((s): s is number => s !== null && s !== undefined);

    const averageFidelityScore =
      fidelityScores.length > 0
        ? fidelityScores.reduce((a, b) => a + b, 0) / fidelityScores.length
        : null;

    const createdAts = nonDeleted.map((r) => r.createdAt);
    const oldestCreatedAt =
      createdAts.length > 0
        ? createdAts.reduce((a, b) => (a < b ? a : b))
        : null;

    const latestVersion =
      nonDeleted.length > 0
        ? Math.max(...nonDeleted.map((r) => r.version))
        : null;

    return {
      profileIdentity,
      totalVersions: nonDeleted.length,
      activeVersion: activeRow?.version ?? null,
      latestVersion,
      oldestCreatedAt,
      averageFidelityScore,
    };
  }

  /**
   * Return distinct profile identities for a tenant, with their version counts.
   * Optionally filtered by tier.
   */
  async listProfileIdentities(
    tenantId: string,
    options?: ListProfileIdentitiesOptions,
  ): Promise<ProfileIdentitySummary[]> {
    requireTenantId(tenantId);

    const limit = options?.limit ?? 50;
    const offset = options?.offset ?? 0;

    // Fetch all non-deleted rows and aggregate in memory to avoid complex
    // Drizzle groupBy + tier-filter interactions.
    const rows = await db
      .select({
        profileIdentity: tenantProfiles.profileIdentity,
        tier: tenantProfiles.tier,
        version: tenantProfiles.version,
        status: tenantProfiles.status,
      })
      .from(tenantProfiles)
      .where(
        tenantWhere(
          tenantProfiles,
          tenantId,
          ne(tenantProfiles.status, 'deleted'),
        ),
      )
      .orderBy(asc(tenantProfiles.profileIdentity));

    // Aggregate by identity
    const identityMap = new Map<string, { tier: ProfileTier; count: number }>();
    for (const row of rows) {
      const existing = identityMap.get(row.profileIdentity);
      if (existing) {
        existing.count += 1;
      } else {
        identityMap.set(row.profileIdentity, {
          tier: row.tier as ProfileTier,
          count: 1,
        });
      }
    }

    let summaries: ProfileIdentitySummary[] = Array.from(
      identityMap.entries(),
    ).map(([profileIdentity, { tier, count }]) => ({
      profileIdentity,
      tier,
      versionCount: count,
    }));

    // Apply optional tier filter
    if (options?.tier) {
      summaries = summaries.filter((s) => s.tier === options.tier);
    }

    // Apply pagination
    return summaries.slice(offset, offset + limit);
  }

  // ----------------------------------------------------------
  // T016: Version comparison
  // ----------------------------------------------------------

  /**
   * Compare stylometric features between two versions of the same profile.
   *
   * Returns an array of VersionComparison sorted by absolute delta descending.
   * Features present in only one version use 0 for the missing side.
   * Handles division by zero: percentChange is set to Infinity when oldValue is 0
   * and delta is non-zero, or 0 when both values are 0.
   */
  async compareVersions(
    tenantId: string,
    profileIdentity: string,
    versionA: number,
    versionB: number,
  ): Promise<VersionComparison[]> {
    requireTenantId(tenantId);

    const [rowA, rowB] = await Promise.all([
      this.fetchVersion(tenantId, profileIdentity, versionA),
      this.fetchVersion(tenantId, profileIdentity, versionB),
    ]);

    const featuresA = (rowA.stylometricFeatures ?? {}) as Record<string, number>;
    const featuresB = (rowB.stylometricFeatures ?? {}) as Record<string, number>;

    const allKeys = new Set([...Object.keys(featuresA), ...Object.keys(featuresB)]);

    const comparisons: VersionComparison[] = [];

    for (const featureKey of allKeys) {
      const oldValue = featuresA[featureKey] ?? 0;
      const newValue = featuresB[featureKey] ?? 0;
      const delta = newValue - oldValue;

      let percentChange: number;
      if (oldValue === 0) {
        percentChange = delta === 0 ? 0 : Infinity;
      } else {
        percentChange = (delta / oldValue) * 100;
      }

      comparisons.push({ featureKey, oldValue, newValue, delta, percentChange });
    }

    // Sort by absolute delta descending
    comparisons.sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta));

    return comparisons;
  }

  /**
   * Convenience wrapper: compare an arbitrary version against the current active one.
   * Treats versionA as the provided version (old) and versionB as active (new).
   */
  async compareWithActive(
    tenantId: string,
    profileIdentity: string,
    version: number,
  ): Promise<VersionComparison[]> {
    requireTenantId(tenantId);

    const active = await db
      .select()
      .from(tenantProfiles)
      .where(
        tenantWhere(
          tenantProfiles,
          tenantId,
          eq(tenantProfiles.profileIdentity, profileIdentity),
          eq(tenantProfiles.status, 'active'),
        ),
      )
      .limit(1);

    if (active.length === 0) {
      throw new ProfileNotFoundError(profileIdentity);
    }

    const activeVersion = active[0].version;
    return this.compareVersions(tenantId, profileIdentity, version, activeVersion);
  }

  // ----------------------------------------------------------
  // Private helpers
  // ----------------------------------------------------------

  private async fetchVersion(
    tenantId: string,
    profileIdentity: string,
    version: number,
  ): Promise<TenantProfile> {
    const [row] = await db
      .select()
      .from(tenantProfiles)
      .where(
        tenantWhere(
          tenantProfiles,
          tenantId,
          eq(tenantProfiles.profileIdentity, profileIdentity),
          eq(tenantProfiles.version, version),
        ),
      )
      .limit(1);

    if (!row) {
      throw new ProfileNotFoundError(profileIdentity, version);
    }

    return row;
  }
}
