/**
 * Event Translator — Unit Tests
 */

import { describe, it, expect } from 'vitest';
import { translateEvent, TranslationError } from '../../../src/event-adapter/services/event-translator.js';
import type { WebhookEvent, EventSource, EventScheduledTask } from '../../../src/event-adapter/schema.js';

function makeEvent(overrides: Partial<WebhookEvent> = {}): WebhookEvent {
  return {
    id: 'evt-1',
    tenantId: 'tenant-1',
    sourceType: 'github',
    sourceId: 'src-1',
    scheduleId: null,
    status: 'processing',
    payload: { branch: 'main', repository: 'org/repo' },
    headers: {},
    signatureValid: true,
    translatedTrigger: null,
    triggerType: null,
    pipelineId: null,
    attemptCount: 0,
    failureReason: null,
    processingDurationMs: null,
    forwardedToAutomation: false,
    createdAt: new Date('2026-03-15T10:00:00Z'),
    updatedAt: new Date('2026-03-15T10:00:00Z'),
    deliveredAt: null,
    ...overrides,
  };
}

function makeSource(overrides: Partial<EventSource> = {}): EventSource {
  return {
    id: 'src-1',
    tenantId: 'tenant-1',
    name: 'Test Source',
    sourceType: 'github',
    endpointSlug: 'test-slug',
    authMethod: 'hmac_sha256',
    authConfig: {},
    payloadMapping: null,
    targetPipelineId: 'pipeline-1',
    targetTriggerType: 'corpus-change',
    lifecycleState: 'active',
    isPlatformWide: false,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

function makeSchedule(overrides: Partial<EventScheduledTask> = {}): EventScheduledTask {
  return {
    id: 'sched-1',
    tenantId: 'tenant-1',
    name: 'Daily Report',
    cronExpression: '0 9 * * 1-5',
    timezone: 'UTC',
    targetPipelineId: 'pipeline-2',
    triggerType: 'manual-request',
    triggerMetadata: { reportType: 'daily' },
    lifecycleState: 'active',
    lastFiredAt: null,
    nextFireAt: null,
    pausedBy: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

describe('translateEvent', () => {
  describe('github events', () => {
    it('translates push events as corpus-change', () => {
      const event = makeEvent({
        payload: { eventType: 'push', branch: 'main', repository: 'org/repo', changedFiles: ['a.ts'] },
      });
      const source = makeSource();

      const result = translateEvent(event, source);

      expect(result.triggerType).toBe('corpus-change');
      expect(result.pipelineId).toBe('pipeline-1');
      expect(result.tenantId).toBe('tenant-1');
      expect(result.sourceEventId).toBe('evt-1');
      expect(result.metadata).toHaveProperty('branch', 'main');
    });

    it('translates PR events as manual-request', () => {
      const event = makeEvent({
        payload: { eventType: 'pull_request', action: 'opened', number: 42 },
      });
      const source = makeSource();

      const result = translateEvent(event, source);
      expect(result.triggerType).toBe('manual-request');
    });

    it('throws TranslationError when source is missing', () => {
      const event = makeEvent();
      expect(() => translateEvent(event, null)).toThrow(TranslationError);
    });

    it('throws TranslationError when pipeline_id is missing', () => {
      const event = makeEvent();
      const source = makeSource({ targetPipelineId: null });
      expect(() => translateEvent(event, source)).toThrow(TranslationError);
    });
  });

  describe('generic_webhook events', () => {
    it('uses source defaults when no mapping exists', () => {
      const event = makeEvent({
        sourceType: 'generic_webhook',
        payload: { action: 'deploy', env: 'prod' },
        translatedTrigger: null,
      });
      const source = makeSource({
        sourceType: 'generic_webhook',
        targetTriggerType: 'corpus-change',
      });

      const result = translateEvent(event, source);

      expect(result.triggerType).toBe('corpus-change');
      expect(result.metadata).toHaveProperty('action', 'deploy');
    });

    it('uses translated_trigger when available', () => {
      const event = makeEvent({
        sourceType: 'generic_webhook',
        payload: { raw: 'data' },
        translatedTrigger: {
          triggerType: 'manual-request',
          metadata: { mapped: true },
          pipelineId: 'mapped-pipeline',
        },
      });
      const source = makeSource({ sourceType: 'generic_webhook' });

      const result = translateEvent(event, source);

      expect(result.triggerType).toBe('manual-request');
      expect(result.metadata).toEqual({ mapped: true });
      expect(result.pipelineId).toBe('mapped-pipeline');
    });
  });

  describe('schedule events', () => {
    it('translates as manual-request with schedule metadata', () => {
      const event = makeEvent({
        sourceType: 'schedule',
        sourceId: null,
        scheduleId: 'sched-1',
      });
      const schedule = makeSchedule();

      const result = translateEvent(event, null, schedule);

      expect(result.triggerType).toBe('manual-request');
      expect(result.pipelineId).toBe('pipeline-2');
      expect(result.metadata.scheduleId).toBe('sched-1');
      expect(result.metadata.scheduleName).toBe('Daily Report');
      expect(result.metadata.reportType).toBe('daily');
    });

    it('throws TranslationError when schedule is missing', () => {
      const event = makeEvent({ sourceType: 'schedule' });
      expect(() => translateEvent(event, null, null)).toThrow(TranslationError);
    });
  });

  describe('automation_callback events', () => {
    it('passes through trigger type and metadata from payload', () => {
      const event = makeEvent({
        sourceType: 'automation_callback',
        payload: {
          triggerType: 'corpus-change',
          pipelineId: 'callback-pipeline',
          metadata: { enrichedBy: 'automation-tool' },
        },
      });

      const result = translateEvent(event);

      expect(result.triggerType).toBe('corpus-change');
      expect(result.pipelineId).toBe('callback-pipeline');
      expect(result.metadata.enrichedBy).toBe('automation-tool');
    });

    it('throws TranslationError when trigger_type is missing', () => {
      const event = makeEvent({
        sourceType: 'automation_callback',
        payload: { pipelineId: 'p-1' },
      });
      expect(() => translateEvent(event)).toThrow(TranslationError);
    });

    it('throws TranslationError when pipeline_id is missing', () => {
      const event = makeEvent({
        sourceType: 'automation_callback',
        payload: { triggerType: 'corpus-change' },
      });
      expect(() => translateEvent(event)).toThrow(TranslationError);
    });
  });
});
