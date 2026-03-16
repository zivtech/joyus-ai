/**
 * Pipeline Dependency Graph & Cycle Detection
 *
 * Builds a conservative adjacency list connecting corpus-change listener pipelines
 * to all corpus-writer pipelines (those with content_generation or profile_generation
 * steps). DFS cycle detection prevents infinite trigger chains.
 */

import type { Pipeline, PipelineStep } from '../schema.js';
import type { StepType } from '../types.js';

// ============================================================
// TYPES
// ============================================================

export interface PipelineNode {
  id: string;
  triggerType: string;
}

export type DependencyGraph = Map<string, Set<string>>;

// Step types that write to the corpus and can re-trigger corpus_change events
const CORPUS_WRITER_STEP_TYPES: Set<StepType> = new Set([
  'content_generation',
  'profile_generation',
]);

// ============================================================
// GRAPH BUILDING
// ============================================================

/**
 * Build a dependency graph from pipelines and their steps.
 *
 * Edge direction: A → B means "pipeline A can trigger pipeline B".
 * A corpus-change listener is connected to all corpus-writer pipelines
 * (conservative approximation: any writer could produce a change that
 * triggers any listener).
 */
export function buildDependencyGraph(
  pipelines: Pipeline[],
  steps: PipelineStep[],
): DependencyGraph {
  const graph: DependencyGraph = new Map();

  // Initialise a node for every pipeline
  for (const p of pipelines) {
    graph.set(p.id, new Set());
  }

  // Identify corpus writers: pipelines that have at least one corpus-writer step
  const corpusWriterIds = new Set<string>();
  for (const step of steps) {
    if (CORPUS_WRITER_STEP_TYPES.has(step.stepType as StepType)) {
      corpusWriterIds.add(step.pipelineId);
    }
  }

  // Identify corpus-change listeners
  const corpusListeners = pipelines.filter((p) => p.triggerType === 'corpus_change');

  // Connect every writer → every listener (writer output can trigger listener)
  for (const writerId of corpusWriterIds) {
    const edges = graph.get(writerId);
    if (edges) {
      for (const listener of corpusListeners) {
        if (listener.id !== writerId) {
          edges.add(listener.id);
        }
      }
    }
  }

  return graph;
}

// ============================================================
// CYCLE DETECTION
// ============================================================

/**
 * DFS cycle detection starting from `startId`.
 * Returns the cycle path (array of pipeline IDs) if one exists, or null.
 */
export function detectCycle(
  graph: DependencyGraph,
  startId: string,
): string[] | null {
  const visited = new Set<string>();
  const path: string[] = [];

  function dfs(nodeId: string): string[] | null {
    if (path.includes(nodeId)) {
      // Found cycle — return the cycle portion of the path
      const cycleStart = path.indexOf(nodeId);
      return [...path.slice(cycleStart), nodeId];
    }

    if (visited.has(nodeId)) {
      return null;
    }

    visited.add(nodeId);
    path.push(nodeId);

    const neighbours = graph.get(nodeId) ?? new Set();
    for (const neighbour of neighbours) {
      const cycle = dfs(neighbour);
      if (cycle) return cycle;
    }

    path.pop();
    return null;
  }

  return dfs(startId);
}

// ============================================================
// VALIDATION
// ============================================================

/**
 * Validate that adding a new pipeline with the given step types would not
 * create a cycle in the dependency graph.
 *
 * Throws if a cycle is detected; returns void if safe to proceed.
 */
export function validateNoCycle(
  newPipelineId: string,
  newPipelineTriggerType: string,
  newPipelineStepTypes: StepType[],
  existingPipelines: Pipeline[],
  existingSteps: PipelineStep[],
): void {
  // Construct a synthetic Pipeline row for the new pipeline
  const syntheticPipeline = {
    id: newPipelineId,
    triggerType: newPipelineTriggerType,
  } as Pipeline;

  // Construct synthetic PipelineStep rows for the new steps
  const syntheticSteps: PipelineStep[] = newPipelineStepTypes.map((stepType, i) => ({
    id: `${newPipelineId}-step-${i}`,
    pipelineId: newPipelineId,
    stepType,
    position: i,
    name: stepType,
    config: {},
    inputRefs: [],
    retryPolicyOverride: null,
    createdAt: new Date(),
    updatedAt: new Date(),
  } as PipelineStep));

  const allPipelines = [...existingPipelines, syntheticPipeline];
  const allSteps = [...existingSteps, ...syntheticSteps];

  const graph = buildDependencyGraph(allPipelines, allSteps);
  const cycle = detectCycle(graph, newPipelineId);

  if (cycle) {
    throw new Error(
      `Pipeline cycle detected: ${cycle.join(' → ')}. ` +
      `Adding pipeline "${newPipelineId}" would create an infinite trigger loop.`,
    );
  }
}
