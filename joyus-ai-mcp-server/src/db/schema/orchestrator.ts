/**
 * Orchestrator DB Schema — WP01
 *
 * Extends the existing schema with orchestrator-specific tables.
 * Kept in a separate file to avoid modifying the main schema.ts.
 *
 * ID / FK convention note:
 *   The existing codebase uses text IDs with cuid2 (not UUID) for all tables.
 *   This file follows that pattern so that FKs to users.id remain consistent.
 *   The data-model.md spec describes UUID types; we use text here to match the
 *   actual codebase convention.
 *
 * tenantId note:
 *   No 'tenants' table exists yet — tenantId is an opaque text reference.
 *   Request-time authorization is resolved through the shared tenant resolver
 *   and tenant_memberships table.
 */

import { createId } from '@paralleldrive/cuid2';
import {
  pgTable,
  pgEnum,
  text,
  integer,
  timestamp,
  json,
  index,
  uniqueIndex,
} from 'drizzle-orm/pg-core';

import { users } from '../schema.js';

// ============================================================
// ENUMS
// ============================================================

export const sessionStatusEnum = pgEnum('orchestrator_session_status', [
  'pending',
  'running',
  'suspended',
  'completed',
  'failed',
  'cancelled',
]);

export const turnRoleEnum = pgEnum('orchestrator_turn_role', [
  'user',
  'assistant',
  'tool',
]);

// ============================================================
// TABLES
// ============================================================

/**
 * Orchestrator sessions — one per user interaction lifecycle.
 *
 * All queries MUST include tenantId in WHERE clause.
 * Tenant isolation is enforced at the service layer (session.service.ts).
 */
export const orchestratorSessions = pgTable('orchestrator_sessions', {
  id: text('id').primaryKey().$defaultFn(() => createId()),

  // Multi-tenant partition key — ALWAYS required in WHERE clauses
  tenantId: text('tenant_id').notNull(),

  // Session owner — references existing users table
  userId: text('user_id')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),

  // Lifecycle status
  status: sessionStatusEnum('status').notNull().default('pending'),

  // Extensible metadata (model used, initial prompt, etc.)
  metadata: json('metadata').$type<Record<string, unknown>>().default({}),

  // Links to the Inngest function run for durability
  inngestRunId: text('inngest_run_id'),

  // Timestamps
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
  completedAt: timestamp('completed_at'),
}, (table) => ({
  tenantStatusIdx: index('orch_sessions_tenant_status_idx').on(table.tenantId, table.status),
  tenantUserCreatedIdx: index('orch_sessions_tenant_user_created_idx').on(
    table.tenantId,
    table.userId,
    table.createdAt,
  ),
  inngestRunIdx: index('orch_sessions_inngest_run_idx').on(table.inngestRunId),
}));

/**
 * Orchestrator turns — individual message exchanges within a session.
 *
 * Immutable after creation. tenantId is denormalized for query performance.
 */
export const orchestratorTurns = pgTable('orchestrator_turns', {
  id: text('id').primaryKey().$defaultFn(() => createId()),

  // Parent session
  sessionId: text('session_id')
    .notNull()
    .references(() => orchestratorSessions.id, { onDelete: 'cascade' }),

  // Denormalized for query performance — avoids joins on hot paths
  tenantId: text('tenant_id').notNull(),

  // Turn order within the session (0-indexed)
  sequence: integer('sequence').notNull(),

  // Message role
  role: turnRoleEnum('role').notNull(),

  // Text content (null for pure tool-use turns)
  content: text('content'),

  // Array of tool_use blocks from assistant response
  toolCalls: json('tool_calls').$type<Array<Record<string, unknown>>>(),

  // Array of tool results for tool role turns
  toolResults: json('tool_results').$type<Array<Record<string, unknown>>>(),

  // Token usage tracking: { inputTokens, outputTokens, cacheHits? }
  tokenUsage: json('token_usage').$type<Record<string, number>>(),

  createdAt: timestamp('created_at').defaultNow().notNull(),
}, (table) => ({
  sessionSequenceUnique: uniqueIndex('orch_turns_session_sequence_unique').on(
    table.sessionId,
    table.sequence,
  ),
  tenantSessionIdx: index('orch_turns_tenant_session_idx').on(table.tenantId, table.sessionId),
}));

// ============================================================
// TYPE EXPORTS
// ============================================================

export type OrchestratorSession = typeof orchestratorSessions.$inferSelect;
export type NewOrchestratorSession = typeof orchestratorSessions.$inferInsert;

export type OrchestratorTurn = typeof orchestratorTurns.$inferSelect;
export type NewOrchestratorTurn = typeof orchestratorTurns.$inferInsert;
