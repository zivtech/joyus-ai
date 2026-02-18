import { describe, it, expect } from 'vitest';
import { detectDivergence } from '../../../src/state/divergence.js';
import type { Snapshot, GitState, FileState } from '../../../src/core/types.js';

function makeSnapshot(): Snapshot {
  return {
    id: 'test-id',
    version: '1.0.0',
    timestamp: '2026-01-01T00:00:00.000Z',
    event: 'manual',
    project: { rootPath: '/tmp/test', hash: 'abc123', name: 'test' },
    git: {
      branch: 'feature/test',
      commitHash: 'abc1234',
      commitMessage: 'test commit',
      isDetached: false,
      hasUncommittedChanges: false,
      remoteBranch: null,
      aheadBehind: { ahead: 0, behind: 0 },
    },
    files: { staged: [], unstaged: ['file.ts'], untracked: [] },
    task: null,
    tests: null,
    decisions: [],
    canonical: [],
    sharer: null,
  };
}

describe('detectDivergence', () => {
  it('returns no divergence when state matches', () => {
    const snapshot = makeSnapshot();
    const liveGit: GitState = { ...snapshot.git };
    const liveFiles: FileState = { ...snapshot.files };

    const report = detectDivergence(snapshot, liveGit, liveFiles);
    expect(report.diverged).toBe(false);
    expect(report.changes).toHaveLength(0);
  });

  it('detects branch change as critical', () => {
    const snapshot = makeSnapshot();
    const liveGit: GitState = { ...snapshot.git, branch: 'main' };
    const liveFiles: FileState = { ...snapshot.files };

    const report = detectDivergence(snapshot, liveGit, liveFiles);
    expect(report.diverged).toBe(true);
    const branchChange = report.changes.find((c) => c.field === 'branch');
    expect(branchChange).toBeTruthy();
    expect(branchChange!.severity).toBe('critical');
    expect(branchChange!.stored).toBe('feature/test');
    expect(branchChange!.live).toBe('main');
  });

  it('detects commit hash change as warning', () => {
    const snapshot = makeSnapshot();
    const liveGit: GitState = { ...snapshot.git, commitHash: 'def5678' };
    const liveFiles: FileState = { ...snapshot.files };

    const report = detectDivergence(snapshot, liveGit, liveFiles);
    expect(report.diverged).toBe(true);
    const hashChange = report.changes.find((c) => c.field === 'commitHash');
    expect(hashChange).toBeTruthy();
    expect(hashChange!.severity).toBe('warning');
  });

  it('detects file changes as info', () => {
    const snapshot = makeSnapshot();
    const liveGit: GitState = { ...snapshot.git };
    const liveFiles: FileState = {
      staged: ['new-staged.ts'],
      unstaged: ['file.ts', 'other.ts'],
      untracked: ['temp.log'],
    };

    const report = detectDivergence(snapshot, liveGit, liveFiles);
    expect(report.diverged).toBe(true);
    const fileChanges = report.changes.filter((c) => c.field.startsWith('files.'));
    expect(fileChanges.length).toBeGreaterThan(0);
    expect(fileChanges.every((c) => c.severity === 'info')).toBe(true);
  });

  it('detects multiple divergences simultaneously', () => {
    const snapshot = makeSnapshot();
    const liveGit: GitState = { ...snapshot.git, branch: 'main', commitHash: 'xyz' };
    const liveFiles: FileState = { staged: ['new.ts'], unstaged: [], untracked: [] };

    const report = detectDivergence(snapshot, liveGit, liveFiles);
    expect(report.diverged).toBe(true);
    expect(report.changes.length).toBeGreaterThanOrEqual(3);
  });
});
