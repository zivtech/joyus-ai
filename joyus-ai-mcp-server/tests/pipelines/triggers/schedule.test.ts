/**
 * Tests for ScheduleTriggerHandler.
 *
 * Covers:
 *   - triggerType is 'schedule_tick'
 *   - canHandle returns true for 'schedule_tick', false otherwise
 *   - getMatchingPipelines finds pipeline by pipelineId in payload
 *   - getMatchingPipelines returns empty when pipelineId missing or wrong triggerType
 *   - getNextRunTime computes a future Date for a valid cron expression
 *   - getNextRunTime returns null for an invalid cron expression
 *   - getNextRunTime accepts a timezone option
 *   - registerSchedule skips invalid cron expression (no throw)
 *   - registerSchedule skips invalid timezone (no throw)
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { ScheduleTriggerHandler } from '../../../src/pipelines/triggers/schedule.js';
import { InMemoryEventBus } from '../../../src/pipelines/event-bus/interface.js';
import type { Pipeline } from '../../../src/pipelines/schema.js';
import type { TriggerContext } from '../../../src/pipelines/triggers/interface.js';

// ── Fixtures ──────────────────────────────────────────────────────────────────

function makePipeline(
  id: string,
  triggerType: Pipeline['triggerType'] = 'schedule_tick',
  cronExpression = '0 * * * *',
  timezone?: string,
): Pipeline {
  return {
    id,
    tenantId: 'tenant-1',
    name: `Pipeline ${id}`,
    description: null,
    triggerType,
    triggerConfig: {
      type: triggerType,
      ...(triggerType === 'schedule_tick' ? { cronExpression, timezone } : {}),
    },
    retryPolicy: { maxRetries: 3, baseDelayMs: 30000, maxDelayMs: 300000, backoffMultiplier: 2 },
    concurrencyPolicy: 'skip_if_running',
    reviewGateTimeoutHours: 48,
    maxPipelineDepth: 10,
    status: 'active',
    templateId: null,
    createdAt: new Date(),
    updatedAt: new Date(),
  } as unknown as Pipeline;
}

function makeContext(payload: Record<string, unknown> = {}): TriggerContext {
  return {
    event: {
      eventId: 'evt-1',
      tenantId: 'tenant-1',
      eventType: 'schedule_tick',
      payload,
      timestamp: new Date(),
    },
    tenantId: 'tenant-1',
    currentDepth: 0,
  };
}

// Minimal db stub — schedule tests that call loadAllSchedules/registerSchedule
// need a db, but unit tests below only need the handler logic.
const stubDb = {
  select: vi.fn().mockReturnThis(),
  from: vi.fn().mockReturnThis(),
  where: vi.fn().mockReturnThis(),
  limit: vi.fn().mockResolvedValue([]),
} as unknown as import('drizzle-orm/node-postgres').NodePgDatabase;

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('ScheduleTriggerHandler', () => {
  let bus: InMemoryEventBus;
  let handler: ScheduleTriggerHandler;

  beforeEach(() => {
    bus = new InMemoryEventBus();
    handler = new ScheduleTriggerHandler(stubDb, bus);
  });

  afterEach(() => {
    handler.stopAll();
  });

  it('has triggerType schedule_tick', () => {
    expect(handler.triggerType).toBe('schedule_tick');
  });

  it('canHandle returns true for schedule_tick', () => {
    expect(handler.canHandle('schedule_tick')).toBe(true);
  });

  it('canHandle returns false for other event types', () => {
    expect(handler.canHandle('corpus_change')).toBe(false);
    expect(handler.canHandle('manual_request')).toBe(false);
  });

  describe('getMatchingPipelines', () => {
    it('returns the matching pipeline by pipelineId', () => {
      const pipelines = [makePipeline('p1'), makePipeline('p2')];
      const ctx = makeContext({ pipelineId: 'p2' });
      const results = handler.getMatchingPipelines(ctx, pipelines);
      expect(results).toHaveLength(1);
      expect(results[0]!.pipelineId).toBe('p2');
    });

    it('returns empty array when pipelineId is missing', () => {
      const ctx = makeContext({});
      expect(handler.getMatchingPipelines(ctx, [makePipeline('p1')])).toEqual([]);
    });

    it('returns empty array when pipelineId is not a string', () => {
      const ctx = makeContext({ pipelineId: 42 });
      expect(handler.getMatchingPipelines(ctx, [makePipeline('p1')])).toEqual([]);
    });

    it('returns empty array when pipeline triggerType does not match', () => {
      const pipeline = makePipeline('p1', 'corpus_change');
      const ctx = makeContext({ pipelineId: 'p1' });
      expect(handler.getMatchingPipelines(ctx, [pipeline])).toEqual([]);
    });

    it('includes incremented depth in triggerPayload', () => {
      const ctx: TriggerContext = { ...makeContext({ pipelineId: 'p1' }), currentDepth: 2 };
      const results = handler.getMatchingPipelines(ctx, [makePipeline('p1')]);
      expect(results[0]!.triggerPayload['depth']).toBe(3);
    });
  });

  describe('getNextRunTime', () => {
    it('returns a Date in the future for a valid cron expression', () => {
      const next = handler.getNextRunTime('0 * * * *');
      expect(next).toBeInstanceOf(Date);
      expect(next!.getTime()).toBeGreaterThan(Date.now() - 1000);
    });

    it('returns null for an invalid cron expression', () => {
      expect(handler.getNextRunTime('not-a-cron')).toBeNull();
    });

    it('accepts a valid timezone', () => {
      const next = handler.getNextRunTime('0 9 * * *', 'America/New_York');
      expect(next).toBeInstanceOf(Date);
    });

    it('returns null for an invalid timezone', () => {
      // cron-parser throws on invalid tz
      expect(handler.getNextRunTime('0 9 * * *', 'Invalid/Zone')).toBeNull();
    });
  });

  describe('registerSchedule', () => {
    it('does not throw for an invalid cron expression', () => {
      const pipeline = makePipeline('p1', 'schedule_tick', 'not-a-cron');
      expect(() => handler.registerSchedule(pipeline)).not.toThrow();
    });

    it('does not throw for an invalid timezone', () => {
      const pipeline = makePipeline('p1', 'schedule_tick', '0 * * * *', 'Invalid/Zone');
      expect(() => handler.registerSchedule(pipeline)).not.toThrow();
    });

    it('registers and unregisters a job without error', () => {
      const pipeline = makePipeline('p1', 'schedule_tick', '0 * * * *');
      handler.registerSchedule(pipeline);
      handler.unregisterSchedule('p1');
      // No assertion needed — absence of throw is the test
    });
  });
});
