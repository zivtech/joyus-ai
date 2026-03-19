/**
 * Unit tests for createContentAuditPipeline factory.
 *
 * Tests the internal function logic by extracting the handler fn from the
 * Inngest function object (Inngest stores the handler as `.fn` — internal
 * SDK detail used here for unit testing only).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createContentAuditPipeline } from './content-audit-pipeline.js';
import type { InngestStep } from '../adapter.js';
import type { PipelineStepHandler, ExecutionContext, StepHandlerRegistry } from '../../pipelines/engine/step-runner.js';
import type { StepResult } from '../../pipelines/types.js';

// ---------------------------------------------------------------------------
// Helpers (mirrors adapter.test.ts pattern)
// ---------------------------------------------------------------------------

type StepWithWait = InngestStep & {
  waitForEvent: ReturnType<typeof vi.fn>;
};

function makeStep(waitForEventResult: unknown = { data: { decision: 'approved' } }): StepWithWait {
  return {
    run: vi.fn((_name: string, fn: () => Promise<unknown>) => fn()),
    waitForEvent: vi.fn().mockResolvedValue(waitForEventResult),
  } as unknown as StepWithWait;
}

function makeHandler(result: StepResult): PipelineStepHandler {
  return {
    stepType: 'fidelity_check',
    execute: vi.fn().mockResolvedValue(result),
  };
}

function makeRegistry(handlers: Partial<Record<string, PipelineStepHandler>> = {}): StepHandlerRegistry {
  return {
    getHandler: vi.fn((stepType: string) => handlers[stepType]),
  };
}

type InngestFnArg = {
  event: unknown;
  step: StepWithWait;
};

function extractFn(pipeline: ReturnType<typeof createContentAuditPipeline>) {
  return (pipeline as unknown as { fn: (args: InngestFnArg) => Promise<unknown> }).fn;
}

const baseEvent = {
  data: {
    tenantId: 'tenant-1',
    pipelineId: 'content-audit',
    scheduledAt: new Date().toISOString(),
  },
};

// ---------------------------------------------------------------------------
// Construction tests
// ---------------------------------------------------------------------------

describe('createContentAuditPipeline — construction', () => {
  it('can be created with an empty registry without throwing', () => {
    expect(() => createContentAuditPipeline(makeRegistry())).not.toThrow();
  });

  it('returns an object (Inngest function)', () => {
    const fn = createContentAuditPipeline(makeRegistry());
    expect(fn).toBeDefined();
    expect(typeof fn).toBe('object');
  });

  it('has correct concurrency config: tenantId key, limit 1', () => {
    const fn = createContentAuditPipeline(makeRegistry()) as unknown as {
      opts?: { concurrency?: { key: string; limit: number } };
    };
    expect(fn.opts?.concurrency?.key).toBe('event.data.tenantId');
    expect(fn.opts?.concurrency?.limit).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// Stub path — no handlers registered
// ---------------------------------------------------------------------------

describe('createContentAuditPipeline — stub path (no handlers)', () => {
  it('all steps return isNoOp: true when registry is empty', async () => {
    const fn = extractFn(createContentAuditPipeline(makeRegistry()));
    const step = makeStep({ data: { decision: 'approved' } });

    const result = await fn({ event: baseEvent, step }) as {
      status: string;
      executionId: string;
      steps: {
        fidelityCheck: { success: boolean; isNoOp: boolean };
        contentGeneration: { success: boolean; isNoOp: boolean };
        notification: { success: boolean; isNoOp: boolean } | null;
      };
    };

    expect(result.status).toBe('completed');
    expect(typeof result.executionId).toBe('string');
    expect(result.executionId.length).toBeGreaterThan(0);

    expect(result.steps.fidelityCheck.success).toBe(true);
    expect(result.steps.fidelityCheck.isNoOp).toBe(true);

    expect(result.steps.contentGeneration.success).toBe(true);
    expect(result.steps.contentGeneration.isNoOp).toBe(true);

    expect(result.steps.notification).not.toBeNull();
    expect(result.steps.notification!.success).toBe(true);
    expect(result.steps.notification!.isNoOp).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Handler path — handlers registered
// ---------------------------------------------------------------------------

describe('createContentAuditPipeline — handler path', () => {
  const fidelityResult: StepResult = { success: true, outputData: { score: 0.92 } };
  const contentGenResult: StepResult = { success: true, outputData: { digest: 'audit-v1' } };
  const notificationResult: StepResult = { success: true, outputData: { sent: true } };

  let registry: StepHandlerRegistry;

  beforeEach(() => {
    registry = makeRegistry({
      fidelity_check: makeHandler(fidelityResult),
      content_generation: makeHandler(contentGenResult),
      notification: makeHandler(notificationResult),
    });
  });

  it('calls all three handlers and returns their results', async () => {
    const fn = extractFn(createContentAuditPipeline(registry));
    const step = makeStep({ data: { decision: 'approved' } });

    const result = await fn({ event: baseEvent, step }) as {
      status: string;
      steps: {
        fidelityCheck: { success: boolean; outputData?: Record<string, unknown> };
        contentGeneration: { success: boolean; outputData?: Record<string, unknown> };
        notification: { success: boolean; outputData?: Record<string, unknown> } | null;
      };
    };

    expect(result.status).toBe('completed');
    expect(result.steps.fidelityCheck.success).toBe(true);
    expect(result.steps.fidelityCheck.outputData).toEqual({ score: 0.92 });
    expect(result.steps.contentGeneration.success).toBe(true);
    expect(result.steps.contentGeneration.outputData).toEqual({ digest: 'audit-v1' });
    expect(result.steps.notification).not.toBeNull();
    expect(result.steps.notification!.success).toBe(true);
    expect(result.steps.notification!.outputData).toEqual({ sent: true });
  });

  it('calls fidelity_check handler with correct config', async () => {
    const fidelityHandler: PipelineStepHandler = {
      stepType: 'fidelity_check',
      execute: vi.fn().mockResolvedValue(fidelityResult),
    };
    const reg = makeRegistry({
      fidelity_check: fidelityHandler,
      content_generation: makeHandler(contentGenResult),
      notification: makeHandler(notificationResult),
    });

    const fn = extractFn(createContentAuditPipeline(reg));
    const step = makeStep({ data: { decision: 'approved' } });

    await fn({ event: baseEvent, step });

    const execute = fidelityHandler.execute as ReturnType<typeof vi.fn>;
    expect(execute).toHaveBeenCalledOnce();
    const [config] = execute.mock.calls[0] as [Record<string, unknown>, ExecutionContext];
    expect(config.type).toBe('fidelity_check');
  });
});

// ---------------------------------------------------------------------------
// Review gate branches
// ---------------------------------------------------------------------------

describe('createContentAuditPipeline — review gate', () => {
  it('approved: notification step executes and status is completed', async () => {
    const notificationHandler = makeHandler({ success: true, outputData: { sent: true } });
    const registry = makeRegistry({
      notification: notificationHandler,
    });

    const fn = extractFn(createContentAuditPipeline(registry));
    const step = makeStep({ data: { decision: 'approved' } });

    const result = await fn({ event: baseEvent, step }) as { status: string };

    expect(result.status).toBe('completed');
    expect((notificationHandler.execute as ReturnType<typeof vi.fn>)).toHaveBeenCalledOnce();
  });

  it('rejected: returns status rejected without running notification', async () => {
    const notificationHandler = makeHandler({ success: true });
    const registry = makeRegistry({ notification: notificationHandler });

    const fn = extractFn(createContentAuditPipeline(registry));
    const step = makeStep({ data: { decision: 'rejected' } });

    const result = await fn({ event: baseEvent, step }) as {
      status: string;
      steps: { notification: unknown };
    };

    expect(result.status).toBe('rejected');
    expect(result.steps.notification).toBeNull();
    expect((notificationHandler.execute as ReturnType<typeof vi.fn>)).not.toHaveBeenCalled();
  });

  it('timeout (null result): returns status timed_out without running notification', async () => {
    const notificationHandler = makeHandler({ success: true });
    const registry = makeRegistry({ notification: notificationHandler });

    const fn = extractFn(createContentAuditPipeline(registry));
    const step = makeStep(null);

    const result = await fn({ event: baseEvent, step }) as {
      status: string;
      steps: { notification: unknown };
    };

    expect(result.status).toBe('timed_out');
    expect(result.steps.notification).toBeNull();
    expect((notificationHandler.execute as ReturnType<typeof vi.fn>)).not.toHaveBeenCalled();
  });

  it('step.waitForEvent called with 72h timeout', async () => {
    const fn = extractFn(createContentAuditPipeline(makeRegistry()));
    const step = makeStep({ data: { decision: 'approved' } });

    await fn({ event: baseEvent, step });

    expect(step.waitForEvent).toHaveBeenCalledOnce();
    const [, opts] = step.waitForEvent.mock.calls[0] as [string, { timeout: string; event: string }];
    expect(opts.timeout).toBe('72h');
    expect(opts.event).toBe('pipeline/review.decided');
  });

  it('generates a unique executionId per invocation', async () => {
    const fn = extractFn(createContentAuditPipeline(makeRegistry()));

    const r1 = await fn({ event: baseEvent, step: makeStep({ data: { decision: 'approved' } }) }) as { executionId: string };
    const r2 = await fn({ event: baseEvent, step: makeStep({ data: { decision: 'approved' } }) }) as { executionId: string };

    expect(r1.executionId).not.toBe(r2.executionId);
  });
});
