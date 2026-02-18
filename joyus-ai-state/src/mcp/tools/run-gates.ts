/**
 * MCP tool: run_gates — T033
 *
 * Executes quality gates for a trigger point. Supports dry-run mode.
 * Returns early with 'disabled' if kill switch is engaged.
 */

import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { ToolContext } from '../types.js';
import { isEnforcementActive } from '../../enforcement/kill-switch.js';
import { loadEnforcementConfig } from '../../enforcement/config.js';
import { runGates, resolveGateTier } from '../../enforcement/gates/runner.js';

export async function handleRunGates(
  args: { trigger: 'pre-commit' | 'pre-push'; dryRun?: boolean },
  ctx: ToolContext,
) {
  const active = isEnforcementActive();

  if (!active) {
    return {
      enforcementActive: false,
      trigger: args.trigger,
      gatesExecuted: [],
      overallResult: 'disabled' as const,
      auditEntryIds: [],
    };
  }

  const { config } = loadEnforcementConfig(ctx.projectRoot);

  if (args.dryRun) {
    const applicableGates = config.gates
      .filter((g) => g.triggerPoints.includes(args.trigger))
      .sort((a, b) => a.order - b.order);

    return {
      enforcementActive: true,
      trigger: args.trigger,
      gatesExecuted: applicableGates.map((g) => ({
        gateId: g.id,
        name: g.name,
        type: g.type,
        result: 'skipped' as const,
        duration: 0,
        output: '',
        enforcementTier: resolveGateTier(
          g,
          config.resolvedTier,
          {},
          config.enforcementPolicy.mandatoryGates,
        ),
      })),
      overallResult: 'pass' as const,
      auditEntryIds: [],
    };
  }

  return runGates({
    trigger: args.trigger,
    gates: config.gates,
    userTier: config.resolvedTier,
    gateOverrides: {},
    enforcementActive: active,
    mandatoryGates: config.enforcementPolicy.mandatoryGates,
    sessionId: ctx.sessionId,
    activeSkills: [],
    auditDir: ctx.auditDir,
  });
}

export function register(server: McpServer, ctx: ToolContext): void {
  server.tool(
    'run_gates',
    {
      trigger: z.enum(['pre-commit', 'pre-push']),
      dryRun: z.boolean().optional(),
    },
    async (args) => {
      const result = await handleRunGates(args, ctx);
      return { content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }] };
    },
  );
}
