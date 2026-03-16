/**
 * Tests for StepRunner.
 *
 * Uses mock DB and mock handler registry to verify:
 *   - Successful step execution
 *   - Transient failure with retry succeeds on attempt 2
 *   - Non-transient failure: no retry
 *   - Retries exhausted
 *   - Unknown step type → failure
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { StepRunner } from '../../../src/pipelines/engine/step-runner.js';
import type {
  ExecutionContext,
  PipelineStepHandler,
  StepHandlerRegistry,
} from '../../../src/pipelines/engine/step-runner.js';
import type { PipelineStep } from '../../../src/pipelines/schema.js';
import type { StepResult, RetryPolicy } from '../../../src/pipelines/types.js';

// ── Mock DB ───────────────────────────────────────────────────────────────────

interface MockDbCall {
  operation: 'select' | 'update';
  values?: Record<string, unknown>;
}

function createMockDb() {
  const calls: MockDbCall[] = [];

  // Chain builder that records operations
  const chainable = () => {
    const chain: Record<string, unknown> = {};
    chain.from = () => chain;
    chain.where = () => chain;
    chain.set = (values: Record<string, unknown>) => {
      calls[calls.length - 1].values = values;
      return chain;
    };
    chain.then = (resolve: (val: unknown[]) => void) => resolve([]);
    return chain;
  };

  const db = {
    select: () => {
      calls.push({ operation: 'select' });
      const chain: Record<string, unknown> = {};
      chain.from = () => chain;
      chain.where = () => Promise.resolve([]); // No cached idempotency hits
      return chain;
    },
    update: () => {
      calls.push({ operation: 'update' });
      const chain: Record<string, unknown> = {};
      chain.set = (values: Record<string, unknown>) => {
        calls[calls.length - 1].values = values;
        return chain;
      };
      chain.where = () => Promise.resolve();
      return chain;
    },
    calls,
  };

  return db;
}

// ── Mock Handler Registry ─────────────────────────────────────────────────────

function createMockHandler(
  stepType: string,
  executeFn: (config: Record<string, unknown>, ctx: ExecutionContext) => Promise<StepResult>,
): PipelineStepHandler {
  return {
    stepType: stepType as PipelineStepHandler['stepType'],
    execute: executeFn,
  };
}

function createMockRegistry(
  handlers: PipelineStepHandler[],
): StepHandlerRegistry {
  const map = new Map(handlers.map((h) => [h.stepType, h]));
  return {
    getHandler: (stepType) => map.get(stepType),
  };
}

// ── Fixtures ──────────────────────────────────────────────────────────────────

function makePipelineStep(overrides: Partial<PipelineStep> = {}): PipelineStep {
  return {
    id: 'step-1',
    pipelineId: 'pipeline-1',
    position: 0,
    name: 'Test Step',
    stepType: 'content_generation',
    config: { type: 'content_generation', prompt: 'test', profileId: 'p1' },
    inputRefs: [],
    retryPolicyOverride: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  } as unknown as PipelineStep;
}

function makeContext(): ExecutionContext {
  return {
    tenantId: 'tenant-1',
    executionId: 'exec-1',
    pipelineId: 'pipeline-1',
    triggerPayload: {},
    previousStepOutputs: new Map(),
  };
}

const fastRetryPolicy: RetryPolicy = {
  maxRetries: 2,
  baseDelayMs: 1,    // 1ms for fast tests
  maxDelayMs: 5,
  backoffMultiplier: 2,
};

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('StepRunner', () => {
  let mockDb: ReturnType<typeof createMockDb>;

  beforeEach(() => {
    mockDb = createMockDb();
  });

  it('runs a successful step and returns success', async () => {
    const handler = createMockHandler('content_generation', async () => ({
      success: true,
      outputData: { result: 'generated content' },
    }));
    const registry = createMockRegistry([handler]);
    const runner = new StepRunner(mockDb as never, registry);

    const result = await runner.runStep(
      'exec-step-1',
      makePipelineStep(),
      makeContext(),
      fastRetryPolicy,
    );

    expect(result.success).toBe(true);
    expect(result.outputData).toEqual({ result: 'generated content' });
  });

  it('retries transient failure and succeeds on second attempt', async () => {
    let callCount = 0;
    const handler = createMockHandler('content_generation', async () => {
      callCount++;
      if (callCount === 1) {
        return {
          success: false,
          error: {
            message: 'timeout',
            type: 'TIMEOUT',
            isTransient: true,
            retryable: true,
          },
        };
      }
      return { success: true, outputData: { attempt: callCount } };
    });
    const registry = createMockRegistry([handler]);
    const runner = new StepRunner(mockDb as never, registry);

    const result = await runner.runStep(
      'exec-step-1',
      makePipelineStep(),
      makeContext(),
      fastRetryPolicy,
    );

    expect(result.success).toBe(true);
    expect(callCount).toBe(2);
    expect(result.outputData).toEqual({ attempt: 2 });
  });

  it('does not retry non-transient errors', async () => {
    let callCount = 0;
    const handler = createMockHandler('content_generation', async () => {
      callCount++;
      return {
        success: false,
        error: {
          message: 'invalid config',
          type: 'VALIDATION',
          isTransient: false,
          retryable: false,
        },
      };
    });
    const registry = createMockRegistry([handler]);
    const runner = new StepRunner(mockDb as never, registry);

    const result = await runner.runStep(
      'exec-step-1',
      makePipelineStep(),
      makeContext(),
      fastRetryPolicy,
    );

    expect(result.success).toBe(false);
    expect(callCount).toBe(1);
    expect(result.error?.type).toBe('VALIDATION');
  });

  it('fails after retries are exhausted', async () => {
    let callCount = 0;
    const handler = createMockHandler('content_generation', async () => {
      callCount++;
      return {
        success: false,
        error: {
          message: 'service unavailable',
          type: 'TIMEOUT',
          isTransient: true,
          retryable: true,
        },
      };
    });
    const registry = createMockRegistry([handler]);
    const runner = new StepRunner(mockDb as never, registry);

    const result = await runner.runStep(
      'exec-step-1',
      makePipelineStep(),
      makeContext(),
      fastRetryPolicy,
    );

    expect(result.success).toBe(false);
    // maxRetries=2, so attempts 0, 1, 2 = 3 total calls
    expect(callCount).toBe(3);
    expect(result.error?.type).toBe('TIMEOUT');
  });

  it('returns failure for unknown step type', async () => {
    const registry = createMockRegistry([]); // no handlers
    const runner = new StepRunner(mockDb as never, registry);

    const result = await runner.runStep(
      'exec-step-1',
      makePipelineStep({ stepType: 'notification' as PipelineStep['stepType'] }),
      makeContext(),
      fastRetryPolicy,
    );

    expect(result.success).toBe(false);
    expect(result.error?.type).toBe('HANDLER_NOT_FOUND');
  });

  it('catches exceptions thrown by handler and treats them as transient', async () => {
    let callCount = 0;
    const handler = createMockHandler('content_generation', async () => {
      callCount++;
      if (callCount === 1) {
        throw new Error('network failure');
      }
      return { success: true, outputData: { recovered: true } };
    });
    const registry = createMockRegistry([handler]);
    const runner = new StepRunner(mockDb as never, registry);

    const result = await runner.runStep(
      'exec-step-1',
      makePipelineStep(),
      makeContext(),
      fastRetryPolicy,
    );

    expect(result.success).toBe(true);
    expect(callCount).toBe(2);
  });

  it('uses step-level retry policy override when present', async () => {
    let callCount = 0;
    const handler = createMockHandler('content_generation', async () => {
      callCount++;
      return {
        success: false,
        error: {
          message: 'timeout',
          type: 'TIMEOUT',
          isTransient: true,
          retryable: true,
        },
      };
    });
    const registry = createMockRegistry([handler]);
    const runner = new StepRunner(mockDb as never, registry);

    const stepWithOverride = makePipelineStep({
      retryPolicyOverride: {
        maxRetries: 1,
        baseDelayMs: 1,
        maxDelayMs: 5,
        backoffMultiplier: 2,
      } as unknown as PipelineStep['retryPolicyOverride'],
    });

    const result = await runner.runStep(
      'exec-step-1',
      stepWithOverride,
      makeContext(),
      fastRetryPolicy, // pipeline-level has maxRetries=2, but step override has 1
    );

    expect(result.success).toBe(false);
    // Step override maxRetries=1 → attempts 0, 1 = 2 calls
    expect(callCount).toBe(2);
  });
});
