import type {
  GatewayAuditRecord,
  GatewayDecisionRecord,
  GatewayEventDeliveryAttempt,
  GatewayPlatformEvent,
} from '../db/schema/gateway-events.js';

import { requireTenantScope } from './dead-letter.service.js';
import {
  redactSecretsDeep,
  sanitizeErrorSummary,
  type DeliveryEndpointType,
  type DeliveryStatus,
  type GatewayAuditAction,
} from './types.js';

export interface CreateGatewayAuditRecordInput {
  tenantId: string;
  action: GatewayAuditAction;
  eventId?: string;
  deliveryAttemptId?: string;
  decisionId?: string;
  endpointId?: string;
  sourceBackend?: DeliveryEndpointType;
  idempotencyKey?: string;
  summary?: Record<string, unknown>;
  errorSummary?: string;
}

export interface GatewayAuditQuery {
  action?: GatewayAuditAction;
  eventId?: string;
  deliveryAttemptId?: string;
  decisionId?: string;
}

export interface GatewayAuditStore {
  createAuditRecord(input: CreateGatewayAuditRecordInput): Promise<GatewayAuditRecord>;
  listAuditRecords(
    tenantId: string,
    query?: GatewayAuditQuery,
  ): Promise<GatewayAuditRecord[]>;
}

export interface GatewayDeliveryMetrics {
  total: number;
  sent: number;
  failed: number;
  retryScheduled: number;
  deadLetter: number;
  skippedNoChannel: number;
}

const DELIVERY_AUDIT_ACTION_BY_STATUS: Record<DeliveryStatus, GatewayAuditAction> = {
  pending: 'delivery.created',
  sent: 'delivery.sent',
  failed: 'delivery.failed',
  retry_scheduled: 'delivery.retry_scheduled',
  dead_letter: 'delivery.dead_lettered',
  skipped_no_channel: 'delivery.skipped_no_channel',
};

export class GatewayAuditService {
  constructor(private readonly store: GatewayAuditStore) {}

  async recordEventAccepted(
    event: GatewayPlatformEvent,
    duplicate = false,
  ): Promise<GatewayAuditRecord> {
    return this.create({
      tenantId: event.tenantId,
      action: duplicate ? 'event.duplicate' : 'event.accepted',
      eventId: event.id,
      idempotencyKey: event.idempotencyKey,
      summary: {
        type: event.type,
        severity: event.severity,
        sourceComponent: event.sourceComponent,
        requiresDecision: event.requiresDecision,
      },
    });
  }

  async recordDeliveryAttempt(
    attempt: GatewayEventDeliveryAttempt,
    sourceBackend?: DeliveryEndpointType,
  ): Promise<GatewayAuditRecord> {
    return this.create({
      tenantId: attempt.tenantId,
      action: DELIVERY_AUDIT_ACTION_BY_STATUS[attempt.status],
      eventId: attempt.eventId,
      deliveryAttemptId: attempt.id,
      endpointId: attempt.endpointId,
      sourceBackend,
      summary: {
        status: attempt.status,
        attemptNumber: attempt.attemptNumber,
        maxAttempts: attempt.maxAttempts,
        nextRetryAt: attempt.nextRetryAt?.toISOString(),
        deliveredAt: attempt.deliveredAt?.toISOString(),
        responseSummary: attempt.responseSummary ?? {},
      },
      errorSummary: attempt.lastError ?? undefined,
    });
  }

  async recordDecision(
    decision: GatewayDecisionRecord,
  ): Promise<GatewayAuditRecord> {
    return this.create({
      tenantId: decision.tenantId,
      action: decisionRouteAction(decision.routeStatus),
      eventId: decision.eventId,
      decisionId: decision.id,
      sourceBackend: decision.sourceBackend,
      idempotencyKey: decision.idempotencyKey,
      summary: {
        decision: decision.decision,
        decisionBy: decision.decisionBy,
        handlerKey: decision.handlerKey,
        routeStatus: decision.routeStatus,
        metadata: decision.metadata,
      },
      errorSummary: decision.routeError ?? undefined,
    });
  }

  async listTenantAuditRecords(
    tenantId: string,
    query: GatewayAuditQuery = {},
  ): Promise<GatewayAuditRecord[]> {
    requireTenantScope(tenantId);
    return this.store.listAuditRecords(tenantId, query);
  }

  summarizeDeliveryAttempts(
    tenantId: string,
    attempts: GatewayEventDeliveryAttempt[],
  ): GatewayDeliveryMetrics {
    requireTenantScope(tenantId);
    const scopedAttempts = attempts.filter((attempt) => attempt.tenantId === tenantId);
    return summarizeDeliveryAttempts(scopedAttempts);
  }

  private create(input: CreateGatewayAuditRecordInput): Promise<GatewayAuditRecord> {
    requireTenantScope(input.tenantId);
    return this.store.createAuditRecord({
      ...input,
      summary: sanitizeSummary(input.summary ?? {}),
      errorSummary: input.errorSummary
        ? sanitizeErrorSummary(input.errorSummary).slice(0, 2000)
        : undefined,
    });
  }
}

export function summarizeDeliveryAttempts(
  attempts: GatewayEventDeliveryAttempt[],
): GatewayDeliveryMetrics {
  const metrics: GatewayDeliveryMetrics = {
    total: attempts.length,
    sent: 0,
    failed: 0,
    retryScheduled: 0,
    deadLetter: 0,
    skippedNoChannel: 0,
  };

  for (const attempt of attempts) {
    switch (attempt.status) {
      case 'sent':
        metrics.sent += 1;
        break;
      case 'failed':
        metrics.failed += 1;
        break;
      case 'retry_scheduled':
        metrics.retryScheduled += 1;
        break;
      case 'dead_letter':
        metrics.deadLetter += 1;
        break;
      case 'skipped_no_channel':
        metrics.skippedNoChannel += 1;
        break;
      case 'pending':
        break;
    }
  }

  return metrics;
}

function decisionRouteAction(routeStatus: GatewayDecisionRecord['routeStatus']): GatewayAuditAction {
  switch (routeStatus) {
    case 'pending':
      return 'decision.accepted';
    case 'routed':
      return 'decision.routed';
    case 'failed':
      return 'decision.failed';
    case 'rejected':
      return 'decision.rejected';
  }
}

function sanitizeSummary(summary: Record<string, unknown>): Record<string, unknown> {
  const redacted = redactSecretsDeep(summary);
  return redacted && typeof redacted === 'object' && !Array.isArray(redacted)
    ? redacted as Record<string, unknown>
    : { value: redacted };
}
