import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { handleRunGates } from '../../../src/mcp/tools/run-gates.js';
import { disableEnforcement, enableEnforcement } from '../../../src/enforcement/kill-switch.js';
import { rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

describe('handleRunGates', () => {
  let auditDir: string;
  const ctx = () => ({
    projectRoot: '/tmp/nonexistent-project',
    sessionId: 'test-session',
    auditDir,
  });

  beforeEach(() => {
    auditDir = join(tmpdir(), `mcp-gates-test-${Date.now()}`);
    enableEnforcement();
  });

  afterEach(() => {
    enableEnforcement();
    rmSync(auditDir, { recursive: true, force: true });
  });

  it('returns disabled when kill switch is engaged', async () => {
    disableEnforcement('test');
    const result = await handleRunGates({ trigger: 'pre-commit' }, ctx());
    expect(result.enforcementActive).toBe(false);
    expect(result.overallResult).toBe('disabled');
    expect(result.gatesExecuted).toEqual([]);
    expect(result.auditEntryIds).toEqual([]);
  });

  it('returns pass when no gates configured', async () => {
    const result = await handleRunGates({ trigger: 'pre-commit' }, ctx());
    expect(result.enforcementActive).toBe(true);
    expect(result.overallResult).toBe('pass');
    expect(result.gatesExecuted).toEqual([]);
  });

  it('returns dry run listing without executing', async () => {
    const result = await handleRunGates(
      { trigger: 'pre-commit', dryRun: true },
      ctx(),
    );
    expect(result.enforcementActive).toBe(true);
    expect(result.overallResult).toBe('pass');
    expect(result.auditEntryIds).toEqual([]);
  });

  it('includes trigger in response', async () => {
    const result = await handleRunGates({ trigger: 'pre-push' }, ctx());
    expect(result.trigger).toBe('pre-push');
  });

  it('returns correct shape for disabled result', async () => {
    disableEnforcement();
    const result = await handleRunGates({ trigger: 'pre-commit' }, ctx());
    expect(result).toHaveProperty('enforcementActive');
    expect(result).toHaveProperty('trigger');
    expect(result).toHaveProperty('gatesExecuted');
    expect(result).toHaveProperty('overallResult');
    expect(result).toHaveProperty('auditEntryIds');
  });
});
