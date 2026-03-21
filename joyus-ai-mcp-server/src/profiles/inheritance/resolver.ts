/**
 * Profile Inheritance — Inheritance Resolver (T018 + T020 + T021)
 *
 * Resolves the effective (merged) profile for any profile identity by walking
 * its ancestor chain and applying nearest-ancestor-wins merging.
 *
 * T018: resolve, resolveMultiple, resolveWithDetails
 * T020: getOverrideReport
 * T021: propagateChange
 */

import { eq, and } from 'drizzle-orm';

import { db } from '../../db/client.js';
import { tenantProfiles } from '../schema.js';
import { requireTenantId } from '../tenant-scope.js';
import type { ResolvedProfile, ProfileTier } from '../types.js';
import { FEATURE_COUNT } from '../types.js';
import { ProfileOperationLogger } from '../monitoring/logger.js';
import { ProfileHierarchyService } from './hierarchy.js';
import { mergeFeatureVectors, mergeMarkers, type ProfileVersion } from './merge.js';

// ============================================================
// TYPES
// ============================================================

/** Ancestor entry with version provenance, used in resolveWithDetails. */
export interface AncestorDetail {
  profileIdentity: string;
  version: number;
  tier: ProfileTier;
}

/** Full resolution result including ancestor chain details and per-feature sources. */
export interface DetailedResolvedProfile extends ResolvedProfile {
  /** Ancestor chain ordered [root, ..., self]. */
  ancestorChain: AncestorDetail[];
  /** Map of feature name → tier that contributed the final value. */
  featureTierSources: Record<string, ProfileTier>;
}

/** Summary of how features were inherited or overridden for a profile. */
export interface OverrideReport {
  /** Total number of features in the standard feature vector. */
  totalFeatures: number;
  /** Count of features contributed by each tier. */
  countByTier: Record<ProfileTier, number>;
  /** Features where a descendant replaced an ancestor value. */
  overriddenFeatures: string[];
  /** Features whose value came from an ancestor (not from the profile itself). */
  inheritedFeatures: string[];
}

/** Result of a cascade propagation operation. */
export interface PropagationResult {
  /** Identities of all affected descendants. */
  affected: string[];
  /** Number of profiles successfully re-resolved. */
  reresolved: number;
}

// ============================================================
// RESOLVER
// ============================================================

export class InheritanceResolver {
  private readonly hierarchyService: ProfileHierarchyService;
  private readonly logger: ProfileOperationLogger;

  constructor(
    hierarchyService?: ProfileHierarchyService,
    logger?: ProfileOperationLogger,
  ) {
    this.hierarchyService = hierarchyService ?? new ProfileHierarchyService();
    this.logger = logger ?? new ProfileOperationLogger();
  }

  /**
   * Resolve the effective merged profile for a given profile identity.
   * Orphan profiles (no parent) resolve to their own features unchanged.
   */
  async resolve(tenantId: string, profileIdentity: string): Promise<ResolvedProfile> {
    requireTenantId(tenantId);

    const start = Date.now();

    // [self, parent, ..., root] → reverse to [root, ..., self] for merging
    const ancestorChain = await this.hierarchyService.getAncestorChain(tenantId, profileIdentity);
    const mergeChain = [...ancestorChain].reverse();

    const versions = await this.fetchActiveVersions(tenantId, mergeChain);

    const { features, overrideSources } = mergeFeatureVectors(versions);
    const { markers } = mergeMarkers(versions);

    const result: ResolvedProfile = { features, markers, overrideSources };

    await this.logger.logOperation({
      tenantId,
      operation: 'resolve',
      profileIdentity,
      durationMs: Date.now() - start,
      success: true,
      metadata: {
        ancestorCount: ancestorChain.length,
        featureCount: features.size,
        markerCount: markers.length,
      },
    });

    return result;
  }

  /**
   * Batch-resolve multiple profile identities for the same tenant.
   */
  async resolveMultiple(
    tenantId: string,
    profileIdentities: string[],
  ): Promise<Map<string, ResolvedProfile>> {
    requireTenantId(tenantId);

    const results = new Map<string, ResolvedProfile>();
    for (const identity of profileIdentities) {
      const resolved = await this.resolve(tenantId, identity);
      results.set(identity, resolved);
    }
    return results;
  }

  /**
   * Resolve with full provenance: ancestor chain details and per-feature tier sources.
   */
  async resolveWithDetails(
    tenantId: string,
    profileIdentity: string,
  ): Promise<DetailedResolvedProfile> {
    requireTenantId(tenantId);

    const ancestorChain = await this.hierarchyService.getAncestorChain(tenantId, profileIdentity);
    const mergeChain = [...ancestorChain].reverse();

    const versions = await this.fetchActiveVersions(tenantId, mergeChain);

    const { features, overrideSources } = mergeFeatureVectors(versions);
    const { markers } = mergeMarkers(versions);

    // Build per-feature tier source map
    const featureTierSources: Record<string, ProfileTier> = {};
    for (const [featureName, resolved] of features) {
      featureTierSources[featureName] = resolved.sourceTier;
    }

    // Build ancestor detail list ordered [root, ..., self]
    const versionByIdentity = new Map(versions.map((v) => [v.profileIdentity, v]));
    const ancestorDetails: AncestorDetail[] = mergeChain.map((identity) => {
      const v = versionByIdentity.get(identity);
      return {
        profileIdentity: identity,
        version: v?.version ?? 0,
        tier: v?.tier ?? 'base',
      };
    });

    return {
      features,
      markers,
      overrideSources,
      ancestorChain: ancestorDetails,
      featureTierSources,
    };
  }

  // ============================================================
  // T020 — Override Source Tracing
  // ============================================================

  /**
   * Generate a report describing how features were inherited or overridden.
   */
  async getOverrideReport(tenantId: string, profileIdentity: string): Promise<OverrideReport> {
    requireTenantId(tenantId);

    const ancestorChain = await this.hierarchyService.getAncestorChain(tenantId, profileIdentity);
    const mergeChain = [...ancestorChain].reverse();
    const versions = await this.fetchActiveVersions(tenantId, mergeChain);

    const { features, overrideSources } = mergeFeatureVectors(versions);

    // Count features contributed by each tier
    const countByTier: Record<ProfileTier, number> = {
      base: 0,
      domain: 0,
      specialized: 0,
      contextual: 0,
    };

    for (const resolved of features.values()) {
      countByTier[resolved.sourceTier] = (countByTier[resolved.sourceTier] ?? 0) + 1;
    }

    // Features that were overridden by a descendant
    const overriddenFeatures = Object.keys(overrideSources);

    // Features whose final value came from an ancestor (not the profile itself)
    const selfVersion = versions.find((v) => v.profileIdentity === profileIdentity);
    const selfFeatureNames = selfVersion
      ? new Set(Object.keys(selfVersion.stylometricFeatures))
      : new Set<string>();

    const inheritedFeatures: string[] = [];
    for (const [featureName, resolved] of features) {
      if (resolved.sourceProfileId !== profileIdentity && !selfFeatureNames.has(featureName)) {
        inheritedFeatures.push(featureName);
      }
    }

    return {
      totalFeatures: FEATURE_COUNT,
      countByTier,
      overriddenFeatures,
      inheritedFeatures,
    };
  }

  // ============================================================
  // T021 — Cascade Propagation
  // ============================================================

  /**
   * Re-resolve all descendants of the changed profile.
   * Does not invalidate cache (WP06 adds that). Just re-resolves in-memory.
   */
  async propagateChange(tenantId: string, changedProfileIdentity: string): Promise<PropagationResult> {
    requireTenantId(tenantId);

    const start = Date.now();

    const affected = await this.hierarchyService.getDescendants(tenantId, changedProfileIdentity);

    let reresolved = 0;
    for (const identity of affected) {
      await this.resolve(tenantId, identity);
      reresolved++;
    }

    await this.logger.logOperation({
      tenantId,
      operation: 'resolve',
      profileIdentity: changedProfileIdentity,
      durationMs: Date.now() - start,
      success: true,
      metadata: {
        cascadeFrom: changedProfileIdentity,
        affectedCount: affected.length,
        reresolved,
      },
    });

    return { affected, reresolved };
  }

  // ============================================================
  // PRIVATE HELPERS
  // ============================================================

  /**
   * Fetch the active version row for each identity in the chain, preserving order.
   * Identities with no active version are silently skipped.
   */
  private async fetchActiveVersions(
    tenantId: string,
    orderedIdentities: string[],
  ): Promise<ProfileVersion[]> {
    if (orderedIdentities.length === 0) return [];

    const results: ProfileVersion[] = [];

    for (const identity of orderedIdentities) {
      const rows = await db
        .select({
          id: tenantProfiles.id,
          profileIdentity: tenantProfiles.profileIdentity,
          version: tenantProfiles.version,
          tier: tenantProfiles.tier,
          stylometricFeatures: tenantProfiles.stylometricFeatures,
          markers: tenantProfiles.markers,
        })
        .from(tenantProfiles)
        .where(
          and(
            eq(tenantProfiles.tenantId, tenantId),
            eq(tenantProfiles.profileIdentity, identity),
            eq(tenantProfiles.status, 'active'),
          ),
        )
        .limit(1);

      if (rows[0]) {
        results.push({
          id: rows[0].id,
          profileIdentity: rows[0].profileIdentity,
          version: rows[0].version,
          tier: rows[0].tier as ProfileTier,
          stylometricFeatures: (rows[0].stylometricFeatures as Record<string, number>) ?? {},
          markers: rows[0].markers,
        });
      }
    }

    return results;
  }
}
