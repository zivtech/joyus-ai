/**
 * E2E: Webhook → Buffer → Translate → Trigger (T067)
 *
 * Tests the complete flow from a raw webhook event through translation into a
 * TriggerCall. No real DB required — all service logic is pure function calls.
 */

import { createHmac } from 'node:crypto';
import { describe, it, expect, vi } from 'vitest';
import { translateEvent, TranslationError } from '../../../src/event-adapter/services/event-translator.js';
import { validateHmacSha256 } from '../../../src/event-adapter/services/auth-validator.js';
import { parseGitHubEvent, UnsupportedEventTypeError } from '../../../src/event-adapter/parsers/github.js';
import type { WebhookEvent, EventSource } from '../../../src/event-adapter/schema.js';
import type { TriggerCall } from '../../../src/event-adapter/services/trigger-forwarder.js';
import { bufferEvent, claimEvent } from '../../../src/event-adapter/services/event-buffer.js';

// ============================================================
// HELPERS
// ============================================================

function makeWebhookEvent(overrides: Partial<WebhookEvent> = {}): WebhookEvent {
  return {
    id: 'evt-001',
    tenantId: 'tenant-abc',
    sourceType: 'github',
    sourceId: 'src-001',
    scheduleId: null,
    status: 'pending',
    payload: { eventType: 'push', ref: 'refs/heads/main', repository: 'org/repo', sender: 'dev' },
    headers: null,
    signatureValid: true,
    translatedTrigger: null,
    triggerType: null,
    pipelineId: null,
    attemptCount: 0,
    failureReason: null,
    processingDurationMs: null,
    forwardedToAutomation: false,
    createdAt: new Date('2026-01-01T10:00:00Z'),
    updatedAt: new Date('2026-01-01T10:00:00Z'),
    deliveredAt: null,
    ...overrides,
  };
}

function makeEventSource(overrides: Partial<EventSource> = {}): EventSource {
  return {
    id: 'src-001',
    tenantId: 'tenant-abc',
    name: 'GitHub Integration',
    sourceType: 'github',
    endpointSlug: 'github-main',
    authMethod: 'hmac_sha256',
    authConfig: { secretRef: 'ref-1', headerName: 'X-Hub-Signature-256', algorithm: 'sha256' },
    payloadMapping: null,
    targetPipelineId: 'pipe-001',
    targetTriggerType: 'corpus-change',
    lifecycleState: 'active',
    isPlatformWide: false,
    createdAt: new Date('2026-01-01T00:00:00Z'),
    updatedAt: new Date('2026-01-01T00:00:00Z'),
    ...overrides,
  };
}

// ============================================================
// GITHUB PUSH EVENT FLOW
// ============================================================

describe('T067: Webhook → Buffer → Translate → Trigger', () => {
  describe('GitHub push event translation', () => {
    it('translates push event to corpus-change trigger type', () => {
      const event = makeWebhookEvent({ payload: { eventType: 'push', ref: 'refs/heads/main' } });
      const source = makeEventSource();

      const result: TriggerCall = translateEvent(event, source);

      expect(result.triggerType).toBe('corpus-change');
      expect(result.tenantId).toBe('tenant-abc');
      expect(result.pipelineId).toBe('pipe-001');
      expect(result.sourceEventId).toBe('evt-001');
    });

    it('translates pull_request event to manual-request trigger type', () => {
      const event = makeWebhookEvent({ payload: { eventType: 'pull_request', action: 'opened' } });
      const source = makeEventSource();

      const result: TriggerCall = translateEvent(event, source);

      expect(result.triggerType).toBe('manual-request');
    });

    it('translates release event to manual-request trigger type', () => {
      const event = makeWebhookEvent({ payload: { eventType: 'release', action: 'published' } });
      const source = makeEventSource();

      const result: TriggerCall = translateEvent(event, source);

      expect(result.triggerType).toBe('manual-request');
    });

    it('includes event payload as metadata in trigger call', () => {
      const payload = { eventType: 'push', ref: 'refs/heads/main', repository: 'org/repo', sender: 'dev' };
      const event = makeWebhookEvent({ payload });
      const source = makeEventSource();

      const result: TriggerCall = translateEvent(event, source);

      expect(result.metadata).toMatchObject({ eventType: 'push', ref: 'refs/heads/main' });
    });
  });

  // ============================================================
  // MISSING SOURCE / PIPELINE ERRORS
  // ============================================================

  describe('missing source and pipeline validation', () => {
    it('throws TranslationError when source is missing for GitHub event', () => {
      const event = makeWebhookEvent();

      expect(() => translateEvent(event, null)).toThrow(TranslationError);
      expect(() => translateEvent(event, null)).toThrow('missing associated event_source');
    });

    it('throws TranslationError when source is undefined for GitHub event', () => {
      const event = makeWebhookEvent();

      expect(() => translateEvent(event, undefined)).toThrow(TranslationError);
    });

    it('throws TranslationError when source has no target_pipeline_id', () => {
      const event = makeWebhookEvent();
      const source = makeEventSource({ targetPipelineId: null });

      expect(() => translateEvent(event, source)).toThrow(TranslationError);
      expect(() => translateEvent(event, source)).toThrow('target_pipeline_id');
    });

    it('throws TranslationError when source is missing for generic_webhook event', () => {
      const event = makeWebhookEvent({ sourceType: 'generic_webhook' });

      expect(() => translateEvent(event, null)).toThrow(TranslationError);
      expect(() => translateEvent(event, null)).toThrow('missing associated event_source');
    });
  });

  // ============================================================
  // GENERIC WEBHOOK FLOW
  // ============================================================

  describe('generic webhook translation', () => {
    it('maps generic webhook payload to trigger call using source defaults', () => {
      const event = makeWebhookEvent({
        sourceType: 'generic_webhook',
        payload: { action: 'content_updated', contentId: 'doc-42' },
      });
      const source = makeEventSource({
        sourceType: 'generic_webhook',
        targetTriggerType: 'corpus-change',
        targetPipelineId: 'pipe-002',
      });

      const result: TriggerCall = translateEvent(event, source);

      expect(result.triggerType).toBe('corpus-change');
      expect(result.pipelineId).toBe('pipe-002');
      expect(result.tenantId).toBe('tenant-abc');
    });

    it('defaults to manual-request when source has no targetTriggerType', () => {
      const event = makeWebhookEvent({
        sourceType: 'generic_webhook',
        payload: { action: 'notify' },
      });
      const source = makeEventSource({
        sourceType: 'generic_webhook',
        targetTriggerType: null,
        targetPipelineId: 'pipe-003',
      });

      const result: TriggerCall = translateEvent(event, source);

      expect(result.triggerType).toBe('manual-request');
    });
  });

  // ============================================================
  // AUTOMATION CALLBACK FLOW
  // ============================================================

  describe('automation_callback translation', () => {
    it('passes through trigger_type and pipeline_id from payload', () => {
      const event = makeWebhookEvent({
        sourceType: 'automation_callback',
        payload: {
          trigger_type: 'corpus-change',
          pipeline_id: 'pipe-from-automation',
          metadata: { source: 'n8n-workflow' },
        },
      });

      const result: TriggerCall = translateEvent(event);

      expect(result.triggerType).toBe('corpus-change');
      expect(result.pipelineId).toBe('pipe-from-automation');
      expect(result.tenantId).toBe('tenant-abc');
      expect(result.metadata).toMatchObject({ source: 'n8n-workflow' });
    });

    it('also accepts camelCase triggerType and pipelineId in payload', () => {
      const event = makeWebhookEvent({
        sourceType: 'automation_callback',
        payload: {
          triggerType: 'manual-request',
          pipelineId: 'pipe-camel',
        },
      });

      const result: TriggerCall = translateEvent(event);

      expect(result.triggerType).toBe('manual-request');
      expect(result.pipelineId).toBe('pipe-camel');
    });
  });

  // ============================================================
  // FULL FLOW
  // ============================================================

  describe('full webhook-to-trigger flow', () => {
    it('produces a complete valid TriggerCall from a fully-populated GitHub push event', () => {
      const event = makeWebhookEvent({
        id: 'evt-full-001',
        tenantId: 'tenant-xyz',
        sourceType: 'github',
        sourceId: 'src-github-1',
        payload: {
          eventType: 'push',
          ref: 'refs/heads/release/v2',
          repository: 'org/platform',
          sender: 'release-bot',
          commits: [{ id: 'abc123', message: 'chore: bump version', timestamp: '2026-01-01T09:00:00Z' }],
        },
        signatureValid: true,
      });
      const source = makeEventSource({
        id: 'src-github-1',
        tenantId: 'tenant-xyz',
        targetPipelineId: 'pipe-release',
      });

      const result: TriggerCall = translateEvent(event, source);

      expect(result).toMatchObject({
        tenantId: 'tenant-xyz',
        pipelineId: 'pipe-release',
        triggerType: 'corpus-change',
        sourceEventId: 'evt-full-001',
      });
      expect(typeof result.metadata).toBe('object');
    });

    it('Full flow: bufferEvent → claimEvent → translateEvent → result via mocked DB chain', async () => {
      // Mock DB for bufferEvent (insert → returning)
      const bufferedEvent = makeWebhookEvent({
        id: 'evt-chain-001',
        status: 'pending',
        payload: { eventType: 'push', ref: 'refs/heads/main' },
      });
      const claimedEvent = { ...bufferedEvent, status: 'processing' as const };

      const mockDb = {
        insert: vi.fn().mockReturnValue({
          values: vi.fn().mockReturnValue({
            returning: vi.fn().mockResolvedValue([bufferedEvent]),
          }),
        }),
        update: vi.fn().mockReturnValue({
          set: vi.fn().mockReturnValue({
            where: vi.fn().mockReturnValue({
              returning: vi.fn().mockResolvedValue([claimedEvent]),
            }),
          }),
        }),
      } as never;

      // Step 1: bufferEvent persists as pending
      const buffered = await bufferEvent(mockDb, {
        tenantId: 'tenant-abc',
        sourceType: 'github',
        sourceId: 'src-001',
        payload: { eventType: 'push', ref: 'refs/heads/main' },
        signatureValid: true,
      });
      expect(buffered.status).toBe('pending');
      expect(buffered.id).toBe('evt-chain-001');

      // Step 2: claimEvent transitions pending → processing
      const claimed = await claimEvent(mockDb, 'evt-chain-001');
      expect(claimed?.status).toBe('processing');

      // Step 3: translateEvent produces a valid TriggerCall
      const source = makeEventSource({ targetPipelineId: 'pipe-chain' });
      const trigger = translateEvent(claimed!, source);
      expect(trigger.triggerType).toBe('corpus-change');
      expect(trigger.pipelineId).toBe('pipe-chain');
      expect(trigger.tenantId).toBe('tenant-abc');
      expect(trigger.sourceEventId).toBe('evt-chain-001');
    });
  });

  // ============================================================
  // INVALID SIGNATURE SCENARIO
  // ============================================================

  describe('HMAC signature validation', () => {
    it('validateHmacSha256 rejects a bad HMAC signature', () => {
      const payload = Buffer.from('{"eventType":"push"}');
      const secret = 'my-webhook-secret';
      const badSignature = 'sha256=deadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeef';

      const result = validateHmacSha256(payload, badSignature, secret);

      expect(result).toBe(false);
    });

    it('validateHmacSha256 accepts a correct HMAC signature', () => {
      const payload = Buffer.from('{"eventType":"push"}');
      const secret = 'my-webhook-secret';
      const sig = createHmac('sha256', secret).update(payload).digest('hex');
      const signatureHeader = `sha256=${sig}`;

      const result = validateHmacSha256(payload, signatureHeader, secret);

      expect(result).toBe(true);
    });

    it('validateHmacSha256 rejects a signature with wrong prefix', () => {
      const payload = Buffer.from('{"eventType":"push"}');
      const result = validateHmacSha256(payload, 'sha1=abc123', 'secret');

      expect(result).toBe(false);
    });
  });

  // ============================================================
  // GITHUB PING EVENT HANDLING
  // ============================================================

  describe('GitHub ping event handling', () => {
    it('parseGitHubEvent throws UnsupportedEventTypeError for ping events', () => {
      const headers = { 'x-github-event': 'ping' };
      const body = Buffer.from(JSON.stringify({ zen: 'Keep it logically awesome.', hook_id: 42 }));

      expect(() => parseGitHubEvent(headers, body)).toThrow(UnsupportedEventTypeError);
    });

    it('UnsupportedEventTypeError carries the event type name', () => {
      const headers = { 'x-github-event': 'ping' };
      const body = Buffer.from(JSON.stringify({ zen: 'Keep it logically awesome.' }));

      try {
        parseGitHubEvent(headers, body);
        expect.fail('Expected UnsupportedEventTypeError to be thrown');
      } catch (err) {
        expect(err).toBeInstanceOf(UnsupportedEventTypeError);
        expect((err as UnsupportedEventTypeError).eventType).toBe('ping');
      }
    });

    it('parseGitHubEvent throws UnsupportedEventTypeError for check_run events', () => {
      const headers = { 'x-github-event': 'check_run' };
      const body = Buffer.from(JSON.stringify({ action: 'completed' }));

      expect(() => parseGitHubEvent(headers, body)).toThrow(UnsupportedEventTypeError);
    });

    it('parseGitHubEvent throws UnsupportedEventTypeError when x-github-event header is missing', () => {
      const headers = {};
      const body = Buffer.from('{}');

      expect(() => parseGitHubEvent(headers, body)).toThrow(UnsupportedEventTypeError);
    });
  });
});
