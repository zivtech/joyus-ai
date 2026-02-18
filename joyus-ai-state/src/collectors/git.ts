/**
 * Git state collector — T009
 *
 * Shells out to git commands to gather current repository state.
 * Never throws — returns default empty state on error.
 */

import { execFile } from 'node:child_process';
import type { GitState } from '../core/types.js';

const TIMEOUT_MS = 5_000;

const DEFAULT_GIT_STATE: GitState = {
  branch: 'unknown',
  commitHash: '',
  commitMessage: '',
  isDetached: false,
  hasUncommittedChanges: false,
  remoteBranch: null,
  aheadBehind: { ahead: 0, behind: 0 },
};

function git(args: string[], cwd: string): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile('git', args, { cwd, timeout: TIMEOUT_MS }, (err, stdout) => {
      if (err) return reject(err);
      resolve(stdout.trim());
    });
  });
}

export async function collectGitState(projectRoot: string): Promise<GitState> {
  try {
    // Verify we're inside a git repo
    await git(['rev-parse', '--is-inside-work-tree'], projectRoot);
  } catch {
    return { ...DEFAULT_GIT_STATE };
  }

  try {
    const [branch, commitHash, commitMessage, statusOutput] = await Promise.all([
      git(['rev-parse', '--abbrev-ref', 'HEAD'], projectRoot).catch(() => 'unknown'),
      git(['rev-parse', '--short', 'HEAD'], projectRoot).catch(() => ''),
      git(['log', '-1', '--format=%s'], projectRoot).catch(() => ''),
      git(['status', '--porcelain'], projectRoot).catch(() => ''),
    ]);

    const isDetached = branch === 'HEAD';
    const hasUncommittedChanges = statusOutput.length > 0;

    // Remote branch and ahead/behind (may fail if no upstream)
    let remoteBranch: string | null = null;
    let aheadBehind = { ahead: 0, behind: 0 };

    try {
      remoteBranch = await git(['rev-parse', '--abbrev-ref', '--symbolic-full-name', '@{upstream}'], projectRoot);
    } catch {
      // No upstream configured — that's fine
    }

    if (remoteBranch) {
      try {
        const counts = await git(['rev-list', '--left-right', '--count', 'HEAD...@{upstream}'], projectRoot);
        const [ahead, behind] = counts.split(/\s+/).map(Number);
        aheadBehind = { ahead: ahead || 0, behind: behind || 0 };
      } catch {
        // Count failed — leave at defaults
      }
    }

    return {
      branch,
      commitHash,
      commitMessage,
      isDetached,
      hasUncommittedChanges,
      remoteBranch,
      aheadBehind,
    };
  } catch {
    return { ...DEFAULT_GIT_STATE };
  }
}
