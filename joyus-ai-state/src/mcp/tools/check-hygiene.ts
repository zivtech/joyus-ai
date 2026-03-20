/**
 * MCP tool: check_hygiene — T035
 *
 * Checks branch hygiene: stale branches, branch count, overall git health.
 */

import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { ToolContext } from '../types.js';
import { detectStaleBranches, checkBranchCount } from '../../enforcement/git/branch-hygiene.js';
import { loadEnforcementConfig } from '../../enforcement/config.js';

export async function handleCheckHygiene(ctx: ToolContext) {
  const { config } = loadEnforcementConfig(ctx.projectRoot);
  const staleBranches = await detectStaleBranches(config.branchRules);
  const branchCount = await checkBranchCount(config.branchRules);

  return {
    staleBranches,
    activeBranchCount: branchCount.count,
    branchLimit: branchCount.limit,
    overLimit: branchCount.overLimit,
    staleDaysThreshold: config.branchRules.staleDays,
  };
}

export function register(server: McpServer, ctx: ToolContext): void {
  server.tool('check_hygiene', async () => {
    const result = await handleCheckHygiene(ctx);
    return { content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }] };
  });
}
