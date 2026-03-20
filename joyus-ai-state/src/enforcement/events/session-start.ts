/**
 * Session-start hygiene check — T042
 *
 * Runs branch hygiene checks when a new session starts and
 * returns actionable suggestions for Claude to surface to the user.
 */

import { randomUUID } from 'node:crypto';
import { detectStaleBranches, checkBranchCount } from '../git/branch-hygiene.js';
import type { StaleBranch } from '../git/branch-hygiene.js';
import { AuditWriter } from '../audit/writer.js';
import type { MergedEnforcementConfig, AuditEntry } from '../types.js';

export interface SessionStartReport {
  staleBranches: StaleBranch[];
  branchCountWarning: boolean;
  activeBranchCount: number;
  suggestions: string[];
}

export async function onSessionStart(
  config: MergedEnforcementConfig,
  ctx: { sessionId: string; auditDir: string },
): Promise<SessionStartReport> {
  const staleBranches = await detectStaleBranches(config.branchRules);
  const branchCount = await checkBranchCount(config.branchRules);

  const suggestions: string[] = [];

  if (staleBranches.length > 0) {
    const names = staleBranches.slice(0, 3).map((b) => b.name).join(', ');
    const more = staleBranches.length > 3 ? ` and ${staleBranches.length - 3} more` : '';
    suggestions.push(`${staleBranches.length} stale branch(es) detected: ${names}${more}. Consider deleting them.`);
  }

  if (branchCount.overLimit) {
    suggestions.push(
      `Active branch count (${branchCount.count}) exceeds limit (${branchCount.limit}). Consider cleaning up old branches.`,
    );
  }

  const writer = new AuditWriter(ctx.auditDir);
  const id = randomUUID();
  const entry: AuditEntry = {
    id,
    timestamp: new Date().toISOString(),
    sessionId: ctx.sessionId,
    actionType: 'branch-hygiene',
    result: staleBranches.length > 0 || branchCount.overLimit ? 'fail' : 'pass',
    userTier: config.resolvedTier,
    activeSkills: [],
    details: {
      staleBranchCount: staleBranches.length,
      activeBranchCount: branchCount.count,
      branchLimit: branchCount.limit,
      overLimit: branchCount.overLimit,
      trigger: 'session-start',
    },
  };
  writer.write(entry);

  return {
    staleBranches,
    branchCountWarning: branchCount.overLimit,
    activeBranchCount: branchCount.count,
    suggestions,
  };
}
