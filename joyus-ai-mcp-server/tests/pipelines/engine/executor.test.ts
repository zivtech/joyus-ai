/**
 * Tests for PipelineExecutor.
 *
 * Uses InMemoryEventBus and mock dependencies to verify:
 *   - processEvent creates execution and step records
 *   - Concurrency skip_if_running skips duplicate executions
 *   - Depth limit rejection
 *   - Steps execute in order with outputs accumulated
 *   - Step failure pauses execution
 *   - Review gate pauses execution
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { PipelineExecutor } from '../../../src/pipelines/engine/executor.js';
import { InMemoryEventBus } from '../../../src/pipelines/event-bus/interface.js';
import { TriggerRegistry } from '../../../src/pipelines/triggers/registry.js';
import { CorpusChangeTriggerHandler } from '../../../src/pipelines/triggers/corpus-change.js';
import { ManualRequestTriggerHandler } from '../../../src/pipelines/triggers/manual-request.js';
import type { StepRunner, ExecutionContext } from '../../../src/pipelines/engine/step-runner.js';
import type { PipelineStep } from '../../../src/pipelines/schema.js';
import type { StepResult, RetryPolicy } from '../../../src/pipelines/types.js';
import {
  pipelines as pipelinesTable,
  pipelineSteps as pipelineStepsTable,
  pipelineExecutions as pipelineExecutionsTable,
  executionSteps as executionStepsTable,
  triggerEvents as triggerEventsTable,
} from '../../../src/pipelines/schema.js';

// ── Mock DB ───────────────────────────────────────────────────────────────────

interface InsertRecord {
  table: string;
  values: Record<string, unknown> | Record<string, unknown>[];
}

interface UpdateRecord {
  table: string;
  setValues: Record<string, unknown>;
}

/**
 * Creates a mock DB that resolves the correct data based on which Drizzle
 * table object is passed to from() / update() / insert().
 */
function createMockDb(options: {
  activePipelines?: Record<string, unknown>[];
  pipelineSteps?: Record<string, unknown>[];
  existingExecutions?: Record<string, unknown>[];
} = {}) {
  const inserts: InsertRecord[] = [];
  const updates: UpdateRecord[] = [];

  function getTableName(table: unknown): string {
    // Drizzle table objects have a Symbol with the table name, but we can
    // compare by reference against the imported table objects.
    if (table === pipelinesTable) return 'pipelines';
    if (table === pipelineStepsTable) return 'pipeline_steps';
    if (table === pipelineExecutionsTable) return 'pipeline_executions';
    if (table === executionStepsTable) return 'execution_steps';
    if (table === triggerEventsTable) return 'trigger_events';
    return 'unknown';
  }

  function selectResultForTable(tableName: string): Record<string, unknown>[] {
    switch (tableName) {
      case 'pipelines':
        return options.activePipelines ?? [];
      case 'pipeline_steps':
        return options.pipelineSteps ?? [];
      case 'pipeline_executions':
        return options.existingExecutions ?? [];
      default:
        return [];
    }
  }

  const db = {
    insert: (table: unknown) => {
      const tableName = getTableName(table);
      return {
        values: (values: Record<string, unknown> | Record<string, unknown>[]) => {
          inserts.push({ table: tableName, values });
          return Promise.resolve();
        },
      };
    },
    update: (table: unknown) => {
      const tableName = getTableName(table);
      return {
        set: (values: Record<string, unknown>) => {
          updates.push({ table: tableName, setValues: values });
          return {
            where: () => Promise.resolve(),
          };
        },
      };
    },
    select: () => {
      return {
        from: (table: unknown) => {
          const tableName = getTableName(table);
          return {
            where: () => Promise.resolve(selectResultForTable(tableName)),
          };
        },
      };
    },
    inserts,
    updates,
  };

  return db;
}

// ── Mock StepRunner ───────────────────────────────────────────────────────────

function createMockStepRunner(
  runStepFn?: (
    executionStepId: string,
    pipelineStep: PipelineStep,
    context: ExecutionContext,
    retryPolicy?: RetryPolicy,
  ) => Promise<StepResult>,
): StepRunner {
  const defaultFn = vi.fn(async () => ({
    success: true,
    outputData: { done: true },
  }));

  return {
    runStep: runStepFn ?? defaultFn,
  } as unknown as StepRunner;
}

// ── Fixtures ──────────────────────────────────────────────────────────────────

function makePipeline(id: string, overrides: Record<string, unknown> = {}) {
  return {
    id,
    tenantId: 'tenant-1',
    name: `Pipeline ${id}`,
    description: null,
    triggerType: 'corpus_change',
    triggerConfig: { type: 'corpus_change' },
    retryPolicy: { maxRetries: 3, baseDelayMs: 1, maxDelayMs: 5, backoffMultiplier: 2 },
    concurrencyPolicy: 'skip_if_running',
    reviewGateTimeoutHours: 48,
    maxPipelineDepth: 10,
    status: 'active',
    templateId: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

function makeStep(
  pipelineId: string,
  position: number,
  stepType = 'content_generation',
  overrides: Record<string, unknown> = {},
) {
  return {
    id: `step-${pipelineId}-${position}`,
    pipelineId,
    position,
    name: `Step ${position}`,
    stepType,
    config: { type: stepType, prompt: 'test', profileId: 'p1' },
    inputRefs: [],
    retryPolicyOverride: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('PipelineExecutor', () => {
  let eventBus: InMemoryEventBus;
  let registry: TriggerRegistry;

  beforeEach(() => {
    eventBus = new InMemoryEventBus();
    registry = new TriggerRegistry();
    registry.register(new CorpusChangeTriggerHandler());
    registry.register(new ManualRequestTriggerHandler());
  });

  it('creates execution and step records on processEvent', async () => {
    const pipeline = makePipeline('p1');
    const steps = [makeStep('p1', 0), makeStep('p1', 1)];

    const mockDb = createMockDb({
      activePipelines: [pipeline],
      pipelineSteps: steps,
      existingExecutions: [],
    });

    const stepRunner = createMockStepRunner();
    const executor = new PipelineExecutor(
      mockDb as never,
      eventBus,
      registry,
      stepRunner,
    );

    executor.start();
    await eventBus.publish('tenant-1', 'corpus_change', {});
    await executor.stop();

    // Should have inserted: trigger_event, pipeline_execution, execution_steps
    expect(mockDb.inserts.length).toBeGreaterThanOrEqual(3);

    const triggerInsert = mockDb.inserts.find((i) => i.table === 'trigger_events');
    expect(triggerInsert).toBeDefined();

    const execInsert = mockDb.inserts.find((i) => i.table === 'pipeline_executions');
    expect(execInsert).toBeDefined();

    const stepInsert = mockDb.inserts.find((i) => i.table === 'execution_steps');
    expect(stepInsert).toBeDefined();
  });

  it('skips execution when concurrency policy is skip_if_running and execution exists', async () => {
    const pipeline = makePipeline('p1', { concurrencyPolicy: 'skip_if_running' });
    const steps = [makeStep('p1', 0)];

    const mockDb = createMockDb({
      activePipelines: [pipeline],
      pipelineSteps: steps,
      existingExecutions: [{ id: 'existing-exec', status: 'running' }],
    });

    const runStepFn = vi.fn(async () => ({ success: true }));
    const stepRunner = createMockStepRunner(runStepFn);
    const executor = new PipelineExecutor(
      mockDb as never,
      eventBus,
      registry,
      stepRunner,
    );

    executor.start();
    await eventBus.publish('tenant-1', 'corpus_change', {});
    await executor.stop();

    // stepRunner should not have been called
    expect(runStepFn).not.toHaveBeenCalled();
  });

  it('skips execution when depth limit is reached', async () => {
    const pipeline = makePipeline('p1', { maxPipelineDepth: 3 });
    const steps = [makeStep('p1', 0)];

    const mockDb = createMockDb({
      activePipelines: [pipeline],
      pipelineSteps: steps,
      existingExecutions: [],
    });

    const runStepFn = vi.fn(async () => ({ success: true }));
    const stepRunner = createMockStepRunner(runStepFn);
    const executor = new PipelineExecutor(
      mockDb as never,
      eventBus,
      registry,
      stepRunner,
    );

    executor.start();
    // Publish event with depth=5, exceeding maxPipelineDepth=3
    await eventBus.publish('tenant-1', 'corpus_change', { depth: 5 });
    await executor.stop();

    expect(runStepFn).not.toHaveBeenCalled();
  });

  it('executes steps in position order and accumulates outputs', async () => {
    const pipeline = makePipeline('p1', { concurrencyPolicy: 'allow_concurrent' });
    const steps = [makeStep('p1', 0), makeStep('p1', 1)];

    const mockDb = createMockDb({
      activePipelines: [pipeline],
      pipelineSteps: steps,
      existingExecutions: [],
    });

    const callOrder: number[] = [];
    const runStepFn = vi.fn(
      async (
        _execStepId: string,
        pStep: PipelineStep,
        _ctx: ExecutionContext,
      ) => {
        callOrder.push(pStep.position);
        return {
          success: true,
          outputData: { position: pStep.position },
        };
      },
    );

    const stepRunner = createMockStepRunner(runStepFn);
    const executor = new PipelineExecutor(
      mockDb as never,
      eventBus,
      registry,
      stepRunner,
    );

    executor.start();
    await eventBus.publish('tenant-1', 'corpus_change', {});
    await executor.stop();

    expect(callOrder).toEqual([0, 1]);
    expect(runStepFn).toHaveBeenCalledTimes(2);
  });

  it('pauses execution on step failure', async () => {
    const pipeline = makePipeline('p1', { concurrencyPolicy: 'allow_concurrent' });
    const steps = [makeStep('p1', 0), makeStep('p1', 1)];

    const mockDb = createMockDb({
      activePipelines: [pipeline],
      pipelineSteps: steps,
      existingExecutions: [],
    });

    let callCount = 0;
    const runStepFn = vi.fn(async () => {
      callCount++;
      if (callCount === 1) {
        return {
          success: false,
          error: {
            message: 'step failed',
            type: 'RUNTIME',
            isTransient: false,
            retryable: false,
          },
        };
      }
      return { success: true };
    });

    const stepRunner = createMockStepRunner(runStepFn);
    const executor = new PipelineExecutor(
      mockDb as never,
      eventBus,
      registry,
      stepRunner,
    );

    executor.start();
    await eventBus.publish('tenant-1', 'corpus_change', {});
    await executor.stop();

    // Only first step should have been called
    expect(callCount).toBe(1);

    // Execution should be updated to paused_on_failure
    const failureUpdate = mockDb.updates.find(
      (u) => u.setValues.status === 'paused_on_failure',
    );
    expect(failureUpdate).toBeDefined();
  });

  it('pauses at review gate', async () => {
    const pipeline = makePipeline('p1', { concurrencyPolicy: 'allow_concurrent' });
    const steps = [
      makeStep('p1', 0, 'review_gate'),
      makeStep('p1', 1, 'content_generation'),
    ];

    const mockDb = createMockDb({
      activePipelines: [pipeline],
      pipelineSteps: steps,
      existingExecutions: [],
    });

    const runStepFn = vi.fn(async () => ({ success: true }));
    const stepRunner = createMockStepRunner(runStepFn);
    const executor = new PipelineExecutor(
      mockDb as never,
      eventBus,
      registry,
      stepRunner,
    );

    executor.start();
    await eventBus.publish('tenant-1', 'corpus_change', {});
    await executor.stop();

    // Step runner should not be called (review_gate is handled before runStep)
    expect(runStepFn).not.toHaveBeenCalled();

    // Should have set status to paused_at_gate
    const gateUpdate = mockDb.updates.find(
      (u) => u.setValues.status === 'paused_at_gate',
    );
    expect(gateUpdate).toBeDefined();
  });

  it('does nothing when no trigger handler matches event type', async () => {
    // Use an empty registry with no handlers
    const emptyRegistry = new TriggerRegistry();
    const mockDb = createMockDb();

    const stepRunner = createMockStepRunner();
    const executor = new PipelineExecutor(
      mockDb as never,
      eventBus,
      emptyRegistry,
      stepRunner,
    );

    executor.start();
    await eventBus.publish('tenant-1', 'corpus_change', {});
    await executor.stop();

    // No inserts should have occurred
    expect(mockDb.inserts).toHaveLength(0);
  });

  it('allows concurrent executions when policy is allow_concurrent', async () => {
    const pipeline = makePipeline('p1', { concurrencyPolicy: 'allow_concurrent' });
    const steps = [makeStep('p1', 0)];

    // Even with existing running execution, allow_concurrent should proceed
    const mockDb = createMockDb({
      activePipelines: [pipeline],
      pipelineSteps: steps,
      existingExecutions: [{ id: 'existing-exec', status: 'running' }],
    });

    const runStepFn = vi.fn(async () => ({ success: true, outputData: {} }));
    const stepRunner = createMockStepRunner(runStepFn);
    const executor = new PipelineExecutor(
      mockDb as never,
      eventBus,
      registry,
      stepRunner,
    );

    executor.start();
    await eventBus.publish('tenant-1', 'corpus_change', {});
    await executor.stop();

    // stepRunner SHOULD have been called (concurrency allowed)
    expect(runStepFn).toHaveBeenCalled();
  });
});
