---
work_package_id: "WP01"
title: "Schema & Foundation"
lane: "planned"
dependencies: []
subtasks: ["T001", "T002", "T003", "T004", "T005", "T006"]
phase: "Phase 1 - Data Model & Interfaces"
assignee: ""
agent: ""
shell_pid: ""
review_status: ""
reviewed_by: ""
history:
  - timestamp: "2026-03-10T00:00:00Z"
    lane: "planned"
    agent: "system"
    action: "Prompt generated via /spec-kitty.tasks"
---

# WP01: Schema & Foundation

## Objective

Create the Drizzle ORM schema for the `profiles` PostgreSQL schema (7 tables, 4 enums), tenant-scoped query helpers enforcing the Leash pattern (ADR-0002), Zod validation schemas for all profile operations, shared TypeScript types and constants, a Drizzle migration, and wire the schema exports into the existing database client. This is the foundation that every subsequent work package builds on.

## Implementation Command

```bash
spec-kitty implement WP01
```

## Context

- **Spec**: `kitty-specs/008-profile-isolation-and-scale/spec.md`
- **Plan**: `kitty-specs/008-profile-isolation-and-scale/plan.md`
- **Data Model**: `kitty-specs/008-profile-isolation-and-scale/data-model.md` (authoritative schema reference)
- **Research**: `kitty-specs/008-profile-isolation-and-scale/research.md` (R1: TenantScope utility, R2: Immutable versioning)
- **Existing Pattern**: `src/content/schema.ts` uses `pgSchema('content').table(...)` — follow the same approach with `pgSchema('profiles')`
- **Existing DB Client**: `src/db/client.ts` — extend to export profiles schema (same pattern as content schema export)

The profiles module extends the existing `joyus-ai-mcp-server` package as a new `src/profiles/` directory, parallel to `src/content/`. All tables live in a PostgreSQL `profiles` schema (separate from `public` and `content` schemas).

---

## Subtask T001: Create Profiles Drizzle Schema

**Purpose**: Define all 7 profile tables and 4 enums using Drizzle ORM with the `profiles` pgSchema.

**Steps**:
1. Create `joyus-ai-mcp-server/src/profiles/schema.ts`
2. Import from `drizzle-orm/pg-core`: `pgSchema`, `text`, `timestamp`, `boolean`, `integer`, `real`, `jsonb`, `uniqueIndex`, `index`
3. Import `relations` from `drizzle-orm` and `createId` from `@paralleldrive/cuid2`
4. Define `export const profilesSchema = pgSchema('profiles')`
5. Define 4 enums using `profilesSchema.enum(...)`:
   - `profile_tier`: `org`, `department`, `individual`
   - `profile_status`: `generating`, `active`, `rolled_back`, `archived`, `deleted`
   - `generation_run_status`: `pending`, `running`, `completed`, `failed`
   - `document_format`: `pdf`, `docx`, `txt`, `html`, `markdown`
6. Define all 7 tables per data-model.md using `profilesSchema.table(...)`:
   - `tenant_profiles` — immutable profile versions with 129-feature vector
   - `corpus_snapshots` — immutable corpus version records
   - `corpus_documents` — individual documents with content hash deduplication
   - `profile_inheritance` — parent-child hierarchy relationships
   - `profile_cache` — resolved (merged) profiles
   - `generation_runs` — pipeline execution tracking
   - `operation_logs` — audit trail (append-only)
7. Define all indexes per data-model.md, including:
   - `tenant_profiles`: `(tenantId, profileIdentity, version)` UNIQUE, partial index on `(tenantId, status)` WHERE status = 'active', `parentProfileId`
   - `corpus_documents`: `(tenantId, contentHash)` UNIQUE for deduplication (FR-007)
   - `profile_inheritance`: `(tenantId, parentProfileIdentity, childProfileIdentity)` UNIQUE
   - `profile_cache`: `(tenantId, profileIdentity)` UNIQUE
8. Define relations using `relations()`:
   - `tenantProfiles` -> `corpusSnapshots` (many-to-one via corpusSnapshotId)
   - `tenantProfiles` -> `tenantProfiles` (self-referential parent-child via parentProfileId)
   - `corpusSnapshots` -> `tenantProfiles` (one-to-many)
   - `corpusSnapshots` -> `generationRuns` (one-to-many)
   - `generationRuns` -> `corpusSnapshots` (many-to-one via corpusSnapshotId)
9. Export type aliases via `$inferSelect` and `$inferInsert` for all 7 tables
10. Export string literal union types: `ProfileTier`, `ProfileStatus`, `GenerationRunStatus`, `DocumentFormat`

**Important implementation details**:
- All tables use CUID2 for primary keys (matching existing pattern in `src/db/schema.ts`)
- The partial index `WHERE status = 'active'` on `tenant_profiles` may require raw SQL: `.where(sql\`status = 'active'\`)`
- `stylometricFeatures` and `markers` are `jsonb` columns storing the 129-feature vector and marker set from Spec 005
- `corpusDocuments.extractedText` is a `text` column (not jsonb) — stores the full normalized plain text
- `operationLogs` is append-only — no update or delete operations should be possible from the service layer (enforce in code, not DB constraint)
- Follow the exact column naming from data-model.md (snake_case in DB, camelCase in Drizzle)

**Files**:
- `joyus-ai-mcp-server/src/profiles/schema.ts` (new, ~350 lines)

**Validation**:
- [ ] `npm run typecheck` passes
- [ ] All 7 tables defined with correct columns per data-model.md
- [ ] All 4 enums defined with correct values
- [ ] All relations defined
- [ ] All indexes defined including the partial index and unique constraints
- [ ] Type exports work: `TenantProfile`, `NewTenantProfile`, `CorpusSnapshot`, etc.

---

## Subtask T002: Create Shared Types and Constants

**Purpose**: Define TypeScript types and constants shared across all profiles submodules.

**Steps**:
1. Create `joyus-ai-mcp-server/src/profiles/types.ts`
2. Define string literal union types (mirroring the Drizzle enums for use in service code):
   - `ProfileTier = 'org' | 'department' | 'individual'`
   - `ProfileStatus = 'generating' | 'active' | 'rolled_back' | 'archived' | 'deleted'`
   - `GenerationRunStatus = 'pending' | 'running' | 'completed' | 'failed'`
   - `DocumentFormat = 'pdf' | 'docx' | 'txt' | 'html' | 'markdown'`
   - `ProfileOperationType = 'generate' | 'rollback' | 'resolve' | 'intake' | 'cache-invalidate' | 'delete'`
3. Define interfaces:
   - `StylometricFeatures` — Record<string, number> for the 129-feature vector
   - `ProfileMarkers` — typed marker set (array of marker objects with name, threshold, frequency, context)
   - `ResolvedFeature` — `{ value: number; sourceTier: ProfileTier; sourceProfileId: string; sourceVersion: number }`
   - `ResolvedProfile` — `{ features: Map<string, ResolvedFeature>; markers: ProfileMarkers; overrideSources: Record<string, { tier, profileId, version }> }`
   - `ParseResult` — `{ text: string; metadata: { title?, author?, pageCount?, wordCount }; warnings: string[] }`
   - `PipelineResult` — `{ runId: string; status: GenerationRunStatus; profileIds: string[]; durationMs: number; error?: string }`
   - `VersionComparison` — `{ featureKey: string; oldValue: number; newValue: number; delta: number; percentChange: number }`
4. Define constants:
   - `SUPPORTED_FORMATS: DocumentFormat[]` — all 5 formats
   - `SUPPORTED_EXTENSIONS: Record<string, DocumentFormat>` — `.pdf` -> `pdf`, `.docx` -> `docx`, `.txt` -> `txt`, `.html` -> `html`, `.md` -> `markdown`
   - `SUPPORTED_MIME_TYPES: Record<string, DocumentFormat>` — MIME type mappings
   - `DEFAULT_RETENTION_DAYS = 90`
   - `SOFT_DELETE_RECOVERY_DAYS = 30`
   - `MAX_HIERARCHY_DEPTH = 10`
   - `MAX_CONCURRENT_PIPELINES = 5`
   - `FEATURE_COUNT = 129`

**Files**:
- `joyus-ai-mcp-server/src/profiles/types.ts` (new, ~120 lines)

**Validation**:
- [ ] `npm run typecheck` passes
- [ ] Types are importable from `../profiles/types.js`
- [ ] Constants are correctly typed

---

## Subtask T003: Create Zod Validation Schemas

**Purpose**: Define Zod schemas for validating input to all profile operations (MCP tool inputs, service method parameters).

**Steps**:
1. Create `joyus-ai-mcp-server/src/profiles/validation.ts`
2. Import `z` from `zod` and types from `./types.js`
3. Define Zod schemas for:
   - `GenerateProfilesInput`: corpusSnapshotId (string), authorIds (optional array), tier (enum), parentProfileIdentity (optional string)
   - `RollbackInput`: profileIdentity (string), targetVersion (integer, positive)
   - `VersionHistoryInput`: profileIdentity (string), limit (optional, default 20, max 100), offset (optional, default 0)
   - `VersionCompareInput`: profileIdentity (string), versionA (integer), versionB (integer)
   - `CreateHierarchyInput`: parentProfileIdentity (string), childProfileIdentity (string)
   - `ResolveProfileInput`: profileIdentity (string), forceRefresh (optional boolean)
   - `IntakeDocumentsInput`: documents (array of `{ buffer: never, filename: string, authorId?: string, authorName?: string }`), tier (optional enum, default 'individual')
   - `RetentionPolicyInput`: retentionDays (integer, min 90), tenantId excluded (per Leash pattern — comes from session)
   - `CacheWarmInput`: profileIdentities (optional array of string — warm specific profiles or all)
4. Important: `tenantId` must NEVER appear in any input schema — it is always injected from the authenticated session context per the Leash pattern (ADR-0002). Follow the same pattern as `src/content/validation.ts`.
5. Export all schemas and their inferred TypeScript types via `z.infer<typeof Schema>`

**Files**:
- `joyus-ai-mcp-server/src/profiles/validation.ts` (new, ~130 lines)

**Validation**:
- [ ] `npm run typecheck` passes
- [ ] All schemas parse valid input correctly
- [ ] All schemas reject invalid input with meaningful errors
- [ ] No schema accepts `tenantId` as an input field

---

## Subtask T004: Create Tenant-Scoped Query Helpers

**Purpose**: Implement the TenantScope utility module that enforces mandatory tenant_id filtering on every database query, per the Leash pattern (ADR-0002) and research decision R1.

**Steps**:
1. Create `joyus-ai-mcp-server/src/profiles/tenant-scope.ts`
2. Import `eq`, `and`, `type SQL` from `drizzle-orm`
3. Implement `tenantWhere<T extends { tenantId: unknown }>(table: T, tenantId: string, ...conditions: SQL[]): SQL`:
   - Compose a WHERE clause: `AND(tenant_id = ?, ...conditions)`
   - This is the primary helper — every query in the profiles module uses this
4. Implement `requireTenantId(tenantId: string | undefined | null): string`:
   - Validate that tenantId is present and non-empty
   - Throw a descriptive error if missing: `'tenant_id is required — cannot execute unscoped query'`
   - This is fail-closed per Constitution section 2.3 (Sandbox by Default)
5. Implement `assertTenantOwnership<T extends { tenantId: string }>(row: T, tenantId: string): void`:
   - Verify that a fetched row belongs to the expected tenant
   - Throw if mismatch: `'tenant_id mismatch — cross-tenant access denied'`
   - Defense-in-depth: used after fetches to catch any scoping bugs
6. Write unit tests in `joyus-ai-mcp-server/tests/profiles/tenant-scope.test.ts`:
   - `requireTenantId` throws on null, undefined, empty string
   - `requireTenantId` returns valid tenantId
   - `assertTenantOwnership` throws on mismatch, passes on match

**Files**:
- `joyus-ai-mcp-server/src/profiles/tenant-scope.ts` (new, ~60 lines)
- `joyus-ai-mcp-server/tests/profiles/tenant-scope.test.ts` (new, ~50 lines)

**Validation**:
- [ ] `npm run typecheck` passes
- [ ] Unit tests pass: `npx vitest run tests/profiles/tenant-scope.test.ts`
- [ ] `requireTenantId` fails closed (throws on missing tenantId)
- [ ] `assertTenantOwnership` catches cross-tenant access

---

## Subtask T005: Create Drizzle Migration

**Purpose**: Generate and verify the Drizzle migration that creates the `profiles` PostgreSQL schema and all tables.

**Steps**:
1. Run `npx drizzle-kit generate` to produce the migration from the schema definition
2. Verify the generated migration SQL includes:
   - `CREATE SCHEMA IF NOT EXISTS profiles;`
   - All 4 enum type definitions
   - All 7 `CREATE TABLE` statements with correct columns and constraints
   - All indexes including the partial index and unique constraints
3. If Drizzle does not auto-generate the `CREATE SCHEMA` statement, manually prepend it to the migration file
4. If the partial index (`WHERE status = 'active'`) is not generated correctly, add it as raw SQL in the migration
5. Test the migration runs against a clean database (or verify with `drizzle-kit push` in dry-run mode)

**Files**:
- `joyus-ai-mcp-server/drizzle/NNNN_*.sql` (auto-generated migration file)

**Validation**:
- [ ] Migration file exists and contains valid SQL
- [ ] `CREATE SCHEMA profiles` is present
- [ ] All 7 tables are created in the `profiles` schema
- [ ] All unique constraints and indexes are present
- [ ] Migration is idempotent (can run on already-migrated DB without error)

---

## Subtask T006: Export Profiles Schema from DB Client

**Purpose**: Make profiles schema tables accessible through the existing `db` client export, following the same pattern used for the content schema.

**Steps**:
1. Edit `joyus-ai-mcp-server/src/db/client.ts`
2. Add: `export * from '../profiles/schema.js';` after the existing content schema export
3. If the Drizzle client initialization uses `{ schema }` for relation queries, update it to merge profiles schema tables alongside existing schemas
4. Verify existing imports continue to work unchanged

**Files**:
- `joyus-ai-mcp-server/src/db/client.ts` (modify, ~3-5 lines added)

**Validation**:
- [ ] `npm run typecheck` passes
- [ ] Profiles tables importable: `import { tenantProfiles } from '../db/client.js'`
- [ ] Existing imports still work unchanged (content tables, public tables)
- [ ] Relation queries work if the Drizzle client is configured for them

---

## Definition of Done

- [ ] All 7 profiles tables defined in `src/profiles/schema.ts` matching data-model.md exactly
- [ ] All 4 enums defined with correct values
- [ ] Tenant-scoped query helpers in `src/profiles/tenant-scope.ts` with unit tests
- [ ] Zod validation schemas cover all profile operation inputs, with tenantId excluded per Leash pattern
- [ ] Shared types exported from `src/profiles/types.ts`
- [ ] Drizzle migration generates valid SQL for the `profiles` schema
- [ ] Profiles schema accessible via `src/db/client.ts` exports
- [ ] `npm run typecheck` passes with zero errors
- [ ] `npx vitest run tests/profiles/` passes
- [ ] No changes to existing schema or functionality

## Risks

- **Drizzle pgSchema + partial index**: The partial index `WHERE status = 'active'` may not be supported natively by Drizzle's index builder. Mitigation: use `.where(sql\`...\`)` or add raw SQL to the migration.
- **Schema migration ordering**: The `profiles` schema must be created before tables. Ensure `CREATE SCHEMA IF NOT EXISTS profiles` precedes table creation.
- **CUID2 dependency**: Confirm `@paralleldrive/cuid2` is already in `package.json`. If not, add it.

## Reviewer Guidance

- Verify all 7 tables match data-model.md field-for-field (column names, types, defaults, constraints)
- Check that enum values match spec exactly
- Confirm CUID2 is used for all primary keys (matching existing `src/db/schema.ts` pattern)
- Confirm `tenantId` is NOT in any Zod input schema
- Verify `tenantWhere` helper composes correctly with additional conditions
- Verify `requireTenantId` is fail-closed (throws, does not return null)
- Check that no changes were made to existing `src/db/schema.ts` or `src/content/schema.ts`
