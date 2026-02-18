import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdirSync, rmSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createId } from '@paralleldrive/cuid2';
import { StateStore, getProjectHash, initStateDirectory } from '../../../src/state/store.js';
import type { Snapshot } from '../../../src/core/types.js';

function tmpDir(prefix: string): string {
  const dir = join(tmpdir(), `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`);
  mkdirSync(dir, { recursive: true });
  return dir;
}

function makeSnapshot(overrides?: Partial<Snapshot>): Snapshot {
  return {
    id: createId(),
    version: '1.0.0',
    timestamp: new Date().toISOString(),
    event: 'manual',
    project: { rootPath: '/tmp/test', hash: 'abc123', name: 'test' },
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

describe('StateStore', () => {
  let snapshotsDir: string;
  let store: StateStore;

  beforeEach(() => {
    snapshotsDir = tmpDir('store-test');
    store = new StateStore(snapshotsDir);
  });

  afterEach(() => {
    rmSync(snapshotsDir, { recursive: true, force: true });
  });

  it('writes a snapshot atomically (no .tmp files remain)', async () => {
    const snapshot = makeSnapshot();
    const id = await store.write(snapshot);
    expect(id).toBe(snapshot.id);

    const files = readdirSync(snapshotsDir);
    expect(files.every((f) => f.endsWith('.json') && !f.endsWith('.tmp'))).toBe(true);
    expect(files.length).toBe(1);
  });

  it('reads back the latest snapshot', async () => {
    const s1 = makeSnapshot({ timestamp: '2026-01-01T00:00:00.000Z' });
    const s2 = makeSnapshot({ timestamp: '2026-01-02T00:00:00.000Z' });
    await store.write(s1);
    await store.write(s2);

    const latest = await store.readLatest();
    expect(latest).not.toBeNull();
    expect(latest!.id).toBe(s2.id);
  });

  it('reads by ID', async () => {
    const s1 = makeSnapshot();
    const s2 = makeSnapshot();
    await store.write(s1);
    await store.write(s2);

    const found = await store.readById(s1.id);
    expect(found).not.toBeNull();
    expect(found!.id).toBe(s1.id);
  });

  it('returns null for missing ID', async () => {
    const result = await store.readById('nonexistent');
    expect(result).toBeNull();
  });

  it('returns null when no snapshots exist', async () => {
    const latest = await store.readLatest();
    expect(latest).toBeNull();
  });

  it('skips corrupted files and returns next valid snapshot', async () => {
    const valid = makeSnapshot({ timestamp: '2026-01-01T00:00:00.000Z' });
    await store.write(valid);

    // Write a corrupted file with a later timestamp
    writeFileSync(join(snapshotsDir, '2026-01-02T00-00-00.000Z.json'), '{broken', 'utf-8');

    const latest = await store.readLatest();
    expect(latest).not.toBeNull();
    expect(latest!.id).toBe(valid.id);
  });

  it('lists snapshots with default limit', async () => {
    for (let i = 0; i < 15; i++) {
      const ts = `2026-01-${String(i + 1).padStart(2, '0')}T00:00:00.000Z`;
      await store.write(makeSnapshot({ timestamp: ts }));
    }

    const list = await store.list();
    expect(list.length).toBe(10); // default limit
  });

  it('filters by event type', async () => {
    await store.write(makeSnapshot({ timestamp: '2026-01-01T00:00:00.000Z', event: 'commit' }));
    await store.write(makeSnapshot({ timestamp: '2026-01-02T00:00:00.000Z', event: 'manual' }));
    await store.write(makeSnapshot({ timestamp: '2026-01-03T00:00:00.000Z', event: 'commit' }));

    const list = await store.list({ event: 'commit' });
    expect(list.length).toBe(2);
    expect(list.every((s) => s.event === 'commit')).toBe(true);
  });

  it('filters by branch', async () => {
    await store.write(makeSnapshot({
      timestamp: '2026-01-01T00:00:00.000Z',
      git: { branch: 'main', commitHash: 'a', commitMessage: 'x', isDetached: false, hasUncommittedChanges: false, remoteBranch: null, aheadBehind: { ahead: 0, behind: 0 } },
    }));
    await store.write(makeSnapshot({
      timestamp: '2026-01-02T00:00:00.000Z',
      git: { branch: 'feature/test', commitHash: 'b', commitMessage: 'y', isDetached: false, hasUncommittedChanges: false, remoteBranch: null, aheadBehind: { ahead: 0, behind: 0 } },
    }));

    const list = await store.list({ branch: 'feature/test' });
    expect(list.length).toBe(1);
    expect(list[0].branch).toBe('feature/test');
  });

  it('filters by date range', async () => {
    await store.write(makeSnapshot({ timestamp: '2026-01-01T00:00:00.000Z' }));
    await store.write(makeSnapshot({ timestamp: '2026-01-15T00:00:00.000Z' }));
    await store.write(makeSnapshot({ timestamp: '2026-02-01T00:00:00.000Z' }));

    const list = await store.list({
      since: '2026-01-10T00:00:00.000Z',
      until: '2026-01-20T00:00:00.000Z',
      limit: 100,
    });
    expect(list.length).toBe(1);
  });
});

describe('getProjectHash', () => {
  it('is deterministic for the same path', () => {
    const h1 = getProjectHash('/home/user/project');
    const h2 = getProjectHash('/home/user/project');
    expect(h1).toBe(h2);
  });

  it('produces different hashes for different paths', () => {
    const h1 = getProjectHash('/home/user/project-a');
    const h2 = getProjectHash('/home/user/project-b');
    expect(h1).not.toBe(h2);
  });

  it('returns 16 hex chars', () => {
    const hash = getProjectHash('/tmp/test');
    expect(hash).toMatch(/^[a-f0-9]{16}$/);
  });
});

describe('initStateDirectory', () => {
  let projectRoot: string;

  beforeEach(() => {
    projectRoot = tmpDir('init-test');
  });

  afterEach(() => {
    rmSync(projectRoot, { recursive: true, force: true });
  });

  it('creates expected directory structure', async () => {
    const stateDir = await initStateDirectory(projectRoot);

    // Global directories
    expect(readdirSync(join(stateDir, 'snapshots'))).toBeDefined();
    expect(readdirSync(join(stateDir, 'shared', 'incoming'))).toBeDefined();
    expect(readdirSync(join(stateDir, 'shared', 'outgoing'))).toBeDefined();

    // Local directories
    const localDir = join(projectRoot, '.joyus-ai');
    expect(readdirSync(localDir)).toContain('config.json');
    expect(readdirSync(localDir)).toContain('canonical.json');
  });
});
