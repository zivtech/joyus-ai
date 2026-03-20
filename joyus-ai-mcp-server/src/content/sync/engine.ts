/**
 * Content Infrastructure — Sync Engine
 *
 * Orchestrates sync runs for content sources.  Delegates to the appropriate
 * strategy (mirror / pass-through / hybrid), pages through connector batches,
 * and upserts results into content.items.
 */

import { eq, and, sql, notInArray } from 'drizzle-orm';
import { createId } from '@paralleldrive/cuid2';

import { contentSources, contentItems, contentSyncRuns } from '../schema.js';
import type { ConnectorRegistry } from '../connectors/registry.js';
import type { ContentConnector, ContentPayload } from '../connectors/interface.js';
import type { SyncStrategy, SyncTrigger } from '../types.js';
import { DEFAULT_BATCH_SIZE } from '../types.js';
import {
  createSyncRun,
  completeSyncRun,
  failSyncRun,
  updateSyncRun,
  type SyncRunStats,
} from './state.js';
import type { DrizzleClient } from '../../db/types.js';

// ============================================================
// SYNC ENGINE
// ============================================================

export class SyncEngine {
  /** Exposed so the scheduler can pass it to state helpers. */
  readonly db: DrizzleClient;
  private readonly registry: ConnectorRegistry;

  constructor(db: DrizzleClient, registry: ConnectorRegistry) {
    this.db = db;
    this.registry = registry;
  }

  // ----------------------------------------------------------
  // PUBLIC API
  // ----------------------------------------------------------

  /**
   * Kick off a sync run for the given source.
   * Prevents concurrent syncs by checking source.status.
   */
  async syncSource(sourceId: string, trigger: SyncTrigger): Promise<string> {
    // Load the source
    const [source] = await this.db
      .select()
      .from(contentSources)
      .where(eq(contentSources.id, sourceId))
      .limit(1);

    if (!source) {
      throw new Error(`Source not found: ${sourceId}`);
    }

    // Guard against concurrent syncs
    if (source.status === 'syncing') {
      throw new Error(`Source ${sourceId} is already syncing`);
    }

    // Mark source as syncing
    await this.db
      .update(contentSources)
      .set({ status: 'syncing', lastSyncError: null, updatedAt: new Date() })
      .where(eq(contentSources.id, sourceId));

    // Create sync run record
    const runId = await createSyncRun(this.db, sourceId, trigger);

    // Mark run as running
    await updateSyncRun(this.db, runId, { status: 'running' });

    try {
      const connector = this.registry.getOrThrow(source.type);
      const stats = await this.executeSyncRun(source, connector, runId);

      // Update source on success
      await this.db
        .update(contentSources)
        .set({
          status: 'active',
          lastSyncAt: new Date(),
          lastSyncError: null,
          itemCount: stats.itemsDiscovered,
          updatedAt: new Date(),
        })
        .where(eq(contentSources.id, sourceId));

      await completeSyncRun(this.db, runId, stats);
      console.log(`[sync-engine] Completed sync for source ${sourceId} (run ${runId})`);
      return runId;
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);

      // Update source on failure
      await this.db
        .update(contentSources)
        .set({
          status: 'error',
          lastSyncError: message,
          updatedAt: new Date(),
        })
        .where(eq(contentSources.id, sourceId));

      await failSyncRun(this.db, runId, message);
      console.error(`[sync-engine] Sync failed for source ${sourceId}:`, message);
      throw err;
    }
  }

  // ----------------------------------------------------------
  // STRATEGY DISPATCH
  // ----------------------------------------------------------

  private async executeSyncRun(
    source: typeof contentSources.$inferSelect,
    connector: ContentConnector,
    runId: string,
  ): Promise<SyncRunStats> {
    const strategy = source.syncStrategy as SyncStrategy;

    switch (strategy) {
      case 'mirror':
        return this.executeMirrorSync(source, connector, runId);
      case 'pass-through':
        return this.executePassThroughSync(source, connector, runId);
      case 'hybrid':
        return this.executeHybridSync(source, connector, runId);
      default: {
        const exhaustive: never = strategy;
        throw new Error(`Unknown sync strategy: ${exhaustive}`);
      }
    }
  }

  // ----------------------------------------------------------
  // MIRROR — index full body content
  // ----------------------------------------------------------

  private async executeMirrorSync(
    source: typeof contentSources.$inferSelect,
    connector: ContentConnector,
    runId: string,
  ): Promise<SyncRunStats> {
    const stats = await this.indexInBatches(source, connector, runId, { indexBody: true });

    // Remove items no longer present in the source
    const removed = await this.removeStaleItems(source.id, runId);
    stats.itemsRemoved = removed;

    return stats;
  }

  // ----------------------------------------------------------
  // PASS-THROUGH — index metadata only, body fetched on demand
  // ----------------------------------------------------------

  private async executePassThroughSync(
    source: typeof contentSources.$inferSelect,
    connector: ContentConnector,
    runId: string,
  ): Promise<SyncRunStats> {
    return this.indexInBatches(source, connector, runId, { indexBody: false });
  }

  // ----------------------------------------------------------
  // HYBRID — index metadata; body stored where available
  // ----------------------------------------------------------

  private async executeHybridSync(
    source: typeof contentSources.$inferSelect,
    connector: ContentConnector,
    runId: string,
  ): Promise<SyncRunStats> {
    return this.indexInBatches(source, connector, runId, { indexBody: true });
  }

  // ----------------------------------------------------------
  // BATCH INDEXING (cursor-based pagination loop)
  // ----------------------------------------------------------

  private async indexInBatches(
    source: typeof contentSources.$inferSelect,
    connector: ContentConnector,
    runId: string,
    options: { indexBody: boolean },
  ): Promise<SyncRunStats> {
    const stats: SyncRunStats = {
      itemsDiscovered: 0,
      itemsCreated: 0,
      itemsUpdated: 0,
      itemsRemoved: 0,
    };

    let cursor: string | null = null;

    for (;;) {
      const batchResult = await connector.indexBatch(
        source.connectionConfig as Record<string, unknown>,
        cursor,
        DEFAULT_BATCH_SIZE,
      );

      const items = batchResult.items;
      stats.itemsDiscovered += items.length;

      // Save cursor progress so a resume is possible
      await updateSyncRun(this.db, runId, {
        cursor: batchResult.nextCursor ?? null,
        itemsDiscovered: stats.itemsDiscovered,
      });

      // Upsert each item
      for (const payload of items) {
        const upsertResult = await this.upsertItem(source, payload, options.indexBody);
        if (upsertResult === 'created') {
          stats.itemsCreated++;
        } else {
          stats.itemsUpdated++;
        }
      }

      cursor = batchResult.nextCursor;
      if (!cursor) {
        break;
      }
    }

    return stats;
  }

  // ----------------------------------------------------------
  // UPSERT
  // ----------------------------------------------------------

  private async upsertItem(
    source: typeof contentSources.$inferSelect,
    payload: ContentPayload,
    includeBody: boolean,
  ): Promise<'created' | 'updated'> {
    const now = new Date();

    // Determine whether the row exists so we can return the right operation label.
    const [existing] = await this.db
      .select({ id: contentItems.id })
      .from(contentItems)
      .where(
        and(
          eq(contentItems.sourceId, source.id),
          eq(contentItems.sourceRef, payload.sourceRef),
        ),
      )
      .limit(1);

    await this.db
      .insert(contentItems)
      .values({
        id: createId(),
        sourceId: source.id,
        sourceRef: payload.sourceRef,
        title: payload.title,
        body: includeBody ? (payload.body ?? null) : null,
        contentType: payload.contentType,
        metadata: payload.metadata,
        lastSyncedAt: now,
        isStale: false,
      })
      .onConflictDoUpdate({
        target: [contentItems.sourceId, contentItems.sourceRef],
        set: {
          title: payload.title,
          body: includeBody ? (payload.body ?? null) : undefined,
          contentType: payload.contentType,
          metadata: payload.metadata,
          lastSyncedAt: now,
          isStale: false,
          updatedAt: now,
        },
      });

    return existing ? 'updated' : 'created';
  }

  // ----------------------------------------------------------
  // ON-DEMAND FETCH (pass-through / hybrid)
  // ----------------------------------------------------------

  /**
   * Fetch full content for a single item on demand.
   * Updates the stored body and clears the stale flag.
   */
  async fetchItemContent(sourceId: string, sourceRef: string): Promise<ContentPayload> {
    const [source] = await this.db
      .select()
      .from(contentSources)
      .where(eq(contentSources.id, sourceId))
      .limit(1);

    if (!source) {
      throw new Error(`Source not found: ${sourceId}`);
    }

    const connector = this.registry.getOrThrow(source.type);
    const payload = await connector.fetchContent(
      source.connectionConfig as Record<string, unknown>,
      sourceRef,
    );

    // Persist the fetched body
    await this.db
      .update(contentItems)
      .set({
        body: payload.body ?? null,
        metadata: payload.metadata,
        lastSyncedAt: new Date(),
        isStale: false,
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(contentItems.sourceId, sourceId),
          eq(contentItems.sourceRef, sourceRef),
        ),
      );

    return payload;
  }

  // ----------------------------------------------------------
  // STALE ITEM REMOVAL (mirror strategy)
  // ----------------------------------------------------------

  /**
   * Delete items that were not touched during this sync run.
   * "Not touched" means lastSyncedAt was not updated to the current run start.
   * We compare against items whose sourceRef was seen in this run via the
   * sync_runs cursor tracking — instead, we use a simpler threshold: items
   * whose lastSyncedAt predates the run's startedAt.
   */
  private async removeStaleItems(sourceId: string, runId: string): Promise<number> {
    // Get run start time
    const [run] = await this.db
      .select({ startedAt: contentSyncRuns.startedAt })
      .from(contentSyncRuns)
      .where(eq(contentSyncRuns.id, runId))
      .limit(1);

    if (!run) return 0;

    const result = await this.db.execute(sql`
      DELETE FROM content.items
      WHERE source_id = ${sourceId}
        AND last_synced_at < ${run.startedAt}
    `);

    return (result as unknown as { rowCount?: number | null }).rowCount ?? 0;
  }
}

// ============================================================
// CONVENIENCE FUNCTION
// ============================================================

/**
 * Convenience wrapper: create a SyncEngine and trigger a single source sync.
 * Useful for one-off manual triggers in MCP tool handlers.
 */
export async function triggerSync(
  db: DrizzleClient,
  registry: ConnectorRegistry,
  sourceId: string,
  trigger: SyncTrigger = 'manual',
): Promise<string> {
  const engine = new SyncEngine(db, registry);
  return engine.syncSource(sourceId, trigger);
}
