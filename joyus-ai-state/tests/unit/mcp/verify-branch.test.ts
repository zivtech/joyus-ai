import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { handleVerifyBranch } from '../../../src/mcp/tools/verify-branch.js';
import { rmSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { listAuditFiles } from '../../../src/enforcement/audit/writer.js';
import { StateStore, getSnapshotsDir } from '../../../src/state/store.js';

function makeSnapshot(branch: string) {
  return {
    id: 'test-snapshot-id',
    version: '1.0.0',
    timestamp: new Date().toISOString(),
    event: 'commit' as const,
    project: { rootPath: '/tmp/test-project', hash: 'abc123', name: 'test' },
    git: {
      branch,
      commitHash: 'deadbeef',
      commitMessage: 'test commit',
      isDetached: false,
      hasUncommittedChanges: false,
      remoteBranch: null,
      aheadBehind: { ahead: 0, behind: 0 },
    },
    files: { staged: [], unstaged: [], untracked: [] },
    task: null,
    tests: null,
    decisions: [],
    canonical: [],
    sharer: null,
  };
}

describe('handleVerifyBranch', () => {
  let auditDir: string;
  let projectRoot: string;

  const ctx = () => ({
    projectRoot,
    sessionId: 'test-session',
    auditDir,
  });

  beforeEach(() => {
    auditDir = join(tmpdir(), `mcp-verify-test-${Date.now()}`);
    projectRoot = join(tmpdir(), `mcp-verify-project-${Date.now()}`);
    mkdirSync(projectRoot, { recursive: true });
  });

  afterEach(() => {
    rmSync(auditDir, { recursive: true, force: true });
    rmSync(projectRoot, { recursive: true, force: true });
  });

  it('returns match true when no snapshot exists (no expected branch)', async () => {
    const result = await handleVerifyBranch({ operation: 'commit' }, ctx());
    expect(result.match).toBe(true);
    expect(result.enforcement).toBe('none');
    expect(result.currentBranch).toBeTruthy();
    expect(result.expectedBranch).toBeNull();
  });

  it('uses branch from latest snapshot as expectedBranch', async () => {
    const snapshotsDir = getSnapshotsDir(projectRoot);
    mkdirSync(snapshotsDir, { recursive: true });
    const store = new StateStore(snapshotsDir);
    await store.write(makeSnapshot('main'));

    const result = await handleVerifyBranch({ operation: 'commit' }, ctx());
    expect(result.expectedBranch).toBe('main');
  });

  it('reports mismatch when current branch differs from snapshot branch', async () => {
    const snapshotsDir = getSnapshotsDir(projectRoot);
    mkdirSync(snapshotsDir, { recursive: true });
    const store = new StateStore(snapshotsDir);
    // Write a snapshot with a branch name that is extremely unlikely to match
    // the real current branch in CI or local dev environments.
    await store.write(makeSnapshot('expected-branch-xyz-9999'));

    const result = await handleVerifyBranch({ operation: 'commit' }, ctx());
    // The current branch (from git) will not be 'expected-branch-xyz-9999',
    // so this should detect a mismatch.
    if (result.currentBranch !== 'expected-branch-xyz-9999') {
      expect(result.match).toBe(false);
      expect(result.enforcement).toMatch(/^(block|warn)$/);
    }
    expect(result.expectedBranch).toBe('expected-branch-xyz-9999');
  });

  it('creates audit entry', async () => {
    await handleVerifyBranch({ operation: 'push' }, ctx());
    const files = listAuditFiles(auditDir);
    expect(files.length).toBe(1);
  });

  it('returns auditEntryId', async () => {
    const result = await handleVerifyBranch({ operation: 'merge' }, ctx());
    expect(result.auditEntryId).toBeTruthy();
    expect(typeof result.auditEntryId).toBe('string');
  });

  it('includes naming validity', async () => {
    const result = await handleVerifyBranch({ operation: 'commit' }, ctx());
    expect(typeof result.namingValid).toBe('boolean');
  });

  it('returns correct shape', async () => {
    const result = await handleVerifyBranch({ operation: 'commit' }, ctx());
    expect(result).toHaveProperty('currentBranch');
    expect(result).toHaveProperty('expectedBranch');
    expect(result).toHaveProperty('match');
    expect(result).toHaveProperty('enforcement');
    expect(result).toHaveProperty('namingValid');
    expect(result).toHaveProperty('suggestedName');
    expect(result).toHaveProperty('auditEntryId');
  });
});
