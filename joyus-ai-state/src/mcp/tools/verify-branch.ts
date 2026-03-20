/**
 * MCP tool: verify_branch — T034
 *
 * Verifies current branch matches expected branch from task context.
 * Also checks naming convention if configured.
 */

import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { ToolContext } from '../types.js';
import { getCurrentBranch, verifyBranch, auditBranchVerify } from '../../enforcement/git/branch-verify.js';
import { checkBranchNaming } from '../../enforcement/git/branch-hygiene.js';
import { loadEnforcementConfig } from '../../enforcement/config.js';
import { AuditWriter } from '../../enforcement/audit/writer.js';

export async function handleVerifyBranch(
  args: { operation: 'commit' | 'push' | 'merge' },
  ctx: ToolContext,
) {
  const currentBranch = await getCurrentBranch();
  const expectedBranch: string | null = null; // Placeholder for 002 session state integration

  const { config } = loadEnforcementConfig(ctx.projectRoot);

  const verifyResult = verifyBranch({
    currentBranch,
    expectedBranch,
    operation: args.operation,
    userTier: config.resolvedTier,
  });

  const namingResult = config.branchRules.namingConvention
    ? checkBranchNaming(currentBranch, config.branchRules)
    : { valid: true, branchName: currentBranch };

  const writer = new AuditWriter(ctx.auditDir);
  const auditEntryId = auditBranchVerify(verifyResult, writer, {
    sessionId: ctx.sessionId,
    userTier: config.resolvedTier,
    activeSkills: [],
  });

  return {
    currentBranch: verifyResult.currentBranch,
    expectedBranch: verifyResult.expectedBranch,
    match: verifyResult.match,
    enforcement: verifyResult.enforcement,
    namingValid: namingResult.valid,
    suggestedName: namingResult.suggestedName ?? null,
    auditEntryId,
  };
}

export function register(server: McpServer, ctx: ToolContext): void {
  server.tool(
    'verify_branch',
    {
      operation: z.enum(['commit', 'push', 'merge']),
    },
    async (args) => {
      const result = await handleVerifyBranch(args, ctx);
      return { content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }] };
    },
  );
}
