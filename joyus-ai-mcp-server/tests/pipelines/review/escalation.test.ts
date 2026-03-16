/**
 * Tests for EscalationChecker.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { EscalationChecker } from '../../../src/pipelines/review/escalation.js';
import type { NotificationService } from '../../../src/pipelines/review/escalation.js';

// ============================================================
// HELPERS
// ============================================================

function hoursAgo(hours: number): Date {
  return new Date(Date.now() - hours * 60 * 60 * 1000);
}

function makeExecution(overrides: Record<string, unknown> = {}) {
  return {
    id: 'exec-1',
    pipelineId: 'pipe-1',
    tenantId: 'tenant-a',
    status: 'paused_at_gate',
    startedAt: hoursAgo(50), // 50 hours ago — past default 48h timeout
    ...overrides,
  };
}

function makePipeline(overrides: Record<string, unknown> = {}) {
  return {
    id: 'pipe-1',
    tenantId: 'tenant-a',
    reviewGateTimeoutHours: 48,
    ...overrides,
  };
}

function makeGateStep(overrides: Record<string, unknown> = {}) {
  return {
    id: 'estep-gate-1',
    executionId: 'exec-1',
    stepId: 'step-gate-1',
    position: 2,
    status: 'running',
    ...overrides,
  };
}

function makePendingDecision(id: string, escalatedAt: Date | null = null) {
  return {
    id,
    executionId: 'exec-1',
    executionStepId: 'estep-gate-1',
    tenantId: 'tenant-a',
    status: 'pending',
    escalatedAt,
  };
}

// ============================================================
// MOCK DB FACTORY
// ============================================================

interface SelectCall {
  result: Record<string, unknown>[];
}

function makeMockDb(selectSequence: SelectCall[]) {
  let callIndex = 0;
  const updatedRows: Record<string, unknown>[] = [];

  const db = {
    _updatedRows: updatedRows,
    select: vi.fn().mockImplementation(() => ({
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockImplementation(() => {
          const idx = callIndex++;
          const entry = selectSequence[idx];
          return Promise.resolve(entry ? entry.result : []);
        }),
      }),
    })),
    update: vi.fn().mockImplementation(() => ({
      set: vi.fn().mockImplementation((data: Record<string, unknown>) => ({
        where: vi.fn().mockImplementation(() => {
          updatedRows.push(data);
          return Promise.resolve();
        }),
      })),
    })),
  };

  return db;
}

// ============================================================
// TESTS
// ============================================================

describe('EscalationChecker', () => {
  it('does not escalate when within timeout window', async () => {
    const execution = makeExecution({ startedAt: hoursAgo(10) }); // only 10h ago
    const pipeline = makePipeline();
    const gateStep = makeGateStep();
    const decisions = [makePendingDecision('dec-1')];

    const db = makeMockDb([
      { result: [execution] },   // paused executions
      { result: [pipeline] },    // pipeline
      { result: [gateStep] },    // gate step
      { result: decisions },     // pending unescalated decisions
    ]);

    const checker = new EscalationChecker(
      db as unknown as import('drizzle-orm/node-postgres').NodePgDatabase,
    );

    const results = await checker.checkAndEscalate();

    expect(results).toHaveLength(0);
    expect(db._updatedRows).toHaveLength(0);
  });

  it('escalates when past timeout window', async () => {
    const execution = makeExecution(); // 50h ago, timeout=48h
    const pipeline = makePipeline();
    const gateStep = makeGateStep();
    const decisions = [
      makePendingDecision('dec-1'),
      makePendingDecision('dec-2'),
    ];

    const db = makeMockDb([
      { result: [execution] },
      { result: [pipeline] },
      { result: [gateStep] },
      { result: decisions },
    ]);

    const checker = new EscalationChecker(
      db as unknown as import('drizzle-orm/node-postgres').NodePgDatabase,
    );

    const results = await checker.checkAndEscalate();

    expect(results).toHaveLength(1);
    expect(results[0].executionId).toBe('exec-1');
    expect(results[0].pendingDecisionCount).toBe(2);
    expect(results[0].hoursWaiting).toBeGreaterThan(48);

    // Both decisions should have escalatedAt set
    expect(db._updatedRows).toHaveLength(2);
    for (const row of db._updatedRows) {
      expect(row['escalatedAt']).toBeInstanceOf(Date);
    }
  });

  it('skips already-escalated decisions', async () => {
    const execution = makeExecution();
    const pipeline = makePipeline();
    const gateStep = makeGateStep();
    // Both decisions already escalated — pending unescalated query returns empty
    const pendingUnescalated: Record<string, unknown>[] = [];

    const db = makeMockDb([
      { result: [execution] },
      { result: [pipeline] },
      { result: [gateStep] },
      { result: pendingUnescalated }, // no unescalated decisions
    ]);

    const checker = new EscalationChecker(
      db as unknown as import('drizzle-orm/node-postgres').NodePgDatabase,
    );

    const results = await checker.checkAndEscalate();

    expect(results).toHaveLength(0);
    expect(db._updatedRows).toHaveLength(0);
  });

  it('never auto-approves or auto-rejects during escalation', async () => {
    const execution = makeExecution();
    const pipeline = makePipeline();
    const gateStep = makeGateStep();
    const decisions = [makePendingDecision('dec-1')];

    const db = makeMockDb([
      { result: [execution] },
      { result: [pipeline] },
      { result: [gateStep] },
      { result: decisions },
    ]);

    const checker = new EscalationChecker(
      db as unknown as import('drizzle-orm/node-postgres').NodePgDatabase,
    );

    await checker.checkAndEscalate();

    // Updates should only set escalatedAt — never status
    for (const row of db._updatedRows) {
      expect(row).not.toHaveProperty('status');
      expect(row['escalatedAt']).toBeInstanceOf(Date);
    }
  });

  it('calls notification service when escalating', async () => {
    const execution = makeExecution();
    const pipeline = makePipeline();
    const gateStep = makeGateStep();
    const decisions = [makePendingDecision('dec-1')];

    const db = makeMockDb([
      { result: [execution] },
      { result: [pipeline] },
      { result: [gateStep] },
      { result: decisions },
    ]);

    const notificationService: NotificationService = {
      sendEscalationAlert: vi.fn().mockResolvedValue(undefined),
    };

    const checker = new EscalationChecker(
      db as unknown as import('drizzle-orm/node-postgres').NodePgDatabase,
      notificationService,
    );

    const results = await checker.checkAndEscalate();

    expect(results).toHaveLength(1);
    expect(notificationService.sendEscalationAlert).toHaveBeenCalledOnce();
    expect(notificationService.sendEscalationAlert).toHaveBeenCalledWith(
      expect.objectContaining({
        executionId: 'exec-1',
        pipelineId: 'pipe-1',
        tenantId: 'tenant-a',
      }),
    );
  });

  it('handles multiple paused executions independently', async () => {
    const exec1 = makeExecution({ id: 'exec-1', pipelineId: 'pipe-1', startedAt: hoursAgo(50) });
    const exec2 = { ...makeExecution({ id: 'exec-2', pipelineId: 'pipe-2', startedAt: hoursAgo(10) }) };

    const db = makeMockDb([
      { result: [exec1, exec2] },             // paused executions (both)
      // exec1 processing
      { result: [makePipeline({ id: 'pipe-1' })] },
      { result: [makeGateStep({ executionId: 'exec-1' })] },
      { result: [makePendingDecision('dec-1')] },
      // exec2 processing — within timeout, so no decisions queried
      { result: [makePipeline({ id: 'pipe-2', reviewGateTimeoutHours: 48 })] },
      { result: [makeGateStep({ executionId: 'exec-2' })] },
      { result: [] }, // within timeout, returns before querying decisions
    ]);

    const checker = new EscalationChecker(
      db as unknown as import('drizzle-orm/node-postgres').NodePgDatabase,
    );

    const results = await checker.checkAndEscalate();

    // Only exec-1 should be escalated (exec-2 is within timeout)
    expect(results).toHaveLength(1);
    expect(results[0].executionId).toBe('exec-1');
  });
});
