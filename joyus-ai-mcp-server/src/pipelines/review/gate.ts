/**
 * ReviewGate — creates pending review_decisions for artifacts at a gate step
 * and transitions the execution to paused_at_gate.
 */

import { createId } from '@paralleldrive/cuid2';
import { eq } from 'drizzle-orm';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import {
  reviewDecisions,
  executionSteps,
  pipelineExecutions,
} from '../schema.js';
import type { PipelineExecution, ExecutionStep } from '../schema.js';
import type { ArtifactRef } from '../types.js';

// ============================================================
// REVIEW GATE
// ============================================================

export class ReviewGate {
  constructor(private readonly db: NodePgDatabase) {}

  /**
   * Create one pending review_decision per artifact, set execution_step to
   * 'running', and set pipeline_execution to 'paused_at_gate'.
   *
   * Returns the IDs of created decisions. If no artifacts are provided the
   * caller should skip the gate entirely and this returns an empty array.
   */
  async pauseAtGate(
    execution: PipelineExecution,
    gateStep: ExecutionStep,
    artifacts: ArtifactRef[],
    profileVersionRef?: string,
  ): Promise<string[]> {
    if (artifacts.length === 0) {
      return [];
    }

    // Build one decision row per artifact
    const decisionRows = artifacts.map((artifact) => ({
      id: createId(),
      executionId: execution.id,
      executionStepId: gateStep.id,
      tenantId: execution.tenantId,
      artifactRef: artifact as unknown as Record<string, unknown>,
      profileVersionRef: profileVersionRef ?? null,
      status: 'pending' as const,
    }));

    await this.db.insert(reviewDecisions).values(decisionRows);

    // Mark the gate step as running (it is actively awaiting review)
    await this.db
      .update(executionSteps)
      .set({ status: 'running' })
      .where(eq(executionSteps.id, gateStep.id));

    // Pause the execution at this gate
    await this.db
      .update(pipelineExecutions)
      .set({ status: 'paused_at_gate' })
      .where(eq(pipelineExecutions.id, execution.id));

    return decisionRows.map((r) => r.id);
  }
}
