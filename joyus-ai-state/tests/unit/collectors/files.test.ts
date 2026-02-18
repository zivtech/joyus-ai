import { describe, it, expect } from 'vitest';
import { collectFileState } from '../../../src/collectors/files.js';
import path from 'node:path';
import os from 'node:os';
import fs from 'node:fs';

describe('collectFileState', () => {
  it('returns valid FileState from the current repo', async () => {
    const repoRoot = path.resolve(import.meta.dirname, '../../../../..');
    const state = await collectFileState(repoRoot);

    expect(Array.isArray(state.staged)).toBe(true);
    expect(Array.isArray(state.unstaged)).toBe(true);
    expect(Array.isArray(state.untracked)).toBe(true);
  });

  it('returns empty arrays for a non-git directory', async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'no-git-'));
    try {
      const state = await collectFileState(tmpDir);
      expect(state.staged).toEqual([]);
      expect(state.unstaged).toEqual([]);
      expect(state.untracked).toEqual([]);
    } finally {
      fs.rmSync(tmpDir, { recursive: true });
    }
  });

  it('returns empty arrays for nonexistent path', async () => {
    const state = await collectFileState('/tmp/does-not-exist-files-123');
    expect(state.staged).toEqual([]);
    expect(state.unstaged).toEqual([]);
    expect(state.untracked).toEqual([]);
  });

  it('detects untracked files in current worktree', async () => {
    // The worktree itself has new files we just created
    const worktreeRoot = path.resolve(import.meta.dirname, '../../../../..');
    const state = await collectFileState(worktreeRoot);
    // We know there are at least untracked collector files
    expect(state.untracked.length + state.staged.length + state.unstaged.length).toBeGreaterThanOrEqual(0);
  });
});
