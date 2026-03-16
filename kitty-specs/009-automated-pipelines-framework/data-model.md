# Data Model: Automated Pipelines Framework

## Entities

### Pipeline
- id: string (cuid2)
- tenantId: string
- name: string
- description: string | null
- status: enum (active, paused, archived)
- concurrencyPolicy: enum (allow_concurrent, skip_if_running, queue)
- maxDepth: int (default: 5)
- createdAt: timestamp
- updatedAt: timestamp

### PipelineExecution
- id: string (cuid2)
- pipelineId: string
- tenantId: string
- status: enum (pending, running, paused, completed, failed, cancelled)
- triggeredBy: enum (corpus_change, manual_request, schedule)
- triggerEventId: string | null
- idempotencyKey: string
- depth: int (default: 0)
- startedAt: timestamp | null
- completedAt: timestamp | null
- errorMessage: string | null
- createdAt: timestamp

### PipelineStep
- id: string (cuid2)
- pipelineId: string
- tenantId: string
- stepType: enum (profile_generation, fidelity_check, content_generation, source_query, notification, review_gate)
- name: string
- config: jsonb
- retryPolicy: jsonb (maxAttempts, backoffMs, backoffMultiplier)
- dependsOn: string[] (step IDs)
- order: int
- createdAt: timestamp

### StepExecution
- id: string (cuid2)
- pipelineExecutionId: string
- stepId: string
- tenantId: string
- status: enum (pending, running, completed, failed, skipped, awaiting_review)
- attemptCount: int (default: 0)
- result: jsonb | null
- errorMessage: string | null
- startedAt: timestamp | null
- completedAt: timestamp | null

### TriggerEvent
- id: string (cuid2)
- pipelineId: string
- tenantId: string
- triggerType: enum (corpus_change, manual_request, schedule)
- payload: jsonb
- status: enum (pending, dispatched, processed, dead_lettered)
- processedAt: timestamp | null
- createdAt: timestamp

### ReviewDecision
- id: string (cuid2)
- stepExecutionId: string
- pipelineExecutionId: string
- tenantId: string
- reviewerId: string
- decision: enum (approved, rejected, escalated)
- feedback: string | null
- artifactDecisions: jsonb | null
- decidedAt: timestamp
- timeoutAt: timestamp

### PipelineTemplate
- id: string (cuid2)
- tenantId: string | null (null = built-in)
- name: string
- description: string
- category: string
- definition: jsonb (pipeline + steps config)
- isBuiltIn: boolean
- createdAt: timestamp
- updatedAt: timestamp

### PipelineMetrics
- id: string (cuid2)
- pipelineId: string
- tenantId: string
- totalExecutions: int
- successfulExecutions: int
- failedExecutions: int
- averageDurationMs: number
- p95DurationMs: number
- rejectionRate: number (0.0–1.0)
- lastComputedAt: timestamp
- windowStart: timestamp
- windowEnd: timestamp
