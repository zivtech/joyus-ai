/**
 * Divergence detection — T008
 *
 * Compares stored snapshot state against live project state.
 * Pure function — takes snapshot and live state as inputs.
 */

import type { Snapshot, GitState, FileState } from '../core/types.js';

export interface DivergenceChange {
  field: string;
  stored: string;
  live: string;
  severity: 'info' | 'warning' | 'critical';
}

export interface DivergenceReport {
  diverged: boolean;
  changes: DivergenceChange[];
}

export function detectDivergence(
  snapshot: Snapshot,
  liveGit: GitState,
  liveFiles: FileState,
): DivergenceReport {
  const changes: DivergenceChange[] = [];

  // Branch changed — critical (might commit to wrong branch)
  if (snapshot.git.branch !== liveGit.branch) {
    changes.push({
      field: 'branch',
      stored: snapshot.git.branch,
      live: liveGit.branch,
      severity: 'critical',
    });
  }

  // Commit hash changed — warning (someone committed outside the session)
  if (snapshot.git.commitHash !== liveGit.commitHash) {
    changes.push({
      field: 'commitHash',
      stored: snapshot.git.commitHash,
      live: liveGit.commitHash,
      severity: 'warning',
    });
  }

  // Staged files changed
  const storedStaged = snapshot.files.staged.sort().join(',');
  const liveStaged = liveFiles.staged.sort().join(',');
  if (storedStaged !== liveStaged) {
    changes.push({
      field: 'files.staged',
      stored: `${snapshot.files.staged.length} files`,
      live: `${liveFiles.staged.length} files`,
      severity: 'info',
    });
  }

  // Unstaged files changed
  const storedUnstaged = snapshot.files.unstaged.sort().join(',');
  const liveUnstaged = liveFiles.unstaged.sort().join(',');
  if (storedUnstaged !== liveUnstaged) {
    changes.push({
      field: 'files.unstaged',
      stored: `${snapshot.files.unstaged.length} files`,
      live: `${liveFiles.unstaged.length} files`,
      severity: 'info',
    });
  }

  // Untracked files changed
  const storedUntracked = snapshot.files.untracked.sort().join(',');
  const liveUntracked = liveFiles.untracked.sort().join(',');
  if (storedUntracked !== liveUntracked) {
    changes.push({
      field: 'files.untracked',
      stored: `${snapshot.files.untracked.length} files`,
      live: `${liveFiles.untracked.length} files`,
      severity: 'info',
    });
  }

  return {
    diverged: changes.length > 0,
    changes,
  };
}
