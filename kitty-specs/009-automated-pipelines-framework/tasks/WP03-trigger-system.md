---
work_package_id: WP03
title: Trigger System
lane: planned
dependencies: []
subtasks: [T012, T013, T014, T015, T016, T017]
phase: Phase B - Event & Trigger Layer
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

# WP03: Trigger System

## Objective

Build the trigger handling subsystem and circular dependency detection. Trigger handlers evaluate incoming events and match them to pipeline definitions. The cycle detector prevents pipeline configurations that would create infinite trigger loops.

## Implementation Command

```bash
spec-kitty implement WP03 --base WP01
```

## Context

- **Spec**: `kitty-specs/009-automated-pipelines-framework/spec.md` (FR-001: event triggers, FR-009: cycle detection)
- **Research**: `kitty-specs/009-automated-pipelines-framework/research.md` (R4: Circular Dependency Detection)
- **Data Model**: `kitty-specs/009-automated-pipelines-framework/data-model.md` (TriggerEvent, Pipeline tables)

Trigger handlers sit between the event bus and the pipeline executor. When an event arrives, the appropriate trigger handler identifies which pipelines should execute. The cycle detector runs at pipeline creation/update time to prevent circular trigger chains. A runtime depth counter serves as a defensive fallback.

**Key design decisions from research.md (R4)**:
- DFS-based cycle detection on a directed graph (nodes = pipelines, edges = trigger->output chains)
- Graph is rebuilt per-tenant at pipeline create/update time
- Cycle path is included in error messages for user debugging
- Runtime depth counter as belt-and-suspenders fallback (max depth configurable, default: 10)

---

## Subtask T012: Define TriggerHandler Interface

**Purpose**: Define the contract that all trigger handlers must implement.

**Steps**:
1. Create `joyus-ai-mcp-server/src/pipelines/triggers/interface.ts`
2. Define the `TriggerHandler` interface:
   ```typescript
   export interface TriggerHandler {
     /** The trigger event type this handler processes. */
     readonly eventType: TriggerEventType;

     /**
      * Evaluate an incoming event and identify which pipelines should execute.
      * Returns pipeline IDs that match this event.
      */
     findMatchingPipelines(
       tenantId: string,
       payload: Record<string, unknown>,
     ): Promise<MatchedPipeline[]>;

     /**
      * Create a trigger event record from an incoming event.
      * Returns the created trigger event ID.
      */
     createTriggerEvent(
       tenantId: string,
       payload: Record<string, unknown>,
     ): Promise<string>;
   }
   ```
3. Define `MatchedPipeline` type:
   ```typescript
   export interface MatchedPipeline {
     pipelineId: string;
     pipelineName: string;
     triggerConfig: Record<string, unknown>;
   }
   ```
4. Export types from the file

**Files**:
- `joyus-ai-mcp-server/src/pipelines/triggers/interface.ts` (new, ~40 lines)

**Validation**:
- [ ] `npm run typecheck` passes
- [ ] Interface is importable

---

## Subtask T013: Implement CorpusChangeTriggerHandler

**Purpose**: Handle corpus-change events by identifying pipelines configured to trigger on corpus changes for the affected tenant.

**Steps**:
1. Create `joyus-ai-mcp-server/src/pipelines/triggers/corpus-change.ts`
2. Implement `CorpusChangeTriggerHandler` class implementing `TriggerHandler`:
3. **eventType**: `'corpus_change'`
4. **findMatchingPipelines(tenantId, payload)**:
   - Query `pipelines` table: WHERE `tenantId = tenantId` AND `triggerType = 'corpus_change'` AND `status = 'active'`
   - For each matching pipeline, evaluate `triggerConfig.corpusFilter` against the event payload:
     - If no corpusFilter: pipeline matches all corpus changes for the tenant
     - If corpusFilter has `sourceIds`: match if any affected source ID is in the filter
     - If corpusFilter has `authorIds`: match if any affected author ID is in the filter
   - Return array of `MatchedPipeline` for all matching pipelines
5. **createTriggerEvent(tenantId, payload)**:
   - INSERT into `trigger_events` table with eventType `corpus_change`, the tenant ID, and the payload
   - Return the new event ID
6. **Constructor**: Accept Drizzle db client

**Important implementation details**:
- The payload for corpus_change events is expected to contain: `{ sourceIds?: string[], authorIds?: string[], documentIds?: string[], changeType: 'added' | 'updated' | 'removed' }`
- Filter matching should be permissive: if the pipeline's corpusFilter specifies sourceIds, at least one must match. If it specifies both sourceIds and authorIds, both conditions must match (AND logic).
- An empty corpus change (no affected IDs) should still match pipelines with no corpusFilter (they can determine no-op in the step handler)

**Files**:
- `joyus-ai-mcp-server/src/pipelines/triggers/corpus-change.ts` (new, ~80 lines)

**Validation**:
- [ ] Matches pipelines with matching corpusFilter
- [ ] Matches pipelines with no corpusFilter (catch-all)
- [ ] Does not match pipelines for different tenants
- [ ] Does not match disabled/paused pipelines

---

## Subtask T014: Implement ManualRequestTriggerHandler

**Purpose**: Handle manual trigger requests initiated via API or MCP tool.

**Steps**:
1. Create `joyus-ai-mcp-server/src/pipelines/triggers/manual-request.ts`
2. Implement `ManualRequestTriggerHandler` class implementing `TriggerHandler`:
3. **eventType**: `'manual_request'`
4. **findMatchingPipelines(tenantId, payload)**:
   - The payload for manual triggers contains `{ pipelineId: string }` — the user explicitly specifies which pipeline to trigger
   - Query the pipeline by ID, verify it belongs to the tenant, verify status is `active`
   - Return a single-element array with the matched pipeline, or empty array if not found/not active
5. **createTriggerEvent(tenantId, payload)**:
   - INSERT into `trigger_events` table with eventType `manual_request`, the tenant ID, and the payload
   - Return the new event ID
6. **Constructor**: Accept Drizzle db client

**Important implementation details**:
- Manual triggers bypass corpusFilter/schedule matching — they target a specific pipeline
- The handler must verify the pipeline belongs to the requesting tenant (tenant isolation)
- Manual triggers always start with `triggerChainDepth = 0`

**Files**:
- `joyus-ai-mcp-server/src/pipelines/triggers/manual-request.ts` (new, ~50 lines)

**Validation**:
- [ ] Returns the specified pipeline if it exists and is active
- [ ] Returns empty array if pipeline not found or belongs to different tenant
- [ ] Returns empty array if pipeline is disabled/paused
- [ ] Creates trigger_event with correct eventType

---

## Subtask T015: Create Trigger Registry

**Purpose**: Map trigger event type strings to their handler implementations.

**Steps**:
1. Create `joyus-ai-mcp-server/src/pipelines/triggers/registry.ts`
2. Implement `TriggerRegistry` class:
   ```typescript
   export class TriggerRegistry {
     private handlers = new Map<TriggerEventType, TriggerHandler>();

     register(handler: TriggerHandler): void {
       this.handlers.set(handler.eventType, handler);
     }

     getHandler(eventType: TriggerEventType): TriggerHandler | undefined {
       return this.handlers.get(eventType);
     }

     getRegisteredTypes(): TriggerEventType[] {
       return Array.from(this.handlers.keys());
     }
   }
   ```
3. Export a factory function that creates a pre-populated registry:
   ```typescript
   export function createTriggerRegistry(db: DrizzleClient): TriggerRegistry {
     const registry = new TriggerRegistry();
     registry.register(new CorpusChangeTriggerHandler(db));
     registry.register(new ManualRequestTriggerHandler(db));
     // ScheduleTriggerHandler is added in WP07
     return registry;
   }
   ```

**Files**:
- `joyus-ai-mcp-server/src/pipelines/triggers/registry.ts` (new, ~35 lines)

**Validation**:
- [ ] Registry maps event types to correct handlers
- [ ] getHandler returns undefined for unregistered types
- [ ] Factory creates registry with corpus_change and manual_request handlers

---

## Subtask T016: Build DFS Cycle Detector and Dependency Graph

**Purpose**: Detect circular pipeline trigger chains at configuration time using DFS on a directed graph.

**Steps**:
1. Create `joyus-ai-mcp-server/src/pipelines/graph/dependency-graph.ts`
2. Implement `DependencyGraph` class:
   ```typescript
   export class DependencyGraph {
     private adjacencyList = new Map<string, Set<string>>();

     addNode(pipelineId: string): void;
     addEdge(from: string, to: string): void;
     removeNode(pipelineId: string): void;
     neighbors(pipelineId: string): string[];
     nodes(): string[];
   }
   ```
3. Implement `buildDependencyGraph` function:
   - Accept: all active pipelines for a tenant (array of Pipeline with steps)
   - For each pipeline P, examine its step types and trigger type:
     - If P has steps that produce `corpus_change` output events (profile_generation, content_generation steps), and another pipeline Q has `triggerType = 'corpus_change'`:
       - Add edge P -> Q (P's output can trigger Q)
     - `manual_request` triggers never create edges (manual triggers are not automatic)
     - `schedule_tick` triggers never create edges (schedule triggers are not caused by other pipelines)
   - Return the populated DependencyGraph
4. Create `joyus-ai-mcp-server/src/pipelines/graph/cycle-detector.ts`
5. Implement `detectCycles` function using DFS with three-color marking:
   ```typescript
   export interface CycleResult {
     hasCycle: boolean;
     cycles: string[][]; // Each cycle is an array of pipeline IDs forming the cycle path
   }

   export function detectCycles(graph: DependencyGraph): CycleResult;
   ```
   - Use WHITE (unvisited), GRAY (in current DFS path), BLACK (fully explored) coloring
   - When a back edge is found (visiting a GRAY node), reconstruct the cycle path using parent tracking
   - Return all detected cycles with their full paths
6. Implement `validatePipelineCreation` function:
   ```typescript
   export async function validatePipelineCreation(
     tenantId: string,
     newPipeline: { triggerType: TriggerEventType; steps: { stepType: StepType }[] },
     db: DrizzleClient,
   ): Promise<{ valid: boolean; cycles?: string[][] }>;
   ```
   - Load all active pipelines for the tenant
   - Build dependency graph including the proposed new pipeline
   - Run cycle detection
   - Return validation result
7. Implement runtime depth check utility:
   ```typescript
   export function checkRuntimeDepth(
     currentDepth: number,
     maxDepth: number,
   ): { allowed: boolean; message?: string };
   ```
8. Create barrel export: `joyus-ai-mcp-server/src/pipelines/graph/index.ts`

**Files**:
- `joyus-ai-mcp-server/src/pipelines/graph/dependency-graph.ts` (new, ~60 lines)
- `joyus-ai-mcp-server/src/pipelines/graph/cycle-detector.ts` (new, ~120 lines)
- `joyus-ai-mcp-server/src/pipelines/graph/index.ts` (new, ~10 lines)

**Validation**:
- [ ] Graph correctly builds edges from pipeline output types to trigger types
- [ ] DFS detects direct cycles (A -> B -> A)
- [ ] DFS detects indirect cycles (A -> B -> C -> D -> A, depth 4+)
- [ ] DFS detects self-loops (A -> A)
- [ ] No false positives on valid pipeline configurations
- [ ] validatePipelineCreation integrates graph + detector correctly
- [ ] Runtime depth check works correctly

---

## Subtask T017: Unit Tests for Cycle Detector and Trigger Handlers

**Purpose**: Verify correctness of cycle detection and trigger handling.

**Steps**:
1. Create `joyus-ai-mcp-server/tests/pipelines/graph/cycle-detector.test.ts`
2. Cycle detector test cases:
   - **No cycles**: 3 pipelines with no trigger chain overlap — returns `hasCycle: false`
   - **Direct cycle**: A outputs corpus_change, B triggers on corpus_change and outputs corpus_change, A triggers on corpus_change — detects cycle [A, B, A]
   - **Indirect cycle depth 3**: A -> B -> C -> A — detects cycle
   - **Indirect cycle depth 5+**: A -> B -> C -> D -> E -> A — detects cycle (NFR-004 compliance)
   - **Self-loop**: Pipeline triggers on its own output type — detects cycle
   - **Multiple independent cycles**: Two separate cycles in same tenant — both detected
   - **Manual trigger does not create edge**: Pipeline with manual_request trigger is never in a cycle
   - **Schedule trigger does not create edge**: Pipeline with schedule_tick trigger is never in a cycle
   - **Pipeline validation rejects cyclic config**: validatePipelineCreation returns valid: false for cyclic config
   - **Pipeline validation accepts valid config**: validatePipelineCreation returns valid: true for acyclic config
3. Create `joyus-ai-mcp-server/tests/pipelines/triggers/corpus-change.test.ts`
4. Corpus change handler test cases:
   - **Matches active pipeline for tenant**: Returns matching pipeline
   - **Filters by corpusFilter.sourceIds**: Only matches if affected source is in filter
   - **Catches all without filter**: Pipeline with no corpusFilter matches all corpus changes
   - **Ignores disabled pipelines**: Does not return disabled/paused pipelines
   - **Tenant isolation**: Does not return pipelines from other tenants
5. Runtime depth check test cases:
   - depth 0, maxDepth 10 -> allowed
   - depth 9, maxDepth 10 -> allowed
   - depth 10, maxDepth 10 -> NOT allowed
   - depth 11, maxDepth 10 -> NOT allowed

**Files**:
- `joyus-ai-mcp-server/tests/pipelines/graph/cycle-detector.test.ts` (new, ~200 lines)
- `joyus-ai-mcp-server/tests/pipelines/triggers/corpus-change.test.ts` (new, ~100 lines)

**Validation**:
- [ ] All tests pass via `npm run test`
- [ ] Cycle detection catches all cycles including indirect depth 5+ (NFR-004)
- [ ] Trigger handler tests verify tenant isolation

---

## Definition of Done

- [ ] `TriggerHandler` interface defined
- [ ] `CorpusChangeTriggerHandler` implements filtering by corpus config
- [ ] `ManualRequestTriggerHandler` implements single-pipeline targeting
- [ ] `TriggerRegistry` maps event types to handlers
- [ ] `DependencyGraph` and DFS `detectCycles` correctly identify all circular trigger chains
- [ ] `validatePipelineCreation` integrates graph + detector for use at pipeline create/update time
- [ ] Runtime depth counter utility implemented
- [ ] Unit tests pass for all components
- [ ] `npm run validate` passes with zero errors

## Risks

- **Graph edge inference**: Determining which step types produce events that can trigger other pipelines requires heuristic matching. Profile generation and content generation steps can cause corpus changes. If the heuristic is wrong, cycles can be missed. Mitigation: be conservative — if a step type could produce a corpus change, assume it does.
- **Tenant pipeline count**: Building the full dependency graph requires loading all active pipelines for a tenant. With max 20 pipelines per tenant, this is trivial. But the limit must be enforced upstream.

## Reviewer Guidance

- Verify DFS uses three-color marking (WHITE/GRAY/BLACK), not just visited set — two-color can miss cycles in directed graphs
- Check that cycle path reconstruction includes the full loop (not just the back edge endpoints)
- Verify manual_request and schedule_tick triggers never create edges in the dependency graph
- Confirm validatePipelineCreation includes the new pipeline in the graph before detection
- Verify runtime depth check is strict (depth >= maxDepth is rejected, not depth > maxDepth)
- Check that CorpusChangeTriggerHandler only returns active pipelines (not paused/disabled)

## Activity Log
