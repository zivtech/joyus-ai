import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  exportSharedState,
  loadSharedState,
  getSharedOutgoingDir,
  getSharedIncomingDir,
  ensureSharedDirs,
  generateShareFilename,
} from '../../../src/state/share.js';
import { StateStore, getSnapshotsDir } from '../../../src/state/store.js';
import type { Snapshot } from '../../../src/core/types.js';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

let tmpDir: string;

function makeSnapshot(overrides: Partial<Snapshot> = {}): Snapshot {
  return {
    id: 'snap-001',
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
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'share-test-'));
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true });
});

describe('directory management (T019)', () => {
  it('getSharedOutgoingDir returns correct path', () => {
    expect(getSharedOutgoingDir('/state')).toBe('/state/shared/outgoing');
  });

  it('getSharedIncomingDir returns correct path', () => {
    expect(getSharedIncomingDir('/state')).toBe('/state/shared/incoming');
  });

  it('ensureSharedDirs creates both directories', async () => {
    await ensureSharedDirs(tmpDir);
    expect(fs.existsSync(path.join(tmpDir, 'shared', 'outgoing'))).toBe(true);
    expect(fs.existsSync(path.join(tmpDir, 'shared', 'incoming'))).toBe(true);
  });

  it('generateShareFilename returns timestamped name', () => {
    const name = generateShareFilename();
    expect(name).toMatch(/^\d{4}-\d{2}-\d{2}T.*-share\.json$/);
    expect(name).not.toContain(':'); // filesystem safe
  });
});

describe('exportSharedState (T017)', () => {
  it('exports a snapshot with sharer note to custom path', async () => {
    // Set up a state store with a snapshot at the derived path
    const projectRoot = tmpDir;
    const snapshotsDir = getSnapshotsDir(projectRoot);
    fs.mkdirSync(snapshotsDir, { recursive: true });

    const store = new StateStore(snapshotsDir);
    const snapshot = makeSnapshot({ project: { rootPath: projectRoot, hash: 'testhash', name: 'test' } });
    await store.write(snapshot);

    // Export with a custom output path so we control the location
    const outputPath = path.join(tmpDir, 'export', 'shared.json');
    const result = await exportSharedState({
      projectRoot,
      note: 'Check this bug on line 42',
      outputPath,
    });

    expect(result.sharedFile).toBe(outputPath);
    expect(result.note).toBe('Check this bug on line 42');

    // Verify the file content
    const raw = fs.readFileSync(outputPath, 'utf-8');
    const shared = JSON.parse(raw);
    expect(shared.event).toBe('share');
    expect(shared.sharer).not.toBeNull();
    expect(shared.sharer.note).toBe('Check this bug on line 42');
    expect(shared.sharer.from).toBeTruthy();
    expect(shared.id).not.toBe(snapshot.id); // new ID
  });

  it('throws when no snapshot exists', async () => {
    // Empty snapshots dir — need to mock getStateDir
    const emptyProject = path.join(tmpDir, 'empty-project');
    fs.mkdirSync(emptyProject, { recursive: true });

    await expect(
      exportSharedState({ projectRoot: emptyProject, note: 'test' }),
    ).rejects.toThrow(/No snapshot found/);
  });
});

describe('loadSharedState (T018)', () => {
  it('loads a valid shared snapshot', async () => {
    const snapshot = makeSnapshot({
      event: 'share',
      sharer: { from: 'alice', note: 'Please review', sharedAt: '2026-01-15T12:00:00.000Z' },
    });
    const filePath = path.join(tmpDir, 'shared.json');
    fs.writeFileSync(filePath, JSON.stringify(snapshot));

    const result = await loadSharedState(filePath);
    expect(result.snapshot.event).toBe('share');
    expect(result.sharerNote).not.toBeNull();
    expect(result.sharerNote!.from).toBe('alice');
    expect(result.sharerNote!.note).toBe('Please review');
  });

  it('loads a regular snapshot without sharer', async () => {
    const snapshot = makeSnapshot();
    const filePath = path.join(tmpDir, 'regular.json');
    fs.writeFileSync(filePath, JSON.stringify(snapshot));

    const result = await loadSharedState(filePath);
    expect(result.snapshot.event).toBe('commit');
    expect(result.sharerNote).toBeNull();
  });

  it('throws on invalid JSON', async () => {
    const filePath = path.join(tmpDir, 'bad.json');
    fs.writeFileSync(filePath, '{not valid!!!');

    await expect(loadSharedState(filePath)).rejects.toThrow(/not valid JSON/);
  });

  it('throws on invalid snapshot schema', async () => {
    const filePath = path.join(tmpDir, 'invalid.json');
    fs.writeFileSync(filePath, JSON.stringify({ id: 'test', invalid: true }));

    await expect(loadSharedState(filePath)).rejects.toThrow(/Invalid snapshot/);
  });

  it('throws on missing file', async () => {
    await expect(loadSharedState('/tmp/nonexistent-file.json')).rejects.toThrow(/Cannot read/);
  });
});
