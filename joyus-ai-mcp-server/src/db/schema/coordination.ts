/**
 * Coordination DB Schema — WP04
 *
 * Defines work_units and coordination_groups tables for multi-agent coordination.
 * Inspired by Gas City's bead model: work units are beads that flow through states,
 * and coordination groups are the strands that determine when a logical task is done.
 *
 * ID / FK convention note:
 *   Follows the same text/cuid2 pattern as orchestrator.ts and events.ts —
 *   NOT UUID, even though data-model.md spec lists UUID. The codebase uses text
 *   IDs throughout for consistency with the users table.
 *
 * Empty group policy:
 *   A coordination group with zero work units never auto-completes — it stays
 *   'active' until work units are added and evaluated. Callers that want to
 *   immediately resolve empty groups must check unit count before calling
 *   evaluateCompletion.
 */

import { createId } from '@paralleldrive/cuid2';
import {
  pgTable,
  pgEnum,
  text,
  timestamp,
  jsonb,
  index,
} from 'drizzle-orm/pg-core';

import { orchestratorSessions } from './orchestrator.js';

// ============================================================
// ENUMS
// ============================================================

export const completionPolicyEnum = pgEnum('coordination_completion_policy', [
  'all',
  'any',
  'majority',
]);

export const coordinationGroupStatusEnum = pgEnum('coordination_group_status', [
  'active',
  'completed',
  'failed',
]);

export const workUnitStatusEnum = pgEnum('work_unit_status', [
  'pending',
  'assigned',
  'running',
  'completed',
  'failed',
  'cancelled',
]);

// ============================================================
// COORDINATION GROUPS TABLE
// ============================================================

/**
 * Coordination groups — logical grouping of work units with completion semantics.
 *
 * Lifecycle:
 *   active → completed (when completionPolicy is satisfied)
 *   active → failed    (when a required work unit fails with no recovery)
 *
 * All queries MUST include tenantId in WHERE clause.
 */
export const coordinationGroups = pgTable('coordination_groups', {
  id: text('id').primaryKey().$defaultFn(() => createId()),

  // Multi-tenant partition key — ALWAYS required in WHERE clauses
  tenantId: text('tenant_id').notNull(),

  // Human-readable label for the group
  title: text('title').notNull(),

  // Determines when the group transitions from 'active' to 'completed'
  completionPolicy: completionPolicyEnum('completion_policy').notNull().default('all'),

  // Lifecycle status
  status: coordinationGroupStatusEnum('status').notNull().default('active'),

  // Extensible metadata bag
  metadata: jsonb('metadata').$type<Record<string, unknown>>().default({}),

  createdAt: timestamp('created_at').defaultNow().notNull(),
  completedAt: timestamp('completed_at'),
}, (table) => ({
  // Primary query path: list groups by tenant + status
  tenantStatusIdx: index('coord_groups_tenant_status_idx').on(table.tenantId, table.status),
}));

// ============================================================
// WORK UNITS TABLE
// ============================================================

/**
 * Work units — individual pieces of agent work with lifecycle tracking.
 *
 * Inspired by Gas City's bead model: each bead (work unit) has status,
 * dependencies, labels, and metadata. Dependencies form a DAG — cycles
 * are rejected at creation time via DFS.
 *
 * Lifecycle:
 *   pending → assigned → running → completed
 *   pending → assigned → running → failed
 *   pending → cancelled
 *   (any status) → cancelled (manual cancellation)
 *
 * Dependency rules:
 *   - A work unit cannot transition to 'running' until ALL dependencies are 'completed'.
 *   - If any dependency transitions to 'failed' or 'cancelled', the dependent work
 *     unit should also be cancelled (enforced at the service layer, not the DB).
 *
 * All queries MUST include tenantId in WHERE clause.
 */
export const workUnits = pgTable('work_units', {
  id: text('id').primaryKey().$defaultFn(() => createId()),

  // Multi-tenant partition key — ALWAYS required in WHERE clauses
  tenantId: text('tenant_id').notNull(),

  // Optional: the orchestrator session this work unit belongs to
  sessionId: text('session_id').references(() => orchestratorSessions.id, { onDelete: 'set null' }),

  // Optional: the coordination group this work unit is part of
  coordinationGroupId: text('coordination_group_id').references(
    () => coordinationGroups.id,
    { onDelete: 'set null' },
  ),

  // Lifecycle status
  status: workUnitStatusEnum('status').notNull().default('pending'),

  // Human-readable description of the work
  title: text('title').notNull(),

  // Categorization (e.g., 'research', 'generation', 'analysis')
  type: text('type').notNull(),

  // Agent or system that owns this work unit
  assignee: text('assignee'),

  // IDs of work units that must complete before this one can run.
  // Uses text array (not UUID array) to match the cuid2 ID convention.
  // Cycle detection is enforced at creation time (DFS in CoordinationService).
  dependencies: text('dependencies').array().notNull().default([]),

  // Freeform tags for filtering and categorization
  labels: text('labels').array().notNull().default([]),

  // Extensible metadata bag
  metadata: jsonb('metadata').$type<Record<string, unknown>>().default({}),

  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
  completedAt: timestamp('completed_at'),
}, (table) => ({
  // Tenant + status composite index — primary query path for status polling
  tenantStatusIdx: index('work_units_tenant_status_idx').on(table.tenantId, table.status),
  // Group lookup — used when evaluating completion policies
  coordinationGroupIdx: index('work_units_coordination_group_idx').on(table.coordinationGroupId),
  // Tenant + session lookup — common access pattern for session-scoped work
  tenantSessionIdx: index('work_units_tenant_session_idx').on(table.tenantId, table.sessionId),
}));

// ============================================================
// TYPE EXPORTS
// ============================================================

export type CoordinationGroup = typeof coordinationGroups.$inferSelect;
export type NewCoordinationGroup = typeof coordinationGroups.$inferInsert;

export type WorkUnit = typeof workUnits.$inferSelect;
export type NewWorkUnit = typeof workUnits.$inferInsert;

export type CompletionPolicy = 'all' | 'any' | 'majority';
export type CoordinationGroupStatus = 'active' | 'completed' | 'failed';
export type WorkUnitStatus = 'pending' | 'assigned' | 'running' | 'completed' | 'failed' | 'cancelled';
