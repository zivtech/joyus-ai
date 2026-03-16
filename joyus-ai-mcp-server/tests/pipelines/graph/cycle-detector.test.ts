/**
 * Tests for pipeline dependency graph & cycle detection.
 *
 * Covers:
 *   - buildDependencyGraph: no connections when no corpus writers
 *   - detectCycle: no cycle in a linear chain
 *   - detectCycle: direct cycle A → B → A
 *   - detectCycle: indirect cycle A → B → C → A
 *   - validateNoCycle: throws when a cycle would be created
 *   - validateNoCycle: passes for a safe pipeline addition
 */

import { describe, it, expect } from 'vitest';
import type { Pipeline, PipelineStep } from '../../../src/pipelines/schema.js';
import {
  buildDependencyGraph,
  detectCycle,
  validateNoCycle,
} from '../../../src/pipelines/graph/cycle-detector.js';

// ── Fixtures ──────────────────────────────────────────────────────────────────

function makePipeline(
  id: string,
  triggerType: Pipeline['triggerType'] = 'manual_request',
): Pipeline {
  return {
    id,
    tenantId: 'tenant-1',
    name: `Pipeline ${id}`,
    description: null,
    triggerType,
    triggerConfig: { type: triggerType },
    retryPolicy: { maxRetries: 3, baseDelayMs: 30000, maxDelayMs: 300000, backoffMultiplier: 2 },
    concurrencyPolicy: 'skip_if_running',
    reviewGateTimeoutHours: 48,
    maxPipelineDepth: 10,
    status: 'active',
    templateId: null,
    createdAt: new Date(),
    updatedAt: new Date(),
  } as unknown as Pipeline;
}

function makeStep(
  id: string,
  pipelineId: string,
  stepType: PipelineStep['stepType'],
  position = 0,
): PipelineStep {
  return {
    id,
    pipelineId,
    position,
    name: stepType,
    stepType,
    config: { type: stepType },
    inputRefs: [],
    retryPolicyOverride: null,
    createdAt: new Date(),
    updatedAt: new Date(),
  } as unknown as PipelineStep;
}

// ── buildDependencyGraph ──────────────────────────────────────────────────────

describe('buildDependencyGraph', () => {
  it('creates a node for every pipeline with no edges when no corpus writers exist', () => {
    const pipelines = [
      makePipeline('p1', 'corpus_change'),
      makePipeline('p2', 'manual_request'),
    ];
    const graph = buildDependencyGraph(pipelines, []);
    expect(graph.has('p1')).toBe(true);
    expect(graph.has('p2')).toBe(true);
    expect(graph.get('p1')!.size).toBe(0);
    expect(graph.get('p2')!.size).toBe(0);
  });

  it('connects corpus-writer pipeline to corpus-change listener', () => {
    const writer = makePipeline('writer', 'manual_request');
    const listener = makePipeline('listener', 'corpus_change');
    const step = makeStep('s1', 'writer', 'content_generation');

    const graph = buildDependencyGraph([writer, listener], [step]);

    // writer → listener edge should exist
    expect(graph.get('writer')!.has('listener')).toBe(true);
    // listener has no outbound edges (no writer steps)
    expect(graph.get('listener')!.size).toBe(0);
  });

  it('does not add self-loop when a corpus-writer pipeline is also a corpus-change listener', () => {
    const p = makePipeline('p1', 'corpus_change');
    const step = makeStep('s1', 'p1', 'profile_generation');

    const graph = buildDependencyGraph([p], [step]);
    // Should not point to itself
    expect(graph.get('p1')!.has('p1')).toBe(false);
  });
});

// ── detectCycle ───────────────────────────────────────────────────────────────

describe('detectCycle', () => {
  it('returns null for a linear chain A → B → C (no cycle)', () => {
    const graph = new Map([
      ['A', new Set(['B'])],
      ['B', new Set(['C'])],
      ['C', new Set<string>()],
    ]);
    expect(detectCycle(graph, 'A')).toBeNull();
  });

  it('detects a direct cycle: A → B → A', () => {
    const graph = new Map([
      ['A', new Set(['B'])],
      ['B', new Set(['A'])],
    ]);
    const cycle = detectCycle(graph, 'A');
    expect(cycle).not.toBeNull();
    expect(cycle).toContain('A');
    expect(cycle).toContain('B');
  });

  it('detects an indirect cycle: A → B → C → A', () => {
    const graph = new Map([
      ['A', new Set(['B'])],
      ['B', new Set(['C'])],
      ['C', new Set(['A'])],
    ]);
    const cycle = detectCycle(graph, 'A');
    expect(cycle).not.toBeNull();
    expect(cycle!.length).toBeGreaterThanOrEqual(3);
    expect(cycle).toContain('A');
  });

  it('returns null for a node with no edges', () => {
    const graph = new Map([['A', new Set<string>()]]);
    expect(detectCycle(graph, 'A')).toBeNull();
  });

  it('returns null for a node not in the graph', () => {
    const graph = new Map<string, Set<string>>();
    expect(detectCycle(graph, 'missing')).toBeNull();
  });
});

// ── validateNoCycle ───────────────────────────────────────────────────────────

describe('validateNoCycle', () => {
  it('does not throw when adding a safe pipeline', () => {
    const existing = [makePipeline('writer', 'manual_request')];
    const existingSteps = [makeStep('s1', 'writer', 'content_generation')];

    // Adding a corpus-change listener with no writer steps — safe
    expect(() =>
      validateNoCycle('listener', 'corpus_change', ['source_query'], existing, existingSteps),
    ).not.toThrow();
  });

  it('throws when new pipeline creates a direct cycle', () => {
    // listener is a corpus_change listener AND a corpus writer
    // writer → listener (because writer produces corpus changes that trigger listener)
    // new-writer (content_generation) → listener (corpus_change) AND listener → new-writer? No.
    // Simpler direct scenario: new pipeline is corpus_change listener AND has content_generation step
    // → if writer already has content_generation and is triggered by corpus_change, adding
    //   another corpus_change listener with content_generation creates writer→new→writer cycle.

    const writer = makePipeline('writer', 'corpus_change');
    const writerStep = makeStep('ws1', 'writer', 'content_generation');

    expect(() =>
      validateNoCycle(
        'new-pipeline',
        'corpus_change',
        ['content_generation'],
        [writer],
        [writerStep],
      ),
    ).toThrow(/cycle detected/i);
  });
});
