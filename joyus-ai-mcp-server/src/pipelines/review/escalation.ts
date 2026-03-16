/**
 * EscalationChecker — scans paused executions and flags gate decisions that
 * have exceeded the pipeline's reviewGateTimeoutHours threshold.
 *
 * This checker NEVER auto-approves or auto-rejects. It only marks decisions
 * with an escalatedAt timestamp and (optionally) fires a notification.
 */

import { eq, and, isNull } from 'drizzle-orm';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import {
  pipelineExecutions,
  pipelines,
  executionSteps,
  reviewDecisions,
} from '../schema.js';

// ============================================================
// RESULT TYPE
// ============================================================

export interface EscalationResult {
  executionId: string;
  pipelineId: string;
  tenantId: string;
  gateStepName: string;
  hoursWaiting: number;
  pendingDecisionCount: number;
}

// ============================================================
// NOTIFICATION SERVICE INTERFACE (optional dependency)
// ============================================================

export interface NotificationService {
  sendEscalationAlert(result: EscalationResult): Promise<void>;
}

// ============================================================
// ESCALATION CHECKER
// ============================================================

export class EscalationChecker {
  constructor(
    private readonly db: NodePgDatabase,
    private readonly notificationService?: NotificationService,
  ) {}

  /**
   * Check all paused executions and escalate any that have exceeded their
   * pipeline timeout threshold. Returns the list of newly escalated items.
   */
  async checkAndEscalate(): Promise<EscalationResult[]> {
    // Load all executions currently paused at a gate
    const pausedExecutions = await this.db
      .select()
      .from(pipelineExecutions)
      .where(eq(pipelineExecutions.status, 'paused_at_gate'));

    const results: EscalationResult[] = [];

    for (const execution of pausedExecutions) {
      // Load the pipeline for its timeout setting
      const pipelineRows = await this.db
        .select()
        .from(pipelines)
        .where(eq(pipelines.id, execution.pipelineId));

      if (pipelineRows.length === 0) continue;

      const pipeline = pipelineRows[0];
      const timeoutHours = pipeline.reviewGateTimeoutHours;

      // Find the gate step (running execution step)
      const gateStepRows = await this.db
        .select()
        .from(executionSteps)
        .where(
          and(
            eq(executionSteps.executionId, execution.id),
            eq(executionSteps.status, 'running'),
          ),
        );

      if (gateStepRows.length === 0) continue;

      const gateStep = gateStepRows[0];

      // Compute elapsed time based on execution start
      const startedAt = execution.startedAt;
      const elapsedMs = Date.now() - startedAt.getTime();
      const elapsedHours = elapsedMs / (1000 * 60 * 60);

      if (elapsedHours <= timeoutHours) {
        continue; // still within the allowed window
      }

      // Find pending decisions that have NOT yet been escalated
      const pendingUnescalated = await this.db
        .select()
        .from(reviewDecisions)
        .where(
          and(
            eq(reviewDecisions.executionId, execution.id),
            eq(reviewDecisions.executionStepId, gateStep.id),
            eq(reviewDecisions.status, 'pending'),
            isNull(reviewDecisions.escalatedAt),
          ),
        );

      if (pendingUnescalated.length === 0) {
        // All already escalated — skip
        continue;
      }

      // Mark all pending decisions as escalated
      for (const decision of pendingUnescalated) {
        await this.db
          .update(reviewDecisions)
          .set({ escalatedAt: new Date() })
          .where(eq(reviewDecisions.id, decision.id));
      }

      const result: EscalationResult = {
        executionId: execution.id,
        pipelineId: execution.pipelineId,
        tenantId: execution.tenantId,
        gateStepName: gateStep.id, // step name not on executionSteps; use id as identifier
        hoursWaiting: elapsedHours,
        pendingDecisionCount: pendingUnescalated.length,
      };

      // Send notification if service is available
      if (this.notificationService) {
        try {
          await this.notificationService.sendEscalationAlert(result);
        } catch (err) {
          console.error(
            '[EscalationChecker] Failed to send notification:',
            err instanceof Error ? err.message : String(err),
          );
        }
      } else {
        console.warn(
          `[EscalationChecker] Gate timeout exceeded for execution ${execution.id} ` +
          `(${elapsedHours.toFixed(1)}h > ${timeoutHours}h). ` +
          `${pendingUnescalated.length} decision(s) escalated.`,
        );
      }

      results.push(result);
    }

    return results;
  }
}
