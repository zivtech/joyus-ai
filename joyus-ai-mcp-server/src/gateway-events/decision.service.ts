import type {
  GatewayDecisionRecord,
  GatewayPlatformEvent,
} from '../db/schema/gateway-events.js';

import type { GatewayDecisionHandlerRegistry } from './handler-registry.js';
import { gatewayDecisionInputSchema, type GatewayDecisionInput } from './schemas.js';
import {
  assertTenantMatch,
  sanitizeErrorSummary,
  type DecisionRouteStatus,
  type GatewayDecision,
  type DecisionSourceBackend,
} from './types.js';

export interface CreateGatewayDecisionRecordInput {
  tenantId: string;
  eventId: string;
  decision: GatewayDecision;
  decisionBy: string;
  sourceBackend: DecisionSourceBackend;
  idempotencyKey: string;
  metadata: Record<string, unknown>;
  handlerKey: string;
  routeStatus: DecisionRouteStatus;
  routeError?: string;
}

export interface UpdateGatewayDecisionRouteInput {
  routeStatus: DecisionRouteStatus;
  routeError?: string;
}

export interface GatewayDecisionPersistence {
  getPlatformEvent(tenantId: string, eventId: string): Promise<GatewayPlatformEvent | null>;
  findDecisionByIdempotencyKey(
    tenantId: string,
    eventId: string,
    idempotencyKey: string,
  ): Promise<GatewayDecisionRecord | null>;
  createDecision(input: CreateGatewayDecisionRecordInput): Promise<GatewayDecisionRecord>;
  updateDecisionRoute(
    tenantId: string,
    decisionId: string,
    input: UpdateGatewayDecisionRouteInput,
  ): Promise<GatewayDecisionRecord>;
}

export type IngestGatewayDecisionStatus =
  | 'routed'
  | 'duplicate'
  | 'rejected'
  | 'failed';

export interface IngestGatewayDecisionResult {
  status: IngestGatewayDecisionStatus;
  decision: GatewayDecisionRecord;
  handlerInvoked: boolean;
}

export class GatewayDecisionEventNotFoundError extends Error {
  constructor(eventId: string, tenantId: string) {
    super(`Gateway decision event not found: ${eventId} (tenant: ${tenantId})`);
    this.name = 'GatewayDecisionEventNotFoundError';
  }
}

export class GatewayDecisionService {
  constructor(
    private readonly persistence: GatewayDecisionPersistence,
    private readonly handlers: GatewayDecisionHandlerRegistry,
  ) {}

  async ingestDecision(input: GatewayDecisionInput): Promise<IngestGatewayDecisionResult> {
    const validated = gatewayDecisionInputSchema.parse(input);
    const event = await this.persistence.getPlatformEvent(validated.tenantId, validated.eventId);
    if (!event) {
      throw new GatewayDecisionEventNotFoundError(validated.eventId, validated.tenantId);
    }

    assertTenantMatch(validated.tenantId, event.tenantId, 'decision event');

    const existing = await this.persistence.findDecisionByIdempotencyKey(
      validated.tenantId,
      validated.eventId,
      validated.idempotencyKey,
    );
    if (existing) {
      return {
        status: 'duplicate',
        decision: existing,
        handlerInvoked: false,
      };
    }

    const handlerKey = event.handlerKey ?? '';
    const decision = await this.persistence.createDecision({
      tenantId: validated.tenantId,
      eventId: validated.eventId,
      decision: validated.decision,
      decisionBy: validated.decisionBy,
      sourceBackend: validated.sourceBackend,
      idempotencyKey: validated.idempotencyKey,
      metadata: validated.metadata,
      handlerKey,
      routeStatus: 'pending',
    });

    if (!event.requiresDecision || !handlerKey) {
      return this.rejectDecision(
        decision,
        'Event is not configured for gateway decisions',
      );
    }

    try {
      const routeResult = await this.handlers.route({
        tenantId: decision.tenantId,
        eventId: decision.eventId,
        handlerKey,
        decision: decision.decision,
        decisionBy: decision.decisionBy,
        sourceBackend: decision.sourceBackend,
        metadata: decision.metadata,
      });

      if (routeResult.status === 'routed') {
        const routed = await this.persistence.updateDecisionRoute(decision.tenantId, decision.id, {
          routeStatus: 'routed',
        });
        return {
          status: 'routed',
          decision: routed,
          handlerInvoked: true,
        };
      }

      const updated = await this.persistence.updateDecisionRoute(decision.tenantId, decision.id, {
        routeStatus: routeResult.status,
        routeError: sanitizeErrorSummary(routeResult.error).slice(0, 2000),
      });
      return {
        status: routeResult.status,
        decision: updated,
        handlerInvoked: true,
      };
    } catch (error) {
      const updated = await this.persistence.updateDecisionRoute(decision.tenantId, decision.id, {
        routeStatus: 'failed',
        routeError: sanitizeErrorSummary(error).slice(0, 2000),
      });
      return {
        status: 'failed',
        decision: updated,
        handlerInvoked: true,
      };
    }
  }

  private async rejectDecision(
    decision: GatewayDecisionRecord,
    reason: string,
  ): Promise<IngestGatewayDecisionResult> {
    const rejected = await this.persistence.updateDecisionRoute(decision.tenantId, decision.id, {
      routeStatus: 'rejected',
      routeError: sanitizeErrorSummary(reason).slice(0, 2000),
    });
    return {
      status: 'rejected',
      decision: rejected,
      handlerInvoked: false,
    };
  }
}
