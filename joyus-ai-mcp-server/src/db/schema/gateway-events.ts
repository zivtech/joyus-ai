/**
 * Gateway Event Bus DB Schema — WP01
 *
 * Tenant-scoped platform event fanout, delivery attempts, optional channel
 * connections, decision ingestion, and sanitized audit records.
 *
 * ID convention:
 *   The codebase uses text IDs with cuid2 rather than UUID columns. Gateway
 *   tables follow that convention even though the abstract data model uses UUID.
 */

import { createId } from '@paralleldrive/cuid2';
import {
  pgTable,
  pgEnum,
  text,
  timestamp,
  boolean,
  integer,
  jsonb,
  index,
  uniqueIndex,
} from 'drizzle-orm/pg-core';

export const gatewayEventSeverityEnum = pgEnum('gateway_event_severity', [
  'info',
  'warning',
  'critical',
]);

export const gatewayEndpointTypeEnum = pgEnum('gateway_endpoint_type', [
  'dashboard',
  'webhook',
  'slack',
  'email',
  'channel',
]);

export const gatewayDeliveryStatusEnum = pgEnum('gateway_delivery_status', [
  'pending',
  'sent',
  'failed',
  'retry_scheduled',
  'dead_letter',
  'skipped_no_channel',
]);

export const gatewayDecisionEnum = pgEnum('gateway_decision', [
  'approved',
  'rejected',
  'request_changes',
  'acknowledged',
  'dismissed',
]);

export const gatewayDecisionRouteStatusEnum = pgEnum('gateway_decision_route_status', [
  'pending',
  'routed',
  'failed',
  'rejected',
]);

export const gatewayChannelConnectionStatusEnum = pgEnum('gateway_channel_connection_status', [
  'connected',
  'stale',
  'disconnected',
]);

export const gatewayAuditActionEnum = pgEnum('gateway_audit_action', [
  'event.accepted',
  'event.duplicate',
  'delivery.created',
  'delivery.sent',
  'delivery.failed',
  'delivery.retry_scheduled',
  'delivery.dead_lettered',
  'delivery.skipped_no_channel',
  'decision.accepted',
  'decision.duplicate',
  'decision.routed',
  'decision.failed',
  'decision.rejected',
]);

export const gatewayPlatformEvents = pgTable('gateway_platform_events', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
  tenantId: text('tenant_id').notNull(),
  type: text('type').notNull(),
  severity: gatewayEventSeverityEnum('severity').notNull(),
  sourceSpec: text('source_spec').notNull(),
  sourceComponent: text('source_component').notNull(),
  subjectType: text('subject_type'),
  subjectId: text('subject_id'),
  correlationId: text('correlation_id'),
  idempotencyKey: text('idempotency_key').notNull(),
  payload: jsonb('payload').notNull().$type<Record<string, unknown>>(),
  payloadSchemaVersion: text('payload_schema_version').notNull(),
  requiresDecision: boolean('requires_decision').notNull().default(false),
  handlerKey: text('handler_key'),
  occurredAt: timestamp('occurred_at').notNull(),
  emittedAt: timestamp('emitted_at').defaultNow().notNull(),
}, (table) => ({
  tenantTypeEmittedIdx: index('gw_events_tenant_type_emitted_idx').on(
    table.tenantId,
    table.type,
    table.emittedAt,
  ),
  tenantSubjectIdx: index('gw_events_tenant_subject_idx').on(
    table.tenantId,
    table.subjectType,
    table.subjectId,
  ),
  tenantSourceIdempotencyUnique: uniqueIndex('gw_events_tenant_source_idem_unique').on(
    table.tenantId,
    table.sourceComponent,
    table.idempotencyKey,
  ),
}));

export const gatewayDeliveryEndpoints = pgTable('gateway_delivery_endpoints', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
  tenantId: text('tenant_id').notNull(),
  type: gatewayEndpointTypeEnum('type').notNull(),
  name: text('name').notNull(),
  config: jsonb('config').notNull().$type<Record<string, unknown>>().default({}),
  secretRef: text('secret_ref'),
  isActive: boolean('is_active').notNull().default(true),
  createdBy: text('created_by'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
}, (table) => ({
  tenantTypeActiveIdx: index('gw_endpoints_tenant_type_active_idx').on(
    table.tenantId,
    table.type,
    table.isActive,
  ),
}));

export const gatewayEventSubscriptions = pgTable('gateway_event_subscriptions', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
  tenantId: text('tenant_id').notNull(),
  eventType: text('event_type').notNull(),
  minimumSeverity: gatewayEventSeverityEnum('minimum_severity'),
  endpointId: text('endpoint_id')
    .notNull()
    .references(() => gatewayDeliveryEndpoints.id, { onDelete: 'cascade' }),
  filter: jsonb('filter').$type<Record<string, unknown>>(),
  isEnabled: boolean('is_enabled').notNull().default(true),
  createdAt: timestamp('created_at').defaultNow().notNull(),
}, (table) => ({
  tenantEventEnabledIdx: index('gw_subs_tenant_event_enabled_idx').on(
    table.tenantId,
    table.eventType,
    table.isEnabled,
  ),
  endpointIdx: index('gw_subs_endpoint_idx').on(table.endpointId),
}));

export const gatewayEventDeliveryAttempts = pgTable('gateway_event_delivery_attempts', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
  tenantId: text('tenant_id').notNull(),
  eventId: text('event_id')
    .notNull()
    .references(() => gatewayPlatformEvents.id, { onDelete: 'cascade' }),
  subscriptionId: text('subscription_id')
    .notNull()
    .references(() => gatewayEventSubscriptions.id, { onDelete: 'cascade' }),
  endpointId: text('endpoint_id')
    .notNull()
    .references(() => gatewayDeliveryEndpoints.id, { onDelete: 'cascade' }),
  status: gatewayDeliveryStatusEnum('status').notNull().default('pending'),
  attemptNumber: integer('attempt_number').notNull().default(1),
  maxAttempts: integer('max_attempts').notNull().default(3),
  nextRetryAt: timestamp('next_retry_at'),
  deliveredAt: timestamp('delivered_at'),
  lastError: text('last_error'),
  responseSummary: jsonb('response_summary').$type<Record<string, unknown>>(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
}, (table) => ({
  tenantEventIdx: index('gw_attempts_tenant_event_idx').on(table.tenantId, table.eventId),
  tenantStatusRetryIdx: index('gw_attempts_tenant_status_retry_idx').on(
    table.tenantId,
    table.status,
    table.nextRetryAt,
  ),
  endpointStatusIdx: index('gw_attempts_endpoint_status_idx').on(table.endpointId, table.status),
}));

export const gatewayDecisions = pgTable('gateway_decisions', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
  tenantId: text('tenant_id').notNull(),
  eventId: text('event_id')
    .notNull()
    .references(() => gatewayPlatformEvents.id, { onDelete: 'cascade' }),
  decision: gatewayDecisionEnum('decision').notNull(),
  decisionBy: text('decision_by').notNull(),
  sourceBackend: gatewayEndpointTypeEnum('source_backend').notNull(),
  idempotencyKey: text('idempotency_key').notNull(),
  metadata: jsonb('metadata').notNull().$type<Record<string, unknown>>().default({}),
  receivedAt: timestamp('received_at').defaultNow().notNull(),
  handlerKey: text('handler_key').notNull(),
  routeStatus: gatewayDecisionRouteStatusEnum('route_status').notNull().default('pending'),
  routeError: text('route_error'),
}, (table) => ({
  tenantEventIdx: index('gw_decisions_tenant_event_idx').on(table.tenantId, table.eventId),
  tenantRouteStatusIdx: index('gw_decisions_tenant_route_status_idx').on(
    table.tenantId,
    table.routeStatus,
  ),
  tenantEventIdempotencyUnique: uniqueIndex('gw_decisions_tenant_event_idem_unique').on(
    table.tenantId,
    table.eventId,
    table.idempotencyKey,
  ),
}));

export const gatewayChannelConnections = pgTable('gateway_channel_connections', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
  tenantId: text('tenant_id').notNull(),
  adminId: text('admin_id'),
  connectionId: text('connection_id').notNull(),
  status: gatewayChannelConnectionStatusEnum('status').notNull().default('connected'),
  capabilities: jsonb('capabilities').notNull().$type<Record<string, unknown>>().default({}),
  connectedAt: timestamp('connected_at').defaultNow().notNull(),
  lastSeenAt: timestamp('last_seen_at').defaultNow().notNull(),
  expiresAt: timestamp('expires_at'),
}, (table) => ({
  tenantStatusIdx: index('gw_channels_tenant_status_idx').on(table.tenantId, table.status),
  tenantConnectionUnique: uniqueIndex('gw_channels_tenant_connection_unique').on(
    table.tenantId,
    table.connectionId,
  ),
}));

export const gatewayAuditRecords = pgTable('gateway_audit_records', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
  tenantId: text('tenant_id').notNull(),
  action: gatewayAuditActionEnum('action').notNull(),
  eventId: text('event_id').references(() => gatewayPlatformEvents.id, { onDelete: 'set null' }),
  deliveryAttemptId: text('delivery_attempt_id').references(
    () => gatewayEventDeliveryAttempts.id,
    { onDelete: 'set null' },
  ),
  decisionId: text('decision_id').references(() => gatewayDecisions.id, { onDelete: 'set null' }),
  endpointId: text('endpoint_id').references(() => gatewayDeliveryEndpoints.id, {
    onDelete: 'set null',
  }),
  sourceBackend: gatewayEndpointTypeEnum('source_backend'),
  idempotencyKey: text('idempotency_key'),
  summary: jsonb('summary').notNull().$type<Record<string, unknown>>().default({}),
  errorSummary: text('error_summary'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
}, (table) => ({
  tenantCreatedIdx: index('gw_audit_tenant_created_idx').on(table.tenantId, table.createdAt),
  tenantActionIdx: index('gw_audit_tenant_action_idx').on(table.tenantId, table.action),
}));

export type GatewayPlatformEvent = typeof gatewayPlatformEvents.$inferSelect;
export type NewGatewayPlatformEvent = typeof gatewayPlatformEvents.$inferInsert;
export type GatewayDeliveryEndpoint = typeof gatewayDeliveryEndpoints.$inferSelect;
export type NewGatewayDeliveryEndpoint = typeof gatewayDeliveryEndpoints.$inferInsert;
export type GatewayEventSubscription = typeof gatewayEventSubscriptions.$inferSelect;
export type NewGatewayEventSubscription = typeof gatewayEventSubscriptions.$inferInsert;
export type GatewayEventDeliveryAttempt = typeof gatewayEventDeliveryAttempts.$inferSelect;
export type NewGatewayEventDeliveryAttempt = typeof gatewayEventDeliveryAttempts.$inferInsert;
export type GatewayDecisionRecord = typeof gatewayDecisions.$inferSelect;
export type NewGatewayDecisionRecord = typeof gatewayDecisions.$inferInsert;
export type GatewayChannelConnection = typeof gatewayChannelConnections.$inferSelect;
export type NewGatewayChannelConnection = typeof gatewayChannelConnections.$inferInsert;
export type GatewayAuditRecord = typeof gatewayAuditRecords.$inferSelect;
export type NewGatewayAuditRecord = typeof gatewayAuditRecords.$inferInsert;
