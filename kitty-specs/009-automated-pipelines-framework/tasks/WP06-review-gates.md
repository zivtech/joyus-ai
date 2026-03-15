---
work_package_id: "WP06"
title: "Review Gates"
lane: "planned"
dependencies: ["WP04"]
subtasks: ["T030", "T031", "T032", "T033", "T034", "T035"]
history:
  - date: "2026-03-14"
    action: "created"
    agent: "claude-opus"
---

# WP06: Review Gates

**Implementation command**: `spec-kitty implement WP06 --base WP04`
**Target repo**: `joyus-ai`
**Dependencies**: WP04 (Pipeline Executor)
**Priority**: P1 | Can run in parallel with WP07

## Objective

Build the human-in-the-loop review mechanism: pause pipeline execution at designated steps, route artifacts to a review queue, record reviewer decisions (approve/reject/partial), resume execution on approval, store structured rejection feedback, and escalate reviews that exceed their timeout window.

## Context

Review gates are the primary governance mechanism for Spec 009 (FR-004: human-in-the-loop control). When a step with `requiresReview: true` completes, the `StepRunner` (WP04) sets the execution status to `waiting_review`. This WP implements what happens next.

**Resumption model**: After a reviewer approves, the execution must resume from the step immediately after the review gate. The `StepRunner.runAllSteps` loop already skips completed steps, so resuming means calling `runExecution` again on the paused execution. The review decision record is how the system knows which step index the execution paused at.

**Partial approval**: A step may produce multiple artifacts (e.g., 3 generated emails). The reviewer can approve some and reject others. Approved artifacts move forward; rejected artifacts have feedback stored but do not block the pipeline — only a full rejection (`decision: 'rejected'`) cancels execution.

**Escalation**: Reviews that exceed `reviewTimeoutHours` are escalated. Escalation does not auto-approve or auto-reject — it sends a notification and sets `escalation_status = 'escalated'`. The pipeline remains paused. Resolving escalation is a human action.

WP06 runs in parallel with WP07 — both depend only on WP04.

---

## Subtasks

### T030: Implement ReviewGate — pause execution and create pending review decisions (`src/pipelines/review/gate.ts`)

**Purpose**: When the `StepRunner` signals a review gate, create the `review_decisions` row in `pending` state with the timeout timestamp.

**Steps**:
1. Create `src/pipelines/review/gate.ts`
2. Define `ReviewGate` class with `createReviewDecision(executionId, stepIndex, tenantId, stepConfig)`
3. Calculate `timeoutAt` from `stepConfig.reviewTimeoutHours` (default: 24h)
4. Insert the `review_decisions` row with `escalation_status: 'pending'`

```typescript
// src/pipelines/review/gate.ts
import { eq, and } from 'drizzle-orm';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { reviewDecisions } from '../schema';
import type { StepConfig } from '../types';
import { DEFAULT_REVIEW_TIMEOUT_HOURS } from '../types';

export class ReviewGate {
  constructor(private readonly db: NodePgDatabase<Record<string, unknown>>) {}

  /**
   * Called by StepRunner after a step with requiresReview: true completes.
   * Creates the pending review decision row that blocks resumption.
   */
  async createReviewDecision(
    executionId: string,
    stepIndex: number,
    tenantId: string,
    stepConfig: StepConfig,
    artifactPaths: string[] = [],
  ): Promise<string> {
    const timeoutHours = stepConfig.reviewTimeoutHours ?? DEFAULT_REVIEW_TIMEOUT_HOURS;
    const timeoutAt = new Date(Date.now() + timeoutHours * 60 * 60 * 1000);

    const [decision] = await this.db
      .insert(reviewDecisions)
      .values({
        executionId,
        stepIndex,
        tenantId,
        escalationStatus: 'pending',
        timeoutAt,
        // artifactApprovals: pre-populated with null for each artifact (reviewer fills in true/false)
        artifactApprovals: Object.fromEntries(artifactPaths.map((p) => [p, null])),
      })
      .returning({ id: reviewDecisions.id });

    return decision.id;
  }

  /**
   * Check if an execution has a pending review decision blocking it.
   */
  async getPendingDecision(
    executionId: string,
    stepIndex: number,
  ): Promise<typeof reviewDecisions.$inferSelect | null> {
    const rows = await this.db
      .select()
      .from(reviewDecisions)
      .where(
        and(
          eq(reviewDecisions.executionId, executionId),
          eq(reviewDecisions.stepIndex, stepIndex),
        ),
      )
      .limit(1);

    return rows[0] ?? null;
  }
}
```

**Files**:
- `src/pipelines/review/gate.ts` (new, ~55 lines)

**Validation**:
- [ ] `createReviewDecision` inserts a row with `escalation_status: 'pending'` and correct `timeoutAt`
- [ ] `timeoutAt` is 24 hours from now when `reviewTimeoutHours` is not set
- [ ] `artifactApprovals` is populated with `null` values for each artifact path
- [ ] `tsc --noEmit` passes

**Edge Cases**:
- If `createReviewDecision` is called twice for the same `(executionId, stepIndex)` (e.g., on retry), use `INSERT ... ON CONFLICT DO NOTHING` to avoid duplicate review rows. The existing pending decision from the first call should be preserved.

---

### T031: Implement decision recording and pipeline resumption logic (`src/pipelines/review/decision.ts`)

**Purpose**: Process a reviewer's decision — record it to the DB, then either resume or cancel the pipeline execution based on the decision type.

**Steps**:
1. Create `src/pipelines/review/decision.ts`
2. Define `DecisionService` class with `recordDecision(decisionId, input, executorRef)` method
3. On `approved`: update decision row, set execution `status = 'running'`, call `executor.runExecution(executionId)` to resume
4. On `rejected`: update decision row, set execution `status = 'cancelled'`
5. On `partial`: update decision row with per-artifact approvals, resume execution

```typescript
// src/pipelines/review/decision.ts
import { eq } from 'drizzle-orm';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { reviewDecisions, pipelineExecutions } from '../schema';
import type { ReviewDecisionInput } from '../validation';
import type { PipelineExecutor } from '../engine/executor';

export class DecisionService {
  constructor(private readonly db: NodePgDatabase<Record<string, unknown>>) {}

  async recordDecision(
    decisionId: string,
    reviewerId: string,
    input: ReviewDecisionInput,
    executor: PipelineExecutor,
  ): Promise<void> {
    // Fetch the decision to get executionId
    const rows = await this.db
      .select()
      .from(reviewDecisions)
      .where(eq(reviewDecisions.id, decisionId))
      .limit(1);

    if (rows.length === 0) throw new Error(`Review decision ${decisionId} not found`);
    const decisionRow = rows[0];

    // Prevent re-deciding an already-decided review
    if (decisionRow.decidedAt) {
      throw new Error(`Review decision ${decisionId} has already been decided`);
    }

    // Record the decision
    await this.db
      .update(reviewDecisions)
      .set({
        decision: input.decision,
        feedback: input.feedback,
        reviewerId,
        artifactApprovals: input.artifactApprovals ?? decisionRow.artifactApprovals,
        decidedAt: new Date(),
        escalationStatus: 'resolved',
      })
      .where(eq(reviewDecisions.id, decisionId));

    // Act on the decision
    if (input.decision === 'rejected') {
      await this.db
        .update(pipelineExecutions)
        .set({ status: 'cancelled', completedAt: new Date(), errorMessage: `Rejected by reviewer: ${input.feedback ?? ''}` })
        .where(eq(pipelineExecutions.id, decisionRow.executionId));
    } else {
      // approved or partial — resume execution from the next step
      await this.db
        .update(pipelineExecutions)
        .set({ status: 'running' })
        .where(eq(pipelineExecutions.id, decisionRow.executionId));

      // Resume asynchronously — don't block the HTTP response
      void executor.runExecution(decisionRow.executionId);
    }
  }
}
```

**Files**:
- `src/pipelines/review/decision.ts` (new, ~55 lines)

**Validation**:
- [ ] `approved` decision: execution status set to `running`, `executor.runExecution` called
- [ ] `rejected` decision: execution status set to `cancelled` with feedback in `errorMessage`
- [ ] `partial` decision: treated same as `approved` for execution flow (artifacts with `false` approvals are already recorded)
- [ ] Calling `recordDecision` on an already-decided review throws an error
- [ ] `tsc --noEmit` passes

**Edge Cases**:
- `executor.runExecution` is called with `void` to avoid blocking the HTTP response. The resumed execution runs asynchronously. The caller (API route) should return 200 immediately after recording the decision.
- Tenant scoping: verify the `decisionId` belongs to the correct tenant before allowing the decision. The API route (WP08) should enforce this, but `DecisionService` should also check.

---

### T032: Implement structured rejection feedback storage and artifact path filtering

**Purpose**: Ensure rejection feedback is stored in a structured format and that partially approved artifact sets are correctly represented in the decision record.

**Steps**:
1. This task extends `gate.ts` and `decision.ts` — no new file required
2. The `artifactApprovals` jsonb column stores `{ "path/to/artifact": true | false | null }` (null = not yet decided, true = approved, false = rejected)
3. Add a helper `getApprovedArtifacts(decisionId)` to `gate.ts` that returns only the `true` entries

```typescript
// Addition to src/pipelines/review/gate.ts

  /**
   * Returns the set of artifact paths that were explicitly approved.
   * Used by downstream steps to know which artifacts to process.
   */
  async getApprovedArtifacts(decisionId: string): Promise<string[]> {
    const rows = await this.db
      .select({ artifactApprovals: reviewDecisions.artifactApprovals })
      .from(reviewDecisions)
      .where(eq(reviewDecisions.id, decisionId))
      .limit(1);

    if (rows.length === 0) return [];
    const approvals = rows[0].artifactApprovals as Record<string, boolean | null>;
    return Object.entries(approvals)
      .filter(([, approved]) => approved === true)
      .map(([path]) => path);
  }
```

**Files**:
- `src/pipelines/review/gate.ts` (modified — add `getApprovedArtifacts`)

**Validation**:
- [ ] `getApprovedArtifacts` returns only paths with `true` value
- [ ] Paths with `null` (undecided) and `false` (rejected) are excluded
- [ ] `tsc --noEmit` passes

**Edge Cases**:
- When a reviewer submits a `partial` decision without specifying `artifactApprovals`, all artifacts should be treated as approved by default (conservative: don't silently discard work). Document this default in the API schema.

---

### T033: Implement timeout escalation logic (`src/pipelines/review/escalation.ts`)

**Purpose**: Find pending review decisions that have exceeded their `timeoutAt` timestamp and escalate them — sending a notification and updating `escalation_status`.

**Steps**:
1. Create `src/pipelines/review/escalation.ts`
2. Define `EscalationService` with `escalateTimedOutReviews(notifier)` method
3. Query `review_decisions WHERE decided_at IS NULL AND timeout_at < NOW() AND escalation_status = 'pending'`
4. For each: update `escalation_status = 'escalated'`, send notification
5. Escalation does NOT auto-approve or auto-reject — the pipeline stays paused

```typescript
// src/pipelines/review/escalation.ts
import { and, isNull, lt, eq } from 'drizzle-orm';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { reviewDecisions, pipelineExecutions, pipelines } from '../schema';

export interface EscalationNotifier {
  notifyEscalation(params: {
    tenantId: string;
    pipelineId: string;
    pipelineName: string;
    executionId: string;
    decisionId: string;
    stepIndex: number;
    timedOutAt: Date;
  }): Promise<void>;
}

export class NullEscalationNotifier implements EscalationNotifier {
  async notifyEscalation(params: Parameters<EscalationNotifier['notifyEscalation']>[0]) {
    console.warn(`[EscalationNotifier] Review timed out for execution ${params.executionId}, step ${params.stepIndex}`);
  }
}

export class EscalationService {
  constructor(private readonly db: NodePgDatabase<Record<string, unknown>>) {}

  /**
   * Runs periodically (e.g., every 15 minutes via cron).
   * Finds timed-out pending reviews and escalates them.
   * Never auto-approves or auto-rejects.
   */
  async escalateTimedOutReviews(notifier: EscalationNotifier): Promise<number> {
    const now = new Date();

    const timedOut = await this.db
      .select({
        decisionId: reviewDecisions.id,
        executionId: reviewDecisions.executionId,
        stepIndex: reviewDecisions.stepIndex,
        tenantId: reviewDecisions.tenantId,
        timeoutAt: reviewDecisions.timeoutAt,
      })
      .from(reviewDecisions)
      .where(
        and(
          isNull(reviewDecisions.decidedAt),
          lt(reviewDecisions.timeoutAt, now),
          eq(reviewDecisions.escalationStatus, 'pending'),
        ),
      )
      .limit(50);

    if (timedOut.length === 0) return 0;

    for (const row of timedOut) {
      // Update escalation status
      await this.db
        .update(reviewDecisions)
        .set({ escalationStatus: 'escalated' })
        .where(eq(reviewDecisions.id, row.decisionId));

      // Fetch pipeline name for notification
      const executionRows = await this.db
        .select({ pipelineId: pipelineExecutions.pipelineId })
        .from(pipelineExecutions)
        .where(eq(pipelineExecutions.id, row.executionId))
        .limit(1);

      if (executionRows.length === 0) continue;
      const pipelineId = executionRows[0].pipelineId;

      const pipelineRows = await this.db
        .select({ name: pipelines.name })
        .from(pipelines)
        .where(eq(pipelines.id, pipelineId))
        .limit(1);

      await notifier.notifyEscalation({
        tenantId: row.tenantId,
        pipelineId,
        pipelineName: pipelineRows[0]?.name ?? 'Unknown',
        executionId: row.executionId,
        decisionId: row.decisionId,
        stepIndex: row.stepIndex,
        timedOutAt: row.timeoutAt!,
      });
    }

    return timedOut.length;
  }
}
```

**Files**:
- `src/pipelines/review/escalation.ts` (new, ~80 lines)

**Validation**:
- [ ] Only rows with `decided_at IS NULL AND timeout_at < NOW() AND escalation_status = 'pending'` are escalated
- [ ] After escalation, `escalation_status = 'escalated'` (not `resolved`)
- [ ] Pipeline execution status is NOT changed — execution remains `waiting_review`
- [ ] `NullEscalationNotifier` logs a warning without throwing
- [ ] `tsc --noEmit` passes

**Edge Cases**:
- Escalation is idempotent: if the cron runs twice before a reviewer acts, the second run finds `escalation_status = 'escalated'` and skips those rows (the `WHERE escalation_status = 'pending'` clause).
- `timeoutAt` may be null if the review decision was created without a timeout (defensive: skip those rows).

---

### T034: Create escalation cron job and barrel export (`src/pipelines/review/index.ts`)

**Purpose**: Wire the escalation service into a recurring cron job so timed-out reviews are automatically escalated without manual intervention.

**Steps**:
1. Create `src/pipelines/review/index.ts` as barrel export
2. Add a `startEscalationCron(db, notifier, intervalMinutes)` function that runs `escalateTimedOutReviews` on an interval
3. The cron runs every 15 minutes by default

```typescript
// src/pipelines/review/index.ts
export { ReviewGate } from './gate';
export { DecisionService } from './decision';
export { EscalationService, NullEscalationNotifier } from './escalation';
export type { EscalationNotifier } from './escalation';

import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { EscalationService, NullEscalationNotifier } from './escalation';
import type { EscalationNotifier } from './escalation';

const DEFAULT_ESCALATION_INTERVAL_MS = 15 * 60 * 1000;  // 15 minutes

export function startEscalationCron(
  db: NodePgDatabase<Record<string, unknown>>,
  notifier: EscalationNotifier = new NullEscalationNotifier(),
  intervalMs: number = DEFAULT_ESCALATION_INTERVAL_MS,
): NodeJS.Timeout {
  const service = new EscalationService(db);

  return setInterval(() => {
    void service.escalateTimedOutReviews(notifier).then((count) => {
      if (count > 0) {
        console.info(`[EscalationCron] Escalated ${count} timed-out reviews`);
      }
    });
  }, intervalMs);
}
```

**Files**:
- `src/pipelines/review/index.ts` (new, ~30 lines)

**Validation**:
- [ ] `startEscalationCron(db)` returns a `NodeJS.Timeout` (can be cleared with `clearInterval`)
- [ ] `import { ReviewGate, DecisionService, EscalationService } from '../review'` resolves without errors
- [ ] `tsc --noEmit` passes

**Edge Cases**:
- The cron runs every 15 minutes. If the escalation query is slow (many pending reviews), the interval may overlap. Add a mutex flag to prevent concurrent runs if this becomes an issue.

---

### T035: Unit tests for review gate, decision, and escalation (`tests/pipelines/review/`)

**Purpose**: Verify gate creation, decision recording, resumption trigger, escalation query logic, and idempotency of escalation.

**Steps**:
1. Create `tests/pipelines/review/gate.test.ts`
2. Create `tests/pipelines/review/decision.test.ts`
3. Create `tests/pipelines/review/escalation.test.ts`

```typescript
// tests/pipelines/review/escalation.test.ts (excerpt)
import { describe, it, expect, vi } from 'vitest';
import { NullEscalationNotifier } from '../../../src/pipelines/review/escalation';

describe('NullEscalationNotifier', () => {
  it('does not throw when called', async () => {
    const notifier = new NullEscalationNotifier();
    await expect(notifier.notifyEscalation({
      tenantId: 't1',
      pipelineId: 'p1',
      pipelineName: 'Test',
      executionId: 'e1',
      decisionId: 'd1',
      stepIndex: 0,
      timedOutAt: new Date(),
    })).resolves.toBeUndefined();
  });
});

// Decision service tests need a mock executor
describe('DecisionService', () => {
  it('throws when decision is already decided', async () => {
    // Use integration test pattern with test DB
    // See tests/setup.ts for DB fixture utilities
  });
});
```

**Files**:
- `tests/pipelines/review/gate.test.ts` (new, ~35 lines)
- `tests/pipelines/review/decision.test.ts` (new, ~40 lines)
- `tests/pipelines/review/escalation.test.ts` (new, ~40 lines)

**Validation**:
- [ ] `npm test tests/pipelines/review/` exits 0
- [ ] Gate creation test: `timeoutAt` is approximately 24h from now (within 1s)
- [ ] Escalation test: `NullEscalationNotifier` does not throw
- [ ] Decision test: re-deciding a decided review throws

**Edge Cases**:
- `DecisionService.recordDecision` requires a real `PipelineExecutor` reference to call `runExecution`. In unit tests, pass a mock with `vi.fn()` for `runExecution`. Do not create a full executor with DB connections in unit tests.

---

## Definition of Done

- [ ] `src/pipelines/review/gate.ts` — `ReviewGate` with `createReviewDecision`, `getPendingDecision`, `getApprovedArtifacts`
- [ ] `src/pipelines/review/decision.ts` — `DecisionService` with `recordDecision`
- [ ] `src/pipelines/review/escalation.ts` — `EscalationService`, `NullEscalationNotifier`, `EscalationNotifier`
- [ ] `src/pipelines/review/index.ts` — barrel export and `startEscalationCron`
- [ ] Tests passing: gate (timeoutAt, artifact approvals), decision (approve/reject/partial, re-decide throws), escalation (null notifier, idempotency)
- [ ] `npm run typecheck` exits 0
- [ ] `npm test` exits 0 with no regressions

## Risks

- **Resumption race**: `DecisionService.recordDecision` sets execution status to `running` and calls `executor.runExecution` asynchronously. If two reviewers submit decisions simultaneously (shouldn't happen but possible), both may call `runExecution` for the same execution. The `StepRunner`'s completed-step check provides idempotency, but it's not atomic. The `activeExecutions` set in `PipelineExecutor` provides in-process deduplication.
- **Escalation without notification service**: `NullEscalationNotifier` logs but does not actually alert anyone. Wire up a real notifier (Slack webhook, email) before production use. The `EscalationService` is designed to accept any `EscalationNotifier` implementation.
- **Partial approval semantics**: The spec does not define what "partial approval" means for pipeline continuation — do all steps after the gate run, or only those processing approved artifacts? The current implementation treats `partial` the same as `approved` (resume). Document this decision.

## Reviewer Guidance

- Verify escalation never modifies `pipeline_executions.status` — it must leave the execution in `waiting_review`. Only the reviewer's explicit decision changes the execution status.
- Check that `recordDecision` validates that the `decisionId` belongs to the correct tenant. The `review_decisions` table has a `tenant_id` column — query must include it.
- Confirm `startEscalationCron` returns the interval handle so the caller can clear it on graceful shutdown.
