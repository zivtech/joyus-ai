/**
 * Content Infrastructure — Entitlement Service
 *
 * Orchestrates entitlement resolution, session-scoped caching, DB persistence,
 * and fallback behavior (FR-014, SC-009).
 *
 * Fail-closed: resolver failure → DB fallback → empty entitlements (restricted).
 * Empty entitlements = zero content access, never full access.
 */

import { eq, desc, and } from 'drizzle-orm';

import {
  contentEntitlements,
  contentProductSources,
  contentProductProfiles,
  contentProducts,
  contentOperationLogs,
} from '../schema.js';
import type { ResolvedEntitlements } from '../types.js';
import type { EntitlementResolver, ResolverContext } from './interface.js';
import type { EntitlementCache } from './cache.js';
import { createId } from '@paralleldrive/cuid2';
import type { DrizzleClient } from '../../db/types.js';

// ============================================================
// ENTITLEMENT SERVICE
// ============================================================

export class EntitlementService {
  constructor(
    private readonly resolver: EntitlementResolver,
    private readonly cache: EntitlementCache,
    private readonly db: DrizzleClient,
  ) {}

  /**
   * Resolve entitlements for a user session.
   *
   * Resolution order:
   *   1. In-memory cache (if !forceRefresh)
   *   2. External resolver
   *   3. Most-recent DB record (fallback on resolver failure)
   *   4. Empty entitlements — restricted mode (SC-009)
   */
  async resolve(
    userId: string,
    tenantId: string,
    context: ResolverContext,
    forceRefresh = false,
  ): Promise<ResolvedEntitlements> {
    const startMs = Date.now();

    // 1. Cache check
    if (!forceRefresh) {
      const cached = this.cache.get(context.sessionId);
      if (cached) {
        return cached;
      }
    }

    // 2. Try external resolver
    let resolved: ResolvedEntitlements | null = null;
    let resolverError: string | null = null;

    try {
      resolved = await this.resolver.resolve(userId, tenantId, context);
    } catch (err) {
      resolverError = err instanceof Error ? err.message : String(err);
    }

    // 3. Fallback: most-recent DB record for this user+tenant
    if (!resolved) {
      const rows = await this.db
        .select()
        .from(contentEntitlements)
        .where(
          and(
            eq(contentEntitlements.userId, userId),
            eq(contentEntitlements.tenantId, tenantId),
          ),
        )
        .orderBy(desc(contentEntitlements.resolvedAt))
        .limit(1);

      if (rows.length > 0) {
        const row = rows[0];
        // Reconstruct from DB: gather all productIds for this user+tenant
        const allRows = await this.db
          .select({ productId: contentEntitlements.productId })
          .from(contentEntitlements)
          .where(
            and(
              eq(contentEntitlements.userId, userId),
              eq(contentEntitlements.tenantId, tenantId),
              eq(contentEntitlements.sessionId, row.sessionId),
            ),
          );

        const productIds = [...new Set(allRows.map((r) => r.productId))];
        resolved = {
          productIds,
          sourceIds: [],
          profileIds: [],
          resolvedFrom: `db-fallback:${row.resolvedFrom}`,
          resolvedAt: row.resolvedAt,
        };
      }
    }

    // 4. Restricted mode — zero access
    if (!resolved) {
      resolved = {
        productIds: [],
        sourceIds: [],
        profileIds: [],
        resolvedFrom: 'restricted-mode',
        resolvedAt: new Date(),
      };
    }

    // Populate sourceIds and profileIds from product mappings
    resolved.sourceIds = await this.getAccessibleSourceIds(resolved);
    resolved.profileIds = await this.getAccessibleProfileIds(resolved);

    // Persist to DB (one row per product per session)
    if (resolved.productIds.length > 0 && !resolved.resolvedFrom.startsWith('db-fallback')) {
      const ttlSeconds = resolved.ttlSeconds ?? 3600;
      const expiresAt = new Date(Date.now() + ttlSeconds * 1000);

      await this.db.insert(contentEntitlements).values(
        resolved.productIds.map((productId) => ({
          id: createId(),
          tenantId,
          userId,
          sessionId: context.sessionId,
          productId,
          resolvedFrom: resolved!.resolvedFrom,
          resolvedAt: resolved!.resolvedAt,
          expiresAt,
        })),
      );
    }

    // Cache result
    this.cache.set(context.sessionId, resolved);

    // Audit log
    await this.db.insert(contentOperationLogs).values({
      id: createId(),
      tenantId,
      operation: 'resolve',
      userId,
      durationMs: Date.now() - startMs,
      success: resolved.resolvedFrom !== 'restricted-mode',
      metadata: {
        sessionId: context.sessionId,
        productCount: resolved.productIds.length,
        resolvedFrom: resolved.resolvedFrom,
        error: resolverError,
      },
    });

    return resolved;
  }

  /**
   * Return source IDs accessible via the given entitlements (product → sources join).
   */
  async getAccessibleSourceIds(entitlements: ResolvedEntitlements): Promise<string[]> {
    if (entitlements.productIds.length === 0) return [];

    const rows = await this.db
      .select({ sourceId: contentProductSources.sourceId })
      .from(contentProductSources)
      .where(
        // Drizzle inArray equivalent via raw SQL for simplicity with existing imports
        eq(contentProductSources.productId, entitlements.productIds[0]),
      );

    // If multiple products, fetch all and deduplicate
    if (entitlements.productIds.length > 1) {
      const allRows = await Promise.all(
        entitlements.productIds.map((pid) =>
          this.db
            .select({ sourceId: contentProductSources.sourceId })
            .from(contentProductSources)
            .where(eq(contentProductSources.productId, pid)),
        ),
      );
      return [...new Set(allRows.flat().map((r) => r.sourceId))];
    }

    return [...new Set(rows.map((r) => r.sourceId))];
  }

  /**
   * Return profile IDs accessible via the given entitlements (product → profiles join).
   */
  async getAccessibleProfileIds(entitlements: ResolvedEntitlements): Promise<string[]> {
    if (entitlements.productIds.length === 0) return [];

    if (entitlements.productIds.length === 1) {
      const rows = await this.db
        .select({ profileId: contentProductProfiles.profileId })
        .from(contentProductProfiles)
        .where(eq(contentProductProfiles.productId, entitlements.productIds[0]));
      return [...new Set(rows.map((r) => r.profileId))];
    }

    const allRows = await Promise.all(
      entitlements.productIds.map((pid) =>
        this.db
          .select({ profileId: contentProductProfiles.profileId })
          .from(contentProductProfiles)
          .where(eq(contentProductProfiles.productId, pid)),
      ),
    );
    return [...new Set(allRows.flat().map((r) => r.profileId))];
  }
}

// Re-export for consumers
export type { EntitlementResolver, ResolverContext } from './interface.js';
export { EntitlementCache } from './cache.js';
export { HttpEntitlementResolver } from './http-resolver.js';
export type { HttpResolverConfig } from './http-resolver.js';
