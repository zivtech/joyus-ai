/**
 * MCP tool: kill_switch — T037
 *
 * Enables or disables all enforcement for the current session.
 * Audit logging ALWAYS works even when enforcement is disabled.
 */

import { z } from 'zod';
import { randomUUID } from 'node:crypto';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { ToolContext } from '../types.js';
import {
  disableEnforcement,
  enableEnforcement,
  isEnforcementActive,
} from '../../enforcement/kill-switch.js';
import { AuditWriter } from '../../enforcement/audit/writer.js';
import type { AuditEntry } from '../../enforcement/types.js';

export function handleKillSwitch(
  args: { action: 'disable' | 'enable'; reason?: string },
  ctx: ToolContext,
) {
  if (args.action === 'disable') {
    disableEnforcement(args.reason);
  } else {
    enableEnforcement();
  }

  const active = isEnforcementActive();
  const writer = new AuditWriter(ctx.auditDir);
  const id = randomUUID();

  const entry: AuditEntry = {
    id,
    timestamp: new Date().toISOString(),
    sessionId: ctx.sessionId,
    actionType: args.action === 'disable' ? 'kill-switch-on' : 'kill-switch-off',
    result: 'pass',
    userTier: 'tier-2',
    activeSkills: [],
    details: {
      reason: args.reason ?? null,
      enforcementActive: active,
    },
  };
  writer.write(entry);

  return {
    enforcementActive: active,
    auditEntryId: id,
    message: active
      ? 'Enforcement re-enabled for this session.'
      : 'Enforcement disabled for this session. Audit logging continues.',
  };
}

export function register(server: McpServer, ctx: ToolContext): void {
  server.tool(
    'kill_switch',
    {
      action: z.enum(['disable', 'enable']),
      reason: z.string().optional(),
    },
    async (args) => {
      const result = handleKillSwitch(args, ctx);
      return { content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }] };
    },
  );
}
