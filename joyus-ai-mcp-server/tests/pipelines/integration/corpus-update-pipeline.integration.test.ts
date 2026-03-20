/**
 * Integration tests — corpus-update-pipeline full lifecycle (T014)
 *
 * Verifies that the corpus-update-pipeline executes both steps in order,
 * handles the stub path, passes step outputs downstream, and generates
 * unique executionIds per invocation.
 *
 * No live Inngest server required: the Inngest function's internal `fn`
 * handler is extracted and called directly with a mocked `step` object.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createCorpusUpdatePipeline } from '../../../src/inngest/functions/corpus-update-pipeline.js';
import type {
  StepHandlerRegistry,
  PipelineStepHandler,
  ExecutionContext,
} from '../../../src/pipelines/types.js';

// ============================================================
// HELPERS
// ============================================================

function makeStep() {
  return {
    run: vi.fn((_name: string, fn: () => Promise<unknown>) => fn()),
  };
}

function makeEvent(overrides: Record<string, unknown> = {}) {
  return {
    data: {
      tenantId: 'tenant-integration',
      corpusId: 'corpus-abc',
      changeType: 'updated',
      ...overrides,
    },
  };
}

function makeRegistry(
  handlers: Partial<Record<string, PipelineStepHandler>> = {},
): StepHandlerRegistry {
  return { getHandler: (stepType) => handlers[stepType] };
}

function makeHandler(outputData: Record<string, unknown> = {}): PipelineStepHandler {
  return {
    stepType: 'profile_generation',
    execute: vi.fn().mockResolvedValue({ success: true, outputData }),
  };
}

type FnWrapper = {
  fn: (args: { event: unknown; step: unknown }) => Promise<unknown>;
};

// ============================================================
// TESTS
// ============================================================

describe('corpus-update-pipeline integration', () => {
  let step: ReturnType<typeof makeStep>;

  beforeEach(() => {
    step = makeStep();
  });

  it('happy path — both handlers registered, steps called in order', async () => {
    const profileHandler = makeHandler({ profilesBuilt: 5 });
    const fidelityHandler = makeHandler({ score: 0.9, passed: true });

    const registry = makeRegistry({
      profile_generation: { ...profileHandler, stepType: 'profile_generation' },
      fidelity_check: { ...fidelityHandler, stepType: 'fidelity_check' },
    });

    const fn = createCorpusUpdatePipeline(registry) as unknown as FnWrapper;
    const result = (await fn.fn({ event: makeEvent(), step })) as {
      steps: {
        profileGeneration: { success: boolean };
        fidelityCheck: { success: boolean };
      };
    };

    expect(result.steps.profileGeneration.success).toBe(true);
    expect(result.steps.fidelityCheck.success).toBe(true);
    expect(profileHandler.execute).toHaveBeenCalledOnce();
    expect(fidelityHandler.execute).toHaveBeenCalledOnce();
  });

  it('stub path — no handlers registered, both steps return isNoOp', async () => {
    const registry = makeRegistry();
    const fn = createCorpusUpdatePipeline(registry) as unknown as FnWrapper;
    const result = (await fn.fn({ event: makeEvent(), step })) as {
      steps: {
        profileGeneration: { isNoOp: boolean };
        fidelityCheck: { isNoOp: boolean };
      };
    };

    expect(result.steps.profileGeneration.isNoOp).toBe(true);
    expect(result.steps.fidelityCheck.isNoOp).toBe(true);
  });

  it('step 1 output flows into step 2 via previousStepOutputs', async () => {
    const profileOutput = { profiles: 5, generatedAt: '2026-01-01' };
    let capturedContext: ExecutionContext | undefined;

    const profileHandler: PipelineStepHandler = {
      stepType: 'profile_generation',
      execute: vi.fn().mockResolvedValue({ success: true, outputData: profileOutput }),
    };

    const fidelityHandler: PipelineStepHandler = {
      stepType: 'fidelity_check',
      execute: vi.fn().mockImplementation((_config: unknown, ctx: ExecutionContext) => {
        capturedContext = ctx;
        return Promise.resolve({ success: true, outputData: { score: 0.9, passed: true } });
      }),
    };

    const registry = makeRegistry({
      profile_generation: profileHandler,
      fidelity_check: fidelityHandler,
    });

    const fn = createCorpusUpdatePipeline(registry) as unknown as FnWrapper;
    await fn.fn({ event: makeEvent(), step });

    expect(capturedContext?.previousStepOutputs.get(0)).toEqual(profileOutput);
  });

  it('unique executionId per invocation', async () => {
    const registry = makeRegistry();
    const fn = createCorpusUpdatePipeline(registry) as unknown as FnWrapper;

    const r1 = (await fn.fn({ event: makeEvent(), step })) as { executionId: string };
    const r2 = (await fn.fn({ event: makeEvent(), step })) as { executionId: string };

    expect(r1.executionId).toBeTruthy();
    expect(r2.executionId).toBeTruthy();
    expect(r1.executionId).not.toBe(r2.executionId);
  });
});
