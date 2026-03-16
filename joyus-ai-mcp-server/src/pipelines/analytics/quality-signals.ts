/**
 * QualitySignalEmitter — monitors rejection rates and emits quality signals
 * when thresholds are exceeded.
 *
 * A quality signal is stored in the quality_signals table and returned to
 * callers so they can surface it through monitoring or notification channels.
 */

import { createId } from '@paralleldrive/cuid2';
import { eq, and, desc } from 'drizzle-orm';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import {
  reviewDecisions,
  qualitySignals,
  pipelines,
  pipelineExecutions,
} from '../schema.js';
import type { QualitySignal } from '../schema.js';

// ============================================================
// CONFIG
// ============================================================

export interface QualitySignalConfig {
  /** Rejection rate above which a signal is emitted (exclusive). Default 0.3 */
  threshold: number;
  /** Number of recent decisions to evaluate. Default 10 */
  windowSize: number;
  /** Minimum ms between signals for the same pipeline. Default 86400000 (24h) */
  cooldownMs: number;
}

const DEFAULT_CONFIG: QualitySignalConfig = {
  threshold: 0.3,
  windowSize: 10,
  cooldownMs: 86400000,
};

// ============================================================
// QUALITY SIGNAL EMITTER
// ============================================================

export class QualitySignalEmitter {
  private readonly config: QualitySignalConfig;
  /** Tracks the timestamp of the last emitted signal per pipeline id. */
  private readonly lastEmission: Map<string, number> = new Map();

  constructor(
    private readonly db: NodePgDatabase,
    config?: Partial<QualitySignalConfig>,
  ) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  /**
   * Check recent review decisions for the given pipeline and emit a quality
   * signal if the rejection rate exceeds the configured threshold and the
   * pipeline is not in cooldown.
   *
   * Returns the created QualitySignal row, or null if no signal was emitted.
   */
  async checkAndEmit(pipelineId: string, tenantId: string): Promise<QualitySignal | null> {
    // Load last N decided review decisions for this pipeline's executions
    // We join via execution -> pipelineId through the tenantId on reviewDecisions
    // and filter by tenantId + the pipelineId on pipelineExecutions via a subquery approach.
    // Since drizzle doesn't support correlated subqueries easily, we query by tenantId
    // and filter by pipelineId in memory after loading executionIds.

    // Load recent decided decisions (approved or rejected) for this tenant's pipeline
    const recentDecisions = await this.db
      .select({
        id: reviewDecisions.id,
        status: reviewDecisions.status,
        decidedAt: reviewDecisions.decidedAt,
        tenantId: reviewDecisions.tenantId,
        executionId: reviewDecisions.executionId,
      })
      .from(reviewDecisions)
      .where(
        and(
          eq(reviewDecisions.tenantId, tenantId),
        ),
      )
      .orderBy(desc(reviewDecisions.createdAt));

    // Filter to decisions belonging to this pipeline's executions
    const execRows = await this.db
      .select({ id: pipelineExecutions.id })
      .from(pipelineExecutions)
      .where(
        and(
          eq(pipelineExecutions.pipelineId, pipelineId),
          eq(pipelineExecutions.tenantId, tenantId),
        ),
      );

    const executionIdSet = new Set(execRows.map((r) => r.id));

    const pipelineDecisions = recentDecisions
      .filter(
        (d) =>
          executionIdSet.has(d.executionId) &&
          (d.status === 'approved' || d.status === 'rejected'),
      )
      .slice(0, this.config.windowSize);

    if (pipelineDecisions.length === 0) {
      return null;
    }

    const rejectedCount = pipelineDecisions.filter((d) => d.status === 'rejected').length;
    const rejectionRate = rejectedCount / pipelineDecisions.length;

    if (rejectionRate <= this.config.threshold) {
      return null;
    }

    // Check cooldown
    const lastEmit = this.lastEmission.get(pipelineId);
    if (lastEmit !== undefined && Date.now() - lastEmit < this.config.cooldownMs) {
      return null;
    }

    // Emit signal
    const signalId = createId();
    const now = new Date();

    const [inserted] = await this.db
      .insert(qualitySignals)
      .values({
        id: signalId,
        pipelineId,
        tenantId,
        signalType: 'high_rejection_rate',
        severity: rejectionRate > 0.6 ? 'critical' : 'warning',
        message: `Rejection rate ${(rejectionRate * 100).toFixed(1)}% exceeds threshold ${(this.config.threshold * 100).toFixed(1)}% (${pipelineDecisions.length} recent decisions)`,
        metadata: {
          rejectionRate,
          rejectedCount,
          totalDecisions: pipelineDecisions.length,
          threshold: this.config.threshold,
        } as unknown as Record<string, unknown>,
        createdAt: now,
      })
      .returning();

    this.lastEmission.set(pipelineId, Date.now());

    return inserted as QualitySignal;
  }

  /**
   * Scan all pipelines that have recent decisions and emit signals as needed.
   * Returns all signals that were emitted.
   */
  async scanAll(): Promise<QualitySignal[]> {
    // Load all distinct (pipelineId, tenantId) combos that have decisions
    const allPipelines = await this.db
      .select({
        id: pipelines.id,
        tenantId: pipelines.tenantId,
      })
      .from(pipelines);

    const emitted: QualitySignal[] = [];

    for (const pipeline of allPipelines) {
      // Check if there are any decided decisions for this pipeline
      const execRows = await this.db
        .select({ id: pipelineExecutions.id })
        .from(pipelineExecutions)
        .where(
          and(
            eq(pipelineExecutions.pipelineId, pipeline.id),
            eq(pipelineExecutions.tenantId, pipeline.tenantId),
          ),
        );

      if (execRows.length === 0) continue;

      const signal = await this.checkAndEmit(pipeline.id, pipeline.tenantId);
      if (signal) {
        emitted.push(signal);
      }
    }

    return emitted;
  }
}
