/**
 * MetricsAggregator — computes execution metrics for pipelines over a time window.
 *
 * Queries pipeline_executions (and related review_decisions) to produce
 * PipelineMetricsData, then upserts into pipeline_metrics.
 */

import { createId } from '@paralleldrive/cuid2';
import { eq, and, gte, lte, inArray } from 'drizzle-orm';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import {
  pipelineExecutions,
  reviewDecisions,
  pipelineMetrics,
  pipelines,
} from '../schema.js';

// ============================================================
// OUTPUT TYPE
// ============================================================

export interface PipelineMetricsData {
  pipelineId: string;
  tenantId: string;
  windowStart: Date;
  windowEnd: Date;
  totalExecutions: number;
  successCount: number;
  failureCount: number;
  cancelledCount: number;
  meanDurationMs: number | null;
  p95DurationMs: number | null;
  failureBreakdown: Record<string, number>;
  reviewApprovalRate: number | null;
  reviewRejectionRate: number | null;
  meanTimeToReviewMs: number | null;
}

// ============================================================
// METRICS AGGREGATOR
// ============================================================

export class MetricsAggregator {
  constructor(private readonly db: NodePgDatabase) {}

  /**
   * Compute metrics for a single pipeline over [windowStart, windowEnd].
   */
  async computeMetrics(
    pipelineId: string,
    tenantId: string,
    windowStart: Date,
    windowEnd: Date,
  ): Promise<PipelineMetricsData> {
    // Load executions in window
    const executions = await this.db
      .select()
      .from(pipelineExecutions)
      .where(
        and(
          eq(pipelineExecutions.pipelineId, pipelineId),
          eq(pipelineExecutions.tenantId, tenantId),
          gte(pipelineExecutions.startedAt, windowStart),
          lte(pipelineExecutions.startedAt, windowEnd),
        ),
      );

    const totalExecutions = executions.length;

    if (totalExecutions === 0) {
      return {
        pipelineId,
        tenantId,
        windowStart,
        windowEnd,
        totalExecutions: 0,
        successCount: 0,
        failureCount: 0,
        cancelledCount: 0,
        meanDurationMs: null,
        p95DurationMs: null,
        failureBreakdown: {},
        reviewApprovalRate: null,
        reviewRejectionRate: null,
        meanTimeToReviewMs: null,
      };
    }

    // Count by status
    let successCount = 0;
    let failureCount = 0;
    let cancelledCount = 0;
    const failureBreakdown: Record<string, number> = {};
    const completedDurationsMs: number[] = [];

    for (const exec of executions) {
      if (exec.status === 'completed') {
        successCount++;
        if (exec.completedAt) {
          const durationMs = exec.completedAt.getTime() - exec.startedAt.getTime();
          completedDurationsMs.push(durationMs);
        }
      } else if (exec.status === 'failed' || exec.status === 'paused_on_failure') {
        failureCount++;
        // Group by error type if available
        const errorDetail = exec.errorDetail as Record<string, unknown> | null;
        const errorType = errorDetail && typeof errorDetail['type'] === 'string'
          ? errorDetail['type']
          : 'unknown';
        failureBreakdown[errorType] = (failureBreakdown[errorType] ?? 0) + 1;
      } else if (exec.status === 'cancelled') {
        cancelledCount++;
      }
    }

    // Compute duration stats (completed executions only)
    let meanDurationMs: number | null = null;
    let p95DurationMs: number | null = null;

    if (completedDurationsMs.length > 0) {
      const sum = completedDurationsMs.reduce((a, b) => a + b, 0);
      meanDurationMs = Math.round(sum / completedDurationsMs.length);

      const sorted = [...completedDurationsMs].sort((a, b) => a - b);
      const n = sorted.length;
      const p95Index = Math.ceil(0.95 * n) - 1;
      p95DurationMs = sorted[p95Index] ?? sorted[n - 1] ?? null;
    }

    // Load review decisions for these executions
    const executionIds = executions.map((e) => e.id);
    const decisions = executionIds.length > 0
      ? await this.db
          .select()
          .from(reviewDecisions)
          .where(inArray(reviewDecisions.executionId, executionIds))
      : [];

    const decidedDecisions = decisions.filter(
      (d) => d.status === 'approved' || d.status === 'rejected',
    );

    let reviewApprovalRate: number | null = null;
    let reviewRejectionRate: number | null = null;
    let meanTimeToReviewMs: number | null = null;

    if (decidedDecisions.length > 0) {
      const approvedCount = decidedDecisions.filter((d) => d.status === 'approved').length;
      const rejectedCount = decidedDecisions.filter((d) => d.status === 'rejected').length;
      const total = decidedDecisions.length;

      reviewApprovalRate = approvedCount / total;
      reviewRejectionRate = rejectedCount / total;

      // Mean time to review: decidedAt - createdAt for all decided decisions
      const reviewTimes = decidedDecisions
        .filter((d) => d.decidedAt !== null)
        .map((d) => d.decidedAt!.getTime() - d.createdAt.getTime())
        .filter((ms) => ms >= 0);

      if (reviewTimes.length > 0) {
        const reviewSum = reviewTimes.reduce((a, b) => a + b, 0);
        meanTimeToReviewMs = Math.round(reviewSum / reviewTimes.length);
      }
    }

    return {
      pipelineId,
      tenantId,
      windowStart,
      windowEnd,
      totalExecutions,
      successCount,
      failureCount,
      cancelledCount,
      meanDurationMs,
      p95DurationMs,
      failureBreakdown,
      reviewApprovalRate,
      reviewRejectionRate,
      meanTimeToReviewMs,
    };
  }

  /**
   * Compute metrics for all pipelines belonging to a tenant over the window.
   */
  async computeTenantMetrics(
    tenantId: string,
    windowStart: Date,
    windowEnd: Date,
  ): Promise<PipelineMetricsData[]> {
    const tenantPipelines = await this.db
      .select()
      .from(pipelines)
      .where(eq(pipelines.tenantId, tenantId));

    const results: PipelineMetricsData[] = [];
    for (const pipeline of tenantPipelines) {
      const metrics = await this.computeMetrics(
        pipeline.id,
        tenantId,
        windowStart,
        windowEnd,
      );
      results.push(metrics);
    }
    return results;
  }

  /**
   * Compute metrics over a 90-day window and upsert into pipeline_metrics table.
   * Uses pipelineId + windowEnd as the logical key for upsert (update if exists,
   * insert if not).
   */
  async refreshMetrics(pipelineId: string, tenantId: string): Promise<PipelineMetricsData> {
    const windowEnd = new Date();
    const windowStart = new Date(windowEnd.getTime() - 90 * 24 * 60 * 60 * 1000);

    const data = await this.computeMetrics(pipelineId, tenantId, windowStart, windowEnd);

    // Check for existing row with same pipelineId + windowStart
    const existing = await this.db
      .select()
      .from(pipelineMetrics)
      .where(
        and(
          eq(pipelineMetrics.pipelineId, pipelineId),
          eq(pipelineMetrics.windowStart, windowStart),
        ),
      );

    if (existing.length > 0) {
      await this.db
        .update(pipelineMetrics)
        .set({
          totalExecutions: data.totalExecutions,
          successCount: data.successCount,
          failureCount: data.failureCount,
          cancelledCount: data.cancelledCount,
          meanDurationMs: data.meanDurationMs,
          p95DurationMs: data.p95DurationMs,
          failureBreakdown: data.failureBreakdown as unknown as Record<string, unknown>,
          reviewApprovalRate: data.reviewApprovalRate,
          reviewRejectionRate: data.reviewRejectionRate,
          meanTimeToReviewMs: data.meanTimeToReviewMs,
          refreshedAt: new Date(),
        })
        .where(eq(pipelineMetrics.id, existing[0].id));
    } else {
      await this.db.insert(pipelineMetrics).values({
        id: createId(),
        pipelineId: data.pipelineId,
        tenantId: data.tenantId,
        windowStart: data.windowStart,
        windowEnd: data.windowEnd,
        totalExecutions: data.totalExecutions,
        successCount: data.successCount,
        failureCount: data.failureCount,
        cancelledCount: data.cancelledCount,
        meanDurationMs: data.meanDurationMs,
        p95DurationMs: data.p95DurationMs,
        failureBreakdown: data.failureBreakdown as unknown as Record<string, unknown>,
        reviewApprovalRate: data.reviewApprovalRate,
        reviewRejectionRate: data.reviewRejectionRate,
        meanTimeToReviewMs: data.meanTimeToReviewMs,
        refreshedAt: new Date(),
      });
    }

    return data;
  }
}
