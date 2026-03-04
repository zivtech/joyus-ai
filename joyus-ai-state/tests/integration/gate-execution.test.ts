import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { writeFileSync, mkdirSync, rmSync, chmodSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { runGates, type GateRunConfig } from '../../src/enforcement/gates/runner.js';
import { listAuditFiles } from '../../src/enforcement/audit/writer.js';
import { disableEnforcement, enableEnforcement } from '../../src/enforcement/kill-switch.js';
import type { QualityGate } from '../../src/enforcement/types.js';

function tmpDir(prefix: string): string {
  const dir = join(tmpdir(), `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`);
  mkdirSync(dir, { recursive: true });
  return dir;
}

function makeScript(dir: string, name: string, content: string): string {
  const path = join(dir, name);
  writeFileSync(path, `#!/bin/bash\n${content}`, 'utf-8');
  chmodSync(path, 0o755);
  return path;
}

function makeGate(id: string, command: string, overrides?: Partial<QualityGate>): QualityGate {
  return {
    id,
    name: id,
    type: 'custom',
    command,
    triggerPoints: ['pre-commit'],
    defaultTier: 'always-run',
    timeout: 60,
    order: 0,
    ...overrides,
  };
}

function baseConfig(gates: QualityGate[], auditDir: string): GateRunConfig {
  return {
    trigger: 'pre-commit',
    gates,
    userTier: 'tier-2',
    gateOverrides: {},
    enforcementActive: true,
    mandatoryGates: [],
    sessionId: 'integration-test',
    activeSkills: [],
    auditDir,
  };
}

describe('Integration: Gate Execution Flow', () => {
  let scriptsDir: string;
  let auditDir: string;

  beforeEach(() => {
    scriptsDir = tmpDir('gate-scripts');
    auditDir = tmpDir('gate-audit');
    enableEnforcement();
  });

  afterEach(() => {
    enableEnforcement();
    rmSync(scriptsDir, { recursive: true, force: true });
    rmSync(auditDir, { recursive: true, force: true });
  });

  it('happy path: 2 gates pass -> overallResult pass, 2 audit entries', async () => {
    const pass1 = makeScript(scriptsDir, 'lint.sh', 'echo "lint ok"; exit 0');
    const pass2 = makeScript(scriptsDir, 'test.sh', 'echo "tests ok"; exit 0');
    const gates = [
      makeGate('lint', pass1, { order: 1 }),
      makeGate('test', pass2, { order: 2 }),
    ];

    const result = await runGates(baseConfig(gates, auditDir));

    expect(result.overallResult).toBe('pass');
    expect(result.gatesExecuted).toHaveLength(2);
    expect(result.gatesExecuted[0].result).toBe('pass');
    expect(result.gatesExecuted[1].result).toBe('pass');
    expect(result.auditEntryIds).toHaveLength(2);

    const files = listAuditFiles(auditDir);
    expect(files.length).toBe(1);
  });

  it('fail-fast: gate 2 fails -> gate 3 skipped, overallResult fail', async () => {
    const pass = makeScript(scriptsDir, 'g1.sh', 'exit 0');
    const fail = makeScript(scriptsDir, 'g2.sh', 'echo "error"; exit 1');
    const skip = makeScript(scriptsDir, 'g3.sh', 'exit 0');
    const gates = [
      makeGate('g1', pass, { order: 1 }),
      makeGate('g2', fail, { order: 2 }),
      makeGate('g3', skip, { order: 3 }),
    ];

    const result = await runGates(baseConfig(gates, auditDir));

    expect(result.overallResult).toBe('fail');
    expect(result.failedGate).toBe('g2');
    expect(result.gatesExecuted).toHaveLength(2);
    expect(result.gatesExecuted[0].result).toBe('pass');
    expect(result.gatesExecuted[1].result).toBe('fail');
  });

  it('timeout: gate exceeds timeout -> result timeout', async () => {
    const slow = makeScript(scriptsDir, 'slow.sh', 'sleep 10');
    const gates = [makeGate('slow', slow, { order: 1, timeout: 1 })];

    const result = await runGates(baseConfig(gates, auditDir));

    expect(result.overallResult).toBe('fail');
    expect(result.gatesExecuted[0].result).toBe('timeout');
  }, 10_000);

  it('unavailable: nonexistent command via shell -> result fail (shell returns 127)', async () => {
    // With shell: true, a nonexistent command produces exit code 127 (fail),
    // not ENOENT. ENOENT only occurs when the shell binary itself is missing.
    const gates = [makeGate('missing', '/nonexistent/command-xyz-42', { order: 1 })];

    const result = await runGates(baseConfig(gates, auditDir));

    expect(result.gatesExecuted[0].result).toBe('fail');
    expect(result.auditEntryIds.length).toBeGreaterThan(0);
  });

  it('kill switch: enforcement disabled -> overallResult disabled, no gates run', async () => {
    disableEnforcement('test');
    const pass = makeScript(scriptsDir, 'lint.sh', 'exit 0');
    const gates = [makeGate('lint', pass, { order: 1 })];
    const config = baseConfig(gates, auditDir);
    config.enforcementActive = false;

    const result = await runGates(config);

    expect(result.overallResult).toBe('disabled');
    expect(result.gatesExecuted).toHaveLength(0);
  });

  it('dry run: gates with skip tier are listed but not executed', async () => {
    const pass = makeScript(scriptsDir, 'lint.sh', 'exit 0');
    const gates = [makeGate('lint', pass, { order: 1 })];
    const config = baseConfig(gates, auditDir);
    config.gateOverrides = { lint: 'skip' };

    const result = await runGates(config);

    expect(result.overallResult).toBe('pass');
    expect(result.gatesExecuted).toHaveLength(1);
    expect(result.gatesExecuted[0].result).toBe('skip');
    expect(result.gatesExecuted[0].duration).toBe(0);
  });
});
