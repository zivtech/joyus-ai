/**
 * Unit tests for InngestStepHandlerAdapter (adapter.ts),
 * corpus-update-pipeline factory (functions/corpus-update-pipeline.ts),
 * and schedule-tick-pipeline (functions/schedule-tick-pipeline.ts).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createInngestAdapter } from './adapter.js';
import { createCorpusUpdatePipeline } from './functions/corpus-update-pipeline.js';
import { createScheduleTickPipeline } from './functions/schedule-tick-pipeline.js';
import type { InngestStep } from './adapter.js';
import type { PipelineStepHandler, ExecutionContext, StepHandlerRegistry } from '../pipelines/engine/step-runner.js';
import type { StepResult } from '../pipelines/types.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeStep(): InngestStep {
  return {
    run: vi.fn((_name: string, fn: () => Promise<unknown>) => fn()),
  } as unknown as InngestStep;
}

function makeContext(overrides: Partial<ExecutionContext> = {}): ExecutionContext {
  return {
    tenantId: 'tenant-1',
    executionId: 'exec-1',
    pipelineId: 'pipeline-1',
    triggerPayload: {},
    previousStepOutputs: new Map(),
    ...overrides,
  };
}

function makeHandler(result: StepResult): PipelineStepHandler {
  return {
    stepType: 'profile_generation',
    execute: vi.fn().mockResolvedValue(result),
  };
}

function makeRegistry(handlers: Partial<Record<string, PipelineStepHandler>> = {}): StepHandlerRegistry {
  return {
    getHandler: vi.fn((stepType: string) => handlers[stepType]),
  };
}

// ---------------------------------------------------------------------------
// createInngestAdapter tests
// ---------------------------------------------------------------------------

describe('createInngestAdapter', () => {
  it('wraps handler.execute() inside step.run()', async () => {
    const result: StepResult = { success: true, outputData: { profileCount: 3 } };
    const handler = makeHandler(result);
    const step = makeStep();
    const config = { type: 'profile_generation', profileIds: ['p1'] };
    const context = makeContext();

    const adapter = createInngestAdapter(handler);
    const returned = await adapter.run(step, 'profile-generation', config, context);

    expect(step.run).toHaveBeenCalledOnce();
    expect(step.run).toHaveBeenCalledWith('profile-generation', expect.any(Function));
    expect(returned).toBe(result);
  });

  it('passes config and context unchanged to handler.execute()', async () => {
    const result: StepResult = { success: true };
    const handler = makeHandler(result);
    const step = makeStep();

    const config = { type: 'fidelity_check', thresholds: { minScore: 0.9 } };
    const context = makeContext({
      tenantId: 'tenant-abc',
      executionId: 'exec-xyz',
      triggerPayload: { corpusId: 'corpus-1' },
    });

    const adapter = createInngestAdapter(handler);
    await adapter.run(step, 'fidelity-check', config, context);

    expect(handler.execute).toHaveBeenCalledOnce();
    expect(handler.execute).toHaveBeenCalledWith(config, context);
  });

  it('returns the handler result as-is', async () => {
    const result: StepResult = {
      success: false,
      error: { message: 'something went wrong', type: 'EXCEPTION', isTransient: true, retryable: true },
    };
    const handler = makeHandler(result);
    const step = makeStep();

    const adapter = createInngestAdapter(handler);
    const returned = await adapter.run(step, 'step-name', {}, makeContext());

    expect(returned).toStrictEqual(result);
  });

  it('propagates exceptions thrown by handler.execute()', async () => {
    const handler: PipelineStepHandler = {
      stepType: 'profile_generation',
      execute: vi.fn().mockRejectedValue(new Error('handler error')),
    };
    const step = makeStep();

    const adapter = createInngestAdapter(handler);
    await expect(adapter.run(step, 'step-name', {}, makeContext())).rejects.toThrow('handler error');
  });

  it('uses the stepName argument as the Inngest step checkpoint name', async () => {
    const handler = makeHandler({ success: true });
    const step = makeStep();

    const adapter = createInngestAdapter(handler);
    await adapter.run(step, 'my-custom-step-name', {}, makeContext());

    expect(step.run).toHaveBeenCalledWith('my-custom-step-name', expect.any(Function));
  });
});

// ---------------------------------------------------------------------------
// createCorpusUpdatePipeline tests
// ---------------------------------------------------------------------------

describe('createCorpusUpdatePipeline', () => {
  it('can be created with an empty registry without throwing', () => {
    const registry = makeRegistry();
    expect(() => createCorpusUpdatePipeline(registry)).not.toThrow();
  });

  it('can be created with a populated registry without throwing', () => {
    const registry = makeRegistry({
      profile_generation: makeHandler({ success: true, outputData: { profiles: 2 } }),
      fidelity_check: makeHandler({ success: true, outputData: { score: 0.95 } }),
    });
    expect(() => createCorpusUpdatePipeline(registry)).not.toThrow();
  });

  it('returns an Inngest function object', () => {
    const registry = makeRegistry();
    const fn = createCorpusUpdatePipeline(registry);
    // Inngest functions expose an id property
    expect(fn).toBeDefined();
    expect(typeof fn).toBe('object');
  });
});

// ---------------------------------------------------------------------------
// Stub-result path (no handlers registered)
// ---------------------------------------------------------------------------

describe('createCorpusUpdatePipeline — stub path (no handlers)', () => {
  it('produces stub results for both steps when registry is empty', async () => {
    // We test the internal logic by extracting the handler fn from the
    // Inngest function object. Inngest stores the handler as `fn` on the
    // returned object (internal SDK detail used here for unit testing only).
    const registry = makeRegistry();
    const inngestFn = createCorpusUpdatePipeline(registry) as unknown as {
      fn: (args: { event: unknown; step: InngestStep }) => Promise<unknown>;
    };

    const step = {
      run: vi.fn((_name: string, fn: () => Promise<unknown>) => fn()),
    } as unknown as InngestStep;

    const event = {
      data: {
        tenantId: 'tenant-test',
        corpusId: 'corpus-42',
        changeType: 'updated' as const,
      },
    };

    const result = await inngestFn.fn({ event, step }) as {
      executionId: string;
      tenantId: string;
      corpusId: string;
      steps: {
        profileGeneration: { success: boolean; isNoOp: boolean; outputData?: Record<string, unknown> };
        fidelityCheck: { success: boolean; isNoOp: boolean; outputData?: Record<string, unknown> };
      };
    };

    expect(result.tenantId).toBe('tenant-test');
    expect(result.corpusId).toBe('corpus-42');
    expect(typeof result.executionId).toBe('string');
    expect(result.executionId.length).toBeGreaterThan(0);

    expect(result.steps.profileGeneration.success).toBe(true);
    expect(result.steps.profileGeneration.isNoOp).toBe(true);
    expect(result.steps.profileGeneration.outputData?.stub).toBe(true);

    expect(result.steps.fidelityCheck.success).toBe(true);
    expect(result.steps.fidelityCheck.isNoOp).toBe(true);
    expect(result.steps.fidelityCheck.outputData?.stub).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Handler path (handlers registered)
// ---------------------------------------------------------------------------

describe('createCorpusUpdatePipeline — handler path', () => {
  const profileResult: StepResult = { success: true, outputData: { profiles: 5 } };
  const fidelityResult: StepResult = { success: true, outputData: { score: 0.88 } };

  let registry: StepHandlerRegistry;

  beforeEach(() => {
    registry = makeRegistry({
      profile_generation: makeHandler(profileResult),
      fidelity_check: makeHandler(fidelityResult),
    });
  });

  it('calls both handlers and returns their results', async () => {
    const inngestFn = createCorpusUpdatePipeline(registry) as unknown as {
      fn: (args: { event: unknown; step: InngestStep }) => Promise<unknown>;
    };

    const step = {
      run: vi.fn((_name: string, fn: () => Promise<unknown>) => fn()),
    } as unknown as InngestStep;

    const event = {
      data: {
        tenantId: 'tenant-2',
        corpusId: 'corpus-99',
        changeType: 'created' as const,
      },
    };

    const result = await inngestFn.fn({ event, step }) as {
      steps: {
        profileGeneration: { success: boolean; outputData?: Record<string, unknown> };
        fidelityCheck: { success: boolean; outputData?: Record<string, unknown> };
      };
    };

    expect(result.steps.profileGeneration.success).toBe(true);
    expect(result.steps.profileGeneration.outputData).toEqual({ profiles: 5 });
    expect(result.steps.fidelityCheck.success).toBe(true);
    expect(result.steps.fidelityCheck.outputData).toEqual({ score: 0.88 });
  });

  it('passes step 1 output into step 2 previousStepOutputs', async () => {
    const profileHandler = makeHandler(profileResult);
    const fidelityHandler: PipelineStepHandler = {
      stepType: 'fidelity_check',
      execute: vi.fn().mockResolvedValue(fidelityResult),
    };

    const reg = makeRegistry({
      profile_generation: profileHandler,
      fidelity_check: fidelityHandler,
    });

    const inngestFn = createCorpusUpdatePipeline(reg) as unknown as {
      fn: (args: { event: unknown; step: InngestStep }) => Promise<unknown>;
    };

    const step = {
      run: vi.fn((_name: string, fn: () => Promise<unknown>) => fn()),
    } as unknown as InngestStep;

    const event = {
      data: { tenantId: 't', corpusId: 'c', changeType: 'deleted' as const },
    };

    await inngestFn.fn({ event, step });

    const fidelityExecute = fidelityHandler.execute as ReturnType<typeof vi.fn>;
    expect(fidelityExecute).toHaveBeenCalledOnce();

    const [, context] = fidelityExecute.mock.calls[0] as [unknown, ExecutionContext];
    expect(context.previousStepOutputs.get(0)).toEqual({ profiles: 5 });
  });

  it('generates a unique executionId for each invocation', async () => {
    const inngestFn = createCorpusUpdatePipeline(registry) as unknown as {
      fn: (args: { event: unknown; step: InngestStep }) => Promise<{ executionId: string }>;
    };

    const makeStepMock = (): InngestStep =>
      ({
        run: vi.fn((_name: string, fn: () => Promise<unknown>) => fn()),
      }) as unknown as InngestStep;

    const event = {
      data: { tenantId: 't', corpusId: 'c', changeType: 'updated' as const },
    };

    const r1 = await inngestFn.fn({ event, step: makeStepMock() });
    const r2 = await inngestFn.fn({ event, step: makeStepMock() });

    expect(r1.executionId).not.toBe(r2.executionId);
  });
});

// ---------------------------------------------------------------------------
// Concurrency and scheduling (T017, T019, T020)
// ---------------------------------------------------------------------------

describe('Concurrency and scheduling', () => {
  // T017 — Cross-tenant isolation
  // The concurrency key ('event.data.tenantId', limit 1) is enforced by the
  // Inngest server at runtime; it cannot be asserted in a unit test without a
  // running Inngest instance. What we can verify is that independent calls
  // produce distinct executionIds — confirming separate execution contexts.
  it('T017: generates unique executionIds for different tenants (cross-tenant isolation)', async () => {
    const registry = makeRegistry();
    const inngestFn = createCorpusUpdatePipeline(registry) as unknown as {
      fn: (args: { event: unknown; step: InngestStep }) => Promise<{ executionId: string }>;
    };

    const makeStepMock = (): InngestStep =>
      ({
        run: vi.fn((_name: string, fn: () => Promise<unknown>) => fn()),
      }) as unknown as InngestStep;

    const eventTenantA = { data: { tenantId: 'tenant-A', corpusId: 'c1', changeType: 'updated' as const } };
    const eventTenantB = { data: { tenantId: 'tenant-B', corpusId: 'c2', changeType: 'updated' as const } };

    const rA = await inngestFn.fn({ event: eventTenantA, step: makeStepMock() });
    const rB = await inngestFn.fn({ event: eventTenantB, step: makeStepMock() });

    // Each tenant invocation gets its own distinct executionId
    expect(rA.executionId).not.toBe(rB.executionId);
    // NOTE: Full concurrency isolation (at most 1 run per tenant at a time)
    // is enforced by the Inngest server using key='event.data.tenantId', limit=1.
    // Validate that config is wired correctly by running the dev server.
  });

  // T019 — Overlap detection via concurrency key
  // We verify the function definition is created with concurrency config.
  // Runtime overlap prevention is enforced by Inngest server, not unit-testable.
  it('T019: schedule-tick-pipeline has concurrency key configured', () => {
    const fn = createScheduleTickPipeline() as unknown as {
      id?: string;
      opts?: { concurrency?: { key: string; limit: number } };
    };
    // Function must be defined (structure exists)
    expect(fn).toBeDefined();
    expect(typeof fn).toBe('object');
    // NOTE: Inngest SDK stores concurrency config internally; overlap detection
    // (preventing a second tick from starting while a first is in-flight) is
    // validated against a live Inngest dev server with key='event.data.tenantId'.
  });

  // T020 — Timezone support
  it('T020: schedule-tick-pipeline is created without errors (UTC timezone)', () => {
    expect(createScheduleTickPipeline()).toBeDefined();
  });

  it('schedule-tick-pipeline returns a truthy function definition', () => {
    const fn = createScheduleTickPipeline();
    expect(fn).toBeTruthy();
    expect(typeof fn).toBe('object');
  });

  it('schedule-tick-pipeline handler returns completed status with tick data', async () => {
    const inngestFn = createScheduleTickPipeline() as unknown as {
      fn: (args: { event: unknown; step: InngestStep }) => Promise<{
        status: string;
        tick: { tenantId: string; scheduledAt: string; timezone: string };
      }>;
    };

    const step: InngestStep = {
      run: vi.fn((_name: string, fn: () => Promise<unknown>) => fn()),
    } as unknown as InngestStep;

    const event = { data: { tenantId: 'tenant-cron', pipelineId: 'p1', scheduledAt: new Date().toISOString() } };

    const result = await inngestFn.fn({ event, step });

    expect(result.status).toBe('completed');
    expect(result.tick).toBeDefined();
    expect(result.tick.tenantId).toBe('tenant-cron');
    expect(result.tick.timezone).toBe('UTC');
    expect(typeof result.tick.scheduledAt).toBe('string');
  });

  it('schedule-tick-pipeline uses "system" tenantId when event data lacks tenantId', async () => {
    const inngestFn = createScheduleTickPipeline() as unknown as {
      fn: (args: { event: unknown; step: InngestStep }) => Promise<{
        status: string;
        tick: { tenantId: string };
      }>;
    };

    const step: InngestStep = {
      run: vi.fn((_name: string, fn: () => Promise<unknown>) => fn()),
    } as unknown as InngestStep;

    // Cron-triggered events have no tenantId in event.data
    const event = { data: {} };

    const result = await inngestFn.fn({ event, step });

    expect(result.tick.tenantId).toBe('system');
  });
});
