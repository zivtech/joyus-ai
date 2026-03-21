/**
 * Branch verification — T026, T032 (audit)
 *
 * Verifies the current branch matches the expected branch from task context.
 * Enforcement level varies by user tier.
 */

import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);
import { randomUUID } from 'node:crypto';
import { AuditWriter } from '../audit/writer.js';
import type { UserTier, AuditEntry } from '../types.js';

export interface BranchVerifyConfig {
  currentBranch: string;
  expectedBranch: string | null;
  operation: 'commit' | 'push' | 'merge';
  userTier: UserTier;
}

export interface BranchVerifyResult {
  match: boolean;
  enforcement: 'block' | 'warn' | 'none';
  currentBranch: string;
  expectedBranch: string | null;
}

export function verifyBranch(config: BranchVerifyConfig): BranchVerifyResult {
  if (config.expectedBranch === null) {
    return {
      match: true,
      enforcement: 'none',
      currentBranch: config.currentBranch,
      expectedBranch: null,
    };
  }

  if (config.currentBranch === config.expectedBranch) {
    return {
      match: true,
      enforcement: 'none',
      currentBranch: config.currentBranch,
      expectedBranch: config.expectedBranch,
    };
  }

  // Mismatch — enforcement depends on tier
  let enforcement: 'block' | 'warn';
  switch (config.userTier) {
    case 'tier-1': // junior
    case 'tier-3': // non-technical
      enforcement = 'block';
      break;
    case 'tier-2': // power user
      enforcement = 'warn';
      break;
  }

  return {
    match: false,
    enforcement,
    currentBranch: config.currentBranch,
    expectedBranch: config.expectedBranch,
  };
}

export async function getCurrentBranch(cwd?: string): Promise<string> {
  try {
    const { stdout } = await execFileAsync('git', ['rev-parse', '--abbrev-ref', 'HEAD'], {
      cwd,
      encoding: 'utf-8',
    });
    return stdout.trim();
  } catch {
    return 'HEAD'; // Detached HEAD or not a git repo
  }
}

// --- T032: Audit integration ---

export function auditBranchVerify(
  result: BranchVerifyResult,
  writer: AuditWriter,
  config: {
    sessionId: string;
    userTier: UserTier;
    activeSkills: string[];
    taskId?: string;
  },
): string {
  const id = randomUUID();
  const entry: AuditEntry = {
    id,
    timestamp: new Date().toISOString(),
    sessionId: config.sessionId,
    actionType: result.match ? 'branch-verify' : 'branch-mismatch',
    result: result.match ? 'pass' : 'fail',
    userTier: config.userTier,
    activeSkills: config.activeSkills,
    branchName: result.currentBranch,
    taskId: config.taskId,
    details: {
      expectedBranch: result.expectedBranch,
      enforcement: result.enforcement,
    },
  };
  writer.write(entry);
  return id;
}
