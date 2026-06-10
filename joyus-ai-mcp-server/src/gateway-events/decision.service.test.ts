import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';

import express from 'express';
import { describe, expect, it, vi } from 'vitest';

import type {
  GatewayDecisionRecord,
  GatewayPlatformEvent,
} from '../db/schema/gateway-events.js';

import { GatewayDecisionService, type GatewayDecisionPersistence } from './decision.service.js';
import {
  createMonitoringDecisionHandler,
  createPipelineReviewDecisionHandler,
  GatewayDecisionHandlerRegistry,
} from './handler-registry.js';
import { createGatewayDecisionsRouter } from './routes/decisions.js';
import type { GatewayDecisionInput } from './schemas.js';
import type { DecisionRouteStatus } from './types.js';

class FakeDecisionPersistence implements GatewayDecisionPersistence {
  events = new Map<string, GatewayPlatformEvent>();
  decisions: GatewayDecisionRecord[] = [];

  async getPlatformEvent(_tenantId: string, eventId: string): Promise<GatewayPlatformEvent | null> {
    return this.events.get(eventId) ?? null;
  }

  async findDecisionByIdempotencyKey(
    tenantId: string,
    eventId: string,
    idempotencyKey: string,
  ): Promise<GatewayDecisionRecord | null> {
    return this.decisions.find((decision) => (
      decision.tenantId === tenantId
      && decision.eventId === eventId
      && decision.idempotencyKey === idempotencyKey
    )) ?? null;
  }

  async createDecision(
    input: Parameters<GatewayDecisionPersistence['createDecision']>[0],
  ): Promise<GatewayDecisionRecord> {
    const record = {
      id: `decision_${this.decisions.length + 1}`,
      tenantId: input.tenantId,
      eventId: input.eventId,
      decision: input.decision,
      decisionBy: input.decisionBy,
      sourceBackend: input.sourceBackend,
      idempotencyKey: input.idempotencyKey,
      metadata: input.metadata,
      receivedAt: new Date('2026-05-25T12:00:00Z'),
      handlerKey: input.handlerKey,
      routeStatus: input.routeStatus,
      routeError: input.routeError ?? null,
    } satisfies GatewayDecisionRecord;
    this.decisions.push(record);
    return record;
  }

  async updateDecisionRoute(
    tenantId: string,
    decisionId: string,
    input: {
      routeStatus: DecisionRouteStatus;
      routeError?: string;
    },
  ): Promise<GatewayDecisionRecord> {
    const index = this.decisions.findIndex((decision) => (
      decision.tenantId === tenantId && decision.id === decisionId
    ));
    if (index < 0) {
      throw new Error(`missing decision ${decisionId}`);
    }

    const updated = {
      ...this.decisions[index],
      routeStatus: input.routeStatus,
      routeError: input.routeError ?? null,
    } satisfies GatewayDecisionRecord;
    this.decisions[index] = updated;
    return updated;
  }
}

function decisionInput(overrides: Partial<GatewayDecisionInput> = {}): GatewayDecisionInput {
  return {
    tenantId: 'tenant_123',
    eventId: 'event_1',
    decision: 'approved',
    decisionBy: 'admin_123',
    sourceBackend: 'dashboard',
    idempotencyKey: 'decision:event_1:admin_123',
    metadata: { comment: 'Looks correct' },
    ...overrides,
  };
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

function decisionRecord(overrides: Partial<GatewayDecisionRecord> = {}): GatewayDecisionRecord {
  return {
    id: 'decision_existing',
    tenantId: 'tenant_123',
    eventId: 'event_1',
    decision: 'approved',
    decisionBy: 'admin_123',
    sourceBackend: 'dashboard',
    idempotencyKey: 'decision:event_1:admin_123',
    metadata: {},
    receivedAt: new Date('2026-05-25T12:00:00Z'),
    handlerKey: 'pipeline-review',
    routeStatus: 'routed',
    routeError: null,
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

describe('GatewayDecisionService', () => {
  it('routes accepted decisions to registered domain handlers', async () => {
    const persistence = new FakeDecisionPersistence();
    persistence.events.set('event_1', event());
    const registry = new GatewayDecisionHandlerRegistry();
    const routeReviewDecision = vi.fn().mockResolvedValue({ resumed: true });
    registry.register('pipeline-review', createPipelineReviewDecisionHandler({
      routeReviewDecision,
    }));
    const service = new GatewayDecisionService(persistence, registry);

    const result = await service.ingestDecision(decisionInput());

    expect(result).toMatchObject({
      status: 'routed',
      handlerInvoked: true,
    });
    expect(result.decision.routeStatus).toBe('routed');
    expect(routeReviewDecision).toHaveBeenCalledOnce();
  });

  it('deduplicates by tenant event and idempotency key without invoking handlers twice', async () => {
    const persistence = new FakeDecisionPersistence();
    persistence.events.set('event_1', event());
    persistence.decisions.push(decisionRecord());
    const registry = new GatewayDecisionHandlerRegistry();
    const routeReviewDecision = vi.fn();
    registry.register('pipeline-review', createPipelineReviewDecisionHandler({
      routeReviewDecision,
    }));
    const service = new GatewayDecisionService(persistence, registry);

    const result = await service.ingestDecision(decisionInput());

    expect(result.status).toBe('duplicate');
    expect(result.handlerInvoked).toBe(false);
    expect(routeReviewDecision).not.toHaveBeenCalled();
  });

  it('records rejected decisions when the event is not decision-capable', async () => {
    const persistence = new FakeDecisionPersistence();
    persistence.events.set('event_1', event({
      requiresDecision: false,
      handlerKey: null,
    }));
    const service = new GatewayDecisionService(
      persistence,
      new GatewayDecisionHandlerRegistry(),
    );

    const result = await service.ingestDecision(decisionInput());

    expect(result).toMatchObject({
      status: 'rejected',
      handlerInvoked: false,
    });
    expect(result.decision.routeError).toBe('Event is not configured for gateway decisions');
  });

  it('sanitizes handler failures before persistence', async () => {
    const persistence = new FakeDecisionPersistence();
    persistence.events.set('event_1', event());
    const registry = new GatewayDecisionHandlerRegistry();
    registry.register('pipeline-review', () => {
      throw new Error('handler failed Bearer abc.def?secret=not-kept');
    });
    const service = new GatewayDecisionService(persistence, registry);

    const result = await service.ingestDecision(decisionInput());

    expect(result.status).toBe('failed');
    expect(result.decision.routeError).toBe('handler failed Bearer [REDACTED]?secret=[REDACTED]');
  });

  it('uses the monitoring adapter for acknowledge and dismiss decisions only', async () => {
    const registry = new GatewayDecisionHandlerRegistry();
    const routeMonitoringDecision = vi.fn().mockResolvedValue({ alertUpdated: true });
    const handler = createMonitoringDecisionHandler({ routeMonitoringDecision });

    await expect(handler({
      tenantId: 'tenant_123',
      eventId: 'event_1',
      handlerKey: 'monitoring-alert',
      decision: 'acknowledged',
      decisionBy: 'admin_123',
      sourceBackend: 'dashboard',
      metadata: {},
    })).resolves.toMatchObject({ status: 'routed' });

    await expect(handler({
      tenantId: 'tenant_123',
      eventId: 'event_1',
      handlerKey: 'monitoring-alert',
      decision: 'approved',
      decisionBy: 'admin_123',
      sourceBackend: 'dashboard',
      metadata: {},
    })).resolves.toMatchObject({ status: 'rejected' });
    expect(registry.has('monitoring-alert')).toBe(false);
  });
});

describe('gateway decision route', () => {
  it('rejects decision ingestion when request tenant does not match authenticated tenant', async () => {
    const service = {
      ingestDecision: vi.fn(),
    } as unknown as GatewayDecisionService;
    const app = express();
    app.use(express.json());
    app.use((req, _res, next) => {
      req.tenantId = 'tenant_123';
      next();
    });
    app.use('/gateway/decisions', createGatewayDecisionsRouter(service));

    const server = createServer(app);
    const baseUrl = await listen(server);
    try {
      const response = await fetch(`${baseUrl}/gateway/decisions`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(decisionInput({ tenantId: 'tenant_other' })),
      });

      expect(response.status).toBe(403);
      expect(service.ingestDecision).not.toHaveBeenCalled();
    } finally {
      await new Promise<void>((resolve, reject) => {
        server.close((err) => (err ? reject(err) : resolve()));
      });
    }
  });
});
