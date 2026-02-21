/**
 * Content Infrastructure — Drizzle ORM Schema
 *
 * All tables live in the PostgreSQL `content` schema, separate from
 * the existing `public` schema tables. Uses pgSchema('content').
 *
 * Authoritative reference: kitty-specs/006-content-infrastructure/data-model.md
 */

import { createId } from '@paralleldrive/cuid2';
import { relations } from 'drizzle-orm';
import {
  pgSchema,
  text,
  timestamp,
  boolean,
  integer,
  real,
  jsonb,
  uniqueIndex,
  index,
  primaryKey,
  customType,
} from 'drizzle-orm/pg-core';

// ============================================================
// SCHEMA NAMESPACE
// ============================================================

export const contentSchema = pgSchema('content');

// ============================================================
// CUSTOM TYPES
// ============================================================

/**
 * PostgreSQL tsvector type for full-text search.
 * The actual generated column + GIN index are handled via migration SQL.
 */
const tsvector = customType<{ data: string }>({
  dataType() {
    return 'tsvector';
  },
});

// ============================================================
// ENUMS
// ============================================================

export const sourceTypeEnum = contentSchema.enum('content_source_type', [
  'relational-database',
  'rest-api',
]);

export const syncStrategyEnum = contentSchema.enum('content_sync_strategy', [
  'mirror',
  'pass-through',
  'hybrid',
]);

export const sourceStatusEnum = contentSchema.enum('content_source_status', [
  'active',
  'syncing',
  'error',
  'disconnected',
]);

export const syncRunStatusEnum = contentSchema.enum('content_sync_run_status', [
  'pending',
  'running',
  'completed',
  'failed',
]);

export const syncTriggerEnum = contentSchema.enum('content_sync_trigger', [
  'scheduled',
  'manual',
]);

// ============================================================
// TABLES
// ============================================================

// --- ContentSource ---

export const contentSources = contentSchema.table('sources', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
  tenantId: text('tenant_id').notNull(),
  name: text('name').notNull(),
  type: sourceTypeEnum('type').notNull(),
  syncStrategy: syncStrategyEnum('sync_strategy').notNull(),
  connectionConfig: jsonb('connection_config').notNull(), // Encrypted at rest via encryptToken/decryptToken
  freshnessWindowMinutes: integer('freshness_window_minutes').notNull().default(1440),
  status: sourceStatusEnum('status').notNull().default('active'),
  itemCount: integer('item_count').notNull().default(0),
  lastSyncAt: timestamp('last_sync_at'),
  lastSyncError: text('last_sync_error'),
  schemaVersion: text('schema_version'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
}, (table) => ({
  tenantIdIdx: index('content_sources_tenant_id_idx').on(table.tenantId),
  tenantTypeIdx: index('content_sources_tenant_type_idx').on(table.tenantId, table.type),
  tenantStatusIdx: index('content_sources_tenant_status_idx').on(table.tenantId, table.status),
}));

// --- ContentItem ---

export const contentItems = contentSchema.table('items', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
  sourceId: text('source_id').notNull().references(() => contentSources.id, { onDelete: 'cascade' }),
  sourceRef: text('source_ref').notNull(),
  title: text('title').notNull(),
  body: text('body'),
  contentType: text('content_type').notNull().default('text'),
  metadata: jsonb('metadata').notNull().$defaultFn(() => ({})),
  dataTier: integer('data_tier').notNull().default(1),
  searchVector: tsvector('search_vector'), // Generated column + GIN index via migration
  lastSyncedAt: timestamp('last_synced_at').notNull(),
  isStale: boolean('is_stale').notNull().default(false),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
}, (table) => ({
  sourceIdIdx: index('content_items_source_id_idx').on(table.sourceId),
  sourceRefUnique: uniqueIndex('content_items_source_ref_unique').on(table.sourceId, table.sourceRef),
  sourceStaleIdx: index('content_items_source_stale_idx').on(table.sourceId, table.isStale),
}));

// --- Product ---

export const contentProducts = contentSchema.table('products', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
  tenantId: text('tenant_id').notNull(),
  name: text('name').notNull(),
  description: text('description'),
  isActive: boolean('is_active').notNull().default(true),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
}, (table) => ({
  tenantIdIdx: index('content_products_tenant_id_idx').on(table.tenantId),
  tenantNameUnique: uniqueIndex('content_products_tenant_name_unique').on(table.tenantId, table.name),
}));

// --- ProductSource (join table) ---

export const contentProductSources = contentSchema.table('product_sources', {
  productId: text('product_id').notNull().references(() => contentProducts.id, { onDelete: 'cascade' }),
  sourceId: text('source_id').notNull().references(() => contentSources.id, { onDelete: 'cascade' }),
}, (table) => ({
  pk: primaryKey({ columns: [table.productId, table.sourceId] }),
}));

// --- ProductProfile (join table) ---

export const contentProductProfiles = contentSchema.table('product_profiles', {
  productId: text('product_id').notNull().references(() => contentProducts.id, { onDelete: 'cascade' }),
  profileId: text('profile_id').notNull(), // External reference to profile engine
}, (table) => ({
  pk: primaryKey({ columns: [table.productId, table.profileId] }),
}));

// --- Entitlement ---

export const contentEntitlements = contentSchema.table('entitlements', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
  tenantId: text('tenant_id').notNull(),
  userId: text('user_id').notNull(),
  sessionId: text('session_id').notNull(),
  productId: text('product_id').notNull().references(() => contentProducts.id, { onDelete: 'cascade' }),
  resolvedFrom: text('resolved_from').notNull(),
  resolvedAt: timestamp('resolved_at').notNull(),
  expiresAt: timestamp('expires_at').notNull(),
}, (table) => ({
  sessionUserIdx: index('content_entitlements_session_user_idx').on(table.sessionId, table.userId),
  userProductIdx: index('content_entitlements_user_product_idx').on(table.userId, table.productId),
  tenantIdIdx: index('content_entitlements_tenant_id_idx').on(table.tenantId),
}));

// --- ApiKey ---

export const contentApiKeys = contentSchema.table('api_keys', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
  tenantId: text('tenant_id').notNull(),
  keyHash: text('key_hash').notNull().unique(), // SHA-256 hash; raw key never stored
  keyPrefix: text('key_prefix').notNull(), // First 8 chars for identification
  integrationName: text('integration_name').notNull(),
  jwksUri: text('jwks_uri'),
  issuer: text('issuer'),
  audience: text('audience'),
  isActive: boolean('is_active').notNull().default(true),
  lastUsedAt: timestamp('last_used_at'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
}, (table) => ({
  tenantIdIdx: index('content_api_keys_tenant_id_idx').on(table.tenantId),
  tenantActiveIdx: index('content_api_keys_tenant_active_idx').on(table.tenantId, table.isActive),
}));

// --- MediationSession ---

export const contentMediationSessions = contentSchema.table('mediation_sessions', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
  tenantId: text('tenant_id').notNull(),
  apiKeyId: text('api_key_id').notNull().references(() => contentApiKeys.id),
  userId: text('user_id').notNull(),
  activeProfileId: text('active_profile_id'),
  messageCount: integer('message_count').notNull().default(0),
  startedAt: timestamp('started_at').defaultNow().notNull(),
  lastActivityAt: timestamp('last_activity_at').defaultNow().notNull(),
  endedAt: timestamp('ended_at'),
}, (table) => ({
  tenantUserIdx: index('content_sessions_tenant_user_idx').on(table.tenantId, table.userId),
  apiKeyIdIdx: index('content_sessions_api_key_id_idx').on(table.apiKeyId),
  tenantActivityIdx: index('content_sessions_tenant_activity_idx').on(table.tenantId, table.lastActivityAt),
}));

// --- SyncRun ---

export const contentSyncRuns = contentSchema.table('sync_runs', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
  sourceId: text('source_id').notNull().references(() => contentSources.id, { onDelete: 'cascade' }),
  status: syncRunStatusEnum('status').notNull(),
  trigger: syncTriggerEnum('trigger').notNull(),
  itemsDiscovered: integer('items_discovered').notNull().default(0),
  itemsCreated: integer('items_created').notNull().default(0),
  itemsUpdated: integer('items_updated').notNull().default(0),
  itemsRemoved: integer('items_removed').notNull().default(0),
  cursor: text('cursor'),
  error: text('error'),
  startedAt: timestamp('started_at').defaultNow().notNull(),
  completedAt: timestamp('completed_at'),
}, (table) => ({
  sourceStartedIdx: index('content_sync_runs_source_started_idx').on(table.sourceId, table.startedAt),
  statusIdx: index('content_sync_runs_status_idx').on(table.status),
}));

// --- GenerationLog ---

export const contentGenerationLogs = contentSchema.table('generation_logs', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
  tenantId: text('tenant_id').notNull(),
  userId: text('user_id').notNull(),
  sessionId: text('session_id'),
  profileId: text('profile_id'),
  query: text('query').notNull(),
  sourcesUsed: jsonb('sources_used').notNull().$defaultFn(() => []),
  citationCount: integer('citation_count').notNull().default(0),
  responseLength: integer('response_length').notNull(),
  driftScore: real('drift_score'), // Populated by background drift monitor
  createdAt: timestamp('created_at').defaultNow().notNull(),
}, (table) => ({
  tenantCreatedIdx: index('content_gen_logs_tenant_created_idx').on(table.tenantId, table.createdAt),
  tenantUserIdx: index('content_gen_logs_tenant_user_idx').on(table.tenantId, table.userId),
  profileCreatedIdx: index('content_gen_logs_profile_created_idx').on(table.profileId, table.createdAt),
}));

// --- DriftReport ---

export const contentDriftReports = contentSchema.table('drift_reports', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
  tenantId: text('tenant_id').notNull(),
  profileId: text('profile_id').notNull(),
  windowStart: timestamp('window_start').notNull(),
  windowEnd: timestamp('window_end').notNull(),
  generationsEvaluated: integer('generations_evaluated').notNull(),
  overallDriftScore: real('overall_drift_score').notNull(),
  dimensionScores: jsonb('dimension_scores').notNull(),
  recommendations: jsonb('recommendations').notNull().$defaultFn(() => []),
  createdAt: timestamp('created_at').defaultNow().notNull(),
}, (table) => ({
  tenantProfileWindowIdx: index('content_drift_tenant_profile_window_idx').on(table.tenantId, table.profileId, table.windowEnd),
  profileCreatedIdx: index('content_drift_profile_created_idx').on(table.profileId, table.createdAt),
}));

// --- OperationLog ---

export const contentOperationLogs = contentSchema.table('operation_logs', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
  tenantId: text('tenant_id').notNull(),
  operation: text('operation').notNull(), // sync, search, resolve, generate, mediate
  sourceId: text('source_id'),
  userId: text('user_id'),
  durationMs: integer('duration_ms').notNull(),
  success: boolean('success').notNull(),
  metadata: jsonb('metadata').notNull().$defaultFn(() => ({})),
  createdAt: timestamp('created_at').defaultNow().notNull(),
}, (table) => ({
  tenantOpCreatedIdx: index('content_op_logs_tenant_op_created_idx').on(table.tenantId, table.operation, table.createdAt),
  tenantCreatedIdx: index('content_op_logs_tenant_created_idx').on(table.tenantId, table.createdAt),
}));

// ============================================================
// RELATIONS
// ============================================================

export const contentSourcesRelations = relations(contentSources, ({ many }) => ({
  items: many(contentItems),
  syncRuns: many(contentSyncRuns),
  productSources: many(contentProductSources),
}));

export const contentItemsRelations = relations(contentItems, ({ one }) => ({
  source: one(contentSources, {
    fields: [contentItems.sourceId],
    references: [contentSources.id],
  }),
}));

export const contentProductsRelations = relations(contentProducts, ({ many }) => ({
  productSources: many(contentProductSources),
  productProfiles: many(contentProductProfiles),
  entitlements: many(contentEntitlements),
}));

export const contentProductSourcesRelations = relations(contentProductSources, ({ one }) => ({
  product: one(contentProducts, {
    fields: [contentProductSources.productId],
    references: [contentProducts.id],
  }),
  source: one(contentSources, {
    fields: [contentProductSources.sourceId],
    references: [contentSources.id],
  }),
}));

export const contentProductProfilesRelations = relations(contentProductProfiles, ({ one }) => ({
  product: one(contentProducts, {
    fields: [contentProductProfiles.productId],
    references: [contentProducts.id],
  }),
}));

export const contentEntitlementsRelations = relations(contentEntitlements, ({ one }) => ({
  product: one(contentProducts, {
    fields: [contentEntitlements.productId],
    references: [contentProducts.id],
  }),
}));

export const contentApiKeysRelations = relations(contentApiKeys, ({ many }) => ({
  sessions: many(contentMediationSessions),
}));

export const contentMediationSessionsRelations = relations(contentMediationSessions, ({ one }) => ({
  apiKey: one(contentApiKeys, {
    fields: [contentMediationSessions.apiKeyId],
    references: [contentApiKeys.id],
  }),
}));

export const contentSyncRunsRelations = relations(contentSyncRuns, ({ one }) => ({
  source: one(contentSources, {
    fields: [contentSyncRuns.sourceId],
    references: [contentSources.id],
  }),
}));

// ============================================================
// TYPE EXPORTS
// ============================================================

export type ContentSource = typeof contentSources.$inferSelect;
export type NewContentSource = typeof contentSources.$inferInsert;

export type ContentItem = typeof contentItems.$inferSelect;
export type NewContentItem = typeof contentItems.$inferInsert;

export type ContentProduct = typeof contentProducts.$inferSelect;
export type NewContentProduct = typeof contentProducts.$inferInsert;

export type ContentProductSource = typeof contentProductSources.$inferSelect;
export type NewContentProductSource = typeof contentProductSources.$inferInsert;

export type ContentProductProfile = typeof contentProductProfiles.$inferSelect;
export type NewContentProductProfile = typeof contentProductProfiles.$inferInsert;

export type ContentEntitlement = typeof contentEntitlements.$inferSelect;
export type NewContentEntitlement = typeof contentEntitlements.$inferInsert;

export type ContentApiKey = typeof contentApiKeys.$inferSelect;
export type NewContentApiKey = typeof contentApiKeys.$inferInsert;

export type ContentMediationSession = typeof contentMediationSessions.$inferSelect;
export type NewContentMediationSession = typeof contentMediationSessions.$inferInsert;

export type ContentSyncRun = typeof contentSyncRuns.$inferSelect;
export type NewContentSyncRun = typeof contentSyncRuns.$inferInsert;

export type ContentGenerationLog = typeof contentGenerationLogs.$inferSelect;
export type NewContentGenerationLog = typeof contentGenerationLogs.$inferInsert;

export type ContentDriftReport = typeof contentDriftReports.$inferSelect;
export type NewContentDriftReport = typeof contentDriftReports.$inferInsert;

export type ContentOperationLog = typeof contentOperationLogs.$inferSelect;
export type NewContentOperationLog = typeof contentOperationLogs.$inferInsert;
