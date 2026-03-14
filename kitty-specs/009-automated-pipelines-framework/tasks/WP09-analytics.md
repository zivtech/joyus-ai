---
work_package_id: "WP09"
title: "Analytics & Quality Signals"
lane: "planned"
dependencies: ["WP08"]
subtasks: ["T049", "T050", "T051", "T052", "T053", "T054"]
history:
  - date: "2026-03-14"
    action: "created"
    agent: "claude-opus"
---

# WP09: Analytics & Quality Signals

**Implementation command**: `spec-kitty implement WP09 --base WP08`
**Target repo**: `joyus-ai`
**Dependencies**: WP08 (Pipeline API & MCP Tools)
**Priority**: P3 (Additive — does not block any other WP)

## Objective

Build the metrics aggregation system (`MetricsAggregator`), materialized metrics refresh on execution completion, quality signal emission with configurable rejection-rate thresholds, analytics Express routes, and the `pipeline_analytics` MCP tool.

## Context

Analytics serve two purposes:
1. **Operational visibility**: tenants can see how their pipelines are performing (success rate, p95 duration, average steps completed).
2. **Governance signaling**: if a pipeline's review rejection rate exceeds 30% over the last 10 executions, the system emits a `quality_signal` row indicating potential issues with the pipeline configuration or the content it is processing.

The `pipeline_metrics` table (WP01) stores pre-computed aggregate metrics per pipeline. These are refreshed asynchronously after each execution completes — not computed on the fly for every API request. The `MetricsAggregator` computes the aggregates and writes them. The `QualitySignalEmitter` reads the aggregates and emits signals when thresholds are breached.

**p95 computation**: Fetch the last N `completed` execution durations for the pipeline, sort ascending, and take the value at index `floor(N * 0.95)`. N should be at least 20 for meaningful p95. If fewer than 20 executions exist, report `null` for p95.

---

## Subtasks

### T049: Implement MetricsAggregator (`src/pipelines/analytics/aggregator.ts`)

**Purpose**: Compute per-pipeline aggregate metrics from the `pipeline_executions` table and upsert the results into `pipeline_metrics`.

**Steps**:
1. Create `src/pipelines/analytics/aggregator.ts`
2. Define `MetricsAggregator` class with `refreshMetrics(pipelineId, tenantId)` method
3. Compute: `totalExecutions`, `successfulExecutions`, `failedExecutions`, `avgDurationMs`, `p95DurationMs`, `reviewRejectionRate` (basis points)
4. Upsert into `pipeline_metrics` using `onConflictDoUpdate`

```typescript
// src/pipelines/analytics/aggregator.ts
import { eq, and, sql, count, avg } from 'drizzle-orm';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { pipelineExecutions, pipelineMetrics, reviewDecisions } from '../schema';

export class MetricsAggregator {
  constructor(private readonly db: NodePgDatabase<Record<string, unknown>>) {}

  /**
   * Recomputes and upserts aggregate metrics for a single pipeline.
   * Called after each execution completes.
   */
  async refreshMetrics(pipelineId: string, tenantId: string): Promise<void> {
    // Fetch all completed/failed executions for this pipeline
    const executions = await this.db
      .select({
        status: pipelineExecutions.status,
        startedAt: pipelineExecutions.startedAt,
        completedAt: pipelineExecutions.completedAt,
      })
      .from(pipelineExecutions)
      .where(
        and(
          eq(pipelineExecutions.pipelineId, pipelineId),
          eq(pipelineExecutions.tenantId, tenantId),
          sql`status IN ('completed', 'failed', 'cancelled')`,
        ),
      );

    if (executions.length === 0) return;

    const total = executions.length;
    const successful = executions.filter((e) => e.status === 'completed').length;
    const failed = executions.filter((e) => e.status !== 'completed').length;

    // Compute durations for completed executions
    const durations = executions
      .filter((e) => e.status === 'completed' && e.startedAt && e.completedAt)
      .map((e) => e.completedAt!.getTime() - e.startedAt!.getTime())
      .sort((a, b) => a - b);

    const avgDurationMs = durations.length > 0
      ? Math.round(durations.reduce((sum, d) => sum + d, 0) / durations.length)
      : null;

    const p95DurationMs = durations.length >= 20
      ? durations[Math.floor(durations.length * 0.95)]
      : null;

    // Rejection rate from review decisions
    const reviewRejectionRateBp = await this.computeRejectionRate(pipelineId, tenantId);

    await this.db
      .insert(pipelineMetrics)
      .values({
        pipelineId,
        tenantId,
        totalExecutions: total,
        successfulExecutions: successful,
        failedExecutions: failed,
        avgDurationMs,
        p95DurationMs,
        reviewRejectionRate: reviewRejectionRateBp,
        lastRefreshedAt: new Date(),
      })
      .onConflictDoUpdate({
        target: pipelineMetrics.pipelineId,
        set: {
          totalExecutions: total,
          successfulExecutions: successful,
          failedExecutions: failed,
          avgDurationMs,
          p95DurationMs,
          reviewRejectionRate: reviewRejectionRateBp,
          lastRefreshedAt: new Date(),
        },
      });
  }

  private async computeRejectionRate(pipelineId: string, tenantId: string): Promise<number | null> {
    // Look at the last 10 decided review decisions for this pipeline
    const decisions = await this.db
      .select({ decision: reviewDecisions.decision })
      .from(reviewDecisions)
      .where(
        and(
          eq(reviewDecisions.tenantId, tenantId),
          sql`pipeline_id = ${pipelineId}`,  // join through execution
          sql`decided_at IS NOT NULL`,
        ),
      )
      .limit(10);

    if (decisions.length === 0) return null;

    const rejected = decisions.filter((d) => d.decision === 'rejected').length;
    return Math.round((rejected / decisions.length) * 10_000);  // basis points
  }
}
```

**Files**:
- `src/pipelines/analytics/aggregator.ts` (new, ~80 lines)

**Validation**:
- [ ] `avgDurationMs` is `null` when no completed executions exist
- [ ] `p95DurationMs` is `null` when fewer than 20 completed executions exist
- [ ] `p95DurationMs` correctly computes the 95th percentile from a sorted duration array
- [ ] Rejection rate is stored as basis points (30% = 3000)
- [ ] `tsc --noEmit` passes

**Edge Cases**:
- `computeRejectionRate` needs to join `reviewDecisions` to `pipelineExecutions` to filter by `pipelineId`. The current implementation uses a raw SQL fragment — verify the join logic is correct or use Drizzle's relational query API.
- Sorting durations in JavaScript is fine for < 10,000 executions. For very long-running pipelines, consider computing p95 in SQL using `percentile_disc(0.95) WITHIN GROUP (ORDER BY duration)` instead.

---

### T050: Implement materialized metrics refresh on execution completion events

**Purpose**: Trigger `MetricsAggregator.refreshMetrics` automatically after every pipeline execution completes (success or failure), so metrics stay current without a separate cron job.

**Steps**:
1. Modify `src/pipelines/engine/executor.ts` (WP04) to call `aggregator.refreshMetrics` at the end of `runExecution`
2. `MetricsAggregator` is injected into `PipelineExecutor` at construction time (or via a completion callback)
3. Refresh is fire-and-forget — do not await in the main execution path (metrics are non-critical)

```typescript
// Modification to PipelineExecutor.runExecution() in executor.ts:
// After setting status to 'completed' or 'failed':

    // Refresh metrics asynchronously (non-blocking)
    void this.aggregator?.refreshMetrics(execution.pipelineId, execution.tenantId).catch((err) => {
      console.error('[Executor] Metrics refresh failed:', err);
    });
```

Update `PipelineExecutor` constructor to accept optional `MetricsAggregator`:

```typescript
constructor(
  private readonly db: NodePgDatabase<Record<string, unknown>>,
  private readonly eventBus: EventBus,
  private readonly triggerRegistry: TriggerRegistry,
  private readonly stepHandlerRegistry: StepHandlerRegistry,
  private readonly options: ExecutorOptions = {},
  private readonly aggregator?: MetricsAggregator,
) { ... }
```

**Files**:
- `src/pipelines/engine/executor.ts` (modified — add optional `MetricsAggregator` parameter)
- `src/pipelines/analytics/aggregator.ts` (no change)

**Validation**:
- [ ] `PipelineExecutor` constructor accepts optional `aggregator` (no breaking change for callers that don't pass it)
- [ ] `refreshMetrics` is called with `void` — errors are caught and logged, not propagated
- [ ] `tsc --noEmit` passes on modified `executor.ts`

**Edge Cases**:
- If `executor.ts` is modified and WP04 unit tests break, fix the test mocks to account for the optional constructor parameter. Tests that create `PipelineExecutor` without an aggregator should continue to work.

---

### T051: Implement QualitySignalEmitter (`src/pipelines/analytics/quality-signals.ts`)

**Purpose**: Monitor rejection rates and emit `quality_signal` rows when thresholds are breached. Signals are informational — they do not block execution.

**Steps**:
1. Create `src/pipelines/analytics/quality-signals.ts`
2. Define `QualitySignalEmitter` with `checkAndEmit(pipelineId, tenantId)` method
3. Read current `pipeline_metrics.reviewRejectionRate` for the pipeline
4. If rate > `QUALITY_SIGNAL_REJECTION_THRESHOLD_BP` (3000 = 30%), insert a `quality_signals` row
5. Deduplication: only emit one unacknowledged signal per pipeline per signal type

```typescript
// src/pipelines/analytics/quality-signals.ts
import { eq, and, isNull } from 'drizzle-orm';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { pipelineMetrics, qualitySignals } from '../schema';
import {
  QUALITY_SIGNAL_REJECTION_THRESHOLD_BP,
  QUALITY_SIGNAL_MIN_EXECUTIONS,
} from '../types';

const SIGNAL_TYPE_HIGH_REJECTION = 'high_rejection_rate';

export class QualitySignalEmitter {
  constructor(private readonly db: NodePgDatabase<Record<string, unknown>>) {}

  /**
   * Checks the current metrics for a pipeline and emits a quality signal
   * if the rejection rate exceeds the threshold.
   * Deduplicates: will not emit if an unacknowledged signal already exists.
   */
  async checkAndEmit(pipelineId: string, tenantId: string): Promise<void> {
    const metricsRows = await this.db
      .select()
      .from(pipelineMetrics)
      .where(eq(pipelineMetrics.pipelineId, pipelineId))
      .limit(1);

    if (metricsRows.length === 0) return;
    const metrics = metricsRows[0];

    // Only check if we have enough executions for meaningful signal
    if (metrics.totalExecutions < QUALITY_SIGNAL_MIN_EXECUTIONS) return;
    if (metrics.reviewRejectionRate === null) return;
    if (metrics.reviewRejectionRate <= QUALITY_SIGNAL_REJECTION_THRESHOLD_BP) return;

    // Check for existing unacknowledged signal
    const existing = await this.db
      .select({ id: qualitySignals.id })
      .from(qualitySignals)
      .where(
        and(
          eq(qualitySignals.pipelineId, pipelineId),
          eq(qualitySignals.signalType, SIGNAL_TYPE_HIGH_REJECTION),
          isNull(qualitySignals.acknowledgedAt),
        ),
      )
      .limit(1);

    if (existing.length > 0) return;  // Already have an active signal

    const rejectionPct = (metrics.reviewRejectionRate / 100).toFixed(1);

    await this.db.insert(qualitySignals).values({
      pipelineId,
      tenantId,
      signalType: SIGNAL_TYPE_HIGH_REJECTION,
      severity: 'warning',
      message: `Pipeline rejection rate is ${rejectionPct}% over the last ${QUALITY_SIGNAL_MIN_EXECUTIONS} executions (threshold: ${QUALITY_SIGNAL_REJECTION_THRESHOLD_BP / 100}%). Review pipeline configuration or step outputs.`,
      metadata: {
        rejectionRateBp: metrics.reviewRejectionRate,
        totalExecutions: metrics.totalExecutions,
        threshold: QUALITY_SIGNAL_REJECTION_THRESHOLD_BP,
      },
    });

    console.warn(`[QualitySignal] High rejection rate signal emitted for pipeline ${pipelineId}`);
  }

  async acknowledgeSignal(signalId: string, tenantId: string): Promise<void> {
    await this.db
      .update(qualitySignals)
      .set({ acknowledgedAt: new Date() })
      .where(
        and(
          eq(qualitySignals.id, signalId),
          eq(qualitySignals.tenantId, tenantId),
        ),
      );
  }

  async listUnacknowledged(tenantId: string) {
    return this.db
      .select()
      .from(qualitySignals)
      .where(
        and(
          eq(qualitySignals.tenantId, tenantId),
          isNull(qualitySignals.acknowledgedAt),
        ),
      );
  }
}
```

**Files**:
- `src/pipelines/analytics/quality-signals.ts` (new, ~75 lines)

**Validation**:
- [ ] No signal emitted when `totalExecutions < QUALITY_SIGNAL_MIN_EXECUTIONS` (10)
- [ ] No signal emitted when rejection rate ≤ 3000 bp (30%)
- [ ] Signal emitted when rejection rate > 3000 bp and no unacknowledged signal exists
- [ ] Duplicate signal suppressed when unacknowledged signal already exists
- [ ] `acknowledgeSignal` correctly scopes to tenant
- [ ] `tsc --noEmit` passes

**Edge Cases**:
- `QUALITY_SIGNAL_REJECTION_THRESHOLD_BP` is imported from `types.ts` — the threshold is configurable per the spec. If per-pipeline configuration is needed in the future, add a `rejectionThresholdBp` column to the `pipelines` table.

---

### T052: Add analytics Express routes and MCP tool (`pipeline_analytics`)

**Purpose**: Expose pipeline metrics and quality signals through REST API and update the `pipeline_analytics` MCP tool stub from WP08 to use the real `MetricsAggregator`.

**Steps**:
1. Add analytics routes to `src/pipelines/routes.ts` (or create `src/pipelines/analytics-routes.ts`)
2. GET `/pipelines/:id/metrics` — returns current `pipeline_metrics` row for the pipeline
3. GET `/pipelines/:id/quality-signals` — returns unacknowledged `quality_signals` for the pipeline
4. POST `/quality-signals/:signalId/acknowledge` — acknowledge a signal
5. Update `pipeline_analytics` MCP tool in `src/tools/pipeline-tools.ts` to return rich metrics

```typescript
// Addition to routes.ts or new analytics-routes.ts:

  // GET /pipelines/:id/metrics
  router.get('/:id/metrics', async (req, res) => {
    const rows = await db
      .select()
      .from(pipelineMetrics)
      .where(
        and(
          eq(pipelineMetrics.pipelineId, req.params.id),
          eq(pipelineMetrics.tenantId, req.tenantId),
        ),
      )
      .limit(1);

    if (rows.length === 0) {
      return res.json({
        pipelineId: req.params.id,
        totalExecutions: 0,
        message: 'No metrics available yet',
      });
    }

    const m = rows[0];
    return res.json({
      pipelineId: m.pipelineId,
      totalExecutions: m.totalExecutions,
      successfulExecutions: m.successfulExecutions,
      failedExecutions: m.failedExecutions,
      successRate: m.totalExecutions > 0
        ? ((m.successfulExecutions / m.totalExecutions) * 100).toFixed(1) + '%'
        : null,
      avgDurationMs: m.avgDurationMs,
      p95DurationMs: m.p95DurationMs,
      reviewRejectionRatePct: m.reviewRejectionRate !== null
        ? (m.reviewRejectionRate / 100).toFixed(1) + '%'
        : null,
      lastRefreshedAt: m.lastRefreshedAt,
    });
  });

  // GET /pipelines/:id/quality-signals
  router.get('/:id/quality-signals', async (req, res) => {
    const signals = await qualitySignalEmitter.listUnacknowledged(req.tenantId);
    const filtered = signals.filter((s) => s.pipelineId === req.params.id);
    return res.json(filtered);
  });

  // POST /quality-signals/:signalId/acknowledge
  router.post('/quality-signals/:signalId/acknowledge', async (req, res) => {
    await qualitySignalEmitter.acknowledgeSignal(req.params.signalId, req.tenantId);
    return res.json({ acknowledged: true });
  });
```

**Files**:
- `src/pipelines/routes.ts` (modified — add analytics routes)

**Validation**:
- [ ] GET `/pipelines/:id/metrics` returns formatted metrics object (not raw DB row)
- [ ] GET `/pipelines/:id/metrics` returns `{ totalExecutions: 0 }` for pipelines with no history
- [ ] POST `/quality-signals/:signalId/acknowledge` scopes to tenant (wrong tenant → no-op, not error)
- [ ] `tsc --noEmit` passes

---

### T053: Create analytics barrel export (`src/pipelines/analytics/index.ts`)

**Purpose**: Single import point for the analytics module.

```typescript
// src/pipelines/analytics/index.ts
export { MetricsAggregator } from './aggregator';
export { QualitySignalEmitter } from './quality-signals';
```

**Files**:
- `src/pipelines/analytics/index.ts` (new, ~5 lines)

**Validation**:
- [ ] `import { MetricsAggregator, QualitySignalEmitter } from '../analytics'` resolves
- [ ] `tsc --noEmit` passes

---

### T054: Unit tests for aggregator and quality signals (`tests/pipelines/analytics/`)

**Purpose**: Verify p95 computation, rejection rate calculation, signal deduplication, and threshold enforcement without a real database.

**Steps**:
1. Create `tests/pipelines/analytics/aggregator.test.ts` — pure logic tests (p95, avg, basis points)
2. Create `tests/pipelines/analytics/quality-signals.test.ts` — threshold and dedup logic

```typescript
// tests/pipelines/analytics/aggregator.test.ts
import { describe, it, expect } from 'vitest';

// Test the p95 computation as a pure function (extracted for testability)
function computeP95(durations: number[]): number | null {
  if (durations.length < 20) return null;
  const sorted = [...durations].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length * 0.95)];
}

describe('p95 computation', () => {
  it('returns null when fewer than 20 data points', () => {
    expect(computeP95([100, 200, 300])).toBeNull();
  });

  it('returns null for exactly 19 data points', () => {
    expect(computeP95(Array.from({ length: 19 }, (_, i) => i * 100))).toBeNull();
  });

  it('computes correctly for 20 data points', () => {
    const durations = Array.from({ length: 20 }, (_, i) => (i + 1) * 100);
    // Sorted: 100, 200, ..., 2000. index floor(20 * 0.95) = floor(19) = 19 → 2000
    expect(computeP95(durations)).toBe(2000);
  });

  it('is not affected by input order', () => {
    const sorted = Array.from({ length: 20 }, (_, i) => (i + 1) * 100);
    const shuffled = [...sorted].reverse();
    expect(computeP95(sorted)).toBe(computeP95(shuffled));
  });
});

describe('rejection rate basis points', () => {
  it('30% rejection = 3000 basis points', () => {
    const rejected = 3;
    const total = 10;
    const basisPoints = Math.round((rejected / total) * 10_000);
    expect(basisPoints).toBe(3000);
  });

  it('0% rejection = 0 basis points', () => {
    expect(Math.round((0 / 10) * 10_000)).toBe(0);
  });
});
```

```typescript
// tests/pipelines/analytics/quality-signals.test.ts
import { describe, it, expect } from 'vitest';
import {
  QUALITY_SIGNAL_REJECTION_THRESHOLD_BP,
  QUALITY_SIGNAL_MIN_EXECUTIONS,
} from '../../../src/pipelines/types';

describe('quality signal constants', () => {
  it('threshold is 30% (3000 basis points)', () => {
    expect(QUALITY_SIGNAL_REJECTION_THRESHOLD_BP).toBe(3000);
  });

  it('minimum executions is 10', () => {
    expect(QUALITY_SIGNAL_MIN_EXECUTIONS).toBe(10);
  });
});
```

**Files**:
- `tests/pipelines/analytics/aggregator.test.ts` (new, ~45 lines)
- `tests/pipelines/analytics/quality-signals.test.ts` (new, ~20 lines)

**Validation**:
- [ ] `npm test tests/pipelines/analytics/` exits 0
- [ ] p95 tests: null for < 20 points, correct index for exactly 20 points
- [ ] Basis points conversion: 30% = 3000, 0% = 0
- [ ] Constant values verified

**Edge Cases**:
- The p95 function in the test is a pure reimplementation for testability. The actual `MetricsAggregator` uses inline code. If the logic diverges, the tests won't catch it. Consider extracting `computeP95` as a named export from `aggregator.ts` for direct testing.

---

## Definition of Done

- [ ] `src/pipelines/analytics/aggregator.ts` — `MetricsAggregator` with `refreshMetrics`
- [ ] `src/pipelines/engine/executor.ts` — modified to call `aggregator.refreshMetrics` on completion
- [ ] `src/pipelines/analytics/quality-signals.ts` — `QualitySignalEmitter` with emit, dedup, acknowledge
- [ ] `src/pipelines/routes.ts` — analytics routes: metrics, quality signals, acknowledge
- [ ] `src/pipelines/analytics/index.ts` — barrel export
- [ ] Tests passing: p95 computation (null for <20, correct index), basis points conversion, constant values
- [ ] `npm run typecheck` exits 0
- [ ] `npm test` exits 0 with no regressions

## Risks

- **Metrics staleness**: Metrics are computed after each execution but are not real-time. If 100 executions complete simultaneously, only the last refresh persists. For high-throughput pipelines, debounce the refresh (e.g., at most once per 30s per pipeline) or use a dedicated background aggregation job.
- **Rejection rate join**: `computeRejectionRate` in `MetricsAggregator` joins `reviewDecisions` to `pipelineExecutions` via `pipelineId`. The current implementation uses a raw SQL fragment — verify the join produces the correct tenant-scoped results, especially when two tenants have executions with the same pipeline structure.
- **p95 in application code**: Sorting all execution durations in JavaScript works for pipelines with < 10,000 executions. For very active pipelines, computing p95 in PostgreSQL using `percentile_disc` is more efficient. Track this as a future optimization.

## Reviewer Guidance

- Verify `refreshMetrics` uses `onConflictDoUpdate` on `pipeline_metrics.pipelineId` — if the upsert target is wrong, every refresh will insert a new row instead of updating.
- Check that `QualitySignalEmitter.checkAndEmit` is called from `executor.ts` after `refreshMetrics`, not before — the signal check reads `pipeline_metrics`, which must be current.
- Confirm the analytics routes add the `tenantId` filter to `pipelineMetrics` queries — the table has a `tenant_id` column for exactly this purpose.
