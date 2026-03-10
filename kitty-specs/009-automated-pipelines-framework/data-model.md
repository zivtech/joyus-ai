# Data Model: Automated Pipelines Framework
*Phase 1 output for Feature 009*

## Schema Overview

All pipeline framework tables live in the PostgreSQL `pipelines` schema, separate from the existing `public` schema (platform core) and `content` schema (Feature 006). This provides clean namespace boundaries and enables independent access control.

```
pipelines schema
├── pipelines              # Pipeline definitions (trigger + steps + config)
├── pipeline_steps         # Step definitions within a pipeline
├── pipeline_executions    # Individual execution records
├── execution_steps        # Per-step execution state within an execution
├── trigger_events         # Event queue (source of truth for delivery guarantee)
├── review_decisions       # Reviewer approval/rejection records
├── pipeline_templates     # Reusable pipeline templates
└── pipeline_metrics       # Aggregated execution metrics (materialized)
```

## Enums

### Pipeline Status
```typescript
'active' | 'paused' | 'disabled'
```

### Pipeline Execution Status
```typescript
'pending' | 'running' | 'paused_at_gate' | 'paused_on_failure' | 'completed' | 'failed' | 'cancelled'
```

### Execution Step Status
```typescript
'pending' | 'running' | 'completed' | 'failed' | 'skipped' | 'no_op'
```

### Trigger Event Type
```typescript
'corpus_change' | 'schedule_tick' | 'manual_request'
```

### Trigger Event Status
```typescript
'pending' | 'acknowledged' | 'processed' | 'failed' | 'expired'
```

### Step Type
```typescript
'profile_generation' | 'fidelity_check' | 'content_generation' | 'source_query' | 'review_gate' | 'notification'
```

### Concurrency Policy
```typescript
'skip_if_running' | 'queue' | 'allow_concurrent'
```

### Review Decision Status
```typescript
'pending' | 'approved' | 'rejected'
```

## Entities

### Pipeline

A tenant-scoped pipeline definition containing trigger configuration, ordered steps, retry policy, and concurrency settings.

| Field | Type | Constraints | Description |
|-------|------|-------------|-------------|
| id | text (CUID2) | PK | Unique identifier |
| tenantId | text | NOT NULL, INDEX | Tenant this pipeline belongs to |
| name | text | NOT NULL | Human-readable pipeline name |
| description | text | NULL | Purpose description |
| triggerType | enum | NOT NULL | `corpus_change` \| `schedule_tick` \| `manual_request` |
| triggerConfig | jsonb | NOT NULL | Trigger-specific configuration (e.g., cron expression, corpus filter) |
| retryPolicy | jsonb | NOT NULL, DEFAULT | Default retry config: `{ maxRetries: 3, baseDelayMs: 30000, maxDelayMs: 300000, backoffMultiplier: 2 }` |
| concurrencyPolicy | enum | NOT NULL, DEFAULT 'skip_if_running' | `skip_if_running` \| `queue` \| `allow_concurrent` |
| reviewGateTimeoutHours | integer | NOT NULL, DEFAULT 48 | Hours before review gate escalates |
| maxPipelineDepth | integer | NOT NULL, DEFAULT 10 | Max trigger chain depth (runtime cycle guard) |
| status | enum | NOT NULL, DEFAULT 'active' | `active` \| `paused` \| `disabled` |
| templateId | text | NULL, FK → pipeline_templates.id | Source template (NULL if manually created) |
| createdAt | timestamp | NOT NULL, DEFAULT now() | |
| updatedAt | timestamp | NOT NULL, DEFAULT now() | |

**Indexes**: `tenantId`, `(tenantId, status)`, `(tenantId, triggerType)`, `(tenantId, name)` UNIQUE

**Drizzle schema**:

```typescript
export const pipelinesSchema = pgSchema('pipelines');

export const pipelineStatusEnum = pipelinesSchema.enum('pipeline_status', [
  'active', 'paused', 'disabled',
]);

export const triggerTypeEnum = pipelinesSchema.enum('trigger_type', [
  'corpus_change', 'schedule_tick', 'manual_request',
]);

export const concurrencyPolicyEnum = pipelinesSchema.enum('concurrency_policy', [
  'skip_if_running', 'queue', 'allow_concurrent',
]);

export const pipelines = pipelinesSchema.table('pipelines', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
  tenantId: text('tenant_id').notNull(),
  name: text('name').notNull(),
  description: text('description'),
  triggerType: triggerTypeEnum('trigger_type').notNull(),
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
  templateId: text('template_id').references(() => pipelineTemplates.id),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
}, (table) => ({
  tenantIdIdx: index('pipelines_tenant_id_idx').on(table.tenantId),
  tenantStatusIdx: index('pipelines_tenant_status_idx').on(table.tenantId, table.status),
  tenantTriggerIdx: index('pipelines_tenant_trigger_idx').on(table.tenantId, table.triggerType),
  tenantNameUnique: uniqueIndex('pipelines_tenant_name_unique').on(table.tenantId, table.name),
}));
```

### PipelineStep

An ordered step definition within a pipeline. Steps are stored as separate rows (not a JSONB array) to enable per-step retry policy overrides, individual step status tracking during execution, and clean relational queries.

| Field | Type | Constraints | Description |
|-------|------|-------------|-------------|
| id | text (CUID2) | PK | Unique identifier |
| pipelineId | text | NOT NULL, FK → pipelines.id, CASCADE | Parent pipeline |
| position | integer | NOT NULL | Execution order (0-based) |
| name | text | NOT NULL | Human-readable step name |
| stepType | enum | NOT NULL | `profile_generation` \| `fidelity_check` \| `content_generation` \| `source_query` \| `review_gate` \| `notification` |
| config | jsonb | NOT NULL | Step-type-specific configuration (e.g., profile IDs, query params) |
| inputRefs | jsonb | NOT NULL, DEFAULT '[]' | References to upstream step outputs or trigger payload fields |
| retryPolicyOverride | jsonb | NULL | Step-specific retry config (overrides pipeline default if set) |
| createdAt | timestamp | NOT NULL, DEFAULT now() | |
| updatedAt | timestamp | NOT NULL, DEFAULT now() | |

**Indexes**: `(pipelineId, position)` UNIQUE, `pipelineId`

**Drizzle schema**:

```typescript
export const stepTypeEnum = pipelinesSchema.enum('step_type', [
  'profile_generation', 'fidelity_check', 'content_generation',
  'source_query', 'review_gate', 'notification',
]);

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
```

### PipelineExecution

A single execution instance of a pipeline, created when a trigger event matches a pipeline definition.

| Field | Type | Constraints | Description |
|-------|------|-------------|-------------|
| id | text (CUID2) | PK | Unique identifier |
| pipelineId | text | NOT NULL, FK → pipelines.id, CASCADE | Pipeline being executed |
| tenantId | text | NOT NULL, INDEX | Tenant scoping key (denormalized for query performance) |
| triggerEventId | text | NOT NULL, FK → trigger_events.id | Event that triggered this execution |
| status | enum | NOT NULL, DEFAULT 'pending' | `pending` \| `running` \| `paused_at_gate` \| `paused_on_failure` \| `completed` \| `failed` \| `cancelled` |
| stepsCompleted | integer | NOT NULL, DEFAULT 0 | Count of successfully completed steps |
| stepsTotal | integer | NOT NULL | Total steps in the pipeline at execution start |
| currentStepPosition | integer | NOT NULL, DEFAULT 0 | Position of the step currently executing or paused at |
| triggerChainDepth | integer | NOT NULL, DEFAULT 0 | Depth in the trigger chain (runtime cycle guard) |
| outputArtifacts | jsonb | NOT NULL, DEFAULT '[]' | References to produced artifacts |
| errorDetail | jsonb | NULL | Structured error info if status = failed |
| startedAt | timestamp | NOT NULL, DEFAULT now() | |
| completedAt | timestamp | NULL | |

**Indexes**: `(pipelineId, startedAt)`, `(tenantId, startedAt)`, `(tenantId, status)`, `status`

**Drizzle schema**:

```typescript
export const executionStatusEnum = pipelinesSchema.enum('execution_status', [
  'pending', 'running', 'paused_at_gate', 'paused_on_failure',
  'completed', 'failed', 'cancelled',
]);

export const pipelineExecutions = pipelinesSchema.table('pipeline_executions', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
  pipelineId: text('pipeline_id').notNull().references(() => pipelines.id, { onDelete: 'cascade' }),
  tenantId: text('tenant_id').notNull(),
  triggerEventId: text('trigger_event_id').notNull().references(() => triggerEvents.id),
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
```

### ExecutionStep

Per-step execution state within a pipeline execution. One row per step per execution, tracking attempts, status, timing, and outputs.

| Field | Type | Constraints | Description |
|-------|------|-------------|-------------|
| id | text (CUID2) | PK | Unique identifier |
| executionId | text | NOT NULL, FK → pipeline_executions.id, CASCADE | Parent execution |
| stepId | text | NOT NULL, FK → pipeline_steps.id | Step definition reference |
| position | integer | NOT NULL | Step position (denormalized from pipeline_steps) |
| status | enum | NOT NULL, DEFAULT 'pending' | `pending` \| `running` \| `completed` \| `failed` \| `skipped` \| `no_op` |
| attempts | integer | NOT NULL, DEFAULT 0 | Number of execution attempts |
| idempotencyKey | text | NOT NULL | SHA-256 of `executionId:stepId:attempt` |
| inputData | jsonb | NULL | Resolved input data for this step execution |
| outputData | jsonb | NULL | Step output (artifacts produced, results) |
| errorDetail | jsonb | NULL | Structured error info: `{ message, type, isTransient, retryable }` |
| startedAt | timestamp | NULL | When step execution began |
| completedAt | timestamp | NULL | When step execution ended |

**Indexes**: `(executionId, position)` UNIQUE, `executionId`, `(executionId, status)`

**Drizzle schema**:

```typescript
export const executionStepStatusEnum = pipelinesSchema.enum('execution_step_status', [
  'pending', 'running', 'completed', 'failed', 'skipped', 'no_op',
]);

export const executionSteps = pipelinesSchema.table('execution_steps', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
  executionId: text('execution_id').notNull().references(() => pipelineExecutions.id, { onDelete: 'cascade' }),
  stepId: text('step_id').notNull().references(() => pipelineSteps.id),
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
```

### TriggerEvent

Event queue table. Source of truth for event delivery guarantee. Events are persisted here before NOTIFY is sent. The executor polls this table as the primary consumption mechanism.

| Field | Type | Constraints | Description |
|-------|------|-------------|-------------|
| id | text (CUID2) | PK | Unique identifier |
| tenantId | text | NOT NULL, INDEX | Tenant scoping key |
| eventType | enum | NOT NULL | `corpus_change` \| `schedule_tick` \| `manual_request` |
| payload | jsonb | NOT NULL | Event-specific data (e.g., changed document IDs, schedule ref) |
| status | enum | NOT NULL, DEFAULT 'pending' | `pending` \| `acknowledged` \| `processed` \| `failed` \| `expired` |
| pipelinesTriggered | jsonb | NOT NULL, DEFAULT '[]' | Pipeline IDs that executed in response |
| receivedAt | timestamp | NOT NULL, DEFAULT now() | When the event was received |
| acknowledgedAt | timestamp | NULL | When the executor acknowledged the event |
| processedAt | timestamp | NULL | When all triggered pipelines finished processing |

**Indexes**: `(tenantId, receivedAt)`, `(status, receivedAt)`, `tenantId`

**Drizzle schema**:

```typescript
export const triggerEventTypeEnum = pipelinesSchema.enum('trigger_event_type', [
  'corpus_change', 'schedule_tick', 'manual_request',
]);

export const triggerEventStatusEnum = pipelinesSchema.enum('trigger_event_status', [
  'pending', 'acknowledged', 'processed', 'failed', 'expired',
]);

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
}));
```

### ReviewDecision

Records reviewer approval or rejection for artifacts held at a review gate. One row per artifact per review gate.

| Field | Type | Constraints | Description |
|-------|------|-------------|-------------|
| id | text (CUID2) | PK | Unique identifier |
| executionId | text | NOT NULL, FK → pipeline_executions.id, CASCADE | Pipeline execution |
| executionStepId | text | NOT NULL, FK → execution_steps.id | The review_gate step |
| tenantId | text | NOT NULL, INDEX | Tenant scoping key (denormalized) |
| artifactRef | jsonb | NOT NULL | Reference to the artifact under review (type + ID + metadata) |
| profileVersionRef | text | NULL | Profile version used to generate the artifact (for feedback linkage) |
| reviewerId | text | NULL | Reviewer identity (NULL while pending) |
| status | enum | NOT NULL, DEFAULT 'pending' | `pending` \| `approved` \| `rejected` |
| feedback | jsonb | NULL | Structured rejection reason: `{ reason, category, details, suggestedAction }` |
| decidedAt | timestamp | NULL | When the decision was made |
| escalatedAt | timestamp | NULL | When escalation was triggered (if timeout exceeded) |
| createdAt | timestamp | NOT NULL, DEFAULT now() | |

**Indexes**: `(executionId, executionStepId)`, `(tenantId, status)`, `(executionStepId, status)`, `tenantId`

**Drizzle schema**:

```typescript
export const reviewDecisionStatusEnum = pipelinesSchema.enum('review_decision_status', [
  'pending', 'approved', 'rejected',
]);

export const reviewDecisions = pipelinesSchema.table('review_decisions', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
  executionId: text('execution_id').notNull().references(() => pipelineExecutions.id, { onDelete: 'cascade' }),
  executionStepId: text('execution_step_id').notNull().references(() => executionSteps.id),
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
```

### PipelineTemplate

Reusable pipeline templates stored as JSON definitions with parameterized placeholders. Templates are platform-level (not tenant-scoped) but can be instantiated into tenant-owned pipelines.

| Field | Type | Constraints | Description |
|-------|------|-------------|-------------|
| id | text (CUID2) | PK | Unique identifier |
| name | text | NOT NULL, UNIQUE | Template name (e.g., "corpus-update-to-profiles") |
| description | text | NOT NULL | What this template does |
| category | text | NOT NULL | Template category (e.g., "content", "compliance", "brand") |
| definition | jsonb | NOT NULL | Full pipeline definition with parameterized placeholders |
| parameters | jsonb | NOT NULL | Parameter schema: `[{ name, type, required, default, description }]` |
| assumptions | jsonb | NOT NULL, DEFAULT '[]' | Named assumptions this template relies on (§2.9) |
| version | integer | NOT NULL, DEFAULT 1 | Template version (incremented on update) |
| isActive | boolean | NOT NULL, DEFAULT true | Whether template is available for instantiation |
| createdAt | timestamp | NOT NULL, DEFAULT now() | |
| updatedAt | timestamp | NOT NULL, DEFAULT now() | |

**Indexes**: `name` UNIQUE, `(category, isActive)`, `isActive`

**Drizzle schema**:

```typescript
export const pipelineTemplates = pipelinesSchema.table('pipeline_templates', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
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
  categoryActiveIdx: index('pipeline_templates_category_active_idx').on(table.category, table.isActive),
  activeIdx: index('pipeline_templates_active_idx').on(table.isActive),
}));
```

### PipelineMetrics

Aggregated execution metrics per pipeline. Materialized from execution history, refreshed on execution completion events. Used for analytics queries and quality signal detection.

| Field | Type | Constraints | Description |
|-------|------|-------------|-------------|
| id | text (CUID2) | PK | Unique identifier |
| pipelineId | text | NOT NULL, FK → pipelines.id, CASCADE | Pipeline these metrics describe |
| tenantId | text | NOT NULL, INDEX | Tenant scoping key (denormalized) |
| windowStart | timestamp | NOT NULL | Metrics aggregation window start |
| windowEnd | timestamp | NOT NULL | Metrics aggregation window end |
| totalExecutions | integer | NOT NULL, DEFAULT 0 | Total executions in window |
| successCount | integer | NOT NULL, DEFAULT 0 | Executions that completed successfully |
| failureCount | integer | NOT NULL, DEFAULT 0 | Executions that failed |
| cancelledCount | integer | NOT NULL, DEFAULT 0 | Executions that were cancelled |
| meanDurationMs | integer | NULL | Mean execution duration (completed only) |
| p95DurationMs | integer | NULL | 95th percentile execution duration |
| failureBreakdown | jsonb | NOT NULL, DEFAULT '{}' | Failure counts by step and error type |
| reviewApprovalRate | real | NULL | Approval rate across review gates (0.0-1.0) |
| reviewRejectionRate | real | NULL | Rejection rate across review gates (0.0-1.0) |
| meanTimeToReviewMs | integer | NULL | Mean time from gate pause to decision |
| refreshedAt | timestamp | NOT NULL, DEFAULT now() | When these metrics were last computed |

**Indexes**: `(pipelineId, windowEnd)`, `(tenantId, windowEnd)`, `tenantId`

**Drizzle schema**:

```typescript
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
```

## Relationships

```
Pipeline          1 ←→ N PipelineStep         (pipeline has ordered steps)
Pipeline          1 ←→ N PipelineExecution     (pipeline has many executions)
Pipeline          N ←→ 1 PipelineTemplate      (pipeline may derive from template)
PipelineExecution 1 ←→ N ExecutionStep         (execution has per-step state)
PipelineExecution 1 ←→ N ReviewDecision        (execution may have review decisions)
PipelineExecution N ←→ 1 TriggerEvent          (execution is triggered by an event)
ExecutionStep     N ←→ 1 PipelineStep          (execution step references a definition)
ReviewDecision    N ←→ 1 ExecutionStep          (decisions reference the review gate step)
Pipeline          1 ←→ N PipelineMetrics        (pipeline has aggregated metrics windows)
```

**Drizzle relations**:

```typescript
export const pipelinesRelations = relations(pipelines, ({ one, many }) => ({
  steps: many(pipelineSteps),
  executions: many(pipelineExecutions),
  metrics: many(pipelineMetrics),
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
```

## State Transitions

### Pipeline.status
```
active → paused        (tenant pauses pipeline)
active → disabled      (tenant disables pipeline)
paused → active        (tenant resumes pipeline)
paused → disabled      (tenant disables while paused)
disabled → active      (tenant re-enables pipeline)
disabled → paused      (tenant re-enables in paused state)
```

### PipelineExecution.status
```
pending → running              (executor picks up execution)
running → paused_at_gate       (execution reaches review gate)
running → paused_on_failure    (step exhausts retries)
running → completed            (all steps complete)
running → failed               (non-recoverable error)
paused_at_gate → running       (all review decisions submitted)
paused_on_failure → running    (tenant manually resumes)
paused_at_gate → cancelled     (tenant cancels execution)
paused_on_failure → cancelled  (tenant cancels execution)
pending → cancelled            (tenant cancels before execution starts)
```

### ExecutionStep.status
```
pending → running      (executor starts step)
running → completed    (step succeeds)
running → failed       (step fails after retries)
running → no_op        (step determines no action needed)
pending → skipped      (upstream failure, step not reached)
```

### TriggerEvent.status
```
pending → acknowledged   (executor picks up event)
acknowledged → processed (all triggered pipelines completed)
acknowledged → failed    (processing error)
pending → expired        (event older than TTL, not picked up)
```

### ReviewDecision.status
```
pending → approved     (reviewer approves)
pending → rejected     (reviewer rejects with feedback)
```

## Data Governance Notes

- `Pipeline.tenantId` is the mandatory scoping key for all queries. The application layer MUST include `tenantId` in every WHERE clause — this is the Leash pattern (ADR-0002).
- `PipelineExecution.tenantId` is denormalized from the pipeline for query performance. The executor MUST verify that `execution.tenantId === pipeline.tenantId` as a defensive check.
- `ReviewDecision.feedback` stores structured rejection reasons — never raw user text that could leak across tenants. Feedback is scoped to the artifact and profile version within the tenant's context.
- `TriggerEvent.payload` may contain content item IDs or corpus references. These are tenant-scoped references, not raw content. No content body data is stored in trigger events.
- `PipelineTemplate.definition` contains parameterized placeholders, not tenant-specific data. Template definitions use generic examples per §2.10.
- `PipelineMetrics` is aggregated data — no individual execution details, no user identifiers, no content payloads. Safe for cross-tenant analytics at the platform level if needed in the future.
- `ExecutionStep.outputData` may reference artifacts by ID. The artifacts themselves live in the content infrastructure (Spec 006) and are subject to that schema's data governance rules.
- All tables are append-friendly for audit purposes. `PipelineExecution` and `ExecutionStep` rows are never deleted during normal operation — only on tenant deletion (soft-delete for 30 days per platform policy).
