/**
 * Content Tool Executor
 * Routes content_ tool calls to database operations.
 * Service integrations (search, entitlements, generation) will be wired in WP12.
 */

import { eq, desc, and, inArray, sql, like, or } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/node-postgres';

import {
  contentSources,
  contentItems,
  contentSyncRuns,
  contentProducts,
  contentProductSources,
  contentDriftReports,
  contentEntitlements,
} from '../../content/schema.js';

type DrizzleClient = ReturnType<typeof drizzle>;

export interface ContentExecutorContext {
  userId: string;
  tenantId: string;
  db: DrizzleClient;
}

/**
 * Execute a content_ tool by name
 */
export async function executeContentTool(
  toolName: string,
  input: Record<string, unknown>,
  context: ContentExecutorContext
): Promise<unknown> {
  const { db, tenantId, userId } = context;

  switch (toolName) {
    // ── Source Management ────────────────────────────────────────────────────

    case 'content_list_sources': {
      const status = input.status as string | undefined;

      const rows = await db
        .select()
        .from(contentSources)
        .where(
          status
            ? and(
                eq(contentSources.tenantId, tenantId),
                eq(contentSources.status, status as 'active' | 'syncing' | 'error' | 'disconnected')
              )
            : eq(contentSources.tenantId, tenantId)
        )
        .orderBy(desc(contentSources.updatedAt));

      return {
        sources: rows.map((s) => ({
          id: s.id,
          name: s.name,
          type: s.type,
          syncStrategy: s.syncStrategy,
          status: s.status,
          itemCount: s.itemCount,
          lastSyncAt: s.lastSyncAt,
          lastSyncError: s.lastSyncError,
          freshnessWindowMinutes: s.freshnessWindowMinutes,
          createdAt: s.createdAt,
          updatedAt: s.updatedAt,
        })),
        total: rows.length,
      };
    }

    case 'content_get_source': {
      const sourceId = input.sourceId as string;

      const [source] = await db
        .select()
        .from(contentSources)
        .where(and(eq(contentSources.id, sourceId), eq(contentSources.tenantId, tenantId)))
        .limit(1);

      if (!source) {
        throw new Error(`Content source not found: ${sourceId}`);
      }

      const recentRuns = await db
        .select()
        .from(contentSyncRuns)
        .where(eq(contentSyncRuns.sourceId, sourceId))
        .orderBy(desc(contentSyncRuns.startedAt))
        .limit(5);

      return {
        source: {
          id: source.id,
          name: source.name,
          type: source.type,
          syncStrategy: source.syncStrategy,
          status: source.status,
          itemCount: source.itemCount,
          lastSyncAt: source.lastSyncAt,
          lastSyncError: source.lastSyncError,
          freshnessWindowMinutes: source.freshnessWindowMinutes,
          schemaVersion: source.schemaVersion,
          createdAt: source.createdAt,
          updatedAt: source.updatedAt,
        },
        recentSyncRuns: recentRuns.map((r) => ({
          id: r.id,
          status: r.status,
          trigger: r.trigger,
          itemsDiscovered: r.itemsDiscovered,
          itemsCreated: r.itemsCreated,
          itemsUpdated: r.itemsUpdated,
          itemsRemoved: r.itemsRemoved,
          startedAt: r.startedAt,
          completedAt: r.completedAt,
          error: r.error,
        })),
      };
    }

    case 'content_sync_source': {
      const sourceId = input.sourceId as string;

      // Verify source belongs to tenant
      const [source] = await db
        .select({ id: contentSources.id, name: contentSources.name })
        .from(contentSources)
        .where(and(eq(contentSources.id, sourceId), eq(contentSources.tenantId, tenantId)))
        .limit(1);

      if (!source) {
        throw new Error(`Content source not found: ${sourceId}`);
      }

      // Create a pending sync run
      const [syncRun] = await db
        .insert(contentSyncRuns)
        .values({
          sourceId,
          status: 'pending',
          trigger: 'manual',
          itemsDiscovered: 0,
          itemsCreated: 0,
          itemsUpdated: 0,
          itemsRemoved: 0,
        })
        .returning();

      // Update source status to syncing
      await db
        .update(contentSources)
        .set({ status: 'syncing', updatedAt: new Date() })
        .where(eq(contentSources.id, sourceId));

      return {
        syncRunId: syncRun.id,
        sourceId,
        sourceName: source.name,
        status: 'pending',
        message: 'Sync triggered. Use content_get_sync_status to track progress.',
      };
    }

    case 'content_get_sync_status': {
      const syncRunId = input.syncRunId as string;

      const [run] = await db
        .select()
        .from(contentSyncRuns)
        .where(eq(contentSyncRuns.id, syncRunId))
        .limit(1);

      if (!run) {
        throw new Error(`Sync run not found: ${syncRunId}`);
      }

      // Verify via source that this belongs to tenant
      const [source] = await db
        .select({ tenantId: contentSources.tenantId, name: contentSources.name })
        .from(contentSources)
        .where(eq(contentSources.id, run.sourceId))
        .limit(1);

      if (!source || source.tenantId !== tenantId) {
        throw new Error(`Sync run not found: ${syncRunId}`);
      }

      return {
        id: run.id,
        sourceId: run.sourceId,
        sourceName: source.name,
        status: run.status,
        trigger: run.trigger,
        itemsDiscovered: run.itemsDiscovered,
        itemsCreated: run.itemsCreated,
        itemsUpdated: run.itemsUpdated,
        itemsRemoved: run.itemsRemoved,
        startedAt: run.startedAt,
        completedAt: run.completedAt,
        error: run.error,
      };
    }

    // ── Search ───────────────────────────────────────────────────────────────

    case 'content_search': {
      const query = input.query as string;
      const sourceIds = input.sourceIds as string[] | undefined;
      const limit = Math.min((input.limit as number | undefined) ?? 10, 50);
      const offset = (input.offset as number | undefined) ?? 0;

      // Get sources this tenant can access
      const tenantSources = await db
        .select({ id: contentSources.id })
        .from(contentSources)
        .where(eq(contentSources.tenantId, tenantId));

      const tenantSourceIds = tenantSources.map((s) => s.id);
      if (tenantSourceIds.length === 0) {
        return { items: [], total: 0, query };
      }

      // Restrict to requested sourceIds if provided, intersected with tenant sources
      const effectiveSourceIds =
        sourceIds && sourceIds.length > 0
          ? sourceIds.filter((id) => tenantSourceIds.includes(id))
          : tenantSourceIds;

      if (effectiveSourceIds.length === 0) {
        return { items: [], total: 0, query };
      }

      // Simple LIKE search on title and body (FTS wired via SearchService in WP12)
      const searchPattern = `%${query}%`;
      const rows = await db
        .select({
          id: contentItems.id,
          sourceId: contentItems.sourceId,
          sourceRef: contentItems.sourceRef,
          title: contentItems.title,
          body: contentItems.body,
          contentType: contentItems.contentType,
          metadata: contentItems.metadata,
          dataTier: contentItems.dataTier,
          isStale: contentItems.isStale,
          lastSyncedAt: contentItems.lastSyncedAt,
          createdAt: contentItems.createdAt,
        })
        .from(contentItems)
        .where(
          and(
            inArray(contentItems.sourceId, effectiveSourceIds),
            or(
              like(contentItems.title, searchPattern),
              like(contentItems.body, searchPattern)
            )
          )
        )
        .orderBy(desc(contentItems.updatedAt))
        .limit(limit)
        .offset(offset);

      return {
        items: rows,
        total: rows.length,
        query,
        limit,
        offset,
        note: 'Full-text search will be available after SearchService integration (WP12).',
      };
    }

    case 'content_get_item': {
      const itemId = input.itemId as string;

      const [item] = await db
        .select()
        .from(contentItems)
        .where(eq(contentItems.id, itemId))
        .limit(1);

      if (!item) {
        throw new Error(`Content item not found: ${itemId}`);
      }

      // Verify item belongs to a tenant source
      const [source] = await db
        .select({ tenantId: contentSources.tenantId, name: contentSources.name })
        .from(contentSources)
        .where(eq(contentSources.id, item.sourceId))
        .limit(1);

      if (!source || source.tenantId !== tenantId) {
        throw new Error(`Content item not found: ${itemId}`);
      }

      return {
        id: item.id,
        sourceId: item.sourceId,
        sourceName: source.name,
        sourceRef: item.sourceRef,
        title: item.title,
        body: item.body,
        contentType: item.contentType,
        metadata: item.metadata,
        dataTier: item.dataTier,
        isStale: item.isStale,
        lastSyncedAt: item.lastSyncedAt,
        createdAt: item.createdAt,
        updatedAt: item.updatedAt,
      };
    }

    // ── Entitlements ─────────────────────────────────────────────────────────

    case 'content_resolve_entitlements': {
      // DB-direct: query existing entitlement rows for this user+tenant
      // Full resolution via EntitlementService wired in WP12
      const rows = await db
        .select()
        .from(contentEntitlements)
        .where(
          and(
            eq(contentEntitlements.tenantId, tenantId),
            eq(contentEntitlements.userId, userId)
          )
        )
        .orderBy(desc(contentEntitlements.resolvedAt));

      const now = new Date();
      const active = rows.filter((e) => e.expiresAt > now);

      return {
        userId,
        tenantId,
        entitlements: active.map((e) => ({
          id: e.id,
          productId: e.productId,
          resolvedFrom: e.resolvedFrom,
          resolvedAt: e.resolvedAt,
          expiresAt: e.expiresAt,
        })),
        total: active.length,
        note: 'Full entitlement resolution via EntitlementService available in WP12.',
      };
    }

    case 'content_list_products': {
      const rows = await db
        .select()
        .from(contentProducts)
        .where(and(eq(contentProducts.tenantId, tenantId), eq(contentProducts.isActive, true)))
        .orderBy(contentProducts.name);

      // For each product, get linked source count
      const productIds = rows.map((p) => p.id);
      const sourceCounts =
        productIds.length > 0
          ? await db
              .select({
                productId: contentProductSources.productId,
                count: sql<number>`count(*)::int`,
              })
              .from(contentProductSources)
              .where(inArray(contentProductSources.productId, productIds))
              .groupBy(contentProductSources.productId)
          : [];

      const sourceCountMap = new Map(sourceCounts.map((r) => [r.productId, r.count]));

      return {
        products: rows.map((p) => ({
          id: p.id,
          name: p.name,
          description: p.description,
          isActive: p.isActive,
          sourceCount: sourceCountMap.get(p.id) ?? 0,
          createdAt: p.createdAt,
          updatedAt: p.updatedAt,
        })),
        total: rows.length,
      };
    }

    // ── Generation ───────────────────────────────────────────────────────────

    case 'content_generate': {
      // Generation requires GenerationService wired in WP12.
      // Return a placeholder with the resolved sources so callers know what is available.
      const query = input.query as string;
      const profileId = input.profileId as string | undefined;
      const sourceIds = input.sourceIds as string[] | undefined;
      const maxSources = Math.min((input.maxSources as number | undefined) ?? 5, 20);

      const tenantSources = await db
        .select({ id: contentSources.id, name: contentSources.name, status: contentSources.status })
        .from(contentSources)
        .where(and(eq(contentSources.tenantId, tenantId), eq(contentSources.status, 'active')));

      const available =
        sourceIds && sourceIds.length > 0
          ? tenantSources.filter((s) => sourceIds.includes(s.id)).slice(0, maxSources)
          : tenantSources.slice(0, maxSources);

      return {
        query,
        profileId: profileId ?? null,
        availableSources: available,
        response: null,
        citations: [],
        note: 'Content generation via GenerationService will be available in WP12. Available sources listed above.',
      };
    }

    // ── Dashboard ─────────────────────────────────────────────────────────────

    case 'content_state_dashboard': {
      const [statusCounts, itemStats, staleSources] = await Promise.all([
        // Source counts by status
        db
          .select({
            status: contentSources.status,
            count: sql<number>`count(*)::int`,
          })
          .from(contentSources)
          .where(eq(contentSources.tenantId, tenantId))
          .groupBy(contentSources.status),

        // Total items and stale item count across tenant sources
        db
          .select({
            totalItems: sql<number>`coalesce(sum(${contentSources.itemCount}), 0)::int`,
            sourceCount: sql<number>`count(*)::int`,
          })
          .from(contentSources)
          .where(eq(contentSources.tenantId, tenantId)),

        // Sources with recent errors
        db
          .select({
            id: contentSources.id,
            name: contentSources.name,
            status: contentSources.status,
            lastSyncAt: contentSources.lastSyncAt,
            lastSyncError: contentSources.lastSyncError,
          })
          .from(contentSources)
          .where(
            and(
              eq(contentSources.tenantId, tenantId),
              eq(contentSources.status, 'error')
            )
          )
          .limit(5),
      ]);

      const byStatus = Object.fromEntries(statusCounts.map((r) => [r.status, r.count]));
      const totals = itemStats[0] ?? { totalItems: 0, sourceCount: 0 };

      return {
        tenantId,
        sources: {
          total: totals.sourceCount,
          byStatus: {
            active: byStatus['active'] ?? 0,
            syncing: byStatus['syncing'] ?? 0,
            error: byStatus['error'] ?? 0,
            disconnected: byStatus['disconnected'] ?? 0,
          },
        },
        items: {
          total: totals.totalItems,
        },
        recentErrors: staleSources,
        generatedAt: new Date().toISOString(),
      };
    }

    // ── Drift ─────────────────────────────────────────────────────────────────

    case 'content_drift_report': {
      const profileId = input.profileId as string;
      const windowDays = (input.windowDays as number | undefined) ?? 7;
      const since = new Date(Date.now() - windowDays * 24 * 60 * 60 * 1000);

      const rows = await db
        .select()
        .from(contentDriftReports)
        .where(
          and(
            eq(contentDriftReports.tenantId, tenantId),
            eq(contentDriftReports.profileId, profileId),
            sql`${contentDriftReports.windowEnd} >= ${since.toISOString()}`
          )
        )
        .orderBy(desc(contentDriftReports.windowEnd))
        .limit(10);

      const avgScore =
        rows.length > 0
          ? rows.reduce((sum, r) => sum + r.overallDriftScore, 0) / rows.length
          : null;

      return {
        profileId,
        windowDays,
        reports: rows.map((r) => ({
          id: r.id,
          windowStart: r.windowStart,
          windowEnd: r.windowEnd,
          generationsEvaluated: r.generationsEvaluated,
          overallDriftScore: r.overallDriftScore,
          dimensionScores: r.dimensionScores,
          recommendations: r.recommendations,
          createdAt: r.createdAt,
        })),
        total: rows.length,
        averageDriftScore: avgScore,
      };
    }

    case 'content_drift_summary': {
      // Aggregate latest drift score per profile for this tenant
      const rows = await db
        .select({
          profileId: contentDriftReports.profileId,
          latestScore: sql<number>`max(${contentDriftReports.overallDriftScore})`,
          reportCount: sql<number>`count(*)::int`,
          latestWindowEnd: sql<string>`max(${contentDriftReports.windowEnd})`,
        })
        .from(contentDriftReports)
        .where(eq(contentDriftReports.tenantId, tenantId))
        .groupBy(contentDriftReports.profileId)
        .orderBy(sql`max(${contentDriftReports.overallDriftScore}) desc`);

      const overallAvg =
        rows.length > 0
          ? rows.reduce((sum, r) => sum + Number(r.latestScore), 0) / rows.length
          : null;

      return {
        tenantId,
        profiles: rows.map((r) => ({
          profileId: r.profileId,
          latestDriftScore: Number(r.latestScore),
          reportCount: r.reportCount,
          latestWindowEnd: r.latestWindowEnd,
        })),
        profileCount: rows.length,
        overallAverageDriftScore: overallAvg,
        generatedAt: new Date().toISOString(),
      };
    }

    default:
      throw new Error(`Unknown content tool: ${toolName}`);
  }
}
