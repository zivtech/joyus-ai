/**
 * verify_action MCP tool — T023
 *
 * Pre-action guardrail. Advisory only — returns warnings, never blocks.
 */

import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { validateInput, createSuccessResponse, createErrorResponse, VerifyActionInputSchema } from './utils.js';
import { StateStore, getSnapshotsDir } from '../../state/store.js';
import { collectGitState } from '../../collectors/git.js';
import { collectFileState } from '../../collectors/files.js';
import { loadCanonical, checkPath } from '../../state/canonical.js';

interface Check {
  name: string;
  passed: boolean;
  detail: string;
}

export const verifyActionToolDef = {
  name: 'verify_action',
  description:
    'Pre-action guardrail check. Call this before commits, pushes, merges, or branch deletions to catch potential mistakes.',
  inputSchema: {
    type: 'object' as const,
    properties: {
      action: {
        type: 'string',
        description: 'Action type: commit, push, merge, branch-delete',
      },
      details: {
        type: 'object',
        description: 'Action-specific details (e.g., targetBranch, message, force)',
      },
    },
    required: ['action'],
  },
};

export async function handleVerifyAction(
  args: Record<string, unknown>,
  projectRoot: string,
): Promise<CallToolResult> {
  try {
    const input = validateInput(VerifyActionInputSchema, args);
    const { action } = input;
    const details = input.details ?? {};

    const checks: Check[] = [];
    const warnings: string[] = [];

    const snapshotsDir = getSnapshotsDir(projectRoot);
    const store = new StateStore(snapshotsDir);

    const [lastSnapshot, liveGit, liveFiles, canonicalDecl] = await Promise.all([
      store.readLatest(),
      collectGitState(projectRoot),
      collectFileState(projectRoot),
      loadCanonical(projectRoot),
    ]);

    // Branch-match check
    if (lastSnapshot) {
      const expectedBranch = lastSnapshot.git.branch;
      if (liveGit.branch === expectedBranch) {
        checks.push({ name: 'branch-match', passed: true, detail: `On expected branch ${liveGit.branch}` });
      } else {
        checks.push({ name: 'branch-match', passed: false, detail: `About to ${action} on '${liveGit.branch}' but last work was on '${expectedBranch}'` });
        warnings.push(`Branch mismatch: currently on '${liveGit.branch}', last snapshot was on '${expectedBranch}'`);
      }
    } else {
      checks.push({ name: 'branch-match', passed: true, detail: 'No previous snapshot to compare' });
    }

    // Commit-specific checks
    if (action === 'commit') {
      // Staged files check
      if (liveFiles.staged.length > 0) {
        checks.push({ name: 'has-staged-files', passed: true, detail: `${liveFiles.staged.length} file(s) staged` });
      } else {
        checks.push({ name: 'has-staged-files', passed: false, detail: 'No files staged for commit' });
        warnings.push('No files are staged for commit');
      }

      // Canonical conflict check
      for (const filePath of liveFiles.staged) {
        const result = checkPath(canonicalDecl, filePath, liveGit.branch);
        if (!result.isCanonical && result.canonicalName) {
          checks.push({ name: 'canonical-conflict', passed: false, detail: `'${filePath}' is a non-canonical copy of '${result.canonicalName}' (canonical: ${result.canonicalPath})` });
          warnings.push(`Staging non-canonical copy: '${filePath}' — canonical source is '${result.canonicalPath}'`);
        }
      }
      if (!checks.some(c => c.name === 'canonical-conflict')) {
        checks.push({ name: 'canonical-conflict', passed: true, detail: 'No canonical conflicts in staged files' });
      }
    }

    // Force-push check
    if (action === 'push' && details.force) {
      checks.push({ name: 'force-push', passed: false, detail: 'Force push detected — this can overwrite remote history' });
      warnings.push('Force push is risky and can overwrite remote history. Confirm this is intentional.');
    }

    const allowed = warnings.length === 0;

    return createSuccessResponse({ allowed, warnings, checks });
  } catch (err) {
    return createErrorResponse((err as Error).message);
  }
}
