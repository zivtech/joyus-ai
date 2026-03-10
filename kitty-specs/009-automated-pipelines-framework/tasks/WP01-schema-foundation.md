---
work_package_id: "WP01"
title: "Schema & Foundation"
lane: "doing"
dependencies: []
subtasks: ["T001", "T002", "T003", "T004", "T005", "T006", "T007"]
phase: "Phase A - Foundation"
assignee: ""
agent: "claude-opus"
shell_pid: "28669"
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

Create the Drizzle ORM schema for the `pipelines` PostgreSQL schema (8 tables, 8 enums), Zod validation schemas for pipeline configuration input, shared TypeScript types and constants, and wire everything into the existing database client. This is the foundation that every subsequent work package builds on.

## Implementation Command

```bash
spec-kitty implement WP01
```

## Context

- **Spec**: `kitty-specs/009-automated-pipelines-framework/spec.md`
- **Plan**: `kitty-specs/009-automated-pipelines-framework/plan.md`
- **Data Model**: `kitty-specs/009-automated-pipelines-framework/data-model.md` (authoritative schema reference)
- **Research**: `kitty-specs/009-automated-pipelines-framework/research.md`

The pipelines framework extends the existing `joyus-ai-mcp-server` package. All new tables live in a PostgreSQL `pipelines` schema (separate from the existing `public` and `content` schemas). The existing content schema at `src/content/schema.ts` uses `pgSchema('content').table(...)` — follow the same pattern with `pgSchema('pipelines')`.

The existing `src/db/client.ts` already merges `public` and `content` schemas:
```typescript
import * as schema from './schema.js';
import * as contentSchema from '../content/schema.js';
export const db = drizzle(pool, { schema: { ...schema, ...contentSchema } });
```

This WP adds a third schema spread: `...pipelinesSchema`.

---

## Subtask T001: Create Pipelines Drizzle Schema

**Purpose**: Define all 8 pipeline tables and 8 enums using Drizzle ORM with the `pipelines` pgSchema.

**Steps**:
1. Create `joyus-ai-mcp-server/src/pipelines/schema.ts`
2. Import `pgSchema`, `text`, `timestamp`, `boolean`, `integer`, `real`, `jsonb`, `uniqueIndex`, `index` from `drizzle-orm/pg-core`
3. Import `relations` from `drizzle-orm`
4. Import `createId` from `@paralleldrive/cuid2`
5. Define `export const pipelinesSchema = pgSchema('pipelines')`
6. Define all 8 enums using `pipelinesSchema.enum(...)`:
   - `pipeline_status`: `active`, `paused`, `disabled`
   - `execution_status`: `pending`, `running`, `paused_at_gate`, `paused_on_failure`, `completed`, `failed`, `cancelled`
   - `execution_step_status`: `pending`, `running`, `completed`, `failed`, `skipped`, `no_op`
   - `trigger_event_type`: `corpus_change`, `schedule_tick`, `manual_request`
   - `trigger_event_status`: `pending`, `acknowledged`, `processed`, `failed`, `expired`
   - `step_type`: `profile_generation`, `fidelity_check`, `content_generation`, `source_query`, `review_gate`, `notification`
   - `concurrency_policy`: `skip_if_running`, `queue`, `allow_concurrent`
   - `review_decision_status`: `pending`, `approved`, `rejected`
7. Define all 8 tables per data-model.md using `pipelinesSchema.table(...)`:
   - `pipelines` — Pipeline definitions with trigger config, retry policy, concurrency policy
   - `pipeline_steps` — Ordered step definitions within a pipeline
   - `pipeline_executions` — Execution records with status, progress tracking
   - `execution_steps` — Per-step execution state with attempts, idempotency key
   - `trigger_events` — Event queue table (source of truth for delivery guarantee)
   - `review_decisions` — Reviewer approval/rejection records
   - `pipeline_templates` — Reusable pipeline templates (platform-level, not tenant-scoped)
   - `pipeline_metrics` — Aggregated execution metrics (materialized)
8. Define all relations using `relations()`:
   - pipelines -> steps (one-to-many), executions (one-to-many), metrics (one-to-many), template (many-to-one)
   - pipelineSteps -> pipeline (many-to-one), executionSteps (one-to-many)
   - pipelineExecutions -> pipeline (many-to-one), triggerEvent (many-to-one), executionSteps (one-to-many), reviewDecisions (one-to-many)
   - executionSteps -> execution (many-to-one), step (many-to-one)
   - triggerEvents -> executions (one-to-many)
   - reviewDecisions -> execution (many-to-one), executionStep (many-to-one)
   - pipelineTemplates -> pipelines (one-to-many)
   - pipelineMetrics -> pipeline (many-to-one)
9. Export type aliases via `$inferSelect` and `$inferInsert` for all tables

**Important implementation details**:
- All tables use CUID2 for primary keys (matching existing pattern in `src/db/schema.ts` and `src/content/schema.ts`)
- `pipelines.(tenantId, name)` must have a UNIQUE composite index
- `pipeline_steps.(pipelineId, position)` must have a UNIQUE composite index
- `execution_steps.(executionId, position)` must have a UNIQUE composite index
- `pipeline_templates.name` must be UNIQUE
- `retryPolicy` default: `{ maxRetries: 3, baseDelayMs: 30000, maxDelayMs: 300000, backoffMultiplier: 2 }`
- `concurrencyPolicy` default: `skip_if_running`
- `reviewGateTimeoutHours` default: `48`
- `maxPipelineDepth` default: `10`
- The `pipelineTemplates` table is NOT tenant-scoped (platform-level). All other tables have a `tenantId` column.
- Foreign key cascades: pipeline deletion cascades to steps, executions, metrics. Execution deletion cascades to execution_steps, review_decisions.
- Reference data-model.md for exact column types, constraints, and index definitions for every table.

**Files**:
- `joyus-ai-mcp-server/src/pipelines/schema.ts` (new, ~500 lines)

**Validation**:
- [ ] `npm run typecheck` passes
- [ ] All 8 tables defined with correct columns per data-model.md
- [ ] All 8 enums defined with correct values
- [ ] All relations defined
- [ ] All indexes defined (verify each table's indexes against data-model.md)
- [ ] Type exports work: `Pipeline`, `NewPipeline`, `PipelineStep`, `NewPipelineStep`, etc.

---

## Subtask T002: Create Shared TypeScript Types

**Purpose**: Define TypeScript types and constants shared across pipeline modules.

**Steps**:
1. Create `joyus-ai-mcp-server/src/pipelines/types.ts`
2. Define string literal union types mirroring each enum:
   - `PipelineStatus = 'active' | 'paused' | 'disabled'`
   - `ExecutionStatus = 'pending' | 'running' | 'paused_at_gate' | 'paused_on_failure' | 'completed' | 'failed' | 'cancelled'`
   - `ExecutionStepStatus = 'pending' | 'running' | 'completed' | 'failed' | 'skipped' | 'no_op'`
   - `TriggerEventType = 'corpus_change' | 'schedule_tick' | 'manual_request'`
   - `TriggerEventStatus = 'pending' | 'acknowledged' | 'processed' | 'failed' | 'expired'`
   - `StepType = 'profile_generation' | 'fidelity_check' | 'content_generation' | 'source_query' | 'review_gate' | 'notification'`
   - `ConcurrencyPolicy = 'skip_if_running' | 'queue' | 'allow_concurrent'`
   - `ReviewDecisionStatus = 'pending' | 'approved' | 'rejected'`
3. Define interfaces:
   - `RetryPolicy { maxRetries: number; baseDelayMs: number; maxDelayMs: number; backoffMultiplier: number; }`
   - `TriggerConfig` — base interface with `type: TriggerEventType` and type-specific extensions:
     - `CorpusChangeTriggerConfig { type: 'corpus_change'; corpusFilter?: Record<string, unknown>; }`
     - `ScheduleTriggerConfig { type: 'schedule_tick'; cronExpression: string; timezone?: string; }`
     - `ManualRequestTriggerConfig { type: 'manual_request'; }`
   - `StepConfig` — base interface with `type: StepType` and type-specific extensions for each step type
   - `EventEnvelope { eventId: string; tenantId: string; eventType: TriggerEventType; payload: Record<string, unknown>; timestamp: Date; }`
   - `StepResult { success: boolean; outputData?: Record<string, unknown>; error?: StepError; isNoOp?: boolean; }`
   - `StepError { message: string; type: string; isTransient: boolean; retryable: boolean; }`
   - `ArtifactRef { type: string; id: string; metadata?: Record<string, unknown>; }`
   - `ReviewFeedback { reason: string; category: string; details?: string; suggestedAction?: string; }`
4. Define constants:
   - `DEFAULT_RETRY_POLICY: RetryPolicy = { maxRetries: 3, baseDelayMs: 30000, maxDelayMs: 300000, backoffMultiplier: 2 }`
   - `DEFAULT_POLL_INTERVAL_MS = 30000`
   - `DEFAULT_REVIEW_GATE_TIMEOUT_HOURS = 48`
   - `DEFAULT_MAX_PIPELINE_DEPTH = 10`
   - `MAX_PIPELINES_PER_TENANT = 20`
   - `ESCALATION_CHECK_INTERVAL_CRON = '0 * * * *'` (every hour)

**Files**:
- `joyus-ai-mcp-server/src/pipelines/types.ts` (new, ~150 lines)

**Validation**:
- [ ] `npm run typecheck` passes
- [ ] Types are importable from `../pipelines/types.js`

---

## Subtask T003: Create Zod Validation Schemas

**Purpose**: Define Zod schemas for validating input to pipeline operations (tool inputs, API request bodies).

**Steps**:
1. Create `joyus-ai-mcp-server/src/pipelines/validation.ts`
2. Import `z` from `zod` (already a dependency from Feature 006)
3. Define Zod schemas for:
   - `RetryPolicySchema`: maxRetries (int, 0-10), baseDelayMs (int, 1000-600000), maxDelayMs (int, 1000-600000), backoffMultiplier (number, 1-10)
   - `CorpusChangeTriggerConfigSchema`: type literal 'corpus_change', optional corpusFilter object
   - `ScheduleTriggerConfigSchema`: type literal 'schedule_tick', cronExpression (string, validate with cron-parser), optional timezone
   - `ManualRequestTriggerConfigSchema`: type literal 'manual_request'
   - `TriggerConfigSchema`: discriminated union on `type` field
   - `StepConfigSchema`: per step_type config schemas (profile_generation needs profileIds, fidelity_check needs thresholds, content_generation needs prompt/profileId, source_query needs query params, review_gate needs artifact selection config, notification needs channel/message)
   - `CreatePipelineInput`: name (string, 1-200), description (optional string), triggerType (enum), triggerConfig (TriggerConfigSchema), steps (array of step definitions, min 1), retryPolicy (optional, default), concurrencyPolicy (optional enum, default 'skip_if_running'), reviewGateTimeoutHours (optional int, default 48), maxPipelineDepth (optional int, 1-50, default 10)
   - `UpdatePipelineInput`: partial of CreatePipelineInput (all fields optional except id)
   - `CreateManualTriggerInput`: pipelineId (string), payload (optional object)
   - `ReviewDecisionInput`: decisionId (string), status ('approved' | 'rejected'), feedback (optional ReviewFeedback object, required if rejected)
   - `PipelineQueryInput`: tenantId (string), status (optional enum), limit (optional int, default 20, max 100), offset (optional int, default 0)
   - `ExecutionQueryInput`: pipelineId (optional string), tenantId (string), status (optional enum), limit (optional int, default 20, max 100), offset (optional int, default 0)
4. Export all schemas and inferred types

**Files**:
- `joyus-ai-mcp-server/src/pipelines/validation.ts` (new, ~200 lines)

**Validation**:
- [ ] `npm run typecheck` passes
- [ ] All schemas parse valid input correctly
- [ ] All schemas reject invalid input with meaningful errors
- [ ] Cron expression validation works (import cron-parser, already in package.json)

---

## Subtask T004: Create Module Barrel Export

**Purpose**: Create the pipeline module's main entry point for imports.

**Steps**:
1. Create `joyus-ai-mcp-server/src/pipelines/index.ts`
2. Re-export from schema, types, and validation:
   ```typescript
   export * from './schema.js';
   export * from './types.js';
   export * from './validation.js';
   ```
3. This file will be extended in later WPs to export event-bus, engine, triggers, steps, review, templates, analytics

**Files**:
- `joyus-ai-mcp-server/src/pipelines/index.ts` (new, ~10 lines)

**Validation**:
- [ ] `npm run typecheck` passes
- [ ] Imports resolve correctly from `../pipelines/index.js`

---

## Subtask T005: Export Pipelines Schema from DB Client

**Purpose**: Make pipeline schema tables accessible through the existing `db` client export.

**Steps**:
1. Edit `joyus-ai-mcp-server/src/db/client.ts`
2. Add import: `import * as pipelinesSchema from '../pipelines/schema.js';`
3. Update drizzle client initialization to include pipelines schema:
   ```typescript
   export const db = drizzle(pool, { schema: { ...schema, ...contentSchema, ...pipelinesSchema } });
   ```
4. Add re-export: `export * from '../pipelines/schema.js';`

**Files**:
- `joyus-ai-mcp-server/src/db/client.ts` (modify, ~3 lines changed)

**Validation**:
- [ ] `npm run typecheck` passes
- [ ] Pipeline tables importable: `import { pipelines } from '../db/client.js'`
- [ ] Existing imports still work unchanged
- [ ] Existing tests still pass

---

## Subtask T006: Generate Drizzle Migration

**Purpose**: Generate the SQL migration that creates the `pipelines` schema and all tables.

**Steps**:
1. Run `npx drizzle-kit generate` to generate the migration
2. Verify the generated SQL includes `CREATE SCHEMA IF NOT EXISTS "pipelines"`
3. If drizzle-kit does not generate the schema creation statement, manually prepend it to the migration file
4. Verify all 8 tables, 8 enums, all indexes, and all foreign keys are present in the migration
5. The migration file goes in `joyus-ai-mcp-server/drizzle/` (existing migration directory)

**Files**:
- `joyus-ai-mcp-server/drizzle/NNNN_*.sql` (new, auto-generated)

**Validation**:
- [ ] Migration file contains `CREATE SCHEMA IF NOT EXISTS "pipelines"`
- [ ] All 8 tables present
- [ ] All 8 enums present
- [ ] All indexes present
- [ ] All foreign key constraints present

---

## Subtask T007: Verify Full Validation

**Purpose**: Ensure all changes integrate cleanly with the existing codebase.

**Steps**:
1. Run `npm run typecheck` — must pass with zero errors
2. Run `npm run lint` — must pass
3. Run `npm run test` — all existing tests must pass (no regressions)
4. Verify the `npm run validate` script passes (typecheck + lint + test combined)

**Files**: None (verification only)

**Validation**:
- [ ] `npm run validate` passes with zero errors
- [ ] No changes to existing functionality

---

## Definition of Done

- [ ] All 8 pipeline tables defined in `src/pipelines/schema.ts` matching data-model.md exactly
- [ ] All 8 enums defined with correct values
- [ ] All relations and indexes defined per data-model.md
- [ ] Zod validation schemas cover all pipeline operation inputs
- [ ] Shared types exported from `src/pipelines/types.ts`
- [ ] Pipeline schema accessible via `src/db/client.ts` exports
- [ ] Drizzle migration generated and verified
- [ ] Module barrel export at `src/pipelines/index.ts`
- [ ] `npm run validate` passes with zero errors
- [ ] No changes to existing schema or functionality

## Risks

- **Drizzle pgSchema creation**: The `pipelines` schema must be created before tables. Drizzle-kit may or may not generate `CREATE SCHEMA`. Mitigation: manually add to migration if missing.
- **CUID2 import**: Verify `@paralleldrive/cuid2` is already in dependencies (it is — used by existing schema). Use same import pattern.
- **jsonb defaults with $defaultFn**: Drizzle's `$defaultFn` for jsonb columns must return the correct shape. Test that default retry policy, empty arrays, and empty objects are set correctly.

## Reviewer Guidance

- Verify all 8 tables match data-model.md field-for-field (column names, types, constraints, defaults)
- Check that enum values match spec and data-model exactly
- Confirm CUID2 is used for all primary keys
- Verify all composite unique indexes are correct
- Confirm `pipelineTemplates` is NOT tenant-scoped (no tenantId column)
- Verify foreign key cascade behavior (pipeline deletion -> steps, executions, metrics)
- Check that type exports include both Select and Insert types for all tables
- Verify no changes to existing `src/db/schema.ts` or `src/content/schema.ts`

## Activity Log
- 2026-03-10T16:14:28Z – claude-opus – shell_pid=28669 – lane=doing – Started implementation via workflow command
