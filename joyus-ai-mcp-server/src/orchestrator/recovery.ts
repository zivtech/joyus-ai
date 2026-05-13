/**
 * Crash Recovery — WP01 (T014)
 *
 * On server startup, sessions that were 'running' when the process crashed
 * are left orphaned: their status never advanced to 'completed' or 'failed'
 * because the Inngest function was interrupted.
 *
 * This module detects those sessions and marks them 'failed' so they do not
 * silently consume tenant concurrency slots.
 *
 * Inngest provides its own retry/replay for transient failures within a run.
 * This recovery path handles the rarer case of process death (OOM, deploy, etc.)
 * where the Inngest function itself never completed.
 *
 * Usage (in src/index.ts, after DB is ready, before server.listen):
 *   import { runCrashRecovery } from './orchestrator/recovery.js';
 *   import { SessionService } from './orchestrator/session.service.js';
 *   await runCrashRecovery(new SessionService(db));
 */

import type { SessionService } from './session.service.js';

export interface CrashRecoveryResult {
  /** Sessions successfully marked as failed. */
  recovered: number;
  /** Sessions that could not be marked failed (already transitioned). */
  skipped: number;
  /** Errors encountered during recovery (non-fatal). */
  errors: number;
}

/**
 * Run the startup crash recovery sweep.
 *
 * Finds all sessions with status 'running' and an updatedAt older than
 * the cutoff threshold (default: 10 minutes), then marks each one as 'failed'
 * with recovery metadata merged into the existing metadata JSONB column.
 *
 * @param sessionService - SessionService instance backed by the production DB
 * @param cutoffMs - Age threshold for orphaned session detection (default: 10 min)
 * @returns Summary of the recovery sweep
 */
export async function runCrashRecovery(
  sessionService: SessionService,
  cutoffMs = 10 * 60 * 1000,
): Promise<CrashRecoveryResult> {
  const result: CrashRecoveryResult = { recovered: 0, skipped: 0, errors: 0 };

  let orphaned;
  try {
    orphaned = await sessionService.findAllOrphanedSessions(cutoffMs);
  } catch (err) {
    console.error('[CrashRecovery] Failed to query orphaned sessions:', err);
    result.errors++;
    return result;
  }

  if (orphaned.length === 0) {
    console.log('[CrashRecovery] No orphaned sessions found.');
    return result;
  }

  console.warn(
    `[CrashRecovery] Found ${orphaned.length} orphaned session(s). Marking as failed...`,
  );

  for (const session of orphaned) {
    try {
      const updated = await sessionService.markOrphanedAsFailed(session.tenantId, session.id);
      if (updated !== null) {
        console.warn(
          `[CrashRecovery] Marked session ${session.id} (tenant: ${session.tenantId}) as failed.`,
        );
        result.recovered++;
      } else {
        // Session was updated by another process between the orphan query and
        // the mark-failed call (race on multi-pod deployments). Not an error.
        result.skipped++;
      }
    } catch (err) {
      console.error(
        `[CrashRecovery] Error marking session ${session.id} as failed:`,
        err,
      );
      result.errors++;
    }
  }

  console.log(
    `[CrashRecovery] Complete — recovered: ${result.recovered}, ` +
    `skipped: ${result.skipped}, errors: ${result.errors}`,
  );

  return result;
}
