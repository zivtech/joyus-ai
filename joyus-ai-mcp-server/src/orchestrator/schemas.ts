/**
 * Orchestrator HTTP API Schemas — WP06 (T046)
 *
 * Zod schemas for all request bodies and response shapes.
 * Used by route handlers for validation and by the OpenAPI generator.
 *
 * Gas City typed-wire principle: OpenAPI is generated FROM these schemas,
 * never hand-maintained. The canonical source of truth is this file.
 *
 * Error response format (consistent across all endpoints):
 *   { error: { code: string, message: string, details?: unknown } }
 */

import { z } from 'zod';

// ============================================================
// SHARED PRIMITIVES
// ============================================================

/** Non-empty string — used for required ID-like fields */
const nonEmptyString = z.string().min(1);

/** ISO 8601 date string */
const isoDateString = z.string().datetime({ offset: true }).or(z.string().datetime());

/** Flexible metadata bag */
const metadataSchema = z.record(z.unknown());

// ============================================================
// ERROR RESPONSE (all error paths)
// ============================================================

export const apiErrorSchema = z.object({
  error: z.object({
    code: nonEmptyString,
    message: nonEmptyString,
    details: z.unknown().optional(),
  }),
});

export type ApiError = z.infer<typeof apiErrorSchema>;

// ============================================================
// SESSION STATUS & TRANSITIONS
// ============================================================

export const sessionStatusSchema = z.enum([
  'pending',
  'running',
  'suspended',
  'completed',
  'failed',
  'cancelled',
]);

export type SessionStatus = z.infer<typeof sessionStatusSchema>;

/**
 * Action → Status mapping for PATCH /sessions/:id.
 * The API surface uses human-readable actions; the service layer uses statuses.
 *
 * Action   → Status
 * suspend  → suspended  (running → suspended)
 * resume   → running    (suspended → running)
 * stop     → completed  (running → completed)
 * kill     → cancelled  (any → cancelled)
 */
export const sessionActionSchema = z.enum(['suspend', 'resume', 'stop', 'kill']);
export type SessionAction = z.infer<typeof sessionActionSchema>;

export const SESSION_ACTION_TO_STATUS: Record<SessionAction, SessionStatus> = {
  suspend: 'suspended',
  resume: 'running',
  stop: 'completed',
  kill: 'cancelled',
};

// ============================================================
// WORK UNIT STATUS
// ============================================================

export const workUnitStatusSchema = z.enum([
  'pending',
  'assigned',
  'running',
  'completed',
  'failed',
  'cancelled',
]);

export type WorkUnitStatus = z.infer<typeof workUnitStatusSchema>;

// ============================================================
// COORDINATION GROUP STATUS & POLICY
// ============================================================

export const coordinationGroupStatusSchema = z.enum(['active', 'completed', 'failed']);
export const completionPolicySchema = z.enum(['all', 'any', 'majority']);

// ============================================================
// SESSION REQUEST SCHEMAS
// ============================================================

/** POST /sessions body */
export const createSessionRequestSchema = z.object({
  userId: nonEmptyString,
  metadata: metadataSchema.optional(),
});

export type CreateSessionRequest = z.infer<typeof createSessionRequestSchema>;

/** PATCH /sessions/:id body */
export const updateSessionRequestSchema = z.object({
  action: sessionActionSchema,
});

export type UpdateSessionRequest = z.infer<typeof updateSessionRequestSchema>;

/** GET /sessions query params */
export const listSessionsQuerySchema = z.object({
  status: sessionStatusSchema.optional(),
  userId: z.string().optional(),
  limit: z.coerce.number().int().positive().max(100).default(20),
  cursor: z.string().optional(),
});

export type ListSessionsQuery = z.infer<typeof listSessionsQuerySchema>;

// ============================================================
// SESSION RESPONSE SCHEMAS
// ============================================================

export const sessionResponseSchema = z.object({
  id: nonEmptyString,
  tenantId: nonEmptyString,
  userId: nonEmptyString,
  status: sessionStatusSchema,
  metadata: metadataSchema,
  inngestRunId: z.string().nullable(),
  createdAt: isoDateString,
  updatedAt: isoDateString,
  completedAt: isoDateString.nullable(),
});

export type SessionResponse = z.infer<typeof sessionResponseSchema>;

export const paginatedSessionsResponseSchema = z.object({
  items: z.array(sessionResponseSchema),
  cursor: z.string().optional(),
  total: z.number().int().nonnegative().optional(),
});

// ============================================================
// MESSAGE REQUEST SCHEMA
// ============================================================

/** POST /sessions/:id/messages body */
export const sendMessageRequestSchema = z.object({
  message: nonEmptyString,
  /**
   * If true, client accepts standard SSE orchestrator message events.
   * Text payloads are not guaranteed to correspond to provider token deltas.
   */
  stream: z.boolean().default(true),
});

export type SendMessageRequest = z.infer<typeof sendMessageRequestSchema>;

/** Non-streaming message response */
export const messageResponseSchema = z.object({
  sessionId: nonEmptyString,
  turnSequence: z.number().int().nonnegative(),
  correlationId: nonEmptyString,
  responseText: nonEmptyString,
  tokenUsage: z.object({
    inputTokens: z.number().int().nonnegative(),
    outputTokens: z.number().int().nonnegative(),
  }),
});

// ============================================================
// WORK UNIT REQUEST SCHEMAS
// ============================================================

/** POST /work-units body */
export const createWorkUnitRequestSchema = z.object({
  title: nonEmptyString,
  type: nonEmptyString,
  sessionId: z.string().optional(),
  coordinationGroupId: z.string().optional(),
  assignee: z.string().optional(),
  dependencies: z.array(nonEmptyString).default([]),
  labels: z.array(z.string()).default([]),
  metadata: metadataSchema.optional(),
});

export type CreateWorkUnitRequest = z.infer<typeof createWorkUnitRequestSchema>;

/** PATCH /work-units/:id body */
export const updateWorkUnitRequestSchema = z.object({
  status: workUnitStatusSchema.optional(),
  assignee: z.string().optional(),
  metadata: metadataSchema.optional(),
});

export type UpdateWorkUnitRequest = z.infer<typeof updateWorkUnitRequestSchema>;

/** GET /work-units query params */
export const listWorkUnitsQuerySchema = z.object({
  sessionId: z.string().optional(),
  coordinationGroupId: z.string().optional(),
  status: workUnitStatusSchema.optional(),
});

// ============================================================
// WORK UNIT RESPONSE SCHEMAS
// ============================================================

export const workUnitResponseSchema = z.object({
  id: nonEmptyString,
  tenantId: nonEmptyString,
  sessionId: z.string().nullable(),
  coordinationGroupId: z.string().nullable(),
  status: workUnitStatusSchema,
  title: nonEmptyString,
  type: nonEmptyString,
  assignee: z.string().nullable(),
  dependencies: z.array(z.string()),
  labels: z.array(z.string()),
  metadata: metadataSchema,
  createdAt: isoDateString,
  updatedAt: isoDateString,
  completedAt: isoDateString.nullable(),
});

// ============================================================
// COORDINATION GROUP REQUEST SCHEMAS
// ============================================================

/** POST /coordination-groups body */
export const createCoordinationGroupRequestSchema = z.object({
  title: nonEmptyString,
  completionPolicy: completionPolicySchema.default('all'),
  metadata: metadataSchema.optional(),
});

export type CreateCoordinationGroupRequest = z.infer<typeof createCoordinationGroupRequestSchema>;

// ============================================================
// COORDINATION GROUP RESPONSE SCHEMAS
// ============================================================

export const coordinationGroupResponseSchema = z.object({
  id: nonEmptyString,
  tenantId: nonEmptyString,
  title: nonEmptyString,
  completionPolicy: completionPolicySchema,
  status: coordinationGroupStatusSchema,
  metadata: metadataSchema,
  createdAt: isoDateString,
  completedAt: isoDateString.nullable(),
});

export const coordinationGroupWithUnitsResponseSchema = coordinationGroupResponseSchema.extend({
  workUnits: z.array(workUnitResponseSchema),
});

// ============================================================
// TURN SCHEMAS
// ============================================================

export const turnRoleSchema = z.enum(['user', 'assistant', 'tool_call', 'tool_result']);

export const turnResponseSchema = z.object({
  id: nonEmptyString,
  sessionId: nonEmptyString,
  role: turnRoleSchema,
  content: z.string().nullable(),
  toolCalls: z.unknown().nullable(),
  toolResults: z.unknown().nullable(),
  tokenUsage: z.unknown().nullable(),
  sequence: z.number().int().nonnegative(),
  createdAt: isoDateString,
});

export type TurnResponse = z.infer<typeof turnResponseSchema>;

export const listTurnsQuerySchema = z.object({
  limit: z.coerce.number().int().positive().max(200).default(50),
  after_sequence: z.coerce.number().int().nonnegative().optional(),
});

export type ListTurnsQuery = z.infer<typeof listTurnsQuerySchema>;

export const turnListResponseSchema = z.object({
  items: z.array(turnResponseSchema),
  hasMore: z.boolean(),
});

// ============================================================
// EVENT QUERY SCHEMAS
// ============================================================

/** GET /sessions/:id/events and GET /events query params */
export const eventSubscriptionQuerySchema = z.object({
  /**
   * Comma-separated list of event types to filter.
   * Example: ?types=session.created,session.status_changed
   */
  types: z.string().optional(),
});
