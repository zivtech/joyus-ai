import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';

import express from 'express';
import { describe, expect, it, vi } from 'vitest';

import type {
  GatewayDeliveryEndpoint,
  GatewayEventDeliveryAttempt,
  GatewayEventSubscription,
  GatewayPlatformEvent,
} from '../db/schema/gateway-events.js';

import { GatewayEventService } from './event.service.js';
import { createGatewayEventsRouter } from './routes/events.js';
import type {
  DeliveryAttemptInput,
  DeliveryEndpointInput,
  EventSubscriptionInput,
  PlatformEventInput,
} from './schemas.js';
import {
  eventTypeMatches,
  severityMeetsMinimum,
  type GatewayEventStore,
} from './store.js';
import {
  DeliveryEndpointNotFoundError,
  GatewaySubscriptionService,
  TenantMismatchError,
} from './subscription.service.js';

class FakeGatewayEventStore implements GatewayEventStore {
  events: GatewayPlatformEvent[] = [];
  endpoints: GatewayDeliveryEndpoint[] = [];
  subscriptions: GatewayEventSubscription[] = [];
  attempts: GatewayEventDeliveryAttempt[] = [];

  async createPlatformEvent(input: PlatformEventInput): Promise<GatewayPlatformEvent> {
    const event = {
      id: `event_${this.events.length + 1}`,
      tenantId: input.tenantId,
      type: input.type,
      severity: input.severity,
      sourceSpec: input.sourceSpec,
      sourceComponent: input.sourceComponent,
      subjectType: input.subjectType ?? null,
      subjectId: input.subjectId ?? null,
      correlationId: input.correlationId ?? null,
      idempotencyKey: input.idempotencyKey,
      payload: input.payload,
      payloadSchemaVersion: input.payloadSchemaVersion,
      requiresDecision: input.requiresDecision ?? false,
      handlerKey: input.handlerKey ?? null,
      occurredAt: input.occurredAt ?? new Date('2026-05-25T00:00:00Z'),
      emittedAt: new Date('2026-05-25T00:00:00Z'),
    } satisfies GatewayPlatformEvent;
    this.events.push(event);
    return event;
  }

  async findPlatformEventByIdempotencyKey(
    tenantId: string,
    sourceComponent: string,
    idempotencyKey: string,
  ): Promise<GatewayPlatformEvent | null> {
    return this.events.find((event) => (
      event.tenantId === tenantId
      && event.sourceComponent === sourceComponent
      && event.idempotencyKey === idempotencyKey
    )) ?? null;
  }

  async getPlatformEvent(tenantId: string, eventId: string): Promise<GatewayPlatformEvent | null> {
    return this.events.find((event) => event.tenantId === tenantId && event.id === eventId) ?? null;
  }

  async createEndpoint(input: DeliveryEndpointInput): Promise<GatewayDeliveryEndpoint> {
    const endpoint = {
      id: `endpoint_${this.endpoints.length + 1}`,
      tenantId: input.tenantId,
      type: input.type,
      name: input.name,
      config: {},
      secretRef: null,
      isActive: input.isActive ?? true,
      createdBy: input.createdBy ?? null,
      createdAt: new Date('2026-05-25T00:00:00Z'),
      updatedAt: new Date('2026-05-25T00:00:00Z'),
    } satisfies GatewayDeliveryEndpoint;
    this.endpoints.push(endpoint);
    return endpoint;
  }

  async getEndpoint(_tenantId: string, endpointId: string): Promise<GatewayDeliveryEndpoint | null> {
    return this.endpoints.find((endpoint) => endpoint.id === endpointId) ?? null;
  }

  async listEndpoints(tenantId: string): Promise<GatewayDeliveryEndpoint[]> {
    return this.endpoints.filter((endpoint) => endpoint.tenantId === tenantId);
  }

  async createSubscription(input: EventSubscriptionInput): Promise<GatewayEventSubscription> {
    const subscription = {
      id: `subscription_${this.subscriptions.length + 1}`,
      tenantId: input.tenantId,
      eventType: input.eventType,
      minimumSeverity: input.minimumSeverity ?? null,
      endpointId: input.endpointId,
      filter: input.filter ?? null,
      isEnabled: input.isEnabled ?? true,
      createdAt: new Date('2026-05-25T00:00:00Z'),
    } satisfies GatewayEventSubscription;
    this.subscriptions.push(subscription);
    return subscription;
  }

  async listSubscriptions(tenantId: string): Promise<GatewayEventSubscription[]> {
    return this.subscriptions.filter((subscription) => subscription.tenantId === tenantId);
  }

  async listEnabledSubscriptions(tenantId: string): Promise<GatewayEventSubscription[]> {
    return this.subscriptions.filter(
      (subscription) => subscription.tenantId === tenantId && subscription.isEnabled,
    );
  }

  async createDeliveryAttempt(input: DeliveryAttemptInput): Promise<GatewayEventDeliveryAttempt> {
    const attempt = {
      id: `attempt_${this.attempts.length + 1}`,
      tenantId: input.tenantId,
      eventId: input.eventId,
      subscriptionId: input.subscriptionId,
      endpointId: input.endpointId,
      status: input.status ?? 'pending',
      attemptNumber: input.attemptNumber ?? 1,
      maxAttempts: input.maxAttempts ?? 3,
      nextRetryAt: input.nextRetryAt ?? null,
      deliveredAt: input.deliveredAt ?? null,
      lastError: input.lastError ?? null,
      responseSummary: input.responseSummary ?? null,
      createdAt: new Date('2026-05-25T00:00:00Z'),
      updatedAt: new Date('2026-05-25T00:00:00Z'),
    } satisfies GatewayEventDeliveryAttempt;
    this.attempts.push(attempt);
    return attempt;
  }

  async listDeliveryAttempts(
    tenantId: string,
    eventId: string,
  ): Promise<GatewayEventDeliveryAttempt[]> {
    return this.attempts.filter((attempt) => (
      attempt.tenantId === tenantId && attempt.eventId === eventId
    ));
  }
}

function reviewPendingInput(overrides: Partial<PlatformEventInput> = {}): PlatformEventInput {
  return {
    tenantId: 'tenant_123',
    type: 'review.pending',
    severity: 'warning',
    sourceSpec: 'gateway-event-bus',
    sourceComponent: 'pipeline-review',
    idempotencyKey: 'pipeline-review:execution_456:pending',
    payloadSchemaVersion: 'review.pending.v1',
    requiresDecision: true,
    handlerKey: 'pipeline-review',
    payload: { title: 'Review required' },
    ...overrides,
  };
}

function listen(server: Server): Promise<string> {
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      const address = server.address() as AddressInfo;
      resolve(`http://${address.address}:${address.port}`);
    });
  });
}

describe('GatewayEventService', () => {
  it('accepts an event and creates pending attempts for matching subscriptions', async () => {
    const store = new FakeGatewayEventStore();
    const subscriptionService = new GatewaySubscriptionService(store);
    const endpoint = await subscriptionService.createEndpoint({
      tenantId: 'tenant_123',
      type: 'dashboard',
      name: 'Operations Dashboard',
    });
    await subscriptionService.createSubscription({
      tenantId: 'tenant_123',
      eventType: 'review.*',
      minimumSeverity: 'info',
      endpointId: endpoint.id,
    });
    await subscriptionService.createSubscription({
      tenantId: 'tenant_123',
      eventType: 'monitoring.alert',
      endpointId: endpoint.id,
    });

    const service = new GatewayEventService(store, subscriptionService);
    const result = await service.emitPlatformEvent(reviewPendingInput());

    expect(result.status).toBe('accepted');
    expect(result.deliveryAttempts).toHaveLength(1);
    expect(result.deliveryAttempts[0]).toMatchObject({
      status: 'pending',
      tenantId: 'tenant_123',
      endpointId: endpoint.id,
    });
  });

  it('deduplicates by tenant source component and idempotency key', async () => {
    const store = new FakeGatewayEventStore();
    const subscriptionService = new GatewaySubscriptionService(store);
    const service = new GatewayEventService(store, subscriptionService);

    const first = await service.emitPlatformEvent(reviewPendingInput());
    const duplicate = await service.emitPlatformEvent(reviewPendingInput());

    expect(first.status).toBe('accepted');
    expect(duplicate.status).toBe('duplicate');
    expect(store.events).toHaveLength(1);
    expect(store.attempts).toHaveLength(0);
  });

  it('does not create attempts for subscriptions attached to inactive endpoints', async () => {
    const store = new FakeGatewayEventStore();
    const subscriptionService = new GatewaySubscriptionService(store);
    const endpoint = await subscriptionService.createEndpoint({
      tenantId: 'tenant_123',
      type: 'dashboard',
      name: 'Disabled Dashboard',
      isActive: false,
    });
    await subscriptionService.createSubscription({
      tenantId: 'tenant_123',
      eventType: 'review.pending',
      endpointId: endpoint.id,
    });
    const service = new GatewayEventService(store, subscriptionService);

    const result = await service.emitPlatformEvent(reviewPendingInput());

    expect(result.deliveryAttempts).toHaveLength(0);
    expect(store.attempts).toHaveLength(0);
  });

  it('rejects subscription creation when endpoint tenant differs', async () => {
    const store = new FakeGatewayEventStore();
    const subscriptionService = new GatewaySubscriptionService(store);
    store.endpoints.push({
      id: 'endpoint_1',
      tenantId: 'tenant_other',
      type: 'dashboard',
      name: 'Other Tenant Dashboard',
      config: {},
      secretRef: null,
      isActive: true,
      createdBy: null,
      createdAt: new Date('2026-05-25T00:00:00Z'),
      updatedAt: new Date('2026-05-25T00:00:00Z'),
    });

    await expect(subscriptionService.createSubscription({
      tenantId: 'tenant_123',
      eventType: 'review.pending',
      endpointId: 'endpoint_1',
    })).rejects.toThrow(TenantMismatchError);
  });

  it('rejects subscription creation when endpoint is missing', async () => {
    const store = new FakeGatewayEventStore();
    const subscriptionService = new GatewaySubscriptionService(store);

    await expect(subscriptionService.createSubscription({
      tenantId: 'tenant_123',
      eventType: 'review.pending',
      endpointId: 'missing_endpoint',
    })).rejects.toThrow(DeliveryEndpointNotFoundError);
  });
});

describe('gateway event matching', () => {
  it('matches exact and namespace wildcard event types', () => {
    expect(eventTypeMatches('review.pending', 'review.pending')).toBe(true);
    expect(eventTypeMatches('review.*', 'review.pending')).toBe(true);
    expect(eventTypeMatches('monitoring.*', 'review.pending')).toBe(false);
  });

  it('applies severity floors', () => {
    expect(severityMeetsMinimum('critical', 'warning')).toBe(true);
    expect(severityMeetsMinimum('info', 'warning')).toBe(false);
    expect(severityMeetsMinimum('info', null)).toBe(true);
  });
});

describe('gateway event routes', () => {
  it('rejects event emission when request tenant does not match authenticated tenant', async () => {
    const service = {
      emitPlatformEvent: vi.fn(),
    } as unknown as GatewayEventService;
    const app = express();
    app.use(express.json());
    app.use((req, _res, next) => {
      req.tenantId = 'tenant_123';
      next();
    });
    app.use('/gateway/events', createGatewayEventsRouter(service));

    const server = createServer(app);
    const baseUrl = await listen(server);
    try {
      const response = await fetch(`${baseUrl}/gateway/events`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(reviewPendingInput({ tenantId: 'tenant_other' })),
      });

      expect(response.status).toBe(403);
      expect(service.emitPlatformEvent).not.toHaveBeenCalled();
    } finally {
      await new Promise<void>((resolve, reject) => {
        server.close((err) => (err ? reject(err) : resolve()));
      });
    }
  });
});
