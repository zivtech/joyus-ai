/**
 * Integration tests — content-audit-pipeline with review gate (T015)
 *
 * Verifies approval, rejection, and timeout paths through the review gate,
 * and confirms correct concurrency configuration.
 *
 * No live Inngest server required: the Inngest function's internal `fn`
 * handler is extracted and called directly with mocked `step` and event objects.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createContentAuditPipeline } from '../../../src/inngest/functions/content-audit-pipeline.js';
import type {
  StepHandlerRegistry,
  PipelineStepHandler,
} from '../../../src/pipelines/types.js';

// ============================================================
// HELPERS
// ============================================================

function makeStep(waitForEventResult: unknown) {
  return {
    run: vi.fn((_name: string, fn: () => Promise<unknown>) => fn()),
    waitForEvent: vi.fn().mockResolvedValue(waitForEventResult),
  };
}

function makeEvent(overrides: Record<string, unknown> = {}) {
  return {
    data: {
      tenantId: 'tenant-integration',
      pipelineId: 'content-audit-pipeline',
      scheduledAt: new Date().toISOString(),
      ...overrides,
    },
  };
}

function makeRegistry(
  handlers: Partial<Record<string, PipelineStepHandler>> = {},
): StepHandlerRegistry {
  return { getHandler: (stepType) => handlers[stepType] };
}

function makeHandler(stepType: string = 'notification'): PipelineStepHandler {
  return {
    stepType: stepType as PipelineStepHandler['stepType'],
    execute: vi.fn().mockResolvedValue({ success: true, outputData: {} }),
  };
}

type FnWrapper = {
  fn: (args: { event: unknown; step: unknown }) => Promise<unknown>;
  opts?: { concurrency?: { key: string; limit: number } };
};

// ============================================================
// TESTS
// ============================================================

describe('content-audit-pipeline integration', () => {
  let notificationHandler: PipelineStepHandler;

  beforeEach(() => {
    notificationHandler = makeHandler('notification');
  });

  it('full approval path — all 4 steps execute, result is completed', async () => {
    const step = makeStep({ data: { decision: 'approved' } });
    const registry = makeRegistry({ notification: notificationHandler });

    const fn = createContentAuditPipeline(registry) as unknown as FnWrapper;
    const result = (await fn.fn({ event: makeEvent(), step })) as { status: string };

    expect(result.status).toBe('completed');
    expect(notificationHandler.execute).toHaveBeenCalledOnce();
  });

  it('rejection path — notification NOT called, result is rejected', async () => {
    const step = makeStep({ data: { decision: 'rejected' } });
    const registry = makeRegistry({ notification: notificationHandler });

    const fn = createContentAuditPipeline(registry) as unknown as FnWrapper;
    const result = (await fn.fn({ event: makeEvent(), step })) as { status: string };

    expect(result.status).toBe('rejected');
    expect(notificationHandler.execute).not.toHaveBeenCalled();
  });

  it('timeout path — waitForEvent returns null, notification NOT called, result is timed_out', async () => {
    const step = makeStep(null);
    const registry = makeRegistry({ notification: notificationHandler });

    const fn = createContentAuditPipeline(registry) as unknown as FnWrapper;
    const result = (await fn.fn({ event: makeEvent(), step })) as { status: string };

    expect(result.status).toBe('timed_out');
    expect(notificationHandler.execute).not.toHaveBeenCalled();
  });

  it('step.waitForEvent called with timeout of 72h', async () => {
    const step = makeStep({ data: { decision: 'approved' } });
    const registry = makeRegistry();

    const fn = createContentAuditPipeline(registry) as unknown as FnWrapper;
    await fn.fn({ event: makeEvent(), step });

    expect(step.waitForEvent).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ timeout: '72h' }),
    );
  });

  it('concurrency config uses event.data.tenantId with limit 1', () => {
    const fn = createContentAuditPipeline(makeRegistry()) as unknown as FnWrapper;

    expect(fn.opts?.concurrency?.key).toBe('event.data.tenantId');
    expect(fn.opts?.concurrency?.limit).toBe(1);
  });
});
