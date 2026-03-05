/**
 * MCP tool utilities — T027
 *
 * Consistent input validation and response helpers for all MCP tools.
 */

import { z } from 'zod';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { EventTypeSchema } from '../../core/schema.js';

export function validateInput<T>(schema: z.ZodSchema<T>, args: unknown): T {
  const result = schema.safeParse(args);
  if (!result.success) {
    const issues = result.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ');
    throw new Error(`Invalid input: ${issues}`);
  }
  return result.data;
}

export function createErrorResponse(message: string): CallToolResult {
  return {
    content: [{ type: 'text', text: JSON.stringify({ error: message }) }],
    isError: true,
  };
}

export function createSuccessResponse(data: unknown): CallToolResult {
  return {
    content: [{ type: 'text', text: JSON.stringify(data, null, 2) }],
  };
}

// --- Input schemas ---

export const GetContextInputSchema = z.object({});

export const SaveStateInputSchema = z.object({
  event: EventTypeSchema.optional(),
  note: z.string().optional(),
  decision: z.string().optional(),
});

export const VerifyActionInputSchema = z.object({
  action: z.enum(['commit', 'push', 'merge', 'branch-delete']),
  details: z.record(z.unknown()).optional(),
});

export const CheckCanonicalInputSchema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('check'), path: z.string() }),
  z.object({ action: z.literal('declare'), path: z.string(), name: z.string(), branch: z.string().optional() }),
]);

export const ShareStateInputSchema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('export'), note: z.string() }),
  z.object({ action: z.literal('import'), path: z.string() }),
]);

export const QuerySnapshotsInputSchema = z.object({
  since: z.string().optional(),
  until: z.string().optional(),
  event: EventTypeSchema.optional(),
  branch: z.string().optional(),
  limit: z.number().int().min(1).max(1000).optional(),
});
