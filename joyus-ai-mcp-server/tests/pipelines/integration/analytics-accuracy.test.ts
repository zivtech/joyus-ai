/**
 * Integration tests — Analytics Accuracy (T058)
 *
 * Tests analytics computation logic against mock execution/decision data.
 * Verifies exact counts, duration stats, failure breakdowns, and quality
 * signal emission thresholds. No real DB required — all data is in-memory.
 */

import { describe, it, expect, vi } from 'vitest';
import type { PipelineExecution, ReviewDecision, PipelineMetric } from '../../../src/pipelines/schema.js';

// ── Fixtures ──────────────────────────────────────────────────────────────────

function makeExecution(
  id: string,
  pipelineId: string,
  tenantId: string,
  status: PipelineExecution['status'],
  durationMs?: number,
): Partial<PipelineExecution> & { durationMs: number | null } {
  const startedAt = new Date(Date.now() - (durationMs ?? 0));
  const completedAt = durationMs != null ? new Date(startedAt.getTime() + durationMs) : null;
  return {
    id,
    pipelineId,
    tenantId,
    status,
    startedAt,
    completedAt,
    stepsCompleted: status === 'completed' ? 3 : 1,
    stepsTotal: 3,
    durationMs: durationMs ?? null,
  };
}

function makeDecision(
  id: string,
  tenantId: string,
  executionId: string,
  status: 'approved' | 'rejected' | 'pending',
  feedback: { reason: string; category: string } | null = null,
): Partial<ReviewDecision> {
  return {
    id,
    tenantId,
    executionId,
    executionStepId: 'gate-step-1',
    status,
    feedback: feedback as unknown as Record<string, unknown> | null,
    decidedAt: status !== 'pending' ? new Date() : null,
    createdAt: new Date(),
  };
}

// ── Analytics computation helpers ────────────────────────────────────────────
// These replicate the logic that would live in a pipeline analytics service.

interface ExecutionMetrics {
  totalExecutions: number;
  successCount: number;
  failureCount: number;
  meanDurationMs: number | null;
  p95DurationMs: number | null;
  failureBreakdown: Record<string, number>;
}

function computeExecutionMetrics(
  executions: Array<ReturnType<typeof makeExecution>>,
): ExecutionMetrics {
  const total = executions.length;
  const successes = executions.filter((e) => e.status === 'completed');
  const failures = executions.filter(
    (e) => e.status === 'failed' || e.status === 'paused_on_failure',
  );

  const durations = successes
    .map((e) => e.durationMs)
    .filter((d): d is number => d != null)
    .sort((a, b) => a - b);

  const meanDurationMs =
    durations.length > 0
      ? Math.round(durations.reduce((s, v) => s + v, 0) / durations.length)
      : null;

  const p95Index = durations.length > 0
    ? Math.floor(durations.length * 0.95) - 1
    : -1;
  const p95DurationMs = p95Index >= 0 ? (durations[p95Index] ?? null) : null;

  const failureBreakdown: Record<string, number> = {};
  for (const f of failures) {
    const key = f.status ?? 'unknown';
    failureBreakdown[key] = (failureBreakdown[key] ?? 0) + 1;
  }

  return { totalExecutions: total, successCount: successes.length, failureCount: failures.length, meanDurationMs, p95DurationMs, failureBreakdown };
}

interface ReviewMetrics {
  totalDecisions: number;
  approvedCount: number;
  rejectedCount: number;
  approvalRate: number;
  rejectionRate: number;
}

function computeReviewMetrics(
  decisions: Array<ReturnType<typeof makeDecision>>,
): ReviewMetrics {
  const decided = decisions.filter((d) => d.status !== 'pending');
  const approved = decided.filter((d) => d.status === 'approved');
  const rejected = decided.filter((d) => d.status === 'rejected');
  const total = decided.length;

  return {
    totalDecisions: total,
    approvedCount: approved.length,
    rejectedCount: rejected.length,
    approvalRate: total > 0 ? approved.length / total : 0,
    rejectionRate: total > 0 ? rejected.length / total : 0,
  };
}

interface QualitySignal {
  type: string;
  severity: string;
  message: string;
  rejectionRate: number;
}

function checkQualitySignals(
  metrics: ReviewMetrics,
  highRejectionThreshold = 0.3,
): QualitySignal[] {
  const signals: QualitySignal[] = [];
  if (metrics.rejectionRate > highRejectionThreshold) {
    signals.push({
      type: 'high_rejection_rate',
      severity: 'warning',
      message: `Rejection rate ${(metrics.rejectionRate * 100).toFixed(1)}% exceeds threshold ${(highRejectionThreshold * 100).toFixed(1)}%`,
      rejectionRate: metrics.rejectionRate,
    });
  }
  return signals;
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('Analytics Accuracy', () => {
  describe('T058-1: mixed execution outcomes', () => {
    it('computes exact counts for 15 success + 3 retry-success + 2 failed', () => {
      // 15 completed, 2 failed → retry-success modelled as completed
      // 15 completed + 3 retry-success (also completed) + 2 failed = 20 total
      const executions: Array<ReturnType<typeof makeExecution>> = [
        // 12 straight successes
        ...Array.from({ length: 12 }, (_, i) =>
          makeExecution(`exec-s${i}`, 'pipe-1', 'tenant-alpha', 'completed', 1000 + i * 100),
        ),
        // 3 retry-success (retried but ultimately completed — same status)
        ...Array.from({ length: 3 }, (_, i) =>
          makeExecution(`exec-rs${i}`, 'pipe-1', 'tenant-alpha', 'completed', 2000 + i * 100),
        ),
        // 2 failures
        makeExecution('exec-f1', 'pipe-1', 'tenant-alpha', 'failed'),
        makeExecution('exec-f2', 'pipe-1', 'tenant-alpha', 'paused_on_failure'),
        // 3 cancelled (not counted as success or failure in these metrics)
        ...Array.from({ length: 3 }, (_, i) =>
          makeExecution(`exec-c${i}`, 'pipe-1', 'tenant-alpha', 'cancelled'),
        ),
      ];

      const metrics = computeExecutionMetrics(executions);

      expect(metrics.totalExecutions).toBe(20);
      expect(metrics.successCount).toBe(15);
      expect(metrics.failureCount).toBe(2);
    });

    it('computes mean duration from successful executions only', () => {
      const executions: Array<ReturnType<typeof makeExecution>> = [
        makeExecution('e1', 'pipe-1', 'tenant-alpha', 'completed', 1000),
        makeExecution('e2', 'pipe-1', 'tenant-alpha', 'completed', 2000),
        makeExecution('e3', 'pipe-1', 'tenant-alpha', 'completed', 3000),
        makeExecution('e4', 'pipe-1', 'tenant-alpha', 'failed'),
      ];

      const metrics = computeExecutionMetrics(executions);
      expect(metrics.meanDurationMs).toBe(2000);
    });

    it('computes failure breakdown by status type', () => {
      const executions: Array<ReturnType<typeof makeExecution>> = [
        makeExecution('e1', 'pipe-1', 'tenant-alpha', 'completed', 500),
        makeExecution('e2', 'pipe-1', 'tenant-alpha', 'failed'),
        makeExecution('e3', 'pipe-1', 'tenant-alpha', 'failed'),
        makeExecution('e4', 'pipe-1', 'tenant-alpha', 'paused_on_failure'),
      ];

      const metrics = computeExecutionMetrics(executions);
      expect(metrics.failureBreakdown['failed']).toBe(2);
      expect(metrics.failureBreakdown['paused_on_failure']).toBe(1);
    });

    it('returns null duration stats when no completed executions', () => {
      const executions: Array<ReturnType<typeof makeExecution>> = [
        makeExecution('e1', 'pipe-1', 'tenant-alpha', 'failed'),
      ];

      const metrics = computeExecutionMetrics(executions);
      expect(metrics.meanDurationMs).toBeNull();
      expect(metrics.p95DurationMs).toBeNull();
    });

    it('computes p95 duration for 15 successful executions', () => {
      // durations 100..1500 (step 100), sorted → p95 at index floor(15*0.95)-1 = 13
      const executions: Array<ReturnType<typeof makeExecution>> = Array.from(
        { length: 15 },
        (_, i) => makeExecution(`e${i}`, 'pipe-1', 'tenant-alpha', 'completed', (i + 1) * 100),
      );

      const metrics = computeExecutionMetrics(executions);
      // sorted: [100,200,...,1500], p95Index = floor(15*0.95)-1 = 13, value = 1400
      expect(metrics.p95DurationMs).toBe(1400);
    });
  });

  describe('T058-2: review analytics', () => {
    it('computes approval/rejection rates for 7 approved + 3 rejected', () => {
      const decisions = [
        ...Array.from({ length: 7 }, (_, i) =>
          makeDecision(`d-a${i}`, 'tenant-alpha', 'exec-1', 'approved'),
        ),
        ...Array.from({ length: 3 }, (_, i) =>
          makeDecision(`d-r${i}`, 'tenant-alpha', 'exec-1', 'rejected', {
            reason: 'Off-brand',
            category: 'tone',
          }),
        ),
      ];

      const metrics = computeReviewMetrics(decisions);

      expect(metrics.totalDecisions).toBe(10);
      expect(metrics.approvedCount).toBe(7);
      expect(metrics.rejectedCount).toBe(3);
      expect(metrics.approvalRate).toBeCloseTo(0.7, 5);
      expect(metrics.rejectionRate).toBeCloseTo(0.3, 5);
    });

    it('excludes pending decisions from rate computation', () => {
      const decisions = [
        makeDecision('d1', 'tenant-alpha', 'exec-1', 'approved'),
        makeDecision('d2', 'tenant-alpha', 'exec-1', 'pending'),
      ];

      const metrics = computeReviewMetrics(decisions);
      expect(metrics.totalDecisions).toBe(1);
      expect(metrics.approvalRate).toBe(1.0);
    });

    it('returns zero rates when all decisions are pending', () => {
      const decisions = [
        makeDecision('d1', 'tenant-alpha', 'exec-1', 'pending'),
        makeDecision('d2', 'tenant-alpha', 'exec-1', 'pending'),
      ];

      const metrics = computeReviewMetrics(decisions);
      expect(metrics.totalDecisions).toBe(0);
      expect(metrics.approvalRate).toBe(0);
      expect(metrics.rejectionRate).toBe(0);
    });
  });

  describe('T058-3: quality signal — high rejection rate', () => {
    it('emits warning signal when rejection rate exceeds 30% threshold', () => {
      // 4 rejected out of 10 = 40% > 30% threshold
      const decisions = [
        ...Array.from({ length: 6 }, (_, i) =>
          makeDecision(`da${i}`, 'tenant-alpha', 'exec-1', 'approved'),
        ),
        ...Array.from({ length: 4 }, (_, i) =>
          makeDecision(`dr${i}`, 'tenant-alpha', 'exec-1', 'rejected', {
            reason: 'Off-brand',
            category: 'tone',
          }),
        ),
      ];

      const metrics = computeReviewMetrics(decisions);
      expect(metrics.rejectionRate).toBeCloseTo(0.4, 5);

      const signals = checkQualitySignals(metrics, 0.3);
      expect(signals).toHaveLength(1);
      expect(signals[0]!.type).toBe('high_rejection_rate');
      expect(signals[0]!.severity).toBe('warning');
      expect(signals[0]!.rejectionRate).toBeCloseTo(0.4, 5);
    });

    it('does not emit signal when rejection rate is at or below threshold', () => {
      const decisions = [
        ...Array.from({ length: 7 }, (_, i) =>
          makeDecision(`da${i}`, 'tenant-alpha', 'exec-1', 'approved'),
        ),
        ...Array.from({ length: 3 }, (_, i) =>
          makeDecision(`dr${i}`, 'tenant-alpha', 'exec-1', 'rejected'),
        ),
      ];

      const metrics = computeReviewMetrics(decisions);
      // rejectionRate = 0.3, which is exactly at threshold (not exceeding)
      const signals = checkQualitySignals(metrics, 0.3);
      expect(signals).toHaveLength(0);
    });

    it('emits signal with correct message format', () => {
      const metrics: ReviewMetrics = {
        totalDecisions: 10,
        approvedCount: 6,
        rejectedCount: 4,
        approvalRate: 0.6,
        rejectionRate: 0.4,
      };

      const signals = checkQualitySignals(metrics, 0.3);
      expect(signals[0]!.message).toContain('40.0%');
      expect(signals[0]!.message).toContain('30.0%');
    });
  });

  describe('T058-4: empty data edge cases', () => {
    it('handles zero executions gracefully', () => {
      const metrics = computeExecutionMetrics([]);
      expect(metrics.totalExecutions).toBe(0);
      expect(metrics.successCount).toBe(0);
      expect(metrics.failureCount).toBe(0);
      expect(metrics.meanDurationMs).toBeNull();
    });

    it('handles zero decisions gracefully', () => {
      const metrics = computeReviewMetrics([]);
      expect(metrics.totalDecisions).toBe(0);
      expect(metrics.approvalRate).toBe(0);
    });
  });
});
