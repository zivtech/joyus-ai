---
work_package_id: WP07
title: Schedule Triggers & Templates
lane: done
dependencies: []
base_branch: main
base_commit: 7efaca018cd3063d2769cd4b6b6666a69277dc89
created_at: '2026-03-16T18:39:55.213916+00:00'
subtasks: [T036, T037, T038, T039, T040, T041]
phase: Phase D - Review Gates & Scheduling
assignee: ''
agent: ''
shell_pid: '58980'
review_status: approved
reviewed_by: Alex Urevick-Ackelsberg
history:
- timestamp: '2026-03-10T00:00:00Z'
  lane: planned
  agent: system
  action: Prompt generated via /spec-kitty.tasks
---

# WP07: Schedule Triggers & Templates

## Objective

Build the schedule-driven trigger handler (cron-based pipeline execution) and the pipeline template system (reusable pipeline definitions that tenants can instantiate and customize).

## Implementation Command

```bash
spec-kitty implement WP07 --base WP04
```

## Context

- **Spec**: `kitty-specs/009-automated-pipelines-framework/spec.md` (FR-002: schedule triggers, FR-011: templates, FR-012: template independence)
- **Research**: `kitty-specs/009-automated-pipelines-framework/research.md` (R6: Cron Scheduling)
- **Data Model**: `kitty-specs/009-automated-pipelines-framework/data-model.md` (PipelineTemplate table)

The schedule trigger extends the trigger system (WP03) with cron-based execution. The template system provides pre-built pipeline configurations that reduce tenant onboarding time (NFR-005: <10 minutes from template to active pipeline).

**Key design decisions from research.md (R6)**:
- Reuse `node-cron` 3.x and `cron-parser` 4.x (already in package.json)
- ScheduleTriggerHandler maintains a `Map<string, ScheduledTask>` of active cron jobs
- Overlap detection: if previous execution is still running and policy is `skip_if_running`, skip and log warning
- Dynamic registration: cron jobs are added/removed as pipelines are created/updated/deleted
- Timezone support via trigger config

---

## Subtask T036: Implement ScheduleTriggerHandler with Cron Job Management

**Purpose**: Register and manage cron jobs that create trigger events on schedule.

**Steps**:
1. Create `joyus-ai-mcp-server/src/pipelines/triggers/schedule.ts`
2. Implement `ScheduleTriggerHandler` class implementing `TriggerHandler`:
   ```typescript
   export class ScheduleTriggerHandler implements TriggerHandler {
     readonly eventType: TriggerEventType = 'schedule_tick';
     private activeJobs = new Map<string, cron.ScheduledTask>();

     constructor(
       private db: DrizzleClient,
       private eventBus: EventBus,
     ) {}

     // TriggerHandler interface
     async findMatchingPipelines(tenantId: string, payload: Record<string, unknown>): Promise<MatchedPipeline[]>;
     async createTriggerEvent(tenantId: string, payload: Record<string, unknown>): Promise<string>;

     // Schedule management
     async loadAllSchedules(): Promise<void>;
     registerSchedule(pipeline: Pipeline): void;
     unregisterSchedule(pipelineId: string): void;
     updateSchedule(pipeline: Pipeline): void;
     stopAll(): void;
   }
   ```
3. **loadAllSchedules()**:
   - Query all pipelines WHERE `triggerType = 'schedule_tick'` AND `status = 'active'`
   - For each: call `registerSchedule(pipeline)`
4. **registerSchedule(pipeline)**:
   - Extract cron expression from `pipeline.triggerConfig.cronExpression`
   - Extract timezone from `pipeline.triggerConfig.timezone` (default: 'UTC')
   - Validate cron expression using `cron-parser` (parseExpression with default import for ESM)
   - Create a `cron.schedule(expression, callback, { timezone })` job:
     - Callback: create a trigger_event with type `schedule_tick` and payload `{ pipelineId, scheduledAt: new Date() }`
     - Then publish the event to the event bus
   - Store the job in `activeJobs` map keyed by pipeline.id
5. **unregisterSchedule(pipelineId)**:
   - Look up the job in `activeJobs`, call `.stop()`, delete from map
6. **updateSchedule(pipeline)**:
   - Call `unregisterSchedule(pipeline.id)` then `registerSchedule(pipeline)`
7. **findMatchingPipelines(tenantId, payload)**:
   - The payload contains `{ pipelineId }` — look up the specific pipeline
   - Verify tenant ownership and active status
   - Return single-element array
8. **stopAll()**: Stop all active cron jobs, clear the map

**Important implementation details**:
- Use `cron-parser`'s default import (ESM): `import cronParser from 'cron-parser'` — this was fixed in the existing codebase (WP18 of joyus-ai)
- The ScheduleTriggerHandler must be registered in the TriggerRegistry (WP03). Update the `createTriggerRegistry` factory to accept an optional ScheduleTriggerHandler.
- The handler does NOT evaluate the cron expression itself — it uses `node-cron` for that. The handler's `findMatchingPipelines` is only called when the executor processes a `schedule_tick` event.

**Files**:
- `joyus-ai-mcp-server/src/pipelines/triggers/schedule.ts` (new, ~120 lines)
- `joyus-ai-mcp-server/src/pipelines/triggers/registry.ts` (modify — add schedule handler registration)

**Validation**:
- [ ] Loads all scheduled pipelines on startup
- [ ] Creates cron jobs with correct expression and timezone
- [ ] On cron tick: creates trigger_event and publishes to event bus
- [ ] Dynamic add/remove/update of schedules
- [ ] stopAll() cleans up all jobs

---

## Subtask T037: Implement Overlap Detection and Timezone Support

**Purpose**: Prevent schedule overlap (skip execution if previous is still running) and support timezone configuration.

**Steps**:
1. In `schedule.ts`, enhance the cron callback:
   - Before creating a trigger_event, check for running executions:
     - Query pipeline_executions WHERE `pipelineId = pipeline.id` AND `status IN ('pending', 'running', 'paused_at_gate')`
     - If any exist AND pipeline's concurrencyPolicy is `skip_if_running`:
       - Log a warning: `"[pipelines] Skipping scheduled execution for pipeline ${pipeline.name}: previous execution still running"`
       - Do NOT create a trigger_event
       - Return without action
     - If concurrencyPolicy is `queue` or `allow_concurrent`: proceed normally
2. Timezone support:
   - `node-cron`'s `schedule()` accepts a `timezone` option — pass it from `triggerConfig.timezone`
   - Validate the timezone string using `Intl.DateTimeFormat` or similar:
     ```typescript
     function isValidTimezone(tz: string): boolean {
       try {
         Intl.DateTimeFormat(undefined, { timeZone: tz });
         return true;
       } catch { return false; }
     }
     ```
   - If invalid timezone: reject at pipeline creation (validation in WP01 Zod schemas) and log error at registration time
3. Compute next run time for display/API:
   ```typescript
   export function getNextRunTime(cronExpression: string, timezone?: string): Date | null {
     try {
       const interval = cronParser.parseExpression(cronExpression, { tz: timezone || 'UTC' });
       return interval.next().toDate();
     } catch { return null; }
   }
   ```

**Files**:
- `joyus-ai-mcp-server/src/pipelines/triggers/schedule.ts` (extend from T036, ~40 additional lines)

**Validation**:
- [ ] Skip execution when previous is running and policy is skip_if_running
- [ ] Log warning on skip
- [ ] Allow execution when policy is queue or allow_concurrent
- [ ] Valid timezone is passed to cron.schedule
- [ ] Invalid timezone is rejected at validation time
- [ ] getNextRunTime computes correct next execution

---

## Subtask T038: Implement TemplateStore

**Purpose**: CRUD operations for pipeline templates and template instantiation into tenant-owned pipelines.

**Steps**:
1. Create `joyus-ai-mcp-server/src/pipelines/templates/store.ts`
2. Implement `TemplateStore` class:
   ```typescript
   export class TemplateStore {
     constructor(private db: DrizzleClient) {}

     async listTemplates(options?: { category?: string; activeOnly?: boolean }): Promise<PipelineTemplate[]>;
     async getTemplate(templateId: string): Promise<PipelineTemplate | null>;
     async createTemplate(input: CreateTemplateInput): Promise<PipelineTemplate>;
     async updateTemplate(templateId: string, input: Partial<CreateTemplateInput>): Promise<PipelineTemplate>;
     async deactivateTemplate(templateId: string): Promise<void>;

     /**
      * Instantiate a template into a tenant-owned pipeline.
      * Substitutes parameter placeholders with tenant-provided values.
      */
     async instantiate(
       templateId: string,
       tenantId: string,
       parameters: Record<string, unknown>,
       overrides?: Partial<CreatePipelineInput>,
     ): Promise<Pipeline>;
   }
   ```
3. **instantiate(templateId, tenantId, parameters, overrides)**:
   - Load the template
   - Validate that all required parameters are provided (check template.parameters schema)
   - Deep clone the template definition
   - Walk the cloned definition and substitute parameter placeholders:
     - Placeholders use format `{{parameterName}}` in string values
     - Iterate through all string values in the definition, replace placeholders
   - Create a new pipeline from the resolved definition:
     - Set `tenantId`, `templateId = template.id`
     - Apply any `overrides` (e.g., custom name, additional steps, different retry policy)
   - Also create pipeline_steps from the template's step definitions
   - Run cycle detection on the new pipeline before persisting (from WP03)
   - Return the created pipeline
4. **Key constraint**: Template updates do NOT propagate to existing instances (FR-012). Once instantiated, the pipeline is independent.

**Important implementation details**:
- Deep clone must handle nested objects and arrays (use `structuredClone` or JSON parse/stringify)
- Parameter validation must check: all required params present, types match schema (string, number, boolean, array)
- Templates are platform-level (not tenant-scoped). Any tenant can instantiate any active template.
- The `version` field on templates is incremented on each update (for audit trail).

**Files**:
- `joyus-ai-mcp-server/src/pipelines/templates/store.ts` (new, ~150 lines)

**Validation**:
- [ ] List/get/create/update/deactivate operations work correctly
- [ ] Instantiation deep-clones the definition
- [ ] Parameter placeholders are substituted correctly
- [ ] Required parameter validation rejects incomplete instantiations
- [ ] Cycle detection runs before persisting instantiated pipeline
- [ ] Template changes don't affect existing instances

---

## Subtask T039: Create Built-in Template Definitions

**Purpose**: Define 3 built-in pipeline templates that cover common workflows.

**Steps**:
1. Create `joyus-ai-mcp-server/src/pipelines/templates/definitions/corpus-update-to-profiles.json`
   - **Name**: "Corpus Update to Profile Regeneration"
   - **Category**: "content"
   - **Description**: "When corpus content changes, regenerate affected author profiles and run fidelity checks."
   - **Trigger**: corpus_change
   - **Steps**: source_query (find affected authors) -> profile_generation -> fidelity_check -> review_gate -> notification
   - **Parameters**: `profileIds` (required, string array), `fidelityThreshold` (optional, number, default 0.7), `notificationChannel` (optional, string)
   - **Assumptions**: ["Corpus-change events include affected author IDs", "Profile engine is available and configured"]
2. Create `joyus-ai-mcp-server/src/pipelines/templates/definitions/regulatory-change-monitor.json`
   - **Name**: "Regulatory Change Monitor"
   - **Category**: "compliance"
   - **Description**: "On a schedule, check configured sources for regulatory changes and flag content that may be affected."
   - **Trigger**: schedule_tick (default: weekly Monday 9am UTC)
   - **Steps**: source_query (check for changes) -> content_generation (produce change report) -> review_gate -> notification
   - **Parameters**: `sourceIds` (required, string array), `cronExpression` (optional, string, default '0 9 * * 1'), `timezone` (optional, string, default 'UTC'), `reportProfileId` (optional, string)
   - **Assumptions**: ["Content sources are connected and synced", "Regulatory data is available via source query"]
3. Create `joyus-ai-mcp-server/src/pipelines/templates/definitions/content-audit.json`
   - **Name**: "Content Audit"
   - **Category**: "brand"
   - **Description**: "Periodically audit generated content against current brand voice profiles for consistency drift."
   - **Trigger**: schedule_tick (default: first of month at midnight UTC)
   - **Steps**: source_query (get recent content) -> fidelity_check (score against profiles) -> notification (report results)
   - **Parameters**: `profileIds` (required, string array), `sourceIds` (required, string array), `driftThreshold` (optional, number, default 0.6), `cronExpression` (optional, string, default '0 0 1 * *')
   - **Assumptions**: ["Brand voice profiles are current and active", "Content has been generated within audit window"]
4. All templates use generic terminology per Constitution §2.10 (no client names, "Author A", "Example Corp")

**Files**:
- `joyus-ai-mcp-server/src/pipelines/templates/definitions/corpus-update-to-profiles.json` (new, ~50 lines)
- `joyus-ai-mcp-server/src/pipelines/templates/definitions/regulatory-change-monitor.json` (new, ~50 lines)
- `joyus-ai-mcp-server/src/pipelines/templates/definitions/content-audit.json` (new, ~50 lines)

**Validation**:
- [ ] All 3 templates are valid JSON
- [ ] Templates have all required fields: name, description, category, definition, parameters, assumptions
- [ ] Parameter schemas specify type, required, default, description for each parameter
- [ ] No client-specific names (Constitution §2.10)

---

## Subtask T040: Create Template Barrel Export

**Purpose**: Provide module exports and template loading utilities.

**Steps**:
1. Create `joyus-ai-mcp-server/src/pipelines/templates/index.ts`
2. Implement a function to seed built-in templates into the database:
   ```typescript
   export async function seedBuiltInTemplates(store: TemplateStore): Promise<void> {
     const templateFiles = [
       'corpus-update-to-profiles',
       'regulatory-change-monitor',
       'content-audit',
     ];
     for (const name of templateFiles) {
       const definition = await import(`./definitions/${name}.json`, { assert: { type: 'json' } });
       const existing = await store.getTemplate(definition.default.name);
       if (!existing) {
         await store.createTemplate(definition.default);
       }
     }
   }
   ```
   Alternative: use `fs.readFileSync` + `JSON.parse` if JSON imports are not supported in the project's TypeScript config.
3. Re-export:
   ```typescript
   export { TemplateStore } from './store.js';
   export { seedBuiltInTemplates } from './index.js'; // or inline above
   ```
4. Update `src/pipelines/index.ts` to export from templates module

**Files**:
- `joyus-ai-mcp-server/src/pipelines/templates/index.ts` (new, ~30 lines)
- `joyus-ai-mcp-server/src/pipelines/index.ts` (modify — add templates export)

**Validation**:
- [ ] Built-in templates can be loaded and seeded
- [ ] Seed is idempotent (doesn't duplicate existing templates)
- [ ] `npm run typecheck` passes

---

## Subtask T041: Unit Tests for Schedule Triggers and Templates

**Purpose**: Verify schedule trigger behavior and template lifecycle.

**Steps**:
1. Create `joyus-ai-mcp-server/tests/pipelines/triggers/schedule.test.ts`
2. Schedule trigger test cases:
   - **Register schedule**: Pipeline with cron expression, verify cron job is created
   - **Cron tick creates event**: Simulate cron tick, verify trigger_event created with type schedule_tick
   - **Overlap skip**: Previous execution running, policy skip_if_running, verify skip and warning log
   - **Overlap allow**: Previous execution running, policy allow_concurrent, verify new execution allowed
   - **Unregister schedule**: Remove pipeline, verify cron job stopped
   - **Update schedule**: Change cron expression, verify old job stopped and new job created
   - **Invalid cron expression**: Rejected at registration time
   - **Timezone support**: Valid timezone passed through to cron.schedule
   - **Next run time computation**: Verify getNextRunTime returns correct date
3. Create `joyus-ai-mcp-server/tests/pipelines/templates/store.test.ts`
4. Template test cases:
   - **Create template**: Valid template created with all fields
   - **List templates**: Multiple templates, filter by category and active status
   - **Instantiate template**: Template with parameters, all substituted correctly in output pipeline
   - **Missing required parameter**: Instantiation rejected with clear error
   - **Template independence**: Modify instantiated pipeline, verify template unchanged
   - **Template update no propagation**: Update template, verify existing instances unaffected
   - **Deep clone**: Nested objects in definition are truly cloned (modify clone, original unchanged)
   - **Cycle detection on instantiation**: Template that would create a cycle, instantiation rejected

**Files**:
- `joyus-ai-mcp-server/tests/pipelines/triggers/schedule.test.ts` (new, ~150 lines)
- `joyus-ai-mcp-server/tests/pipelines/templates/store.test.ts` (new, ~150 lines)

**Validation**:
- [ ] All tests pass via `npm run test`
- [ ] Schedule tests use fake timers (no real cron execution in tests)
- [ ] Template tests verify deep clone independence

---

## Definition of Done

- [ ] ScheduleTriggerHandler registers and manages cron jobs
- [ ] Overlap detection skips when previous execution is running (skip_if_running policy)
- [ ] Timezone support works correctly
- [ ] TemplateStore provides CRUD and instantiation
- [ ] 3 built-in templates defined and seedable
- [ ] Template instantiation deep-clones and substitutes parameters
- [ ] Template updates don't propagate to existing instances
- [ ] Cycle detection runs on template instantiation
- [ ] ScheduleTriggerHandler registered in trigger registry
- [ ] Unit tests cover all paths
- [ ] `npm run validate` passes with zero errors

## Risks

- **Cron expression validation**: `cron-parser` and `node-cron` may accept different cron syntax variations. Validate with `cron-parser` first (it's stricter), then pass to `node-cron`.
- **JSON import support**: TypeScript/Node.js JSON imports with `assert { type: 'json' }` may not be configured. Fallback: use `fs.readFileSync` + `JSON.parse`.
- **Template parameter substitution**: Walking a deep JSON structure and replacing `{{param}}` in all string values requires recursive traversal. Edge case: parameter value that itself contains `{{...}}` — do NOT double-substitute.

## Reviewer Guidance

- Verify cron-parser import uses default import for ESM: `import cronParser from 'cron-parser'`
- Check that overlap detection queries for ALL non-terminal execution statuses
- Verify timezone validation uses `Intl.DateTimeFormat` (or equivalent)
- Confirm template instantiation uses `structuredClone` or equivalent deep clone (not shallow spread)
- Check parameter substitution only replaces `{{paramName}}` patterns, not arbitrary strings
- Verify seed function is idempotent (checks for existing template by name before creating)
- Confirm no client names in template definitions (Constitution §2.10)
- Verify ScheduleTriggerHandler is added to the TriggerRegistry factory

## Activity Log
- 2026-03-16T19:00:21Z – unknown – shell_pid=58980 – lane=done – Schedule triggers, templates, 3 built-in defs, 30 tests.
