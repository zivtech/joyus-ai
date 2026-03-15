---
work_package_id: "WP01"
title: "Profile Schema & Tenant Scoping"
lane: "planned"
dependencies: []
subtasks: ["T001", "T002", "T003", "T004", "T005", "T006", "T007"]
history:
  - date: "2026-03-14"
    action: "created"
    agent: "claude-opus"
---

# WP01: Profile Schema & Tenant Scoping

**Implementation command**: `spec-kitty implement WP01`
**Target repo**: `joyus-ai`
**Dependencies**: None
**Priority**: P0 (Foundation — every other WP depends on this)

## Objective

Create the complete Drizzle ORM schema for the `profiles` PostgreSQL schema (7 tables, 5 enums), Zod validation schemas, shared TypeScript types and constants, the module barrel export, and wire everything into the existing database client. Generate and verify the Drizzle migration.

## Context

The `joyus-ai` platform uses Drizzle ORM with PostgreSQL and organizes tables in named PostgreSQL schemas. The `content` schema (Spec 006) is the primary reference pattern — see `src/content/schema.ts` for conventions:
- Uses `pgSchema('content')` for namespace isolation
- Uses `text('id').primaryKey().$defaultFn(() => createId())` for CUID2 primary keys (NOT uuid)
- Uses `text('tenant_id').notNull()` for tenant scoping (NOT uuid)
- Uses `$inferSelect` / `$inferInsert` for type exports (NOT `InferSelectModel`)
- Imports from `@paralleldrive/cuid2` for ID generation
- Defines relations using `relations()` from `drizzle-orm`

The profiles module gets its own `profiles` PostgreSQL schema namespace. All downstream WPs (WP02 through WP08) import types and schema references from this WP.

The existing `src/db/client.ts` must export the profiles schema tables so that any module can query profile data.

---

## Subtasks

### T001: Create profiles Drizzle schema (`src/profiles/schema.ts`)

**Purpose**: Define all 7 tables and 5 enums in the `profiles` PostgreSQL schema using Drizzle ORM's `pgSchema` API, following the exact patterns established in `src/content/schema.ts`.

**Steps**:
1. Create `src/profiles/schema.ts`
2. Declare the `profiles` PostgreSQL schema using `pgSchema`
3. Define 5 enums inside the schema namespace
4. Define all 7 tables with columns, constraints, and indexes
5. Define Drizzle relations for foreign keys
6. Export inferred `$inferSelect` / `$inferInsert` types

**Tables and their purposes**:

```typescript
// src/profiles/schema.ts
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
  index,
  uniqueIndex,
} from 'drizzle-orm/pg-core';

// ============================================================
// SCHEMA NAMESPACE
// ============================================================

export const profilesSchema = pgSchema('profiles');

// ============================================================
// ENUMS
// ============================================================

export const profileStatusEnum = profilesSchema.enum('profile_status', [
  'active', 'archived', 'pending_training',
]);

export const authorTypeEnum = profilesSchema.enum('author_type', [
  'person', 'organization',
]);

export const batchJobStatusEnum = profilesSchema.enum('batch_job_status', [
  'pending', 'running', 'completed', 'failed', 'cancelled',
]);

export const auditActionEnum = profilesSchema.enum('audit_action', [
  'create', 'read', 'update', 'delete', 'retrain',
  'pin', 'use_in_generation', 'access_denied',
]);

export const auditResultEnum = profilesSchema.enum('audit_result', [
  'allowed', 'denied',
]);

// ============================================================
// TABLES
// ============================================================

// --- Profile ---

export const profiles = profilesSchema.table('profiles', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
  tenantId: text('tenant_id').notNull(),
  authorName: text('author_name').notNull(),
  authorType: authorTypeEnum('author_type').notNull(),
  description: text('description'),
  status: profileStatusEnum('status').notNull().default('pending_training'),
  currentVersionNumber: integer('current_version_number'),  // null until first training
  stalenessThresholdDays: integer('staleness_threshold_days').notNull().default(30),
  metadata: jsonb('metadata').notNull().$defaultFn(() => ({})),
  lastRetrainedAt: timestamp('last_retrained_at'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
}, (table) => ({
  tenantIdx: index('profiles_tenant_id_idx').on(table.tenantId),
  tenantStatusIdx: index('profiles_tenant_status_idx').on(table.tenantId, table.status),
  tenantAuthorIdx: index('profiles_tenant_author_idx').on(table.tenantId, table.authorName),
}));

// --- ProfileVersion ---

export const profileVersions = profilesSchema.table('profile_versions', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
  profileId: text('profile_id').notNull().references(() => profiles.id, { onDelete: 'cascade' }),
  versionNumber: integer('version_number').notNull(),
  featureVector: jsonb('feature_vector').notNull(),   // 129-dimensional float array + metadata
  trainingCorpusSize: integer('training_corpus_size').notNull(),
  trainingCorpusIds: jsonb('training_corpus_ids').notNull().$defaultFn(() => []),  // content item IDs used
  accuracyScore: real('accuracy_score'),               // 0.0-1.0, from profile engine
  trainingDurationMs: integer('training_duration_ms'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
}, (table) => ({
  profileVersionUnique: uniqueIndex('profile_versions_profile_version_unique').on(table.profileId, table.versionNumber),
  profileIdx: index('profile_versions_profile_id_idx').on(table.profileId),
}));

// --- VersionPin ---

export const profileVersionPins = profilesSchema.table('version_pins', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
  tenantId: text('tenant_id').notNull(),
  profileId: text('profile_id').notNull().references(() => profiles.id, { onDelete: 'cascade' }),
  versionNumber: integer('version_number').notNull(),
  pinnedBy: text('pinned_by').notNull(),              // userId who set the pin
  reason: text('reason'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
}, (table) => ({
  tenantProfileIdx: index('version_pins_tenant_profile_idx').on(table.tenantId, table.profileId),
}));

// --- AuditLog ---

export const profileAuditLog = profilesSchema.table('audit_log', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
  tenantId: text('tenant_id').notNull(),
  userId: text('user_id').notNull(),
  profileId: text('profile_id').notNull(),
  action: auditActionEnum('action').notNull(),
  result: auditResultEnum('result').notNull(),
  metadata: jsonb('metadata').notNull().$defaultFn(() => ({})),
  createdAt: timestamp('created_at').defaultNow().notNull(),
}, (table) => ({
  tenantCreatedIdx: index('audit_log_tenant_created_idx').on(table.tenantId, table.createdAt),
  tenantProfileIdx: index('audit_log_tenant_profile_idx').on(table.tenantId, table.profileId),
  profileActionIdx: index('audit_log_profile_action_idx').on(table.profileId, table.action),
}));

// --- BatchIngestionJob ---

export const profileBatchJobs = profilesSchema.table('batch_jobs', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
  tenantId: text('tenant_id').notNull(),
  profileId: text('profile_id').notNull().references(() => profiles.id, { onDelete: 'cascade' }),
  status: batchJobStatusEnum('status').notNull().default('pending'),
  totalDocuments: integer('total_documents').notNull(),
  processedDocuments: integer('processed_documents').notNull().default(0),
  failedDocuments: integer('failed_documents').notNull().default(0),
  errorMessage: text('error_message'),
  resultVersionNumber: integer('result_version_number'),  // version created on completion
  resultAccuracyScore: real('result_accuracy_score'),
  startedAt: timestamp('started_at'),
  completedAt: timestamp('completed_at'),
  cancelledAt: timestamp('cancelled_at'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
}, (table) => ({
  tenantIdx: index('batch_jobs_tenant_id_idx').on(table.tenantId),
  profileIdx: index('batch_jobs_profile_id_idx').on(table.profileId),
  statusIdx: index('batch_jobs_status_idx').on(table.status),
}));

// --- BatchJobDocument ---

export const profileBatchJobDocuments = profilesSchema.table('batch_job_documents', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
  jobId: text('job_id').notNull().references(() => profileBatchJobs.id, { onDelete: 'cascade' }),
  contentItemId: text('content_item_id').notNull(),   // references content.items.id
  status: batchJobStatusEnum('status').notNull().default('pending'),
  errorMessage: text('error_message'),
  processedAt: timestamp('processed_at'),
}, (table) => ({
  jobIdx: index('batch_job_docs_job_id_idx').on(table.jobId),
  jobStatusIdx: index('batch_job_docs_job_status_idx').on(table.jobId, table.status),
}));

// --- ProfileDriftConfig ---

export const profileDriftConfigs = profilesSchema.table('drift_configs', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
  tenantId: text('tenant_id').notNull(),
  profileId: text('profile_id').notNull().references(() => profiles.id, { onDelete: 'cascade' }),
  driftThreshold: real('drift_threshold').notNull().default(0.7),
  autoRetrain: boolean('auto_retrain').notNull().default(true),
  maxRetrainFrequencyHours: integer('max_retrain_frequency_hours').notNull().default(24),
  lastDriftEventAt: timestamp('last_drift_event_at'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
}, (table) => ({
  profileUnique: uniqueIndex('drift_configs_profile_unique').on(table.profileId),
  tenantIdx: index('drift_configs_tenant_id_idx').on(table.tenantId),
}));

// ============================================================
// RELATIONS
// ============================================================

export const profilesRelations = relations(profiles, ({ many }) => ({
  versions: many(profileVersions),
  versionPins: many(profileVersionPins),
  auditEntries: many(profileAuditLog),
  batchJobs: many(profileBatchJobs),
  driftConfigs: many(profileDriftConfigs),
}));

export const profileVersionsRelations = relations(profileVersions, ({ one }) => ({
  profile: one(profiles, {
    fields: [profileVersions.profileId],
    references: [profiles.id],
  }),
}));

export const profileVersionPinsRelations = relations(profileVersionPins, ({ one }) => ({
  profile: one(profiles, {
    fields: [profileVersionPins.profileId],
    references: [profiles.id],
  }),
}));

export const profileAuditLogRelations = relations(profileAuditLog, ({ one }) => ({
  profile: one(profiles, {
    fields: [profileAuditLog.profileId],
    references: [profiles.id],
  }),
}));

export const profileBatchJobsRelations = relations(profileBatchJobs, ({ one, many }) => ({
  profile: one(profiles, {
    fields: [profileBatchJobs.profileId],
    references: [profiles.id],
  }),
  documents: many(profileBatchJobDocuments),
}));

export const profileBatchJobDocumentsRelations = relations(profileBatchJobDocuments, ({ one }) => ({
  job: one(profileBatchJobs, {
    fields: [profileBatchJobDocuments.jobId],
    references: [profileBatchJobs.id],
  }),
}));

export const profileDriftConfigsRelations = relations(profileDriftConfigs, ({ one }) => ({
  profile: one(profiles, {
    fields: [profileDriftConfigs.profileId],
    references: [profiles.id],
  }),
}));
```

**Files**:
- `src/profiles/schema.ts` (new, ~220 lines)

**Validation**:
- [ ] `tsc --noEmit` passes with zero errors on `schema.ts`
- [ ] All 7 tables are defined: `profiles`, `profile_versions`, `version_pins`, `audit_log`, `batch_jobs`, `batch_job_documents`, `drift_configs`
- [ ] All 5 enums are defined within the `profilesSchema` namespace
- [ ] All foreign key references use `.references()` with `onDelete: 'cascade'`
- [ ] ID generation uses `createId()` from `@paralleldrive/cuid2` (matching content schema pattern)
- [ ] Type exports use `$inferSelect` / `$inferInsert` (matching content schema pattern)

**Edge Cases**:
- `pgSchema('profiles')` creates the schema namespace but does not emit `CREATE SCHEMA` SQL — that must be in the migration (T006).
- `profiles.currentVersionNumber` is nullable — null means no training has completed yet.
- `profileAuditLog` intentionally does NOT have a foreign key to `profiles.id` — audit entries must survive profile deletion for compliance.
- `profileBatchJobDocuments.contentItemId` references `content.items.id` but uses a text field (not a foreign key) to avoid cross-schema foreign key complexity.

---

### T002: Create shared TypeScript types, enums, and constants (`src/profiles/types.ts`)

**Purpose**: Define all shared TypeScript interfaces, type aliases, and constants used across the profile module so that schema types and business logic types are co-located and importable without pulling in Drizzle.

**Steps**:
1. Create `src/profiles/types.ts`
2. Export inferred Drizzle `$inferSelect` / `$inferInsert` types (re-exported from schema for convenience)
3. Define business logic interfaces (FeatureVector, ProfileDiff, TrainedProfile)
4. Define module-level constants

```typescript
// src/profiles/types.ts

// ── Re-export row types from schema ────────────────────────────────────────
export type {
  Profile, NewProfile,
  ProfileVersion, NewProfileVersion,
  ProfileVersionPin, NewProfileVersionPin,
  ProfileAuditEntry, NewProfileAuditEntry,
  ProfileBatchJob, NewProfileBatchJob,
  ProfileBatchJobDocument, NewProfileBatchJobDocument,
  ProfileDriftConfig, NewProfileDriftConfig,
} from './schema';

// ── String literal enums (mirror DB enums for type safety in app code) ────
export type ProfileStatus = 'active' | 'archived' | 'pending_training';
export type AuthorType = 'person' | 'organization';
export type BatchJobStatus = 'pending' | 'running' | 'completed' | 'failed' | 'cancelled';
export type AuditAction = 'create' | 'read' | 'update' | 'delete' | 'retrain' | 'pin' | 'use_in_generation' | 'access_denied';
export type AuditResult = 'allowed' | 'denied';

// ── Feature Vector ─────────────────────────────────────────────────────────

export interface FeatureVector {
  /** 129-dimensional float array of stylometric features */
  features: number[];
  /** Human-readable feature names, parallel to the features array */
  featureNames: string[];
  /** Metadata about the extraction (engine version, timestamp, etc.) */
  extractionMetadata: Record<string, unknown>;
}

// ── Profile Diff ───────────────────────────────────────────────────────────

export interface FeatureDiff {
  featureName: string;
  oldValue: number;
  newValue: number;
  delta: number;          // newValue - oldValue
  percentChange: number;  // (delta / oldValue) * 100, or Infinity if oldValue is 0
}

export interface ProfileDiff {
  profileId: string;
  versionA: number;
  versionB: number;
  totalFeatures: number;
  changedFeatures: number;
  significantChanges: FeatureDiff[];  // features where |percentChange| > 5%
  allChanges: FeatureDiff[];
  overallSimilarity: number;  // 0.0-1.0 cosine similarity between versions
}

// ── Trained Profile (returned by engine) ───────────────────────────────────

export interface TrainedProfile {
  featureVector: FeatureVector;
  accuracyScore: number;         // 0.0-1.0
  trainingDurationMs: number;
  corpusSize: number;
}

// ── Batch Ingestion ────────────────────────────────────────────────────────

export interface BatchIngestionProgress {
  jobId: string;
  profileId: string;
  status: BatchJobStatus;
  totalDocuments: number;
  processedDocuments: number;
  failedDocuments: number;
  percentComplete: number;
}

// ── Cache Key ──────────────────────────────────────────────────────────────

export interface ProfileCacheKey {
  tenantId: string;
  profileId: string;
  versionNumber: number;
}

// ── Constants ──────────────────────────────────────────────────────────────

export const DEFAULT_STALENESS_THRESHOLD_DAYS = 30;
export const DEFAULT_DRIFT_THRESHOLD = 0.7;
export const DEFAULT_MAX_RETRAIN_FREQUENCY_HOURS = 24;
export const DEFAULT_CACHE_TTL_MS = 60 * 60 * 1000;       // 1 hour
export const DEFAULT_CACHE_MAX_SIZE = 1000;
export const FEATURE_VECTOR_DIMENSION = 129;
export const SIGNIFICANT_CHANGE_THRESHOLD_PERCENT = 5;
export const BATCH_CONCURRENCY = 5;                         // parallel document processing
export const MAX_BATCH_SIZE = 1000;                          // max documents per batch job
export const AUDIT_LOG_DEFAULT_RETENTION_DAYS = 90;
```

**Files**:
- `src/profiles/types.ts` (new, ~90 lines)

**Validation**:
- [ ] `tsc --noEmit` passes with zero errors on `types.ts`
- [ ] All string literal types match the corresponding schema enum values exactly
- [ ] `FeatureVector.features` is `number[]` (not a typed array — JSON serialization requires plain array)
- [ ] No circular imports between `types.ts` and `schema.ts`

**Edge Cases**:
- Re-exporting types from `schema.ts` creates a convenience layer. If `schema.ts` doesn't export the types, add them there first (as `$inferSelect` / `$inferInsert`).
- Constants file should not import from `./schema` to avoid circular references.

---

### T003: Create Zod validation schemas (`src/profiles/validation.ts`)

**Purpose**: Define runtime validation for all profile inputs — profile creation, retrain request, version pin, batch ingestion, and drift config — so that Express routes and MCP tools can validate untrusted input at the boundary.

**Steps**:
1. Create `src/profiles/validation.ts`
2. Define Zod schemas for each input type
3. Export inferred TypeScript types from Zod schemas

```typescript
// src/profiles/validation.ts
import { z } from 'zod';

export const createProfileSchema = z.object({
  authorName: z.string().min(1).max(200),
  authorType: z.enum(['person', 'organization']),
  description: z.string().max(1000).optional(),
  stalenessThresholdDays: z.number().int().min(1).max(365).optional(),
  metadata: z.record(z.unknown()).optional(),
  documentIds: z.array(z.string().min(1)).optional(),  // content item IDs for initial training
});

export const updateProfileSchema = z.object({
  authorName: z.string().min(1).max(200).optional(),
  description: z.string().max(1000).optional(),
  stalenessThresholdDays: z.number().int().min(1).max(365).optional(),
  metadata: z.record(z.unknown()).optional(),
});

export const retrainProfileSchema = z.object({
  documentIds: z.array(z.string().min(1)).min(1).max(1000),
});

export const pinVersionSchema = z.object({
  versionNumber: z.number().int().min(1),
  reason: z.string().max(500).optional(),
});

export const batchIngestionSchema = z.object({
  documentIds: z.array(z.string().min(1)).min(1).max(1000),
});

export const driftConfigSchema = z.object({
  driftThreshold: z.number().min(0).max(1).optional(),
  autoRetrain: z.boolean().optional(),
  maxRetrainFrequencyHours: z.number().int().min(1).max(720).optional(),  // max 30 days
});

export const auditLogQuerySchema = z.object({
  action: z.enum([
    'create', 'read', 'update', 'delete', 'retrain',
    'pin', 'use_in_generation', 'access_denied',
  ]).optional(),
  startDate: z.string().datetime().optional(),
  endDate: z.string().datetime().optional(),
  limit: z.number().int().min(1).max(100).default(50),
  offset: z.number().int().min(0).default(0),
});

// Inferred TypeScript types from Zod schemas
export type CreateProfileInput = z.infer<typeof createProfileSchema>;
export type UpdateProfileInput = z.infer<typeof updateProfileSchema>;
export type RetrainProfileInput = z.infer<typeof retrainProfileSchema>;
export type PinVersionInput = z.infer<typeof pinVersionSchema>;
export type BatchIngestionInput = z.infer<typeof batchIngestionSchema>;
export type DriftConfigInput = z.infer<typeof driftConfigSchema>;
export type AuditLogQueryInput = z.infer<typeof auditLogQuerySchema>;
```

**Files**:
- `src/profiles/validation.ts` (new, ~60 lines)

**Validation**:
- [ ] `tsc --noEmit` passes with zero errors on `validation.ts`
- [ ] `createProfileSchema.parse({ authorName: 'x', authorType: 'person' })` returns valid object
- [ ] `batchIngestionSchema.parse({ documentIds: [] })` throws ZodError (min 1)
- [ ] All enum values in Zod match the TypeScript union types in `types.ts`

**Edge Cases**:
- `documentIds` in `createProfileSchema` is optional — a profile can be created without immediate training (status will be `pending_training`).
- `auditLogQuerySchema` includes `startDate`/`endDate` as ISO 8601 strings — they are parsed and validated by Zod's `.datetime()`.

---

### T004: Create module barrel export (`src/profiles/index.ts`)

**Purpose**: Provide a single import entry point for the profiles module.

**Steps**:
1. Create `src/profiles/index.ts`
2. Re-export schema, types, and validation
3. Leave submodule exports as stubs (to be filled in by later WPs)

```typescript
// src/profiles/index.ts
export * from './schema';
export * from './types';
export * from './validation';

// These exports are populated by later WPs:
// export * from './access';       // WP02
// export * from './versioning';   // WP03
// export * from './ingestion';    // WP04
// export * from './cache';        // WP05
// export * from './engine';       // WP06
// export * from './retraining';   // WP06
```

**Files**:
- `src/profiles/index.ts` (new, ~15 lines)

**Validation**:
- [ ] `import { profiles, FeatureVector, createProfileSchema } from '../profiles'` resolves without errors
- [ ] No circular imports between `index.ts`, `schema.ts`, `types.ts`, and `validation.ts`

---

### T005: Export profiles schema from `src/db/client.ts`

**Purpose**: Make the Drizzle profiles schema tables available through the shared database client, following the existing pattern used for the content schema.

**Steps**:
1. Open `src/db/client.ts` (existing file)
2. Import the profiles schema tables from `../profiles/schema`
3. Add them to the Drizzle client's schema option alongside existing tables

```typescript
// src/db/client.ts — add to existing file
import * as profilesTables from '../profiles/schema';

// Add to existing drizzle() call schema object:
export const db = drizzle(pool, {
  schema: {
    ...existingTables,
    ...contentTables,      // already present from Spec 006
    ...profilesTables,     // NEW
  },
});
```

**Files**:
- `src/db/client.ts` (modified)

**Validation**:
- [ ] `tsc --noEmit` passes on `src/db/client.ts` after modification
- [ ] Existing tests that import `db` continue to pass
- [ ] `db.query.profiles.findMany()` resolves without TypeScript errors

**Edge Cases**:
- Verify the existing `db/client.ts` pattern before modifying — it may use a different wiring approach than the schema spread shown above. Match what is already there.
- Do not create a circular dependency: `client.ts` -> `profiles/schema.ts` must not loop back to `db/client.ts`.

---

### T006: Generate Drizzle migration (`drizzle/`)

**Purpose**: Produce the SQL migration file that creates the `profiles` schema, all 5 enums, and all 7 tables.

**Steps**:
1. Run `npx drizzle-kit generate` (or the project's existing migration script)
2. Verify the generated SQL file contains `CREATE SCHEMA IF NOT EXISTS "profiles"`
3. If the migration tool does not generate `CREATE SCHEMA`, add it manually to the top
4. Verify all 7 `CREATE TABLE` statements are present
5. Verify all 5 enum `CREATE TYPE` statements are in the `profiles` schema namespace

**Expected at top of migration file**:
```sql
CREATE SCHEMA IF NOT EXISTS "profiles";

CREATE TYPE "profiles"."profile_status" AS ENUM('active', 'archived', 'pending_training');
CREATE TYPE "profiles"."author_type" AS ENUM('person', 'organization');
CREATE TYPE "profiles"."batch_job_status" AS ENUM('pending', 'running', 'completed', 'failed', 'cancelled');
CREATE TYPE "profiles"."audit_action" AS ENUM('create', 'read', 'update', 'delete', 'retrain', 'pin', 'use_in_generation', 'access_denied');
CREATE TYPE "profiles"."audit_result" AS ENUM('allowed', 'denied');
```

**Files**:
- `drizzle/<timestamp>_profiles_schema.sql` (new, generated)

**Validation**:
- [ ] Migration file contains `CREATE SCHEMA IF NOT EXISTS "profiles"`
- [ ] Migration file contains all 5 `CREATE TYPE` statements
- [ ] Migration file contains all 7 `CREATE TABLE "profiles".*` statements
- [ ] `npx drizzle-kit push` applies the migration without errors against a test database

**Edge Cases**:
- Drizzle Kit may not automatically prepend `CREATE SCHEMA IF NOT EXISTS`. Inspect the generated file and add it if missing.
- Migration file naming: use the project's existing timestamp format.

---

### T007: Verify typecheck and existing tests pass

**Purpose**: Confirm that the schema foundation does not break existing tests or introduce TypeScript errors.

**Steps**:
1. Run `npm run typecheck` (or `tsc --noEmit`) from the repo root
2. Run `npm test` and confirm zero regressions
3. Fix any type errors introduced by the `src/db/client.ts` modification

**Files**:
- No new files. May require minor edits to `src/db/client.ts`.

**Validation**:
- [ ] `npm run typecheck` exits 0 with zero errors
- [ ] `npm test` exits 0 with the same number of passing tests as before this WP
- [ ] No pre-existing test failures are masked or hidden

---

## Definition of Done

- [ ] `src/profiles/schema.ts` — 7 tables, 5 enums, relations defined
- [ ] `src/profiles/types.ts` — re-exported types, business logic interfaces, constants
- [ ] `src/profiles/validation.ts` — Zod schemas for all profile inputs
- [ ] `src/profiles/index.ts` — barrel export wiring schema/types/validation
- [ ] `src/db/client.ts` — exports profiles schema tables
- [ ] `drizzle/<timestamp>_profiles_schema.sql` — migration with `CREATE SCHEMA IF NOT EXISTS profiles`
- [ ] `npm run typecheck` exits 0
- [ ] `npm test` exits 0 with no regressions

## Risks

- **Drizzle pgSchema gap**: `pgSchema` may not emit `CREATE SCHEMA` in the migration. Inspect and patch manually if needed.
- **db.client.ts type widening**: Adding tables to the Drizzle schema object widens its type. Existing code using strict `typeof db` checks may need updating.
- **Cross-schema references**: `profileBatchJobDocuments.contentItemId` is a text field, not a foreign key to `content.items.id`. This is intentional — cross-schema FKs add migration complexity with no runtime benefit since the profile module validates document ownership in application code.

## Reviewer Guidance

- Verify the `profiles` PostgreSQL schema namespace is used consistently: all tables should be `profilesSchema.table(...)`, not top-level `pgTable(...)`.
- Check that `featureVector` column uses `jsonb` (not `json`) — `jsonb` is indexable and more efficient.
- Confirm `tenantId` columns are on every table that needs tenant scoping (profiles, version_pins, audit_log, batch_jobs, drift_configs). Note: `profile_versions` and `batch_job_documents` inherit tenant scope through their parent FK.
- Verify ID generation uses `createId()` from `@paralleldrive/cuid2` — NOT `uuid().defaultRandom()`. The content schema uses CUIDs and the profiles schema must match.
- Confirm the `audit_log` table has NO foreign key to `profiles.id` — audit entries must survive profile deletion.
