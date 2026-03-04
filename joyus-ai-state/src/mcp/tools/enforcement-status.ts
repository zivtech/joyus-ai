/**
 * MCP tool: enforcement_status — T036
 *
 * Returns current enforcement state for Claude to report to the user.
 * Aggregates kill switch, config, audit storage, and companion service status.
 */

import { existsSync } from 'node:fs';
import { join } from 'node:path';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { ToolContext } from '../types.js';
import { getKillSwitchState } from '../../enforcement/kill-switch.js';
import { loadEnforcementConfig } from '../../enforcement/config.js';
import { checkStorageUsage } from '../../enforcement/audit/storage-monitor.js';

export function handleEnforcementStatus(ctx: ToolContext) {
  const killSwitch = getKillSwitchState();
  const { config } = loadEnforcementConfig(ctx.projectRoot);
  const storage = checkStorageUsage(ctx.auditDir);

  const pidPath = join(ctx.projectRoot, '.joyus-ai', 'companion.pid');
  const companionRunning = existsSync(pidPath);

  return {
    enforcementActive: killSwitch.active,
    userTier: config.resolvedTier,
    configuredGates: config.gates.length,
    activeSkills: 0,
    skillMappings: config.skillMappings.length,
    branchRulesConfigured: !!config.branchRules.namingConvention,
    auditStorageUsed: storage.humanReadable,
    auditStorageWarning: storage.isOverThreshold,
    companionServiceRunning: companionRunning,
    killSwitchEngagedAt: killSwitch.disabledAt,
  };
}

export function register(server: McpServer, ctx: ToolContext): void {
  server.tool('enforcement_status', async () => {
    const result = handleEnforcementStatus(ctx);
    return { content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }] };
  });
}
