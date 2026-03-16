/**
 * Event Adapter — Module Entry Point
 *
 * Exports schema, types, validation, and provides an Express router scaffold.
 * Routes will be added by subsequent work packages.
 */

import { Router } from 'express';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';

import { createWebhookRouter, type WebhookRouterDeps } from './routes/webhook.js';
import { createSourcesRouter, type SourcesRouterDeps } from './routes/sources.js';
import { createSchedulesRouter } from './routes/schedules.js';
import { createEventsRouter } from './routes/events.js';
import { createHealthRouter } from './routes/health.js';
import { createAutomationRouter } from './routes/automation.js';
import { createTriggerRouter } from './routes/trigger.js';
import { createSubscriptionsRouter } from './routes/subscriptions.js';
import { createAdminRouter } from './routes/admin.js';
import { RateLimiter } from './services/rate-limiter.js';
import type { SecretResolver } from './services/auth-validator.js';

// Schema exports
export {
  eventAdapterSchema,
  eventSourceTypeEnum,
  webhookEventSourceTypeEnum,
  webhookEventStatusEnum,
  authMethodEnum,
  lifecycleStateEnum,
  webhookEvents,
  eventSources,
  eventScheduledTasks,
  automationDestinations,
  platformSubscriptions,
} from './schema.js';

// Type exports (Drizzle-inferred)
export type {
  WebhookEvent,
  NewWebhookEvent,
  EventSource,
  NewEventSource,
  EventScheduledTask,
  NewEventScheduledTask,
  AutomationDestination,
  NewAutomationDestination,
  PlatformSubscription,
  NewPlatformSubscription,
} from './schema.js';

// Application types and constants
export * from './types.js';

// Validation schemas
export {
  CreateEventSourceInput,
  UpdateEventSourceInput,
  CreateScheduleInput,
  UpdateScheduleInput,
  TriggerCallbackInput,
  AutomationDestinationInput,
  EventQueryInput,
} from './validation.js';

// Service exports
export { RateLimiter } from './services/rate-limiter.js';
export { mapPayload, evaluatePath } from './services/payload-mapper.js';
export { parseGitHubEvent, UnsupportedEventTypeError } from './parsers/github.js';
export { parseGenericWebhook, PayloadParseError } from './parsers/generic.js';
export { createWebhookRouter } from './routes/webhook.js';
export { createSourcesRouter } from './routes/sources.js';
export { createSchedulesRouter } from './routes/schedules.js';
export type { SchedulesRouterDeps } from './routes/schedules.js';
export { createSubscriptionsRouter } from './routes/subscriptions.js';
export { TriggerForwarder } from './services/trigger-forwarder.js';
export { translateEvent, TranslationError, fanOutPlatformEvent } from './services/event-translator.js';
export { BufferDrainWorker } from './workers/buffer-drain.js';
export {
  validateCronExpression,
  computeNextFireAt,
  isValidTimezone,
  pauseSchedule,
  resumeSchedule,
  disableSchedule,
  SchedulerService,
} from './services/scheduler.js';
export type { SchedulerServiceConfig } from './services/scheduler.js';
export { encryptSecret, decryptSecret, SecretStoreResolver } from './services/secret-store.js';
export { createAutomationRouter } from './routes/automation.js';
export { createTriggerRouter } from './routes/trigger.js';
export { AutomationForwarder } from './services/automation-forwarder.js';

export type { SecretResolver } from './services/auth-validator.js';
export type { WebhookRouterDeps } from './routes/webhook.js';
export type { SourcesRouterDeps } from './routes/sources.js';
export { createEventsRouter } from './routes/events.js';
export { createHealthRouter } from './routes/health.js';
export type { EventsRouterDeps } from './routes/events.js';
export type { HealthRouterDeps } from './routes/health.js';
export { createAdminRouter } from './routes/admin.js';
export type { AdminRouterDeps } from './routes/admin.js';
export type { AutomationRouterDeps } from './routes/automation.js';
export type { TriggerRouterDeps } from './routes/trigger.js';
export type { SubscriptionsRouterDeps } from './routes/subscriptions.js';
export type { PayloadMappingConfig, MappedPayload } from './services/payload-mapper.js';
export type { GitHubParsedEvent } from './parsers/github.js';
export type { GenericParsedEvent } from './parsers/generic.js';
export type { TriggerCall, TriggerResult } from './services/trigger-forwarder.js';
export type { BufferDrainConfig } from './workers/buffer-drain.js';

/**
 * Create the Express router for event adapter endpoints.
 *
 * @param deps - Dependencies including db, secretResolver, and rateLimiter.
 *               If not provided, returns a bare router (for backward compat / future WPs).
 */
export function createEventAdapterRouter(deps?: {
  db: NodePgDatabase<Record<string, unknown>>;
  secretResolver: SecretResolver;
}): Router {
  const router = Router();

  if (deps) {
    const rateLimiter = new RateLimiter();
    const webhookRouter = createWebhookRouter({
      db: deps.db,
      secretResolver: deps.secretResolver,
      rateLimiter,
    });
    router.use(webhookRouter);

    const sourcesRouter = createSourcesRouter({ db: deps.db });
    router.use(sourcesRouter);

    const schedulesRouter = createSchedulesRouter({ db: deps.db });
    router.use(schedulesRouter);
    const eventsRouter = createEventsRouter({ db: deps.db });
    router.use(eventsRouter);
    const healthRouter = createHealthRouter({ db: deps.db });
    router.use(healthRouter);
    const automationRouter = createAutomationRouter({ db: deps.db });
    router.use(automationRouter);
    const triggerRouter = createTriggerRouter({ db: deps.db });
    router.use(triggerRouter);
    const subscriptionsRouter = createSubscriptionsRouter({ db: deps.db });
    router.use(subscriptionsRouter);
    const adminRouter = createAdminRouter({ db: deps.db });
    router.use('/event-adapter/admin', adminRouter);
  }

  return router;
}
