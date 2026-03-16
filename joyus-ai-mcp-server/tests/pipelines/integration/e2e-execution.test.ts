/**
 * Integration tests — End-to-End Pipeline Execution (T055)
 *
 * Tests full execution lifecycle using InMemoryEventBus + mock DB + mock step
 * handlers. Verifies module interactions: executor → step-runner → event-bus.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { PipelineExecutor } from '../../../src/pipelines/engine/executor.js';
import { InMemoryEventBus } from '../../../src/pipelines/event-bus/interface.js';
import { TriggerRegistry } from '../../../src/pipelines/triggers/registry.js';
import { CorpusChangeTriggerHandler } from '../../../src/pipelines/triggers/corpus-change.js';
import { StepRunner } from '../../../src/pipelines/engine/step-runner.js';
import type {
  ExecutionContext,
  StepHandlerRegistry,
  PipelineStepHandler,
} from '../../../src/pipelines/engine/step-runner.js';
import type { PipelineStep } from '../../../src/pipelines/schema.js';
import type { StepResult, RetryPolicy, StepType } from '../../../src/pipelines/types.js';
import {
  pipelines as pipelinesTable,
  pipelineSteps as pipelineStepsTable,
  pipelineExecutions as pipelineExecutionsTable,
  executionSteps as executionStepsTable,
  triggerEvents as triggerEventsTable,
} from '../../../src/pipelines/schema.js';

// ── Fixtures ──────────────────────────────────────────────────────────────────

function makePipeline(id: string, overrides: Record<string, unknown> = {}) {
  return {
    id,
    tenantId: 'tenant-alpha',
    name: `Pipeline ${id}`,
    description: null,
    triggerType: 'corpus_change',
    triggerConfig: { type: 'corpus_change' },
    retryPolicy: { maxRetries: 3, baseDelayMs: 1, maxDelayMs: 5, backoffMultiplier: 2 },
    concurrencyPolicy: 'allow_concurrent',
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
  stepType: StepType = 'source_query',
  overrides: Record<string, unknown> = {},
) {
  return {
    id: `step-${pipelineId}-${position}`,
    pipelineId,
    position,
    name: `Step ${position}`,
    stepType,
    config: { type: stepType },
    inputRefs: [],
    retryPolicyOverride: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

// ── Mock DB ───────────────────────────────────────────────────────────────────

function getTableName(table: unknown): string {
  if (table === pipelinesTable) return 'pipelines';
  if (table === pipelineStepsTable) return 'pipeline_steps';
  if (table === pipelineExecutionsTable) return 'pipeline_executions';
  if (table === executionStepsTable) return 'execution_steps';
  if (table === triggerEventsTable) return 'trigger_events';
  return 'unknown';
}

interface DbInsert { table: string; values: unknown }
interface DbUpdate { table: string; setValues: Record<string, unknown> }

function createMockDb(options: {
  activePipelines?: Record<string, unknown>[];
  pipelineSteps?: Record<string, unknown>[];
  existingExecutions?: Record<string, unknown>[];
} = {}) {
  const inserts: DbInsert[] = [];
  const updates: DbUpdate[] = [];

  const db = {
    insert: (table: unknown) => ({
      values: (values: unknown) => {
        inserts.push({ table: getTableName(table), values });
        return Promise.resolve();
      },
    }),
    update: (table: unknown) => ({
      set: (values: Record<string, unknown>) => {
        updates.push({ table: getTableName(table), setValues: values });
        return { where: () => Promise.resolve() };
      },
    }),
    select: () => ({
      from: (table: unknown) => ({
        where: () => {
          const name = getTableName(table);
          if (name === 'pipelines') return Promise.resolve(options.activePipelines ?? []);
          if (name === 'pipeline_steps') return Promise.resolve(options.pipelineSteps ?? []);
          if (name === 'pipeline_executions') return Promise.resolve(options.existingExecutions ?? []);
          return Promise.resolve([]);
        },
      }),
    }),
    inserts,
    updates,
  };

  return db;
}

// ── Mock Step Handler ─────────────────────────────────────────────────────────

function createMockHandler(
  stepType: StepType,
  executeFn: () => Promise<StepResult>,
): PipelineStepHandler {
  return { stepType, execute: executeFn } as unknown as PipelineStepHandler;
}

function createMockRegistry(handlers: PipelineStepHandler[]): StepHandlerRegistry {
  const map = new Map(handlers.map((h) => [h.stepType, h]));
  return { getHandler: (t) => map.get(t) };
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function buildExecutor(
  db: ReturnType<typeof createMockDb>,
  handlers: PipelineStepHandler[],
  eventBus: InMemoryEventBus,
  registry: TriggerRegistry,
): PipelineExecutor {
  const stepRegistry = createMockRegistry(handlers);
  const stepRunner = new StepRunner(db as never, stepRegistry);
  return new PipelineExecutor(db as never, eventBus, registry, stepRunner);
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('E2E Pipeline Execution', () => {
  let eventBus: InMemoryEventBus;
  let triggerRegistry: TriggerRegistry;

  beforeEach(() => {
    eventBus = new InMemoryEventBus();
    triggerRegistry = new TriggerRegistry();
    triggerRegistry.register(new CorpusChangeTriggerHandler());
  });

  it('T055-1: event-triggered execution runs 3 steps in order and completes', async () => {
    const pipeline = makePipeline('p1');
    const steps = [
      makeStep('p1', 0, 'source_query'),
      makeStep('p1', 1, 'profile_generation'),
      makeStep('p1', 2, 'notification'),
    ];
    const db = createMockDb({ activePipelines: [pipeline], pipelineSteps: steps });

    const callOrder: StepType[] = [];
    const handlers: PipelineStepHandler[] = [
      createMockHandler('source_query', async () => {
        callOrder.push('source_query');
        return { success: true, outputData: { sources: [] } };
      }),
      createMockHandler('profile_generation', async () => {
        callOrder.push('profile_generation');
        return { success: true, outputData: { profileId: 'p1' } };
      }),
      createMockHandler('notification', async () => {
        callOrder.push('notification');
        return { success: true, outputData: { sent: true } };
      }),
    ];

    const executor = buildExecutor(db, handlers, eventBus, triggerRegistry);
    executor.start();
    await eventBus.publish('tenant-alpha', 'corpus_change', {});
    await executor.stop();

    // trigger_event was persisted
    expect(db.inserts.some((i) => i.table === 'trigger_events')).toBe(true);
    // execution was created
    expect(db.inserts.some((i) => i.table === 'pipeline_executions')).toBe(true);
    // execution steps were created (batch insert)
    expect(db.inserts.some((i) => i.table === 'execution_steps')).toBe(true);
    // all 3 steps ran in order
    expect(callOrder).toEqual(['source_query', 'profile_generation', 'notification']);
    // execution completed
    const completedUpdate = db.updates.find(
      (u) => u.table === 'pipeline_executions' && u.setValues.status === 'completed',
    );
    expect(completedUpdate).toBeDefined();
  });

  it('T055-2: no-op step — first step returns isNoOp, pipeline still completes', async () => {
    const pipeline = makePipeline('p2');
    const steps = [makeStep('p2', 0, 'source_query'), makeStep('p2', 1, 'notification')];
    const db = createMockDb({ activePipelines: [pipeline], pipelineSteps: steps });

    let notificationCalled = false;
    const handlers: PipelineStepHandler[] = [
      createMockHandler('source_query', async () => ({ success: true, isNoOp: true })),
      createMockHandler('notification', async () => {
        notificationCalled = true;
        return { success: true };
      }),
    ];

    const executor = buildExecutor(db, handlers, eventBus, triggerRegistry);
    executor.start();
    await eventBus.publish('tenant-alpha', 'corpus_change', {});
    await executor.stop();

    expect(notificationCalled).toBe(true);
    const completedUpdate = db.updates.find(
      (u) => u.table === 'pipeline_executions' && u.setValues.status === 'completed',
    );
    expect(completedUpdate).toBeDefined();
  });

  it('T055-3: multiple pipelines for same tenant both triggered', async () => {
    const pipeline1 = makePipeline('pa');
    const pipeline2 = makePipeline('pb');
    const steps1 = [makeStep('pa', 0, 'notification')];
    const steps2 = [makeStep('pb', 0, 'notification')];
    const db = createMockDb({
      activePipelines: [pipeline1, pipeline2],
      pipelineSteps: [...steps1, ...steps2],
    });

    const callsByPipeline: string[] = [];
    const handlers: PipelineStepHandler[] = [
      createMockHandler('notification', async (_cfg, ctx) => {
        callsByPipeline.push(ctx.pipelineId);
        return { success: true };
      }),
    ];

    const executor = buildExecutor(db, handlers, eventBus, triggerRegistry);
    executor.start();
    await eventBus.publish('tenant-alpha', 'corpus_change', {});
    await executor.stop();

    expect(callsByPipeline).toHaveLength(2);
    expect(callsByPipeline).toContain('pa');
    expect(callsByPipeline).toContain('pb');
  });

  it('T055-4: step 2 fails transiently once then succeeds — attempts=2, pipeline completes', async () => {
    const pipeline = makePipeline('p4');
    const steps = [makeStep('p4', 0, 'source_query'), makeStep('p4', 1, 'notification')];
    const db = createMockDb({ activePipelines: [pipeline], pipelineSteps: steps });

    let notificationAttempts = 0;
    const handlers: PipelineStepHandler[] = [
      createMockHandler('source_query', async () => ({ success: true })),
      createMockHandler('notification', async () => {
        notificationAttempts++;
        if (notificationAttempts === 1) {
          return {
            success: false,
            error: { message: 'transient', type: 'TIMEOUT', isTransient: true, retryable: true },
          };
        }
        return { success: true, outputData: { sent: true } };
      }),
    ];

    const executor = buildExecutor(db, handlers, eventBus, triggerRegistry);
    executor.start();
    await eventBus.publish('tenant-alpha', 'corpus_change', {});
    await executor.stop();

    expect(notificationAttempts).toBe(2);
    const completedUpdate = db.updates.find(
      (u) => u.table === 'pipeline_executions' && u.setValues.status === 'completed',
    );
    expect(completedUpdate).toBeDefined();
  });

  it('T055-5: exhausted retries (maxRetries=0) — execution paused_on_failure, remaining steps not run', async () => {
    const pipeline = makePipeline('p5', {
      retryPolicy: { maxRetries: 0, baseDelayMs: 1, maxDelayMs: 5, backoffMultiplier: 2 },
    });
    const steps = [makeStep('p5', 0, 'source_query'), makeStep('p5', 1, 'notification')];
    const db = createMockDb({ activePipelines: [pipeline], pipelineSteps: steps });

    let notificationCalled = false;
    const handlers: PipelineStepHandler[] = [
      createMockHandler('source_query', async () => ({
        success: false,
        error: { message: 'fatal', type: 'FATAL', isTransient: false, retryable: false },
      })),
      createMockHandler('notification', async () => {
        notificationCalled = true;
        return { success: true };
      }),
    ];

    const executor = buildExecutor(db, handlers, eventBus, triggerRegistry);
    executor.start();
    await eventBus.publish('tenant-alpha', 'corpus_change', {});
    await executor.stop();

    expect(notificationCalled).toBe(false);
    const failureUpdate = db.updates.find(
      (u) => u.table === 'pipeline_executions' && u.setValues.status === 'paused_on_failure',
    );
    expect(failureUpdate).toBeDefined();
  });
});
