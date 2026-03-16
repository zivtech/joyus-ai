/**
 * MetricsAggregator unit tests.
 *
 * Uses a mock NodePgDatabase that intercepts select/insert/update calls
 * and returns controlled fixture data.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { MetricsAggregator } from '../../../src/pipelines/analytics/aggregator.js';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';

// ---------------------------------------------------------------------------
// Minimal mock DB builder
// ---------------------------------------------------------------------------

type SelectResult = Record<string, unknown>[];

/**
 * Build a mock DB where `.select().from().where()` chains return the given
 * rows in sequence (one array per `.select()` call, in order).
 */
function buildMockDb(selectQueues: SelectResult[][]): {
  db: NodePgDatabase;
  insertCalls: unknown[][];
  updateCalls: unknown[][];
} {
  const insertCalls: unknown[][] = [];
  const updateCalls: unknown[][] = [];

  // Each entry in selectQueues[i] is the array of rows returned for the i-th
  // .select() chain call.
  let selectCallCount = 0;

  const makeChain = (rows: SelectResult): object => {
    const chain: Record<string, () => object> = {};
    const terminal = () => Promise.resolve(rows);
    chain['from'] = () => chain;
    chain['where'] = () => chain;
    chain['orderBy'] = () => chain;
    chain['limit'] = () => chain;
    chain['then'] = (_resolve: (v: SelectResult) => void, _reject: (e: unknown) => void) => {
      return Promise.resolve(rows).then(_resolve, _reject);
    };
    // Make the chain itself thenable AND callable for .where().where() etc.
    return new Proxy(chain, {
      get(target, prop) {
        if (prop === 'then') return terminal;
        if (prop in target) return target[prop as string];
        return () => makeChain(rows);
      },
    });
  };

  const db = {
    select: vi.fn(() => {
      const idx = selectCallCount;
      selectCallCount++;
      const queue = selectQueues[idx] ?? [];
      // flatten: queue is an array of row arrays; we want a single row array
      const rows: SelectResult = (queue as unknown as SelectResult[][]).flat
        ? (queue as unknown as SelectResult[])
        : [];
      return makeChain(rows);
    }),
    insert: vi.fn(() => ({
      values: vi.fn((vals: unknown) => {
        insertCalls.push([vals]);
        return { returning: vi.fn(() => Promise.resolve([vals])) };
      }),
    })),
    update: vi.fn(() => ({
      set: vi.fn(() => ({
        where: vi.fn((vals: unknown) => {
          updateCalls.push([vals]);
          return Promise.resolve();
        }),
      })),
    })),
  } as unknown as NodePgDatabase;

  return { db, insertCalls, updateCalls };
}

// ---------------------------------------------------------------------------
// Helpers to build fixture rows
// ---------------------------------------------------------------------------

const NOW = new Date('2026-03-01T12:00:00Z');
const WIN_START = new Date('2026-02-01T00:00:00Z');
const WIN_END = new Date('2026-03-01T00:00:00Z');

function makeExec(overrides: Partial<{
  id: string;
  pipelineId: string;
  tenantId: string;
  status: string;
  startedAt: Date;
  completedAt: Date | null;
  errorDetail: Record<string, unknown> | null;
}> = {}): Record<string, unknown> {
  return {
    id: 'exec-1',
    pipelineId: 'pipe-1',
    tenantId: 'tenant-1',
    status: 'completed',
    startedAt: new Date('2026-02-15T10:00:00Z'),
    completedAt: new Date('2026-02-15T10:01:00Z'), // 60_000 ms
    errorDetail: null,
    ...overrides,
  };
}

function makeDecision(overrides: Partial<{
  id: string;
  executionId: string;
  status: string;
  createdAt: Date;
  decidedAt: Date | null;
  tenantId: string;
}> = {}): Record<string, unknown> {
  return {
    id: 'dec-1',
    executionId: 'exec-1',
    status: 'approved',
    createdAt: new Date('2026-02-15T10:01:00Z'),
    decidedAt: new Date('2026-02-15T11:01:00Z'), // 3_600_000 ms review time
    tenantId: 'tenant-1',
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('MetricsAggregator.computeMetrics', () => {
  it('all successful: 10 completed executions → success=100%, failure=0', async () => {
    const executions = Array.from({ length: 10 }, (_, i) =>
      makeExec({
        id: `exec-${i}`,
        startedAt: new Date('2026-02-15T10:00:00Z'),
        completedAt: new Date('2026-02-15T10:01:00Z'),
      }),
    );

    const { db } = buildMockDb([
      executions as SelectResult[],   // pipelineExecutions query
      [] as SelectResult[],           // reviewDecisions query (no decisions)
    ]);

    const agg = new MetricsAggregator(db);
    const result = await agg.computeMetrics('pipe-1', 'tenant-1', WIN_START, WIN_END);

    expect(result.totalExecutions).toBe(10);
    expect(result.successCount).toBe(10);
    expect(result.failureCount).toBe(0);
    expect(result.cancelledCount).toBe(0);
    expect(result.reviewApprovalRate).toBeNull();
    expect(result.reviewRejectionRate).toBeNull();
  });

  it('mixed outcomes: 15 success, 3 failed, 2 cancelled', async () => {
    const executions = [
      ...Array.from({ length: 15 }, (_, i) =>
        makeExec({ id: `exec-s${i}`, status: 'completed' }),
      ),
      ...Array.from({ length: 3 }, (_, i) =>
        makeExec({ id: `exec-f${i}`, status: 'failed', completedAt: null }),
      ),
      ...Array.from({ length: 2 }, (_, i) =>
        makeExec({ id: `exec-c${i}`, status: 'cancelled', completedAt: null }),
      ),
    ];

    const { db } = buildMockDb([executions as SelectResult[], [] as SelectResult[]]);

    const agg = new MetricsAggregator(db);
    const result = await agg.computeMetrics('pipe-1', 'tenant-1', WIN_START, WIN_END);

    expect(result.totalExecutions).toBe(20);
    expect(result.successCount).toBe(15);
    expect(result.failureCount).toBe(3);
    expect(result.cancelledCount).toBe(2);
  });

  it('duration: known values → correct mean and p95', async () => {
    // 4 executions with durations: 100, 200, 300, 400 ms
    const base = new Date('2026-02-15T10:00:00Z');
    const executions = [100, 200, 300, 400].map((dur, i) =>
      makeExec({
        id: `exec-${i}`,
        startedAt: base,
        completedAt: new Date(base.getTime() + dur),
      }),
    );

    const { db } = buildMockDb([executions as SelectResult[], [] as SelectResult[]]);

    const agg = new MetricsAggregator(db);
    const result = await agg.computeMetrics('pipe-1', 'tenant-1', WIN_START, WIN_END);

    expect(result.meanDurationMs).toBe(250); // (100+200+300+400)/4
    // p95: n=4, ceil(0.95*4)-1 = ceil(3.8)-1 = 4-1 = 3 → sorted[3] = 400
    expect(result.p95DurationMs).toBe(400);
  });

  it('p95 edge case: 1 execution', async () => {
    const base = new Date('2026-02-15T10:00:00Z');
    const executions = [makeExec({ startedAt: base, completedAt: new Date(base.getTime() + 500) })];

    const { db } = buildMockDb([executions as SelectResult[], [] as SelectResult[]]);

    const agg = new MetricsAggregator(db);
    const result = await agg.computeMetrics('pipe-1', 'tenant-1', WIN_START, WIN_END);

    expect(result.meanDurationMs).toBe(500);
    // p95: n=1, ceil(0.95*1)-1 = ceil(0.95)-1 = 1-1 = 0 → sorted[0] = 500
    expect(result.p95DurationMs).toBe(500);
  });

  it('p95 edge case: 2 executions', async () => {
    const base = new Date('2026-02-15T10:00:00Z');
    const executions = [
      makeExec({ id: 'e1', startedAt: base, completedAt: new Date(base.getTime() + 100) }),
      makeExec({ id: 'e2', startedAt: base, completedAt: new Date(base.getTime() + 200) }),
    ];

    const { db } = buildMockDb([executions as SelectResult[], [] as SelectResult[]]);

    const agg = new MetricsAggregator(db);
    const result = await agg.computeMetrics('pipe-1', 'tenant-1', WIN_START, WIN_END);

    // p95: n=2, ceil(0.95*2)-1 = ceil(1.9)-1 = 2-1 = 1 → sorted[1] = 200
    expect(result.p95DurationMs).toBe(200);
  });

  it('failure breakdown grouped correctly by error type', async () => {
    const executions = [
      makeExec({ id: 'f1', status: 'failed', completedAt: null, errorDetail: { type: 'timeout' } }),
      makeExec({ id: 'f2', status: 'failed', completedAt: null, errorDetail: { type: 'timeout' } }),
      makeExec({ id: 'f3', status: 'failed', completedAt: null, errorDetail: { type: 'network' } }),
      makeExec({ id: 'f4', status: 'failed', completedAt: null, errorDetail: null }),
    ];

    const { db } = buildMockDb([executions as SelectResult[], [] as SelectResult[]]);

    const agg = new MetricsAggregator(db);
    const result = await agg.computeMetrics('pipe-1', 'tenant-1', WIN_START, WIN_END);

    expect(result.failureBreakdown).toEqual({ timeout: 2, network: 1, unknown: 1 });
  });

  it('review rates: 8 approved, 2 rejected', async () => {
    const executions = [makeExec({ id: 'exec-1' })];
    const decisions = [
      ...Array.from({ length: 8 }, (_, i) =>
        makeDecision({ id: `d-a${i}`, status: 'approved' }),
      ),
      ...Array.from({ length: 2 }, (_, i) =>
        makeDecision({ id: `d-r${i}`, status: 'rejected' }),
      ),
    ];

    const { db } = buildMockDb([executions as SelectResult[], decisions as SelectResult[]]);

    const agg = new MetricsAggregator(db);
    const result = await agg.computeMetrics('pipe-1', 'tenant-1', WIN_START, WIN_END);

    expect(result.reviewApprovalRate).toBeCloseTo(0.8);
    expect(result.reviewRejectionRate).toBeCloseTo(0.2);
    expect(result.meanTimeToReviewMs).toBe(3_600_000); // all decisions have same review time
  });

  it('empty window: all null/0', async () => {
    const { db } = buildMockDb([[] as SelectResult[]]);

    const agg = new MetricsAggregator(db);
    const result = await agg.computeMetrics('pipe-1', 'tenant-1', WIN_START, WIN_END);

    expect(result.totalExecutions).toBe(0);
    expect(result.successCount).toBe(0);
    expect(result.failureCount).toBe(0);
    expect(result.cancelledCount).toBe(0);
    expect(result.meanDurationMs).toBeNull();
    expect(result.p95DurationMs).toBeNull();
    expect(result.reviewApprovalRate).toBeNull();
    expect(result.reviewRejectionRate).toBeNull();
    expect(result.meanTimeToReviewMs).toBeNull();
    expect(result.failureBreakdown).toEqual({});
  });

  it('refresh upsert: inserts on first call, updates on second', async () => {
    const executions = [makeExec()];
    const decisions: SelectResult[] = [];

    // First call: no existing metrics row → insert
    // Calls: executions, decisions, existing-metrics (empty)
    const { db: db1, insertCalls } = buildMockDb([
      executions as SelectResult[],
      decisions,
      [] as SelectResult[], // no existing metrics
    ]);

    const agg1 = new MetricsAggregator(db1);
    await agg1.refreshMetrics('pipe-1', 'tenant-1');
    expect(insertCalls.length).toBe(1);

    // Second call: existing metrics row → update
    const fakeMetricRow = [{ id: 'metric-1' }];
    const { db: db2, updateCalls } = buildMockDb([
      executions as SelectResult[],
      decisions,
      fakeMetricRow as SelectResult[], // existing row found
    ]);

    const agg2 = new MetricsAggregator(db2);
    await agg2.refreshMetrics('pipe-1', 'tenant-1');
    expect(updateCalls.length).toBe(1);
  });
});
