---
work_package_id: WP08
title: Pipeline API & MCP Tools
lane: planned
dependencies: []
subtasks: [T042, T043, T044, T045, T046, T047, T048]
phase: Phase E - API & Tools
assignee: ''
agent: ''
shell_pid: ''
review_status: ''
reviewed_by: ''
history:
- timestamp: '2026-03-10T00:00:00Z'
  lane: planned
  agent: system
  action: Prompt generated via /spec-kitty.tasks
---

# WP08: Pipeline API & MCP Tools

## Objective

Implement the Express REST API routes for pipeline management, the MCP tool definitions for agent-facing pipeline operations, tenant-scoped route enforcement, the module initialization entry point, and server-level wiring.

## Implementation Command

```bash
spec-kitty implement WP08 --base WP05 --base WP06 --base WP07
```

## Context

- **Spec**: `kitty-specs/009-automated-pipelines-framework/spec.md` (all FRs surface through API/tools)
- **Plan**: `kitty-specs/009-automated-pipelines-framework/plan.md` (WP-16: API, WP-17: MCP tools)
- **Existing patterns**: `src/tools/content-tools.ts` (MCP tool registration), `src/content/routes.ts` (Express route pattern — if exists), `src/tools/index.ts` and `src/tools/executor.ts` (tool registration)

This WP is the external surface of the pipeline framework — everything built in WP01-WP07 is exposed through REST routes and MCP tools here. Routes handle HTTP requests from the mediation API and admin interfaces. MCP tools handle agent requests from Claude sessions.

**Existing tool registration pattern** (from `src/tools/index.ts` and `src/tools/executor.ts`):
- Tools are defined as `ToolDefinition` objects with name, description, inputSchema (Zod), and handler
- Tools are registered in a tool index and dispatched by the executor
- Tool names use underscore-separated prefixes (e.g., `content_search`, `content_generate`)
- Pipeline tools should use prefix `pipeline_`

---

## Subtask T042: Implement Pipeline CRUD Routes

**Purpose**: Express routes for creating, listing, reading, updating, and deleting pipelines, plus manual trigger.

**Steps**:
1. Create `joyus-ai-mcp-server/src/pipelines/routes.ts`
2. Implement an Express Router with the following endpoints:
3. **POST /api/pipelines** — Create pipeline:
   - Validate request body with `CreatePipelineInput` Zod schema (WP01 T003)
   - Extract tenantId from request context (auth middleware provides it)
   - Check tenant pipeline limit (MAX_PIPELINES_PER_TENANT = 20)
   - Run cycle detection (WP03) before persisting
   - Validate step configs via step registry (WP05)
   - Create pipeline and pipeline_steps rows
   - If triggerType is schedule_tick, register cron job (WP07)
   - Return 201 with created pipeline
4. **GET /api/pipelines** — List pipelines:
   - Query params: `status` (optional filter), `limit` (default 20), `offset` (default 0)
   - Filter by tenantId (always enforced)
   - Return paginated pipeline list with step counts
5. **GET /api/pipelines/:id** — Get pipeline:
   - Load pipeline by ID, verify tenantId
   - Include steps, recent execution count, next scheduled run (if applicable)
   - Return 404 if not found or wrong tenant
6. **PUT /api/pipelines/:id** — Update pipeline:
   - Validate with `UpdatePipelineInput`
   - Verify tenant ownership
   - Re-run cycle detection if trigger type or steps changed
   - Update schedule if cron expression changed
   - Return updated pipeline
7. **DELETE /api/pipelines/:id** — Delete pipeline:
   - Verify tenant ownership
   - Unregister cron job if scheduled
   - Soft-delete or hard-delete pipeline (cascade to steps, executions — per platform policy)
   - Return 204
8. **POST /api/pipelines/:id/trigger** — Manual trigger:
   - Verify tenant ownership and pipeline is active
   - Create trigger event via ManualRequestTriggerHandler
   - Publish event to event bus
   - Return 202 with trigger event ID

**Important implementation details**:
- All routes extract `tenantId` from the authenticated request context. This is the Leash pattern (ADR-0002) — every query includes tenantId.
- The router does NOT define its own auth middleware — it relies on the existing auth middleware applied at the server level.
- Error responses should follow the existing pattern: `{ error: string, details?: unknown }` with appropriate HTTP status codes.

**Files**:
- `joyus-ai-mcp-server/src/pipelines/routes.ts` (new, ~250 lines)

**Validation**:
- [ ] All CRUD operations work correctly
- [ ] Tenant isolation enforced on every route
- [ ] Pipeline creation runs cycle detection
- [ ] Pipeline creation validates step configs
- [ ] Pipeline creation enforces per-tenant limit
- [ ] Manual trigger publishes event to event bus
- [ ] Schedule registration/unregistration on create/update/delete

---

## Subtask T043: Implement Execution History and Review Decision Routes

**Purpose**: Routes for querying execution history and submitting review decisions.

**Steps**:
1. In `routes.ts`, add execution endpoints:
2. **GET /api/pipelines/:id/executions** — Execution history:
   - Query params: `status` (optional filter), `limit` (default 20, max 100), `offset`
   - Filter by pipelineId AND tenantId
   - Return paginated execution list with step summaries
   - Support date range filtering: `since` and `until` query params (ISO date strings)
3. **GET /api/executions/:id** — Get execution detail:
   - Load execution by ID, verify tenantId
   - Include all execution_steps with status, attempts, timing
   - Include review_decisions if any
   - Return 404 if not found or wrong tenant
4. **POST /api/executions/:id/cancel** — Cancel execution:
   - Verify tenant ownership
   - Only cancellable if status IN ('pending', 'paused_at_gate', 'paused_on_failure')
   - Update status to 'cancelled'
   - Return updated execution
5. **POST /api/review-decisions/:id/decide** — Submit review decision:
   - Validate with `ReviewDecisionInput` Zod schema
   - Extract tenantId from request context
   - Delegate to DecisionRecorder (WP06)
   - Return updated decision with resumption status
6. **GET /api/pipelines/:id/review-decisions** — List pending review decisions:
   - Filter by pipelineId AND tenantId AND status = 'pending'
   - Include artifact references and execution context
   - Return paginated list

**Files**:
- `joyus-ai-mcp-server/src/pipelines/routes.ts` (extend from T042, ~150 additional lines)

**Validation**:
- [ ] Execution history is paginated and filterable
- [ ] Execution detail includes step-level data
- [ ] Cancel only works on cancellable statuses
- [ ] Review decision delegates to DecisionRecorder
- [ ] All routes enforce tenant isolation

---

## Subtask T044: Implement MCP Tool Definitions

**Purpose**: Define MCP tools for pipeline operations accessible by Claude agents.

**Steps**:
1. Create `joyus-ai-mcp-server/src/tools/pipeline-tools.ts`
2. Define 8 MCP tools following the existing pattern in `src/tools/content-tools.ts`:
3. **pipeline_create**: Create a new pipeline
   - Input: name, description, triggerType, triggerConfig, steps[], retryPolicy, concurrencyPolicy
   - Handler: validates, checks cycle, creates pipeline
4. **pipeline_list**: List pipelines for the tenant
   - Input: optional status filter, limit, offset
   - Handler: queries with tenant filter
5. **pipeline_trigger**: Manually trigger a pipeline
   - Input: pipelineId, optional payload
   - Handler: creates trigger event, publishes to event bus
6. **pipeline_status**: Get pipeline status and current execution state
   - Input: pipelineId
   - Handler: loads pipeline + latest execution + next scheduled run
7. **pipeline_history**: Get execution history for a pipeline
   - Input: pipelineId, optional status filter, limit, offset
   - Handler: queries executions with tenant filter
8. **review_decide**: Submit a review decision
   - Input: decisionId, status (approved/rejected), optional feedback
   - Handler: delegates to DecisionRecorder
9. **template_list**: List available pipeline templates
   - Input: optional category filter
   - Handler: queries templates
10. **template_instantiate**: Create a pipeline from a template
    - Input: templateId, parameters object, optional name override
    - Handler: delegates to TemplateStore.instantiate
11. All tools include:
    - `name` (string, pipeline_ or template_ prefix)
    - `description` (clear, human-readable)
    - `inputSchema` (Zod schema matching the tool's input)
    - `handler` (async function taking validated input + context, returning result)

**Important implementation details**:
- Follow the exact registration pattern from `src/tools/content-tools.ts`
- Every tool handler must extract tenantId from the tool execution context
- Tool results should be structured for Claude readability: clear success/error messages, relevant data in the output
- The pipeline_create tool should also validate step configs at creation time

**Files**:
- `joyus-ai-mcp-server/src/tools/pipeline-tools.ts` (new, ~300 lines)

**Validation**:
- [ ] All 8 tools defined with correct names, descriptions, schemas
- [ ] All tools enforce tenant isolation via context
- [ ] Tool handlers delegate to the correct pipeline module functions
- [ ] `npm run typecheck` passes

---

## Subtask T045: Enforce Tenant Scoping on All Routes and Tools

**Purpose**: Verify that every route and tool enforces tenant isolation per the Leash pattern (ADR-0002).

**Steps**:
1. Audit every route handler in `routes.ts`:
   - Every database query MUST include `tenantId` in the WHERE clause
   - Every mutation MUST verify the target resource belongs to the requesting tenant
   - Cross-tenant access attempts must return 404 (not 403, to prevent tenant enumeration)
2. Audit every tool handler in `pipeline-tools.ts`:
   - Every tool must extract tenantId from the execution context
   - Every database operation must be scoped to that tenant
3. Add a helper function for common tenant checks:
   ```typescript
   async function verifyTenantOwnership(
     db: DrizzleClient,
     resourceType: 'pipeline' | 'execution' | 'decision',
     resourceId: string,
     tenantId: string,
   ): Promise<boolean>;
   ```
4. If any route or tool is missing tenant scoping, fix it

**Files**:
- `joyus-ai-mcp-server/src/pipelines/routes.ts` (verify/fix)
- `joyus-ai-mcp-server/src/tools/pipeline-tools.ts` (verify/fix)

**Validation**:
- [ ] Every route includes tenantId in queries
- [ ] Every tool extracts tenantId from context
- [ ] Cross-tenant access returns 404
- [ ] No data leakage paths exist

---

## Subtask T046: Create Module Entry Point

**Purpose**: Create the initialization function that wires all pipeline module components together.

**Steps**:
1. Update `joyus-ai-mcp-server/src/pipelines/index.ts` to export an initialization function:
   ```typescript
   export interface PipelineModuleConfig {
     db: DrizzleClient;
     pool: Pool;
     stepHandlerDeps: StepHandlerDependencies;
     pollIntervalMs?: number;
   }

   export async function initializePipelineModule(config: PipelineModuleConfig): Promise<PipelineModule> {
     // 1. Create event bus
     const eventBus = createEventBus(config.pool, { pollIntervalMs: config.pollIntervalMs });

     // 2. Create step registry
     const stepRegistry = createStepRegistry(config.stepHandlerDeps);

     // 3. Create trigger registry
     const triggerRegistry = createTriggerRegistry(config.db);

     // 4. Create step runner
     const stepRunner = new StepRunner(config.db, stepRegistry);

     // 5. Create executor
     const executor = new PipelineExecutor(config.db, eventBus, triggerRegistry, stepRunner);

     // 6. Create review components
     const reviewGate = new ReviewGate(config.db);
     const decisionRecorder = new DecisionRecorder(config.db);
     const escalationChecker = new EscalationChecker(config.db);

     // 7. Create template store
     const templateStore = new TemplateStore(config.db);

     // 8. Create schedule handler and register it
     const scheduleHandler = new ScheduleTriggerHandler(config.db, eventBus);
     triggerRegistry.register(scheduleHandler);

     // 9. Seed built-in templates
     await seedBuiltInTemplates(templateStore);

     // 10. Load scheduled pipelines
     await scheduleHandler.loadAllSchedules();

     // 11. Start escalation cron job
     startEscalationJob(escalationChecker);

     // 12. Start executor (begins processing events)
     await executor.start();

     return {
       executor,
       eventBus,
       triggerRegistry,
       stepRegistry,
       reviewGate,
       decisionRecorder,
       templateStore,
       scheduleHandler,
       async shutdown() {
         await executor.stop();
         scheduleHandler.stopAll();
         stopEscalationJob();
       },
     };
   }
   ```
2. Define `PipelineModule` interface with all component references and shutdown method
3. Create the Express router factory:
   ```typescript
   export function createPipelineRouter(module: PipelineModule): Router;
   ```

**Files**:
- `joyus-ai-mcp-server/src/pipelines/index.ts` (rewrite — becomes the module entry point, ~100 lines)

**Validation**:
- [ ] All components are wired together correctly
- [ ] Initialization order is correct (dependencies before dependents)
- [ ] Shutdown cleans up all resources
- [ ] `npm run typecheck` passes

---

## Subtask T047: Mount Pipeline Routes and Register Tools in Server

**Purpose**: Wire the pipeline module into the existing Express server and tool system.

**Steps**:
1. Edit `joyus-ai-mcp-server/src/index.ts`:
   - Import `initializePipelineModule` and `createPipelineRouter`
   - After existing initialization (content module, scheduler, etc.):
     ```typescript
     const pipelineModule = await initializePipelineModule({
       db,
       pool,
       stepHandlerDeps: {
         db,
         // Platform service clients — wire real implementations when available
         // For now, leave optional deps as undefined (handlers will return non-transient errors)
       },
     });
     const pipelineRouter = createPipelineRouter(pipelineModule);
     app.use('/api', pipelineRouter);
     ```
   - On shutdown: call `pipelineModule.shutdown()`
2. Register MCP tools:
   - Import pipeline tools from `src/tools/pipeline-tools.ts`
   - Register them in `src/tools/index.ts` (add to the tool definitions array)
   - Verify the executor dispatches pipeline_ prefixed tools correctly
3. Verify existing routes and tools still work (no conflicts)

**Important implementation details**:
- The pipeline routes are mounted under `/api` alongside existing routes. Ensure no route path conflicts.
- The MCP tools registration must follow the existing pattern exactly — check how content tools are registered.
- Step handler dependencies for platform services (profile engine, content intelligence) should be wired to real implementations when those features are available. For now, they can be undefined.

**Files**:
- `joyus-ai-mcp-server/src/index.ts` (modify — add pipeline initialization and route mount)
- `joyus-ai-mcp-server/src/tools/index.ts` (modify — register pipeline tools)

**Validation**:
- [ ] Pipeline routes accessible at `/api/pipelines/*`
- [ ] MCP tools registered and callable
- [ ] Existing routes and tools unaffected
- [ ] Server startup succeeds with pipeline module
- [ ] Server shutdown cleans up pipeline resources
- [ ] `npm run typecheck` passes

---

## Subtask T048: Unit Tests for Routes and Tools

**Purpose**: Verify route handlers and MCP tools work correctly.

**Steps**:
1. Create `joyus-ai-mcp-server/tests/pipelines/routes.test.ts` (or split by concern)
2. Route test cases:
   - **POST /api/pipelines**: Valid input creates pipeline, returns 201
   - **POST /api/pipelines**: Invalid input returns 400 with validation errors
   - **POST /api/pipelines**: Exceeds tenant limit returns 409
   - **POST /api/pipelines**: Cycle detected returns 409 with cycle path
   - **GET /api/pipelines**: Returns tenant's pipelines (not other tenants')
   - **GET /api/pipelines/:id**: Returns 404 for other tenant's pipeline
   - **POST /api/pipelines/:id/trigger**: Creates trigger event, returns 202
   - **POST /api/review-decisions/:id/decide**: Records decision, returns updated status
   - **GET /api/pipelines/:id/executions**: Returns paginated history with tenant filter
3. Tool test cases (can be inline or in a separate file):
   - **pipeline_create**: Valid input creates pipeline via tool
   - **pipeline_list**: Returns tenant-scoped results
   - **pipeline_trigger**: Publishes event
   - **review_decide**: Delegates to DecisionRecorder
   - **template_list**: Returns active templates
   - **template_instantiate**: Creates pipeline from template
4. Use Vitest + supertest (or direct handler invocation) for route tests

**Files**:
- `joyus-ai-mcp-server/tests/pipelines/routes.test.ts` (new, ~250 lines)

**Validation**:
- [ ] All tests pass via `npm run test`
- [ ] Tests verify tenant isolation on every route
- [ ] Tests cover success and error paths

---

## Definition of Done

- [ ] Express routes for full pipeline lifecycle (CRUD, trigger, history, review, cancel)
- [ ] 8 MCP tools registered and functional
- [ ] Tenant isolation enforced on ALL routes and tools (Leash pattern)
- [ ] Module initialization wires all components correctly
- [ ] Pipeline routes mounted in server, tools registered
- [ ] Pipeline creation validates: Zod schema, step configs, cycle detection, tenant limit
- [ ] Unit tests cover routes and tools
- [ ] `npm run validate` passes with zero errors

## Risks

- **Tool registration pattern**: Must exactly match the existing pattern. Inspect `content-tools.ts` and `tools/index.ts` carefully before implementing.
- **Route path conflicts**: Pipeline routes under `/api` must not conflict with existing content routes. Verify existing route paths.
- **Module initialization order**: The pipeline module depends on db, pool, and optional platform services. If initialization runs before the database is ready, it will fail.

## Reviewer Guidance

- Verify EVERY route and tool includes tenantId in queries (Leash pattern audit)
- Check that cross-tenant access returns 404 (not 403) to prevent enumeration
- Verify pipeline creation runs: Zod validation -> step config validation -> cycle detection -> tenant limit check -> persist
- Check that tool names follow the `pipeline_` and `template_` prefix convention
- Verify module initialization creates all components in correct dependency order
- Confirm server mount does not break existing routes or tools
- Check that shutdown() cleans up: executor, event bus, cron jobs, schedule handler

## Activity Log
