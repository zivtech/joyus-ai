import { createId } from '@paralleldrive/cuid2';
import { and, desc, eq, lte } from 'drizzle-orm';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';

import {
  gatewayAuditRecords,
  gatewayChannelConnections,
  gatewayDecisions,
  gatewayDeliveryEndpoints,
  gatewayEventDeliveryAttempts,
  gatewayEventSubscriptions,
  gatewayPlatformEvents,
  type GatewayAuditRecord,
  type GatewayChannelConnection,
  type GatewayDecisionRecord,
  type GatewayDeliveryEndpoint,
  type GatewayEventDeliveryAttempt,
  type GatewayEventSubscription,
  type GatewayPlatformEvent,
} from '../db/schema/gateway-events.js';

import type {
  CreateGatewayAuditRecordInput,
  GatewayAuditQuery,
  GatewayAuditStore,
} from './audit.service.js';
import type {
  DeliveryAttemptStatePatch,
  DeliveryAttemptStateStore,
} from './dead-letter.service.js';
import type {
  CreateGatewayDecisionRecordInput,
  GatewayDecisionPersistence,
  UpdateGatewayDecisionRouteInput,
} from './decision.service.js';
import type {
  DeliveryAttemptInput,
  DeliveryEndpointInput,
  EventSubscriptionInput,
  PlatformEventInput,
} from './schemas.js';
import type { DeliveryStatus, PlatformEventSeverity } from './types.js';

export interface GatewayEventStore {
  createPlatformEvent(input: PlatformEventInput): Promise<GatewayPlatformEvent>;
  findPlatformEventByIdempotencyKey(
    tenantId: string,
    sourceComponent: string,
    idempotencyKey: string,
  ): Promise<GatewayPlatformEvent | null>;
  getPlatformEvent(tenantId: string, eventId: string): Promise<GatewayPlatformEvent | null>;
  createEndpoint(input: DeliveryEndpointInput): Promise<GatewayDeliveryEndpoint>;
  getEndpoint(tenantId: string, endpointId: string): Promise<GatewayDeliveryEndpoint | null>;
  listEndpoints(tenantId: string): Promise<GatewayDeliveryEndpoint[]>;
  createSubscription(input: EventSubscriptionInput): Promise<GatewayEventSubscription>;
  listSubscriptions(tenantId: string): Promise<GatewayEventSubscription[]>;
  listEnabledSubscriptions(tenantId: string): Promise<GatewayEventSubscription[]>;
  createDeliveryAttempt(input: DeliveryAttemptInput): Promise<GatewayEventDeliveryAttempt>;
  listDeliveryAttempts(
    tenantId: string,
    eventId: string,
  ): Promise<GatewayEventDeliveryAttempt[]>;
}

function endpointConfigAndSecretRef(input: DeliveryEndpointInput): {
  config: Record<string, unknown>;
  secretRef?: string;
} {
  switch (input.type) {
    case 'webhook':
      return {
        config: { url: input.url },
        secretRef: input.hmacSecretRef,
      };
    case 'slack':
      return {
        config: {},
        secretRef: input.webhookSecretRef,
      };
    case 'email':
      return {
        config: { addresses: input.addresses },
        secretRef: input.credentialSecretRef,
      };
    case 'dashboard':
    case 'channel':
      return { config: {} };
  }
}

export class DrizzleGatewayEventStore implements
  GatewayEventStore,
  GatewayDecisionPersistence,
  DeliveryAttemptStateStore,
  GatewayAuditStore {
  constructor(private readonly db: NodePgDatabase<Record<string, unknown>>) {}

  async createPlatformEvent(input: PlatformEventInput): Promise<GatewayPlatformEvent> {
    const now = new Date();
    const [event] = await this.db
      .insert(gatewayPlatformEvents)
      .values({
        id: createId(),
        tenantId: input.tenantId,
        type: input.type,
        severity: input.severity,
        sourceSpec: input.sourceSpec,
        sourceComponent: input.sourceComponent,
        subjectType: input.subjectType,
        subjectId: input.subjectId,
        correlationId: input.correlationId,
        idempotencyKey: input.idempotencyKey,
        payload: input.payload,
        payloadSchemaVersion: input.payloadSchemaVersion,
        requiresDecision: input.requiresDecision ?? false,
        handlerKey: input.handlerKey,
        occurredAt: input.occurredAt ?? now,
        emittedAt: now,
      })
      .returning();

    return event;
  }

  async findPlatformEventByIdempotencyKey(
    tenantId: string,
    sourceComponent: string,
    idempotencyKey: string,
  ): Promise<GatewayPlatformEvent | null> {
    const [event] = await this.db
      .select()
      .from(gatewayPlatformEvents)
      .where(
        and(
          eq(gatewayPlatformEvents.tenantId, tenantId),
          eq(gatewayPlatformEvents.sourceComponent, sourceComponent),
          eq(gatewayPlatformEvents.idempotencyKey, idempotencyKey),
        ),
      )
      .limit(1);

    return event ?? null;
  }

  async getPlatformEvent(tenantId: string, eventId: string): Promise<GatewayPlatformEvent | null> {
    const [event] = await this.db
      .select()
      .from(gatewayPlatformEvents)
      .where(and(eq(gatewayPlatformEvents.tenantId, tenantId), eq(gatewayPlatformEvents.id, eventId)))
      .limit(1);

    return event ?? null;
  }

  async createEndpoint(input: DeliveryEndpointInput): Promise<GatewayDeliveryEndpoint> {
    const { config, secretRef } = endpointConfigAndSecretRef(input);
    const now = new Date();
    const [endpoint] = await this.db
      .insert(gatewayDeliveryEndpoints)
      .values({
        id: createId(),
        tenantId: input.tenantId,
        type: input.type,
        name: input.name,
        config,
        secretRef,
        isActive: input.isActive ?? true,
        createdBy: input.createdBy,
        createdAt: now,
        updatedAt: now,
      })
      .returning();

    return endpoint;
  }

  async getEndpoint(tenantId: string, endpointId: string): Promise<GatewayDeliveryEndpoint | null> {
    const [endpoint] = await this.db
      .select()
      .from(gatewayDeliveryEndpoints)
      .where(
        and(eq(gatewayDeliveryEndpoints.tenantId, tenantId), eq(gatewayDeliveryEndpoints.id, endpointId)),
      )
      .limit(1);

    return endpoint ?? null;
  }

  async listEndpoints(tenantId: string): Promise<GatewayDeliveryEndpoint[]> {
    return this.db
      .select()
      .from(gatewayDeliveryEndpoints)
      .where(eq(gatewayDeliveryEndpoints.tenantId, tenantId))
      .orderBy(desc(gatewayDeliveryEndpoints.createdAt));
  }

  async createSubscription(input: EventSubscriptionInput): Promise<GatewayEventSubscription> {
    const [subscription] = await this.db
      .insert(gatewayEventSubscriptions)
      .values({
        id: createId(),
        tenantId: input.tenantId,
        eventType: input.eventType,
        minimumSeverity: input.minimumSeverity,
        endpointId: input.endpointId,
        filter: input.filter,
        isEnabled: input.isEnabled ?? true,
        createdAt: new Date(),
      })
      .returning();

    return subscription;
  }

  async listSubscriptions(tenantId: string): Promise<GatewayEventSubscription[]> {
    return this.db
      .select()
      .from(gatewayEventSubscriptions)
      .where(eq(gatewayEventSubscriptions.tenantId, tenantId))
      .orderBy(desc(gatewayEventSubscriptions.createdAt));
  }

  async listEnabledSubscriptions(tenantId: string): Promise<GatewayEventSubscription[]> {
    return this.db
      .select()
      .from(gatewayEventSubscriptions)
      .where(
        and(
          eq(gatewayEventSubscriptions.tenantId, tenantId),
          eq(gatewayEventSubscriptions.isEnabled, true),
        ),
      );
  }

  async createDeliveryAttempt(input: DeliveryAttemptInput): Promise<GatewayEventDeliveryAttempt> {
    const now = new Date();
    const [attempt] = await this.db
      .insert(gatewayEventDeliveryAttempts)
      .values({
        id: createId(),
        tenantId: input.tenantId,
        eventId: input.eventId,
        subscriptionId: input.subscriptionId,
        endpointId: input.endpointId,
        status: input.status ?? 'pending',
        attemptNumber: input.attemptNumber ?? 1,
        maxAttempts: input.maxAttempts ?? 3,
        nextRetryAt: input.nextRetryAt,
        deliveredAt: input.deliveredAt,
        lastError: input.lastError,
        responseSummary: input.responseSummary,
        createdAt: now,
        updatedAt: now,
      })
      .returning();

    return attempt;
  }

  async listDeliveryAttempts(
    tenantId: string,
    eventId: string,
  ): Promise<GatewayEventDeliveryAttempt[]> {
    return this.db
      .select()
      .from(gatewayEventDeliveryAttempts)
      .where(
        and(
          eq(gatewayEventDeliveryAttempts.tenantId, tenantId),
          eq(gatewayEventDeliveryAttempts.eventId, eventId),
        ),
      )
      .orderBy(desc(gatewayEventDeliveryAttempts.createdAt));
  }

  async updateDeliveryAttempt(
    tenantId: string,
    attemptId: string,
    patch: DeliveryAttemptStatePatch,
  ): Promise<GatewayEventDeliveryAttempt> {
    const [attempt] = await this.db
      .update(gatewayEventDeliveryAttempts)
      .set({
        ...patch,
        updatedAt: patch.updatedAt ?? new Date(),
      })
      .where(
        and(
          eq(gatewayEventDeliveryAttempts.tenantId, tenantId),
          eq(gatewayEventDeliveryAttempts.id, attemptId),
        ),
      )
      .returning();

    if (!attempt) {
      throw new Error(`Delivery attempt not found: ${attemptId}`);
    }
    return attempt;
  }

  async listDeliveryAttemptsByStatus(
    tenantId: string,
    status: DeliveryStatus,
  ): Promise<GatewayEventDeliveryAttempt[]> {
    return this.db
      .select()
      .from(gatewayEventDeliveryAttempts)
      .where(
        and(
          eq(gatewayEventDeliveryAttempts.tenantId, tenantId),
          eq(gatewayEventDeliveryAttempts.status, status),
        ),
      )
      .orderBy(desc(gatewayEventDeliveryAttempts.updatedAt));
  }

  async listDueRetryAttempts(now: Date, limit: number): Promise<GatewayEventDeliveryAttempt[]> {
    return this.db
      .select()
      .from(gatewayEventDeliveryAttempts)
      .where(
        and(
          eq(gatewayEventDeliveryAttempts.status, 'retry_scheduled'),
          lte(gatewayEventDeliveryAttempts.nextRetryAt, now),
        ),
      )
      .orderBy(gatewayEventDeliveryAttempts.nextRetryAt)
      .limit(limit);
  }

  async findDecisionByIdempotencyKey(
    tenantId: string,
    eventId: string,
    idempotencyKey: string,
  ): Promise<GatewayDecisionRecord | null> {
    const [decision] = await this.db
      .select()
      .from(gatewayDecisions)
      .where(
        and(
          eq(gatewayDecisions.tenantId, tenantId),
          eq(gatewayDecisions.eventId, eventId),
          eq(gatewayDecisions.idempotencyKey, idempotencyKey),
        ),
      )
      .limit(1);

    return decision ?? null;
  }

  async createDecision(input: CreateGatewayDecisionRecordInput): Promise<GatewayDecisionRecord> {
    const [decision] = await this.db
      .insert(gatewayDecisions)
      .values({
        id: createId(),
        tenantId: input.tenantId,
        eventId: input.eventId,
        decision: input.decision,
        decisionBy: input.decisionBy,
        sourceBackend: input.sourceBackend,
        idempotencyKey: input.idempotencyKey,
        metadata: input.metadata,
        handlerKey: input.handlerKey,
        routeStatus: input.routeStatus,
        routeError: input.routeError,
        receivedAt: new Date(),
      })
      .returning();

    return decision;
  }

  async updateDecisionRoute(
    tenantId: string,
    decisionId: string,
    input: UpdateGatewayDecisionRouteInput,
  ): Promise<GatewayDecisionRecord> {
    const [decision] = await this.db
      .update(gatewayDecisions)
      .set({
        routeStatus: input.routeStatus,
        routeError: input.routeError,
      })
      .where(and(eq(gatewayDecisions.tenantId, tenantId), eq(gatewayDecisions.id, decisionId)))
      .returning();

    if (!decision) {
      throw new Error(`Gateway decision not found: ${decisionId}`);
    }
    return decision;
  }

  async createAuditRecord(input: CreateGatewayAuditRecordInput): Promise<GatewayAuditRecord> {
    const [record] = await this.db
      .insert(gatewayAuditRecords)
      .values({
        id: createId(),
        tenantId: input.tenantId,
        action: input.action,
        eventId: input.eventId,
        deliveryAttemptId: input.deliveryAttemptId,
        decisionId: input.decisionId,
        endpointId: input.endpointId,
        sourceBackend: input.sourceBackend,
        idempotencyKey: input.idempotencyKey,
        summary: input.summary ?? {},
        errorSummary: input.errorSummary,
        createdAt: new Date(),
      })
      .returning();

    return record;
  }

  async listAuditRecords(
    tenantId: string,
    query: GatewayAuditQuery = {},
  ): Promise<GatewayAuditRecord[]> {
    return this.db
      .select()
      .from(gatewayAuditRecords)
      .where(
        and(
          eq(gatewayAuditRecords.tenantId, tenantId),
          ...(query.action ? [eq(gatewayAuditRecords.action, query.action)] : []),
          ...(query.eventId ? [eq(gatewayAuditRecords.eventId, query.eventId)] : []),
          ...(query.deliveryAttemptId
            ? [eq(gatewayAuditRecords.deliveryAttemptId, query.deliveryAttemptId)]
            : []),
          ...(query.decisionId ? [eq(gatewayAuditRecords.decisionId, query.decisionId)] : []),
        ),
      )
      .orderBy(desc(gatewayAuditRecords.createdAt));
  }

  async listConnectedChannelConnections(tenantId: string): Promise<GatewayChannelConnection[]> {
    return this.db
      .select()
      .from(gatewayChannelConnections)
      .where(
        and(
          eq(gatewayChannelConnections.tenantId, tenantId),
          eq(gatewayChannelConnections.status, 'connected'),
        ),
      );
  }
}

const severityRank: Record<PlatformEventSeverity, number> = {
  info: 0,
  warning: 1,
  critical: 2,
};

export function eventTypeMatches(subscriptionType: string, eventType: string): boolean {
  if (subscriptionType === eventType) {
    return true;
  }
  if (!subscriptionType.endsWith('.*')) {
    return false;
  }

  const prefix = subscriptionType.slice(0, -1);
  return eventType.startsWith(prefix);
}

export function severityMeetsMinimum(
  eventSeverity: PlatformEventSeverity,
  minimumSeverity: PlatformEventSeverity | null,
): boolean {
  if (!minimumSeverity) {
    return true;
  }
  return severityRank[eventSeverity] >= severityRank[minimumSeverity];
}
