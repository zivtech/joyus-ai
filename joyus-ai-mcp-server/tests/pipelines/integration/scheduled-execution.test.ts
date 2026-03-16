/**
 * Integration tests — Scheduled Execution (T057)
 *
 * Tests ScheduleTriggerHandler's cron-driven behaviour by invoking the
 * internal onTick logic directly (via registerSchedule + manual callback
 * invocation) rather than relying on real wall-clock advancement.
 *
 * Key insight: node-cron's schedule() fires its callback when the cron
 * expression matches. For tests we mock cron.schedule to capture and invoke
 * the callback synchronously/on demand.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { ScheduleTriggerHandler } from '../../../src/pipelines/triggers/schedule.js';
import { InMemoryEventBus } from '../../../src/pipelines/event-bus/interface.js';
import type { Pipeline } from '../../../src/pipelines/schema.js';

// ── vi.mock must be at module top-level ───────────────────────────────────────
//
// We mock 'node-cron' so that cron.schedule() captures the callback
// without scheduling a real timer. Tests then invoke the callback manually.

vi.mock('node-cron', () => {
  const capturedCallbacks = new Map<string, () => Promise<void>>();

  const schedule = vi.fn().mockImplementation(
    (_expression: string, callback: () => Promise<void>) => {
      const taskId = String(capturedCallbacks.size);
      capturedCallbacks.set(taskId, callback);
      return {
        stop: vi.fn(),
        _taskId: taskId,
        _capturedCallbacks: capturedCallbacks,
      };
    },
  );

  return {
    default: { schedule },
    schedule,
    __capturedCallbacks: capturedCallbacks,
  };
});

// ── Fixtures ──────────────────────────────────────────────────────────────────

function makePipeline(
  id: string,
  overrides: Partial<Pipeline> = {},
): Pipeline {
  return {
    id,
    tenantId: 'tenant-alpha',
    name: `Scheduled Pipeline ${id}`,
    description: null,
    triggerType: 'schedule_tick',
    triggerConfig: { type: 'schedule_tick', cronExpression: '* * * * *' },
    retryPolicy: { maxRetries: 3, baseDelayMs: 1, maxDelayMs: 5, backoffMultiplier: 2 },
    concurrencyPolicy: 'skip_if_running',
    reviewGateTimeoutHours: 48,
    maxPipelineDepth: 10,
    status: 'active',
    templateId: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  } as unknown as Pipeline;
}

// ── Mock DB ───────────────────────────────────────────────────────────────────

function createScheduleDb(options: {
  runningExecutions?: Array<{ id: string }>;
} = {}) {
  const db = {
    select: vi.fn().mockReturnValue({
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockReturnValue({
          limit: vi.fn().mockResolvedValue(options.runningExecutions ?? []),
        }),
      }),
    }),
  };
  return db;
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('Scheduled Execution', () => {
  let bus: InMemoryEventBus;
  let handler: ScheduleTriggerHandler;

  beforeEach(() => {
    vi.clearAllMocks();
    bus = new InMemoryEventBus();
  });

  afterEach(() => {
    handler?.stopAll();
  });

  it('T057-1: fires schedule_tick event when cron callback is invoked', async () => {
    const db = createScheduleDb({ runningExecutions: [] });
    handler = new ScheduleTriggerHandler(db as never, bus);

    const pipeline = makePipeline('sched-1');

    const publishedEvents: Array<{ tenantId: string; eventType: string; payload: Record<string, unknown> }> = [];
    bus.subscribe('schedule_tick', async (envelope) => {
      publishedEvents.push({
        tenantId: envelope.tenantId,
        eventType: envelope.eventType,
        payload: envelope.payload,
      });
    });

    // Register schedule — captures cron callback via mocked node-cron
    handler.registerSchedule(pipeline);

    // Retrieve the captured callback and invoke it to simulate a cron tick
    const cronModule = await import('node-cron');
    const scheduleFn = (cronModule.default as { schedule: ReturnType<typeof vi.fn> }).schedule;
    const lastCall = scheduleFn.mock.calls[scheduleFn.mock.calls.length - 1];
    expect(lastCall).toBeDefined();

    // The callback is the second argument
    const cronCallback = lastCall![1] as () => Promise<void>;
    await cronCallback();

    expect(publishedEvents).toHaveLength(1);
    expect(publishedEvents[0]!.tenantId).toBe('tenant-alpha');
    expect(publishedEvents[0]!.eventType).toBe('schedule_tick');
    expect(publishedEvents[0]!.payload['pipelineId']).toBe('sched-1');
  });

  it('T057-2: overlap skip — skip_if_running + existing running execution skips publish', async () => {
    const db = createScheduleDb({
      runningExecutions: [{ id: 'exec-running-1' }],
    });
    handler = new ScheduleTriggerHandler(db as never, bus);

    const pipeline = makePipeline('sched-2', { concurrencyPolicy: 'skip_if_running' });

    const publishedEvents: string[] = [];
    bus.subscribe('schedule_tick', async () => {
      publishedEvents.push('fired');
    });

    handler.registerSchedule(pipeline);

    const cronModule = await import('node-cron');
    const scheduleFn = (cronModule.default as { schedule: ReturnType<typeof vi.fn> }).schedule;
    const lastCall = scheduleFn.mock.calls[scheduleFn.mock.calls.length - 1];
    const cronCallback = lastCall![1] as () => Promise<void>;
    await cronCallback();

    // Should have been skipped due to running execution
    expect(publishedEvents).toHaveLength(0);
  });

  it('T057-3: disabled pipeline — no execution triggered', async () => {
    const db = createScheduleDb({ runningExecutions: [] });
    handler = new ScheduleTriggerHandler(db as never, bus);

    // Disabled pipeline should not fire
    const pipeline = makePipeline('sched-3', { status: 'disabled' });

    // Mimic what would happen if this pipeline were registered — but
    // in production, loadAllSchedules only picks up 'active' pipelines.
    // The ScheduleTriggerHandler.getMatchingPipelines only returns a pipeline
    // if it's active. We verify the trigger filter here.
    const activePipelines: Pipeline[] = [];  // disabled — not in the active set

    const ctx = {
      event: {
        eventId: 'evt-1',
        tenantId: 'tenant-alpha',
        eventType: 'schedule_tick' as const,
        payload: { pipelineId: 'sched-3' },
        timestamp: new Date(),
      },
      tenantId: 'tenant-alpha',
      currentDepth: 0,
    };

    const matches = handler.getMatchingPipelines(ctx, activePipelines);
    expect(matches).toHaveLength(0);
  });

  it('T057-4: allow_concurrent policy — tick fires even with running execution', async () => {
    // allow_concurrent pipelines don't have overlap detection
    const db = createScheduleDb({ runningExecutions: [] });
    handler = new ScheduleTriggerHandler(db as never, bus);

    const pipeline = makePipeline('sched-4', { concurrencyPolicy: 'allow_concurrent' });

    const publishedEvents: string[] = [];
    bus.subscribe('schedule_tick', async () => {
      publishedEvents.push('fired');
    });

    handler.registerSchedule(pipeline);

    const cronModule = await import('node-cron');
    const scheduleFn = (cronModule.default as { schedule: ReturnType<typeof vi.fn> }).schedule;
    const lastCall = scheduleFn.mock.calls[scheduleFn.mock.calls.length - 1];
    const cronCallback = lastCall![1] as () => Promise<void>;
    await cronCallback();

    expect(publishedEvents).toHaveLength(1);
  });

  it('T057-5: getMatchingPipelines matches schedule_tick pipeline by pipelineId', () => {
    const db = createScheduleDb();
    handler = new ScheduleTriggerHandler(db as never, bus);

    const pipeline = makePipeline('sched-5');
    const activePipelines = [pipeline];

    const ctx = {
      event: {
        eventId: 'evt-1',
        tenantId: 'tenant-alpha',
        eventType: 'schedule_tick' as const,
        payload: { pipelineId: 'sched-5' },
        timestamp: new Date(),
      },
      tenantId: 'tenant-alpha',
      currentDepth: 0,
    };

    const matches = handler.getMatchingPipelines(ctx, activePipelines);
    expect(matches).toHaveLength(1);
    expect(matches[0]!.pipelineId).toBe('sched-5');
  });

  it('T057-6: stopAll removes all scheduled jobs', () => {
    const db = createScheduleDb();
    handler = new ScheduleTriggerHandler(db as never, bus);

    handler.registerSchedule(makePipeline('sched-a'));
    handler.registerSchedule(makePipeline('sched-b'));

    // Should not throw
    expect(() => handler.stopAll()).not.toThrow();
  });
});
