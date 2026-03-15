---
work_package_id: "WP07"
title: "Schedule Triggers & Templates"
lane: "planned"
dependencies: ["WP04"]
subtasks: ["T036", "T037", "T038", "T039", "T040", "T041"]
history:
  - date: "2026-03-14"
    action: "created"
    agent: "claude-opus"
---

# WP07: Schedule Triggers & Templates

**Implementation command**: `spec-kitty implement WP07 --base WP04`
**Target repo**: `joyus-ai`
**Dependencies**: WP04 (Pipeline Executor)
**Priority**: P2 | Can run in parallel with WP06

## Objective

Build the schedule trigger handler (cron expression-based with timezone support and overlap detection) and the pipeline template system (CRUD store, built-in template definitions, and tenant instantiation from templates).

## Context

Scheduled pipelines fire on a cron schedule rather than in response to an event. Examples: "run the profile refresh pipeline every weekday at 9am ET" or "generate weekly engagement reports every Monday at 8am". The `ScheduleTriggerHandler` must manage a per-pipeline cron job map, handle dynamic updates when pipelines are created/updated/deleted, and prevent overlap when a scheduled run is still executing when the next fire time arrives.

Pipeline templates allow tenants to create pipelines from pre-defined blueprints without configuring every step from scratch. Built-in templates (defined in code) are available to all tenants. Tenant-specific templates are stored in `pipeline_templates` with `tenant_id` set.

WP07 runs in parallel with WP06 — both depend only on WP04.

**Cron library**: The project uses `cron-parser` (v4) for parsing cron expressions. Import as `import cronParser from 'cron-parser'` (default import — named `parseExpression` import is broken in v4 ESM). This was fixed in the joyus-ai quick-wins PR (#18).

---

## Subtasks

### T036: Implement ScheduleTriggerHandler with cron job management (`src/pipelines/triggers/schedule.ts`)

**Purpose**: Register cron jobs for all active schedule-triggered pipelines and fire trigger events when each job's schedule fires.

**Steps**:
1. Create `src/pipelines/triggers/schedule.ts`
2. Define `ScheduleTriggerHandler` that implements `TriggerHandler`
3. Add `startAllSchedules(activePipelines, eventBus)` — called on executor startup, registers a cron job for each `schedule`-triggered pipeline
4. Add `updateSchedule(pipeline, eventBus)` — called when a pipeline is created/updated via the API
5. Add `removeSchedule(pipelineId)` — called when a pipeline is deleted or paused
6. Each cron job fires a `schedule` event via the event bus

```typescript
// src/pipelines/triggers/schedule.ts
import cronParser from 'cron-parser';
import type { TriggerHandler, TriggerContext, TriggerResult } from './interface';
import type { EventBus } from '../event-bus';
import type { Pipeline, ScheduleTriggerConfig } from '../types';

interface ScheduleJob {
  pipelineId: string;
  timer: NodeJS.Timeout;
}

export class ScheduleTriggerHandler implements TriggerHandler {
  readonly triggerType = 'schedule' as const;

  // pipelineId -> active schedule job
  private jobs = new Map<string, ScheduleJob>();

  canHandle(eventType: string): boolean {
    return eventType === 'schedule';
  }

  /**
   * Called by PipelineExecutor.start() to boot up all active schedule pipelines.
   */
  async startAllSchedules(activePipelines: Pipeline[], eventBus: EventBus): Promise<void> {
    const schedulePipelines = activePipelines.filter(
      (p) => p.triggerType === 'schedule' && p.status === 'active',
    );
    for (const pipeline of schedulePipelines) {
      this.scheduleNext(pipeline, eventBus);
    }
  }

  updateSchedule(pipeline: Pipeline, eventBus: EventBus): void {
    this.removeSchedule(pipeline.id);
    if (pipeline.status === 'active' && pipeline.triggerType === 'schedule') {
      this.scheduleNext(pipeline, eventBus);
    }
  }

  removeSchedule(pipelineId: string): void {
    const job = this.jobs.get(pipelineId);
    if (job) {
      clearTimeout(job.timer);
      this.jobs.delete(pipelineId);
    }
  }

  stopAll(): void {
    for (const pipelineId of this.jobs.keys()) {
      this.removeSchedule(pipelineId);
    }
  }

  private scheduleNext(pipeline: Pipeline, eventBus: EventBus): void {
    const config = pipeline.triggerConfig as ScheduleTriggerConfig;
    const nextMs = this.getNextFireMs(config);
    if (nextMs === null) return;

    const timer = setTimeout(async () => {
      // Fire the event
      await eventBus.publish(pipeline.tenantId, 'schedule', {
        pipelineId: pipeline.id,
        scheduledAt: new Date().toISOString(),
      });
      // Schedule the next occurrence
      this.scheduleNext(pipeline, eventBus);
    }, nextMs);

    this.jobs.set(pipeline.id, { pipelineId: pipeline.id, timer });
  }

  private getNextFireMs(config: ScheduleTriggerConfig): number | null {
    try {
      const interval = cronParser.parseExpression(config.cronExpression, {
        tz: config.timezone,
        currentDate: new Date(),
      });
      const next = interval.next().toDate();
      return next.getTime() - Date.now();
    } catch (err) {
      console.error('[ScheduleTrigger] Invalid cron expression:', config.cronExpression, err);
      return null;
    }
  }

  // TriggerHandler interface — schedule events target a specific pipeline by ID
  getMatchingPipelines(context: TriggerContext, activePipelines: Pipeline[]): TriggerResult[] {
    const { pipelineId } = context.event.payload as { pipelineId?: string };
    if (!pipelineId) return [];

    const pipeline = activePipelines.find(
      (p) => p.id === pipelineId && p.triggerType === 'schedule' && p.status === 'active',
    );
    if (!pipeline) return [];

    return [{ pipelineId: pipeline.id, triggerPayload: context.event.payload }];
  }
}
```

**Files**:
- `src/pipelines/triggers/schedule.ts` (new, ~85 lines)

**Validation**:
- [ ] `getNextFireMs` returns a positive number (milliseconds until next fire) for a valid cron expression
- [ ] `getNextFireMs` returns `null` for an invalid cron expression without throwing
- [ ] `removeSchedule` clears the timer and removes the job from the map
- [ ] `stopAll` removes all registered jobs
- [ ] `tsc --noEmit` passes

**Edge Cases**:
- `cronParser.parseExpression` is called with `tz` option for timezone-aware scheduling. The `timezone` field in `ScheduleTriggerConfig` must be a valid IANA timezone string (e.g., `'America/New_York'`). Validate this in the Zod schema (WP01).
- `setTimeout` has a maximum delay of ~24.8 days (2^31 - 1 ms). For cron expressions that fire further in the future than that, `getNextFireMs` will return a value that wraps around. In practice, no reasonable cron fires less than once per month — add a guard to cap `nextMs` at 24 days and re-evaluate at that point.

---

### T037: Implement overlap detection and timezone support

**Purpose**: Prevent a second scheduled execution from starting if the first is still running. This extends the concurrency policy check already in `PipelineExecutor` but adds schedule-specific logic.

**Steps**:
1. This task extends `ScheduleTriggerHandler` in `schedule.ts` — no new file
2. Before firing a schedule event, check if the pipeline already has a `running` or `waiting_review` execution
3. If overlap is detected and `allowOverlap: false`, skip this fire and log a warning
4. If `allowOverlap: true`, fire regardless

```typescript
// Addition to ScheduleTriggerHandler.scheduleNext() (inside the setTimeout callback):

      // Overlap detection for schedule triggers
      const config = pipeline.triggerConfig as ScheduleTriggerConfig;
      if (!config.allowOverlap) {
        const hasRunning = await this.checkHasRunningExecution(pipeline.id, db);
        if (hasRunning) {
          console.warn(
            `[ScheduleTrigger] Skipping scheduled fire for pipeline ${pipeline.id} — previous execution still running`,
          );
          this.scheduleNext(pipeline, eventBus);
          return;
        }
      }
```

Note: `ScheduleTriggerHandler.scheduleNext` needs access to `db` for overlap detection. Update the constructor to accept `db` as an optional parameter, injected when `startAllSchedules` is called.

**Files**:
- `src/pipelines/triggers/schedule.ts` (modified — add overlap detection)

**Validation**:
- [ ] Pipeline with `allowOverlap: false` and a running execution: schedule fires are skipped
- [ ] Pipeline with `allowOverlap: true`: schedule fires regardless of running executions
- [ ] Overlap detection uses `pipeline_executions WHERE status IN ('running', 'waiting_review')` — same query pattern as concurrency policy check in executor
- [ ] `tsc --noEmit` passes

**Edge Cases**:
- The concurrency policy in `PipelineExecutor.checkConcurrencyPolicy` already handles this for `skip` policy. Schedule-specific overlap detection is a redundant safety layer. If the pipeline's `concurrencyPolicy` is `skip` AND `allowOverlap: false`, both checks run. If either detects overlap, the execution is skipped.

---

### T038: Implement TemplateStore — CRUD and instantiation logic (`src/pipelines/templates/store.ts`)

**Purpose**: Manage pipeline templates — create, read, update, delete — and provide `instantiate(templateId, tenantId, overrides)` which creates a new pipeline from a template.

**Steps**:
1. Create `src/pipelines/templates/store.ts`
2. Define `TemplateStore` class with `list`, `get`, `create`, `update`, `delete`, `instantiate` methods
3. `list(tenantId)` returns built-in templates (where `tenant_id IS NULL`) plus tenant-specific templates
4. `instantiate(templateId, tenantId, overrides)` deep-clones the template definition, merges overrides, and inserts into `pipelines`

```typescript
// src/pipelines/templates/store.ts
import { eq, or, isNull } from 'drizzle-orm';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { pipelineTemplates, pipelines } from '../schema';
import type { CreatePipelineInput } from '../validation';

export class TemplateStore {
  constructor(private readonly db: NodePgDatabase<Record<string, unknown>>) {}

  async list(tenantId: string) {
    return this.db
      .select()
      .from(pipelineTemplates)
      .where(or(isNull(pipelineTemplates.tenantId), eq(pipelineTemplates.tenantId, tenantId)));
  }

  async get(templateId: string, tenantId: string) {
    const rows = await this.db
      .select()
      .from(pipelineTemplates)
      .where(eq(pipelineTemplates.id, templateId))
      .limit(1);

    const template = rows[0];
    if (!template) return null;

    // Access check: built-in (null tenantId) or owned by this tenant
    if (template.tenantId !== null && template.tenantId !== tenantId) return null;

    return template;
  }

  async create(tenantId: string, input: {
    name: string;
    description?: string;
    triggerType: string;
    stepConfigs: unknown[];
  }) {
    const [row] = await this.db
      .insert(pipelineTemplates)
      .values({
        tenantId,
        name: input.name,
        description: input.description,
        triggerType: input.triggerType as any,
        stepConfigs: input.stepConfigs,
        isBuiltIn: false,
      })
      .returning();
    return row;
  }

  async instantiate(
    templateId: string,
    tenantId: string,
    overrides: Partial<CreatePipelineInput>,
  ) {
    const template = await this.get(templateId, tenantId);
    if (!template) throw new Error(`Template ${templateId} not found or not accessible`);

    // Deep clone to prevent cross-tenant contamination
    const clonedStepConfigs = JSON.parse(JSON.stringify(template.stepConfigs));

    const pipelineData: CreatePipelineInput = {
      name: overrides.name ?? template.name,
      description: overrides.description ?? template.description ?? undefined,
      triggerConfig: overrides.triggerConfig ?? (template.triggerType === 'manual'
        ? { type: 'manual' }
        : { type: template.triggerType as any }),
      stepConfigs: overrides.stepConfigs ?? clonedStepConfigs,
      concurrencyPolicy: overrides.concurrencyPolicy ?? 'skip',
    };

    const [pipeline] = await this.db
      .insert(pipelines)
      .values({
        tenantId,
        name: pipelineData.name,
        description: pipelineData.description,
        triggerType: pipelineData.triggerConfig.type as any,
        triggerConfig: pipelineData.triggerConfig,
        stepConfigs: pipelineData.stepConfigs,
        concurrencyPolicy: pipelineData.concurrencyPolicy as any,
        retryPolicy: {},
        status: 'active',
      })
      .returning();

    return pipeline;
  }
}
```

**Files**:
- `src/pipelines/templates/store.ts` (new, ~80 lines)

**Validation**:
- [ ] `list(tenantId)` returns built-in templates AND tenant-specific templates
- [ ] `list(tenantId)` does NOT return another tenant's templates
- [ ] `instantiate` deep-clones `stepConfigs` (mutation of returned pipeline does not affect the template)
- [ ] `instantiate` with a non-existent or inaccessible template throws an error
- [ ] `tsc --noEmit` passes

**Edge Cases**:
- `JSON.parse(JSON.stringify(...))` deep-clone breaks `Date` objects (converts to strings). Since `stepConfigs` is pure JSON (no Date objects), this is safe. If Date support is needed later, use `structuredClone`.

---

### T039: Create 3 built-in template definitions (`src/pipelines/templates/definitions/`)

**Purpose**: Ship three ready-to-use pipeline templates that cover the most common use cases, available to all tenants without configuration.

**Steps**:
1. Create `src/pipelines/templates/definitions/index.ts`
2. Define `BUILT_IN_TEMPLATES` array with 3 template definitions
3. Create a `seedBuiltInTemplates(db)` function that upserts these templates on startup

**Template 1: Prospect Research Pipeline**
- Trigger: manual
- Steps: source_query → profile_generation → fidelity_check (requiresReview: true) → notification
- Use case: on-demand deep research for a prospect

**Template 2: Corpus Change Response Pipeline**
- Trigger: corpus_change
- Steps: source_query → content_generation → notification
- Use case: generate a summary/alert when new content is added to the corpus

**Template 3: Weekly Digest Pipeline**
- Trigger: schedule (weekday 9am ET, no overlap)
- Steps: source_query → content_generation → notification
- Use case: regular scheduled digest of corpus activity

```typescript
// src/pipelines/templates/definitions/index.ts
import { eq } from 'drizzle-orm';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { pipelineTemplates } from '../../schema';

export const BUILT_IN_TEMPLATES = [
  {
    id: '00000000-0000-0000-0000-000000000001',
    name: 'Prospect Research Pipeline',
    description: 'On-demand deep research for a prospect. Queries corpus, generates profile, checks fidelity, and notifies.',
    triggerType: 'manual' as const,
    stepConfigs: [
      { stepType: 'source_query', name: 'Query Corpus', config: { query: '', limit: 20 }, requiresReview: false },
      { stepType: 'profile_generation', name: 'Generate Profile', config: { targetType: 'person' }, requiresReview: false },
      { stepType: 'fidelity_check', name: 'Check Fidelity', config: { artifactPath: '' }, requiresReview: true, reviewTimeoutHours: 24 },
      { stepType: 'notification', name: 'Notify Team', config: { channel: 'slack', recipient: '', message: 'Profile ready for review.' }, requiresReview: false },
    ],
    isBuiltIn: true,
  },
  {
    id: '00000000-0000-0000-0000-000000000002',
    name: 'Corpus Change Response',
    description: 'Generates a summary and alert when new content is added to the corpus.',
    triggerType: 'corpus_change' as const,
    stepConfigs: [
      { stepType: 'source_query', name: 'Fetch New Documents', config: { query: 'recent changes', limit: 10 }, requiresReview: false },
      { stepType: 'content_generation', name: 'Generate Summary', config: { contentType: 'change_summary' }, requiresReview: false },
      { stepType: 'notification', name: 'Send Alert', config: { channel: 'slack', recipient: '', message: 'New corpus activity detected.' }, requiresReview: false },
    ],
    isBuiltIn: true,
  },
  {
    id: '00000000-0000-0000-0000-000000000003',
    name: 'Weekly Digest',
    description: 'Sends a weekly digest of corpus activity every Monday at 9am ET.',
    triggerType: 'schedule' as const,
    stepConfigs: [
      { stepType: 'source_query', name: 'Fetch Week Activity', config: { query: 'last 7 days', limit: 50 }, requiresReview: false },
      { stepType: 'content_generation', name: 'Generate Digest', config: { contentType: 'weekly_digest' }, requiresReview: false },
      { stepType: 'notification', name: 'Send Digest', config: { channel: 'email', recipient: '', message: '' }, requiresReview: false },
    ],
    isBuiltIn: true,
  },
] as const;

/**
 * Upserts built-in templates on server startup.
 * Uses fixed UUIDs so re-seeding is idempotent.
 */
export async function seedBuiltInTemplates(
  db: NodePgDatabase<Record<string, unknown>>,
): Promise<void> {
  for (const template of BUILT_IN_TEMPLATES) {
    await db
      .insert(pipelineTemplates)
      .values({
        id: template.id,
        tenantId: null,
        name: template.name,
        description: template.description,
        triggerType: template.triggerType,
        stepConfigs: template.stepConfigs as unknown[],
        isBuiltIn: true,
      })
      .onConflictDoUpdate({
        target: pipelineTemplates.id,
        set: {
          name: template.name,
          description: template.description,
          stepConfigs: template.stepConfigs as unknown[],
          updatedAt: new Date(),
        },
      });
  }
}
```

**Files**:
- `src/pipelines/templates/definitions/index.ts` (new, ~65 lines)

**Validation**:
- [ ] `seedBuiltInTemplates` is idempotent — running twice does not create duplicate rows
- [ ] All 3 templates have fixed UUIDs (enables deterministic upserts)
- [ ] Template IDs use a recognizable pattern (`00000000-0000-0000-0000-00000000000X`) to distinguish built-ins
- [ ] `tsc --noEmit` passes

**Edge Cases**:
- The `stepConfigs` in built-in templates use empty strings for configurable fields (e.g., `recipient: ''`). When a tenant instantiates a template, they must provide real values via `overrides.stepConfigs` or by editing the created pipeline. Document this in the template `description`.

---

### T040: Create template barrel export (`src/pipelines/templates/index.ts`)

**Purpose**: Single import point for the templates module.

```typescript
// src/pipelines/templates/index.ts
export { TemplateStore } from './store';
export { BUILT_IN_TEMPLATES, seedBuiltInTemplates } from './definitions';
```

**Files**:
- `src/pipelines/templates/index.ts` (new, ~5 lines)

**Validation**:
- [ ] `import { TemplateStore, seedBuiltInTemplates } from '../templates'` resolves without errors
- [ ] `tsc --noEmit` passes

---

### T041: Unit tests for schedule triggers and templates (`tests/pipelines/triggers/schedule.test.ts`, `tests/pipelines/templates/store.test.ts`)

**Purpose**: Verify cron next-fire calculation, overlap detection logic, template listing, and instantiation.

**Steps**:
1. Create `tests/pipelines/triggers/schedule.test.ts`
2. Create `tests/pipelines/templates/store.test.ts`

```typescript
// tests/pipelines/triggers/schedule.test.ts
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { ScheduleTriggerHandler } from '../../../src/pipelines/triggers/schedule';

describe('ScheduleTriggerHandler', () => {
  it('getMatchingPipelines returns empty array when pipelineId missing', () => {
    const handler = new ScheduleTriggerHandler();
    const result = handler.getMatchingPipelines(
      {
        event: { id: 'e1', tenantId: 't1', eventType: 'schedule', payload: {}, createdAt: new Date() },
        tenantId: 't1',
        currentDepth: 0,
      },
      [],
    );
    expect(result).toEqual([]);
  });

  it('stops all schedules without throwing', () => {
    const handler = new ScheduleTriggerHandler();
    expect(() => handler.stopAll()).not.toThrow();
  });

  it('removeSchedule is a no-op for unknown pipeline', () => {
    const handler = new ScheduleTriggerHandler();
    expect(() => handler.removeSchedule('unknown-id')).not.toThrow();
  });
});

// Note: cron fire timing tests require real DB and fake timers (vi.useFakeTimers)
// Those are integration tests covered in WP10.
```

```typescript
// tests/pipelines/templates/store.test.ts
import { describe, it, expect } from 'vitest';
import { BUILT_IN_TEMPLATES } from '../../../src/pipelines/templates/definitions';

describe('BUILT_IN_TEMPLATES', () => {
  it('has exactly 3 built-in templates', () => {
    expect(BUILT_IN_TEMPLATES).toHaveLength(3);
  });

  it('all templates have unique fixed UUIDs', () => {
    const ids = BUILT_IN_TEMPLATES.map((t) => t.id);
    const unique = new Set(ids);
    expect(unique.size).toBe(ids.length);
  });

  it('all templates have at least one step', () => {
    for (const template of BUILT_IN_TEMPLATES) {
      expect(template.stepConfigs.length).toBeGreaterThan(0);
    }
  });
});
```

**Files**:
- `tests/pipelines/triggers/schedule.test.ts` (new, ~35 lines)
- `tests/pipelines/templates/store.test.ts` (new, ~30 lines)

**Validation**:
- [ ] `npm test tests/pipelines/triggers/schedule.test.ts` exits 0
- [ ] `npm test tests/pipelines/templates/store.test.ts` exits 0
- [ ] Built-in template UUID uniqueness verified
- [ ] Schedule handler graceful behavior (no-ops for missing/unknown pipelines) verified

**Edge Cases**:
- Cron schedule timing is highly timing-dependent in tests. Use `vi.useFakeTimers()` and `vi.runAllTimers()` for integration tests in WP10 rather than here.

---

## Definition of Done

- [ ] `src/pipelines/triggers/schedule.ts` — `ScheduleTriggerHandler` with cron management, overlap detection, timezone support
- [ ] `src/pipelines/templates/store.ts` — `TemplateStore` with list, get, create, instantiate
- [ ] `src/pipelines/templates/definitions/index.ts` — 3 built-in templates, `seedBuiltInTemplates`
- [ ] `src/pipelines/templates/index.ts` — barrel export
- [ ] `ScheduleTriggerHandler` registered in `defaultTriggerRegistry` (update `src/pipelines/triggers/registry.ts`)
- [ ] Tests passing: schedule handler (missing pipelineId, stopAll, removeSchedule), templates (3 built-ins, unique IDs, non-empty steps)
- [ ] `npm run typecheck` exits 0
- [ ] `npm test` exits 0 with no regressions

## Risks

- **setTimeout drift**: Using `setTimeout` for scheduling means the actual fire time drifts slightly each iteration. For millisecond-precision scheduling this is unacceptable — but pipelines typically schedule at minute granularity (cron), so ±100ms drift is irrelevant. If sub-minute precision is needed, use `setInterval` or a dedicated scheduler library.
- **Large cron job map**: If a tenant creates hundreds of schedule-triggered pipelines, the `jobs` map in `ScheduleTriggerHandler` holds hundreds of `setTimeout` handles. This is manageable for reasonable tenant usage (< 100 pipelines) but worth monitoring.
- **Built-in template migration**: If the built-in template definitions change (step added, removed), `seedBuiltInTemplates` uses `onConflictDoUpdate` which overwrites the existing template. Tenants who instantiated the old template are unaffected (their pipelines are independent rows), but the template itself is updated. Document this behavior.

## Reviewer Guidance

- Verify `cron-parser` is imported as a default import (`import cronParser from 'cron-parser'`) — the named `parseExpression` import is broken in v4 ESM. Check the existing fix in the project's cron-related code.
- Confirm `ScheduleTriggerHandler` is registered in `defaultTriggerRegistry` in `src/pipelines/triggers/registry.ts`. The registry from WP03 only has `corpus_change` and `manual` — this WP must add `schedule`.
- Check that `seedBuiltInTemplates` is called from `src/pipelines/index.ts` initialization, not manually — it should run automatically on server startup.
