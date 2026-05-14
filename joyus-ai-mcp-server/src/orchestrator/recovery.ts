/**
 * Crash Recovery — WP01 (T014)
 *
 * On server startup, sessions that were 'running' when the process crashed
 * are left orphaned: their status never advanced to 'completed' or 'failed'
 * because the Inngest function was interrupted.
 *
 * Additionally, sessions stuck in 'pending' (where the Inngest session.created
 * event was never delivered after session creation) are also swept.
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

import type { OrchestratorSession } from './session.service.js';
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
 * Mark each session in the list as failed using the provided callback.
 * Mutates `result` in place. Continues processing on individual session errors.
 */
async function sweepSessions(
  sessions: OrchestratorSession[],
  markFailed: (tenantId: string, sessionId: string) => Promise<OrchestratorSession | null>,
  result: CrashRecoveryResult,
  label: string,
): Promise<void> {
  for (const session of sessions) {
    try {
      const updated = await markFailed(session.tenantId, session.id);
      if (updated !== null) {
        console.warn(
          `[CrashRecovery] Marked ${label} session ${session.id} (tenant: ${session.tenantId}) as failed.`,
        );
        result.recovered++;
      } else {
        // Session was updated by another process between the orphan query and
        // the mark-failed call (race on multi-pod deployments). Not an error.
        result.skipped++;
      }
    } catch (err) {
      console.error(
        `[CrashRecovery] Error marking ${label} session ${session.id} as failed:`,
        err,
      );
      result.errors++;
    }
  }
}

/**
 * Run the startup crash recovery sweep.
 *
 * Phase 1 — running sessions: finds all sessions with status 'running' and an
 * updatedAt older than the cutoff threshold, marks each one as 'failed'.
 *
 * Phase 2 — pending sessions: finds all sessions with status 'pending' and a
 * stale updatedAt (indicating the Inngest session.created event was never
 * delivered after creation), marks each one as 'failed'.
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

  // --- Phase 1: sweep orphaned running sessions ---

  let orphanedRunning;
  try {
    orphanedRunning = await sessionService.findAllOrphanedSessions(cutoffMs);
  } catch (err) {
    console.error('[CrashRecovery] Failed to query orphaned running sessions:', err);
    result.errors++;
    return result;
  }

  if (orphanedRunning.length > 0) {
    console.warn(
      `[CrashRecovery] Found ${orphanedRunning.length} orphaned running session(s). Marking as failed...`,
    );
    await sweepSessions(
      orphanedRunning,
      (tenantId, sessionId) => sessionService.markOrphanedAsFailed(tenantId, sessionId),
      result,
      'running',
    );
  } else {
    console.log('[CrashRecovery] No orphaned running sessions found.');
  }

  // --- Phase 2: sweep stuck pending sessions ---

  let orphanedPending: OrchestratorSession[];
  try {
    orphanedPending = await sessionService.findAllOrphanedPendingSessions(cutoffMs);
  } catch (err) {
    console.error('[CrashRecovery] Failed to query orphaned pending sessions:', err);
    result.errors++;
    // Don't return early — running-session sweep already completed above.
    orphanedPending = [];
  }

  if (orphanedPending.length > 0) {
    console.warn(
      `[CrashRecovery] Found ${orphanedPending.length} stuck pending session(s). Marking as failed...`,
    );
    await sweepSessions(
      orphanedPending,
      (tenantId, sessionId) => sessionService.markOrphanedPendingAsFailed(tenantId, sessionId),
      result,
      'pending',
    );
  } else {
    console.log('[CrashRecovery] No stuck pending sessions found.');
  }

  console.log(
    `[CrashRecovery] Complete — recovered: ${result.recovered}, ` +
    `skipped: ${result.skipped}, errors: ${result.errors}`,
  );

  return result;
}
