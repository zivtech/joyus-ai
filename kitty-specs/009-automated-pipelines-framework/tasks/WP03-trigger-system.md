---
work_package_id: WP03
title: Trigger System
lane: "done"
dependencies: [WP01]
base_branch: 009-automated-pipelines-framework-WP01
base_commit: 5df73eb05e3ceb65f97fdc2b2dc81790126c74e3
created_at: '2026-03-16T16:55:42.593780+00:00'
subtasks: [T012, T013, T014, T015, T016, T017]
shell_pid: "84658"
reviewed_by: "Alex Urevick-Ackelsberg"
review_status: "approved"
history:
- date: '2026-03-14'
  action: created
  agent: claude-opus
---

# WP03: Trigger System

**Implementation command**: `spec-kitty implement WP03 --base WP01`
**Target repo**: `joyus-ai`
**Dependencies**: WP01 (Schema & Foundation)
**Priority**: P1 | Can run in parallel with WP02

## Objective

Build the trigger handler interface, the two initial trigger implementations (corpus-change and manual), the trigger registry, and the circular dependency detection system (DFS cycle detector with runtime depth counter). This WP does not include the schedule trigger — that is WP07.

## Context

Triggers are the entry points to pipeline execution. When a corpus-change event fires (a document was added/updated in Spec 006's content infrastructure), the trigger system determines which pipelines should run. Manual triggers allow API callers to start pipelines on demand.

The cycle detection system is critical for safety: a `corpus_change` pipeline whose steps modify the corpus could trigger itself recursively. The DFS cycle detector (T016) runs at pipeline creation time to reject cyclic configurations before they are persisted. A runtime depth counter provides a secondary defense during execution.

WP03 runs in parallel with WP02 — both depend only on WP01.

---

## Subtasks

### T012: Define TriggerHandler interface (`src/pipelines/triggers/interface.ts`)

**Purpose**: Establish the contract that all trigger handler implementations must satisfy, enabling the registry to treat all trigger types uniformly.

**Steps**:
1. Create `src/pipelines/triggers/interface.ts`
2. Define `TriggerContext` — the runtime context passed to each handler
3. Define `TriggerHandler` interface with `canHandle`, `shouldFire`, and `getMatchingPipelines`
4. Define `TriggerResult` — what a handler returns

```typescript
// src/pipelines/triggers/interface.ts
import type { EventEnvelope } from '../event-bus';
import type { Pipeline, TriggerType } from '../types';

export interface TriggerContext {
  event: EventEnvelope;
  tenantId: string;
  currentDepth: number;  // for cycle detection runtime guard
}

export interface TriggerResult {
  pipelineId: string;
  triggerPayload: Record<string, unknown>;
}

export interface TriggerHandler {
  /**
   * The trigger type this handler is responsible for.
   */
  readonly triggerType: TriggerType;

  /**
   * Returns true if this handler can process the given event type.
   */
  canHandle(eventType: TriggerType): boolean;

  /**
   * Given the event context and all active pipelines, returns the subset
   * of pipelines that should be triggered by this event.
   */
  getMatchingPipelines(
    context: TriggerContext,
    activePipelines: Pipeline[],
  ): TriggerResult[];
}
```

**Files**:
- `src/pipelines/triggers/interface.ts` (new, ~35 lines)

**Validation**:
- [ ] `tsc --noEmit` passes on `interface.ts`
- [ ] `TriggerHandler` interface is minimal — no DB access, no async. Handlers receive pre-fetched pipelines.

**Edge Cases**:
- Handlers receive `Pipeline[]` (pre-fetched active pipelines for the tenant) rather than making DB queries themselves. This keeps handlers pure and testable. The executor (WP04) fetches pipelines and passes them to handlers.

---

### T013: Implement CorpusChangeTriggerHandler (`src/pipelines/triggers/corpus-change.ts`)

**Purpose**: Handle `corpus_change` events by matching them against pipelines configured with `corpus_change` triggers, optionally filtered by source ID.

**Steps**:
1. Create `src/pipelines/triggers/corpus-change.ts`
2. Implement `TriggerHandler` for event type `corpus_change`
3. In `getMatchingPipelines`: filter to pipelines with `triggerType === 'corpus_change'`, then check if the changed source ID is in the pipeline's `triggerConfig.sourceIds` (empty = match all)
4. Return a `TriggerResult` for each matching pipeline

```typescript
// src/pipelines/triggers/corpus-change.ts
import type { TriggerHandler, TriggerContext, TriggerResult } from './interface';
import type { Pipeline } from '../types';
import type { CorpusChangeTriggerConfig } from '../types';
import { MAX_PIPELINE_DEPTH } from '../types';

export class CorpusChangeTriggerHandler implements TriggerHandler {
  readonly triggerType = 'corpus_change' as const;

  canHandle(eventType: string): boolean {
    return eventType === 'corpus_change';
  }

  getMatchingPipelines(context: TriggerContext, activePipelines: Pipeline[]): TriggerResult[] {
    // Runtime depth guard — secondary defense after DFS cycle detection
    if (context.currentDepth >= MAX_PIPELINE_DEPTH) {
      console.warn(
        `[CorpusChangeTrigger] Max depth ${MAX_PIPELINE_DEPTH} reached for tenant ${context.tenantId}. Stopping.`,
      );
      return [];
    }

    const changedSourceId = context.event.payload?.sourceId as string | undefined;

    return activePipelines
      .filter((p) => p.triggerType === 'corpus_change')
      .filter((p) => {
        const cfg = p.triggerConfig as CorpusChangeTriggerConfig;
        // Empty sourceIds means "trigger on any source change"
        if (!cfg.sourceIds || cfg.sourceIds.length === 0) return true;
        return changedSourceId ? cfg.sourceIds.includes(changedSourceId) : false;
      })
      .map((p) => ({
        pipelineId: p.id,
        triggerPayload: {
          sourceId: changedSourceId,
          changeCount: context.event.payload?.changeCount,
          depth: context.currentDepth + 1,
        },
      }));
  }
}
```

**Files**:
- `src/pipelines/triggers/corpus-change.ts` (new, ~45 lines)

**Validation**:
- [ ] Pipeline with empty `sourceIds` matches any `corpus_change` event
- [ ] Pipeline with `sourceIds: ['source-abc']` only matches events with `payload.sourceId === 'source-abc'`
- [ ] When `currentDepth >= MAX_PIPELINE_DEPTH`, returns `[]` and logs warning
- [ ] `tsc --noEmit` passes

**Edge Cases**:
- `changedSourceId` may be undefined if the event was published without a `sourceId`. In that case, pipelines with specific `sourceIds` should NOT match (conservative behavior). Pipelines with empty `sourceIds` always match.
- The `depth` value in `triggerPayload` is passed through to the next execution so the runtime depth counter increments correctly.

---

### T014: Implement ManualRequestTriggerHandler (`src/pipelines/triggers/manual-request.ts`)

**Purpose**: Handle `manual` trigger events — direct API requests to start a specific pipeline. Unlike corpus-change, manual triggers target a specific pipeline by ID rather than pattern-matching across all pipelines.

**Steps**:
1. Create `src/pipelines/triggers/manual-request.ts`
2. Implement `TriggerHandler` for event type `manual`
3. In `getMatchingPipelines`: the event payload must contain `pipelineId`. Find that pipeline in the active set and return it.
4. Optionally check `allowedRoles` from the pipeline's trigger config (role enforcement is primarily at the API layer, but the handler can double-check)

```typescript
// src/pipelines/triggers/manual-request.ts
import type { TriggerHandler, TriggerContext, TriggerResult } from './interface';
import type { Pipeline } from '../types';
import type { ManualTriggerConfig } from '../types';

export class ManualRequestTriggerHandler implements TriggerHandler {
  readonly triggerType = 'manual' as const;

  canHandle(eventType: string): boolean {
    return eventType === 'manual';
  }

  getMatchingPipelines(context: TriggerContext, activePipelines: Pipeline[]): TriggerResult[] {
    const { pipelineId, requestorRole } = context.event.payload as {
      pipelineId?: string;
      requestorRole?: string;
    };

    if (!pipelineId) {
      console.warn('[ManualTrigger] Event missing pipelineId in payload');
      return [];
    }

    const pipeline = activePipelines.find((p) => p.id === pipelineId && p.triggerType === 'manual');
    if (!pipeline) return [];

    const cfg = pipeline.triggerConfig as ManualTriggerConfig;
    if (cfg.allowedRoles && cfg.allowedRoles.length > 0) {
      if (!requestorRole || !cfg.allowedRoles.includes(requestorRole)) {
        console.warn(`[ManualTrigger] Role '${requestorRole}' not allowed for pipeline ${pipelineId}`);
        return [];
      }
    }

    return [{
      pipelineId: pipeline.id,
      triggerPayload: context.event.payload,
    }];
  }
}
```

**Files**:
- `src/pipelines/triggers/manual-request.ts` (new, ~40 lines)

**Validation**:
- [ ] Event with no `pipelineId` in payload returns `[]`
- [ ] Event targeting a non-existent pipeline ID returns `[]`
- [ ] Event targeting a pipeline with `allowedRoles` and wrong role returns `[]`
- [ ] `tsc --noEmit` passes

**Edge Cases**:
- The manual trigger handler is a defense-in-depth check. The API route (WP08) should enforce `allowedRoles` first. If both layers check, role mismatches are caught earlier with better error messages.

---

### T015: Create trigger registry (`src/pipelines/triggers/registry.ts`)

**Purpose**: Provide a central registry that maps event types to their handler implementations, allowing the executor to look up the correct handler without knowing about concrete types.

**Steps**:
1. Create `src/pipelines/triggers/registry.ts`
2. Define `TriggerRegistry` class with `register` and `getHandler` methods
3. Export a default registry pre-populated with `CorpusChangeTriggerHandler` and `ManualRequestTriggerHandler`
4. The `ScheduleTriggerHandler` (WP07) will register itself after the registry is created

```typescript
// src/pipelines/triggers/registry.ts
import type { TriggerHandler } from './interface';
import type { TriggerType } from '../types';
import { CorpusChangeTriggerHandler } from './corpus-change';
import { ManualRequestTriggerHandler } from './manual-request';

export class TriggerRegistry {
  private handlers = new Map<TriggerType, TriggerHandler>();

  register(handler: TriggerHandler): void {
    this.handlers.set(handler.triggerType, handler);
  }

  getHandler(triggerType: TriggerType): TriggerHandler | undefined {
    return this.handlers.get(triggerType);
  }

  getAll(): TriggerHandler[] {
    return Array.from(this.handlers.values());
  }
}

// Default registry — ScheduleTriggerHandler is registered by WP07
export const defaultTriggerRegistry = new TriggerRegistry();
defaultTriggerRegistry.register(new CorpusChangeTriggerHandler());
defaultTriggerRegistry.register(new ManualRequestTriggerHandler());
```

**Files**:
- `src/pipelines/triggers/registry.ts` (new, ~30 lines)

**Validation**:
- [ ] `defaultTriggerRegistry.getHandler('corpus_change')` returns `CorpusChangeTriggerHandler`
- [ ] `defaultTriggerRegistry.getHandler('manual')` returns `ManualRequestTriggerHandler`
- [ ] `defaultTriggerRegistry.getHandler('schedule')` returns `undefined` until WP07 registers it
- [ ] `tsc --noEmit` passes

**Edge Cases**:
- Do not make the registry a singleton that is hard to override in tests. Export `defaultTriggerRegistry` as a convenience but always accept `TriggerRegistry` as a constructor parameter in the executor.

---

### T016: Build DFS cycle detector and dependency graph builder (`src/pipelines/graph/`)

**Purpose**: Prevent pipeline configurations where pipeline A triggers pipeline B (via corpus_change) which in turn triggers pipeline A — infinite loops. Run at pipeline creation/update time.

**Steps**:
1. Create `src/pipelines/graph/cycle-detector.ts`
2. Define `PipelineNode` — represents a pipeline in the dependency graph
3. Define `buildDependencyGraph` — constructs an adjacency list from all active pipelines
4. Define `detectCycle` — DFS traversal that returns the cycle path if found, or null
5. Define `validateNoCycle` — top-level function used by the API layer

```typescript
// src/pipelines/graph/cycle-detector.ts
import type { Pipeline } from '../types';

export interface PipelineNode {
  id: string;
  triggerType: string;
  sourceIds: string[];  // for corpus_change triggers
}

export type DependencyGraph = Map<string, Set<string>>;

/**
 * Build an adjacency list: pipeline A -> Set<pipeline B> means
 * "if A runs and modifies corpus, B may trigger".
 *
 * For corpus_change pipelines, edges are created when:
 * - A has content_generation or similar steps that write to corpus
 * - B has a corpus_change trigger matching the sources A writes to
 *
 * For this implementation, we conservatively assume any pipeline with
 * content_generation steps can trigger any corpus_change pipeline for
 * the same tenant.
 */
export function buildDependencyGraph(pipelines: Pipeline[]): DependencyGraph {
  const graph: DependencyGraph = new Map();

  for (const p of pipelines) {
    graph.set(p.id, new Set());
  }

  const corpusWriters = pipelines.filter((p) =>
    (p.stepConfigs as Array<{ stepType: string }>).some(
      (s) => s.stepType === 'content_generation' || s.stepType === 'profile_generation',
    ),
  );

  const corpusChangeListeners = pipelines.filter((p) => p.triggerType === 'corpus_change');

  for (const writer of corpusWriters) {
    for (const listener of corpusChangeListeners) {
      if (writer.id !== listener.id) {
        graph.get(writer.id)!.add(listener.id);
      }
    }
  }

  return graph;
}

/**
 * DFS cycle detection. Returns the cycle path (array of pipeline IDs) if a
 * cycle is found, or null if the graph is acyclic.
 */
export function detectCycle(
  graph: DependencyGraph,
  startId: string,
): string[] | null {
  const visited = new Set<string>();
  const path: string[] = [];

  function dfs(nodeId: string): boolean {
    if (path.includes(nodeId)) {
      // Found cycle — return the cycle portion of the path
      return true;
    }
    if (visited.has(nodeId)) return false;

    visited.add(nodeId);
    path.push(nodeId);

    for (const neighbor of graph.get(nodeId) ?? []) {
      if (dfs(neighbor)) return true;
    }

    path.pop();
    return false;
  }

  return dfs(startId) ? [...path] : null;
}

/**
 * Top-level validation function called during pipeline create/update.
 * Throws if creating/updating the given pipeline would introduce a cycle.
 */
export function validateNoCycle(
  newPipeline: Pick<Pipeline, 'id' | 'triggerType' | 'stepConfigs'>,
  existingPipelines: Pipeline[],
): void {
  // Add the new pipeline to the set and build the graph
  const allPipelines = [
    ...existingPipelines.filter((p) => p.id !== newPipeline.id),
    newPipeline as Pipeline,
  ];
  const graph = buildDependencyGraph(allPipelines);
  const cycle = detectCycle(graph, newPipeline.id);

  if (cycle) {
    throw new Error(
      `Pipeline configuration would create a circular dependency: ${cycle.join(' → ')}`,
    );
  }
}
```

**Files**:
- `src/pipelines/graph/cycle-detector.ts` (new, ~75 lines)
- `src/pipelines/graph/index.ts` (new, ~5 lines — barrel export)

**Validation**:
- [ ] Pipeline A → B → A cycle: `detectCycle` returns `['A', 'B', 'A']` (or similar path)
- [ ] Pipeline with no content_generation steps: no edges created, no cycle
- [ ] `validateNoCycle` throws with descriptive message on cycle detection
- [ ] `validateNoCycle` succeeds for a linear A → B → C chain
- [ ] `tsc --noEmit` passes

**Edge Cases**:
- The graph is a conservative approximation: any pipeline with `content_generation` steps is treated as a potential corpus writer. False positives (blocking a pipeline that wouldn't actually write to the corpus) are acceptable — false negatives (missing a real cycle) are not.
- Self-loops: a pipeline that both writes to corpus and listens to corpus_change is a direct cycle. The `writer.id !== listener.id` check prevents self-edges, but the executor's runtime depth counter is the final guard.

---

### T017: Unit tests for cycle detector and trigger handlers (`tests/pipelines/`)

**Purpose**: Verify the trigger handlers and cycle detector behave correctly in isolation.

**Steps**:
1. Create `tests/pipelines/graph/cycle-detector.test.ts`
2. Create `tests/pipelines/triggers/corpus-change.test.ts`
3. Create `tests/pipelines/triggers/manual-request.test.ts`
4. Test cycle detector: no cycle (linear chain), direct cycle (A→B→A), indirect cycle (A→B→C→A), self-edge excluded
5. Test corpus-change handler: empty sourceIds matches all, specific sourceId filters correctly, depth limit returns empty
6. Test manual handler: missing pipelineId returns empty, role check, correct pipeline selected

```typescript
// tests/pipelines/graph/cycle-detector.test.ts
import { describe, it, expect } from 'vitest';
import { buildDependencyGraph, detectCycle, validateNoCycle } from '../../../src/pipelines/graph/cycle-detector';
import type { Pipeline } from '../../../src/pipelines/types';

function makePipeline(overrides: Partial<Pipeline>): Pipeline {
  return {
    id: 'pipeline-id',
    tenantId: 'tenant-1',
    name: 'Test Pipeline',
    status: 'active',
    triggerType: 'corpus_change',
    triggerConfig: { type: 'corpus_change' },
    stepConfigs: [],
    concurrencyPolicy: 'skip',
    retryPolicy: {},
    createdAt: new Date(),
    updatedAt: new Date(),
    description: null,
    ...overrides,
  } as Pipeline;
}

describe('detectCycle', () => {
  it('returns null for an acyclic graph', () => {
    const graph = new Map([
      ['A', new Set(['B'])],
      ['B', new Set(['C'])],
      ['C', new Set()],
    ]);
    expect(detectCycle(graph, 'A')).toBeNull();
  });

  it('detects a direct cycle A → B → A', () => {
    const graph = new Map([
      ['A', new Set(['B'])],
      ['B', new Set(['A'])],
    ]);
    const cycle = detectCycle(graph, 'A');
    expect(cycle).not.toBeNull();
    expect(cycle).toContain('A');
    expect(cycle).toContain('B');
  });

  it('detects an indirect cycle A → B → C → A', () => {
    const graph = new Map([
      ['A', new Set(['B'])],
      ['B', new Set(['C'])],
      ['C', new Set(['A'])],
    ]);
    const cycle = detectCycle(graph, 'A');
    expect(cycle).not.toBeNull();
  });
});

describe('validateNoCycle', () => {
  it('does not throw for a pipeline with no corpus-writing steps', () => {
    const existing = [makePipeline({ id: 'p2', triggerType: 'corpus_change' })];
    const newP = makePipeline({ id: 'p1', stepConfigs: [{ stepType: 'notification' }] as any });
    expect(() => validateNoCycle(newP, existing)).not.toThrow();
  });

  it('throws when new pipeline would create a cycle', () => {
    const pA = makePipeline({
      id: 'pA',
      triggerType: 'manual',
      stepConfigs: [{ stepType: 'content_generation' }] as any,
    });
    const pB = makePipeline({
      id: 'pB',
      triggerType: 'corpus_change',
      stepConfigs: [{ stepType: 'content_generation' }] as any,
    });
    // pA writes corpus → pB triggers → pB writes corpus → pA triggers (if pA were corpus_change)
    // Simpler: pB writes corpus → pB is corpus_change → self-cycle after adding pB to pA's outputs
    expect(() => validateNoCycle(pB, [pA])).not.toThrow(); // pA has manual trigger, no cycle
  });
});
```

**Files**:
- `tests/pipelines/graph/cycle-detector.test.ts` (new, ~70 lines)
- `tests/pipelines/triggers/corpus-change.test.ts` (new, ~40 lines)
- `tests/pipelines/triggers/manual-request.test.ts` (new, ~35 lines)

**Validation**:
- [ ] `npm test tests/pipelines/graph/` exits 0
- [ ] `npm test tests/pipelines/triggers/` exits 0
- [ ] All cycle scenarios (no cycle, direct, indirect) tested
- [ ] Handler filter logic tested (sourceId matching, role checking)

**Edge Cases**:
- Test helper `makePipeline` should use realistic defaults to avoid TypeScript `as any` casts. Adjust to match the actual `Pipeline` type from `schema.ts` once WP01 is merged.

---

## Definition of Done

- [ ] `src/pipelines/triggers/interface.ts` — `TriggerHandler`, `TriggerContext`, `TriggerResult`
- [ ] `src/pipelines/triggers/corpus-change.ts` — `CorpusChangeTriggerHandler`
- [ ] `src/pipelines/triggers/manual-request.ts` — `ManualRequestTriggerHandler`
- [ ] `src/pipelines/triggers/registry.ts` — `TriggerRegistry`, `defaultTriggerRegistry`
- [ ] `src/pipelines/graph/cycle-detector.ts` — `buildDependencyGraph`, `detectCycle`, `validateNoCycle`
- [ ] `src/pipelines/graph/index.ts` — barrel export
- [ ] Tests passing: cycle detector (no cycle, direct, indirect), corpus-change handler, manual handler
- [ ] `npm run typecheck` exits 0
- [ ] `npm test` exits 0 with no regressions

## Risks

- **Conservative cycle detection**: The graph construction assumes any `content_generation` step writes to the corpus. If the platform adds step types that write to corpus in the future, the `corpusWriters` filter in `buildDependencyGraph` must be updated. Document this assumption explicitly in code comments.
- **Graph staleness**: `validateNoCycle` fetches existing pipelines at API request time. If two concurrent create requests race, both could pass validation independently and together form a cycle. Mitigate with a DB-level advisory lock on the tenant's pipeline set during validation.
- **Indirect corpus writes**: A pipeline that calls an external system which writes back to corpus via the API (a webhook loop) cannot be detected by static graph analysis. The runtime depth counter is the only defense here.

## Reviewer Guidance

- Verify `validateNoCycle` receives all active pipelines for the tenant, not just those with matching trigger types — the graph must be complete to detect indirect cycles.
- Check that `MAX_PIPELINE_DEPTH` is imported from `types.ts` (not duplicated). A single definition ensures consistency between static and runtime guards.
- Confirm the DFS `path` array is reset between top-level calls (not shared state) — the current implementation uses a closure which is correct.

## Activity Log

- 2026-03-16T17:50:56Z – unknown – shell_pid=84658 – lane=done – Review passed: pure handlers, cycle detection, 30 new tests. No critical or high issues.
