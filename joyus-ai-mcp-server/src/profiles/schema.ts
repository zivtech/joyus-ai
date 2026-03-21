/**
 * Profile Isolation and Scale — Drizzle ORM Schema
 *
 * All tables live in the PostgreSQL `profiles` schema, separate from
 * the existing `public`, `content`, and `pipelines` schema tables.
 * Uses pgSchema('profiles').
 *
 * Authoritative reference: kitty-specs/008-profile-isolation/data-model.md
 */

import { createId } from '@paralleldrive/cuid2';
import { relations, sql } from 'drizzle-orm';
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
} from 'drizzle-orm/pg-core';

// ============================================================
// SCHEMA NAMESPACE
// ============================================================

export const profilesSchema = pgSchema('profiles');

// ============================================================
// ENUMS
// ============================================================

export const profileTierEnum = profilesSchema.enum('profile_tier', [
  'base', 'domain', 'specialized', 'contextual',
]);

export const profileStatusEnum = profilesSchema.enum('profile_status', [
  'active', 'archived', 'draft', 'superseded', 'rolled_back', 'deleted',
]);

export const generationRunStatusEnum = profilesSchema.enum('generation_run_status', [
  'pending', 'running', 'completed', 'failed', 'cancelled',
]);

export const documentFormatEnum = profilesSchema.enum('document_format', [
  'pdf', 'docx', 'txt', 'html', 'md',
]);

// ============================================================
// TABLES
// ============================================================

// --- TenantProfile (immutable versioned profile with 129-feature vector) ---

export const tenantProfiles = profilesSchema.table('tenant_profiles', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
  tenantId: text('tenant_id').notNull(),
  profileIdentity: text('profile_identity').notNull(),
  version: integer('version').notNull(),
  authorId: text('author_id').notNull(),
  authorName: text('author_name').notNull(),
  tier: profileTierEnum('tier').notNull(),
  parentProfileId: text('parent_profile_id'),
  corpusSnapshotId: text('corpus_snapshot_id'),
  stylometricFeatures: jsonb('stylometric_features').notNull().$defaultFn(() => ({})),
  markers: jsonb('markers').notNull().$defaultFn(() => []),
  fidelityScore: real('fidelity_score'),
  status: profileStatusEnum('status').notNull().default('draft'),
  metadata: jsonb('metadata').notNull().$defaultFn(() => ({})),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
  archivedAt: timestamp('archived_at'),
}, (table) => ({
  tenantIdIdx: index('tenant_profiles_tenant_id_idx').on(table.tenantId),
  tenantIdentityIdx: index('tenant_profiles_tenant_identity_idx').on(table.tenantId, table.profileIdentity),
  tenantIdentityVersionUnique: uniqueIndex('tenant_profiles_tenant_identity_version_unique').on(table.tenantId, table.profileIdentity, table.version),
  tenantStatusIdx: index('tenant_profiles_tenant_status_idx').on(table.tenantId, table.status),
  tenantTierIdx: index('tenant_profiles_tenant_tier_idx').on(table.tenantId, table.tier),
  activeProfilesIdx: index('tenant_profiles_active_idx')
    .on(table.tenantId, table.profileIdentity)
    .where(sql`status = 'active'`),
  parentProfileIdIdx: index('tenant_profiles_parent_profile_id_idx').on(table.parentProfileId),
}));

// --- CorpusSnapshot (immutable corpus record) ---

export const corpusSnapshots = profilesSchema.table('corpus_snapshots', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
  tenantId: text('tenant_id').notNull(),
  name: text('name').notNull(),
  documentHashes: jsonb('document_hashes').notNull().$defaultFn(() => []),
  documentCount: integer('document_count').notNull().default(0),
  authorCount: integer('author_count').notNull().default(0),
  totalWordCount: integer('total_word_count').notNull().default(0),
  createdAt: timestamp('created_at').defaultNow().notNull(),
}, (table) => ({
  tenantIdIdx: index('corpus_snapshots_tenant_id_idx').on(table.tenantId),
  tenantCreatedIdx: index('corpus_snapshots_tenant_created_idx').on(table.tenantId, table.createdAt),
}));

// --- CorpusDocument (document with content-hash dedup) ---

export const corpusDocuments = profilesSchema.table('corpus_documents', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
  tenantId: text('tenant_id').notNull(),
  contentHash: text('content_hash').notNull(),
  originalFilename: text('original_filename').notNull(),
  format: documentFormatEnum('format').notNull(),
  title: text('title'),
  authorId: text('author_id').notNull(),
  authorName: text('author_name').notNull(),
  extractedText: text('extracted_text'),
  wordCount: integer('word_count').notNull().default(0),
  dataTier: integer('data_tier').notNull().default(1),
  metadata: jsonb('metadata').notNull().$defaultFn(() => ({})),
  isActive: boolean('is_active').notNull().default(true),
  createdAt: timestamp('created_at').defaultNow().notNull(),
}, (table) => ({
  tenantIdIdx: index('corpus_documents_tenant_id_idx').on(table.tenantId),
  tenantContentHashUnique: uniqueIndex('corpus_documents_tenant_content_hash_unique').on(table.tenantId, table.contentHash),
  tenantAuthorIdx: index('corpus_documents_tenant_author_idx').on(table.tenantId, table.authorId),
  tenantActiveIdx: index('corpus_documents_tenant_active_idx').on(table.tenantId, table.isActive),
}));

// --- ProfileInheritance (parent-child hierarchy) ---

export const profileInheritance = profilesSchema.table('profile_inheritance', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
  tenantId: text('tenant_id').notNull(),
  parentProfileIdentity: text('parent_profile_identity').notNull(),
  childProfileIdentity: text('child_profile_identity').notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
}, (table) => ({
  tenantIdIdx: index('profile_inheritance_tenant_id_idx').on(table.tenantId),
  tenantParentIdx: index('profile_inheritance_tenant_parent_idx').on(table.tenantId, table.parentProfileIdentity),
  tenantChildIdx: index('profile_inheritance_tenant_child_idx').on(table.tenantId, table.childProfileIdentity),
  tenantParentChildUnique: uniqueIndex('profile_inheritance_tenant_parent_child_unique').on(table.tenantId, table.parentProfileIdentity, table.childProfileIdentity),
}));

// --- ProfileCache (resolved merged profiles) ---

export const profileCache = profilesSchema.table('profile_cache', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
  tenantId: text('tenant_id').notNull(),
  profileIdentity: text('profile_identity').notNull(),
  resolvedFeatures: jsonb('resolved_features').notNull().$defaultFn(() => ({})),
  resolvedMarkers: jsonb('resolved_markers').notNull().$defaultFn(() => []),
  overrideSources: jsonb('override_sources').notNull().$defaultFn(() => ({})),
  ancestorVersions: jsonb('ancestor_versions').notNull().$defaultFn(() => ({})),
  resolvedAt: timestamp('resolved_at').defaultNow().notNull(),
}, (table) => ({
  tenantIdentityUnique: uniqueIndex('profile_cache_tenant_identity_unique').on(table.tenantId, table.profileIdentity),
}));

// --- GenerationRun (pipeline execution tracking) ---

export const generationRuns = profilesSchema.table('generation_runs', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
  tenantId: text('tenant_id').notNull(),
  corpusSnapshotId: text('corpus_snapshot_id').references(() => corpusSnapshots.id, { onDelete: 'set null' }),
  status: generationRunStatusEnum('status').notNull().default('pending'),
  trigger: text('trigger').notNull(),
  profilesRequested: integer('profiles_requested').notNull().default(0),
  profilesCompleted: integer('profiles_completed').notNull().default(0),
  profilesFailed: integer('profiles_failed').notNull().default(0),
  profileIds: jsonb('profile_ids').notNull().$defaultFn(() => []),
  error: text('error'),
  engineVersion: text('engine_version'),
  startedAt: timestamp('started_at').defaultNow().notNull(),
  completedAt: timestamp('completed_at'),
  durationMs: integer('duration_ms'),
}, (table) => ({
  tenantIdIdx: index('generation_runs_tenant_id_idx').on(table.tenantId),
  tenantStartedIdx: index('generation_runs_tenant_started_idx').on(table.tenantId, table.startedAt),
  statusIdx: index('generation_runs_status_idx').on(table.status),
  corpusSnapshotIdIdx: index('generation_runs_corpus_snapshot_id_idx').on(table.corpusSnapshotId),
}));

// --- OperationLog (audit trail, append-only) ---

export const profileOperationLogs = profilesSchema.table('operation_logs', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
  tenantId: text('tenant_id').notNull(),
  operation: text('operation').notNull(),
  profileIdentity: text('profile_identity'),
  userId: text('user_id'),
  durationMs: integer('duration_ms').notNull(),
  success: boolean('success').notNull(),
  metadata: jsonb('metadata').notNull().$defaultFn(() => ({})),
  createdAt: timestamp('created_at').defaultNow().notNull(),
}, (table) => ({
  tenantOpCreatedIdx: index('profile_op_logs_tenant_op_created_idx').on(table.tenantId, table.operation, table.createdAt),
  tenantCreatedIdx: index('profile_op_logs_tenant_created_idx').on(table.tenantId, table.createdAt),
}));

// ============================================================
// RELATIONS
// ============================================================

export const tenantProfilesRelations = relations(tenantProfiles, ({ one, many }) => ({
  corpusSnapshot: one(corpusSnapshots, {
    fields: [tenantProfiles.corpusSnapshotId],
    references: [corpusSnapshots.id],
  }),
  parent: one(tenantProfiles, {
    fields: [tenantProfiles.parentProfileId],
    references: [tenantProfiles.id],
    relationName: 'parentChild',
  }),
  children: many(tenantProfiles, {
    relationName: 'parentChild',
  }),
}));

export const corpusSnapshotsRelations = relations(corpusSnapshots, ({ many }) => ({
  profiles: many(tenantProfiles),
  generationRuns: many(generationRuns),
}));

export const generationRunsRelations = relations(generationRuns, ({ one }) => ({
  corpusSnapshot: one(corpusSnapshots, {
    fields: [generationRuns.corpusSnapshotId],
    references: [corpusSnapshots.id],
  }),
}));

// ============================================================
// TYPE EXPORTS
// ============================================================

export type TenantProfile = typeof tenantProfiles.$inferSelect;
export type NewTenantProfile = typeof tenantProfiles.$inferInsert;

export type CorpusSnapshot = typeof corpusSnapshots.$inferSelect;
export type NewCorpusSnapshot = typeof corpusSnapshots.$inferInsert;

export type CorpusDocument = typeof corpusDocuments.$inferSelect;
export type NewCorpusDocument = typeof corpusDocuments.$inferInsert;

export type ProfileInheritance = typeof profileInheritance.$inferSelect;
export type NewProfileInheritance = typeof profileInheritance.$inferInsert;

export type ProfileCache = typeof profileCache.$inferSelect;
export type NewProfileCache = typeof profileCache.$inferInsert;

export type GenerationRun = typeof generationRuns.$inferSelect;
export type NewGenerationRun = typeof generationRuns.$inferInsert;

export type ProfileOperationLog = typeof profileOperationLogs.$inferSelect;
export type NewProfileOperationLog = typeof profileOperationLogs.$inferInsert;
