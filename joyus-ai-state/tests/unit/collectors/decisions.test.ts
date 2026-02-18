import { describe, it, expect } from 'vitest';
import { carryForwardDecisions } from '../../../src/collectors/decisions.js';
import type { Decision } from '../../../src/core/types.js';

function makeDecision(overrides: Partial<Decision> = {}): Decision {
  return {
    id: 'test-id-1',
    question: 'Which approach?',
    context: 'We need to decide',
    options: ['A', 'B'],
    answer: null,
    resolved: false,
    timestamp: '2026-01-01T00:00:00.000Z',
    resolvedAt: null,
    ...overrides,
  };
}

describe('carryForwardDecisions', () => {
  it('returns empty array when no previous decisions and no new input', () => {
    const result = carryForwardDecisions([]);
    expect(result).toEqual([]);
  });

  it('carries forward previous decisions unchanged', () => {
    const prev = [makeDecision()];
    const result = carryForwardDecisions(prev);
    expect(result).toHaveLength(1);
    expect(result[0].question).toBe('Which approach?');
    expect(result[0].resolved).toBe(false);
  });

  it('does not mutate the input array', () => {
    const prev = [makeDecision()];
    const result = carryForwardDecisions(prev, undefined, 'test-id-1', 'A');
    expect(prev[0].resolved).toBe(false); // original unchanged
    expect(result[0].resolved).toBe(true); // copy changed
  });

  it('adds a new decision', () => {
    const result = carryForwardDecisions([], 'Should we use Redis?');
    expect(result).toHaveLength(1);
    expect(result[0].question).toBe('Should we use Redis?');
    expect(result[0].resolved).toBe(false);
    expect(result[0].id).toBeTruthy();
    expect(result[0].timestamp).toBeTruthy();
  });

  it('resolves an existing decision', () => {
    const prev = [makeDecision({ id: 'resolve-me' })];
    const result = carryForwardDecisions(prev, undefined, 'resolve-me', 'Option A');
    expect(result).toHaveLength(1);
    expect(result[0].resolved).toBe(true);
    expect(result[0].answer).toBe('Option A');
    expect(result[0].resolvedAt).toBeTruthy();
  });

  it('adds and resolves in a single call', () => {
    const prev = [makeDecision({ id: 'old-one' })];
    const result = carryForwardDecisions(prev, 'New question?', 'old-one', 'Done');
    expect(result).toHaveLength(2);
    expect(result[0].resolved).toBe(true);
    expect(result[0].answer).toBe('Done');
    expect(result[1].question).toBe('New question?');
    expect(result[1].resolved).toBe(false);
  });

  it('ignores resolvedId that does not exist', () => {
    const prev = [makeDecision()];
    const result = carryForwardDecisions(prev, undefined, 'nonexistent-id', 'Answer');
    expect(result).toHaveLength(1);
    expect(result[0].resolved).toBe(false);
  });

  it('generates unique IDs for new decisions', () => {
    const r1 = carryForwardDecisions([], 'Q1');
    const r2 = carryForwardDecisions([], 'Q2');
    expect(r1[0].id).not.toBe(r2[0].id);
  });
});
