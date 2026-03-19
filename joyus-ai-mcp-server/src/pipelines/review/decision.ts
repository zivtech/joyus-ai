/**
 * DecisionRecorder — records reviewer decisions on pending artifacts and,
 * once all decisions for a gate step are complete, resumes the execution.
 */

import { eq, and } from 'drizzle-orm';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import {
  reviewDecisions,
  executionSteps,
  pipelineExecutions,
} from '../schema.js';
import type { ReviewDecision } from '../schema.js';
import type { ArtifactRef, ReviewFeedback } from '../types.js';
import { inngest } from '../../inngest/client.js';

// ============================================================
// REVIEW GATE RESULT (appended to outputArtifacts on resume)
// ============================================================

export interface ReviewGateResult {
  gateStepPosition: number;
  approvedArtifacts: ArtifactRef[];
  rejectedArtifacts: Array<{ artifact: ArtifactRef; feedback: ReviewFeedback | null }>;
  approvalRate: number;
}

// ============================================================
// DECISION RECORDER
// ============================================================

export class DecisionRecorder {
  constructor(private readonly db: NodePgDatabase) {}

  /**
   * Record a single reviewer decision (approve or reject) for a pending
   * review_decision row.
   *
   * Enforces:
   *  - Tenant isolation: decision must belong to the supplied tenantId
   *  - No duplicate decisions: status must be 'pending'
   *
   * When all decisions for the gate step are complete the execution is
   * automatically resumed so the executor poll loop can continue.
   */
  async recordDecision(
    decisionId: string,
    tenantId: string,
    status: 'approved' | 'rejected',
    reviewerId: string,
    feedback?: ReviewFeedback,
  ): Promise<{ allDecisionsComplete: boolean; executionId: string }> {
    // Load the decision
    const rows = await this.db
      .select()
      .from(reviewDecisions)
      .where(eq(reviewDecisions.id, decisionId));

    if (rows.length === 0) {
      throw new Error(`Review decision not found: ${decisionId}`);
    }

    const decision = rows[0] as ReviewDecision;

    // Tenant isolation
    if (decision.tenantId !== tenantId) {
      throw new Error(`Cross-tenant access denied for decision: ${decisionId}`);
    }

    // No duplicate decisions
    if (decision.status !== 'pending') {
      throw new Error(
        `Decision ${decisionId} already resolved with status '${decision.status}'`,
      );
    }

    // Persist the decision
    await this.db
      .update(reviewDecisions)
      .set({
        status,
        reviewerId,
        decidedAt: new Date(),
        feedback: status === 'rejected' && feedback
          ? (feedback as unknown as Record<string, unknown>)
          : null,
      })
      .where(eq(reviewDecisions.id, decisionId));

    const allDecisionsComplete = await this.areAllDecisionsComplete(
      decision.executionId,
      decision.executionStepId,
    );

    if (allDecisionsComplete) {
      await this.resumeExecution(decision.executionId);

      // Send Inngest event to resume the paused review-gate step.
      // id is a deterministic idempotency key — prevents duplicate resumes if
      // two reviewers submit their final decision concurrently.
      await inngest.send({
        id: `review-decided-${decision.executionId}`,
        name: 'pipeline/review.decided',
        data: {
          tenantId: decision.tenantId,
          executionId: decision.executionId,
          decision: status,
          feedback: status === 'rejected' && feedback ? feedback.reason : undefined,
        },
      });
    }

    return { allDecisionsComplete, executionId: decision.executionId };
  }

  /**
   * Returns true when no decision for the given step is still 'pending'.
   */
  async areAllDecisionsComplete(
    executionId: string,
    executionStepId: string,
  ): Promise<boolean> {
    const pending = await this.db
      .select()
      .from(reviewDecisions)
      .where(
        and(
          eq(reviewDecisions.executionId, executionId),
          eq(reviewDecisions.executionStepId, executionStepId),
          eq(reviewDecisions.status, 'pending'),
        ),
      );

    return pending.length === 0;
  }

  /**
   * Build the ReviewGateResult summary, mark the gate step completed, and
   * set the execution status back to 'running' so the executor can continue.
   */
  private async resumeExecution(executionId: string): Promise<void> {
    // Load all decisions for this execution
    const allDecisions = await this.db
      .select()
      .from(reviewDecisions)
      .where(eq(reviewDecisions.executionId, executionId));

    if (allDecisions.length === 0) return;

    // Partition approved vs rejected
    const approved: ArtifactRef[] = [];
    const rejected: Array<{ artifact: ArtifactRef; feedback: ReviewFeedback | null }> = [];

    for (const d of allDecisions) {
      const artifact = d.artifactRef as unknown as ArtifactRef;
      if (d.status === 'approved') {
        approved.push(artifact);
      } else if (d.status === 'rejected') {
        rejected.push({
          artifact,
          feedback: (d.feedback as unknown as ReviewFeedback | null) ?? null,
        });
      }
    }

    const total = approved.length + rejected.length;
    const approvalRate = total > 0 ? approved.length / total : 0;

    // Load the gate execution step to get its position
    const gateStepId = allDecisions[0].executionStepId;
    const stepRows = await this.db
      .select()
      .from(executionSteps)
      .where(eq(executionSteps.id, gateStepId));

    const gateStepPosition = stepRows.length > 0 ? stepRows[0].position : 0;

    const gateResult: ReviewGateResult = {
      gateStepPosition,
      approvedArtifacts: approved,
      rejectedArtifacts: rejected,
      approvalRate,
    };

    // Load existing outputArtifacts to append
    const execRows = await this.db
      .select()
      .from(pipelineExecutions)
      .where(eq(pipelineExecutions.id, executionId));

    const existing = execRows.length > 0
      ? (execRows[0].outputArtifacts as unknown[]) ?? []
      : [];

    const updatedArtifacts = [...existing, gateResult];

    // Mark gate step completed
    await this.db
      .update(executionSteps)
      .set({ status: 'completed', completedAt: new Date() })
      .where(eq(executionSteps.id, gateStepId));

    // Resume execution — the executor poll loop will continue from here
    await this.db
      .update(pipelineExecutions)
      .set({
        status: 'running',
        outputArtifacts: updatedArtifacts as unknown as Record<string, unknown>[],
      })
      .where(eq(pipelineExecutions.id, executionId));
  }
}
