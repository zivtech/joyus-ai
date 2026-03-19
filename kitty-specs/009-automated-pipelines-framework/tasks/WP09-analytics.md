---
work_package_id: WP09
title: Analytics & Quality Signals
lane: "done"
dependencies: []
base_branch: main
base_commit: 1b04d3d8f7128e468b3c4dc7139f02bd4fe299e3
created_at: '2026-03-16T19:15:58.800075+00:00'
subtasks: [T049, T050, T051, T052, T053, T054]
phase: Phase F - Analytics
assignee: "Claude"
agent: ''
shell_pid: "81465"
review_status: "approved"
reviewed_by: "Alex Urevick-Ackelsberg"
history:
- timestamp: '2026-03-10T00:00:00Z'
  lane: planned
  agent: system
  action: Prompt generated via /spec-kitty.tasks
---

# WP09: Analytics & Quality Signals

## Objective

Build execution metrics aggregation, materialized metrics refresh, quality signal emission (rejection rate monitoring), analytics API routes, and an analytics MCP tool. This delivers FR-013 (execution metrics) and the feedback loop required by Constitution §2.5.

## Implementation Command

```bash
spec-kitty implement WP09 --base WP08
```

## Context

- **Spec**: `kitty-specs/009-automated-pipelines-framework/spec.md` (FR-013: metrics, User Story 6)
- **Plan**: `kitty-specs/009-automated-pipelines-framework/plan.md` (WP-19, WP-20, WP-21: Analytics)
- **Data Model**: `kitty-specs/009-automated-pipelines-framework/data-model.md` (PipelineMetrics table)

Pipeline analytics transform raw execution history into actionable insights. The MetricsAggregator computes per-pipeline statistics. The QualitySignalEmitter monitors rejection patterns and alerts the governance layer (Spec 007) when quality degrades.

**Target metrics** (per data-model.md PipelineMetrics table):
- totalExecutions, successCount, failureCount, cancelledCount
- meanDurationMs, p95DurationMs
- failureBreakdown (by step and error type)
- reviewApprovalRate, reviewRejectionRate
- meanTimeToReviewMs

**Quality signal threshold**: >30% rejection rate over 10 executions emits a signal to governance.

---

## Subtask T049: Implement MetricsAggregator

**Purpose**: Compute per-pipeline metrics from execution history data.

**Steps**:
1. Create `joyus-ai-mcp-server/src/pipelines/analytics/aggregator.ts`
2. Implement `MetricsAggregator` class:
   ```typescript
   export class MetricsAggregator {
     constructor(private db: DrizzleClient) {}

     /**
      * Compute metrics for a single pipeline over a time window.
      */
     async computeMetrics(
       pipelineId: string,
       tenantId: string,
       windowStart: Date,
       windowEnd: Date,
     ): Promise<PipelineMetricsData>;

     /**
      * Compute metrics for all pipelines of a tenant.
      */
     async computeTenantMetrics(
       tenantId: string,
       windowStart: Date,
       windowEnd: Date,
     ): Promise<PipelineMetricsData[]>;
   }
   ```
3. **computeMetrics(pipelineId, tenantId, windowStart, windowEnd)**:
   - Query pipeline_executions WHERE pipelineId AND tenantId AND startedAt BETWEEN windowStart AND windowEnd
   - Compute:
     - `totalExecutions`: count of all executions
     - `successCount`: count WHERE status = 'completed'
     - `failureCount`: count WHERE status = 'failed'
     - `cancelledCount`: count WHERE status = 'cancelled'
     - `meanDurationMs`: average of (completedAt - startedAt) for completed executions, in milliseconds
     - `p95DurationMs`: 95th percentile of duration for completed executions
       - Sort durations ascending, take value at index `Math.ceil(0.95 * count) - 1`
     - `failureBreakdown`: group failed execution_steps by (stepType, errorType), count per group
       - Query execution_steps WHERE executionId IN (failed executions) AND status = 'failed'
       - Extract errorDetail.type, group by stepType + errorType
     - `reviewApprovalRate`: approved / total review decisions in this window
     - `reviewRejectionRate`: rejected / total review decisions in this window
     - `meanTimeToReviewMs`: average of (decidedAt - createdAt) for decided review_decisions
4. Define `PipelineMetricsData` type matching the pipeline_metrics table shape
5. Handle edge cases:
   - Zero executions: all counts = 0, rates = null, durations = null
   - Zero completed executions: mean/p95 duration = null
   - Zero review decisions: approval/rejection rates = null

**Files**:
- `joyus-ai-mcp-server/src/pipelines/analytics/aggregator.ts` (new, ~150 lines)

**Validation**:
- [ ] Correct counts for success, failure, cancelled executions
- [ ] Mean duration computed correctly (only from completed executions)
- [ ] p95 duration computed correctly
- [ ] Failure breakdown groups by step type and error type
- [ ] Review rates computed correctly
- [ ] Edge cases (zero data) return null, not NaN or errors

---

## Subtask T050: Implement Materialized Metrics Refresh

**Purpose**: Refresh the pipeline_metrics table when executions complete, keeping analytics queries fast.

**Steps**:
1. In `aggregator.ts`, add a refresh method:
   ```typescript
   /**
    * Refresh materialized metrics for a pipeline after execution completion.
    * Called by the executor when an execution transitions to a terminal state.
    */
   async refreshMetrics(pipelineId: string, tenantId: string): Promise<void>;
   ```
2. **refreshMetrics(pipelineId, tenantId)**:
   - Define the window: last 90 days (platform default for NFR-003)
   - Call `computeMetrics(pipelineId, tenantId, 90daysAgo, now)`
   - Upsert into `pipeline_metrics` table:
     - Look for existing row with same pipelineId and overlapping window
     - If exists: UPDATE with new computed values, set refreshedAt = now()
     - If not: INSERT new row
   - Use a single window per pipeline (not multiple time buckets for MVP)
3. Hook into the executor:
   - After pipeline execution completes (any terminal status: completed, failed, cancelled):
     - Call `aggregator.refreshMetrics(pipelineId, tenantId)`
   - This is a fire-and-forget operation — don't block execution completion
4. Consider: add a periodic refresh cron job for consistency (e.g., daily at midnight):
   ```typescript
   export function scheduleMetricsRefresh(aggregator: MetricsAggregator, db: DrizzleClient): cron.ScheduledTask;
   ```
   - Query all distinct pipelineIds with executions in the last 90 days
   - Refresh metrics for each

**Files**:
- `joyus-ai-mcp-server/src/pipelines/analytics/aggregator.ts` (extend from T049, ~50 additional lines)

**Validation**:
- [ ] Metrics are refreshed after execution completion
- [ ] Upsert works correctly (update existing, create new)
- [ ] Refresh is non-blocking (doesn't delay execution completion reporting)
- [ ] 90-day window matches NFR-003 requirement

---

## Subtask T051: Implement QualitySignalEmitter

**Purpose**: Monitor rejection patterns across pipeline executions and emit quality signals to the governance layer when thresholds are exceeded.

**Steps**:
1. Create `joyus-ai-mcp-server/src/pipelines/analytics/quality-signals.ts`
2. Implement `QualitySignalEmitter` class:
   ```typescript
   export class QualitySignalEmitter {
     constructor(
       private db: DrizzleClient,
       private config?: QualitySignalConfig,
     ) {}

     /**
      * Check a pipeline's recent review decisions for quality degradation.
      * Called after each review decision is recorded.
      */
     async checkAndEmit(pipelineId: string, tenantId: string): Promise<QualitySignal | null>;

     /**
      * Scan all pipelines for quality signals (periodic check).
      */
     async scanAll(): Promise<QualitySignal[]>;
   }
   ```
3. **checkAndEmit(pipelineId, tenantId)**:
   - Load the last N review decisions for this pipeline (N = config.windowSize, default: 10)
   - Count rejected decisions
   - Compute rejection rate = rejected / total
   - If rejection rate > config.threshold (default: 0.3 / 30%):
     - Build a QualitySignal:
       ```typescript
       {
         type: 'pipeline_quality_degradation',
         pipelineId,
         tenantId,
         rejectionRate,
         windowSize: N,
         sampleRejectionReasons: [/* top 3 rejection categories */],
         detectedAt: new Date(),
       }
       ```
     - Emit the signal:
       - For MVP: log the signal at WARN level with structured data
       - If governance layer API is available (Spec 007): POST the signal
       - Store the signal emission in a lightweight audit trail (optional: add to pipeline_metrics or a separate signals table)
     - Return the signal
   - If within threshold: return null
4. **QualitySignalConfig**:
   ```typescript
   export interface QualitySignalConfig {
     threshold: number;    // Default: 0.3 (30%)
     windowSize: number;   // Default: 10 (last 10 decisions)
     cooldownMs: number;   // Default: 86400000 (24h) — don't re-emit within cooldown
   }
   ```
5. Cooldown: track last emission time per pipeline. Don't emit duplicate signals within the cooldown window.
6. **scanAll()**: iterate all pipelines with recent review decisions, call checkAndEmit for each. Can be run on a cron schedule.

**Files**:
- `joyus-ai-mcp-server/src/pipelines/analytics/quality-signals.ts` (new, ~120 lines)

**Validation**:
- [ ] Detects rejection rate exceeding threshold
- [ ] Includes sample rejection reasons in the signal
- [ ] Cooldown prevents duplicate signals within window
- [ ] Within-threshold returns null (no signal)
- [ ] Handles pipelines with fewer than windowSize decisions

---

## Subtask T052: Add Analytics Express Routes and MCP Tool

**Purpose**: Expose analytics data via REST API and MCP tool.

**Steps**:
1. In `joyus-ai-mcp-server/src/pipelines/routes.ts`, add analytics endpoints:
2. **GET /api/pipelines/:id/analytics** — Per-pipeline analytics:
   - Query params: `windowDays` (optional, default 90, max 365)
   - Verify tenant ownership
   - Return pipeline_metrics data for the specified window
   - If no metrics exist yet: compute on-the-fly via aggregator
3. **GET /api/analytics/pipelines** — Tenant-wide analytics:
   - Query params: `windowDays` (optional, default 90)
   - Return metrics for all tenant's pipelines
   - Include summary: total executions, overall success rate, most failed pipeline, best pipeline
4. In `joyus-ai-mcp-server/src/tools/pipeline-tools.ts`, add analytics tool:
5. **pipeline_analytics** MCP tool:
   - Input: optional pipelineId (if omitted, returns tenant-wide), optional windowDays
   - Handler: queries metrics, formats for Claude readability
   - Output should include natural language summary: "Pipeline X has 95% success rate over 90 days. 3 failures, all in the profile_generation step due to timeouts."

**Files**:
- `joyus-ai-mcp-server/src/pipelines/routes.ts` (extend, ~60 additional lines)
- `joyus-ai-mcp-server/src/tools/pipeline-tools.ts` (extend, ~40 additional lines)

**Validation**:
- [ ] Per-pipeline analytics returns correct metrics
- [ ] Tenant-wide analytics aggregates across pipelines
- [ ] Query performance is sub-second for 90-day window (NFR-003)
- [ ] MCP tool produces readable output
- [ ] Tenant isolation enforced

---

## Subtask T053: Create Analytics Barrel Export

**Purpose**: Provide module exports for the analytics subsystem.

**Steps**:
1. Create `joyus-ai-mcp-server/src/pipelines/analytics/index.ts`
2. Re-export all types and classes:
   ```typescript
   export { MetricsAggregator } from './aggregator.js';
   export type { PipelineMetricsData } from './aggregator.js';
   export { QualitySignalEmitter } from './quality-signals.js';
   export type { QualitySignal, QualitySignalConfig } from './quality-signals.js';
   ```
3. Update `src/pipelines/index.ts` to export from analytics module
4. Wire MetricsAggregator and QualitySignalEmitter into the module initialization (T046):
   - Create instances in `initializePipelineModule`
   - Hook `refreshMetrics` call into the executor's execution completion path
   - Hook `checkAndEmit` call into the DecisionRecorder's post-decision path
   - Optionally schedule periodic `scanAll` cron job

**Files**:
- `joyus-ai-mcp-server/src/pipelines/analytics/index.ts` (new, ~10 lines)
- `joyus-ai-mcp-server/src/pipelines/index.ts` (modify — add analytics export and initialization wiring)

**Validation**:
- [ ] All analytics exports accessible
- [ ] Metrics refresh is hooked into executor
- [ ] Quality signal check is hooked into decision recording
- [ ] `npm run typecheck` passes

---

## Subtask T054: Unit Tests for Aggregator and Quality Signals

**Purpose**: Verify metrics computation accuracy and quality signal detection.

**Steps**:
1. Create `joyus-ai-mcp-server/tests/pipelines/analytics/aggregator.test.ts`
2. Aggregator test cases:
   - **All successful**: 10 executions all completed, success rate = 100%, failure count = 0
   - **Mixed outcomes**: 15 success, 3 failed, 2 cancelled = 75% success rate, 15% failure rate
   - **Duration computation**: 5 completed executions with known durations, verify mean and p95
   - **p95 edge case**: 1 execution, p95 = its duration. 2 executions, p95 = the longer one.
   - **Failure breakdown**: 3 failures in profile_generation (timeout), 1 in content_generation (auth), verify grouped correctly
   - **Review rates**: 8 approved, 2 rejected = 80% approval, 20% rejection
   - **Mean time to review**: 3 decisions with known timings, verify average
   - **Empty window**: No executions in window, all counts = 0, rates = null
   - **Refresh upsert**: Refresh twice for same pipeline, verify single row updated (not duplicated)
3. Create `joyus-ai-mcp-server/tests/pipelines/analytics/quality-signals.test.ts`
4. Quality signal test cases:
   - **Below threshold**: 7 approved, 3 rejected (30%), threshold 30% — NO signal (not strictly greater)
   - **Above threshold**: 6 approved, 4 rejected (40%), threshold 30% — signal emitted
   - **Exactly at threshold**: Confirm boundary behavior (>30% means 31%+ triggers)
   - **Cooldown prevents re-emit**: Signal emitted, check again within 24h — no new signal
   - **Cooldown expired re-emit**: Signal emitted, check again after 24h — new signal if still above threshold
   - **Small sample**: Only 3 decisions (less than windowSize of 10) — include all 3 in computation
   - **Sample rejection reasons**: Verify top rejection categories are included in signal
   - **No review decisions**: Pipeline with no review gates — checkAndEmit returns null

**Files**:
- `joyus-ai-mcp-server/tests/pipelines/analytics/aggregator.test.ts` (new, ~200 lines)
- `joyus-ai-mcp-server/tests/pipelines/analytics/quality-signals.test.ts` (new, ~150 lines)

**Validation**:
- [ ] All tests pass via `npm run test`
- [ ] p95 computation verified with known distributions
- [ ] Quality signal threshold boundary verified
- [ ] Cooldown behavior verified

---

## Definition of Done

- [ ] MetricsAggregator computes all required metrics: counts, duration stats, failure breakdown, review rates
- [ ] Metrics are materialized into pipeline_metrics table and refreshed on execution completion
- [ ] QualitySignalEmitter detects rejection rate >30% and emits structured quality signals
- [ ] Quality signal cooldown prevents duplicate emissions
- [ ] Analytics routes return per-pipeline and tenant-wide metrics
- [ ] pipeline_analytics MCP tool produces readable output
- [ ] Metrics refresh hooked into executor, quality check hooked into decision recorder
- [ ] Unit tests verify aggregation accuracy and signal thresholds
- [ ] `npm run validate` passes with zero errors

## Risks

- **p95 computation with large datasets**: Sorting all execution durations for p95 may be slow with many executions. Mitigation: the 90-day window and per-pipeline scoping limits the dataset. For production scale, consider approximate quantile algorithms (e.g., t-digest).
- **Quality signal noise**: A pipeline with very few executions (e.g., 3 in 10 days) may have a high rejection rate due to small sample size. Mitigation: include `windowSize` in the signal so consumers can weight it appropriately.
- **Governance layer integration**: The Spec 007 governance API may not be available. Mitigation: for MVP, log the signal at WARN level. The integration point is a single function call that can be wired later.

## Reviewer Guidance

- Verify p95 computation: sort ascending, take index `Math.ceil(0.95 * n) - 1`
- Check that mean duration only includes completed executions (not failed/cancelled)
- Verify rejection rate threshold is strictly greater than (>30%, not >=30%)
- Check cooldown tracks per-pipeline, not globally
- Verify refreshMetrics is fire-and-forget (non-blocking)
- Confirm analytics queries include tenantId (Leash pattern)
- Check that the MCP tool output is human-readable (not just raw JSON)

## Activity Log
- 2026-03-16T19:29:37Z – unknown – shell_pid=81465 – lane=done – Analytics aggregator, quality signals, 17 tests.
