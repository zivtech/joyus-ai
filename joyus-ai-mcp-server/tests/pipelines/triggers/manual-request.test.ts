/**
 * Tests for ManualRequestTriggerHandler.
 *
 * Covers:
 *   - triggerType is 'manual_request'
 *   - canHandle returns true for 'manual_request', false otherwise
 *   - missing pipelineId in payload returns empty array
 *   - non-string pipelineId returns empty array
 *   - correct pipeline is selected by id
 *   - non-matching pipeline id returns empty array
 *   - pipeline with wrong triggerType is not returned
 */

import { describe, it, expect } from 'vitest';
import { ManualRequestTriggerHandler } from '../../../src/pipelines/triggers/manual-request.js';
import type { Pipeline } from '../../../src/pipelines/schema.js';
import type { TriggerContext } from '../../../src/pipelines/triggers/interface.js';

// ── Fixtures ──────────────────────────────────────────────────────────────────

function makePipeline(
  id: string,
  triggerType: Pipeline['triggerType'] = 'manual_request',
): Pipeline {
  return {
    id,
    tenantId: 'tenant-1',
    name: `Pipeline ${id}`,
    description: null,
    triggerType,
    triggerConfig: { type: triggerType },
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
      eventType: 'manual_request',
      payload,
      timestamp: new Date(),
    },
    tenantId: 'tenant-1',
    currentDepth: 0,
  };
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('ManualRequestTriggerHandler', () => {
  const handler = new ManualRequestTriggerHandler();

  it('has triggerType manual_request', () => {
    expect(handler.triggerType).toBe('manual_request');
  });

  it('canHandle returns true for manual_request', () => {
    expect(handler.canHandle('manual_request')).toBe(true);
  });

  it('canHandle returns false for other event types', () => {
    expect(handler.canHandle('corpus_change')).toBe(false);
    expect(handler.canHandle('schedule_tick')).toBe(false);
  });

  describe('getMatchingPipelines', () => {
    it('returns empty array when pipelineId is missing from payload', () => {
      const ctx = makeContext({});
      expect(handler.getMatchingPipelines(ctx, [makePipeline('p1')])).toEqual([]);
    });

    it('returns empty array when pipelineId is not a string', () => {
      const ctx = makeContext({ pipelineId: 42 });
      expect(handler.getMatchingPipelines(ctx, [makePipeline('p1')])).toEqual([]);
    });

    it('returns empty array when pipelineId is an empty string', () => {
      const ctx = makeContext({ pipelineId: '' });
      expect(handler.getMatchingPipelines(ctx, [makePipeline('p1')])).toEqual([]);
    });

    it('selects the correct pipeline by id', () => {
      const pipelines = [makePipeline('p1'), makePipeline('p2')];
      const ctx = makeContext({ pipelineId: 'p2' });
      const results = handler.getMatchingPipelines(ctx, pipelines);
      expect(results).toHaveLength(1);
      expect(results[0].pipelineId).toBe('p2');
    });

    it('returns empty array when no pipeline matches the id', () => {
      const ctx = makeContext({ pipelineId: 'nonexistent' });
      expect(handler.getMatchingPipelines(ctx, [makePipeline('p1')])).toEqual([]);
    });

    it('returns empty array when matched pipeline has wrong triggerType', () => {
      const pipeline = makePipeline('p1', 'corpus_change');
      const ctx = makeContext({ pipelineId: 'p1' });
      expect(handler.getMatchingPipelines(ctx, [pipeline])).toEqual([]);
    });

    it('includes incremented depth in triggerPayload', () => {
      const ctx: TriggerContext = {
        ...makeContext({ pipelineId: 'p1' }),
        currentDepth: 2,
      };
      const results = handler.getMatchingPipelines(ctx, [makePipeline('p1')]);
      expect(results[0].triggerPayload['depth']).toBe(3);
    });
  });
});
