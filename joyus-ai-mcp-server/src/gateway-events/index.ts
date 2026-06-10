import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { Router } from 'express';

import {
  ChannelDeliveryAdapter,
  DashboardDeliveryAdapter,
  EmailDeliveryAdapter,
  SlackDeliveryAdapter,
  WebhookDeliveryAdapter,
} from './adapters/index.js';
import { DeliveryAttemptStateService } from './dead-letter.service.js';
import { GatewayDecisionService } from './decision.service.js';
import { GatewayDeliveryService } from './delivery.service.js';
import { GatewayEventService } from './event.service.js';
import {
  GatewayDecisionHandlerRegistry,
  type GatewayDecisionHandler,
} from './handler-registry.js';
import { createGatewayDecisionsRouter } from './routes/decisions.js';
import { createGatewayDeliveriesRouter } from './routes/deliveries.js';
import { createGatewayEndpointsRouter } from './routes/endpoints.js';
import { createGatewayEventsRouter } from './routes/events.js';
import { createGatewaySubscriptionsRouter } from './routes/subscriptions.js';
import { DrizzleGatewayEventStore } from './store.js';
import { GatewaySubscriptionService } from './subscription.service.js';

export interface GatewayDecisionHandlerRegistration {
  handlerKey: string;
  handler: GatewayDecisionHandler;
}

export interface GatewayEventBusModule {
  router: Router;
  store: DrizzleGatewayEventStore;
  eventService: GatewayEventService;
  subscriptionService: GatewaySubscriptionService;
  decisionService: GatewayDecisionService;
  decisionHandlers: GatewayDecisionHandlerRegistry;
}

export function createGatewayEventBusModule(options: {
  db: NodePgDatabase<Record<string, unknown>>;
  decisionHandlers?: GatewayDecisionHandlerRegistration[];
}): GatewayEventBusModule {
  const store = new DrizzleGatewayEventStore(options.db);
  const subscriptionService = new GatewaySubscriptionService(store);
  const deliveryState = new DeliveryAttemptStateService(store);
  const deliveryService = new GatewayDeliveryService(
    {
      getPlatformEvent: store.getPlatformEvent.bind(store),
      getEndpoint: store.getEndpoint.bind(store),
      recordDeliveryResult: deliveryState.recordDeliveryResult.bind(deliveryState),
    },
    [
      new DashboardDeliveryAdapter(),
      new WebhookDeliveryAdapter(),
      new SlackDeliveryAdapter(),
      new EmailDeliveryAdapter(),
      new ChannelDeliveryAdapter({
        async hasConnectedChannel(tenantId: string) {
          return (await store.listConnectedChannelConnections(tenantId)).length > 0;
        },
      }),
    ],
  );
  const eventService = new GatewayEventService(store, subscriptionService, deliveryService);
  const decisionHandlers = new GatewayDecisionHandlerRegistry();

  for (const registration of options.decisionHandlers ?? []) {
    decisionHandlers.register(registration.handlerKey, registration.handler);
  }

  const decisionService = new GatewayDecisionService(store, decisionHandlers);
  const router = Router();
  router.use('/events', createGatewayEventsRouter(eventService));
  router.use('/endpoints', createGatewayEndpointsRouter(subscriptionService));
  router.use('/subscriptions', createGatewaySubscriptionsRouter(subscriptionService));
  router.use('/deliveries', createGatewayDeliveriesRouter(eventService));
  router.use('/decisions', createGatewayDecisionsRouter(decisionService));

  return {
    router,
    store,
    eventService,
    subscriptionService,
    decisionService,
    decisionHandlers,
  };
}

export * from './adapters/index.js';
export * from './audit.service.js';
export * from './dead-letter.service.js';
export * from './decision.service.js';
export * from './event.service.js';
export * from './handler-registry.js';
export * from './retry.worker.js';
export * from './store.js';
export * from './subscription.service.js';
export * from './types.js';
