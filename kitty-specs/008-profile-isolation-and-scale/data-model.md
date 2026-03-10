# Data Model: Profile Isolation and Scale
*Phase 1 output for Feature 008*

## Schema Overview

All profile isolation tables live in the PostgreSQL `profiles` schema, separate from the existing `public` schema (platform core) and `content` schema (Feature 006). This provides clean namespace boundaries and enables independent access control.

```
profiles schema
├── tenant_profiles         # Profile versions (immutable rows)
├── corpus_snapshots        # Immutable corpus version records
├── corpus_documents        # Individual documents with content hash
├── profile_versions        # Version metadata and lifecycle tracking
├── profile_inheritance     # Parent-child hierarchy relationships
├── profile_cache           # Resolved (merged) profiles
├── generation_runs         # Profile generation pipeline execution history
└── operation_logs          # Structured profile operation audit trail
```

## Drizzle Schema Definition

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
  uniqueIndex,
  index,
  primaryKey,
} from 'drizzle-orm/pg-core';

// ============================================================
// SCHEMA NAMESPACE
// ============================================================

export const profilesSchema = pgSchema('profiles');

// ============================================================
// ENUMS
// ============================================================

export const profileTierEnum = profilesSchema.enum('profile_tier', [
  'org',
  'department',
  'individual',
]);

export const profileStatusEnum = profilesSchema.enum('profile_status', [
  'generating',
  'active',
  'rolled_back',
  'archived',
  'deleted',
]);

export const generationRunStatusEnum = profilesSchema.enum('generation_run_status', [
  'pending',
  'running',
  'completed',
  'failed',
]);

export const documentFormatEnum = profilesSchema.enum('document_format', [
  'pdf',
  'docx',
  'txt',
  'html',
  'markdown',
]);
```

## Entities

### TenantProfile

The core entity: an immutable profile version. Each row represents a single version of a profile for a specific author/tier within a tenant. Versions are never mutated — updates create new rows.

| Field | Type | Constraints | Description |
|-------|------|-------------|-------------|
| id | text (CUID2) | PK | Unique identifier for this profile version |
| tenantId | text | NOT NULL, INDEX | Tenant this profile belongs to (Leash pattern) |
| profileIdentity | text | NOT NULL | Stable identity across versions (e.g., `org::default`, `dept::engineering`, `individual::author-001`) |
| version | integer | NOT NULL | Monotonically increasing within (tenantId, profileIdentity) |
| authorId | text | NULL | Reference to attributed author (NULL for org/dept profiles) |
| authorName | text | NULL | Display name of the author (NULL for org/dept profiles) |
| tier | profileTierEnum | NOT NULL | `org` \| `department` \| `individual` |
| parentProfileId | text | NULL, FK → tenant_profiles.id | Parent in inheritance chain (NULL for org-level) |
| corpusSnapshotId | text | NOT NULL, FK → corpus_snapshots.id | Corpus version used for generation |
| stylometricFeatures | jsonb | NOT NULL | 129-feature vector (Spec 005 schema) |
| markers | jsonb | NOT NULL | Marker set (Spec 005 markers.json schema) |
| fidelityScore | real | NULL | Attribution accuracy at time of generation (0.0–1.0) |
| status | profileStatusEnum | NOT NULL, DEFAULT 'generating' | `generating` \| `active` \| `rolled_back` \| `archived` \| `deleted` |
| metadata | jsonb | NOT NULL, DEFAULT '{}' | Generation metadata (engine version, parameters, timing) |
| createdAt | timestamp | NOT NULL, DEFAULT now() | |
| updatedAt | timestamp | NOT NULL, DEFAULT now() | |
| archivedAt | timestamp | NULL | When this version was archived |

```typescript
export const tenantProfiles = profilesSchema.table('tenant_profiles', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
  tenantId: text('tenant_id').notNull(),
  profileIdentity: text('profile_identity').notNull(),
  version: integer('version').notNull(),
  authorId: text('author_id'),
  authorName: text('author_name'),
  tier: profileTierEnum('tier').notNull(),
  parentProfileId: text('parent_profile_id'),
  corpusSnapshotId: text('corpus_snapshot_id').notNull(),
  stylometricFeatures: jsonb('stylometric_features').notNull(),
  markers: jsonb('markers').notNull(),
  fidelityScore: real('fidelity_score'),
  status: profileStatusEnum('status').notNull().default('generating'),
  metadata: jsonb('metadata').notNull().$defaultFn(() => ({})),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
  archivedAt: timestamp('archived_at'),
}, (table) => ({
  tenantIdIdx: index('profiles_tenant_id_idx').on(table.tenantId),
  tenantIdentityIdx: index('profiles_tenant_identity_idx').on(table.tenantId, table.profileIdentity),
  tenantIdentityVersionUnique: uniqueIndex('profiles_tenant_identity_version_unique')
    .on(table.tenantId, table.profileIdentity, table.version),
  tenantStatusIdx: index('profiles_tenant_status_idx').on(table.tenantId, table.status),
  tenantTierIdx: index('profiles_tenant_tier_idx').on(table.tenantId, table.tier),
  tenantActiveIdx: index('profiles_tenant_active_idx').on(table.tenantId, table.status)
    .where(sql`status = 'active'`),
  parentProfileIdx: index('profiles_parent_profile_idx').on(table.parentProfileId),
}));
```

**Indexes**: `tenantId`, `(tenantId, profileIdentity)`, `(tenantId, profileIdentity, version)` UNIQUE, `(tenantId, status)`, `(tenantId, tier)`, partial index on `(tenantId, status)` WHERE status = 'active', `parentProfileId`

### CorpusSnapshot

An immutable record of which documents comprised a corpus at the time of profile generation. Snapshots are never modified after creation.

| Field | Type | Constraints | Description |
|-------|------|-------------|-------------|
| id | text (CUID2) | PK | Unique identifier |
| tenantId | text | NOT NULL, INDEX | Tenant this snapshot belongs to |
| name | text | NULL | Optional human-readable name (e.g., "Initial corpus", "March 2026 update") |
| documentHashes | jsonb | NOT NULL | Array of content hashes included in this snapshot |
| documentCount | integer | NOT NULL | Total documents in snapshot |
| authorCount | integer | NOT NULL | Distinct authors detected |
| totalWordCount | integer | NOT NULL, DEFAULT 0 | Total words across all documents |
| createdAt | timestamp | NOT NULL, DEFAULT now() | |

```typescript
export const corpusSnapshots = profilesSchema.table('corpus_snapshots', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
  tenantId: text('tenant_id').notNull(),
  name: text('name'),
  documentHashes: jsonb('document_hashes').notNull(),
  documentCount: integer('document_count').notNull(),
  authorCount: integer('author_count').notNull(),
  totalWordCount: integer('total_word_count').notNull().default(0),
  createdAt: timestamp('created_at').defaultNow().notNull(),
}, (table) => ({
  tenantIdIdx: index('corpus_snapshots_tenant_id_idx').on(table.tenantId),
  tenantCreatedIdx: index('corpus_snapshots_tenant_created_idx').on(table.tenantId, table.createdAt),
}));
```

**Indexes**: `tenantId`, `(tenantId, createdAt)`

### CorpusDocument

Individual documents within a tenant's corpus. Documents are identified by content hash for deduplication (FR-007).

| Field | Type | Constraints | Description |
|-------|------|-------------|-------------|
| id | text (CUID2) | PK | Unique identifier |
| tenantId | text | NOT NULL, INDEX | Tenant this document belongs to |
| contentHash | text | NOT NULL | SHA-256 hash of normalized text content |
| originalFilename | text | NOT NULL | Original uploaded filename |
| format | documentFormatEnum | NOT NULL | `pdf` \| `docx` \| `txt` \| `html` \| `markdown` |
| title | text | NULL | Extracted or user-provided title |
| authorId | text | NULL | Attributed author (NULL if unattributed) |
| authorName | text | NULL | Author display name (NULL if unattributed) |
| extractedText | text | NOT NULL | Normalized plain text content |
| wordCount | integer | NOT NULL | Word count of extracted text |
| dataTier | integer | NOT NULL, DEFAULT 1 | Data governance tier (1-4, per §3.1) |
| metadata | jsonb | NOT NULL, DEFAULT '{}' | Extraction metadata (page count, parser warnings, etc.) |
| isActive | boolean | NOT NULL, DEFAULT true | Soft-delete flag |
| createdAt | timestamp | NOT NULL, DEFAULT now() | |

```typescript
export const corpusDocuments = profilesSchema.table('corpus_documents', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
  tenantId: text('tenant_id').notNull(),
  contentHash: text('content_hash').notNull(),
  originalFilename: text('original_filename').notNull(),
  format: documentFormatEnum('format').notNull(),
  title: text('title'),
  authorId: text('author_id'),
  authorName: text('author_name'),
  extractedText: text('extracted_text').notNull(),
  wordCount: integer('word_count').notNull(),
  dataTier: integer('data_tier').notNull().default(1),
  metadata: jsonb('metadata').notNull().$defaultFn(() => ({})),
  isActive: boolean('is_active').notNull().default(true),
  createdAt: timestamp('created_at').defaultNow().notNull(),
}, (table) => ({
  tenantIdIdx: index('corpus_docs_tenant_id_idx').on(table.tenantId),
  tenantHashUnique: uniqueIndex('corpus_docs_tenant_hash_unique').on(table.tenantId, table.contentHash),
  tenantAuthorIdx: index('corpus_docs_tenant_author_idx').on(table.tenantId, table.authorId),
  tenantActiveIdx: index('corpus_docs_tenant_active_idx').on(table.tenantId, table.isActive),
}));
```

**Indexes**: `tenantId`, `(tenantId, contentHash)` UNIQUE, `(tenantId, authorId)`, `(tenantId, isActive)`

**Deduplication**: The `(tenantId, contentHash)` unique index enforces FR-007 — duplicate detection operates within tenant scope only. The content hash is computed from the normalized extracted text (after Unicode normalization, whitespace collapsing, and line ending normalization), not the raw file bytes. This ensures that the same text uploaded as PDF and DOCX is detected as a duplicate.

### ProfileInheritance

Parent-child relationships in the profile hierarchy. Defines the inheritance chain used for composite profile resolution.

| Field | Type | Constraints | Description |
|-------|------|-------------|-------------|
| id | text (CUID2) | PK | Unique identifier |
| tenantId | text | NOT NULL, INDEX | Tenant context |
| parentProfileIdentity | text | NOT NULL | Parent profile identity (e.g., `org::default`) |
| childProfileIdentity | text | NOT NULL | Child profile identity (e.g., `dept::engineering`) |
| createdAt | timestamp | NOT NULL, DEFAULT now() | |

```typescript
export const profileInheritance = profilesSchema.table('profile_inheritance', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
  tenantId: text('tenant_id').notNull(),
  parentProfileIdentity: text('parent_profile_identity').notNull(),
  childProfileIdentity: text('child_profile_identity').notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
}, (table) => ({
  tenantIdIdx: index('profile_inheritance_tenant_id_idx').on(table.tenantId),
  tenantParentIdx: index('profile_inheritance_tenant_parent_idx')
    .on(table.tenantId, table.parentProfileIdentity),
  tenantChildIdx: index('profile_inheritance_tenant_child_idx')
    .on(table.tenantId, table.childProfileIdentity),
  tenantParentChildUnique: uniqueIndex('profile_inheritance_tenant_parent_child_unique')
    .on(table.tenantId, table.parentProfileIdentity, table.childProfileIdentity),
}));
```

**Indexes**: `tenantId`, `(tenantId, parentProfileIdentity)`, `(tenantId, childProfileIdentity)`, `(tenantId, parentProfileIdentity, childProfileIdentity)` UNIQUE

**Design note**: Inheritance relationships reference `profileIdentity` (stable across versions), not specific profile version IDs. This means the inheritance chain is version-independent — when a new version of a parent profile is created, the child automatically inherits from the new version's active instance. The resolved profile cache is invalidated when any profile in the chain gets a new active version.

### ProfileCache

Precomputed resolved profiles. Stores the fully-merged feature vector after inheritance resolution. Invalidated on any upstream change.

| Field | Type | Constraints | Description |
|-------|------|-------------|-------------|
| id | text (CUID2) | PK | Unique identifier |
| tenantId | text | NOT NULL | Tenant context |
| profileIdentity | text | NOT NULL | Which profile identity this cache entry resolves |
| resolvedFeatures | jsonb | NOT NULL | Fully-merged 129-feature vector |
| resolvedMarkers | jsonb | NOT NULL | Fully-merged marker set |
| overrideSources | jsonb | NOT NULL | Map: featureKey → { sourceTier, sourceProfileId, sourceVersion } |
| ancestorVersions | jsonb | NOT NULL | Snapshot of ancestor versions at resolution time (for staleness detection) |
| resolvedAt | timestamp | NOT NULL, DEFAULT now() | When this resolution was computed |

```typescript
export const profileCache = profilesSchema.table('profile_cache', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
  tenantId: text('tenant_id').notNull(),
  profileIdentity: text('profile_identity').notNull(),
  resolvedFeatures: jsonb('resolved_features').notNull(),
  resolvedMarkers: jsonb('resolved_markers').notNull(),
  overrideSources: jsonb('override_sources').notNull(),
  ancestorVersions: jsonb('ancestor_versions').notNull(),
  resolvedAt: timestamp('resolved_at').defaultNow().notNull(),
}, (table) => ({
  tenantProfileUnique: uniqueIndex('profile_cache_tenant_profile_unique')
    .on(table.tenantId, table.profileIdentity),
}));
```

**Indexes**: `(tenantId, profileIdentity)` UNIQUE

**Cache semantics**: At most one cache entry per `(tenantId, profileIdentity)` pair. Cache writes use `INSERT ... ON CONFLICT UPDATE` (upsert). Cache invalidation deletes the row. A cache miss triggers on-demand inheritance resolution and cache population.

### GenerationRun

Individual profile generation pipeline execution record. Tracks the pipeline from corpus snapshot through engine invocation to profile creation.

| Field | Type | Constraints | Description |
|-------|------|-------------|-------------|
| id | text (CUID2) | PK | Unique identifier |
| tenantId | text | NOT NULL, INDEX | Tenant context |
| corpusSnapshotId | text | NOT NULL, FK → corpus_snapshots.id | Corpus used for this generation |
| status | generationRunStatusEnum | NOT NULL | `pending` \| `running` \| `completed` \| `failed` |
| trigger | text | NOT NULL | What triggered this run (e.g., `corpus-upload`, `manual`, `scheduled`) |
| profilesRequested | integer | NOT NULL, DEFAULT 0 | Number of profiles requested for generation |
| profilesCompleted | integer | NOT NULL, DEFAULT 0 | Number of profiles successfully generated |
| profilesFailed | integer | NOT NULL, DEFAULT 0 | Number of profiles that failed generation |
| profileIds | jsonb | NOT NULL, DEFAULT '[]' | Array of generated profile IDs |
| error | text | NULL | Error message if failed |
| engineVersion | text | NULL | Spec 005 engine version used |
| startedAt | timestamp | NOT NULL, DEFAULT now() | |
| completedAt | timestamp | NULL | |
| durationMs | integer | NULL | Total pipeline duration in milliseconds |

```typescript
export const generationRuns = profilesSchema.table('generation_runs', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
  tenantId: text('tenant_id').notNull(),
  corpusSnapshotId: text('corpus_snapshot_id').notNull()
    .references(() => corpusSnapshots.id),
  status: generationRunStatusEnum('status').notNull(),
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
  tenantIdIdx: index('gen_runs_tenant_id_idx').on(table.tenantId),
  tenantStartedIdx: index('gen_runs_tenant_started_idx').on(table.tenantId, table.startedAt),
  statusIdx: index('gen_runs_status_idx').on(table.status),
  corpusSnapshotIdx: index('gen_runs_corpus_snapshot_idx').on(table.corpusSnapshotId),
}));
```

**Indexes**: `tenantId`, `(tenantId, startedAt)`, `status`, `corpusSnapshotId`

### OperationLog

Structured audit log for all profile operations (FR-001 compliance, §3.3 audit trail).

| Field | Type | Constraints | Description |
|-------|------|-------------|-------------|
| id | text (CUID2) | PK | Unique identifier |
| tenantId | text | NOT NULL | Tenant context |
| operation | text | NOT NULL | Operation type (generate, rollback, resolve, intake, cache-invalidate, delete) |
| profileIdentity | text | NULL | Related profile identity |
| userId | text | NULL | Related user (if user-initiated) |
| durationMs | integer | NOT NULL | Operation duration |
| success | boolean | NOT NULL | Whether operation succeeded |
| metadata | jsonb | NOT NULL, DEFAULT '{}' | Operation-specific details |
| createdAt | timestamp | NOT NULL, DEFAULT now() | |

```typescript
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
  tenantOpCreatedIdx: index('profile_op_logs_tenant_op_created_idx')
    .on(table.tenantId, table.operation, table.createdAt),
  tenantCreatedIdx: index('profile_op_logs_tenant_created_idx')
    .on(table.tenantId, table.createdAt),
}));
```

**Indexes**: `(tenantId, operation, createdAt)`, `(tenantId, createdAt)`

**Append-only**: Operation log entries are append-only (no updates or deletes) for audit compliance per §3.3.

## Relations

```typescript
// ============================================================
// RELATIONS
// ============================================================

export const tenantProfilesRelations = relations(tenantProfiles, ({ one, many }) => ({
  corpusSnapshot: one(corpusSnapshots, {
    fields: [tenantProfiles.corpusSnapshotId],
    references: [corpusSnapshots.id],
  }),
  parentProfile: one(tenantProfiles, {
    fields: [tenantProfiles.parentProfileId],
    references: [tenantProfiles.id],
    relationName: 'parentChild',
  }),
  childProfiles: many(tenantProfiles, { relationName: 'parentChild' }),
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
```

## Relationship Diagram

```
CorpusDocument     N ←→ 1  Tenant           (documents belong to a tenant)
CorpusSnapshot     N ←→ 1  Tenant           (snapshots belong to a tenant)
CorpusSnapshot     1 ←→ N  CorpusDocument   (snapshot references documents via hashes)
TenantProfile      N ←→ 1  CorpusSnapshot   (profile built from a snapshot)
TenantProfile      N ←→ 1  TenantProfile    (parent-child via parentProfileId)
ProfileInheritance N ←→ 1  Tenant           (hierarchy belongs to a tenant)
ProfileCache       N ←→ 1  Tenant           (cache entries scoped to tenant)
GenerationRun      N ←→ 1  CorpusSnapshot   (generation uses a snapshot)
GenerationRun      N ←→ 1  Tenant           (runs belong to a tenant)
```

## State Transitions

### TenantProfile.status
```
generating → active       (generation completed successfully)
generating → failed       (generation failed — row may be deleted or kept for diagnostics)
active → rolled_back      (another version was rolled back to, displacing this one)
rolled_back → active      (this version was selected as rollback target)
active → archived         (retention policy: version exceeded retention window)
rolled_back → archived    (retention policy)
archived → deleted        (hard-delete after 30-day soft-delete window)
```

### GenerationRun.status
```
pending → running         (pipeline picked up the run)
running → completed       (all requested profiles generated)
running → failed          (unrecoverable error)
```

## Data Governance Notes

- `CorpusDocument.dataTier` maps to Constitution §3.1 tiers (1-4). Documents at tier 3-4 require enterprise plan isolation.
- `CorpusDocument.extractedText` contains the full normalized text. For tier 4 documents, this field should be encrypted at rest (reuse existing `encryptToken`/`decryptToken` from `db/encryption.ts` or extend to field-level encryption).
- `ProfileOperationLog` entries are append-only — no updates or deletes. This satisfies the §3.3 audit trail requirement.
- `TenantProfile.stylometricFeatures` and `markers` are derived knowledge (statistical patterns), not content. Per Spec 005 §7.2 Principle 1, these are safe to use without content-level access restrictions. The corpus documents that produced them may have access restrictions, but the derived features do not.
- Tenant deletion: soft-delete all rows across all tables for the tenant (set `isActive = false` or `status = 'deleted'`). Hard-delete after 30-day recovery window. Verify no orphaned data remains in shared indexes.
- Content hashes (`corpusDocuments.contentHash`) are computed from normalized text, not raw file bytes. This is a one-way hash (SHA-256) — the hash cannot reconstruct the original text.

## Type Exports

```typescript
// ============================================================
// TYPE EXPORTS
// ============================================================

export type TenantProfile = typeof tenantProfiles.$inferSelect;
export type NewTenantProfile = typeof tenantProfiles.$inferInsert;

export type CorpusSnapshot = typeof corpusSnapshots.$inferSelect;
export type NewCorpusSnapshot = typeof corpusSnapshots.$inferInsert;

export type CorpusDocument = typeof corpusDocuments.$inferSelect;
export type NewCorpusDocument = typeof corpusDocuments.$inferInsert;

export type ProfileInheritanceRow = typeof profileInheritance.$inferSelect;
export type NewProfileInheritanceRow = typeof profileInheritance.$inferInsert;

export type ProfileCacheEntry = typeof profileCache.$inferSelect;
export type NewProfileCacheEntry = typeof profileCache.$inferInsert;

export type GenerationRun = typeof generationRuns.$inferSelect;
export type NewGenerationRun = typeof generationRuns.$inferInsert;

export type ProfileOperationLog = typeof profileOperationLogs.$inferSelect;
export type NewProfileOperationLog = typeof profileOperationLogs.$inferInsert;

export type ProfileTier = 'org' | 'department' | 'individual';
export type ProfileStatus = 'generating' | 'active' | 'rolled_back' | 'archived' | 'deleted';
export type GenerationRunStatus = 'pending' | 'running' | 'completed' | 'failed';
export type DocumentFormat = 'pdf' | 'docx' | 'txt' | 'html' | 'markdown';
```
