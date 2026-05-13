/**
 * Orchestrator Events DB Schema — WP03
 *
 * Defines the append-only events table for the typed event system.
 * Every session lifecycle transition, tool call result, and error becomes
 * a typed event row. This table is NEVER updated or deleted — only inserted.
 *
 * ID / FK convention note:
 *   Follows the same text/cuid2 pattern as orchestrator.ts — NOT UUID,
 *   even though data-model.md spec lists UUID. The codebase uses text IDs
 *   throughout for consistency with the users table.
 *
 * Sequence note:
 *   sequence uses bigserial (auto-incrementing) for global ordering of events
 *   across the tenant. Clients use sequence as their SSE Last-Event-ID cursor.
 *   mode: 'number' is used to avoid BigInt serialization issues in JSON/SSE.
 */

import { createId } from '@paralleldrive/cuid2';
import {
  pgTable,
  text,
  bigserial,
  jsonb,
  timestamp,
  index,
} from 'drizzle-orm/pg-core';

// ============================================================
// EVENTS TABLE
// ============================================================

/**
 * Orchestrator events — append-only record of all system state changes.
 *
 * APPEND-ONLY: No UPDATE or DELETE operations are permitted anywhere in the
 * codebase. Enforced at the service layer (event.service.ts). There is no
 * DB-level constraint, so all writers must follow this rule.
 *
 * Tenant isolation: all queries MUST filter by tenant_id.
 */
export const orchestratorEvents = pgTable('orchestrator_events', {
  id: text('id').primaryKey().$defaultFn(() => createId()),

  // Multi-tenant partition key — ALWAYS required in WHERE clauses
  tenantId: text('tenant_id').notNull(),

  // Optional session scope — null for system-level events
  sessionId: text('session_id'),

  // Registered event type (e.g. 'session.created', 'tool.called')
  type: text('type').notNull(),

  // Validated event payload (structure depends on event type)
  payload: jsonb('payload').notNull().$type<Record<string, unknown>>(),

  // Auto-incrementing sequence for global ordering and SSE cursor resumption.
  // mode: 'number' avoids BigInt serialization headaches in JSON/SSE id: lines.
  sequence: bigserial('sequence', { mode: 'number' }).notNull(),

  createdAt: timestamp('created_at').defaultNow().notNull(),
}, (table) => ({
  // Primary query path: tenant + type filter with time ordering
  tenantTypeCreatedIdx: index('orch_events_tenant_type_created_idx').on(
    table.tenantId,
    table.type,
    table.createdAt,
  ),
  // Session-scoped event queries (most common for SSE subscriptions)
  sessionSequenceIdx: index('orch_events_session_sequence_idx').on(
    table.sessionId,
    table.sequence,
  ),
  // Global sequence index for replay / cursor-based pagination
  sequenceIdx: index('orch_events_sequence_idx').on(table.sequence),
}));

// ============================================================
// TYPE EXPORTS
// ============================================================

export type OrchestratorEvent = typeof orchestratorEvents.$inferSelect;
export type NewOrchestratorEvent = typeof orchestratorEvents.$inferInsert;
