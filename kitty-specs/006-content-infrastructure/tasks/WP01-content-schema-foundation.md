---
work_package_id: WP01
title: Content Schema & Foundation
lane: done
dependencies: []
subtasks: [T001, T002, T003, T004, T005]
agent: claude-opus
shell_pid: '34619'
review_status: approved
reviewed_by: Alex Urevick-Ackelsberg
history:
- date: '2026-02-21'
  action: created
  by: spec-kitty.tasks
---

# WP01: Content Schema & Foundation

## Objective

Create the Drizzle ORM schema for the `content` PostgreSQL schema (12 tables), Zod validation schemas for input validation, shared TypeScript types, and wire everything into the existing database client. This is the foundation that every subsequent work package builds on.

## Implementation Command

```bash
spec-kitty implement WP01
```

## Context

- **Spec**: `kitty-specs/006-content-infrastructure/spec.md`
- **Plan**: `kitty-specs/006-content-infrastructure/plan.md`
- **Data Model**: `kitty-specs/006-content-infrastructure/data-model.md` (authoritative schema reference)
- **Research**: `kitty-specs/006-content-infrastructure/research.md` (§R4: Schema Separation)

The content infrastructure extends the existing `joyus-ai-mcp-server` package. All new tables live in a PostgreSQL `content` schema (separate from the existing `public` schema). The existing schema at `src/db/schema.ts` uses `pgTable` from `drizzle-orm/pg-core`; the content schema will use `pgSchema('content').table(...)`.

---

## Subtask T001: Create Content Drizzle Schema

**Purpose**: Define all 12 content tables using Drizzle ORM with the `content` pgSchema.

**Steps**:
1. Create `joyus-ai-mcp-server/src/content/schema.ts`
2. Import `pgSchema`, `pgTable`, `pgEnum`, `text`, `timestamp`, `boolean`, `integer`, `real`, `json`, `uniqueIndex`, `index` from `drizzle-orm/pg-core`
3. Import `relations` from `drizzle-orm`
4. Import `createId` from `@paralleldrive/cuid2`
5. Define `const contentSchema = pgSchema('content')`
6. Define enums:
   - `sourceTypeEnum`: `relational-database`, `rest-api`
   - `syncStrategyEnum`: `mirror`, `pass-through`, `hybrid`
   - `sourceStatusEnum`: `active`, `syncing`, `error`, `disconnected`
   - `syncRunStatusEnum`: `pending`, `running`, `completed`, `failed`
   - `syncTriggerEnum`: `scheduled`, `manual`
7. Define all 12 tables per data-model.md using `contentSchema.table(...)`:
   - `sources`, `items`, `products`, `productSources`, `productProfiles`
   - `entitlements`, `apiKeys`, `mediationSessions`
   - `syncRuns`, `generationLogs`, `driftReports`, `operationLogs`
8. Define all relations using `relations()`:
   - sources → items (one-to-many), sources → syncRuns (one-to-many)
   - products → productSources, productProfiles (one-to-many)
   - apiKeys → mediationSessions (one-to-many)
9. Export type aliases via `$inferSelect` and `$inferInsert`

**Important implementation details**:
- The `items` table needs a `searchVector` column. Drizzle doesn't have native tsvector support — use `customType` or raw column definition:
  ```typescript
  import { customType } from 'drizzle-orm/pg-core';
  const tsvector = customType<{ data: string }>({
    dataType() { return 'tsvector'; },
  });
  ```
  The GIN index and generated column will be handled via a custom migration SQL.
- `connectionConfig` on sources must be documented as encrypted at rest (uses existing `encryptToken`/`decryptToken`)
- All tables use CUID2 for primary keys (matching existing pattern in `src/db/schema.ts`)
- `items.(sourceId, sourceRef)` must have a UNIQUE composite index

**Files**:
- `joyus-ai-mcp-server/src/content/schema.ts` (new, ~400 lines)

**Validation**:
- [ ] `npm run typecheck` passes
- [ ] All 12 tables defined with correct columns per data-model.md
- [ ] All relations defined
- [ ] All indexes defined
- [ ] Type exports work: `ContentSource`, `NewContentSource`, etc.

---

## Subtask T002: Create Zod Validation Schemas

**Purpose**: Define Zod schemas for validating input to content operations (tool inputs, API request bodies).

**Steps**:
1. Create `joyus-ai-mcp-server/src/content/validation.ts`
2. Define Zod schemas for:
   - `CreateSourceInput`: name, type (enum), syncStrategy (enum), connectionConfig (object), freshnessWindowMinutes (optional, default 1440)
   - `SearchInput`: query (string, min 1), sourceId (optional), limit (optional, default 20, max 100), offset (optional, default 0)
   - `CreateProductInput`: name, description (optional), sourceIds (array), profileIds (array)
   - `GenerateInput`: query (string), profileId (optional), sourceIds (optional array), maxSources (optional, default 5)
   - `MediationMessageInput`: message (string, max 10000), maxSources (optional, default 5)
   - `CreateApiKeyInput`: integrationName, jwksUri (optional URL), issuer (optional), audience (optional)
   - `CreateSessionInput`: profileId (optional)
3. Export all schemas and inferred types

**Files**:
- `joyus-ai-mcp-server/src/content/validation.ts` (new, ~120 lines)

**Validation**:
- [ ] `npm run typecheck` passes
- [ ] All schemas parse valid input correctly
- [ ] All schemas reject invalid input with meaningful errors

---

## Subtask T003: Create Shared Types and Constants

**Purpose**: Define TypeScript types and constants shared across content modules.

**Steps**:
1. Create `joyus-ai-mcp-server/src/content/types.ts`
2. Define:
   - `SourceType`, `SyncStrategy`, `SourceStatus`, `SyncRunStatus`, `SyncTrigger` as string literal union types
   - `ContentOperationType` = `'sync' | 'search' | 'resolve' | 'generate' | 'mediate'`
   - `ConnectorConfig` interface (base for all connector configurations)
   - `DatabaseConnectorConfig extends ConnectorConfig` (host, port, database, table, columns)
   - `ApiConnectorConfig extends ConnectorConfig` (baseUrl, authType, headers, endpoints)
   - `SearchResult` interface (itemId, sourceId, title, excerpt, score, metadata, isStale)
   - `ResolvedEntitlements` interface (productIds, sourceIds, profileIds, resolvedFrom, resolvedAt)
   - `GenerationResult` interface (text, citations, profileUsed, metadata)
   - `Citation` interface (sourceId, itemId, title, excerpt, sourceType)
   - Constants: `DEFAULT_BATCH_SIZE = 100`, `MAX_SEARCH_LIMIT = 100`, `DEFAULT_FRESHNESS_WINDOW_MINUTES = 1440`

**Files**:
- `joyus-ai-mcp-server/src/content/types.ts` (new, ~100 lines)

**Validation**:
- [ ] `npm run typecheck` passes
- [ ] Types are importable from `../content/types.js`

---

## Subtask T004: Export Content Schema from DB Client

**Purpose**: Make content schema tables accessible through the existing `db` client export.

**Steps**:
1. Edit `joyus-ai-mcp-server/src/db/client.ts`
2. Add: `export * from '../content/schema.js';` after the existing schema export
3. This makes all content tables importable from `../db/client.js` alongside existing tables

**Important**: The existing `db` Drizzle client with `{ schema }` may need to include content schema tables for relation queries to work. If so, update the drizzle client initialization to merge both schemas.

**Files**:
- `joyus-ai-mcp-server/src/db/client.ts` (modify, ~3 lines added)

**Validation**:
- [ ] `npm run typecheck` passes
- [ ] Content tables importable: `import { contentSources } from '../db/client.js'`
- [ ] Existing imports still work unchanged

---

## Subtask T005: Add Zod Dependency

**Purpose**: Add Zod to the package dependencies.

**Steps**:
1. Add `"zod": "^3.22.0"` to `dependencies` in `joyus-ai-mcp-server/package.json`
2. Run `npm install`

**Files**:
- `joyus-ai-mcp-server/package.json` (modify, 1 line)

**Validation**:
- [ ] `npm install` succeeds
- [ ] `import { z } from 'zod'` works in TypeScript files
- [ ] `npm run typecheck` passes

---

## Definition of Done

- [ ] All 12 content tables defined in `src/content/schema.ts` matching data-model.md exactly
- [ ] Zod validation schemas cover all content operation inputs
- [ ] Shared types exported from `src/content/types.ts`
- [ ] Content schema accessible via `src/db/client.ts` exports
- [ ] Zod installed as a dependency
- [ ] `npm run typecheck` passes with zero errors
- [ ] No changes to existing schema or functionality

## Risks

- **Drizzle pgSchema + tsvector**: Drizzle may not support `tsvector` natively. Mitigation: use `customType` for column definition and raw SQL migration for the generated column + GIN index.
- **Schema migration**: The `content` schema must be created before tables. May need a manual migration step: `CREATE SCHEMA IF NOT EXISTS content;`

## Reviewer Guidance

- Verify all 12 tables match data-model.md field-for-field
- Check that enum values match spec exactly
- Confirm CUID2 is used for all primary keys
- Confirm `connectionConfig` is documented as encrypted
- Check that the `searchVector` tsvector column is defined (even if generated column logic needs migration)
- Verify no changes to existing `src/db/schema.ts`

## Activity Log

- 2026-02-21T05:58:22Z – claude-opus – shell_pid=34619 – lane=doing – Started implementation via workflow command
- 2026-02-21T12:18:46Z – claude-opus – shell_pid=34619 – lane=for_review – Ready for review: 12 Drizzle tables in content pgSchema, Zod validation, shared types, db client wiring, zod dep added. Zero new typecheck errors.
- 2026-02-21T12:31:50Z – claude-opus – shell_pid=34619 – lane=done – Review passed: enums scoped to content schema, jsonb defaults fixed, tenant docs added
