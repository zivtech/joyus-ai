import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { onSessionStart } from '../../../src/enforcement/events/session-start.js';
import { listAuditFiles } from '../../../src/enforcement/audit/writer.js';
import { EnforcementConfigSchema } from '../../../src/enforcement/schemas.js';
import { mergeConfig } from '../../../src/enforcement/config.js';
import type { DeveloperConfig } from '../../../src/enforcement/types.js';
import { rmSync, mkdtempSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { execFileSync } from 'node:child_process';

function makeConfig() {
  const project = EnforcementConfigSchema.parse({});
  const dev: DeveloperConfig = { tier: 'tier-2', gateOverrides: {}, skillOverrides: {} };
  return mergeConfig(project, dev);
}

/** Hermetic git repo with exactly one local branch (main), so branch-count
 * assertions don't depend on whatever repo the test process runs inside
 * (CI checkouts are detached with zero local branches). */
function makeGitRepo(): string {
  const dir = mkdtempSync(join(tmpdir(), 'event-session-repo-'));
  execFileSync('git', ['init', '-b', 'main', dir], { stdio: 'ignore' });
  execFileSync('git', ['config', 'user.email', 'test@test.com'], { cwd: dir, stdio: 'ignore' });
  execFileSync('git', ['config', 'user.name', 'Test'], { cwd: dir, stdio: 'ignore' });
  writeFileSync(join(dir, 'README.md'), '# Test');
  execFileSync('git', ['add', '.'], { cwd: dir, stdio: 'ignore' });
  execFileSync('git', ['commit', '-m', 'initial'], { cwd: dir, stdio: 'ignore' });
  return dir;
}

describe('onSessionStart', () => {
  let auditDir: string;
  let repoDir: string;

  beforeEach(() => {
    auditDir = join(tmpdir(), `event-session-test-${Date.now()}`);
    repoDir = makeGitRepo();
  });

  afterEach(() => {
    rmSync(auditDir, { recursive: true, force: true });
    rmSync(repoDir, { recursive: true, force: true });
  });

  it('returns hygiene report', async () => {
    const config = makeConfig();
    const report = await onSessionStart(config, { sessionId: 'test', auditDir });
    expect(Array.isArray(report.staleBranches)).toBe(true);
    expect(typeof report.branchCountWarning).toBe('boolean');
    expect(typeof report.activeBranchCount).toBe('number');
    expect(Array.isArray(report.suggestions)).toBe(true);
  });

  it('creates audit entry', async () => {
    const config = makeConfig();
    await onSessionStart(config, { sessionId: 'test', auditDir });
    const files = listAuditFiles(auditDir);
    expect(files.length).toBe(1);
  });

  it('returns suggestions when branch count is high', async () => {
    const config = makeConfig();
    config.branchRules.maxActiveBranches = 0; // force over-limit (repo has 1 branch)
    const report = await onSessionStart(config, { sessionId: 'test', auditDir, cwd: repoDir });
    expect(report.branchCountWarning).toBe(true);
    expect(report.suggestions.length).toBeGreaterThan(0);
  });
});
