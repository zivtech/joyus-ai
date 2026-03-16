/**
 * Automated Pipelines Framework — Drizzle ORM Schema
 *
 * All tables live in the PostgreSQL `pipelines` schema, separate from
 * the existing `public` schema tables and `content` schema (Feature 006).
 *
 * Authoritative reference: kitty-specs/009-automated-pipelines-framework/data-model.md
 */

import { createId } from '@paralleldrive/cuid2';
import { relations, sql } from 'drizzle-orm';
import {
  pgSchema,
  text,
  timestamp,
  boolean,
  integer,
  real,
  jsonb,
  uniqueIndex,
  index,
} from 'drizzle-orm/pg-core';

// ============================================================
// SCHEMA NAMESPACE
// ============================================================

export const pipelinesSchema = pgSchema('pipelines');

// ============================================================
// ENUMS
// ============================================================

export const pipelineStatusEnum = pipelinesSchema.enum('pipeline_status', [
  'active', 'paused', 'disabled',
]);

export const executionStatusEnum = pipelinesSchema.enum('execution_status', [
  'pending', 'running', 'paused_at_gate', 'paused_on_failure',
  'completed', 'failed', 'cancelled',
]);

export const executionStepStatusEnum = pipelinesSchema.enum('execution_step_status', [
  'pending', 'running', 'completed', 'failed', 'skipped', 'no_op',
]);

export const triggerEventTypeEnum = pipelinesSchema.enum('trigger_event_type', [
  'corpus_change', 'schedule_tick', 'manual_request',
]);

export const triggerEventStatusEnum = pipelinesSchema.enum('trigger_event_status', [
  'pending', 'acknowledged', 'processed', 'failed', 'expired',
]);

export const stepTypeEnum = pipelinesSchema.enum('step_type', [
  'profile_generation', 'fidelity_check', 'content_generation',
  'source_query', 'review_gate', 'notification',
]);

export const concurrencyPolicyEnum = pipelinesSchema.enum('concurrency_policy', [
  'skip_if_running', 'queue', 'allow_concurrent',
]);

export const reviewDecisionStatusEnum = pipelinesSchema.enum('review_decision_status', [
  'pending', 'approved', 'rejected',
]);

// ============================================================
// TABLES
// ============================================================

// --- PipelineTemplate (defined first — referenced by pipelines.templateId) ---

export const pipelineTemplates = pipelinesSchema.table('pipeline_templates', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
  tenantId: text('tenant_id'),  // null = built-in template visible to all tenants
  name: text('name').notNull().unique(),
  description: text('description').notNull(),
  category: text('category').notNull(),
  definition: jsonb('definition').notNull(),
  parameters: jsonb('parameters').notNull(),
  assumptions: jsonb('assumptions').notNull().$defaultFn(() => []),
  version: integer('version').notNull().default(1),
  isActive: boolean('is_active').notNull().default(true),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
}, (table) => ({
  tenantIdIdx: index('pipeline_templates_tenant_id_idx').on(table.tenantId),
  categoryActiveIdx: index('pipeline_templates_category_active_idx').on(table.category, table.isActive),
  activeIdx: index('pipeline_templates_active_idx').on(table.isActive),
}));

// --- Pipeline ---

export const pipelines = pipelinesSchema.table('pipelines', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
  tenantId: text('tenant_id').notNull(),
  name: text('name').notNull(),
  description: text('description'),
  triggerType: triggerEventTypeEnum('trigger_type').notNull(),
  triggerConfig: jsonb('trigger_config').notNull(),
  retryPolicy: jsonb('retry_policy').notNull().$defaultFn(() => ({
    maxRetries: 3,
    baseDelayMs: 30000,
    maxDelayMs: 300000,
    backoffMultiplier: 2,
  })),
  concurrencyPolicy: concurrencyPolicyEnum('concurrency_policy').notNull().default('skip_if_running'),
  reviewGateTimeoutHours: integer('review_gate_timeout_hours').notNull().default(48),
  maxPipelineDepth: integer('max_pipeline_depth').notNull().default(10),
  status: pipelineStatusEnum('status').notNull().default('active'),
  templateId: text('template_id').references(() => pipelineTemplates.id, { onDelete: 'set null' }),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
}, (table) => ({
  tenantIdIdx: index('pipelines_tenant_id_idx').on(table.tenantId),
  tenantStatusIdx: index('pipelines_tenant_status_idx').on(table.tenantId, table.status),
  tenantTriggerIdx: index('pipelines_tenant_trigger_idx').on(table.tenantId, table.triggerType),
  tenantNameUnique: uniqueIndex('pipelines_tenant_name_unique').on(table.tenantId, table.name),
}));

// --- PipelineStep ---

export const pipelineSteps = pipelinesSchema.table('pipeline_steps', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
  pipelineId: text('pipeline_id').notNull().references(() => pipelines.id, { onDelete: 'cascade' }),
  position: integer('position').notNull(),
  name: text('name').notNull(),
  stepType: stepTypeEnum('step_type').notNull(),
  config: jsonb('config').notNull(),
  inputRefs: jsonb('input_refs').notNull().$defaultFn(() => []),
  retryPolicyOverride: jsonb('retry_policy_override'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
}, (table) => ({
  pipelinePositionUnique: uniqueIndex('pipeline_steps_pipeline_position_unique').on(table.pipelineId, table.position),
  pipelineIdIdx: index('pipeline_steps_pipeline_id_idx').on(table.pipelineId),
}));

// --- TriggerEvent (defined before PipelineExecution — referenced by triggerEventId) ---

export const triggerEvents = pipelinesSchema.table('trigger_events', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
  tenantId: text('tenant_id').notNull(),
  eventType: triggerEventTypeEnum('event_type').notNull(),
  payload: jsonb('payload').notNull(),
  status: triggerEventStatusEnum('status').notNull().default('pending'),
  pipelinesTriggered: jsonb('pipelines_triggered').notNull().$defaultFn(() => []),
  receivedAt: timestamp('received_at').defaultNow().notNull(),
  acknowledgedAt: timestamp('acknowledged_at'),
  processedAt: timestamp('processed_at'),
}, (table) => ({
  tenantReceivedIdx: index('trigger_events_tenant_received_idx').on(table.tenantId, table.receivedAt),
  statusReceivedIdx: index('trigger_events_status_received_idx').on(table.status, table.receivedAt),
  tenantIdIdx: index('trigger_events_tenant_id_idx').on(table.tenantId),
  unprocessedIdx: index('trigger_events_unprocessed_idx')
    .on(table.status, table.receivedAt)
    .where(sql`processed_at IS NULL`),
}));

// --- PipelineExecution ---

export const pipelineExecutions = pipelinesSchema.table('pipeline_executions', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
  pipelineId: text('pipeline_id').notNull().references(() => pipelines.id, { onDelete: 'cascade' }),
  tenantId: text('tenant_id').notNull(),
  triggerEventId: text('trigger_event_id').notNull().references(() => triggerEvents.id, { onDelete: 'cascade' }),
  status: executionStatusEnum('status').notNull().default('pending'),
  stepsCompleted: integer('steps_completed').notNull().default(0),
  stepsTotal: integer('steps_total').notNull(),
  currentStepPosition: integer('current_step_position').notNull().default(0),
  triggerChainDepth: integer('trigger_chain_depth').notNull().default(0),
  outputArtifacts: jsonb('output_artifacts').notNull().$defaultFn(() => []),
  errorDetail: jsonb('error_detail'),
  startedAt: timestamp('started_at').defaultNow().notNull(),
  completedAt: timestamp('completed_at'),
}, (table) => ({
  pipelineStartedIdx: index('executions_pipeline_started_idx').on(table.pipelineId, table.startedAt),
  tenantStartedIdx: index('executions_tenant_started_idx').on(table.tenantId, table.startedAt),
  tenantStatusIdx: index('executions_tenant_status_idx').on(table.tenantId, table.status),
  statusIdx: index('executions_status_idx').on(table.status),
}));

// --- ExecutionStep ---

export const executionSteps = pipelinesSchema.table('execution_steps', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
  executionId: text('execution_id').notNull().references(() => pipelineExecutions.id, { onDelete: 'cascade' }),
  stepId: text('step_id').notNull().references(() => pipelineSteps.id, { onDelete: 'cascade' }),
  position: integer('position').notNull(),
  status: executionStepStatusEnum('status').notNull().default('pending'),
  attempts: integer('attempts').notNull().default(0),
  idempotencyKey: text('idempotency_key').notNull(),
  inputData: jsonb('input_data'),
  outputData: jsonb('output_data'),
  errorDetail: jsonb('error_detail'),
  startedAt: timestamp('started_at'),
  completedAt: timestamp('completed_at'),
}, (table) => ({
  executionPositionUnique: uniqueIndex('exec_steps_execution_position_unique').on(table.executionId, table.position),
  executionIdIdx: index('exec_steps_execution_id_idx').on(table.executionId),
  executionStatusIdx: index('exec_steps_execution_status_idx').on(table.executionId, table.status),
}));

// --- ReviewDecision ---

export const reviewDecisions = pipelinesSchema.table('review_decisions', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
  executionId: text('execution_id').notNull().references(() => pipelineExecutions.id, { onDelete: 'cascade' }),
  executionStepId: text('execution_step_id').notNull().references(() => executionSteps.id, { onDelete: 'cascade' }),
  tenantId: text('tenant_id').notNull(),
  artifactRef: jsonb('artifact_ref').notNull(),
  profileVersionRef: text('profile_version_ref'),
  reviewerId: text('reviewer_id'),
  status: reviewDecisionStatusEnum('status').notNull().default('pending'),
  feedback: jsonb('feedback'),
  decidedAt: timestamp('decided_at'),
  escalatedAt: timestamp('escalated_at'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
}, (table) => ({
  executionStepIdx: index('review_decisions_execution_step_idx').on(table.executionId, table.executionStepId),
  tenantStatusIdx: index('review_decisions_tenant_status_idx').on(table.tenantId, table.status),
  stepStatusIdx: index('review_decisions_step_status_idx').on(table.executionStepId, table.status),
  tenantIdIdx: index('review_decisions_tenant_id_idx').on(table.tenantId),
}));

// --- PipelineMetrics ---

export const pipelineMetrics = pipelinesSchema.table('pipeline_metrics', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
  pipelineId: text('pipeline_id').notNull().references(() => pipelines.id, { onDelete: 'cascade' }),
  tenantId: text('tenant_id').notNull(),
  windowStart: timestamp('window_start').notNull(),
  windowEnd: timestamp('window_end').notNull(),
  totalExecutions: integer('total_executions').notNull().default(0),
  successCount: integer('success_count').notNull().default(0),
  failureCount: integer('failure_count').notNull().default(0),
  cancelledCount: integer('cancelled_count').notNull().default(0),
  meanDurationMs: integer('mean_duration_ms'),
  p95DurationMs: integer('p95_duration_ms'),
  failureBreakdown: jsonb('failure_breakdown').notNull().$defaultFn(() => ({})),
  reviewApprovalRate: real('review_approval_rate'),
  reviewRejectionRate: real('review_rejection_rate'),
  meanTimeToReviewMs: integer('mean_time_to_review_ms'),
  refreshedAt: timestamp('refreshed_at').defaultNow().notNull(),
}, (table) => ({
  pipelineWindowIdx: index('pipeline_metrics_pipeline_window_idx').on(table.pipelineId, table.windowEnd),
  tenantWindowIdx: index('pipeline_metrics_tenant_window_idx').on(table.tenantId, table.windowEnd),
  tenantIdIdx: index('pipeline_metrics_tenant_id_idx').on(table.tenantId),
}));

// --- QualitySignal ---

export const qualitySignals = pipelinesSchema.table('quality_signals', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
  pipelineId: text('pipeline_id').notNull().references(() => pipelines.id, { onDelete: 'cascade' }),
  tenantId: text('tenant_id').notNull(),
  signalType: text('signal_type').notNull(),
  severity: text('severity').notNull(),  // 'info' | 'warning' | 'critical'
  message: text('message').notNull(),
  metadata: jsonb('metadata').notNull().$defaultFn(() => ({})),
  acknowledgedAt: timestamp('acknowledged_at'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
}, (table) => ({
  pipelineIdx: index('quality_signals_pipeline_id_idx').on(table.pipelineId),
  tenantIdx: index('quality_signals_tenant_id_idx').on(table.tenantId),
  unacknowledgedIdx: index('quality_signals_unack_idx')
    .on(table.tenantId, table.createdAt)
    .where(sql`acknowledged_at IS NULL`),
}));

// ============================================================
// RELATIONS
// ============================================================

export const pipelinesRelations = relations(pipelines, ({ one, many }) => ({
  steps: many(pipelineSteps),
  executions: many(pipelineExecutions),
  metrics: many(pipelineMetrics),
  qualitySignals: many(qualitySignals),
  template: one(pipelineTemplates, {
    fields: [pipelines.templateId],
    references: [pipelineTemplates.id],
  }),
}));

export const pipelineStepsRelations = relations(pipelineSteps, ({ one, many }) => ({
  pipeline: one(pipelines, {
    fields: [pipelineSteps.pipelineId],
    references: [pipelines.id],
  }),
  executionSteps: many(executionSteps),
}));

export const pipelineExecutionsRelations = relations(pipelineExecutions, ({ one, many }) => ({
  pipeline: one(pipelines, {
    fields: [pipelineExecutions.pipelineId],
    references: [pipelines.id],
  }),
  triggerEvent: one(triggerEvents, {
    fields: [pipelineExecutions.triggerEventId],
    references: [triggerEvents.id],
  }),
  executionSteps: many(executionSteps),
  reviewDecisions: many(reviewDecisions),
}));

export const executionStepsRelations = relations(executionSteps, ({ one }) => ({
  execution: one(pipelineExecutions, {
    fields: [executionSteps.executionId],
    references: [pipelineExecutions.id],
  }),
  step: one(pipelineSteps, {
    fields: [executionSteps.stepId],
    references: [pipelineSteps.id],
  }),
}));

export const triggerEventsRelations = relations(triggerEvents, ({ many }) => ({
  executions: many(pipelineExecutions),
}));

export const reviewDecisionsRelations = relations(reviewDecisions, ({ one }) => ({
  execution: one(pipelineExecutions, {
    fields: [reviewDecisions.executionId],
    references: [pipelineExecutions.id],
  }),
  executionStep: one(executionSteps, {
    fields: [reviewDecisions.executionStepId],
    references: [executionSteps.id],
  }),
}));

export const pipelineTemplatesRelations = relations(pipelineTemplates, ({ many }) => ({
  pipelines: many(pipelines),
}));

export const pipelineMetricsRelations = relations(pipelineMetrics, ({ one }) => ({
  pipeline: one(pipelines, {
    fields: [pipelineMetrics.pipelineId],
    references: [pipelines.id],
  }),
}));

export const qualitySignalsRelations = relations(qualitySignals, ({ one }) => ({
  pipeline: one(pipelines, {
    fields: [qualitySignals.pipelineId],
    references: [pipelines.id],
  }),
}));

// ============================================================
// TYPE EXPORTS
// ============================================================

export type Pipeline = typeof pipelines.$inferSelect;
export type NewPipeline = typeof pipelines.$inferInsert;

export type PipelineStep = typeof pipelineSteps.$inferSelect;
export type NewPipelineStep = typeof pipelineSteps.$inferInsert;

export type PipelineExecution = typeof pipelineExecutions.$inferSelect;
export type NewPipelineExecution = typeof pipelineExecutions.$inferInsert;

export type ExecutionStep = typeof executionSteps.$inferSelect;
export type NewExecutionStep = typeof executionSteps.$inferInsert;

export type TriggerEvent = typeof triggerEvents.$inferSelect;
export type NewTriggerEvent = typeof triggerEvents.$inferInsert;

export type ReviewDecision = typeof reviewDecisions.$inferSelect;
export type NewReviewDecision = typeof reviewDecisions.$inferInsert;

export type PipelineTemplate = typeof pipelineTemplates.$inferSelect;
export type NewPipelineTemplate = typeof pipelineTemplates.$inferInsert;

export type PipelineMetric = typeof pipelineMetrics.$inferSelect;
export type NewPipelineMetric = typeof pipelineMetrics.$inferInsert;

export type QualitySignal = typeof qualitySignals.$inferSelect;
export type NewQualitySignal = typeof qualitySignals.$inferInsert;
