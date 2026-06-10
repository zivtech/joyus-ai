/**
 * Notification Service — WP03 (T027)
 *
 * Routes eligible events to external subscribers (webhook endpoints, etc.).
 * This service acts as the bridge between the internal event stream and the
 * Gateway Event Bus.
 *
 * Design:
 * - Implements the `NotificationRouter` interface from event.service.ts.
 * - `route()` is synchronous and fire-and-forget: it must NEVER throw or await
 *   in a way that delays the primary event emission path.
 * - Routable event classes are hardcoded defaults for v1; tenant-specific
 *   delivery configuration lives in the gateway subscription tables.
 *
 * Usage:
 *   const notificationService = new NotificationService();
 *   const eventService = new EventService(db, notificationService);
 *
 */

import type { OrchestratorEvent } from '../db/schema/events.js';
import type { GatewayEventService } from '../gateway-events/event.service.js';
import type { PlatformEventInput } from '../gateway-events/schemas.js';
import { redactSecretsDeep } from '../gateway-events/types.js';

import type { NotificationRouter } from './event.service.js';

// ============================================================
// ROUTABLE EVENT TYPES
// ============================================================

/**
 * Event types that are forwarded to the gateway event bus.
 * These are the default routable types for all tenants.
 *
 * Per-tenant override configuration is deferred to Spec 014.
 */
const ROUTABLE_EVENT_TYPES = new Set<string>([
  'session.completed',
  'session.failed',
  'tool.failed',
]);

// ============================================================
// GATEWAY INTERFACE
// ============================================================

/**
 * Gateway event bus interface. Default implementation logs to console for
 * local tests; production wiring injects GatewayEventServiceBus.
 */
export interface GatewayEventBus {
  /**
   * Forward a routable event to the gateway for external delivery.
   * Implementations should be non-blocking and handle their own errors.
   */
  forward(event: OrchestratorEvent): Promise<void>;
}

/**
 * Stub gateway — logs the event that would be forwarded.
 */
class StubGatewayEventBus implements GatewayEventBus {
  async forward(event: OrchestratorEvent): Promise<void> {
    console.log(
      '[NotificationService] [STUB] Would forward event to gateway:',
      JSON.stringify({
        id: event.id,
        type: event.type,
        tenantId: event.tenantId,
        sessionId: event.sessionId,
        sequence: event.sequence,
      }),
    );
  }
}

export class GatewayEventServiceBus implements GatewayEventBus {
  constructor(private readonly gatewayEvents: Pick<GatewayEventService, 'emitPlatformEvent'>) {}

  async forward(event: OrchestratorEvent): Promise<void> {
    await this.gatewayEvents.emitPlatformEvent(toPlatformEvent(event));
  }
}

// ============================================================
// NOTIFICATION SERVICE
// ============================================================

export class NotificationService implements NotificationRouter {
  constructor(
    private readonly gateway: GatewayEventBus = new StubGatewayEventBus(),
  ) {}

  /**
   * Route a routable event to the gateway event bus.
   *
   * Fire-and-forget: this method MUST be synchronous from the caller's
   * perspective. Any async work is kicked off without awaiting.
   * Errors in delivery are logged but never propagated.
   *
   * Called by EventService.emitEvent() after each successful event insert.
   *
   * @param event - The newly emitted event to route.
   */
  route(event: OrchestratorEvent): void {
    if (!ROUTABLE_EVENT_TYPES.has(event.type)) {
      return; // Not routable — skip silently
    }

    // Fire-and-forget: do not await, do not propagate errors
    void this.forwardSafely(event);
  }

  /**
   * Whether the given event type will be routed to the gateway.
   * Exposed for testing and configuration inspection.
   */
  isRoutable(type: string): boolean {
    return ROUTABLE_EVENT_TYPES.has(type);
  }

  // ---------------------------------------------------------------------------
  // Private helpers
  // ---------------------------------------------------------------------------

  private async forwardSafely(event: OrchestratorEvent): Promise<void> {
    try {
      await this.gateway.forward(event);
    } catch (err) {
      console.error(
        '[NotificationService] Gateway delivery failed (non-fatal):',
        { eventId: event.id, type: event.type, tenantId: event.tenantId },
        err,
      );
    }
  }
}

function toPlatformEvent(event: OrchestratorEvent): PlatformEventInput {
  const failed = event.type.endsWith('.failed');
  return {
    tenantId: event.tenantId,
    type: failed ? 'monitoring.alert' : 'pipeline.completed',
    severity: failed ? 'warning' : 'info',
    sourceSpec: 'gateway-event-bus',
    sourceComponent: 'platform-orchestrator',
    subjectType: event.sessionId ? 'orchestrator_session' : 'orchestrator_event',
    subjectId: event.sessionId ?? event.id,
    correlationId: event.sessionId ?? event.id,
    idempotencyKey: `orchestrator:${event.id}`,
    payloadSchemaVersion: 'orchestrator.event.v1',
    requiresDecision: false,
    payload: {
      orchestratorEventId: event.id,
      orchestratorEventType: event.type,
      sessionId: event.sessionId,
      sequence: event.sequence,
      payload: redactSecretsDeep(event.payload),
    },
    occurredAt: event.createdAt,
  };
}
