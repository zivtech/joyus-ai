/**
 * Unit tests for InngestStepHandlerAdapter (adapter.ts) and
 * corpus-update-pipeline factory (functions/corpus-update-pipeline.ts).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createInngestAdapter } from './adapter.js';
import { createCorpusUpdatePipeline } from './functions/corpus-update-pipeline.js';
import type { InngestStep } from './adapter.js';
import type { PipelineStepHandler, ExecutionContext, StepHandlerRegistry } from '../pipelines/engine/step-runner.js';
import type { StepResult } from '../pipelines/types.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeStep(): InngestStep {
  return {
    run: vi.fn((_name: string, fn: () => Promise<unknown>) => fn()),
    waitForEvent: vi.fn().mockResolvedValue(null),
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
      waitForEvent: vi.fn().mockResolvedValue({ data: { executionId: 'exec-stub', decision: 'approved' } }),
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
      waitForEvent: vi.fn().mockResolvedValue({ data: { executionId: 'exec-1', decision: 'approved' } }),
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
      waitForEvent: vi.fn().mockResolvedValue({ data: { executionId: 'exec-2', decision: 'approved' } }),
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
        waitForEvent: vi.fn().mockResolvedValue({ data: { executionId: 'x', decision: 'approved' } }),
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
// Review gate paths (T013-T015)
// ---------------------------------------------------------------------------

describe('createCorpusUpdatePipeline — review gate paths', () => {
  const event = {
    data: {
      tenantId: 'tenant-review',
      corpusId: 'corpus-rg',
      changeType: 'updated' as const,
    },
  };

  interface InngestStepWithWaitForEvent extends InngestStep {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    waitForEvent: ReturnType<typeof vi.fn>;
  }

  function makeReviewStep(waitForEventReturnValue: unknown): InngestStepWithWaitForEvent {
    return {
      run: vi.fn((_name: string, fn: () => Promise<unknown>) => fn()),
      waitForEvent: vi.fn().mockResolvedValue(waitForEventReturnValue),
    } as unknown as InngestStepWithWaitForEvent;
  }

  it('T013: returns approved status when reviewer approves', async () => {
    const registry = makeRegistry();
    const inngestFn = createCorpusUpdatePipeline(registry) as unknown as {
      fn: (args: { event: unknown; step: InngestStep }) => Promise<Record<string, unknown>>;
    };

    const step = makeReviewStep({
      data: { executionId: 'exec-approve', decision: 'approved' },
    });

    const result = await inngestFn.fn({ event, step });

    expect(result.status).toBe('approved');
    expect(result.artifactsApproved).toBe(true);
    expect(step.waitForEvent).toHaveBeenCalledOnce();
    expect(step.waitForEvent).toHaveBeenCalledWith('wait-for-review', expect.objectContaining({
      event: 'pipeline/review.decided',
      timeout: '7d',
    }));
  });

  it('T014: returns rejected status with feedback when reviewer rejects', async () => {
    const registry = makeRegistry();
    const inngestFn = createCorpusUpdatePipeline(registry) as unknown as {
      fn: (args: { event: unknown; step: InngestStep }) => Promise<Record<string, unknown>>;
    };

    const step = makeReviewStep({
      data: { executionId: 'exec-reject', decision: 'rejected', feedback: 'Needs revision' },
    });

    const result = await inngestFn.fn({ event, step });

    expect(result.status).toBe('rejected');
    expect(result.feedback).toBe('Needs revision');
  });

  it('T015: returns timeout status with escalated flag when waitForEvent returns null', async () => {
    const registry = makeRegistry();
    const inngestFn = createCorpusUpdatePipeline(registry) as unknown as {
      fn: (args: { event: unknown; step: InngestStep }) => Promise<Record<string, unknown>>;
    };

    const step = makeReviewStep(null);

    const result = await inngestFn.fn({ event, step });

    expect(result.status).toBe('timeout');
    expect(result.escalated).toBe(true);
  });
});
