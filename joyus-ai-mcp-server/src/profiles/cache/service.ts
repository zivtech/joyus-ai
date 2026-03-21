/**
 * Profile Cache — Cache Service (T029 + T031)
 *
 * Database-backed resolved profile cache. One entry per (tenantId, profileIdentity).
 * Upserts via INSERT ... ON CONFLICT DO UPDATE (Drizzle onConflictDoUpdate).
 *
 * T029: get, getOrResolve, set, delete, deleteAll, getCacheStats
 * T031: warmCache
 */

import { eq, and, min, max, count, sql } from 'drizzle-orm';

import { db } from '../../db/client.js';
import { profileCache, tenantProfiles } from '../schema.js';
import { requireTenantId, tenantWhere } from '../tenant-scope.js';
import type { ResolvedProfile } from '../types.js';
import { ProfileOperationLogger } from '../monitoring/logger.js';
import { ProfileMetrics } from '../monitoring/metrics.js';
import { InheritanceResolver } from '../inheritance/resolver.js';

// ============================================================
// CONSTANTS
// ============================================================

/** Warm cache automatically after invalidation when a tenant has at least this many active profiles. */
export const CACHE_WARM_THRESHOLD = 20;

// ============================================================
// TYPES
// ============================================================

export interface CacheStats {
  totalEntries: number;
  oldestResolvedAt: Date | null;
  newestResolvedAt: Date | null;
}

export interface WarmResult {
  warmed: number;
  failed: number;
  durationMs: number;
}

// ============================================================
// SERIALISATION HELPERS
// ============================================================

/**
 * ResolvedProfile.features is a Map<string, ResolvedFeature>.
 * JSON does not natively serialise Maps, so we store them as plain objects.
 */
function serialiseFeatures(features: ResolvedProfile['features']): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of features) {
    out[key] = value;
  }
  return out;
}

function deserialiseFeatures(raw: unknown): ResolvedProfile['features'] {
  const map = new Map<string, ResolvedProfile['features'] extends Map<string, infer V> ? V : never>();
  if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
    for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
      map.set(key, value as never);
    }
  }
  return map;
}

// ============================================================
// SERVICE
// ============================================================

export class ProfileCacheService {
  private readonly resolver: InheritanceResolver;
  private readonly logger: ProfileOperationLogger;
  private readonly metrics: ProfileMetrics;

  constructor(
    resolver?: InheritanceResolver,
    logger?: ProfileOperationLogger,
    metrics?: ProfileMetrics,
  ) {
    this.resolver = resolver ?? new InheritanceResolver();
    this.logger = logger ?? new ProfileOperationLogger();
    this.metrics = metrics ?? new ProfileMetrics();
  }

  // ----------------------------------------------------------
  // T029 — Core Cache Operations
  // ----------------------------------------------------------

  /**
   * Look up a cached resolved profile.
   * Returns null on miss (does not call the resolver).
   */
  async get(tenantId: string, profileIdentity: string): Promise<ResolvedProfile | null> {
    requireTenantId(tenantId);

    const rows = await db
      .select()
      .from(profileCache)
      .where(
        and(
          eq(profileCache.tenantId, tenantId),
          eq(profileCache.profileIdentity, profileIdentity),
        ),
      )
      .limit(1);

    if (!rows[0]) {
      return null;
    }

    const row = rows[0];
    return {
      features: deserialiseFeatures(row.resolvedFeatures),
      markers: (row.resolvedMarkers as ResolvedProfile['markers']) ?? [],
      overrideSources: (row.overrideSources as Record<string, string>) ?? {},
    };
  }

  /**
   * Try the cache first; on miss call the resolver, store the result, then return it.
   * Records a cache hit or miss metric.
   */
  async getOrResolve(tenantId: string, profileIdentity: string): Promise<ResolvedProfile> {
    requireTenantId(tenantId);

    const cached = await this.get(tenantId, profileIdentity);

    if (cached !== null) {
      this.metrics.recordCacheHit(tenantId);
      return cached;
    }

    this.metrics.recordCacheMiss(tenantId);

    const resolved = await this.resolver.resolve(tenantId, profileIdentity);

    await this.set(tenantId, profileIdentity, resolved, {});

    return resolved;
  }

  /**
   * Upsert a resolved profile into the cache.
   * Uses INSERT ... ON CONFLICT (tenantId, profileIdentity) DO UPDATE.
   */
  async set(
    tenantId: string,
    profileIdentity: string,
    resolved: ResolvedProfile,
    ancestorVersions: Record<string, number>,
  ): Promise<void> {
    requireTenantId(tenantId);

    const resolvedFeatures = serialiseFeatures(resolved.features);

    await db
      .insert(profileCache)
      .values({
        tenantId,
        profileIdentity,
        resolvedFeatures,
        resolvedMarkers: resolved.markers,
        overrideSources: resolved.overrideSources,
        ancestorVersions,
        resolvedAt: new Date(),
      })
      .onConflictDoUpdate({
        target: [profileCache.tenantId, profileCache.profileIdentity],
        set: {
          resolvedFeatures,
          resolvedMarkers: resolved.markers,
          overrideSources: resolved.overrideSources,
          ancestorVersions,
          resolvedAt: new Date(),
        },
      });
  }

  /**
   * Delete a single cache entry.
   * Returns true if a row was removed, false if none existed.
   */
  async delete(tenantId: string, profileIdentity: string): Promise<boolean> {
    requireTenantId(tenantId);

    const deleted = await db
      .delete(profileCache)
      .where(
        and(
          eq(profileCache.tenantId, tenantId),
          eq(profileCache.profileIdentity, profileIdentity),
        ),
      )
      .returning();

    return deleted.length > 0;
  }

  /**
   * Delete all cache entries for a tenant.
   * Returns the number of rows removed.
   */
  async deleteAll(tenantId: string): Promise<number> {
    requireTenantId(tenantId);

    const deleted = await db
      .delete(profileCache)
      .where(tenantWhere(profileCache, tenantId))
      .returning();

    return deleted.length;
  }

  /**
   * Return aggregate cache statistics for a tenant.
   */
  async getCacheStats(tenantId: string): Promise<CacheStats> {
    requireTenantId(tenantId);

    const rows = await db
      .select({
        totalEntries: count(),
        oldestResolvedAt: min(profileCache.resolvedAt),
        newestResolvedAt: max(profileCache.resolvedAt),
      })
      .from(profileCache)
      .where(tenantWhere(profileCache, tenantId));

    const row = rows[0];
    return {
      totalEntries: Number(row?.totalEntries ?? 0),
      oldestResolvedAt: row?.oldestResolvedAt ?? null,
      newestResolvedAt: row?.newestResolvedAt ?? null,
    };
  }

  // ----------------------------------------------------------
  // T031 — Cache Warming
  // ----------------------------------------------------------

  /**
   * Warm the cache for specified profile identities, or all active profiles for the tenant.
   * On per-profile failure: logs the error and continues to the next profile.
   * Returns a summary of warmed/failed counts and wall-clock duration.
   */
  async warmCache(tenantId: string, profileIdentities?: string[]): Promise<WarmResult> {
    requireTenantId(tenantId);

    const start = Date.now();
    let warmed = 0;
    let failed = 0;

    const identities = profileIdentities ?? await this.fetchActiveProfileIdentities(tenantId);

    for (const identity of identities) {
      try {
        const resolved = await this.resolver.resolve(tenantId, identity);
        await this.set(tenantId, identity, resolved, {});
        warmed++;
      } catch (err) {
        failed++;
        await this.logger.logOperation({
          tenantId,
          operation: 'cache_warm',
          profileIdentity: identity,
          durationMs: Date.now() - start,
          success: false,
          metadata: {
            error: err instanceof Error ? err.message : String(err),
          },
        });
      }
    }

    const durationMs = Date.now() - start;

    await this.logger.logOperation({
      tenantId,
      operation: 'cache_warm',
      durationMs,
      success: failed === 0,
      metadata: { warmed, failed, total: identities.length },
    });

    return { warmed, failed, durationMs };
  }

  // ----------------------------------------------------------
  // PRIVATE HELPERS
  // ----------------------------------------------------------

  /**
   * Fetch all active profile identities for a tenant from the tenant_profiles table.
   * Used by warmCache when no explicit identity list is provided.
   */
  private async fetchActiveProfileIdentities(tenantId: string): Promise<string[]> {
    const rows = await db
      .select({ profileIdentity: tenantProfiles.profileIdentity })
      .from(tenantProfiles)
      .where(
        and(
          eq(tenantProfiles.tenantId, tenantId),
          eq(tenantProfiles.status, 'active'),
        ),
      );

    // De-duplicate: one entry per identity (multiple versions may exist)
    const seen = new Set<string>();
    const identities: string[] = [];
    for (const row of rows) {
      if (!seen.has(row.profileIdentity)) {
        seen.add(row.profileIdentity);
        identities.push(row.profileIdentity);
      }
    }
    return identities;
  }
}
