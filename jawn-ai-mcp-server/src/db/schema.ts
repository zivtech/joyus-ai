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
  taskRuns: many(taskRuns)
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

export type Service = 'JIRA' | 'SLACK' | 'GITHUB' | 'GOOGLE';
export type TaskType =
  | 'JIRA_STANDUP_SUMMARY' | 'JIRA_OVERDUE_ALERT' | 'JIRA_SPRINT_REPORT'
  | 'SLACK_CHANNEL_DIGEST' | 'SLACK_MENTIONS_SUMMARY'
  | 'GITHUB_PR_REMINDER' | 'GITHUB_STALE_PR_ALERT' | 'GITHUB_RELEASE_NOTES'
  | 'GMAIL_DIGEST' | 'WEEKLY_STATUS_REPORT' | 'CUSTOM_TOOL_SEQUENCE';
export type TaskRunStatus = 'PENDING' | 'RUNNING' | 'COMPLETED' | 'FAILED' | 'SKIPPED';
