/**
 * Tests for CorpusChangeTriggerHandler.
 *
 * Covers:
 *   - triggerType is 'corpus_change'
 *   - canHandle returns true for 'corpus_change', false otherwise
 *   - empty corpusFilter matches all corpus_change pipelines
 *   - missing corpusFilter matches all corpus_change pipelines
 *   - corpusFilter with matching key/value matches
 *   - corpusFilter with non-matching key/value does not match
 *   - depth limit returns empty array with no error thrown
 */

import { describe, it, expect } from 'vitest';
import { CorpusChangeTriggerHandler } from '../../../src/pipelines/triggers/corpus-change.js';
import { DEFAULT_MAX_PIPELINE_DEPTH } from '../../../src/pipelines/types.js';
import type { Pipeline } from '../../../src/pipelines/schema.js';
import type { TriggerContext } from '../../../src/pipelines/triggers/interface.js';

// ── Fixtures ──────────────────────────────────────────────────────────────────

function makePipeline(
  id: string,
  triggerType: Pipeline['triggerType'] = 'corpus_change',
  corpusFilter?: Record<string, unknown>,
): Pipeline {
  return {
    id,
    tenantId: 'tenant-1',
    name: `Pipeline ${id}`,
    description: null,
    triggerType,
    triggerConfig: { type: triggerType, ...(corpusFilter !== undefined ? { corpusFilter } : {}) },
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

function makeContext(payload: Record<string, unknown> = {}, depth = 0): TriggerContext {
  return {
    event: {
      eventId: 'evt-1',
      tenantId: 'tenant-1',
      eventType: 'corpus_change',
      payload,
      timestamp: new Date(),
    },
    tenantId: 'tenant-1',
    currentDepth: depth,
  };
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('CorpusChangeTriggerHandler', () => {
  const handler = new CorpusChangeTriggerHandler();

  it('has triggerType corpus_change', () => {
    expect(handler.triggerType).toBe('corpus_change');
  });

  it('canHandle returns true for corpus_change', () => {
    expect(handler.canHandle('corpus_change')).toBe(true);
  });

  it('canHandle returns false for other event types', () => {
    expect(handler.canHandle('manual_request')).toBe(false);
    expect(handler.canHandle('schedule_tick')).toBe(false);
  });

  describe('getMatchingPipelines', () => {
    it('returns empty array when depth limit is reached', () => {
      const pipelines = [makePipeline('p1')];
      const ctx = makeContext({}, DEFAULT_MAX_PIPELINE_DEPTH);
      expect(handler.getMatchingPipelines(ctx, pipelines)).toEqual([]);
    });

    it('matches all corpus_change pipelines when corpusFilter is absent', () => {
      const pipelines = [makePipeline('p1'), makePipeline('p2')];
      const ctx = makeContext({});
      const results = handler.getMatchingPipelines(ctx, pipelines);
      expect(results).toHaveLength(2);
      expect(results.map((r) => r.pipelineId)).toEqual(['p1', 'p2']);
    });

    it('matches all corpus_change pipelines when corpusFilter is empty object', () => {
      const pipelines = [makePipeline('p1', 'corpus_change', {})];
      const ctx = makeContext({ sourceId: 'src-1' });
      const results = handler.getMatchingPipelines(ctx, pipelines);
      expect(results).toHaveLength(1);
    });

    it('filters out non-corpus_change pipelines', () => {
      const pipelines = [
        makePipeline('p1', 'corpus_change'),
        makePipeline('p2', 'manual_request'),
      ];
      const ctx = makeContext({});
      const results = handler.getMatchingPipelines(ctx, pipelines);
      expect(results).toHaveLength(1);
      expect(results[0].pipelineId).toBe('p1');
    });

    it('matches pipeline when all filter keys match event payload', () => {
      const pipeline = makePipeline('p1', 'corpus_change', { sourceId: 'src-99' });
      const ctx = makeContext({ sourceId: 'src-99', extra: 'ignored' });
      const results = handler.getMatchingPipelines(ctx, [pipeline]);
      expect(results).toHaveLength(1);
    });

    it('does not match pipeline when filter key does not match event payload', () => {
      const pipeline = makePipeline('p1', 'corpus_change', { sourceId: 'src-99' });
      const ctx = makeContext({ sourceId: 'src-other' });
      const results = handler.getMatchingPipelines(ctx, [pipeline]);
      expect(results).toHaveLength(0);
    });

    it('includes incremented depth in triggerPayload', () => {
      const pipeline = makePipeline('p1');
      const ctx = makeContext({}, 3);
      const results = handler.getMatchingPipelines(ctx, [pipeline]);
      expect(results[0].triggerPayload['depth']).toBe(4);
    });
  });
});
