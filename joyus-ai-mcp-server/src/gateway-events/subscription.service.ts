import type {
  GatewayDeliveryEndpoint,
  GatewayEventSubscription,
  GatewayPlatformEvent,
} from '../db/schema/gateway-events.js';

import {
  eventSubscriptionInputSchema,
  type EventSubscriptionInput,
  type DeliveryEndpointInput,
  deliveryEndpointInputSchema,
} from './schemas.js';
import {
  eventTypeMatches,
  severityMeetsMinimum,
  type GatewayEventStore,
} from './store.js';
import {
  assertTenantMatch,
  TenantMismatchError,
  type PlatformEventSeverity,
} from './types.js';

export class DeliveryEndpointNotFoundError extends Error {
  constructor(endpointId: string, tenantId: string) {
    super(`Delivery endpoint not found: ${endpointId} (tenant: ${tenantId})`);
    this.name = 'DeliveryEndpointNotFoundError';
  }
}

export class GatewaySubscriptionService {
  constructor(private readonly store: GatewayEventStore) {}

  async createEndpoint(input: DeliveryEndpointInput): Promise<GatewayDeliveryEndpoint> {
    const validated = deliveryEndpointInputSchema.parse(input);
    return this.store.createEndpoint(validated);
  }

  async listEndpoints(tenantId: string): Promise<GatewayDeliveryEndpoint[]> {
    return this.store.listEndpoints(tenantId);
  }

  async createSubscription(input: EventSubscriptionInput): Promise<GatewayEventSubscription> {
    const validated = eventSubscriptionInputSchema.parse(input);
    const endpoint = await this.store.getEndpoint(validated.tenantId, validated.endpointId);
    if (!endpoint) {
      throw new DeliveryEndpointNotFoundError(validated.endpointId, validated.tenantId);
    }

    assertTenantMatch(validated.tenantId, endpoint.tenantId, 'delivery endpoint');
    return this.store.createSubscription(validated);
  }

  async listSubscriptions(tenantId: string): Promise<GatewayEventSubscription[]> {
    return this.store.listSubscriptions(tenantId);
  }

  async listMatchingSubscriptions(event: GatewayPlatformEvent): Promise<GatewayEventSubscription[]> {
    const subscriptions = await this.store.listEnabledSubscriptions(event.tenantId);
    const matchingSubscriptions = subscriptions.filter((subscription) => (
      eventTypeMatches(subscription.eventType, event.type)
      && severityMeetsMinimum(
        event.severity as PlatformEventSeverity,
        subscription.minimumSeverity as PlatformEventSeverity | null,
      )
    ));

    const activeMatches: GatewayEventSubscription[] = [];
    for (const subscription of matchingSubscriptions) {
      const endpoint = await this.store.getEndpoint(event.tenantId, subscription.endpointId);
      if (endpoint?.isActive) {
        activeMatches.push(subscription);
      }
    }

    return activeMatches;
  }
}

export { TenantMismatchError };
