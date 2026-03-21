import { describe, it, expect } from 'vitest';
import { collectGitState } from '../../../src/collectors/git.js';
import path from 'node:path';
import os from 'node:os';
import fs from 'node:fs';

describe('collectGitState', () => {
  it('returns valid GitState from the current repo', async () => {
    // Use the repo root (joyus-ai) which is definitely a git repo
    const repoRoot = path.resolve(import.meta.dirname, '../../../..');
    const state = await collectGitState(repoRoot);

    expect(state.branch).toBeTruthy();
    expect(state.branch).not.toBe('unknown');
    expect(state.commitHash).toBeTruthy();
    expect(state.commitMessage).toBeTruthy();
    expect(typeof state.isDetached).toBe('boolean');
    expect(typeof state.hasUncommittedChanges).toBe('boolean');
    expect(state.aheadBehind).toHaveProperty('ahead');
    expect(state.aheadBehind).toHaveProperty('behind');
  });

  it('returns default state for a non-git directory', async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'no-git-'));
    try {
      const state = await collectGitState(tmpDir);
      expect(state.branch).toBe('unknown');
      expect(state.commitHash).toBe('');
      expect(state.commitMessage).toBe('');
      expect(state.isDetached).toBe(false);
      expect(state.hasUncommittedChanges).toBe(false);
      expect(state.remoteBranch).toBeNull();
      expect(state.aheadBehind).toEqual({ ahead: 0, behind: 0 });
    } finally {
      fs.rmSync(tmpDir, { recursive: true });
    }
  });

  it('returns default state for a nonexistent path', async () => {
    const state = await collectGitState('/tmp/does-not-exist-abc123');
    expect(state.branch).toBe('unknown');
    expect(state.commitHash).toBe('');
  });

  it('detects uncommitted changes', async () => {
    const repoRoot = path.resolve(import.meta.dirname, '../../../../..');
    const state = await collectGitState(repoRoot);
    // We have uncommitted files in the worktree, so this should be true
    expect(typeof state.hasUncommittedChanges).toBe('boolean');
  });

  it('returns a fresh copy each time (no shared references)', async () => {
    const state1 = await collectGitState('/tmp/does-not-exist-abc123');
    const state2 = await collectGitState('/tmp/does-not-exist-abc123');
    expect(state1).not.toBe(state2);
    expect(state1).toEqual(state2);
  });
});
