/**
 * MCP tool: record_correction — T041
 *
 * Captures user corrections when Claude's output didn't meet
 * skill constraints. Creates both a correction record and an audit entry.
 */

import { z } from 'zod';
import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { ToolContext } from '../types.js';
import { CorrectionStore } from '../../enforcement/corrections/capture.js';
import { AuditWriter } from '../../enforcement/audit/writer.js';
import type { AuditEntry } from '../../enforcement/types.js';

export function handleRecordCorrection(
  args: {
    skillId: string;
    originalOutput: string;
    correctedOutput: string;
    explanation?: string;
    filePath?: string;
  },
  ctx: ToolContext,
) {
  const correctionsDir = join(ctx.auditDir, 'corrections');
  const store = new CorrectionStore(correctionsDir);

  const correctionId = randomUUID();
  store.record({
    id: correctionId,
    timestamp: new Date().toISOString(),
    sessionId: ctx.sessionId,
    skillId: args.skillId,
    originalOutput: args.originalOutput,
    correctedOutput: args.correctedOutput,
    explanation: args.explanation,
    filePath: args.filePath,
  });

  const writer = new AuditWriter(ctx.auditDir);
  const auditEntryId = randomUUID();
  const entry: AuditEntry = {
    id: auditEntryId,
    timestamp: new Date().toISOString(),
    sessionId: ctx.sessionId,
    actionType: 'correction-captured',
    result: 'pass',
    userTier: 'tier-2',
    activeSkills: [],
    skillId: args.skillId,
    details: {
      correctionId,
      filePath: args.filePath ?? null,
      hasExplanation: !!args.explanation,
    },
  };
  writer.write(entry);

  return {
    correctionId,
    auditEntryId,
    stored: true,
  };
}

export function register(server: McpServer, ctx: ToolContext): void {
  server.tool(
    'record_correction',
    {
      skillId: z.string(),
      originalOutput: z.string(),
      correctedOutput: z.string(),
      explanation: z.string().optional(),
      filePath: z.string().optional(),
    },
    async (args) => {
      const result = handleRecordCorrection(args, ctx);
      return { content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }] };
    },
  );
}
