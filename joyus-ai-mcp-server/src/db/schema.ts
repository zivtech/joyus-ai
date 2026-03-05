/**
 * Drizzle ORM Schema
 *
 * Converted from Prisma schema for pure TypeScript ORM without binary dependencies.
 */

import { createId } from '@paralleldrive/cuid2';
import { relations } from 'drizzle-orm';
import {
  pgTable,
  pgEnum,
  text,
  timestamp,
  boolean,
  integer,
  json,
  uniqueIndex,
  index
} from 'drizzle-orm/pg-core';

// ============================================================
// ENUMS
// ============================================================

export const serviceEnum = pgEnum('service', ['JIRA', 'SLACK', 'GITHUB', 'GOOGLE']);

export const exportStatusEnum = pgEnum('export_status', ['pending', 'completed', 'failed']);
export const exportScopeEnum = pgEnum('export_scope', ['current_view', 'full_period']);
export const exportLocationsEnum = pgEnum('export_locations', ['current', 'all_accessible']);
export const controlPlaneRiskLevelEnum = pgEnum('control_plane_risk_level', ['low', 'medium', 'high']);
export const controlPlanePolicyOutcomeEnum = pgEnum('control_plane_policy_outcome', ['allow', 'deny', 'escalate']);
export const controlPlaneRuntimeTargetEnum = pgEnum('control_plane_runtime_target', ['local', 'remote']);
export const controlPlaneEventOutcomeEnum = pgEnum('control_plane_event_outcome', ['pass', 'fail', 'warn']);
export const controlPlaneWorkspaceModeEnum = pgEnum('control_plane_workspace_mode', ['managed_remote', 'local']);
export const controlPlaneWorkspaceStatusEnum = pgEnum('control_plane_workspace_status', ['ready']);
export const controlPlaneApprovalStatusEnum = pgEnum('control_plane_approval_status', ['requested', 'approved', 'denied', 'expired', 'cancelled']);
export const controlPlaneTenantRoleEnum = pgEnum('control_plane_tenant_role', ['owner', 'admin', 'operator', 'reviewer', 'viewer']);
export const controlPlaneTenantMemberStatusEnum = pgEnum('control_plane_tenant_member_status', ['active', 'invited', 'revoked']);

export const taskTypeEnum = pgEnum('task_type', [
  'JIRA_STANDUP_SUMMARY',
  'JIRA_OVERDUE_ALERT',
  'JIRA_SPRINT_REPORT',
  'SLACK_CHANNEL_DIGEST',
  'SLACK_MENTIONS_SUMMARY',
  'GITHUB_PR_REMINDER',
  'GITHUB_STALE_PR_ALERT',
  'GITHUB_RELEASE_NOTES',
  'GMAIL_DIGEST',
  'WEEKLY_STATUS_REPORT',
  'CUSTOM_TOOL_SEQUENCE'
]);

export const taskRunStatusEnum = pgEnum('task_run_status', [
  'PENDING',
  'RUNNING',
  'COMPLETED',
  'FAILED',
  'SKIPPED'
]);

// ============================================================
// TABLES
// ============================================================

// Users who have onboarded via the Auth Portal
export const users = pgTable('users', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
  email: text('email').notNull().unique(),
  name: text('name'),
  mcpToken: text('mcp_token').notNull().unique(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull()
});

// OAuth tokens for connected services
export const connections = pgTable('connections', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
  userId: text('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  service: serviceEnum('service').notNull(),
  accessToken: text('access_token').notNull(),  // Encrypted
  refreshToken: text('refresh_token'),           // Encrypted
  expiresAt: timestamp('expires_at'),
  scope: text('scope'),
  metadata: json('metadata'),  // Service-specific data
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull()
}, (table) => ({
  userServiceUnique: uniqueIndex('connections_user_service_unique').on(table.userId, table.service),
  userIdIdx: index('connections_user_id_idx').on(table.userId)
}));

// Audit log for tool executions
export const auditLogs = pgTable('audit_logs', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
  userId: text('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  tool: text('tool').notNull(),
  input: json('input').notNull(),
  success: boolean('success').notNull(),
  error: text('error'),
  duration: integer('duration').notNull(),  // milliseconds
  createdAt: timestamp('created_at').defaultNow().notNull()
}, (table) => ({
  userCreatedIdx: index('audit_logs_user_created_idx').on(table.userId, table.createdAt),
  toolCreatedIdx: index('audit_logs_tool_created_idx').on(table.tool, table.createdAt)
}));

// Pending OAuth flows (state parameter tracking)
export const oauthStates = pgTable('oauth_states', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
  state: text('state').notNull().unique(),
  userId: text('user_id').notNull(),
  service: serviceEnum('service').notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  expiresAt: timestamp('expires_at').notNull()
}, (table) => ({
  stateIdx: index('oauth_states_state_idx').on(table.state)
}));

// Scheduled task definition
export const scheduledTasks = pgTable('scheduled_tasks', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
  userId: text('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  name: text('name').notNull(),
  description: text('description'),

  // Schedule
  schedule: text('schedule').notNull(),  // Cron expression
  timezone: text('timezone').notNull().default('America/New_York'),

  // Task definition
  taskType: taskTypeEnum('task_type').notNull(),
  config: json('config').notNull(),

  // Notification settings
  notifySlack: text('notify_slack'),
  notifyEmail: text('notify_email'),
  notifyOnError: boolean('notify_on_error').notNull().default(true),
  notifyOnSuccess: boolean('notify_on_success').notNull().default(false),

  // State
  enabled: boolean('enabled').notNull().default(true),
  lastRunAt: timestamp('last_run_at'),
  nextRunAt: timestamp('next_run_at'),

  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull()
}, (table) => ({
  userIdIdx: index('scheduled_tasks_user_id_idx').on(table.userId),
  enabledNextRunIdx: index('scheduled_tasks_enabled_next_run_idx').on(table.enabled, table.nextRunAt)
}));

// Export jobs (persisted download tokens)
export const exportJobs = pgTable('export_jobs', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
  userId: text('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  tenantId: text('tenant_id').notNull(),
  status: exportStatusEnum('status').notNull().default('pending'),
  scope: exportScopeEnum('scope').notNull(),
  locations: exportLocationsEnum('locations').notNull(),
  dateStart: text('date_start'),
  dateEnd: text('date_end'),
  scenarioId: text('scenario_id'),
  filePath: text('file_path'),
  fileName: text('file_name'),
  fileSizeBytes: integer('file_size_bytes'),
  error: text('error'),
  downloadToken: text('download_token').unique(),
  downloadExpiresAt: timestamp('download_expires_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
}, (table) => ({
  userIdIdx: index('export_jobs_user_id_idx').on(table.userId),
  tenantIdIdx: index('export_jobs_tenant_id_idx').on(table.tenantId),
  downloadExpiresIdx: index('export_jobs_download_expires_idx').on(table.downloadExpiresAt),
}));

// Control plane workspace allocation records
export const controlPlaneWorkspaces = pgTable('control_plane_workspaces', {
  id: text('id').primaryKey(),
  tenantId: text('tenant_id').notNull(),
  mode: controlPlaneWorkspaceModeEnum('mode').notNull(),
  createdBy: text('created_by').notNull().references(() => users.id, { onDelete: 'cascade' }),
  label: text('label'),
  status: controlPlaneWorkspaceStatusEnum('status').notNull().default('ready'),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
}, (table) => ({
  tenantIdx: index('control_plane_workspaces_tenant_idx').on(table.tenantId),
  createdByIdx: index('control_plane_workspaces_created_by_idx').on(table.createdBy),
}));

// Control plane artifact provenance records
export const controlPlaneArtifacts = pgTable('control_plane_artifacts', {
  id: text('id').primaryKey(),
  tenantId: text('tenant_id').notNull(),
  workspaceId: text('workspace_id').notNull().references(() => controlPlaneWorkspaces.id, { onDelete: 'cascade' }),
  sessionId: text('session_id').notNull(),
  artifactType: text('artifact_type').notNull(),
  uri: text('uri').notNull(),
  policyDecisionJti: text('policy_decision_jti').notNull(),
  expiresAt: timestamp('expires_at', { withTimezone: true }),
  skillIds: json('skill_ids').notNull().default([]),
  metadata: json('metadata'),
  createdBy: text('created_by').notNull().references(() => users.id, { onDelete: 'cascade' }),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
}, (table) => ({
  tenantIdx: index('control_plane_artifacts_tenant_idx').on(table.tenantId),
  workspaceIdx: index('control_plane_artifacts_workspace_idx').on(table.workspaceId),
  sessionIdx: index('control_plane_artifacts_session_idx').on(table.sessionId),
  expiresIdx: index('control_plane_artifacts_expires_idx').on(table.expiresAt),
}));

// Control plane event ledger
export const controlPlaneEvents = pgTable('control_plane_events', {
  id: text('id').primaryKey(),
  tenantId: text('tenant_id').notNull(),
  workspaceId: text('workspace_id').notNull().references(() => controlPlaneWorkspaces.id, { onDelete: 'cascade' }),
  sessionId: text('session_id').notNull(),
  userId: text('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  actionType: text('action_type').notNull(),
  riskLevel: controlPlaneRiskLevelEnum('risk_level').notNull(),
  policyResult: controlPlanePolicyOutcomeEnum('policy_result').notNull(),
  runtimeTarget: controlPlaneRuntimeTargetEnum('runtime_target').notNull(),
  skillIds: json('skill_ids').notNull().default([]),
  artifactIds: json('artifact_ids').notNull().default([]),
  outcome: controlPlaneEventOutcomeEnum('outcome').notNull().default('pass'),
  errorCode: text('error_code'),
  latencyMs: integer('latency_ms'),
  details: json('details'),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
}, (table) => ({
  tenantIdx: index('control_plane_events_tenant_idx').on(table.tenantId),
  workspaceIdx: index('control_plane_events_workspace_idx').on(table.workspaceId),
  sessionIdx: index('control_plane_events_session_idx').on(table.sessionId),
  createdAtIdx: index('control_plane_events_created_at_idx').on(table.createdAt),
}));

// Issued policy decision JTIs (single-use replay protection)
export const controlPlanePolicyJtis = pgTable('control_plane_policy_jtis', {
  jti: text('jti').primaryKey(),
  tenantId: text('tenant_id').notNull(),
  workspaceId: text('workspace_id').notNull().default(''),
  sessionId: text('session_id').notNull(),
  actionName: text('action_name').notNull(),
  riskLevel: controlPlaneRiskLevelEnum('risk_level').notNull(),
  decision: controlPlanePolicyOutcomeEnum('decision').notNull(),
  issuedBy: text('issued_by').notNull().references(() => users.id, { onDelete: 'cascade' }),
  issuedAt: timestamp('issued_at', { withTimezone: true }).defaultNow().notNull(),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  consumedAt: timestamp('consumed_at', { withTimezone: true }),
  consumedBy: text('consumed_by').references(() => users.id, { onDelete: 'set null' }),
}, (table) => ({
  tenantSessionIdx: index('control_plane_policy_jtis_tenant_session_idx').on(table.tenantId, table.sessionId),
  expiresIdx: index('control_plane_policy_jtis_expires_idx').on(table.expiresAt),
  consumedIdx: index('control_plane_policy_jtis_consumed_idx').on(table.consumedAt),
}));

// Tenant membership and role records for control-plane authorization
export const controlPlaneTenantMemberships = pgTable('control_plane_tenant_memberships', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
  tenantId: text('tenant_id').notNull(),
  userId: text('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  role: controlPlaneTenantRoleEnum('role').notNull(),
  status: controlPlaneTenantMemberStatusEnum('status').notNull().default('active'),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
}, (table) => ({
  tenantUserUnique: uniqueIndex('control_plane_tenant_memberships_tenant_user_unique').on(table.tenantId, table.userId),
  tenantRoleIdx: index('control_plane_tenant_memberships_tenant_role_idx').on(table.tenantId, table.role),
  userStatusIdx: index('control_plane_tenant_memberships_user_status_idx').on(table.userId, table.status),
}));

// Human approvals for escalated policy outcomes
export const controlPlaneApprovals = pgTable('control_plane_approvals', {
  id: text('id').primaryKey(),
  tenantId: text('tenant_id').notNull(),
  workspaceId: text('workspace_id').notNull().default(''),
  sessionId: text('session_id').notNull(),
  actionType: text('action_type').notNull(),
  riskLevel: controlPlaneRiskLevelEnum('risk_level').notNull(),
  policyDecisionJti: text('policy_decision_jti').notNull(),
  status: controlPlaneApprovalStatusEnum('status').notNull().default('requested'),
  requestReason: text('request_reason'),
  requestedBy: text('requested_by').notNull().references(() => users.id, { onDelete: 'cascade' }),
  requestedAt: timestamp('requested_at', { withTimezone: true }).defaultNow().notNull(),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  decidedBy: text('decided_by').references(() => users.id, { onDelete: 'set null' }),
  decidedAt: timestamp('decided_at', { withTimezone: true }),
  decisionReason: text('decision_reason'),
  metadata: json('metadata'),
}, (table) => ({
  tenantSessionIdx: index('control_plane_approvals_tenant_session_idx').on(table.tenantId, table.sessionId),
  policyJtiIdx: index('control_plane_approvals_policy_jti_idx').on(table.policyDecisionJti),
  statusExpiresIdx: index('control_plane_approvals_status_expires_idx').on(table.status, table.expiresAt),
}));

// Individual task execution record
export const taskRuns = pgTable('task_runs', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
  taskId: text('task_id').notNull().references(() => scheduledTasks.id, { onDelete: 'cascade' }),
  userId: text('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),

  status: taskRunStatusEnum('status').notNull(),
  startedAt: timestamp('started_at').defaultNow().notNull(),
  completedAt: timestamp('completed_at'),
  duration: integer('duration'),  // milliseconds

  // Results
  output: json('output'),
  error: text('error'),

  // Notification tracking
  notified: boolean('notified').notNull().default(false),
  notifiedAt: timestamp('notified_at')
}, (table) => ({
  taskStartedIdx: index('task_runs_task_started_idx').on(table.taskId, table.startedAt),
  userStartedIdx: index('task_runs_user_started_idx').on(table.userId, table.startedAt),
  statusIdx: index('task_runs_status_idx').on(table.status)
}));

// ============================================================
// RELATIONS
// ============================================================

export const usersRelations = relations(users, ({ many }) => ({
  connections: many(connections),
  auditLogs: many(auditLogs),
  scheduledTasks: many(scheduledTasks),
  taskRuns: many(taskRuns),
  exportJobs: many(exportJobs),
  controlPlaneWorkspaces: many(controlPlaneWorkspaces),
  controlPlaneArtifacts: many(controlPlaneArtifacts),
  controlPlaneEvents: many(controlPlaneEvents),
  issuedPolicyJtis: many(controlPlanePolicyJtis),
  controlPlaneTenantMemberships: many(controlPlaneTenantMemberships),
  requestedApprovals: many(controlPlaneApprovals),
  decidedApprovals: many(controlPlaneApprovals),
}));

export const connectionsRelations = relations(connections, ({ one }) => ({
  user: one(users, {
    fields: [connections.userId],
    references: [users.id]
  })
}));

export const auditLogsRelations = relations(auditLogs, ({ one }) => ({
  user: one(users, {
    fields: [auditLogs.userId],
    references: [users.id]
  })
}));

export const exportJobsRelations = relations(exportJobs, ({ one }) => ({
  user: one(users, {
    fields: [exportJobs.userId],
    references: [users.id]
  })
}));

export const controlPlaneWorkspacesRelations = relations(controlPlaneWorkspaces, ({ one, many }) => ({
  createdByUser: one(users, {
    fields: [controlPlaneWorkspaces.createdBy],
    references: [users.id]
  }),
  artifacts: many(controlPlaneArtifacts),
  events: many(controlPlaneEvents),
}));

export const controlPlaneArtifactsRelations = relations(controlPlaneArtifacts, ({ one }) => ({
  workspace: one(controlPlaneWorkspaces, {
    fields: [controlPlaneArtifacts.workspaceId],
    references: [controlPlaneWorkspaces.id]
  }),
  createdByUser: one(users, {
    fields: [controlPlaneArtifacts.createdBy],
    references: [users.id]
  }),
}));

export const controlPlaneEventsRelations = relations(controlPlaneEvents, ({ one }) => ({
  workspace: one(controlPlaneWorkspaces, {
    fields: [controlPlaneEvents.workspaceId],
    references: [controlPlaneWorkspaces.id]
  }),
  user: one(users, {
    fields: [controlPlaneEvents.userId],
    references: [users.id]
  }),
}));

export const controlPlanePolicyJtisRelations = relations(controlPlanePolicyJtis, ({ one }) => ({
  issuedByUser: one(users, {
    fields: [controlPlanePolicyJtis.issuedBy],
    references: [users.id]
  }),
  consumedByUser: one(users, {
    fields: [controlPlanePolicyJtis.consumedBy],
    references: [users.id]
  }),
}));

export const controlPlaneTenantMembershipsRelations = relations(controlPlaneTenantMemberships, ({ one }) => ({
  user: one(users, {
    fields: [controlPlaneTenantMemberships.userId],
    references: [users.id]
  }),
}));

export const controlPlaneApprovalsRelations = relations(controlPlaneApprovals, ({ one }) => ({
  requestedByUser: one(users, {
    fields: [controlPlaneApprovals.requestedBy],
    references: [users.id]
  }),
  decidedByUser: one(users, {
    fields: [controlPlaneApprovals.decidedBy],
    references: [users.id]
  }),
}));

export const scheduledTasksRelations = relations(scheduledTasks, ({ one, many }) => ({
  user: one(users, {
    fields: [scheduledTasks.userId],
    references: [users.id]
  }),
  runs: many(taskRuns)
}));

export const taskRunsRelations = relations(taskRuns, ({ one }) => ({
  task: one(scheduledTasks, {
    fields: [taskRuns.taskId],
    references: [scheduledTasks.id]
  }),
  user: one(users, {
    fields: [taskRuns.userId],
    references: [users.id]
  })
}));

// ============================================================
// TYPE EXPORTS
// ============================================================

export type User = typeof users.$inferSelect;
export type NewUser = typeof users.$inferInsert;

export type Connection = typeof connections.$inferSelect;
export type NewConnection = typeof connections.$inferInsert;

export type AuditLog = typeof auditLogs.$inferSelect;
export type NewAuditLog = typeof auditLogs.$inferInsert;

export type OAuthState = typeof oauthStates.$inferSelect;
export type NewOAuthState = typeof oauthStates.$inferInsert;

export type ScheduledTask = typeof scheduledTasks.$inferSelect;
export type NewScheduledTask = typeof scheduledTasks.$inferInsert;

export type TaskRun = typeof taskRuns.$inferSelect;
export type NewTaskRun = typeof taskRuns.$inferInsert;

export type ExportJob = typeof exportJobs.$inferSelect;
export type NewExportJob = typeof exportJobs.$inferInsert;

export type ControlPlaneWorkspace = typeof controlPlaneWorkspaces.$inferSelect;
export type NewControlPlaneWorkspace = typeof controlPlaneWorkspaces.$inferInsert;

export type ControlPlaneArtifact = typeof controlPlaneArtifacts.$inferSelect;
export type NewControlPlaneArtifact = typeof controlPlaneArtifacts.$inferInsert;

export type ControlPlaneEvent = typeof controlPlaneEvents.$inferSelect;
export type NewControlPlaneEvent = typeof controlPlaneEvents.$inferInsert;

export type ControlPlanePolicyJti = typeof controlPlanePolicyJtis.$inferSelect;
export type NewControlPlanePolicyJti = typeof controlPlanePolicyJtis.$inferInsert;

export type ControlPlaneTenantMembership = typeof controlPlaneTenantMemberships.$inferSelect;
export type NewControlPlaneTenantMembership = typeof controlPlaneTenantMemberships.$inferInsert;

export type ControlPlaneApproval = typeof controlPlaneApprovals.$inferSelect;
export type NewControlPlaneApproval = typeof controlPlaneApprovals.$inferInsert;

export type Service = 'JIRA' | 'SLACK' | 'GITHUB' | 'GOOGLE';
export type TaskType =
  | 'JIRA_STANDUP_SUMMARY' | 'JIRA_OVERDUE_ALERT' | 'JIRA_SPRINT_REPORT'
  | 'SLACK_CHANNEL_DIGEST' | 'SLACK_MENTIONS_SUMMARY'
  | 'GITHUB_PR_REMINDER' | 'GITHUB_STALE_PR_ALERT' | 'GITHUB_RELEASE_NOTES'
  | 'GMAIL_DIGEST' | 'WEEKLY_STATUS_REPORT' | 'CUSTOM_TOOL_SEQUENCE';
export type TaskRunStatus = 'PENDING' | 'RUNNING' | 'COMPLETED' | 'FAILED' | 'SKIPPED';
