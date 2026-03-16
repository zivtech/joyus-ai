/**
 * Event Adapter — Drizzle ORM Schema
 *
 * All tables live in the PostgreSQL `event_adapter` schema, separate from
 * the existing `public` and `content` schema tables.
 *
 * Authoritative reference: kitty-specs/018-external-event-adapter/data-model.md
 */

import { createId } from '@paralleldrive/cuid2';
import { relations, sql } from 'drizzle-orm';
import {
  pgSchema,
  text,
  timestamp,
  boolean,
  integer,
  jsonb,
  varchar,
  uniqueIndex,
  index,
} from 'drizzle-orm/pg-core';

// ============================================================
// SCHEMA NAMESPACE
// ============================================================

export const eventAdapterSchema = pgSchema('event_adapter');

// ============================================================
// ENUMS
// ============================================================

export const eventSourceTypeEnum = eventAdapterSchema.enum('event_source_type', [
  'github',
  'generic_webhook',
]);

export const webhookEventSourceTypeEnum = eventAdapterSchema.enum('webhook_event_source_type', [
  'github',
  'generic_webhook',
  'schedule',
  'automation_callback',
]);

export const webhookEventStatusEnum = eventAdapterSchema.enum('webhook_event_status', [
  'pending',
  'processing',
  'delivered',
  'failed',
  'dead_letter',
]);

export const authMethodEnum = eventAdapterSchema.enum('auth_method', [
  'hmac_sha256',
  'api_key_header',
  'ip_allowlist',
]);

export const lifecycleStateEnum = eventAdapterSchema.enum('lifecycle_state', [
  'active',
  'paused',
  'disabled',
  'archived',
]);

// ============================================================
// TABLES
// ============================================================

// --- webhook_event ---
// Unified ingestion buffer and dead letter queue for all incoming webhook events.

export const webhookEvents = eventAdapterSchema.table('webhook_events', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
  tenantId: text('tenant_id').notNull(),
  sourceType: webhookEventSourceTypeEnum('source_type').notNull(),
  sourceId: text('source_id'),
  scheduleId: text('schedule_id'),
  status: webhookEventStatusEnum('status').notNull().default('pending'),
  payload: jsonb('payload').notNull(),
  headers: jsonb('headers'),
  signatureValid: boolean('signature_valid'),
  translatedTrigger: jsonb('translated_trigger'),
  triggerType: varchar('trigger_type', { length: 50 }),
  pipelineId: text('pipeline_id'),
  attemptCount: integer('attempt_count').notNull().default(0),
  failureReason: text('failure_reason'),
  processingDurationMs: integer('processing_duration_ms'),
  forwardedToAutomation: boolean('forwarded_to_automation').notNull().default(false),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  deliveredAt: timestamp('delivered_at', { withTimezone: true }),
}, (table) => ({
  tenantStatusIdx: index('ea_webhook_events_tenant_status_idx').on(table.tenantId, table.status),
  sourceTypeSourceIdIdx: index('ea_webhook_events_source_type_source_id_idx').on(table.sourceType, table.sourceId),
  createdAtIdx: index('ea_webhook_events_created_at_idx').on(table.createdAt),
  pendingFailedIdx: index('ea_webhook_events_pending_failed_idx')
    .on(table.status)
    .where(sql`status IN ('pending', 'failed')`),
}));

// --- event_source ---
// Registered external systems that send events to the adapter.

export const eventSources = eventAdapterSchema.table('event_sources', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
  tenantId: text('tenant_id'),
  name: varchar('name', { length: 255 }).notNull(),
  sourceType: eventSourceTypeEnum('source_type').notNull(),
  endpointSlug: varchar('endpoint_slug', { length: 100 }).notNull().unique(),
  authMethod: authMethodEnum('auth_method').notNull(),
  authConfig: jsonb('auth_config').notNull(),
  payloadMapping: jsonb('payload_mapping'),
  targetPipelineId: text('target_pipeline_id'),
  targetTriggerType: varchar('target_trigger_type', { length: 50 }),
  lifecycleState: lifecycleStateEnum('lifecycle_state').notNull().default('active'),
  isPlatformWide: boolean('is_platform_wide').notNull().default(false),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
}, (table) => ({
  tenantIdIdx: index('ea_event_sources_tenant_id_idx').on(table.tenantId),
}));

// --- scheduled_task ---
// Recurring cron-based trigger configurations.

export const eventScheduledTasks = eventAdapterSchema.table('scheduled_tasks', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
  tenantId: text('tenant_id').notNull(),
  name: varchar('name', { length: 255 }).notNull(),
  cronExpression: varchar('cron_expression', { length: 100 }).notNull(),
  timezone: varchar('timezone', { length: 50 }).notNull().default('UTC'),
  targetPipelineId: text('target_pipeline_id').notNull(),
  triggerType: varchar('trigger_type', { length: 50 }).notNull().default('manual-request'),
  triggerMetadata: jsonb('trigger_metadata'),
  lifecycleState: lifecycleStateEnum('lifecycle_state').notNull().default('active'),
  lastFiredAt: timestamp('last_fired_at', { withTimezone: true }),
  nextFireAt: timestamp('next_fire_at', { withTimezone: true }),
  pausedBy: varchar('paused_by', { length: 50 }),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
}, (table) => ({
  activeNextFireIdx: index('ea_scheduled_tasks_active_next_fire_idx')
    .on(table.lifecycleState, table.nextFireAt)
    .where(sql`lifecycle_state = 'active'`),
  tenantIdIdx: index('ea_scheduled_tasks_tenant_id_idx').on(table.tenantId),
}));

// --- automation_destination ---
// Optional tier 2 external automation URL per tenant.

export const automationDestinations = eventAdapterSchema.table('automation_destinations', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
  tenantId: text('tenant_id').notNull().unique(),
  url: varchar('url', { length: 2048 }).notNull(),
  authHeader: varchar('auth_header', { length: 255 }),
  authSecretRef: varchar('auth_secret_ref', { length: 255 }),
  isActive: boolean('is_active').notNull().default(true),
  lastForwardedAt: timestamp('last_forwarded_at', { withTimezone: true }),
  failureCount: integer('failure_count').notNull().default(0),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
});

// --- platform_subscription ---
// Opt-in subscriptions for tenants to receive events from platform-wide sources.

export const platformSubscriptions = eventAdapterSchema.table('platform_subscriptions', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
  tenantId: text('tenant_id').notNull(),
  eventSourceId: text('event_source_id').notNull().references(() => eventSources.id, { onDelete: 'cascade' }),
  targetPipelineId: text('target_pipeline_id').notNull(),
  isActive: boolean('is_active').notNull().default(true),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
}, (table) => ({
  tenantSourceUnique: uniqueIndex('ea_platform_subscriptions_tenant_source_unique').on(table.tenantId, table.eventSourceId),
}));

// ============================================================
// RELATIONS
// ============================================================

export const webhookEventsRelations = relations(webhookEvents, ({ one }) => ({
  source: one(eventSources, {
    fields: [webhookEvents.sourceId],
    references: [eventSources.id],
  }),
  schedule: one(eventScheduledTasks, {
    fields: [webhookEvents.scheduleId],
    references: [eventScheduledTasks.id],
  }),
}));

export const eventSourcesRelations = relations(eventSources, ({ many }) => ({
  webhookEvents: many(webhookEvents),
  platformSubscriptions: many(platformSubscriptions),
}));

export const eventScheduledTasksRelations = relations(eventScheduledTasks, ({ many }) => ({
  webhookEvents: many(webhookEvents),
}));

export const automationDestinationsRelations = relations(automationDestinations, () => ({
  // tenant relation deferred until cross-schema FK strategy is established
}));

export const platformSubscriptionsRelations = relations(platformSubscriptions, ({ one }) => ({
  eventSource: one(eventSources, {
    fields: [platformSubscriptions.eventSourceId],
    references: [eventSources.id],
  }),
}));

// ============================================================
// TYPE EXPORTS
// ============================================================

export type WebhookEvent = typeof webhookEvents.$inferSelect;
export type NewWebhookEvent = typeof webhookEvents.$inferInsert;

export type EventSource = typeof eventSources.$inferSelect;
export type NewEventSource = typeof eventSources.$inferInsert;

export type EventScheduledTask = typeof eventScheduledTasks.$inferSelect;
export type NewEventScheduledTask = typeof eventScheduledTasks.$inferInsert;

export type AutomationDestination = typeof automationDestinations.$inferSelect;
export type NewAutomationDestination = typeof automationDestinations.$inferInsert;

export type PlatformSubscription = typeof platformSubscriptions.$inferSelect;
export type NewPlatformSubscription = typeof platformSubscriptions.$inferInsert;
