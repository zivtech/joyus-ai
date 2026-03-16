/**
 * Automated Pipelines Framework — Review Gates barrel export.
 *
 * Provides ReviewGate (pause execution at gate), DecisionRecorder (record
 * reviewer approvals/rejections), EscalationChecker (timeout enforcement),
 * and cron helpers for hourly escalation scanning.
 */

import cron from 'node-cron';
import type { ScheduledTask } from 'node-cron';
import type { EscalationChecker } from './escalation.js';

// ============================================================
// ESCALATION CRON JOB
// ============================================================

let escalationTask: ScheduledTask | null = null;

/**
 * Start an hourly cron job that calls checkAndEscalate().
 * Safe to call multiple times — subsequent calls replace the previous task.
 */
export function startEscalationJob(checker: EscalationChecker): void {
  if (escalationTask) {
    escalationTask.stop();
  }

  escalationTask = cron.schedule('0 * * * *', async () => {
    try {
      const results = await checker.checkAndEscalate();
      if (results.length > 0) {
        console.info(
          `[EscalationJob] Escalated ${results.length} gate(s).`,
        );
      }
    } catch (err) {
      console.error(
        '[EscalationJob] Error during escalation check:',
        err instanceof Error ? err.message : String(err),
      );
    }
  });
}

/**
 * Stop the running escalation cron job, if any.
 */
export function stopEscalationJob(): void {
  if (escalationTask) {
    escalationTask.stop();
    escalationTask = null;
  }
}

// ============================================================
// RE-EXPORTS
// ============================================================

export { ReviewGate } from './gate.js';
export { DecisionRecorder } from './decision.js';
export type { ReviewGateResult } from './decision.js';
export { EscalationChecker } from './escalation.js';
export type { EscalationResult } from './escalation.js';
