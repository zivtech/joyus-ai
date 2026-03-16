/**
 * Tests for ReviewGate and DecisionRecorder.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ReviewGate } from '../../../src/pipelines/review/gate.js';
import { DecisionRecorder } from '../../../src/pipelines/review/decision.js';
import type { PipelineExecution, ExecutionStep } from '../../../src/pipelines/schema.js';
import type { ArtifactRef } from '../../../src/pipelines/types.js';

// ============================================================
// HELPERS
// ============================================================

function makeExecution(overrides: Partial<PipelineExecution> = {}): PipelineExecution {
  return {
    id: 'exec-1',
    pipelineId: 'pipe-1',
    tenantId: 'tenant-a',
    triggerEventId: 'trig-1',
    status: 'running',
    stepsCompleted: 0,
    stepsTotal: 3,
    currentStepPosition: 2,
    triggerChainDepth: 0,
    outputArtifacts: [],
    errorDetail: null,
    startedAt: new Date(),
    completedAt: null,
    ...overrides,
  };
}

function makeGateStep(overrides: Partial<ExecutionStep> = {}): ExecutionStep {
  return {
    id: 'estep-gate-1',
    executionId: 'exec-1',
    stepId: 'step-gate-1',
    position: 2,
    status: 'pending',
    attempts: 0,
    idempotencyKey: 'idem-1',
    inputData: null,
    outputData: null,
    errorDetail: null,
    startedAt: null,
    completedAt: null,
    ...overrides,
  };
}

function makeArtifacts(count: number): ArtifactRef[] {
  return Array.from({ length: count }, (_, i) => ({
    type: 'content',
    id: `artifact-${i + 1}`,
    metadata: { index: i },
  }));
}

// ============================================================
// MOCK DB FACTORY
// ============================================================

function makeMockDb() {
  const insertedDecisions: Record<string, unknown>[] = [];
  // All update payloads in call order: first call = executionStep, second = execution
  const allUpdates: Record<string, unknown>[] = [];

  const db = {
    _insertedDecisions: insertedDecisions,
    get _updatedExecutionSteps() {
      // pauseAtGate: first update call is executionSteps
      return allUpdates.filter((_, i) => i % 2 === 0);
    },
    get _updatedExecutions() {
      // pauseAtGate: second update call is pipelineExecutions
      return allUpdates.filter((_, i) => i % 2 === 1);
    },
    insert: vi.fn().mockReturnValue({
      values: vi.fn().mockImplementation((rows) => {
        const arr = Array.isArray(rows) ? rows : [rows];
        insertedDecisions.push(...arr);
        return Promise.resolve();
      }),
    }),
    update: vi.fn().mockImplementation(() => ({
      set: vi.fn().mockImplementation((data: Record<string, unknown>) => ({
        where: vi.fn().mockImplementation(() => {
          allUpdates.push(data);
          return Promise.resolve();
        }),
      })),
    })),
    select: vi.fn(),
  };

  return db;
}

// ============================================================
// REVIEW GATE TESTS
// ============================================================

describe('ReviewGate', () => {
  let db: ReturnType<typeof makeMockDb>;
  let gate: ReviewGate;

  beforeEach(() => {
    db = makeMockDb();
    gate = new ReviewGate(db as unknown as import('drizzle-orm/node-postgres').NodePgDatabase);
  });

  it('creates one decision per artifact and sets paused_at_gate', async () => {
    const execution = makeExecution();
    const gateStep = makeGateStep();
    const artifacts = makeArtifacts(3);

    const ids = await gate.pauseAtGate(execution, gateStep, artifacts);

    expect(ids).toHaveLength(3);
    expect(db._insertedDecisions).toHaveLength(3);

    // All decisions should be pending
    for (const d of db._insertedDecisions as Record<string, unknown>[]) {
      expect(d['status']).toBe('pending');
      expect(d['tenantId']).toBe('tenant-a');
      expect(d['executionId']).toBe('exec-1');
      expect(d['executionStepId']).toBe('estep-gate-1');
    }

    // executionStep set to running, execution set to paused_at_gate
    const stepUpdates = db._updatedExecutionSteps as Record<string, unknown>[];
    expect(stepUpdates.some((u) => u['status'] === 'running')).toBe(true);

    const execUpdates = db._updatedExecutions as Record<string, unknown>[];
    expect(execUpdates.some((u) => u['status'] === 'paused_at_gate')).toBe(true);
  });

  it('returns empty array and makes no DB writes when no artifacts', async () => {
    const execution = makeExecution();
    const gateStep = makeGateStep();

    const ids = await gate.pauseAtGate(execution, gateStep, []);

    expect(ids).toHaveLength(0);
    expect(db.insert).not.toHaveBeenCalled();
    expect(db.update).not.toHaveBeenCalled();
  });

  it('stores profileVersionRef when provided', async () => {
    const execution = makeExecution();
    const gateStep = makeGateStep();
    const artifacts = makeArtifacts(1);

    await gate.pauseAtGate(execution, gateStep, artifacts, 'profile-v2');

    const decisions = db._insertedDecisions as Record<string, unknown>[];
    expect(decisions[0]['profileVersionRef']).toBe('profile-v2');
  });
});

// ============================================================
// DECISION RECORDER TESTS
// ============================================================

describe('DecisionRecorder', () => {
  function makeRecorder(selectResults: Record<string, unknown[]>) {
    const updatedRows: Record<string, unknown>[] = [];
    let outputArtifacts: unknown[] = [];

    const db = {
      _updatedRows: updatedRows,
      _outputArtifacts: () => outputArtifacts,
      select: vi.fn().mockImplementation(() => ({
        from: vi.fn().mockImplementation((table) => ({
          where: vi.fn().mockImplementation((condition) => {
            // Return results keyed by table name reference
            const tableKey = String(table);
            // Simple mock: return the preconfigured result for this call sequence
            const key = Object.keys(selectResults).find((k) => tableKey.includes(k));
            return Promise.resolve(key ? selectResults[key] : []);
          }),
        })),
      })),
      update: vi.fn().mockImplementation(() => ({
        set: vi.fn().mockImplementation((data) => ({
          where: vi.fn().mockImplementation(() => {
            updatedRows.push(data);
            if ('outputArtifacts' in data) {
              outputArtifacts = data['outputArtifacts'] as unknown[];
            }
            return Promise.resolve();
          }),
        })),
      })),
      insert: vi.fn().mockReturnValue({
        values: vi.fn().mockResolvedValue(undefined),
      }),
    };

    return {
      db,
      recorder: new DecisionRecorder(
        db as unknown as import('drizzle-orm/node-postgres').NodePgDatabase,
      ),
    };
  }

  it('approves a decision and resumes execution when all complete', async () => {
    const decision = {
      id: 'dec-1',
      tenantId: 'tenant-a',
      executionId: 'exec-1',
      executionStepId: 'estep-gate-1',
      status: 'pending',
      artifactRef: { type: 'content', id: 'artifact-1' },
      feedback: null,
    };

    const execRow = makeExecution();
    const stepRow = makeGateStep();

    // Each select() call returns results for a specific query
    // We need to handle multiple sequential calls
    let selectCallCount = 0;
    const db = {
      _updatedRows: [] as Record<string, unknown>[],
      select: vi.fn().mockImplementation(() => {
        const callIndex = selectCallCount++;
        return {
          from: vi.fn().mockReturnValue({
            where: vi.fn().mockImplementation(() => {
              // Call 0: load decision by id -> [decision]
              // Call 1: areAllDecisionsComplete pending query -> [] (none pending)
              // Call 2: resumeExecution -> all decisions -> [decision with approved]
              // Call 3: load gate step -> [stepRow]
              // Call 4: load execution -> [execRow]
              if (callIndex === 0) return Promise.resolve([decision]);
              if (callIndex === 1) return Promise.resolve([]); // no pending
              if (callIndex === 2) return Promise.resolve([{ ...decision, status: 'approved' }]);
              if (callIndex === 3) return Promise.resolve([stepRow]);
              if (callIndex === 4) return Promise.resolve([execRow]);
              return Promise.resolve([]);
            }),
          }),
        };
      }),
      update: vi.fn().mockImplementation(() => ({
        set: vi.fn().mockImplementation((data: Record<string, unknown>) => ({
          where: vi.fn().mockImplementation(() => {
            (db._updatedRows as Record<string, unknown>[]).push(data);
            return Promise.resolve();
          }),
        })),
      })),
    };

    const recorder = new DecisionRecorder(
      db as unknown as import('drizzle-orm/node-postgres').NodePgDatabase,
    );

    const result = await recorder.recordDecision('dec-1', 'tenant-a', 'approved', 'reviewer-1');

    expect(result.allDecisionsComplete).toBe(true);
    expect(result.executionId).toBe('exec-1');

    // Execution should have been set to 'running'
    const execUpdate = (db._updatedRows as Record<string, unknown>[]).find(
      (r) => r['status'] === 'running',
    );
    expect(execUpdate).toBeDefined();
  });

  it('rejects a decision with feedback and stays paused when others pending', async () => {
    const decision = {
      id: 'dec-2',
      tenantId: 'tenant-a',
      executionId: 'exec-1',
      executionStepId: 'estep-gate-1',
      status: 'pending',
      artifactRef: { type: 'content', id: 'artifact-2' },
      feedback: null,
    };

    let selectCallCount = 0;
    const db = {
      _updatedRows: [] as Record<string, unknown>[],
      select: vi.fn().mockImplementation(() => {
        const callIndex = selectCallCount++;
        return {
          from: vi.fn().mockReturnValue({
            where: vi.fn().mockImplementation(() => {
              if (callIndex === 0) return Promise.resolve([decision]);
              // Still one pending decision remaining
              if (callIndex === 1) return Promise.resolve([{ ...decision, id: 'dec-3', status: 'pending' }]);
              return Promise.resolve([]);
            }),
          }),
        };
      }),
      update: vi.fn().mockImplementation(() => ({
        set: vi.fn().mockImplementation((data: Record<string, unknown>) => ({
          where: vi.fn().mockImplementation(() => {
            (db._updatedRows as Record<string, unknown>[]).push(data);
            return Promise.resolve();
          }),
        })),
      })),
    };

    const recorder = new DecisionRecorder(
      db as unknown as import('drizzle-orm/node-postgres').NodePgDatabase,
    );

    const result = await recorder.recordDecision(
      'dec-2',
      'tenant-a',
      'rejected',
      'reviewer-1',
      { reason: 'Quality too low', category: 'quality' },
    );

    expect(result.allDecisionsComplete).toBe(false);

    // Execution should NOT be set to running
    const execUpdate = (db._updatedRows as Record<string, unknown>[]).find(
      (r) => r['status'] === 'running',
    );
    expect(execUpdate).toBeUndefined();

    // The decision update should include feedback
    const decisionUpdate = (db._updatedRows as Record<string, unknown>[]).find(
      (r) => r['status'] === 'rejected',
    );
    expect(decisionUpdate).toBeDefined();
  });

  it('throws on cross-tenant decision attempt', async () => {
    const decision = {
      id: 'dec-1',
      tenantId: 'tenant-a',
      executionId: 'exec-1',
      executionStepId: 'estep-gate-1',
      status: 'pending',
      artifactRef: { type: 'content', id: 'artifact-1' },
    };

    const db = {
      select: vi.fn().mockReturnValue({
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockResolvedValue([decision]),
        }),
      }),
      update: vi.fn(),
    };

    const recorder = new DecisionRecorder(
      db as unknown as import('drizzle-orm/node-postgres').NodePgDatabase,
    );

    await expect(
      recorder.recordDecision('dec-1', 'tenant-b', 'approved', 'reviewer-1'),
    ).rejects.toThrow('Cross-tenant access denied');
  });

  it('throws on duplicate decision (already resolved)', async () => {
    const decision = {
      id: 'dec-1',
      tenantId: 'tenant-a',
      executionId: 'exec-1',
      executionStepId: 'estep-gate-1',
      status: 'approved', // already decided
      artifactRef: { type: 'content', id: 'artifact-1' },
    };

    const db = {
      select: vi.fn().mockReturnValue({
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockResolvedValue([decision]),
        }),
      }),
      update: vi.fn(),
    };

    const recorder = new DecisionRecorder(
      db as unknown as import('drizzle-orm/node-postgres').NodePgDatabase,
    );

    await expect(
      recorder.recordDecision('dec-1', 'tenant-a', 'approved', 'reviewer-1'),
    ).rejects.toThrow("already resolved");
  });

  it('builds correct approval rate when mix of approved and rejected', async () => {
    const decision = {
      id: 'dec-1',
      tenantId: 'tenant-a',
      executionId: 'exec-1',
      executionStepId: 'estep-gate-1',
      status: 'pending',
      artifactRef: { type: 'content', id: 'artifact-1' },
      feedback: null,
    };

    const allDecisions = [
      { ...decision, id: 'dec-1', status: 'approved', artifactRef: { type: 'content', id: 'a1' } },
      { ...decision, id: 'dec-2', status: 'approved', artifactRef: { type: 'content', id: 'a2' } },
      { ...decision, id: 'dec-3', status: 'rejected', artifactRef: { type: 'content', id: 'a3' }, feedback: { reason: 'Poor quality', category: 'quality' } },
    ];

    const execRow = makeExecution();
    const stepRow = makeGateStep();

    let selectCallCount = 0;
    const capturedOutputArtifacts: unknown[] = [];

    const db = {
      select: vi.fn().mockImplementation(() => {
        const callIndex = selectCallCount++;
        return {
          from: vi.fn().mockReturnValue({
            where: vi.fn().mockImplementation(() => {
              if (callIndex === 0) return Promise.resolve([decision]);
              if (callIndex === 1) return Promise.resolve([]); // no pending
              if (callIndex === 2) return Promise.resolve(allDecisions);
              if (callIndex === 3) return Promise.resolve([stepRow]);
              if (callIndex === 4) return Promise.resolve([execRow]);
              return Promise.resolve([]);
            }),
          }),
        };
      }),
      update: vi.fn().mockImplementation(() => ({
        set: vi.fn().mockImplementation((data: Record<string, unknown>) => ({
          where: vi.fn().mockImplementation(() => {
            if ('outputArtifacts' in data) {
              capturedOutputArtifacts.push(...(data['outputArtifacts'] as unknown[]));
            }
            return Promise.resolve();
          }),
        })),
      })),
    };

    const recorder = new DecisionRecorder(
      db as unknown as import('drizzle-orm/node-postgres').NodePgDatabase,
    );

    await recorder.recordDecision('dec-1', 'tenant-a', 'approved', 'reviewer-1');

    // Find the gate result that was appended
    const gateResult = capturedOutputArtifacts.find(
      (item) => typeof item === 'object' && item !== null && 'approvalRate' in (item as object),
    ) as { approvalRate: number; approvedArtifacts: unknown[]; rejectedArtifacts: unknown[] } | undefined;

    expect(gateResult).toBeDefined();
    expect(gateResult!.approvalRate).toBeCloseTo(2 / 3);
    expect(gateResult!.approvedArtifacts).toHaveLength(2);
    expect(gateResult!.rejectedArtifacts).toHaveLength(1);
  });
});
