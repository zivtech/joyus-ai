import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { runGates, resolveGateTier } from '../../../src/enforcement/gates/runner.js';
import { readEntries, listAuditFiles } from '../../../src/enforcement/audit/writer.js';
import type { QualityGate } from '../../../src/enforcement/types.js';

function makeGate(overrides: Partial<QualityGate> = {}): QualityGate {
  return {
    id: 'lint-eslint',
    name: 'ESLint',
    type: 'lint',
    command: 'echo "ok"',
    triggerPoints: ['pre-commit'],
    defaultTier: 'always-run',
    timeout: 60,
    order: 0,
    ...overrides,
  };
}

describe('resolveGateTier', () => {
  it('returns always-run for mandatory gates', () => {
    const gate = makeGate({ id: 'lint-eslint', defaultTier: 'skip' });
    expect(resolveGateTier(gate, 'tier-2', {}, ['lint-eslint'])).toBe('always-run');
  });

  it('returns developer override when not mandatory', () => {
    const gate = makeGate({ id: 'lint-eslint' });
    expect(resolveGateTier(gate, 'tier-2', { 'lint-eslint': 'skip' }, [])).toBe('skip');
  });

  it('returns always-run for tier-1 (junior)', () => {
    const gate = makeGate({ defaultTier: 'ask-me' });
    expect(resolveGateTier(gate, 'tier-1', {}, [])).toBe('always-run');
  });

  it('returns gate default for tier-2 (power user)', () => {
    const gate = makeGate({ defaultTier: 'ask-me' });
    expect(resolveGateTier(gate, 'tier-2', {}, [])).toBe('ask-me');
  });

  it('returns always-run for tier-3 (non-technical)', () => {
    const gate = makeGate({ defaultTier: 'skip' });
    expect(resolveGateTier(gate, 'tier-3', {}, [])).toBe('always-run');
  });

  it('mandatory overrides developer override', () => {
    const gate = makeGate({ id: 'lint-eslint' });
    expect(resolveGateTier(gate, 'tier-2', { 'lint-eslint': 'skip' }, ['lint-eslint'])).toBe(
      'always-run',
    );
  });
});

describe('runGates', () => {
  let testDir: string;

  beforeEach(() => {
    testDir = join(tmpdir(), `gate-runner-test-${Date.now()}`);
  });

  afterEach(() => {
    rmSync(testDir, { recursive: true, force: true });
  });

  it('returns disabled when enforcement is off', async () => {
    const result = await runGates({
      trigger: 'pre-commit',
      gates: [makeGate()],
      userTier: 'tier-2',
      gateOverrides: {},
      enforcementActive: false,
      mandatoryGates: [],
      sessionId: 'test-session',
      activeSkills: [],
      auditDir: testDir,
    });
    expect(result.overallResult).toBe('disabled');
    expect(result.gatesExecuted).toHaveLength(0);
  });

  it('returns pass when all gates pass', async () => {
    const result = await runGates({
      trigger: 'pre-commit',
      gates: [
        makeGate({ id: 'gate-1', command: 'echo "ok"', order: 1 }),
        makeGate({ id: 'gate-2', command: 'echo "ok"', order: 2 }),
      ],
      userTier: 'tier-2',
      gateOverrides: {},
      enforcementActive: true,
      mandatoryGates: [],
      sessionId: 'test-session',
      activeSkills: [],
      auditDir: testDir,
    });
    expect(result.overallResult).toBe('pass');
    expect(result.gatesExecuted).toHaveLength(2);
  });

  it('stops at first failure (fail-fast) for always-run tier', async () => {
    const result = await runGates({
      trigger: 'pre-commit',
      gates: [
        makeGate({ id: 'gate-1', command: 'exit 1', order: 1, defaultTier: 'always-run' }),
        makeGate({ id: 'gate-2', command: 'echo "ok"', order: 2 }),
      ],
      userTier: 'tier-2',
      gateOverrides: {},
      enforcementActive: true,
      mandatoryGates: [],
      sessionId: 'test-session',
      activeSkills: [],
      auditDir: testDir,
    });
    expect(result.overallResult).toBe('fail');
    expect(result.failedGate).toBe('gate-1');
    expect(result.gatesExecuted).toHaveLength(1);
  });

  it('continues past failures for skip tier', async () => {
    const result = await runGates({
      trigger: 'pre-commit',
      gates: [
        makeGate({ id: 'gate-1', command: 'exit 1', order: 1, defaultTier: 'skip' }),
        makeGate({ id: 'gate-2', command: 'echo "ok"', order: 2, defaultTier: 'skip' }),
      ],
      userTier: 'tier-2',
      gateOverrides: {},
      enforcementActive: true,
      mandatoryGates: [],
      sessionId: 'test-session',
      activeSkills: [],
      auditDir: testDir,
    });
    expect(result.overallResult).toBe('pass');
    expect(result.gatesExecuted).toHaveLength(2);
    // First gate is skipped (not executed), second is skipped too
    expect(result.gatesExecuted[0].result).toBe('skip');
    expect(result.gatesExecuted[1].result).toBe('skip');
  });

  it('filters gates by trigger point', async () => {
    const result = await runGates({
      trigger: 'pre-push',
      gates: [
        makeGate({ id: 'gate-1', triggerPoints: ['pre-commit'], order: 1 }),
        makeGate({ id: 'gate-2', triggerPoints: ['pre-push'], order: 2 }),
      ],
      userTier: 'tier-2',
      gateOverrides: {},
      enforcementActive: true,
      mandatoryGates: [],
      sessionId: 'test-session',
      activeSkills: [],
      auditDir: testDir,
    });
    expect(result.gatesExecuted).toHaveLength(1);
    expect(result.gatesExecuted[0].gateId).toBe('gate-2');
  });

  it('executes gates in order', async () => {
    const result = await runGates({
      trigger: 'pre-commit',
      gates: [
        makeGate({ id: 'gate-high', command: 'echo "second"', order: 10 }),
        makeGate({ id: 'gate-low', command: 'echo "first"', order: 1 }),
      ],
      userTier: 'tier-2',
      gateOverrides: {},
      enforcementActive: true,
      mandatoryGates: [],
      sessionId: 'test-session',
      activeSkills: [],
      auditDir: testDir,
    });
    expect(result.gatesExecuted[0].gateId).toBe('gate-low');
    expect(result.gatesExecuted[1].gateId).toBe('gate-high');
  });

  it('writes audit entries for each gate execution', async () => {
    await runGates({
      trigger: 'pre-commit',
      gates: [
        makeGate({ id: 'gate-1', command: 'echo "ok"', order: 1 }),
        makeGate({ id: 'gate-2', command: 'echo "ok"', order: 2 }),
      ],
      userTier: 'tier-2',
      gateOverrides: {},
      enforcementActive: true,
      mandatoryGates: [],
      sessionId: 'test-session',
      activeSkills: ['drupal-security'],
      auditDir: testDir,
      taskId: 'PROJ-42',
      branchName: 'feature/test',
    });

    const files = listAuditFiles(testDir);
    expect(files.length).toBeGreaterThan(0);

    const { entries } = readEntries(files[0]);
    expect(entries).toHaveLength(2);
    expect(entries[0].actionType).toBe('gate-execution');
    expect(entries[0].gateId).toBe('gate-1');
    expect(entries[0].activeSkills).toEqual(['drupal-security']);
    expect(entries[0].taskId).toBe('PROJ-42');
    expect(entries[0].branchName).toBe('feature/test');
  });

  it('returns audit entry IDs', async () => {
    const result = await runGates({
      trigger: 'pre-commit',
      gates: [makeGate({ command: 'echo "ok"' })],
      userTier: 'tier-2',
      gateOverrides: {},
      enforcementActive: true,
      mandatoryGates: [],
      sessionId: 'test-session',
      activeSkills: [],
      auditDir: testDir,
    });
    expect(result.auditEntryIds).toHaveLength(1);
    expect(result.auditEntryIds[0]).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
    );
  });

  it('returns pass with empty gate list', async () => {
    const result = await runGates({
      trigger: 'pre-commit',
      gates: [],
      userTier: 'tier-2',
      gateOverrides: {},
      enforcementActive: true,
      mandatoryGates: [],
      sessionId: 'test-session',
      activeSkills: [],
    });
    expect(result.overallResult).toBe('pass');
  });
});
