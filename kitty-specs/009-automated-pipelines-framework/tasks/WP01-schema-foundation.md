---
work_package_id: "WP01"
title: "Schema & Foundation"
lane: "planned"
dependencies: []
subtasks: ["T001", "T002", "T003", "T004", "T005", "T006", "T007"]
history:
  - date: "2026-03-14"
    action: "created"
    agent: "claude-opus"
---

# WP01: Schema & Foundation

**Implementation command**: `spec-kitty implement WP01`
**Target repo**: `joyus-ai`
**Dependencies**: None
**Priority**: P0 (Foundation — every other WP depends on this)

## Objective

Create the complete Drizzle ORM schema for the `pipelines` PostgreSQL schema (8 tables, 8 enums), Zod validation schemas, shared TypeScript types and constants, the module barrel export, and wire everything into the existing database client. Generate and verify the Drizzle migration.

## Context

The `joyus-ai` platform uses Drizzle ORM with PostgreSQL and organizes tables in named PostgreSQL schemas (e.g., there is already a `public` schema used by the auth and profile tables). Pipelines gets its own `pipelines` schema namespace to avoid table name conflicts and to isolate the feature cleanly.

All downstream WPs (WP02 through WP10) import types and schema references from this WP. Nothing can proceed until `src/pipelines/schema.ts`, `src/pipelines/types.ts`, and `src/pipelines/validation.ts` exist and pass `tsc --noEmit`.

The existing `src/db/client.ts` exports a Drizzle instance bound to the public schema. After this WP, it must also export the pipelines schema tables so that any module can do:

```typescript
import { db, pipelinesSchema } from '../db/client';
```

---

## Subtasks

### T001: Create pipelines Drizzle schema (`src/pipelines/schema.ts`)

**Purpose**: Define all 8 tables and 8 enums in the `pipelines` PostgreSQL schema using Drizzle ORM's `pgSchema` API.

**Steps**:
1. Create `src/pipelines/schema.ts`
2. Declare the `pipelines` PostgreSQL schema using `pgSchema`
3. Define 8 enums inside the schema namespace
4. Define all 8 tables with columns, constraints, and indexes
5. Define Drizzle relations for foreign keys

```typescript
// src/pipelines/schema.ts
import {
  pgSchema,
  uuid,
  text,
  timestamp,
  integer,
  boolean,
  jsonb,
  pgEnum,
  index,
  uniqueIndex,
} from 'drizzle-orm/pg-core';
import { relations } from 'drizzle-orm';

export const pipelinesSchema = pgSchema('pipelines');

// ── Enums ─────────────────────────────────────────────────────────────────────

export const pipelineStatusEnum = pipelinesSchema.enum('pipeline_status', [
  'active', 'paused', 'archived',
]);

export const executionStatusEnum = pipelinesSchema.enum('execution_status', [
  'pending', 'running', 'waiting_review', 'completed', 'failed', 'cancelled',
]);

export const stepStatusEnum = pipelinesSchema.enum('step_status', [
  'pending', 'running', 'completed', 'failed', 'skipped',
]);

export const triggerTypeEnum = pipelinesSchema.enum('trigger_type', [
  'corpus_change', 'manual', 'schedule',
]);

export const stepTypeEnum = pipelinesSchema.enum('step_type', [
  'profile_generation', 'fidelity_check', 'content_generation',
  'source_query', 'notification', 'review_gate',
]);

export const reviewDecisionEnum = pipelinesSchema.enum('review_decision', [
  'approved', 'rejected', 'partial',
]);

export const concurrencyPolicyEnum = pipelinesSchema.enum('concurrency_policy', [
  'allow', 'skip', 'queue',
]);

export const escalationStatusEnum = pipelinesSchema.enum('escalation_status', [
  'pending', 'escalated', 'resolved',
]);

// ── Tables ────────────────────────────────────────────────────────────────────

export const pipelines = pipelinesSchema.table('pipelines', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: uuid('tenant_id').notNull(),
  name: text('name').notNull(),
  description: text('description'),
  status: pipelineStatusEnum('status').notNull().default('active'),
  triggerType: triggerTypeEnum('trigger_type').notNull(),
  triggerConfig: jsonb('trigger_config').notNull().default({}),
  stepConfigs: jsonb('step_configs').notNull().default([]),
  concurrencyPolicy: concurrencyPolicyEnum('concurrency_policy').notNull().default('skip'),
  retryPolicy: jsonb('retry_policy').notNull().default({}),
  createdAt: timestamp('created_at').notNull().defaultNow(),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
}, (t) => ({
  tenantIdx: index('pipelines_tenant_idx').on(t.tenantId),
  statusIdx: index('pipelines_status_idx').on(t.status),
}));

export const pipelineExecutions = pipelinesSchema.table('pipeline_executions', {
  id: uuid('id').primaryKey().defaultRandom(),
  pipelineId: uuid('pipeline_id').notNull().references(() => pipelines.id, { onDelete: 'cascade' }),
  tenantId: uuid('tenant_id').notNull(),
  status: executionStatusEnum('status').notNull().default('pending'),
  triggerType: triggerTypeEnum('trigger_type').notNull(),
  triggerPayload: jsonb('trigger_payload').notNull().default({}),
  idempotencyKey: text('idempotency_key'),
  startedAt: timestamp('started_at'),
  completedAt: timestamp('completed_at'),
  errorMessage: text('error_message'),
  metadata: jsonb('metadata').notNull().default({}),
  createdAt: timestamp('created_at').notNull().defaultNow(),
}, (t) => ({
  pipelineIdx: index('executions_pipeline_idx').on(t.pipelineId),
  tenantIdx: index('executions_tenant_idx').on(t.tenantId),
  statusIdx: index('executions_status_idx').on(t.status),
  idempotencyUniqueIdx: uniqueIndex('executions_idempotency_key_unique')
    .on(t.idempotencyKey)
    .where(sql`idempotency_key IS NOT NULL`),
}));

export const stepExecutions = pipelinesSchema.table('step_executions', {
  id: uuid('id').primaryKey().defaultRandom(),
  executionId: uuid('execution_id').notNull().references(() => pipelineExecutions.id, { onDelete: 'cascade' }),
  stepIndex: integer('step_index').notNull(),
  stepType: stepTypeEnum('step_type').notNull(),
  status: stepStatusEnum('status').notNull().default('pending'),
  inputData: jsonb('input_data').notNull().default({}),
  outputData: jsonb('output_data').notNull().default({}),
  errorMessage: text('error_message'),
  attemptCount: integer('attempt_count').notNull().default(0),
  startedAt: timestamp('started_at'),
  completedAt: timestamp('completed_at'),
}, (t) => ({
  executionIdx: index('steps_execution_idx').on(t.executionId),
  statusIdx: index('steps_status_idx').on(t.status),
}));

export const reviewDecisions = pipelinesSchema.table('review_decisions', {
  id: uuid('id').primaryKey().defaultRandom(),
  executionId: uuid('execution_id').notNull().references(() => pipelineExecutions.id, { onDelete: 'cascade' }),
  stepIndex: integer('step_index').notNull(),
  tenantId: uuid('tenant_id').notNull(),
  reviewerId: uuid('reviewer_id'),
  decision: reviewDecisionEnum('decision'),
  feedback: text('feedback'),
  artifactApprovals: jsonb('artifact_approvals').notNull().default({}),
  escalationStatus: escalationStatusEnum('escalation_status').notNull().default('pending'),
  timeoutAt: timestamp('timeout_at'),
  decidedAt: timestamp('decided_at'),
  createdAt: timestamp('created_at').notNull().defaultNow(),
}, (t) => ({
  executionIdx: index('decisions_execution_idx').on(t.executionId),
  pendingIdx: index('decisions_pending_idx').on(t.escalationStatus),
}));

export const triggerEvents = pipelinesSchema.table('trigger_events', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: uuid('tenant_id').notNull(),
  eventType: triggerTypeEnum('event_type').notNull(),
  payload: jsonb('payload').notNull().default({}),
  processedAt: timestamp('processed_at'),
  createdAt: timestamp('created_at').notNull().defaultNow(),
}, (t) => ({
  tenantIdx: index('events_tenant_idx').on(t.tenantId),
  unprocessedIdx: index('events_unprocessed_idx').on(t.processedAt)
    .where(sql`processed_at IS NULL`),
}));

export const pipelineTemplates = pipelinesSchema.table('pipeline_templates', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: uuid('tenant_id'),  // null = built-in template
  name: text('name').notNull(),
  description: text('description'),
  triggerType: triggerTypeEnum('trigger_type').notNull(),
  stepConfigs: jsonb('step_configs').notNull().default([]),
  isBuiltIn: boolean('is_built_in').notNull().default(false),
  createdAt: timestamp('created_at').notNull().defaultNow(),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
}, (t) => ({
  tenantIdx: index('templates_tenant_idx').on(t.tenantId),
  builtInIdx: index('templates_built_in_idx').on(t.isBuiltIn),
}));

export const pipelineMetrics = pipelinesSchema.table('pipeline_metrics', {
  id: uuid('id').primaryKey().defaultRandom(),
  pipelineId: uuid('pipeline_id').notNull().references(() => pipelines.id, { onDelete: 'cascade' }),
  tenantId: uuid('tenant_id').notNull(),
  totalExecutions: integer('total_executions').notNull().default(0),
  successfulExecutions: integer('successful_executions').notNull().default(0),
  failedExecutions: integer('failed_executions').notNull().default(0),
  avgDurationMs: integer('avg_duration_ms'),
  p95DurationMs: integer('p95_duration_ms'),
  reviewRejectionRate: integer('review_rejection_rate'),  // stored as basis points (0-10000)
  lastRefreshedAt: timestamp('last_refreshed_at'),
}, (t) => ({
  pipelineIdx: uniqueIndex('metrics_pipeline_unique').on(t.pipelineId),
}));

export const qualitySignals = pipelinesSchema.table('quality_signals', {
  id: uuid('id').primaryKey().defaultRandom(),
  pipelineId: uuid('pipeline_id').notNull().references(() => pipelines.id, { onDelete: 'cascade' }),
  tenantId: uuid('tenant_id').notNull(),
  signalType: text('signal_type').notNull(),
  severity: text('severity').notNull(),  // 'info' | 'warning' | 'critical'
  message: text('message').notNull(),
  metadata: jsonb('metadata').notNull().default({}),
  acknowledgedAt: timestamp('acknowledged_at'),
  createdAt: timestamp('created_at').notNull().defaultNow(),
}, (t) => ({
  pipelineIdx: index('signals_pipeline_idx').on(t.pipelineId),
  unacknowledgedIdx: index('signals_unack_idx').on(t.acknowledgedAt)
    .where(sql`acknowledged_at IS NULL`),
}));

// ── Relations ─────────────────────────────────────────────────────────────────

export const pipelinesRelations = relations(pipelines, ({ many }) => ({
  executions: many(pipelineExecutions),
  templates: many(pipelineTemplates),
  metrics: many(pipelineMetrics),
  qualitySignals: many(qualitySignals),
}));

export const pipelineExecutionsRelations = relations(pipelineExecutions, ({ one, many }) => ({
  pipeline: one(pipelines, { fields: [pipelineExecutions.pipelineId], references: [pipelines.id] }),
  steps: many(stepExecutions),
  reviewDecisions: many(reviewDecisions),
}));

export const stepExecutionsRelations = relations(stepExecutions, ({ one }) => ({
  execution: one(pipelineExecutions, {
    fields: [stepExecutions.executionId],
    references: [pipelineExecutions.id],
  }),
}));

export const reviewDecisionsRelations = relations(reviewDecisions, ({ one }) => ({
  execution: one(pipelineExecutions, {
    fields: [reviewDecisions.executionId],
    references: [pipelineExecutions.id],
  }),
}));
```

**Files**:
- `src/pipelines/schema.ts` (new, ~160 lines)

**Validation**:
- [ ] `tsc --noEmit` passes with zero errors on `schema.ts`
- [ ] All 8 tables are defined: `pipelines`, `pipeline_executions`, `step_executions`, `review_decisions`, `trigger_events`, `pipeline_templates`, `pipeline_metrics`, `quality_signals`
- [ ] All 8 enums are defined within the `pipelinesSchema` namespace
- [ ] All foreign key references use `.references()` with `onDelete: 'cascade'`
- [ ] Partial indexes (where clauses) compile correctly with Drizzle's `sql` template tag

**Edge Cases**:
- `pgSchema('pipelines')` creates the schema namespace but does not emit `CREATE SCHEMA` SQL — that must be in the migration (T006).
- The partial index on `trigger_events.processed_at` requires importing `sql` from `drizzle-orm`. Do not use `drizzle-orm/pg-core` for `sql`.
- `pipelineTemplates.tenantId` is nullable (null = built-in template visible to all tenants). Drizzle nullable columns omit `.notNull()`.

---

### T002: Create shared TypeScript types, enums, and constants (`src/pipelines/types.ts`)

**Purpose**: Define all shared TypeScript interfaces, type aliases, and constants used across the pipeline module so that schema types and business logic types are co-located and importable without pulling in Drizzle.

**Steps**:
1. Create `src/pipelines/types.ts`
2. Export inferred Drizzle `InsertX` / `SelectX` types
3. Define business logic interfaces (TriggerConfig variants, StepConfig, RetryPolicy)
4. Define module-level constants (default retry policy, max depth, thresholds)

```typescript
// src/pipelines/types.ts
import type { InferInsertModel, InferSelectModel } from 'drizzle-orm';
import type {
  pipelines,
  pipelineExecutions,
  stepExecutions,
  reviewDecisions,
  triggerEvents,
  pipelineTemplates,
  pipelineMetrics,
  qualitySignals,
} from './schema';

// ── Drizzle inferred row types ────────────────────────────────────────────────

export type Pipeline = InferSelectModel<typeof pipelines>;
export type NewPipeline = InferInsertModel<typeof pipelines>;
export type PipelineExecution = InferSelectModel<typeof pipelineExecutions>;
export type NewPipelineExecution = InferInsertModel<typeof pipelineExecutions>;
export type StepExecution = InferSelectModel<typeof stepExecutions>;
export type ReviewDecision = InferSelectModel<typeof reviewDecisions>;
export type TriggerEvent = InferSelectModel<typeof triggerEvents>;
export type PipelineTemplate = InferSelectModel<typeof pipelineTemplates>;
export type PipelineMetrics = InferSelectModel<typeof pipelineMetrics>;
export type QualitySignal = InferSelectModel<typeof qualitySignals>;

// ── Trigger config discriminated union ───────────────────────────────────────

export interface CorpusChangeTriggerConfig {
  type: 'corpus_change';
  sourceIds?: string[];        // empty = all sources for tenant
  minChangeThreshold?: number; // number of documents changed to trigger
}

export interface ManualTriggerConfig {
  type: 'manual';
  allowedRoles?: string[];     // empty = any authenticated user
}

export interface ScheduleTriggerConfig {
  type: 'schedule';
  cronExpression: string;      // e.g. "0 9 * * 1-5"
  timezone: string;            // IANA tz, e.g. "America/New_York"
  allowOverlap: boolean;
}

export type TriggerConfig =
  | CorpusChangeTriggerConfig
  | ManualTriggerConfig
  | ScheduleTriggerConfig;

// ── Step config ───────────────────────────────────────────────────────────────

export interface StepConfig {
  stepType: StepType;
  name: string;
  config: Record<string, unknown>;
  requiresReview: boolean;
  reviewTimeoutHours?: number;  // default: 24
}

// ── String literal enums (mirror DB enums for type safety in app code) ────────

export type PipelineStatus = 'active' | 'paused' | 'archived';
export type ExecutionStatus = 'pending' | 'running' | 'waiting_review' | 'completed' | 'failed' | 'cancelled';
export type StepStatus = 'pending' | 'running' | 'completed' | 'failed' | 'skipped';
export type TriggerType = 'corpus_change' | 'manual' | 'schedule';
export type StepType = 'profile_generation' | 'fidelity_check' | 'content_generation' | 'source_query' | 'notification' | 'review_gate';
export type ReviewDecisionType = 'approved' | 'rejected' | 'partial';
export type ConcurrencyPolicy = 'allow' | 'skip' | 'queue';
export type EscalationStatus = 'pending' | 'escalated' | 'resolved';

// ── Retry policy ──────────────────────────────────────────────────────────────

export interface RetryPolicy {
  maxAttempts: number;
  initialDelayMs: number;
  backoffMultiplier: number;
  maxDelayMs: number;
}

// ── Constants ─────────────────────────────────────────────────────────────────

export const DEFAULT_RETRY_POLICY: RetryPolicy = {
  maxAttempts: 3,
  initialDelayMs: 1000,
  backoffMultiplier: 2,
  maxDelayMs: 30_000,
};

export const MAX_PIPELINE_DEPTH = 10;  // DFS cycle detection hard limit
export const DEFAULT_REVIEW_TIMEOUT_HOURS = 24;
export const QUALITY_SIGNAL_REJECTION_THRESHOLD_BP = 3000;  // 30% in basis points
export const QUALITY_SIGNAL_MIN_EXECUTIONS = 10;
export const POLL_INTERVAL_MS = 5_000;
export const MAX_CONCURRENT_EXECUTIONS_PER_PIPELINE = 1;
```

**Files**:
- `src/pipelines/types.ts` (new, ~80 lines)

**Validation**:
- [ ] `tsc --noEmit` passes with zero errors on `types.ts`
- [ ] All Drizzle inferred types import from `./schema` (not from Drizzle directly)
- [ ] `TriggerConfig` is a discriminated union on `type` field
- [ ] All string literal types match the corresponding schema enum values exactly

**Edge Cases**:
- `InferSelectModel` and `InferInsertModel` are from `drizzle-orm`, not `drizzle-orm/pg-core`. Confirm the import path matches the version in `package.json`.
- Constants file should not import from `./schema` to avoid circular references if schema imports types.

---

### T003: Create Zod validation schemas (`src/pipelines/validation.ts`)

**Purpose**: Define runtime validation for all pipeline inputs — pipeline creation/update, trigger configs, step configs, and retry policy — so that Express routes and MCP tools can validate untrusted input at the boundary.

**Steps**:
1. Create `src/pipelines/validation.ts`
2. Define Zod schemas matching `TriggerConfig`, `StepConfig`, `RetryPolicy`
3. Define `createPipelineSchema` and `updatePipelineSchema` for route handlers
4. Export inferred TypeScript types from Zod schemas

```typescript
// src/pipelines/validation.ts
import { z } from 'zod';

export const retryPolicySchema = z.object({
  maxAttempts: z.number().int().min(1).max(10).default(3),
  initialDelayMs: z.number().int().min(100).max(60_000).default(1000),
  backoffMultiplier: z.number().min(1).max(10).default(2),
  maxDelayMs: z.number().int().min(1000).max(300_000).default(30_000),
});

export const corpusChangeTriggerSchema = z.object({
  type: z.literal('corpus_change'),
  sourceIds: z.array(z.string().uuid()).optional(),
  minChangeThreshold: z.number().int().min(1).optional(),
});

export const manualTriggerSchema = z.object({
  type: z.literal('manual'),
  allowedRoles: z.array(z.string()).optional(),
});

export const scheduleTriggerSchema = z.object({
  type: z.literal('schedule'),
  cronExpression: z.string().min(1),
  timezone: z.string().min(1),
  allowOverlap: z.boolean().default(false),
});

export const triggerConfigSchema = z.discriminatedUnion('type', [
  corpusChangeTriggerSchema,
  manualTriggerSchema,
  scheduleTriggerSchema,
]);

export const stepConfigSchema = z.object({
  stepType: z.enum([
    'profile_generation', 'fidelity_check', 'content_generation',
    'source_query', 'notification', 'review_gate',
  ]),
  name: z.string().min(1).max(100),
  config: z.record(z.unknown()).default({}),
  requiresReview: z.boolean().default(false),
  reviewTimeoutHours: z.number().int().min(1).max(168).optional(),  // max 1 week
});

export const createPipelineSchema = z.object({
  name: z.string().min(1).max(200),
  description: z.string().max(1000).optional(),
  triggerConfig: triggerConfigSchema,
  stepConfigs: z.array(stepConfigSchema).min(1).max(20),
  concurrencyPolicy: z.enum(['allow', 'skip', 'queue']).default('skip'),
  retryPolicy: retryPolicySchema.optional(),
});

export const updatePipelineSchema = createPipelineSchema.partial().extend({
  status: z.enum(['active', 'paused', 'archived']).optional(),
});

export const manualTriggerRequestSchema = z.object({
  payload: z.record(z.unknown()).optional(),
});

export const reviewDecisionSchema = z.object({
  decision: z.enum(['approved', 'rejected', 'partial']),
  feedback: z.string().max(2000).optional(),
  artifactApprovals: z.record(z.boolean()).optional(),  // artifactPath -> approved
});

// Inferred TypeScript types from Zod schemas
export type CreatePipelineInput = z.infer<typeof createPipelineSchema>;
export type UpdatePipelineInput = z.infer<typeof updatePipelineSchema>;
export type ReviewDecisionInput = z.infer<typeof reviewDecisionSchema>;
```

**Files**:
- `src/pipelines/validation.ts` (new, ~60 lines)

**Validation**:
- [ ] `tsc --noEmit` passes with zero errors on `validation.ts`
- [ ] `triggerConfigSchema.parse({ type: 'corpus_change' })` returns valid object
- [ ] `createPipelineSchema.parse({ name: 'x', triggerConfig: {...}, stepConfigs: [] })` throws ZodError for empty `stepConfigs`
- [ ] All enum values in Zod match the TypeScript union types in `types.ts`

**Edge Cases**:
- `z.discriminatedUnion('type', [...])` requires that each variant schema uses `z.literal()` for the discriminant key. Do not use `z.enum()` for the `type` field inside each variant.
- `retryPolicySchema` uses `.default()` values — these apply only during `parse()`, not `safeParse()` failures. Document this for route handlers.

---

### T004: Create module barrel export (`src/pipelines/index.ts`)

**Purpose**: Provide a single import entry point for the pipelines module so that downstream consumers (routes, tools, engine) can import from `'../pipelines'` rather than deep paths.

**Steps**:
1. Create `src/pipelines/index.ts`
2. Re-export schema, types, and validation
3. Leave engine, triggers, steps, review, analytics, and templates exports as stubs (to be filled in by later WPs)

```typescript
// src/pipelines/index.ts
export * from './schema';
export * from './types';
export * from './validation';

// These exports are populated by later WPs:
// export * from './event-bus';   // WP02
// export * from './triggers';    // WP03
// export * from './engine';      // WP04
// export * from './steps';       // WP05
// export * from './review';      // WP06
// export * from './templates';   // WP07
// export * from './analytics';   // WP09
```

**Files**:
- `src/pipelines/index.ts` (new, ~15 lines)

**Validation**:
- [ ] `import { Pipeline, pipelines, createPipelineSchema } from './pipelines'` resolves without errors from a sibling module
- [ ] No circular imports between `index.ts`, `schema.ts`, `types.ts`, and `validation.ts`

**Edge Cases**:
- Do not export `* from './schema'` and `* from './types'` if there are name collisions. Check that `TriggerType` (string literal type in `types.ts`) does not collide with any Drizzle schema export.

---

### T005: Export pipelines schema from `src/db/client.ts`

**Purpose**: Make the Drizzle pipelines schema tables available to all modules through the shared database client, following the existing pattern used for other schema tables.

**Steps**:
1. Open `src/db/client.ts` (existing file)
2. Import the `pipelinesSchema` tables from `../pipelines/schema`
3. Pass them into the Drizzle client's schema option or export them alongside `db`

```typescript
// src/db/client.ts — add to existing file
import * as pipelinesTables from '../pipelines/schema';

// Add to existing drizzle() call or export separately:
export const db = drizzle(pool, {
  schema: {
    ...existingTables,
    ...pipelinesTables,
  },
});

// Also export for direct use:
export { pipelinesTables };
```

**Files**:
- `src/db/client.ts` (modified)

**Validation**:
- [ ] `tsc --noEmit` passes on `src/db/client.ts` after modification
- [ ] Existing tests that import `db` from `src/db/client.ts` continue to pass
- [ ] `db.query.pipelines.findMany()` resolves without TypeScript errors

**Edge Cases**:
- If `src/db/client.ts` uses `drizzle(pool, { schema: { ... } })`, add the pipeline tables to that object. If it does not pass a schema option, add one — Drizzle requires the schema to be registered for relational queries (`db.query.*` syntax).
- Do not create a circular dependency: `client.ts` → `pipelines/schema.ts` must not loop back to `db/client.ts`.

---

### T006: Generate Drizzle migration (`drizzle/`)

**Purpose**: Produce the SQL migration file that creates the `pipelines` schema, all 8 enums, and all 8 tables with indexes so that the migration can be applied to any environment.

**Steps**:
1. Run `npx drizzle-kit generate` (or the project's existing migrate script)
2. Verify the generated SQL file in `drizzle/` contains `CREATE SCHEMA IF NOT EXISTS pipelines`
3. If the migration tool does not generate `CREATE SCHEMA`, add it manually to the top of the migration file
4. Verify all 8 `CREATE TABLE` statements are present
5. Verify all enum `CREATE TYPE` statements are in the `pipelines` schema namespace

```sql
-- Expected at top of migration file:
CREATE SCHEMA IF NOT EXISTS "pipelines";

CREATE TYPE "pipelines"."pipeline_status" AS ENUM('active', 'paused', 'archived');
-- ... remaining 7 enums ...

CREATE TABLE "pipelines"."pipelines" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "tenant_id" uuid NOT NULL,
  -- ... remaining columns ...
);
-- ... remaining 7 tables ...
```

**Files**:
- `drizzle/<timestamp>_pipelines_schema.sql` (new, generated)

**Validation**:
- [ ] Migration file contains `CREATE SCHEMA IF NOT EXISTS "pipelines"`
- [ ] Migration file contains all 8 `CREATE TYPE` statements in the `pipelines.` namespace
- [ ] Migration file contains all 8 `CREATE TABLE "pipelines".*` statements
- [ ] `npx drizzle-kit push` applies the migration without errors against a local test database

**Edge Cases**:
- Drizzle Kit may not automatically prepend `CREATE SCHEMA IF NOT EXISTS`. Inspect the generated file and add it if missing — this is a known gap in Drizzle's `pgSchema` support.
- Migration file naming: use the project's existing timestamp format. Do not rename auto-generated files.

---

### T007: Verify typecheck and existing tests pass

**Purpose**: Confirm that the schema foundation does not break existing tests or introduce TypeScript errors elsewhere in the codebase.

**Steps**:
1. Run `npm run typecheck` (or `tsc --noEmit`) from the repo root
2. Run `npm test` and confirm zero regressions
3. Fix any type errors introduced by the `src/db/client.ts` modification

**Files**:
- No new files. May require minor edits to `src/db/client.ts` to resolve type conflicts.

**Validation**:
- [ ] `npm run typecheck` exits 0 with zero errors
- [ ] `npm test` exits 0 with the same number of passing tests as before this WP
- [ ] No pre-existing test failures are masked or hidden

**Edge Cases**:
- If existing code imports `db` with a `typeof db` assertion, adding new schema tables to the Drizzle instance may change the inferred type. This is safe — it only adds properties.

---

## Definition of Done

- [ ] `src/pipelines/schema.ts` — 8 tables, 8 enums, relations defined
- [ ] `src/pipelines/types.ts` — inferred types, discriminated union, constants
- [ ] `src/pipelines/validation.ts` — Zod schemas for all pipeline inputs
- [ ] `src/pipelines/index.ts` — barrel export wiring schema/types/validation
- [ ] `src/db/client.ts` — exports pipelines schema tables
- [ ] `drizzle/<timestamp>_pipelines_schema.sql` — migration with `CREATE SCHEMA IF NOT EXISTS pipelines`
- [ ] `npm run typecheck` exits 0
- [ ] `npm test` exits 0 with no regressions

## Risks

- **Drizzle pgSchema gap**: `pgSchema` may not emit `CREATE SCHEMA` in the migration. Inspect generated SQL and patch manually if needed.
- **Partial index syntax**: Drizzle's `.where(sql\`...\`)` on indexes requires the `sql` import from `drizzle-orm`. Wrong import path causes a runtime error that looks like a type error.
- **db.client.ts type widening**: Adding tables to the Drizzle schema object widens its type. Existing code using strict `typeof db` checks may need updating.

## Reviewer Guidance

- Verify the `pipelines` PostgreSQL schema namespace is used consistently: all tables should be `pipelinesSchema.table(...)`, not top-level `pgTable(...)`.
- Check that `triggerConfig`, `stepConfigs`, and `retryPolicy` columns use `jsonb` (not `json`) — `jsonb` is indexable and more efficient.
- Confirm the partial index on `trigger_events` filters out processed events: `WHERE processed_at IS NULL`. This is the hot path for the poll loop.
- Verify `tenant_id` columns are on every table — tenant isolation depends on this being present at the schema level.
