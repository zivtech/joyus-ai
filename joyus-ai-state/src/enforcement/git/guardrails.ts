/**
 * Git guardrails — T030, T031, T032 (audit)
 *
 * Force-push warnings, uncommitted changes detection,
 * and audit trail integration for all git guardrail actions.
 */

import { execSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { AuditWriter } from '../audit/writer.js';
import type { BranchRule, UserTier, AuditEntry } from '../types.js';
import type { NamingResult, StaleBranch, BranchCountResult } from './branch-hygiene.js';

// --- T030: Force-push warning ---

export interface ForcePushResult {
  warning: 'critical' | 'caution' | 'none';
  message: string;
  isProtectedBranch: boolean;
}

export function checkForcePush(
  args: string[],
  targetBranch: string,
  rules: BranchRule,
): ForcePushResult {
  const hasForce = args.some((a) => a === '--force' || a === '-f' || a === '--force-with-lease');

  if (!hasForce) {
    return { warning: 'none', message: '', isProtectedBranch: false };
  }

  const isProtected = rules.protectedBranches.includes(targetBranch);

  if (isProtected) {
    return {
      warning: 'critical',
      message: `Force-pushing to protected branch '${targetBranch}' can destroy shared history and break other developers' work. This action is strongly discouraged.`,
      isProtectedBranch: true,
    };
  }

  return {
    warning: 'caution',
    message: `Force-push will overwrite remote history on '${targetBranch}'. Ensure no one else is working on this branch.`,
    isProtectedBranch: false,
  };
}

// --- T031: Uncommitted changes detection ---

export interface UncommittedResult {
  hasChanges: boolean;
  modified: number;
  untracked: number;
  deleted: number;
  summary: string;
}

export function checkUncommittedChanges(cwd?: string): UncommittedResult {
  const lines = getStatusLines(cwd);

  let modified = 0;
  let untracked = 0;
  let deleted = 0;

  for (const line of lines) {
    if (!line.trim()) continue;
    const code = line.slice(0, 2);
    if (code.includes('?')) {
      untracked++;
    } else if (code.includes('D')) {
      deleted++;
    } else {
      modified++;
    }
  }

  const hasChanges = modified + untracked + deleted > 0;
  const parts: string[] = [];
  if (modified > 0) parts.push(`${modified} modified`);
  if (deleted > 0) parts.push(`${deleted} deleted`);
  if (untracked > 0) parts.push(`${untracked} untracked`);

  return {
    hasChanges,
    modified,
    untracked,
    deleted,
    summary: hasChanges ? parts.join(', ') : 'No uncommitted changes',
  };
}

export function getStatusLines(cwd?: string): string[] {
  try {
    const output = execSync('git status --porcelain', {
      cwd,
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    return output.split('\n').filter((l) => l.trim());
  } catch {
    return [];
  }
}

// --- T032: Audit integration ---

export function auditNamingViolation(
  result: NamingResult,
  writer: AuditWriter,
  config: AuditConfig,
): string {
  const id = randomUUID();
  const entry: AuditEntry = {
    id,
    timestamp: new Date().toISOString(),
    sessionId: config.sessionId,
    actionType: 'naming-violation',
    result: result.valid ? 'pass' : 'fail',
    userTier: config.userTier,
    activeSkills: config.activeSkills,
    branchName: result.branchName,
    taskId: config.taskId,
    details: {
      convention: result.convention,
      suggestedName: result.suggestedName,
    },
  };
  writer.write(entry);
  return id;
}

export function auditBranchHygiene(
  staleBranches: StaleBranch[],
  branchCount: BranchCountResult,
  writer: AuditWriter,
  config: AuditConfig,
): string {
  const id = randomUUID();
  const entry: AuditEntry = {
    id,
    timestamp: new Date().toISOString(),
    sessionId: config.sessionId,
    actionType: 'branch-hygiene',
    result: staleBranches.length > 0 || branchCount.overLimit ? 'fail' : 'pass',
    userTier: config.userTier,
    activeSkills: config.activeSkills,
    branchName: config.branchName,
    taskId: config.taskId,
    details: {
      staleBranchCount: staleBranches.length,
      activeBranchCount: branchCount.count,
      branchLimit: branchCount.limit,
      overLimit: branchCount.overLimit,
    },
  };
  writer.write(entry);
  return id;
}

export function auditForcePush(
  result: ForcePushResult,
  writer: AuditWriter,
  config: AuditConfig,
): string {
  const id = randomUUID();
  const entry: AuditEntry = {
    id,
    timestamp: new Date().toISOString(),
    sessionId: config.sessionId,
    actionType: 'force-push-warning',
    result: result.warning === 'none' ? 'pass' : 'fail',
    userTier: config.userTier,
    activeSkills: config.activeSkills,
    branchName: config.branchName,
    taskId: config.taskId,
    details: {
      warning: result.warning,
      message: result.message,
      isProtectedBranch: result.isProtectedBranch,
    },
  };
  writer.write(entry);
  return id;
}

export function auditUncommitted(
  result: UncommittedResult,
  writer: AuditWriter,
  config: AuditConfig,
): string {
  const id = randomUUID();
  const entry: AuditEntry = {
    id,
    timestamp: new Date().toISOString(),
    sessionId: config.sessionId,
    actionType: 'uncommitted-warning',
    result: result.hasChanges ? 'fail' : 'pass',
    userTier: config.userTier,
    activeSkills: config.activeSkills,
    branchName: config.branchName,
    taskId: config.taskId,
    details: {
      modified: result.modified,
      untracked: result.untracked,
      deleted: result.deleted,
      summary: result.summary,
    },
  };
  writer.write(entry);
  return id;
}

interface AuditConfig {
  sessionId: string;
  userTier: UserTier;
  activeSkills: string[];
  taskId?: string;
  branchName?: string;
}
