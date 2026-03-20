/**
 * Content Infrastructure — Sync State Tracking
 *
 * Helper functions that read/write sync run state in the database.
 * All functions accept a DrizzleClient so callers can inject the
 * shared singleton or a transaction handle.
 */

import { eq, desc, sql } from 'drizzle-orm';
import { createId } from '@paralleldrive/cuid2';

import { contentSyncRuns, contentItems, contentSources } from '../schema.js';
import type { SyncTrigger, SyncRunStatus } from '../types.js';
import type { DrizzleClient } from '../../db/types.js';

export interface SyncRunStats {
  itemsDiscovered: number;
  itemsCreated: number;
  itemsUpdated: number;
  itemsRemoved: number;
}

// ============================================================
// SYNC RUN CRUD
// ============================================================

/**
 * Insert a new sync run record with status 'pending'.
 * Returns the created row id.
 */
export async function createSyncRun(
  db: DrizzleClient,
  sourceId: string,
  trigger: SyncTrigger,
): Promise<string> {
  const id = createId();
  await db.insert(contentSyncRuns).values({
    id,
    sourceId,
    trigger,
    status: 'pending',
    startedAt: new Date(),
    itemsDiscovered: 0,
    itemsCreated: 0,
    itemsUpdated: 0,
    itemsRemoved: 0,
  });
  return id;
}

/**
 * Apply a partial update to a sync run row.
 */
export async function updateSyncRun(
  db: DrizzleClient,
  id: string,
  updates: Partial<{
    status: SyncRunStatus;
    cursor: string | null;
    itemsDiscovered: number;
    itemsCreated: number;
    itemsUpdated: number;
    itemsRemoved: number;
    error: string | null;
    completedAt: Date | null;
  }>,
): Promise<void> {
  await db.update(contentSyncRuns).set(updates).where(eq(contentSyncRuns.id, id));
}

/**
 * Mark a sync run as completed with final statistics.
 */
export async function completeSyncRun(
  db: DrizzleClient,
  id: string,
  stats: SyncRunStats,
): Promise<void> {
  await db
    .update(contentSyncRuns)
    .set({
      status: 'completed',
      completedAt: new Date(),
      itemsDiscovered: stats.itemsDiscovered,
      itemsCreated: stats.itemsCreated,
      itemsUpdated: stats.itemsUpdated,
      itemsRemoved: stats.itemsRemoved,
      error: null,
    })
    .where(eq(contentSyncRuns.id, id));
}

/**
 * Mark a sync run as failed with an error message.
 */
export async function failSyncRun(
  db: DrizzleClient,
  id: string,
  error: string,
): Promise<void> {
  await db
    .update(contentSyncRuns)
    .set({
      status: 'failed',
      completedAt: new Date(),
      error,
    })
    .where(eq(contentSyncRuns.id, id));
}

/**
 * Return the most recent sync run for a source (by startedAt), or undefined.
 */
export async function getLatestSyncRun(
  db: DrizzleClient,
  sourceId: string,
): Promise<typeof contentSyncRuns.$inferSelect | undefined> {
  const rows = await db
    .select()
    .from(contentSyncRuns)
    .where(eq(contentSyncRuns.sourceId, sourceId))
    .orderBy(desc(contentSyncRuns.startedAt))
    .limit(1);
  return rows[0];
}

/**
 * Return a sync run by its id, or undefined.
 */
export async function getSyncRunById(
  db: DrizzleClient,
  id: string,
): Promise<typeof contentSyncRuns.$inferSelect | undefined> {
  const rows = await db
    .select()
    .from(contentSyncRuns)
    .where(eq(contentSyncRuns.id, id))
    .limit(1);
  return rows[0];
}

// ============================================================
// STALENESS DETECTION
// ============================================================

/**
 * Bulk-mark content items as stale when their lastSyncedAt is older
 * than their source's freshnessWindowMinutes.
 *
 * Uses a correlated subquery so only one round-trip is needed.
 * Returns the number of rows updated.
 */
export async function detectStaleContent(db: DrizzleClient): Promise<number> {
  const result = await db.execute(sql`
    UPDATE content.items ci
    SET is_stale = true
    FROM content.sources cs
    WHERE ci.source_id = cs.id
      AND ci.is_stale = false
      AND ci.last_synced_at + (cs.freshness_window_minutes * interval '1 minute') < now()
  `);
  // drizzle execute returns a QueryResult; rowCount may be null for some drivers
  return (result as unknown as { rowCount?: number | null }).rowCount ?? 0;
}

/**
 * Return all sources whose lastSyncAt is older than their freshnessWindowMinutes
 * (i.e. they need a new sync cycle).
 */
export async function detectStaleSources(
  db: DrizzleClient,
): Promise<Array<typeof contentSources.$inferSelect>> {
  const rows = await db.execute(sql`
    SELECT *
    FROM content.sources
    WHERE status NOT IN ('syncing', 'disconnected')
      AND (
        last_sync_at IS NULL
        OR last_sync_at + (freshness_window_minutes * interval '1 minute') < now()
      )
  `);
  return (rows as unknown as { rows: Array<typeof contentSources.$inferSelect> }).rows;
}
