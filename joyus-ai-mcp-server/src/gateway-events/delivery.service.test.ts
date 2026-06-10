import { describe, expect, it, vi } from 'vitest';

import type {
  GatewayDeliveryEndpoint,
  GatewayEventDeliveryAttempt,
  GatewayPlatformEvent,
} from '../db/schema/gateway-events.js';

import { ChannelDeliveryAdapter } from './adapters/channel.js';
import { DashboardDeliveryAdapter } from './adapters/dashboard.js';
import { EmailDeliveryAdapter } from './adapters/email.js';
import { SlackDeliveryAdapter } from './adapters/slack.js';
import { WebhookDeliveryAdapter } from './adapters/webhook.js';
import type { DeliveryResultRecord, GatewayDeliveryPersistence } from './delivery.service.js';
import { GatewayDeliveryService } from './delivery.service.js';

type FetchMock = ReturnType<
  typeof vi.fn<[input: string | URL | Request, init?: RequestInit], Promise<Response>>
>;

function asFetch(fetchMock: FetchMock): typeof fetch {
  return fetchMock as unknown as typeof fetch;
}

class FakeDeliveryPersistence implements GatewayDeliveryPersistence {
  events = new Map<string, GatewayPlatformEvent>();
  endpoints = new Map<string, GatewayDeliveryEndpoint>();
  attempts = new Map<string, GatewayEventDeliveryAttempt>();
  records: DeliveryResultRecord[] = [];

  async getPlatformEvent(_tenantId: string, eventId: string): Promise<GatewayPlatformEvent | null> {
    return this.events.get(eventId) ?? null;
  }

  async getEndpoint(_tenantId: string, endpointId: string): Promise<GatewayDeliveryEndpoint | null> {
    return this.endpoints.get(endpointId) ?? null;
  }

  async recordDeliveryResult(
    attempt: GatewayEventDeliveryAttempt,
    result: DeliveryResultRecord,
  ): Promise<GatewayEventDeliveryAttempt> {
    this.records.push(result);
    const updated = {
      ...attempt,
      status: result.status,
      deliveredAt: result.deliveredAt ?? null,
      lastError: result.lastError ?? null,
      responseSummary: result.responseSummary ?? null,
      updatedAt: new Date('2026-05-25T12:01:00Z'),
    } satisfies GatewayEventDeliveryAttempt;
    this.attempts.set(updated.id, updated);
    return updated;
  }
}

function event(overrides: Partial<GatewayPlatformEvent> = {}): GatewayPlatformEvent {
  return {
    id: 'event_1',
    tenantId: 'tenant_123',
    type: 'review.pending',
    severity: 'warning',
    sourceSpec: 'gateway-event-bus',
    sourceComponent: 'pipeline-review',
    subjectType: 'pipeline_execution',
    subjectId: 'execution_123',
    correlationId: 'correlation_123',
    idempotencyKey: 'review:event_1',
    payload: { title: 'Review required' },
    payloadSchemaVersion: 'review.pending.v1',
    requiresDecision: true,
    handlerKey: 'pipeline-review',
    occurredAt: new Date('2026-05-25T12:00:00Z'),
    emittedAt: new Date('2026-05-25T12:00:00Z'),
    ...overrides,
  };
}

function endpoint(
  type: GatewayDeliveryEndpoint['type'],
  overrides: Partial<GatewayDeliveryEndpoint> = {},
): GatewayDeliveryEndpoint {
  return {
    id: `endpoint_${type}`,
    tenantId: 'tenant_123',
    type,
    name: `${type} endpoint`,
    config: type === 'webhook' ? { url: 'https://example.test/gateway-events' } : {},
    secretRef: type === 'webhook' ? 'secret_ref_123' : null,
    isActive: true,
    createdBy: 'admin_123',
    createdAt: new Date('2026-05-25T12:00:00Z'),
    updatedAt: new Date('2026-05-25T12:00:00Z'),
    ...overrides,
  };
}

function attempt(
  endpointType: GatewayDeliveryEndpoint['type'],
  overrides: Partial<GatewayEventDeliveryAttempt> = {},
): GatewayEventDeliveryAttempt {
  return {
    id: `attempt_${endpointType}`,
    tenantId: 'tenant_123',
    eventId: 'event_1',
    subscriptionId: `subscription_${endpointType}`,
    endpointId: `endpoint_${endpointType}`,
    status: 'pending',
    attemptNumber: 1,
    maxAttempts: 3,
    nextRetryAt: null,
    deliveredAt: null,
    lastError: null,
    responseSummary: null,
    createdAt: new Date('2026-05-25T12:00:00Z'),
    updatedAt: new Date('2026-05-25T12:00:00Z'),
    ...overrides,
  };
}

function seed(
  persistence: FakeDeliveryPersistence,
  endpoints: GatewayDeliveryEndpoint['type'][],
): GatewayEventDeliveryAttempt[] {
  persistence.events.set('event_1', event());
  return endpoints.map((type) => {
    const seededEndpoint = endpoint(type);
    const seededAttempt = attempt(type);
    persistence.endpoints.set(seededEndpoint.id, seededEndpoint);
    persistence.attempts.set(seededAttempt.id, seededAttempt);
    return seededAttempt;
  });
}

describe('GatewayDeliveryService', () => {
  it('fans out attempts and records one backend failure without blocking the others', async () => {
    const persistence = new FakeDeliveryPersistence();
    const attempts = seed(persistence, ['dashboard', 'webhook', 'slack']);
    const fetchImpl = vi
      .fn<[input: string | URL | Request, init?: RequestInit], Promise<Response>>()
      .mockResolvedValue(new Response('', { status: 503 }));
    const service = new GatewayDeliveryService(
      persistence,
      [
        new DashboardDeliveryAdapter(),
        new WebhookDeliveryAdapter({ fetchImpl: asFetch(fetchImpl) }),
        new SlackDeliveryAdapter(),
      ],
      { now: () => new Date('2026-05-25T12:02:00Z') },
    );

    const outcomes = await service.deliverAttempts(attempts);

    expect(outcomes.map((outcome) => [outcome.endpointType, outcome.status])).toEqual([
      ['dashboard', 'sent'],
      ['webhook', 'failed'],
      ['slack', 'failed'],
    ]);
    expect(persistence.records).toHaveLength(3);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(persistence.records.find((record) => record.attemptId === 'attempt_webhook')).toMatchObject({
      status: 'failed',
      lastError: 'Webhook delivery failed with HTTP 503',
      responseSummary: {
        backend: 'webhook',
        status: 503,
        ok: false,
      },
    });
  });

  it('uses the webhook signing hook and never persists raw signing material', async () => {
    const persistence = new FakeDeliveryPersistence();
    const [webhookAttempt] = seed(persistence, ['webhook']);
    const fetchImpl = vi
      .fn<[input: string | URL | Request, init?: RequestInit], Promise<Response>>()
      .mockResolvedValue(new Response('', { status: 202 }));
    const service = new GatewayDeliveryService(
      persistence,
      [
        new WebhookDeliveryAdapter({
          fetchImpl: asFetch(fetchImpl),
          signingHook: () => ({
            'x-example-signature': 'sha256=super-secret-signature',
          }),
        }),
      ],
      { now: () => new Date('2026-05-25T12:02:00Z') },
    );

    const [outcome] = await service.deliverAttempts([webhookAttempt]);

    expect(outcome.status).toBe('sent');
    expect(fetchImpl).toHaveBeenCalledWith(
      'https://example.test/gateway-events',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({
          'x-example-signature': 'sha256=super-secret-signature',
        }),
      }),
    );
    expect(JSON.stringify(persistence.records[0])).not.toContain('super-secret-signature');
    expect(JSON.stringify(persistence.records[0])).not.toContain('secret_ref_123');
  });

  it('sanitizes webhook errors before recording them', async () => {
    const persistence = new FakeDeliveryPersistence();
    const [webhookAttempt] = seed(persistence, ['webhook']);
    const fetchImpl = vi
      .fn<[input: string | URL | Request, init?: RequestInit], Promise<Response>>()
      .mockRejectedValue(new Error('POST failed Bearer abc.def?secret=not-kept&safe=yes'));
    const service = new GatewayDeliveryService(persistence, [
      new WebhookDeliveryAdapter({
        fetchImpl: asFetch(fetchImpl),
      }),
    ]);

    const [outcome] = await service.deliverAttempts([webhookAttempt]);

    expect(outcome.status).toBe('failed');
    expect(outcome.lastError).toBe('POST failed Bearer [REDACTED]?secret=[REDACTED]&safe=yes');
  });

  it('records missing channel connections as skipped_no_channel', async () => {
    const persistence = new FakeDeliveryPersistence();
    const [channelAttempt] = seed(persistence, ['channel']);
    const service = new GatewayDeliveryService(persistence, [
      new ChannelDeliveryAdapter({
        async hasConnectedChannel() {
          return false;
        },
      }),
    ]);

    const [outcome] = await service.deliverAttempts([channelAttempt]);

    expect(outcome).toMatchObject({
      endpointType: 'channel',
      status: 'skipped_no_channel',
      retryable: false,
    });
    expect(persistence.records[0]).toMatchObject({
      status: 'skipped_no_channel',
      responseSummary: {
        backend: 'channel',
        reason: 'no_connected_channel',
      },
    });
  });

  it('keeps Slack and email behind the shared adapter interface', async () => {
    const persistence = new FakeDeliveryPersistence();
    const attempts = seed(persistence, ['slack', 'email']);
    const service = new GatewayDeliveryService(persistence, [
      new SlackDeliveryAdapter(),
      new EmailDeliveryAdapter(),
    ]);

    const outcomes = await service.deliverAttempts(attempts);

    expect(outcomes).toMatchObject([
      {
        endpointType: 'slack',
        status: 'failed',
        retryable: false,
      },
      {
        endpointType: 'email',
        status: 'failed',
        retryable: false,
      },
    ]);
  });
});
