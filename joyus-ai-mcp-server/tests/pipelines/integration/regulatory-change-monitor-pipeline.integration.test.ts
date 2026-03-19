/**
 * Integration tests — regulatory-change-monitor-pipeline with review gate (T016)
 *
 * Verifies approval, rejection, and timeout paths through the 48h review gate.
 * Key distinction from content-audit: this pipeline uses a 48h timeout (not 72h).
 *
 * No live Inngest server required: the Inngest function's internal `fn`
 * handler is extracted and called directly with mocked `step` and event objects.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createRegulatoryChangeMonitorPipeline } from '../../../src/inngest/functions/regulatory-change-monitor-pipeline.js';
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
      pipelineId: 'regulatory-monitor-pipeline',
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

describe('regulatory-change-monitor-pipeline integration', () => {
  let notificationHandler: PipelineStepHandler;

  beforeEach(() => {
    notificationHandler = makeHandler('notification');
  });

  it('full approval path — all 4 steps execute, result is completed', async () => {
    const step = makeStep({ data: { decision: 'approved' } });
    const registry = makeRegistry({ notification: notificationHandler });

    const fn = createRegulatoryChangeMonitorPipeline(registry) as unknown as FnWrapper;
    const result = (await fn.fn({ event: makeEvent(), step })) as { status: string };

    expect(result.status).toBe('completed');
    expect(notificationHandler.execute).toHaveBeenCalledOnce();
  });

  it('rejection path — notification NOT called, result is rejected', async () => {
    const step = makeStep({ data: { decision: 'rejected' } });
    const registry = makeRegistry({ notification: notificationHandler });

    const fn = createRegulatoryChangeMonitorPipeline(registry) as unknown as FnWrapper;
    const result = (await fn.fn({ event: makeEvent(), step })) as { status: string };

    expect(result.status).toBe('rejected');
    expect(notificationHandler.execute).not.toHaveBeenCalled();
  });

  it('timeout path — waitForEvent returns null, notification NOT called, result is timed_out', async () => {
    const step = makeStep(null);
    const registry = makeRegistry({ notification: notificationHandler });

    const fn = createRegulatoryChangeMonitorPipeline(registry) as unknown as FnWrapper;
    const result = (await fn.fn({ event: makeEvent(), step })) as { status: string };

    expect(result.status).toBe('timed_out');
    expect(notificationHandler.execute).not.toHaveBeenCalled();
  });

  it('step.waitForEvent called with timeout of 48h (not 72h)', async () => {
    const step = makeStep({ data: { decision: 'approved' } });
    const registry = makeRegistry();

    const fn = createRegulatoryChangeMonitorPipeline(registry) as unknown as FnWrapper;
    await fn.fn({ event: makeEvent(), step });

    expect(step.waitForEvent).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ timeout: '48h' }),
    );
  });

  it('source_query step called with correct config type', async () => {
    const sourceQueryHandler: PipelineStepHandler = {
      stepType: 'source_query',
      execute: vi.fn().mockResolvedValue({ success: true, outputData: { items: [], total: 0 } }),
    };

    const step = makeStep({ data: { decision: 'approved' } });
    const registry = makeRegistry({ source_query: sourceQueryHandler });

    const fn = createRegulatoryChangeMonitorPipeline(registry) as unknown as FnWrapper;
    await fn.fn({ event: makeEvent(), step });

    expect(sourceQueryHandler.execute).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'source_query' }),
      expect.any(Object),
    );
  });
});
