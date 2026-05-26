import type {
  GatewayEventDeliveryAttempt,
  GatewayPlatformEvent,
} from '../db/schema/gateway-events.js';

import {
  deliveryAttemptInputSchema,
  platformEventInputSchema,
  type PlatformEventInput,
} from './schemas.js';
import type { GatewayEventStore } from './store.js';
import type { GatewaySubscriptionService } from './subscription.service.js';

export interface EmitPlatformEventResult {
  status: 'accepted' | 'duplicate';
  event: GatewayPlatformEvent;
  deliveryAttempts: GatewayEventDeliveryAttempt[];
}

export interface GatewayDeliveryDispatcher {
  deliverAttempts(attempts: GatewayEventDeliveryAttempt[]): Promise<unknown>;
}

export class GatewayEventService {
  constructor(
    private readonly store: GatewayEventStore,
    private readonly subscriptions: GatewaySubscriptionService,
    private readonly deliveryDispatcher?: GatewayDeliveryDispatcher,
  ) {}

  async emitPlatformEvent(input: PlatformEventInput): Promise<EmitPlatformEventResult> {
    const validated = platformEventInputSchema.parse(input);
    const existing = await this.store.findPlatformEventByIdempotencyKey(
      validated.tenantId,
      validated.sourceComponent,
      validated.idempotencyKey,
    );

    if (existing) {
      return {
        status: 'duplicate',
        event: existing,
        deliveryAttempts: [],
      };
    }

    const event = await this.store.createPlatformEvent(validated);
    const matchingSubscriptions = await this.subscriptions.listMatchingSubscriptions(event);
    const deliveryAttempts = await Promise.all(
      matchingSubscriptions.map((subscription) => this.store.createDeliveryAttempt(
        deliveryAttemptInputSchema.parse({
          tenantId: event.tenantId,
          eventId: event.id,
          subscriptionId: subscription.id,
          endpointId: subscription.endpointId,
          status: 'pending',
          attemptNumber: 1,
          maxAttempts: 3,
        }),
      )),
    );

    if (deliveryAttempts.length > 0 && this.deliveryDispatcher) {
      void this.deliveryDispatcher.deliverAttempts(deliveryAttempts).catch((error) => {
        console.error('[GatewayEventService] Delivery dispatch failed:', {
          eventId: event.id,
          tenantId: event.tenantId,
          error: error instanceof Error ? error.message : String(error),
        });
      });
    }

    return {
      status: 'accepted',
      event,
      deliveryAttempts,
    };
  }

  async listDeliveryAttempts(
    tenantId: string,
    eventId: string,
  ): Promise<GatewayEventDeliveryAttempt[]> {
    return this.store.listDeliveryAttempts(tenantId, eventId);
  }
}
