/**
 * Content Infrastructure — Sync Scheduler
 *
 * Polls for sources that need syncing every 5 minutes via node-cron.
 * Caps concurrency at 3 simultaneous sync runs.
 */

import cron from 'node-cron';

import type { SyncEngine } from './engine.js';
import { detectStaleContent, detectStaleSources } from './state.js';

// ============================================================
// INTERNALS
// ============================================================

const MAX_CONCURRENT_SYNCS = 3;

let scheduledJob: cron.ScheduledTask | null = null;
let activeSyncs = 0;

// ============================================================
// PUBLIC API
// ============================================================

/**
 * Start the sync scheduler.  Fires every 5 minutes.
 *
 * On each tick:
 *  1. Run staleness detection for content items.
 *  2. Find sources whose freshness window has elapsed.
 *  3. Trigger syncs up to MAX_CONCURRENT_SYNCS.
 */
export function initializeSyncScheduler(engine: SyncEngine): void {
  if (scheduledJob) {
    console.log('[sync-scheduler] Already running — skipping re-initialisation.');
    return;
  }

  scheduledJob = cron.schedule('*/5 * * * *', async () => {
    await runSchedulerTick(engine);
  });

  console.log('[sync-scheduler] Initialised — fires every 5 minutes.');
}

/**
 * Stop the sync scheduler.  Idempotent.
 */
export function stopSyncScheduler(): void {
  if (scheduledJob) {
    scheduledJob.stop();
    scheduledJob = null;
    console.log('[sync-scheduler] Stopped.');
  }
}

// ============================================================
// TICK LOGIC
// ============================================================

async function runSchedulerTick(engine: SyncEngine): Promise<void> {
  console.log('[sync-scheduler] Tick start.');

  // 1. Mark stale content items
  try {
    const staleCount = await detectStaleContent(engine.db);
    if (staleCount > 0) {
      console.log(`[sync-scheduler] Marked ${staleCount} stale content item(s).`);
    }
  } catch (err) {
    console.error('[sync-scheduler] Staleness detection failed:', err);
  }

  // 2. Find sources that need syncing
  let staleSources: Awaited<ReturnType<typeof detectStaleSources>>;
  try {
    staleSources = await detectStaleSources(engine.db);
  } catch (err) {
    console.error('[sync-scheduler] Failed to detect stale sources:', err);
    return;
  }

  if (staleSources.length === 0) {
    console.log('[sync-scheduler] No sources need syncing.');
    return;
  }

  console.log(`[sync-scheduler] ${staleSources.length} source(s) need syncing.`);

  // 3. Trigger up to MAX_CONCURRENT_SYNCS
  for (const source of staleSources) {
    if (activeSyncs >= MAX_CONCURRENT_SYNCS) {
      console.log('[sync-scheduler] Concurrency limit reached — deferring remaining sources.');
      break;
    }

    activeSyncs++;
    engine
      .syncSource(source.id, 'scheduled')
      .catch((err: unknown) => {
        console.error(`[sync-scheduler] Sync failed for source ${source.id}:`, err);
      })
      .finally(() => {
        activeSyncs--;
      });
  }
}
