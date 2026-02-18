/**
 * File state collector — T010
 *
 * Parses `git status --porcelain=v1` to categorize files as
 * staged, unstaged, or untracked. Never throws.
 */

import { execFile } from 'node:child_process';
import type { FileState } from '../core/types.js';

const TIMEOUT_MS = 5_000;

const DEFAULT_FILE_STATE: FileState = {
  staged: [],
  unstaged: [],
  untracked: [],
};

export async function collectFileState(projectRoot: string): Promise<FileState> {
  let output: string;
  try {
    output = await new Promise<string>((resolve, reject) => {
      execFile(
        'git',
        ['status', '--porcelain=v1'],
        { cwd: projectRoot, timeout: TIMEOUT_MS },
        (err, stdout) => {
          if (err) return reject(err);
          resolve(stdout);
        },
      );
    });
  } catch {
    return { ...DEFAULT_FILE_STATE };
  }

  const staged: string[] = [];
  const unstaged: string[] = [];
  const untracked: string[] = [];

  for (const line of output.split('\n')) {
    if (line.length < 3) continue;

    const indexStatus = line[0];
    const workTreeStatus = line[1];
    let filePath = line.slice(3);

    // Handle renames: "R  old -> new"
    if (indexStatus === 'R' || workTreeStatus === 'R') {
      const arrowIdx = filePath.indexOf(' -> ');
      if (arrowIdx !== -1) {
        filePath = filePath.slice(arrowIdx + 4);
      }
    }

    // Untracked
    if (indexStatus === '?' && workTreeStatus === '?') {
      untracked.push(filePath);
      continue;
    }

    // Staged changes (index column is not space or ?)
    if (indexStatus !== ' ' && indexStatus !== '?') {
      staged.push(filePath);
    }

    // Unstaged changes (work-tree column is not space or ?)
    if (workTreeStatus !== ' ' && workTreeStatus !== '?') {
      unstaged.push(filePath);
    }
  }

  return { staged, unstaged, untracked };
}
