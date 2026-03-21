/**
 * Profile Cache — Inheritance-Aware Invalidation (T030)
 *
 * When a profile changes, all of its descendants must also be evicted
 * from the cache because their resolved features may include inherited
 * values from the changed profile.
 *
 * Uses ProfileHierarchyService.getDescendants() (breadth-first walk) —
 * no raw SQL recursive CTE required.
 */

import { ProfileHierarchyService } from '../inheritance/hierarchy.js';
import { ProfileOperationLogger } from '../monitoring/logger.js';
import { ProfileCacheService, CACHE_WARM_THRESHOLD } from './service.js';
import { requireTenantId } from '../tenant-scope.js';

// ============================================================
// CONSTANTS
// ============================================================

/** Maximum number of descendants to invalidate individually before falling back to full tenant eviction. */
const MAX_INDIVIDUAL_INVALIDATION = 1000;

// ============================================================
// TYPES
// ============================================================

export interface InvalidationResult {
  /** Total number of cache entries deleted. */
  invalidated: number;
  /** Identities whose cache entries were deleted (changed profile + descendants). */
  identities: string[];
}

// ============================================================
// SERVICE
// ============================================================

export class CacheInvalidationService {
  private readonly hierarchyService: ProfileHierarchyService;
  private readonly cacheService: ProfileCacheService;
  private readonly logger: ProfileOperationLogger;

  constructor(
    hierarchyService?: ProfileHierarchyService,
    cacheService?: ProfileCacheService,
    logger?: ProfileOperationLogger,
  ) {
    this.hierarchyService = hierarchyService ?? new ProfileHierarchyService();
    this.cacheService = cacheService ?? new ProfileCacheService();
    this.logger = logger ?? new ProfileOperationLogger();
  }

  /**
   * Invalidate cache entries for a changed profile and all of its descendants.
   *
   * Algorithm:
   * 1. Walk the hierarchy to collect all descendant identities.
   * 2. Combine: [changedProfileIdentity, ...descendants].
   * 3. If total > MAX_INDIVIDUAL_INVALIDATION, log a warning and fall back to invalidateAll.
   * 4. Otherwise delete each cache entry individually.
   * 5. Log the operation with the count.
   */
  async invalidateForProfile(
    tenantId: string,
    changedProfileIdentity: string,
  ): Promise<InvalidationResult> {
    requireTenantId(tenantId);

    const start = Date.now();

    const descendants = await this.hierarchyService.getDescendants(tenantId, changedProfileIdentity);
    const allIdentities = [changedProfileIdentity, ...descendants];

    if (allIdentities.length > MAX_INDIVIDUAL_INVALIDATION) {
      process.stdout.write(
        JSON.stringify({
          level: 'warn',
          service: 'profiles',
          operation: 'cache_invalidate',
          tenantId,
          profileIdentity: changedProfileIdentity,
          message: `Descendant count ${allIdentities.length} exceeds limit ${MAX_INDIVIDUAL_INVALIDATION}; falling back to full tenant cache eviction`,
          timestamp: new Date().toISOString(),
        }) + '\n',
      );

      const count = await this.cacheService.deleteAll(tenantId);

      await this.logger.logOperation({
        tenantId,
        operation: 'cache_invalidate',
        profileIdentity: changedProfileIdentity,
        durationMs: Date.now() - start,
        success: true,
        metadata: { invalidated: count, fallback: true, descendantCount: allIdentities.length },
      });

      return { invalidated: count, identities: allIdentities };
    }

    let invalidated = 0;
    for (const identity of allIdentities) {
      const deleted = await this.cacheService.delete(tenantId, identity);
      if (deleted) {
        invalidated++;
      }
    }

    await this.logger.logOperation({
      tenantId,
      operation: 'cache_invalidate',
      profileIdentity: changedProfileIdentity,
      durationMs: Date.now() - start,
      success: true,
      metadata: { invalidated, identities: allIdentities },
    });

    return { invalidated, identities: allIdentities };
  }

  /**
   * Safety valve: delete the entire cache for a tenant unconditionally.
   * Use when a bulk operation may have affected an unknown set of profiles.
   */
  async invalidateAll(tenantId: string): Promise<number> {
    requireTenantId(tenantId);

    const start = Date.now();
    const count = await this.cacheService.deleteAll(tenantId);

    await this.logger.logOperation({
      tenantId,
      operation: 'cache_invalidate',
      durationMs: Date.now() - start,
      success: true,
      metadata: { invalidated: count, scope: 'all' },
    });

    return count;
  }

  /**
   * Invalidate and optionally re-warm the cache after a profile change.
   * Warming is triggered automatically if the tenant has >= CACHE_WARM_THRESHOLD active profiles.
   *
   * @param tenantId               Tenant whose cache to update.
   * @param changedProfileIdentity The profile that changed.
   * @param activeProfileCount     Pass the current active profile count to control auto-warming.
   */
  async invalidateAndMaybeWarm(
    tenantId: string,
    changedProfileIdentity: string,
    activeProfileCount: number,
  ): Promise<InvalidationResult> {
    requireTenantId(tenantId);

    const result = await this.invalidateForProfile(tenantId, changedProfileIdentity);

    if (activeProfileCount >= CACHE_WARM_THRESHOLD) {
      await this.cacheService.warmCache(tenantId);
    }

    return result;
  }
}
