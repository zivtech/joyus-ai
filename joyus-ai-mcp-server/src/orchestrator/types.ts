/**
 * Orchestrator Types & Zod Schemas
 *
 * Shared types for the session & tenant foundation (WP01).
 * Uses text IDs (cuid2) to match the existing codebase pattern — not UUIDs.
 */

import { z } from 'zod';

// ============================================================
// SESSION STATUS
// ============================================================

export const SESSION_STATUSES = ['pending', 'running', 'suspended', 'completed', 'failed', 'cancelled'] as const;
export type SessionStatus = (typeof SESSION_STATUSES)[number];

export const sessionStatusSchema = z.enum(SESSION_STATUSES);

/**
 * Valid state transitions for sessions.
 * Key: current status. Value: allowed next statuses.
 *
 * Spec-compliant (T011):
 *   pending  → running | cancelled
 *   running  → suspended | completed | failed
 *   suspended→ running | failed
 *   completed→ (terminal)
 *   failed   → (terminal)
 *   cancelled→ (terminal)
 */
export const SESSION_TRANSITIONS: Record<SessionStatus, SessionStatus[]> = {
  pending: ['running', 'cancelled'],
  running: ['suspended', 'completed', 'failed'],
  suspended: ['running', 'failed'],
  completed: [],
  failed: [],
  cancelled: [],
};

// ============================================================
// TURN ROLE
// ============================================================

export const TURN_ROLES = ['user', 'assistant', 'tool'] as const;
export type TurnRole = (typeof TURN_ROLES)[number];

export const turnRoleSchema = z.enum(TURN_ROLES);

// ============================================================
// JSONB FIELD SCHEMAS
// ============================================================

/** Flexible metadata bag for sessions */
export const sessionMetadataSchema = z.record(z.unknown());
export type SessionMetadata = z.infer<typeof sessionMetadataSchema>;

/** A single tool call block from an assistant response */
export const toolCallSchema = z.object({
  id: z.string(),
  type: z.literal('tool_use'),
  name: z.string(),
  input: z.record(z.unknown()),
});
export type ToolCall = z.infer<typeof toolCallSchema>;

/** A tool result block */
export const toolResultSchema = z.object({
  type: z.literal('tool_result'),
  tool_use_id: z.string(),
  content: z.union([z.string(), z.array(z.record(z.unknown()))]).optional(),
  is_error: z.boolean().optional(),
});
export type ToolResult = z.infer<typeof toolResultSchema>;

/** Token usage tracking */
export const tokenUsageSchema = z.object({
  inputTokens: z.number().int().nonnegative(),
  outputTokens: z.number().int().nonnegative(),
  cacheHits: z.number().int().nonnegative().optional(),
});
export type TokenUsage = z.infer<typeof tokenUsageSchema>;

// ============================================================
// SESSION SERVICE INPUT SCHEMAS
// ============================================================

export const createSessionInputSchema = z.object({
  tenantId: z.string().min(1),
  userId: z.string().min(1),
  metadata: sessionMetadataSchema.optional().default({}),
});
export type CreateSessionInput = z.infer<typeof createSessionInputSchema>;

export const listSessionsFiltersSchema = z.object({
  status: sessionStatusSchema.optional(),
  userId: z.string().min(1).optional(),
  limit: z.number().int().positive().max(100).default(20),
  cursor: z.string().optional(),
});
export type ListSessionsFilters = z.infer<typeof listSessionsFiltersSchema>;

export const updateSessionStatusInputSchema = z.object({
  tenantId: z.string().min(1),
  sessionId: z.string().min(1),
  newStatus: sessionStatusSchema,
  inngestRunId: z.string().optional(),
});
export type UpdateSessionStatusInput = z.infer<typeof updateSessionStatusInputSchema>;

// ============================================================
// INNGEST EVENT PAYLOADS
// ============================================================

export const sessionCreatedEventSchema = z.object({
  sessionId: z.string().min(1),
  tenantId: z.string().min(1),
  userId: z.string().min(1),
});
export type SessionCreatedEventData = z.infer<typeof sessionCreatedEventSchema>;

// ============================================================
// ERRORS
// ============================================================

export class InvalidStatusTransitionError extends Error {
  constructor(from: SessionStatus, to: SessionStatus) {
    super(`Invalid session status transition: ${from} → ${to}`);
    this.name = 'InvalidStatusTransitionError';
  }
}

export class SessionNotFoundError extends Error {
  constructor(sessionId: string, tenantId: string) {
    super(`Session not found: ${sessionId} (tenant: ${tenantId})`);
    this.name = 'SessionNotFoundError';
  }
}

export class MissingTenantError extends Error {
  constructor() {
    super('Tenant ID is required but was not found in the request context');
    this.name = 'MissingTenantError';
  }
}
