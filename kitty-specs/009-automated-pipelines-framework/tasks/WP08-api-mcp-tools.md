---
work_package_id: "WP08"
title: "Pipeline API & MCP Tools"
lane: "planned"
dependencies: ["WP05", "WP06", "WP07"]
subtasks: ["T042", "T043", "T044", "T045", "T046", "T047", "T048"]
history:
  - date: "2026-03-14"
    action: "created"
    agent: "claude-opus"
---

# WP08: Pipeline API & MCP Tools

**Implementation command**: `spec-kitty implement WP08 --base WP05,WP06,WP07`
**Target repo**: `joyus-ai`
**Dependencies**: WP05 (Step Handlers), WP06 (Review Gates), WP07 (Schedule Triggers & Templates)
**Priority**: P2 (Enables WP09 analytics and WP10 integration tests)

## Objective

Implement the Express REST API routes for full pipeline CRUD, execution history, review decisions, and template management. Define all 8 MCP tool definitions so Claude agents can manage pipelines conversationally. Wire the module into the server entry point. Enforce tenant scoping on every route and tool.

## Context

The `joyus-ai` platform uses Express.js with tenant-scoped middleware. All routes that handle tenant data must verify the requesting user belongs to the correct tenant. The existing pattern (from Spec 005 and Spec 006 routes) uses a `requireTenant` middleware that attaches `req.tenantId` from the authenticated session.

MCP tools follow the `ToolDefinition` interface already used by other Spec tools. They must use the existing registration pattern in `src/tools/` and be prefixed with `pipeline_` to namespace them correctly.

Cycle detection (WP03, T016) must run before persisting any pipeline create or update that changes `stepConfigs` or `triggerConfig`. The route handler calls `validateNoCycle` before the INSERT/UPDATE.

---

## Subtasks

### T042: Implement pipeline CRUD routes (`src/pipelines/routes.ts`)

**Purpose**: Express router covering create, list, get, update, delete, and manual trigger for pipelines. All routes are tenant-scoped.

**Steps**:
1. Create `src/pipelines/routes.ts`
2. Use `express.Router()` with `requireTenant` middleware applied to all routes
3. POST `/pipelines` — create pipeline (with cycle detection)
4. GET `/pipelines` — list pipelines for tenant
5. GET `/pipelines/:id` — get single pipeline
6. PATCH `/pipelines/:id` — update pipeline (with cycle detection if stepConfigs changed)
7. DELETE `/pipelines/:id` — delete pipeline (also removes schedule if applicable)
8. POST `/pipelines/:id/trigger` — manual trigger (fires a `manual` event via event bus)

```typescript
// src/pipelines/routes.ts
import { Router } from 'express';
import { eq, and } from 'drizzle-orm';
import { pipelines } from './schema';
import { createPipelineSchema, updatePipelineSchema, manualTriggerRequestSchema } from './validation';
import { validateNoCycle } from './graph/cycle-detector';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import type { EventBus } from './event-bus';
import type { ScheduleTriggerHandler } from './triggers/schedule';
import { TemplateStore } from './templates/store';

export function createPipelineRouter(
  db: NodePgDatabase<Record<string, unknown>>,
  eventBus: EventBus,
  scheduleHandler: ScheduleTriggerHandler,
): Router {
  const router = Router();

  // POST /pipelines — create pipeline
  router.post('/', async (req, res) => {
    const tenantId = req.tenantId;  // set by requireTenant middleware
    const parsed = createPipelineSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });

    const input = parsed.data;

    // Cycle detection before persist
    const existing = await db.select().from(pipelines).where(eq(pipelines.tenantId, tenantId));
    try {
      validateNoCycle(
        { id: 'new', triggerType: input.triggerConfig.type, stepConfigs: input.stepConfigs as any },
        existing as any,
      );
    } catch (err) {
      return res.status(422).json({ error: (err as Error).message });
    }

    const [pipeline] = await db
      .insert(pipelines)
      .values({
        tenantId,
        name: input.name,
        description: input.description,
        triggerType: input.triggerConfig.type as any,
        triggerConfig: input.triggerConfig,
        stepConfigs: input.stepConfigs,
        concurrencyPolicy: input.concurrencyPolicy as any,
        retryPolicy: input.retryPolicy ?? {},
        status: 'active',
      })
      .returning();

    // Register schedule if applicable
    if (pipeline.triggerType === 'schedule') {
      scheduleHandler.updateSchedule(pipeline as any, eventBus);
    }

    return res.status(201).json(pipeline);
  });

  // GET /pipelines — list
  router.get('/', async (req, res) => {
    const rows = await db
      .select()
      .from(pipelines)
      .where(eq(pipelines.tenantId, req.tenantId));
    return res.json(rows);
  });

  // GET /pipelines/:id — get one
  router.get('/:id', async (req, res) => {
    const rows = await db
      .select()
      .from(pipelines)
      .where(and(eq(pipelines.id, req.params.id), eq(pipelines.tenantId, req.tenantId)))
      .limit(1);
    if (rows.length === 0) return res.status(404).json({ error: 'Pipeline not found' });
    return res.json(rows[0]);
  });

  // PATCH /pipelines/:id — update
  router.patch('/:id', async (req, res) => {
    const parsed = updatePipelineSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });

    const existing = await db
      .select()
      .from(pipelines)
      .where(and(eq(pipelines.id, req.params.id), eq(pipelines.tenantId, req.tenantId)))
      .limit(1);
    if (existing.length === 0) return res.status(404).json({ error: 'Pipeline not found' });

    const input = parsed.data;

    // Re-run cycle detection only if triggerConfig or stepConfigs changed
    if (input.triggerConfig || input.stepConfigs) {
      const allPipelines = await db.select().from(pipelines).where(eq(pipelines.tenantId, req.tenantId));
      try {
        validateNoCycle(
          {
            id: req.params.id,
            triggerType: (input.triggerConfig?.type ?? existing[0].triggerType) as any,
            stepConfigs: (input.stepConfigs ?? existing[0].stepConfigs) as any,
          },
          allPipelines as any,
        );
      } catch (err) {
        return res.status(422).json({ error: (err as Error).message });
      }
    }

    const [updated] = await db
      .update(pipelines)
      .set({
        ...(input.name && { name: input.name }),
        ...(input.description !== undefined && { description: input.description }),
        ...(input.triggerConfig && { triggerConfig: input.triggerConfig, triggerType: input.triggerConfig.type as any }),
        ...(input.stepConfigs && { stepConfigs: input.stepConfigs }),
        ...(input.concurrencyPolicy && { concurrencyPolicy: input.concurrencyPolicy as any }),
        ...(input.status && { status: input.status as any }),
        updatedAt: new Date(),
      })
      .where(and(eq(pipelines.id, req.params.id), eq(pipelines.tenantId, req.tenantId)))
      .returning();

    // Update schedule registration
    if (updated.triggerType === 'schedule' || existing[0].triggerType === 'schedule') {
      scheduleHandler.updateSchedule(updated as any, eventBus);
    }

    return res.json(updated);
  });

  // DELETE /pipelines/:id
  router.delete('/:id', async (req, res) => {
    const rows = await db
      .select({ id: pipelines.id, triggerType: pipelines.triggerType })
      .from(pipelines)
      .where(and(eq(pipelines.id, req.params.id), eq(pipelines.tenantId, req.tenantId)))
      .limit(1);

    if (rows.length === 0) return res.status(404).json({ error: 'Pipeline not found' });

    if (rows[0].triggerType === 'schedule') {
      scheduleHandler.removeSchedule(req.params.id);
    }

    await db
      .delete(pipelines)
      .where(and(eq(pipelines.id, req.params.id), eq(pipelines.tenantId, req.tenantId)));

    return res.status(204).send();
  });

  // POST /pipelines/:id/trigger — manual trigger
  router.post('/:id/trigger', async (req, res) => {
    const parsed = manualTriggerRequestSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });

    const pipeline = await db.query.pipelines.findFirst({
      where: and(eq(pipelines.id, req.params.id), eq(pipelines.tenantId, req.tenantId)),
    });
    if (!pipeline) return res.status(404).json({ error: 'Pipeline not found' });
    if (pipeline.triggerType !== 'manual') {
      return res.status(400).json({ error: 'Pipeline does not support manual triggering' });
    }

    const eventId = await eventBus.publish(req.tenantId, 'manual', {
      pipelineId: pipeline.id,
      requestorRole: req.user?.role,
      ...parsed.data.payload,
    });

    return res.status(202).json({ eventId, message: 'Pipeline trigger queued' });
  });

  return router;
}
```

**Files**:
- `src/pipelines/routes.ts` (new, ~120 lines)

**Validation**:
- [ ] POST `/pipelines` with cycle returns 422 with descriptive error message
- [ ] POST `/pipelines` with valid input returns 201 with pipeline row
- [ ] GET `/pipelines` only returns pipelines for the authenticated tenant
- [ ] DELETE `/pipelines/:id` removes the schedule job if `triggerType === 'schedule'`
- [ ] POST `/pipelines/:id/trigger` on a non-manual pipeline returns 400
- [ ] `tsc --noEmit` passes

**Edge Cases**:
- `req.tenantId` and `req.user` are set by existing `requireTenant` middleware. If this middleware is not applied to the pipeline router when it is mounted in `src/index.ts` (T047), all tenant checks will fail. Verify the middleware chain during T047.

---

### T043: Implement execution history and review decision routes

**Purpose**: API endpoints for reading execution history, individual step details, and submitting review decisions.

**Steps**:
1. Add to `src/pipelines/routes.ts` (or create `src/pipelines/review-routes.ts` if preferred)
2. GET `/pipelines/:id/executions` — list executions for a pipeline (paginated)
3. GET `/executions/:executionId/steps` — list step executions
4. GET `/review-decisions/:decisionId` — get a pending review decision
5. POST `/review-decisions/:decisionId/decide` — submit a review decision

```typescript
// Addition to createPipelineRouter or separate router:

  // GET /pipelines/:id/executions
  router.get('/:id/executions', async (req, res) => {
    const limit = Math.min(Number(req.query.limit) || 20, 100);
    const offset = Number(req.query.offset) || 0;

    const rows = await db
      .select()
      .from(pipelineExecutions)
      .where(
        and(
          eq(pipelineExecutions.pipelineId, req.params.id),
          eq(pipelineExecutions.tenantId, req.tenantId),
        ),
      )
      .limit(limit)
      .offset(offset)
      .orderBy(desc(pipelineExecutions.createdAt));

    return res.json({ executions: rows, limit, offset });
  });

  // POST /review-decisions/:decisionId/decide
  router.post('/review-decisions/:decisionId/decide', async (req, res) => {
    const parsed = reviewDecisionSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });

    try {
      await decisionService.recordDecision(
        req.params.decisionId,
        req.user!.id,
        parsed.data,
        executor,  // PipelineExecutor reference injected into router factory
      );
      return res.json({ message: 'Decision recorded. Execution resuming.' });
    } catch (err) {
      if ((err as Error).message.includes('already been decided')) {
        return res.status(409).json({ error: (err as Error).message });
      }
      throw err;
    }
  });
```

**Files**:
- `src/pipelines/routes.ts` (modified — add execution and review routes)

**Validation**:
- [ ] GET `/pipelines/:id/executions` respects tenant scoping on `pipelineExecutions.tenantId`
- [ ] POST `/review-decisions/:decisionId/decide` returns 409 on double-decide
- [ ] `tsc --noEmit` passes

---

### T044: Implement MCP tool definitions (`src/tools/pipeline-tools.ts`)

**Purpose**: Define all 8 pipeline MCP tools so Claude agents can manage pipelines conversationally through the MCP gateway.

**Steps**:
1. Create `src/tools/pipeline-tools.ts`
2. Define tools following the existing `ToolDefinition` interface pattern
3. Each tool maps to an underlying service call (not a direct HTTP route call)

**8 MCP tools**:
1. `pipeline_list` — list pipelines for the authenticated tenant
2. `pipeline_get` — get a single pipeline by ID
3. `pipeline_create` — create a new pipeline (runs cycle detection)
4. `pipeline_update` — update pipeline config or status
5. `pipeline_delete` — delete a pipeline
6. `pipeline_trigger` — manually trigger a pipeline
7. `pipeline_execution_history` — get execution history for a pipeline
8. `pipeline_analytics` — get aggregate metrics for a pipeline (calls WP09)

```typescript
// src/tools/pipeline-tools.ts
import { z } from 'zod';
import type { ToolDefinition } from './types';  // existing interface
import { createPipelineSchema, updatePipelineSchema, reviewDecisionSchema } from '../pipelines/validation';

export const pipelineTools: ToolDefinition[] = [
  {
    name: 'pipeline_list',
    description: 'List all pipelines for the current tenant. Returns pipeline IDs, names, statuses, and trigger types.',
    inputSchema: z.object({
      status: z.enum(['active', 'paused', 'archived']).optional()
        .describe('Filter by status. Omit to return all.'),
    }),
    async execute({ input, context }) {
      // context.tenantId is injected by the MCP gateway
      return context.services.pipelineService.list(context.tenantId, input.status);
    },
  },
  {
    name: 'pipeline_get',
    description: 'Get details for a specific pipeline including its trigger config and step configs.',
    inputSchema: z.object({
      pipelineId: z.string().uuid().describe('The pipeline UUID'),
    }),
    async execute({ input, context }) {
      return context.services.pipelineService.get(context.tenantId, input.pipelineId);
    },
  },
  {
    name: 'pipeline_create',
    description: 'Create a new pipeline. Validates for circular dependencies before persisting.',
    inputSchema: createPipelineSchema,
    async execute({ input, context }) {
      return context.services.pipelineService.create(context.tenantId, input);
    },
  },
  {
    name: 'pipeline_update',
    description: 'Update a pipeline\'s name, description, trigger config, step configs, or status.',
    inputSchema: updatePipelineSchema.extend({
      pipelineId: z.string().uuid(),
    }),
    async execute({ input, context }) {
      const { pipelineId, ...updates } = input;
      return context.services.pipelineService.update(context.tenantId, pipelineId, updates);
    },
  },
  {
    name: 'pipeline_delete',
    description: 'Delete a pipeline and cancel all pending executions.',
    inputSchema: z.object({
      pipelineId: z.string().uuid(),
    }),
    async execute({ input, context }) {
      await context.services.pipelineService.delete(context.tenantId, input.pipelineId);
      return { deleted: true };
    },
  },
  {
    name: 'pipeline_trigger',
    description: 'Manually trigger a pipeline that has a manual trigger type.',
    inputSchema: z.object({
      pipelineId: z.string().uuid(),
      payload: z.record(z.unknown()).optional()
        .describe('Optional payload passed to the pipeline execution'),
    }),
    async execute({ input, context }) {
      return context.services.pipelineService.manualTrigger(context.tenantId, input.pipelineId, input.payload);
    },
  },
  {
    name: 'pipeline_execution_history',
    description: 'Get execution history for a pipeline with step-level detail.',
    inputSchema: z.object({
      pipelineId: z.string().uuid(),
      limit: z.number().int().min(1).max(50).default(10),
    }),
    async execute({ input, context }) {
      return context.services.pipelineService.getExecutionHistory(context.tenantId, input.pipelineId, input.limit);
    },
  },
  {
    name: 'pipeline_analytics',
    description: 'Get aggregate performance metrics for a pipeline: success rate, avg duration, p95 duration, rejection rate.',
    inputSchema: z.object({
      pipelineId: z.string().uuid(),
    }),
    async execute({ input, context }) {
      return context.services.analyticsService.getMetrics(context.tenantId, input.pipelineId);
    },
  },
];
```

**Files**:
- `src/tools/pipeline-tools.ts` (new, ~80 lines)

**Validation**:
- [ ] All 8 tools have unique `name` values prefixed with `pipeline_`
- [ ] All `inputSchema` use Zod (matching existing tool pattern)
- [ ] `pipeline_create` schema re-uses `createPipelineSchema` from `validation.ts` — no duplication
- [ ] `tsc --noEmit` passes

**Edge Cases**:
- The `execute` function uses `context.services.pipelineService` — this requires a `PipelineService` facade to be wired in the MCP gateway context. Create a thin `PipelineService` class in `src/pipelines/service.ts` that wraps the DB operations and event bus calls. This avoids direct DB access in tool definitions.

---

### T045: Enforce tenant scoping on all routes and tools

**Purpose**: Audit and verify that every route and MCP tool enforces tenant isolation. No route should return data from another tenant.

**Steps**:
1. Verify all `db.select().from(pipelines)` queries include `.where(eq(pipelines.tenantId, tenantId))`
2. Verify the review decision routes check `reviewDecisions.tenantId` before processing
3. Verify MCP tools receive `context.tenantId` from the gateway (not from request body)
4. Add a middleware-level check in `createPipelineRouter` that rejects requests without `req.tenantId`

```typescript
// Add to createPipelineRouter before other routes:
router.use((req, res, next) => {
  if (!req.tenantId) {
    return res.status(401).json({ error: 'Authentication required' });
  }
  next();
});
```

**Files**:
- `src/pipelines/routes.ts` (modified — add router-level tenant check)

**Validation**:
- [ ] Request without `req.tenantId` returns 401 on all pipeline routes
- [ ] All DB queries in `routes.ts` include `tenantId` in the WHERE clause
- [ ] MCP tools use `context.tenantId` exclusively (not from `input`)

**Edge Cases**:
- `pipeline_trigger` MCP tool allows passing a `payload` but not a `tenantId`. The tenant ID must come from `context.tenantId` only — never trust tenant ID from untrusted input.

---

### T046: Create module entry point (`src/pipelines/index.ts`) — initialization and server wiring

**Purpose**: Define the `initializePipelines(app, db, options)` function that bootstraps the entire pipeline module — starts the executor, seeds templates, starts the escalation cron, and returns references needed by the router.

**Steps**:
1. Update `src/pipelines/index.ts` (created in WP01 as a stub)
2. Export `initializePipelines` async factory function
3. On call: create event bus, trigger registry, step handler registry, executor, review services, template store
4. Seed built-in templates
5. Start executor and escalation cron
6. Return `{ router, executor, eventBus, scheduleHandler }` for mounting in `src/index.ts`

```typescript
// src/pipelines/index.ts (replaces WP01 stub)
export * from './schema';
export * from './types';
export * from './validation';
export * from './event-bus';
export * from './engine';
export * from './steps';
export * from './review';
export * from './templates';

import type { Express } from 'express';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { PgNotifyBus, createEventBus } from './event-bus';
import { defaultTriggerRegistry } from './triggers/registry';
import { ScheduleTriggerHandler } from './triggers/schedule';
import { createDefaultStepHandlerRegistry } from './steps/registry';
import { PipelineExecutor } from './engine/executor';
import { startEscalationCron } from './review';
import { seedBuiltInTemplates } from './templates/definitions';
import { createPipelineRouter } from './routes';
import type { StepHandlerDependencies } from './steps/registry';

export interface PipelinesInitOptions {
  connectionString: string;
  stepHandlerDeps?: StepHandlerDependencies;
  pollIntervalMs?: number;
  escalationIntervalMs?: number;
}

export async function initializePipelines(
  db: NodePgDatabase<Record<string, unknown>>,
  options: PipelinesInitOptions,
) {
  // Seed built-in templates
  await seedBuiltInTemplates(db);

  // Create event bus
  const eventBus = createEventBus(db, options.connectionString);
  if (eventBus instanceof PgNotifyBus) {
    await (eventBus as PgNotifyBus).start();
  }

  // Create registries
  const scheduleHandler = new ScheduleTriggerHandler();
  defaultTriggerRegistry.register(scheduleHandler);
  const stepHandlerRegistry = createDefaultStepHandlerRegistry(options.stepHandlerDeps);

  // Create and start executor
  const executor = new PipelineExecutor(db, eventBus, defaultTriggerRegistry, stepHandlerRegistry, {
    pollIntervalMs: options.pollIntervalMs,
  });
  await executor.start();

  // Start escalation cron
  const escalationTimer = startEscalationCron(db, undefined, options.escalationIntervalMs);

  // Create router
  const router = createPipelineRouter(db, eventBus, scheduleHandler);

  return { router, executor, eventBus, escalationTimer };
}
```

**Files**:
- `src/pipelines/index.ts` (modified — replaces WP01 stub, adds `initializePipelines`)

**Validation**:
- [ ] `initializePipelines` is an async function (can be `await`ed in `src/index.ts`)
- [ ] Returns `{ router, executor, eventBus, escalationTimer }` — all needed for graceful shutdown
- [ ] `tsc --noEmit` passes

---

### T047: Mount pipeline routes and register tools in `src/index.ts`

**Purpose**: Wire the pipeline module into the main Express server and MCP tool registry.

**Steps**:
1. Open `src/index.ts` (existing file)
2. Call `initializePipelines(db, { connectionString: process.env.DATABASE_URL })` during startup
3. Mount the returned router: `app.use('/pipelines', requireTenant, router)`
4. Register `pipelineTools` with the existing tool registry

```typescript
// src/index.ts — additions to existing startup sequence:
import { initializePipelines } from './pipelines';
import { pipelineTools } from './tools/pipeline-tools';
import { requireTenant } from './middleware/auth';  // existing middleware

// In startup async function:
const { router: pipelineRouter, executor, escalationTimer } = await initializePipelines(db, {
  connectionString: process.env.DATABASE_URL!,
});

app.use('/pipelines', requireTenant, pipelineRouter);

// Register MCP tools
for (const tool of pipelineTools) {
  toolRegistry.register(tool);
}

// Graceful shutdown
process.on('SIGTERM', async () => {
  await executor.stop();
  clearInterval(escalationTimer);
  // ... existing shutdown logic
});
```

**Files**:
- `src/index.ts` (modified — add pipeline initialization, route mounting, tool registration)

**Validation**:
- [ ] `npm run typecheck` passes on modified `src/index.ts`
- [ ] Server starts without errors: `npm run dev`
- [ ] `GET /pipelines` returns 401 without auth, 200 (empty array) with valid auth

**Edge Cases**:
- `requireTenant` middleware must be applied to the pipeline router mount, not inside the router itself (the router has its own fallback check from T045, but the middleware is the primary enforcement layer).

---

### T048: Unit tests for routes and tools

**Purpose**: Verify route input validation, tenant scoping enforcement, and MCP tool schema correctness.

**Steps**:
1. Create `tests/pipelines/routes.test.ts` — test input validation and 401/404 responses
2. Create `tests/pipelines/tools.test.ts` — test MCP tool input schema parsing

```typescript
// tests/pipelines/routes.test.ts (validation-only, no DB required)
import { describe, it, expect } from 'vitest';
import { createPipelineSchema } from '../../src/pipelines/validation';

describe('createPipelineSchema', () => {
  it('rejects empty stepConfigs', () => {
    const result = createPipelineSchema.safeParse({
      name: 'My Pipeline',
      triggerConfig: { type: 'manual' },
      stepConfigs: [],
    });
    expect(result.success).toBe(false);
  });

  it('rejects invalid triggerConfig type', () => {
    const result = createPipelineSchema.safeParse({
      name: 'My Pipeline',
      triggerConfig: { type: 'unknown_type' },
      stepConfigs: [{ stepType: 'notification', name: 'n', config: {}, requiresReview: false }],
    });
    expect(result.success).toBe(false);
  });

  it('accepts a valid manual pipeline', () => {
    const result = createPipelineSchema.safeParse({
      name: 'My Pipeline',
      triggerConfig: { type: 'manual' },
      stepConfigs: [{ stepType: 'notification', name: 'Alert', config: { channel: 'slack', recipient: '#general', message: 'Done' }, requiresReview: false }],
    });
    expect(result.success).toBe(true);
  });
});

// tests/pipelines/tools.test.ts
import { describe, it, expect } from 'vitest';
import { pipelineTools } from '../../src/tools/pipeline-tools';

describe('pipelineTools', () => {
  it('has exactly 8 tools', () => {
    expect(pipelineTools).toHaveLength(8);
  });

  it('all tool names are unique and prefixed with pipeline_', () => {
    const names = pipelineTools.map((t) => t.name);
    expect(new Set(names).size).toBe(names.length);
    expect(names.every((n) => n.startsWith('pipeline_'))).toBe(true);
  });

  it('pipeline_create tool accepts valid createPipeline input', () => {
    const tool = pipelineTools.find((t) => t.name === 'pipeline_create')!;
    const result = tool.inputSchema.safeParse({
      name: 'Test',
      triggerConfig: { type: 'manual' },
      stepConfigs: [{ stepType: 'notification', name: 'n', config: {}, requiresReview: false }],
    });
    expect(result.success).toBe(true);
  });
});
```

**Files**:
- `tests/pipelines/routes.test.ts` (new, ~40 lines)
- `tests/pipelines/tools.test.ts` (new, ~30 lines)

**Validation**:
- [ ] `npm test tests/pipelines/routes.test.ts` exits 0
- [ ] `npm test tests/pipelines/tools.test.ts` exits 0
- [ ] 8 tools verified, all uniquely named with `pipeline_` prefix

---

## Definition of Done

- [ ] `src/pipelines/routes.ts` — CRUD + execution history + review decision routes, tenant scoping
- [ ] `src/tools/pipeline-tools.ts` — 8 MCP tools with Zod input schemas
- [ ] `src/pipelines/index.ts` — `initializePipelines` factory
- [ ] `src/index.ts` — pipeline module mounted, tools registered
- [ ] Tests passing: schema validation, tool count/naming
- [ ] `npm run typecheck` exits 0
- [ ] `npm test` exits 0 with no regressions
- [ ] Server starts without errors after modification

## Risks

- **Circular import via index.ts**: `src/pipelines/index.ts` imports from every sub-module. If any sub-module imports from `src/pipelines/index.ts`, a circular import cycle will form. Sub-modules must import from their direct dependencies, not from the barrel.
- **requireTenant middleware coupling**: This WP assumes `requireTenant` middleware exists and sets `req.tenantId`. If the middleware API differs (e.g., uses `req.auth.tenantId`), all tenant scope checks must be updated. Read the existing middleware before implementing.
- **Tool context shape**: `context.services.pipelineService` assumes a `PipelineService` facade exists in the MCP tool context. If the existing tools use a different context shape (e.g., direct `context.db`), the tool definitions must be adapted to match.

## Reviewer Guidance

- Verify every DB query in `routes.ts` includes `eq(table.tenantId, req.tenantId)` — cross-tenant data leakage is a security bug, not just a functional bug.
- Check that `pipeline_trigger` in the MCP tools passes `context.tenantId` to the underlying service, not anything from `input` — tenant ID must always come from the authenticated session.
- Confirm `initializePipelines` is `await`ed before `app.listen()` in `src/index.ts` — the executor must be running and templates seeded before the server accepts requests.
