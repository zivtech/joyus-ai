/**
 * Unit tests for createRegulatoryChangeMonitorPipeline factory.
 *
 * Tests the internal function logic by extracting the handler fn from the
 * Inngest function object (Inngest stores the handler as `.fn` — internal
 * SDK detail used here for unit testing only).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createRegulatoryChangeMonitorPipeline } from './regulatory-change-monitor-pipeline.js';
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
    stepType: 'source_query',
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

function extractFn(pipeline: ReturnType<typeof createRegulatoryChangeMonitorPipeline>) {
  return (pipeline as unknown as { fn: (args: InngestFnArg) => Promise<unknown> }).fn;
}

const baseEvent = {
  data: {
    tenantId: 'tenant-1',
    pipelineId: 'regulatory-change-monitor',
    scheduledAt: new Date().toISOString(),
  },
};

// ---------------------------------------------------------------------------
// Construction tests
// ---------------------------------------------------------------------------

describe('createRegulatoryChangeMonitorPipeline — construction', () => {
  it('can be created with an empty registry without throwing', () => {
    expect(() => createRegulatoryChangeMonitorPipeline(makeRegistry())).not.toThrow();
  });

  it('returns an object (Inngest function)', () => {
    const fn = createRegulatoryChangeMonitorPipeline(makeRegistry());
    expect(fn).toBeDefined();
    expect(typeof fn).toBe('object');
  });

  it('has correct concurrency config: tenantId key, limit 1', () => {
    const fn = createRegulatoryChangeMonitorPipeline(makeRegistry()) as unknown as {
      opts?: { concurrency?: { key: string; limit: number } };
    };
    expect(fn.opts?.concurrency?.key).toBe('event.data.tenantId');
    expect(fn.opts?.concurrency?.limit).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// Stub path — no handlers registered
// ---------------------------------------------------------------------------

describe('createRegulatoryChangeMonitorPipeline — stub path (no handlers)', () => {
  it('all steps return isNoOp: true when registry is empty', async () => {
    const fn = extractFn(createRegulatoryChangeMonitorPipeline(makeRegistry()));
    const step = makeStep({ data: { decision: 'approved' } });

    const result = await fn({ event: baseEvent, step }) as {
      status: string;
      executionId: string;
      steps: {
        sourceQuery: { success: boolean; isNoOp: boolean };
        contentGeneration: { success: boolean; isNoOp: boolean };
        notification: { success: boolean; isNoOp: boolean } | null;
      };
    };

    expect(result.status).toBe('completed');
    expect(typeof result.executionId).toBe('string');
    expect(result.executionId.length).toBeGreaterThan(0);

    expect(result.steps.sourceQuery.success).toBe(true);
    expect(result.steps.sourceQuery.isNoOp).toBe(true);

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

describe('createRegulatoryChangeMonitorPipeline — handler path', () => {
  const sourceQueryResult: StepResult = { success: true, outputData: { changes: 3 } };
  const contentGenResult: StepResult = { success: true, outputData: { summary: 'reg-summary-v1' } };
  const notificationResult: StepResult = { success: true, outputData: { sent: true } };

  let registry: StepHandlerRegistry;

  beforeEach(() => {
    registry = makeRegistry({
      source_query: makeHandler(sourceQueryResult),
      content_generation: makeHandler(contentGenResult),
      notification: makeHandler(notificationResult),
    });
  });

  it('calls all three handlers and returns their results', async () => {
    const fn = extractFn(createRegulatoryChangeMonitorPipeline(registry));
    const step = makeStep({ data: { decision: 'approved' } });

    const result = await fn({ event: baseEvent, step }) as {
      status: string;
      steps: {
        sourceQuery: { success: boolean; outputData?: Record<string, unknown> };
        contentGeneration: { success: boolean; outputData?: Record<string, unknown> };
        notification: { success: boolean; outputData?: Record<string, unknown> } | null;
      };
    };

    expect(result.status).toBe('completed');
    expect(result.steps.sourceQuery.success).toBe(true);
    expect(result.steps.sourceQuery.outputData).toEqual({ changes: 3 });
    expect(result.steps.contentGeneration.success).toBe(true);
    expect(result.steps.contentGeneration.outputData).toEqual({ summary: 'reg-summary-v1' });
    expect(result.steps.notification).not.toBeNull();
    expect(result.steps.notification!.success).toBe(true);
    expect(result.steps.notification!.outputData).toEqual({ sent: true });
  });

  it('calls source_query handler with correct config', async () => {
    const sourceQueryHandler: PipelineStepHandler = {
      stepType: 'source_query',
      execute: vi.fn().mockResolvedValue(sourceQueryResult),
    };
    const reg = makeRegistry({
      source_query: sourceQueryHandler,
      content_generation: makeHandler(contentGenResult),
      notification: makeHandler(notificationResult),
    });

    const fn = extractFn(createRegulatoryChangeMonitorPipeline(reg));
    const step = makeStep({ data: { decision: 'approved' } });

    await fn({ event: baseEvent, step });

    const execute = sourceQueryHandler.execute as ReturnType<typeof vi.fn>;
    expect(execute).toHaveBeenCalledOnce();
    const [config] = execute.mock.calls[0] as [Record<string, unknown>, ExecutionContext];
    expect(config.type).toBe('source_query');
  });
});

// ---------------------------------------------------------------------------
// Review gate branches
// ---------------------------------------------------------------------------

describe('createRegulatoryChangeMonitorPipeline — review gate', () => {
  it('approved: notification step executes and status is completed', async () => {
    const notificationHandler = makeHandler({ success: true, outputData: { sent: true } });
    const registry = makeRegistry({ notification: notificationHandler });

    const fn = extractFn(createRegulatoryChangeMonitorPipeline(registry));
    const step = makeStep({ data: { decision: 'approved' } });

    const result = await fn({ event: baseEvent, step }) as { status: string };

    expect(result.status).toBe('completed');
    expect((notificationHandler.execute as ReturnType<typeof vi.fn>)).toHaveBeenCalledOnce();
  });

  it('rejected: returns status rejected without running notification', async () => {
    const notificationHandler = makeHandler({ success: true });
    const registry = makeRegistry({ notification: notificationHandler });

    const fn = extractFn(createRegulatoryChangeMonitorPipeline(registry));
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

    const fn = extractFn(createRegulatoryChangeMonitorPipeline(registry));
    const step = makeStep(null);

    const result = await fn({ event: baseEvent, step }) as {
      status: string;
      steps: { notification: unknown };
    };

    expect(result.status).toBe('timed_out');
    expect(result.steps.notification).toBeNull();
    expect((notificationHandler.execute as ReturnType<typeof vi.fn>)).not.toHaveBeenCalled();
  });

  it('step.waitForEvent called with 48h timeout (not 72h)', async () => {
    const fn = extractFn(createRegulatoryChangeMonitorPipeline(makeRegistry()));
    const step = makeStep({ data: { decision: 'approved' } });

    await fn({ event: baseEvent, step });

    expect(step.waitForEvent).toHaveBeenCalledOnce();
    const [, opts] = step.waitForEvent.mock.calls[0] as [string, { timeout: string; event: string }];
    expect(opts.timeout).toBe('48h');
    expect(opts.event).toBe('pipeline/review.decided');
  });

  it('generates a unique executionId per invocation', async () => {
    const fn = extractFn(createRegulatoryChangeMonitorPipeline(makeRegistry()));

    const r1 = await fn({ event: baseEvent, step: makeStep({ data: { decision: 'approved' } }) }) as { executionId: string };
    const r2 = await fn({ event: baseEvent, step: makeStep({ data: { decision: 'approved' } }) }) as { executionId: string };

    expect(r1.executionId).not.toBe(r2.executionId);
  });
});
