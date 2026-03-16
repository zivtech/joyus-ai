/**
 * QualitySignalEmitter unit tests.
 *
 * Uses a mock NodePgDatabase. The emitter queries reviewDecisions and
 * pipelineExecutions, then inserts into qualitySignals.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { QualitySignalEmitter } from '../../../src/pipelines/analytics/quality-signals.js';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';

// ---------------------------------------------------------------------------
// Mock DB builder
// ---------------------------------------------------------------------------

type Row = Record<string, unknown>;

/**
 * Build a mock DB where each .select() call pops the next entry from
 * selectSequence. insert().values() captures calls and optionally returns rows.
 */
function buildMockDb(selectSequence: Row[][]): {
  db: NodePgDatabase;
  insertedSignals: Row[];
} {
  const insertedSignals: Row[] = [];
  let selectIdx = 0;

  const makeChain = (rows: Row[]): object => {
    const handler = {
      get(_: object, prop: string | symbol): unknown {
        if (prop === 'then') {
          return (resolve: (v: Row[]) => void, reject: (e: unknown) => void) =>
            Promise.resolve(rows).then(resolve, reject);
        }
        // Any method call returns the same proxy (supports chaining)
        return (..._args: unknown[]) => new Proxy({}, handler);
      },
    };
    return new Proxy({}, handler);
  };

  const db = {
    select: vi.fn((_fields?: unknown) => {
      const idx = selectIdx++;
      const rows = selectSequence[idx] ?? [];
      return makeChain(rows);
    }),
    insert: vi.fn(() => ({
      values: vi.fn((vals: Row) => {
        insertedSignals.push(vals);
        return {
          returning: vi.fn(() => Promise.resolve([vals])),
        };
      }),
    })),
    update: vi.fn(() => ({
      set: vi.fn(() => ({
        where: vi.fn(() => Promise.resolve()),
      })),
    })),
  } as unknown as NodePgDatabase;

  return { db, insertedSignals };
}

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const PIPELINE_ID = 'pipe-1';
const TENANT_ID = 'tenant-1';
const EXEC_IDS = ['exec-1', 'exec-2', 'exec-3', 'exec-4', 'exec-5'];

function makeExecRows(ids: string[]): Row[] {
  return ids.map((id) => ({ id }));
}

function makeDecisions(approved: number, rejected: number, execId = 'exec-1'): Row[] {
  const rows: Row[] = [];
  for (let i = 0; i < approved; i++) {
    rows.push({
      id: `d-a${i}`,
      executionId: execId,
      status: 'approved',
      decidedAt: new Date(),
      createdAt: new Date(),
      tenantId: TENANT_ID,
    });
  }
  for (let i = 0; i < rejected; i++) {
    rows.push({
      id: `d-r${i}`,
      executionId: execId,
      status: 'rejected',
      decidedAt: new Date(),
      createdAt: new Date(),
      tenantId: TENANT_ID,
    });
  }
  return rows;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('QualitySignalEmitter.checkAndEmit', () => {
  it('below threshold (30%): no signal emitted', async () => {
    // 7 approved, 3 rejected = 30% rejection rate — NOT strictly > 0.3
    const decisions = makeDecisions(7, 3, 'exec-1');
    const execRows = makeExecRows(['exec-1']);

    // selectSequence: [reviewDecisions, pipelineExecutions]
    const { db, insertedSignals } = buildMockDb([decisions, execRows]);

    const emitter = new QualitySignalEmitter(db, { threshold: 0.3, windowSize: 10, cooldownMs: 86400000 });
    const signal = await emitter.checkAndEmit(PIPELINE_ID, TENANT_ID);

    expect(signal).toBeNull();
    expect(insertedSignals).toHaveLength(0);
  });

  it('above threshold (40% > 30%): signal emitted', async () => {
    // 6 approved, 4 rejected = 40% rejection rate > 0.3
    const decisions = makeDecisions(6, 4, 'exec-1');
    const execRows = makeExecRows(['exec-1']);

    const { db, insertedSignals } = buildMockDb([decisions, execRows]);

    const emitter = new QualitySignalEmitter(db, { threshold: 0.3, windowSize: 10, cooldownMs: 86400000 });
    const signal = await emitter.checkAndEmit(PIPELINE_ID, TENANT_ID);

    expect(signal).not.toBeNull();
    expect(signal?.signalType).toBe('high_rejection_rate');
    expect(signal?.pipelineId).toBe(PIPELINE_ID);
    expect(signal?.tenantId).toBe(TENANT_ID);
    expect(insertedSignals).toHaveLength(1);
  });

  it('cooldown prevents re-emit within cooldown window', async () => {
    const decisions = makeDecisions(6, 4, 'exec-1');
    const execRows = makeExecRows(['exec-1']);

    // Need 4 select calls: 2 for first checkAndEmit, 2 for second
    const { db, insertedSignals } = buildMockDb([
      decisions, execRows,  // first call
      decisions, execRows,  // second call
    ]);

    const emitter = new QualitySignalEmitter(db, { threshold: 0.3, windowSize: 10, cooldownMs: 86400000 });

    const signal1 = await emitter.checkAndEmit(PIPELINE_ID, TENANT_ID);
    expect(signal1).not.toBeNull();

    // Second call — still in cooldown
    const signal2 = await emitter.checkAndEmit(PIPELINE_ID, TENANT_ID);
    expect(signal2).toBeNull();
    expect(insertedSignals).toHaveLength(1); // only one insert
  });

  it('cooldown expired: re-emits signal', async () => {
    const decisions = makeDecisions(6, 4, 'exec-1');
    const execRows = makeExecRows(['exec-1']);

    const { db, insertedSignals } = buildMockDb([
      decisions, execRows,
      decisions, execRows,
    ]);

    // Very short cooldown (1ms) so it expires immediately
    const emitter = new QualitySignalEmitter(db, { threshold: 0.3, windowSize: 10, cooldownMs: 1 });

    const signal1 = await emitter.checkAndEmit(PIPELINE_ID, TENANT_ID);
    expect(signal1).not.toBeNull();

    // Wait 2ms for cooldown to expire
    await new Promise((r) => setTimeout(r, 2));

    const signal2 = await emitter.checkAndEmit(PIPELINE_ID, TENANT_ID);
    expect(signal2).not.toBeNull();
    expect(insertedSignals).toHaveLength(2);
  });

  it('small sample (<windowSize): uses all available decisions', async () => {
    // Only 5 decisions available (windowSize=10), 3 rejected = 60% > 30%
    const decisions = makeDecisions(2, 3, 'exec-1');
    const execRows = makeExecRows(['exec-1']);

    const { db, insertedSignals } = buildMockDb([decisions, execRows]);

    const emitter = new QualitySignalEmitter(db, { threshold: 0.3, windowSize: 10, cooldownMs: 86400000 });
    const signal = await emitter.checkAndEmit(PIPELINE_ID, TENANT_ID);

    expect(signal).not.toBeNull();
    expect(insertedSignals).toHaveLength(1);
  });

  it('no decisions: returns null', async () => {
    const execRows = makeExecRows(['exec-1']);

    const { db, insertedSignals } = buildMockDb([
      [],       // reviewDecisions: empty
      execRows, // pipelineExecutions
    ]);

    const emitter = new QualitySignalEmitter(db, { threshold: 0.3, windowSize: 10, cooldownMs: 86400000 });
    const signal = await emitter.checkAndEmit(PIPELINE_ID, TENANT_ID);

    expect(signal).toBeNull();
    expect(insertedSignals).toHaveLength(0);
  });

  it('severity is critical when rejection rate > 60%', async () => {
    // 3 approved, 7 rejected = 70% > 60% → critical
    const decisions = makeDecisions(3, 7, 'exec-1');
    const execRows = makeExecRows(['exec-1']);

    const { db } = buildMockDb([decisions, execRows]);

    const emitter = new QualitySignalEmitter(db, { threshold: 0.3, windowSize: 10, cooldownMs: 86400000 });
    const signal = await emitter.checkAndEmit(PIPELINE_ID, TENANT_ID);

    expect(signal?.severity).toBe('critical');
  });

  it('severity is warning when rejection rate between threshold and 60%', async () => {
    // 6 approved, 4 rejected = 40% → warning
    const decisions = makeDecisions(6, 4, 'exec-1');
    const execRows = makeExecRows(['exec-1']);

    const { db } = buildMockDb([decisions, execRows]);

    const emitter = new QualitySignalEmitter(db, { threshold: 0.3, windowSize: 10, cooldownMs: 86400000 });
    const signal = await emitter.checkAndEmit(PIPELINE_ID, TENANT_ID);

    expect(signal?.severity).toBe('warning');
  });
});
