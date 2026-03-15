---
work_package_id: "WP04"
title: "Pipeline Executor"
lane: "planned"
dependencies: ["WP02", "WP03"]
subtasks: ["T018", "T019", "T020", "T021", "T022", "T023"]
history:
  - date: "2026-03-14"
    action: "created"
    agent: "claude-opus"
---

# WP04: Pipeline Executor

**Implementation command**: `spec-kitty implement WP04 --base WP02,WP03`
**Target repo**: `joyus-ai`
**Dependencies**: WP02 (Event Bus), WP03 (Trigger System)
**Priority**: P1 (Execution engine — WP05, WP06, WP07 all depend on this)

## Objective

Build the core pipeline execution engine: the `PipelineExecutor` poll loop that claims pending executions, the `StepRunner` that delegates to step handlers, exponential backoff retry logic, and idempotency key generation and deduplication. This is the heart of the pipelines feature.

## Context

The executor operates in two modes simultaneously:
1. **Event-driven**: subscribes to the event bus (WP02), receives trigger events, matches them against active pipelines via trigger handlers (WP03), creates `pipeline_executions` rows, and starts execution.
2. **Poll-driven**: on startup, scans `trigger_events WHERE processed_at IS NULL` to recover events that were missed due to server restarts. Also scans `pipeline_executions WHERE status = 'pending'` to resume interrupted executions.

**Concurrency policy** (from `types.ts`):
- `skip`: if an execution is already `running`, skip new trigger (most pipelines use this)
- `queue`: add to pending queue (allow backlog)
- `allow`: run multiple simultaneously (use with caution)

**Step execution** is delegated to `PipelineStepHandler` implementations (WP05). The `StepRunner` does not know about individual step types — it calls `stepHandlerRegistry.get(stepType).execute(...)`.

WP04 is the blocker for WP05, WP06, and WP07. Complete it before those WPs start.

---

## Subtasks

### T018: Implement PipelineExecutor class (`src/pipelines/engine/executor.ts`)

**Purpose**: Orchestrate the full pipeline execution lifecycle — from event receipt to step completion. Manages the poll loop, concurrency policy enforcement, and execution state transitions.

**Steps**:
1. Create `src/pipelines/engine/executor.ts`
2. Constructor accepts: `db`, `eventBus`, `triggerRegistry`, `stepHandlerRegistry`, `options`
3. `start()`: subscribes to event bus, starts poll loop
4. `stop()`: unsubscribes, stops poll loop, waits for in-flight executions
5. `handleEvent(event)`: matches triggers, enforces concurrency, creates execution rows, calls `runExecution`
6. `runExecution(executionId)`: fetches execution + pipeline, runs steps in sequence via `StepRunner`

```typescript
// src/pipelines/engine/executor.ts
import { eq, and, isNull, inArray } from 'drizzle-orm';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { pipelines, pipelineExecutions, triggerEvents } from '../schema';
import type { EventBus, EventEnvelope } from '../event-bus';
import type { TriggerRegistry } from '../triggers/registry';
import type { StepHandlerRegistry } from '../steps/registry';
import { StepRunner } from './step-runner';
import { generateIdempotencyKey, isDuplicateExecution } from './idempotency';
import type {
  Pipeline,
  PipelineExecution,
  ConcurrencyPolicy,
  ExecutionStatus,
} from '../types';
import { POLL_INTERVAL_MS } from '../types';

export interface ExecutorOptions {
  pollIntervalMs?: number;
  maxConcurrentExecutions?: number;
}

export class PipelineExecutor {
  private pollTimer: NodeJS.Timeout | null = null;
  private subscriptionIds: string[] = [];
  private activeExecutions = new Set<string>();
  private stepRunner: StepRunner;

  constructor(
    private readonly db: NodePgDatabase<Record<string, unknown>>,
    private readonly eventBus: EventBus,
    private readonly triggerRegistry: TriggerRegistry,
    private readonly stepHandlerRegistry: StepHandlerRegistry,
    private readonly options: ExecutorOptions = {},
  ) {
    this.stepRunner = new StepRunner(db, stepHandlerRegistry);
  }

  async start(): Promise<void> {
    // Subscribe to all trigger event types
    for (const handler of this.triggerRegistry.getAll()) {
      const subId = this.eventBus.subscribe(handler.triggerType, (event) =>
        this.handleEvent(event),
      );
      this.subscriptionIds.push(subId);
    }

    // Recovery: process unhandled events and pending executions on startup
    await this.recoverUnprocessedEvents();
    await this.resumePendingExecutions();

    // Start poll loop
    const interval = this.options.pollIntervalMs ?? POLL_INTERVAL_MS;
    this.pollTimer = setInterval(() => void this.pollCycle(), interval);
  }

  async stop(): Promise<void> {
    if (this.pollTimer) {
      clearInterval(this.pollTimer);
      this.pollTimer = null;
    }
    for (const id of this.subscriptionIds) {
      this.eventBus.unsubscribe(id);
    }
    // Wait for active executions to finish (up to 30s)
    const deadline = Date.now() + 30_000;
    while (this.activeExecutions.size > 0 && Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, 500));
    }
  }

  private async handleEvent(event: EventEnvelope): Promise<void> {
    const handler = this.triggerRegistry.getHandler(event.eventType);
    if (!handler) return;

    // Fetch active pipelines for this tenant
    const activePipelines = await this.db
      .select()
      .from(pipelines)
      .where(and(eq(pipelines.tenantId, event.tenantId), eq(pipelines.status, 'active')));

    const results = handler.getMatchingPipelines(
      { event, tenantId: event.tenantId, currentDepth: (event.payload?.depth as number) ?? 0 },
      activePipelines as Pipeline[],
    );

    for (const result of results) {
      await this.createAndRunExecution(
        result.pipelineId,
        event.tenantId,
        event.eventType,
        result.triggerPayload,
      );
    }
  }

  private async createAndRunExecution(
    pipelineId: string,
    tenantId: string,
    triggerType: string,
    triggerPayload: Record<string, unknown>,
  ): Promise<void> {
    const pipeline = await this.db.query.pipelines.findFirst({
      where: and(eq(pipelines.id, pipelineId), eq(pipelines.tenantId, tenantId)),
    });
    if (!pipeline) return;

    // Enforce concurrency policy
    if (!await this.checkConcurrencyPolicy(pipelineId, pipeline.concurrencyPolicy as ConcurrencyPolicy)) {
      return;
    }

    // Idempotency check
    const idempotencyKey = generateIdempotencyKey(pipelineId, triggerType, triggerPayload);
    if (await isDuplicateExecution(this.db, idempotencyKey)) {
      console.info(`[Executor] Skipping duplicate execution for key ${idempotencyKey}`);
      return;
    }

    const [execution] = await this.db
      .insert(pipelineExecutions)
      .values({
        pipelineId,
        tenantId,
        triggerType: triggerType as any,
        triggerPayload,
        idempotencyKey,
        status: 'pending',
      })
      .returning();

    await this.runExecution(execution.id);
  }

  async runExecution(executionId: string): Promise<void> {
    this.activeExecutions.add(executionId);
    try {
      await this.db
        .update(pipelineExecutions)
        .set({ status: 'running', startedAt: new Date() })
        .where(eq(pipelineExecutions.id, executionId));

      await this.stepRunner.runAllSteps(executionId);

      await this.db
        .update(pipelineExecutions)
        .set({ status: 'completed', completedAt: new Date() })
        .where(eq(pipelineExecutions.id, executionId));
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      await this.db
        .update(pipelineExecutions)
        .set({ status: 'failed', completedAt: new Date(), errorMessage: message })
        .where(eq(pipelineExecutions.id, executionId));
    } finally {
      this.activeExecutions.delete(executionId);
    }
  }

  private async checkConcurrencyPolicy(
    pipelineId: string,
    policy: ConcurrencyPolicy,
  ): Promise<boolean> {
    if (policy === 'allow') return true;

    const running = await this.db
      .select({ id: pipelineExecutions.id })
      .from(pipelineExecutions)
      .where(
        and(
          eq(pipelineExecutions.pipelineId, pipelineId),
          inArray(pipelineExecutions.status, ['pending', 'running', 'waiting_review']),
        ),
      )
      .limit(1);

    if (running.length === 0) return true;

    if (policy === 'skip') {
      console.info(`[Executor] Skipping pipeline ${pipelineId} — concurrent execution in progress`);
      return false;
    }
    // policy === 'queue': allow creating a new pending execution
    return true;
  }

  private async pollCycle(): Promise<void> {
    await this.resumePendingExecutions();
  }

  private async recoverUnprocessedEvents(): Promise<void> {
    const unprocessed = await this.db
      .select()
      .from(triggerEvents)
      .where(isNull(triggerEvents.processedAt))
      .limit(50);

    for (const event of unprocessed) {
      await this.handleEvent({
        id: event.id,
        tenantId: event.tenantId,
        eventType: event.eventType as any,
        payload: event.payload as Record<string, unknown>,
        createdAt: event.createdAt,
      });
    }
  }

  private async resumePendingExecutions(): Promise<void> {
    const pending = await this.db
      .select({ id: pipelineExecutions.id })
      .from(pipelineExecutions)
      .where(eq(pipelineExecutions.status, 'pending'))
      .limit(20);

    for (const { id } of pending) {
      if (!this.activeExecutions.has(id)) {
        void this.runExecution(id);
      }
    }
  }
}
```

**Files**:
- `src/pipelines/engine/executor.ts` (new, ~140 lines)

**Validation**:
- [ ] `tsc --noEmit` passes on `executor.ts`
- [ ] `start()` subscribes to all trigger types and starts poll loop
- [ ] `stop()` clears the interval and unsubscribes from event bus
- [ ] Concurrency policy `skip` prevents duplicate running executions
- [ ] `runExecution` transitions status: `pending` → `running` → `completed` (or `failed`)

**Edge Cases**:
- `resumePendingExecutions` must check `activeExecutions` to avoid double-running an execution that was just started in-process by `handleEvent`.
- `checkConcurrencyPolicy` queries include `waiting_review` status — a paused-at-gate execution still counts as "in progress" for concurrency purposes.

---

### T019: Implement StepRunner (`src/pipelines/engine/step-runner.ts`)

**Purpose**: Execute the steps of a single pipeline execution in sequence, delegating each step to its registered handler, and creating `step_executions` rows to track progress.

**Steps**:
1. Create `src/pipelines/engine/step-runner.ts`
2. `runAllSteps(executionId)`: fetches the execution + pipeline, iterates `stepConfigs`, calls `runStep` for each
3. `runStep(executionId, stepIndex, stepConfig)`: creates/updates `step_executions` row, calls handler, handles review gate pause
4. Steps with `requiresReview: true` pause execution by setting status to `waiting_review` — the executor waits for WP06 to resume

```typescript
// src/pipelines/engine/step-runner.ts
import { eq, and } from 'drizzle-orm';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { pipelineExecutions, stepExecutions, pipelines } from '../schema';
import type { StepHandlerRegistry } from '../steps/registry';
import type { StepConfig, StepType } from '../types';
import { RetryExecutor } from './retry';

export class StepRunner {
  private retryExecutor: RetryExecutor;

  constructor(
    private readonly db: NodePgDatabase<Record<string, unknown>>,
    private readonly stepHandlerRegistry: StepHandlerRegistry,
  ) {
    this.retryExecutor = new RetryExecutor();
  }

  async runAllSteps(executionId: string): Promise<void> {
    const execution = await this.db.query.pipelineExecutions.findFirst({
      where: eq(pipelineExecutions.id, executionId),
    });
    if (!execution) throw new Error(`Execution ${executionId} not found`);

    const pipeline = await this.db.query.pipelines.findFirst({
      where: eq(pipelines.id, execution.pipelineId),
    });
    if (!pipeline) throw new Error(`Pipeline ${execution.pipelineId} not found`);

    const stepConfigs = pipeline.stepConfigs as StepConfig[];

    for (let i = 0; i < stepConfigs.length; i++) {
      // Check if execution was cancelled externally
      const current = await this.db.query.pipelineExecutions.findFirst({
        where: eq(pipelineExecutions.id, executionId),
      });
      if (current?.status === 'cancelled') break;

      // Check if this step was already completed (resumption after crash)
      const existingStep = await this.db.query.stepExecutions.findFirst({
        where: and(
          eq(stepExecutions.executionId, executionId),
          eq(stepExecutions.stepIndex, i),
        ),
      });
      if (existingStep?.status === 'completed') continue;

      await this.runStep(executionId, i, stepConfigs[i]);

      // Check for review gate pause
      const afterStep = await this.db.query.pipelineExecutions.findFirst({
        where: eq(pipelineExecutions.id, executionId),
      });
      if (afterStep?.status === 'waiting_review') {
        // WP06 will resume this execution — stop here
        return;
      }
    }
  }

  private async runStep(
    executionId: string,
    stepIndex: number,
    stepConfig: StepConfig,
  ): Promise<void> {
    const [stepExec] = await this.db
      .insert(stepExecutions)
      .values({
        executionId,
        stepIndex,
        stepType: stepConfig.stepType as any,
        status: 'running',
        inputData: {},
        startedAt: new Date(),
      })
      .onConflictDoUpdate({
        target: [stepExecutions.executionId, stepExecutions.stepIndex],
        set: { status: 'running', startedAt: new Date() },
      })
      .returning();

    const handler = this.stepHandlerRegistry.get(stepConfig.stepType as StepType);
    if (!handler) {
      await this.markStepFailed(stepExec.id, `No handler registered for step type: ${stepConfig.stepType}`);
      throw new Error(`No handler for step type ${stepConfig.stepType}`);
    }

    try {
      const result = await this.retryExecutor.execute(
        () => handler.execute({ executionId, stepIndex, stepConfig }),
        stepConfig,
      );

      await this.db
        .update(stepExecutions)
        .set({ status: 'completed', outputData: result.outputData ?? {}, completedAt: new Date() })
        .where(eq(stepExecutions.id, stepExec.id));

      // Review gate: pause the execution for human review
      if (stepConfig.requiresReview) {
        await this.db
          .update(pipelineExecutions)
          .set({ status: 'waiting_review' })
          .where(eq(pipelineExecutions.id, executionId));
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      await this.markStepFailed(stepExec.id, message);
      throw err;
    }
  }

  private async markStepFailed(stepExecId: string, message: string): Promise<void> {
    await this.db
      .update(stepExecutions)
      .set({ status: 'failed', errorMessage: message, completedAt: new Date() })
      .where(eq(stepExecutions.id, stepExecId));
  }
}
```

**Files**:
- `src/pipelines/engine/step-runner.ts` (new, ~85 lines)

**Validation**:
- [ ] Steps with `status: 'completed'` are skipped on resumption (idempotent recovery)
- [ ] Step with `requiresReview: true` sets execution status to `waiting_review` after completing
- [ ] Missing handler throws and marks the step as `failed`
- [ ] `tsc --noEmit` passes

**Edge Cases**:
- `onConflictDoUpdate` on `(executionId, stepIndex)` requires a unique index on those two columns. Verify this index exists in the `stepExecutions` schema from WP01, or add it.

---

### T020: Implement retry policy with exponential backoff (`src/pipelines/engine/retry.ts`)

**Purpose**: Wrap step handler execution with configurable retry logic — exponential backoff with jitter, max attempts, and transient vs non-transient error classification.

**Steps**:
1. Create `src/pipelines/engine/retry.ts`
2. Define `RetryExecutor` class with `execute(fn, stepConfig)` method
3. On failure: check if error is transient, apply exponential backoff with jitter, retry up to `maxAttempts`
4. Non-transient errors (e.g., 4xx HTTP, validation failure) are re-thrown immediately without retry

```typescript
// src/pipelines/engine/retry.ts
import { DEFAULT_RETRY_POLICY } from '../types';
import type { RetryPolicy, StepConfig } from '../types';

export class NonTransientError extends Error {
  constructor(message: string, public readonly cause?: unknown) {
    super(message);
    this.name = 'NonTransientError';
  }
}

export function isTransientError(err: unknown): boolean {
  if (err instanceof NonTransientError) return false;
  if (err instanceof Error) {
    // Network errors, DB connection errors, timeouts = transient
    const msg = err.message.toLowerCase();
    return (
      msg.includes('econnrefused') ||
      msg.includes('etimedout') ||
      msg.includes('connection') ||
      msg.includes('timeout') ||
      msg.includes('temporarily unavailable')
    );
  }
  return true; // Unknown errors: assume transient for safety
}

function computeDelay(attempt: number, policy: RetryPolicy): number {
  const base = policy.initialDelayMs * Math.pow(policy.backoffMultiplier, attempt - 1);
  const jitter = Math.random() * base * 0.2;  // ±20% jitter
  return Math.min(base + jitter, policy.maxDelayMs);
}

export class RetryExecutor {
  async execute<T>(
    fn: () => Promise<T>,
    stepConfig: StepConfig,
    policyOverride?: RetryPolicy,
  ): Promise<T> {
    const policy: RetryPolicy = policyOverride ?? DEFAULT_RETRY_POLICY;
    let lastError: unknown;

    for (let attempt = 1; attempt <= policy.maxAttempts; attempt++) {
      try {
        return await fn();
      } catch (err) {
        lastError = err;

        if (!isTransientError(err)) {
          throw err;  // Non-transient: fail immediately
        }

        if (attempt === policy.maxAttempts) break;

        const delay = computeDelay(attempt, policy);
        console.warn(
          `[Retry] Step '${stepConfig.name}' attempt ${attempt}/${policy.maxAttempts} failed. Retrying in ${Math.round(delay)}ms.`,
        );
        await new Promise((r) => setTimeout(r, delay));
      }
    }

    throw lastError;
  }
}
```

**Files**:
- `src/pipelines/engine/retry.ts` (new, ~55 lines)

**Validation**:
- [ ] `NonTransientError` thrown by a handler causes immediate failure without retry
- [ ] Transient error retries up to `maxAttempts` with increasing delays
- [ ] Delay never exceeds `maxDelayMs`
- [ ] `tsc --noEmit` passes

**Edge Cases**:
- Jitter prevents thundering herd when many pipelines fail simultaneously and retry at the same time. The 20% range is a reasonable default.
- In tests, set `initialDelayMs: 0` in the retry policy to avoid real `setTimeout` delays.

---

### T021: Implement idempotency key generation and dedup checking (`src/pipelines/engine/idempotency.ts`)

**Purpose**: Prevent duplicate executions when the same trigger event is received multiple times (at-least-once delivery from the event bus, or duplicate manual trigger requests).

**Steps**:
1. Create `src/pipelines/engine/idempotency.ts`
2. `generateIdempotencyKey(pipelineId, triggerType, payload)` — deterministic hash of the inputs
3. `isDuplicateExecution(db, key)` — check if a non-failed execution already exists for this key

```typescript
// src/pipelines/engine/idempotency.ts
import { createHash } from 'crypto';
import { eq, and, inArray } from 'drizzle-orm';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { pipelineExecutions } from '../schema';

/**
 * Generates a deterministic idempotency key from the trigger context.
 * Same inputs always produce the same key — enables deduplication.
 */
export function generateIdempotencyKey(
  pipelineId: string,
  triggerType: string,
  payload: Record<string, unknown>,
): string {
  // Use a stable subset of payload for the key — avoid timestamps and random IDs
  const stablePayload = {
    pipelineId,
    triggerType,
    sourceId: payload.sourceId,
    // Manual triggers may pass an explicit idempotencyKey in payload
    explicitKey: payload.idempotencyKey,
  };

  return createHash('sha256')
    .update(JSON.stringify(stablePayload))
    .digest('hex')
    .slice(0, 32);  // 32 hex chars = 128 bits — sufficient for uniqueness
}

/**
 * Returns true if a non-failed execution already exists for the given key.
 * Failed executions do not count — they can be retried.
 */
export async function isDuplicateExecution(
  db: NodePgDatabase<Record<string, unknown>>,
  idempotencyKey: string,
): Promise<boolean> {
  const existing = await db
    .select({ id: pipelineExecutions.id })
    .from(pipelineExecutions)
    .where(
      and(
        eq(pipelineExecutions.idempotencyKey, idempotencyKey),
        inArray(pipelineExecutions.status, ['pending', 'running', 'waiting_review', 'completed']),
      ),
    )
    .limit(1);

  return existing.length > 0;
}
```

**Files**:
- `src/pipelines/engine/idempotency.ts` (new, ~45 lines)

**Validation**:
- [ ] Same `pipelineId + triggerType + sourceId` always produces the same key
- [ ] Different `pipelineId` produces a different key
- [ ] `isDuplicateExecution` returns `false` for failed executions (allowing retry)
- [ ] `tsc --noEmit` passes

**Edge Cases**:
- `JSON.stringify` is not guaranteed to produce stable key ordering across Node.js versions. For the `stablePayload` object, the properties are always defined in the same order — this is safe. Do not pass arbitrary `payload` objects directly to `JSON.stringify`.

---

### T022: Create engine barrel export (`src/pipelines/engine/index.ts`)

**Purpose**: Single import point for the engine module.

```typescript
// src/pipelines/engine/index.ts
export { PipelineExecutor } from './executor';
export type { ExecutorOptions } from './executor';
export { StepRunner } from './step-runner';
export { RetryExecutor, NonTransientError, isTransientError } from './retry';
export { generateIdempotencyKey, isDuplicateExecution } from './idempotency';
```

**Files**:
- `src/pipelines/engine/index.ts` (new, ~8 lines)

**Validation**:
- [ ] All exported names are accessible via `import { PipelineExecutor } from '../engine'`
- [ ] `tsc --noEmit` passes

---

### T023: Unit tests for executor, step runner, and retry (`tests/pipelines/engine/`)

**Purpose**: Verify the executor lifecycle, step runner recovery logic, retry backoff, and idempotency deduplication.

**Steps**:
1. Create `tests/pipelines/engine/retry.test.ts` — retry policy tests (no DB needed)
2. Create `tests/pipelines/engine/idempotency.test.ts` — key generation determinism tests
3. Create `tests/pipelines/engine/step-runner.test.ts` — step execution with mock handlers

```typescript
// tests/pipelines/engine/retry.test.ts
import { describe, it, expect, vi } from 'vitest';
import { RetryExecutor, NonTransientError, isTransientError } from '../../../src/pipelines/engine/retry';

const noopStepConfig = { stepType: 'notification', name: 'test', config: {}, requiresReview: false };
const fastPolicy = { maxAttempts: 3, initialDelayMs: 0, backoffMultiplier: 1, maxDelayMs: 0 };

describe('RetryExecutor', () => {
  it('returns result on first success', async () => {
    const executor = new RetryExecutor();
    const fn = vi.fn().mockResolvedValue('ok');
    const result = await executor.execute(fn, noopStepConfig, fastPolicy);
    expect(result).toBe('ok');
    expect(fn).toHaveBeenCalledOnce();
  });

  it('retries on transient error and succeeds', async () => {
    const executor = new RetryExecutor();
    const fn = vi.fn()
      .mockRejectedValueOnce(new Error('connection timeout'))
      .mockResolvedValue('ok');
    const result = await executor.execute(fn, noopStepConfig, fastPolicy);
    expect(result).toBe('ok');
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it('throws immediately on NonTransientError without retry', async () => {
    const executor = new RetryExecutor();
    const fn = vi.fn().mockRejectedValue(new NonTransientError('invalid config'));
    await expect(executor.execute(fn, noopStepConfig, fastPolicy)).rejects.toThrow('invalid config');
    expect(fn).toHaveBeenCalledOnce();
  });

  it('throws after exhausting max attempts', async () => {
    const executor = new RetryExecutor();
    const fn = vi.fn().mockRejectedValue(new Error('etimedout'));
    await expect(executor.execute(fn, noopStepConfig, fastPolicy)).rejects.toThrow('etimedout');
    expect(fn).toHaveBeenCalledTimes(3);
  });
});

describe('isTransientError', () => {
  it('returns false for NonTransientError', () => {
    expect(isTransientError(new NonTransientError('bad input'))).toBe(false);
  });

  it('returns true for connection errors', () => {
    expect(isTransientError(new Error('ECONNREFUSED'))).toBe(true);
  });
});
```

**Files**:
- `tests/pipelines/engine/retry.test.ts` (new, ~50 lines)
- `tests/pipelines/engine/idempotency.test.ts` (new, ~25 lines)
- `tests/pipelines/engine/step-runner.test.ts` (new, ~40 lines)

**Validation**:
- [ ] `npm test tests/pipelines/engine/` exits 0
- [ ] Retry tests use `initialDelayMs: 0` to avoid slow tests
- [ ] Idempotency test: same inputs → same key, different pipelineId → different key

**Edge Cases**:
- Step runner tests require a mock `StepHandlerRegistry` and a test DB. Use `InMemoryEventBus` pattern from WP02 as a guide for creating a mock registry.

---

## Definition of Done

- [ ] `src/pipelines/engine/executor.ts` — poll loop, event handling, concurrency policy
- [ ] `src/pipelines/engine/step-runner.ts` — step sequencing, review gate pause, recovery
- [ ] `src/pipelines/engine/retry.ts` — exponential backoff, transient/non-transient classification
- [ ] `src/pipelines/engine/idempotency.ts` — key generation, dedup check
- [ ] `src/pipelines/engine/index.ts` — barrel export
- [ ] Tests passing: retry (success, transient, non-transient, exhausted), idempotency (determinism), step runner (sequence, skip completed, review pause)
- [ ] `npm run typecheck` exits 0
- [ ] `npm test` exits 0 with no regressions

## Risks

- **Poll loop and event handler race**: If a `handleEvent` call and `resumePendingExecutions` both pick up the same execution simultaneously, the same execution could run twice. Mitigation: use `activeExecutions` set as an in-process lock, and use the DB concurrency policy check as the authoritative gate.
- **Graceful shutdown timing**: `stop()` waits up to 30s for in-flight executions. If a step is blocked on a slow external service, the process will hang. Consider adding a per-execution timeout.
- **Step `onConflictDoUpdate`**: The insert in `StepRunner` uses conflict resolution on `(executionId, stepIndex)`. This requires a unique constraint in the schema. Verify WP01 includes this index, or add it as part of this WP.

## Reviewer Guidance

- Verify the concurrency policy check (`checkConcurrencyPolicy`) is done inside a DB transaction or with `FOR UPDATE SKIP LOCKED` to prevent TOCTOU races under concurrent requests. The current implementation uses a read-then-write pattern which is vulnerable to race conditions.
- Check that `runExecution` always sets `completedAt` in both the success and failure paths — analytics (WP09) depend on this field being populated.
- Confirm `resumePendingExecutions` is bounded by `LIMIT 20` to avoid a single poll cycle trying to resume thousands of executions at startup.
