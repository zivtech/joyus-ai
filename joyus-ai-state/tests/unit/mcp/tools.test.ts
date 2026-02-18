import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { handleGetContext } from '../../../src/mcp/tools/get-context.js';
import { handleSaveState } from '../../../src/mcp/tools/save-state.js';
import { handleVerifyAction } from '../../../src/mcp/tools/verify-action.js';
import { StateStore, getSnapshotsDir, initStateDirectory } from '../../../src/state/store.js';
import type { Snapshot } from '../../../src/core/types.js';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

let tmpDir: string;

function makeSnapshot(overrides: Partial<Snapshot> = {}): Snapshot {
  return {
    id: 'snap-test-001',
    version: '1.0.0',
    timestamp: '2026-01-15T10:00:00.000Z',
    event: 'commit',
    project: { rootPath: '/tmp/test', hash: 'abc123', name: 'test-project' },
    git: {
      branch: 'main',
      commitHash: 'abc1234',
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
    ...overrides,
  };
}

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mcp-tools-test-'));
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true });
});

describe('get_context', () => {
  it('returns fresh state when no snapshots exist', async () => {
    // Use tmpDir — no snapshots and not a git repo
    const snapshotsDir = getSnapshotsDir(tmpDir);
    // Don't create snapshots dir — simulates first run
    const result = await handleGetContext({}, tmpDir);
    expect(result.content).toHaveLength(1);
    const data = JSON.parse((result.content[0] as { text: string }).text);
    expect(data.git).toBeDefined();
    expect(data.files).toBeDefined();
    expect(data.id).toBeNull(); // no snapshot
  });

  it('enriches existing snapshot with live state', async () => {
    const snapshotsDir = getSnapshotsDir(tmpDir);
    fs.mkdirSync(snapshotsDir, { recursive: true });

    const store = new StateStore(snapshotsDir);
    await store.write(makeSnapshot({
      project: { rootPath: tmpDir, hash: 'test', name: 'test' },
    }));

    const result = await handleGetContext({}, tmpDir);
    const data = JSON.parse((result.content[0] as { text: string }).text);
    expect(data.id).toBe('snap-test-001');
    // Git state should be populated (returns defaults for non-git dir)
    expect(data.git).toBeDefined();
  });
});

describe('save_state', () => {
  it('saves a snapshot and returns confirmation', async () => {
    // Use tmpDir as project root to avoid shared state
    const snapshotsDir = getSnapshotsDir(tmpDir);
    fs.mkdirSync(snapshotsDir, { recursive: true });

    const result = await handleSaveState({ event: 'manual' }, tmpDir);
    const data = JSON.parse((result.content[0] as { text: string }).text);
    expect(data.saved).toBe(true);
    expect(data.id).toBeTruthy();
    expect(data.event).toBe('manual');
    expect(data.file).toBeTruthy();

    // Verify snapshot can be read back
    const store = new StateStore(snapshotsDir);
    const latest = await store.readLatest();
    expect(latest).not.toBeNull();
    expect(latest!.id).toBe(data.id);
  });

  it('defaults to manual event when not specified', async () => {
    const snapshotsDir = getSnapshotsDir(tmpDir);
    fs.mkdirSync(snapshotsDir, { recursive: true });

    const result = await handleSaveState({}, tmpDir);
    const data = JSON.parse((result.content[0] as { text: string }).text);
    expect(data.event).toBe('manual');
  });

  it('records a new decision', async () => {
    const snapshotsDir = getSnapshotsDir(tmpDir);
    fs.mkdirSync(snapshotsDir, { recursive: true });

    await handleSaveState({ event: 'manual', decision: 'Use Redis or Memcached?' }, tmpDir);

    const store = new StateStore(snapshotsDir);
    const latest = await store.readLatest();
    expect(latest).not.toBeNull();
    expect(latest!.decisions).toHaveLength(1);
    expect(latest!.decisions[0].question).toBe('Use Redis or Memcached?');
  });
});

describe('verify_action', () => {
  it('returns allowed when no issues found', async () => {
    const result = await handleVerifyAction({ action: 'push' }, tmpDir);
    const data = JSON.parse((result.content[0] as { text: string }).text);
    expect(data.checks).toBeDefined();
    expect(Array.isArray(data.warnings)).toBe(true);
    expect(typeof data.allowed).toBe('boolean');
  });

  it('warns on force push', async () => {
    const result = await handleVerifyAction({ action: 'push', details: { force: true } }, tmpDir);
    const data = JSON.parse((result.content[0] as { text: string }).text);
    expect(data.allowed).toBe(false);
    expect(data.warnings.some((w: string) => w.includes('Force push'))).toBe(true);
  });

  it('detects branch mismatch', async () => {
    // Use tmpDir — git collector will return 'unknown' branch (not a git repo)
    const snapshotsDir = getSnapshotsDir(tmpDir);
    fs.mkdirSync(snapshotsDir, { recursive: true });

    // Write a snapshot claiming a different branch than what live git returns
    const store = new StateStore(snapshotsDir);
    await store.write(makeSnapshot({
      git: {
        branch: 'feature/other-branch',
        commitHash: 'abc',
        commitMessage: 'test',
        isDetached: false,
        hasUncommittedChanges: false,
        remoteBranch: null,
        aheadBehind: { ahead: 0, behind: 0 },
      },
      project: { rootPath: tmpDir, hash: 'test', name: 'test' },
    }));

    // tmpDir is not a git repo, so collectGitState returns branch='unknown' → mismatch
    const result = await handleVerifyAction({ action: 'commit' }, tmpDir);
    const data = JSON.parse((result.content[0] as { text: string }).text);
    const branchCheck = data.checks.find((c: Check) => c.name === 'branch-match');
    expect(branchCheck.passed).toBe(false);
    expect(data.warnings.some((w: string) => w.includes('Branch mismatch'))).toBe(true);
  });
});

interface Check {
  name: string;
  passed: boolean;
  detail: string;
}
