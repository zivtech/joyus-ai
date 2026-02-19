/**
 * Error handling and hardening tests — T036, T037
 *
 * Verifies graceful degradation: corrupted files, missing dirs,
 * concurrent writes, non-git repos, and permission issues.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { StateStore, getSnapshotsDir } from '../../src/state/store.js';
import { acquireLock, releaseLock } from '../../src/state/lock.js';
import { collectGitState } from '../../src/collectors/git.js';
import { collectFileState } from '../../src/collectors/files.js';
import { loadCanonical, checkPath } from '../../src/state/canonical.js';
import { handleGetContext } from '../../src/mcp/tools/get-context.js';
import { handleSaveState } from '../../src/mcp/tools/save-state.js';
import { LogLevel, setLogLevel } from '../../src/utils/logger.js';
import type { Snapshot } from '../../src/core/types.js';
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
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'hardening-test-'));
  setLogLevel(LogLevel.ERROR); // Suppress warnings during tests
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true });
  setLogLevel(LogLevel.WARN); // Restore default
});

// --- T036: File locking ---

describe('File locking', () => {
  it('acquires and releases lock', async () => {
    const lockPath = path.join(tmpDir, 'test.lock');
    const acquired = await acquireLock(lockPath, 1000);
    expect(acquired).toBe(true);
    expect(fs.existsSync(lockPath)).toBe(true);

    await releaseLock(lockPath);
    expect(fs.existsSync(lockPath)).toBe(false);
  });

  it('detects stale lock from dead PID', async () => {
    const lockPath = path.join(tmpDir, 'stale.lock');
    fs.writeFileSync(lockPath, JSON.stringify({ pid: 999999, timestamp: new Date().toISOString() }));

    const acquired = await acquireLock(lockPath, 1000);
    expect(acquired).toBe(true);
    await releaseLock(lockPath);
  });

  it('concurrent writes produce separate valid snapshots', async () => {
    const snapshotsDir = path.join(tmpDir, 'snapshots');
    fs.mkdirSync(snapshotsDir, { recursive: true });

    const store = new StateStore(snapshotsDir);

    // Write multiple snapshots concurrently
    const writes = Array.from({ length: 5 }, (_, i) =>
      store.write(makeSnapshot({
        id: `concurrent-${i}`,
        timestamp: `2026-01-15T10:00:0${i}.000Z`,
      })),
    );

    const results = await Promise.all(writes);
    expect(results).toHaveLength(5);

    // All snapshots should be readable
    const files = fs.readdirSync(snapshotsDir).filter(f => f.endsWith('.json') && !f.endsWith('.lock'));
    expect(files.length).toBe(5);
  });
});

// --- T037: Error handling audit ---

describe('Graceful degradation', () => {
  it('corrupted snapshot is skipped, next valid one returned', async () => {
    const snapshotsDir = path.join(tmpDir, 'snapshots');
    fs.mkdirSync(snapshotsDir, { recursive: true });

    // Write a valid snapshot
    const store = new StateStore(snapshotsDir);
    await store.write(makeSnapshot({ id: 'valid-1', timestamp: '2026-01-01T00:00:00.000Z' }));

    // Write corrupted file that sorts after valid
    fs.writeFileSync(path.join(snapshotsDir, '2026-01-02T00-00-00.000Z.json'), '{corrupt}');

    const latest = await store.readLatest();
    // Should skip corrupt and return valid
    expect(latest).not.toBeNull();
    expect(latest!.id).toBe('valid-1');
  });

  it('missing snapshots directory returns null', async () => {
    const store = new StateStore(path.join(tmpDir, 'nonexistent'));
    const latest = await store.readLatest();
    expect(latest).toBeNull();
  });

  it('git collector returns defaults for non-git directory', async () => {
    const state = await collectGitState(tmpDir);
    expect(state.branch).toBe('unknown');
    expect(state.commitHash).toBe('');
  });

  it('file collector returns empty for non-git directory', async () => {
    const state = await collectFileState(tmpDir);
    expect(state.staged).toEqual([]);
    expect(state.unstaged).toEqual([]);
  });

  it('canonical loader returns empty when no file exists', async () => {
    const decl = await loadCanonical(tmpDir);
    expect(decl.documents).toEqual({});
  });

  it('checkPath handles empty declarations gracefully', async () => {
    const result = checkPath({ documents: {} }, 'any/path.ts', 'main');
    expect(result.isCanonical).toBe(false);
    expect(result.canonicalName).toBeNull();
  });

  it('MCP get_context never throws', async () => {
    // Non-existent directory — should return gracefully
    const result = await handleGetContext({}, path.join(tmpDir, 'nonexistent'));
    expect(result.content).toHaveLength(1);
    expect(result.isError).toBeUndefined();
  });

  it('MCP save_state handles missing directory gracefully', async () => {
    const result = await handleSaveState({ event: 'manual' }, tmpDir);
    expect(result.content).toHaveLength(1);
    // Should succeed — creates directory on demand
    const data = JSON.parse((result.content[0] as { text: string }).text);
    expect(data.saved).toBe(true);
  });
});

// --- T038: Logger ---

describe('Logger', () => {
  it('setLogLevel and getLogLevel work', async () => {
    const { getLogLevel } = await import('../../src/utils/logger.js');
    setLogLevel(LogLevel.DEBUG);
    expect(getLogLevel()).toBe(LogLevel.DEBUG);
    setLogLevel(LogLevel.WARN); // restore
  });
});
