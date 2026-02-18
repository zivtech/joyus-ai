/**
 * MCP tool: query_audit — T040
 *
 * Queries the audit trail with filters. Ensures SQLite index
 * is synced before querying.
 */

import { z } from 'zod';
import { join } from 'node:path';
import { mkdirSync } from 'node:fs';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { ToolContext } from '../types.js';
import { AuditIndex } from '../../enforcement/audit/index.js';
import type { AuditActionType, AuditResult } from '../../enforcement/types.js';

const MAX_LIMIT = 1000;

export function handleQueryAudit(
  args: {
    timeRange?: { from: string; to: string };
    actionType?: string;
    skillId?: string;
    taskId?: string;
    result?: string;
    limit?: number;
    offset?: number;
  },
  ctx: ToolContext,
) {
  mkdirSync(ctx.auditDir, { recursive: true });
  const dbPath = join(ctx.auditDir, 'audit-index.sqlite');
  const index = new AuditIndex(dbPath);

  try {
    index.initialize();
    index.syncFromJSONL(ctx.auditDir);

    const limit = Math.min(args.limit ?? 50, MAX_LIMIT);

    return index.query({
      timeRange: args.timeRange,
      actionType: args.actionType as AuditActionType | undefined,
      skillId: args.skillId,
      taskId: args.taskId,
      result: args.result as AuditResult | undefined,
      limit,
      offset: args.offset ?? 0,
    });
  } finally {
    index.close();
  }
}

export function register(server: McpServer, ctx: ToolContext): void {
  server.tool(
    'query_audit',
    {
      timeRange: z.object({ from: z.string(), to: z.string() }).optional(),
      actionType: z.string().optional(),
      skillId: z.string().optional(),
      taskId: z.string().optional(),
      result: z.string().optional(),
      limit: z.number().optional(),
      offset: z.number().optional(),
    },
    async (args) => {
      const result = handleQueryAudit(args, ctx);
      return { content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }] };
    },
  );
}
