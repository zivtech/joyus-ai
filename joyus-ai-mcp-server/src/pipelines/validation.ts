/**
 * Automated Pipelines Framework — Zod Validation Schemas
 *
 * Input validation for pipeline operations (MCP tool inputs, API request bodies).
 *
 * TENANT SCOPING: tenantId is NOT included in these input schemas because it
 * is always resolved from the authenticated session context, never from
 * user-supplied input. This prevents tenant spoofing.
 */

import { parseExpression } from 'cron-parser';
import { z } from 'zod';

// ============================================================
// HELPERS
// ============================================================

/** Validate a cron expression string using cron-parser. */
const cronExpression = z.string().refine(
  (val) => {
    try {
      parseExpression(val);
      return true;
    } catch {
      return false;
    }
  },
  { message: 'Invalid cron expression' },
);

// ============================================================
// RETRY POLICY
// ============================================================

export const RetryPolicySchema = z.object({
  maxRetries: z.number().int().min(0).max(10),
  baseDelayMs: z.number().int().min(1000).max(600000),
  maxDelayMs: z.number().int().min(1000).max(600000),
  backoffMultiplier: z.number().min(1).max(10),
});
export type RetryPolicyInput = z.infer<typeof RetryPolicySchema>;

// ============================================================
// TRIGGER CONFIGS
// ============================================================

export const CorpusChangeTriggerConfigSchema = z.object({
  type: z.literal('corpus_change'),
  corpusFilter: z.record(z.string(), z.unknown()).optional(),
});

export const ScheduleTriggerConfigSchema = z.object({
  type: z.literal('schedule_tick'),
  cronExpression,
  timezone: z.string().optional(),
});

export const ManualRequestTriggerConfigSchema = z.object({
  type: z.literal('manual_request'),
});

export const TriggerConfigSchema = z.discriminatedUnion('type', [
  CorpusChangeTriggerConfigSchema,
  ScheduleTriggerConfigSchema,
  ManualRequestTriggerConfigSchema,
]);
export type TriggerConfigInput = z.infer<typeof TriggerConfigSchema>;

// ============================================================
// STEP CONFIGS
// ============================================================

export const ProfileGenerationStepConfigSchema = z.object({
  type: z.literal('profile_generation'),
  profileIds: z.array(z.string()).min(1),
  forceRegenerate: z.boolean().optional(),
});

export const FidelityCheckStepConfigSchema = z.object({
  type: z.literal('fidelity_check'),
  thresholds: z.object({
    minScore: z.number().min(0).max(1),
    dimensions: z.array(z.string()).optional(),
  }),
});

export const ContentGenerationStepConfigSchema = z.object({
  type: z.literal('content_generation'),
  prompt: z.string().min(1).max(10000),
  profileId: z.string(),
  sourceIds: z.array(z.string()).optional(),
});

export const SourceQueryStepConfigSchema = z.object({
  type: z.literal('source_query'),
  query: z.string().min(1).max(1000),
  sourceIds: z.array(z.string()).optional(),
  maxResults: z.number().int().min(1).max(100).optional(),
});

export const ReviewGateStepConfigSchema = z.object({
  type: z.literal('review_gate'),
  artifactSelection: z.enum(['all_preceding', 'specific']),
  artifactStepPositions: z.array(z.number().int().min(0)).optional(),
});

export const NotificationStepConfigSchema = z.object({
  type: z.literal('notification'),
  channel: z.enum(['email', 'slack', 'webhook']),
  message: z.string().min(1).max(2000),
  recipients: z.array(z.string()).optional(),
});

export const StepConfigSchema = z.discriminatedUnion('type', [
  ProfileGenerationStepConfigSchema,
  FidelityCheckStepConfigSchema,
  ContentGenerationStepConfigSchema,
  SourceQueryStepConfigSchema,
  ReviewGateStepConfigSchema,
  NotificationStepConfigSchema,
]);
export type StepConfigInput = z.infer<typeof StepConfigSchema>;

// ============================================================
// STEP DEFINITION (used in CreatePipelineInput)
// ============================================================

export const StepDefinitionSchema = z.object({
  name: z.string().min(1).max(200),
  stepType: z.enum([
    'profile_generation', 'fidelity_check', 'content_generation',
    'source_query', 'review_gate', 'notification',
  ]),
  config: StepConfigSchema,
  inputRefs: z.array(z.record(z.string(), z.unknown())).default([]),
  retryPolicyOverride: RetryPolicySchema.optional(),
});
export type StepDefinitionInput = z.infer<typeof StepDefinitionSchema>;

// ============================================================
// PIPELINE CRUD
// ============================================================

export const CreatePipelineInput = z.object({
  name: z.string().min(1).max(200),
  description: z.string().max(2000).optional(),
  triggerType: z.enum(['corpus_change', 'schedule_tick', 'manual_request']),
  triggerConfig: TriggerConfigSchema,
  steps: z.array(StepDefinitionSchema).min(1),
  retryPolicy: RetryPolicySchema.optional(),
  concurrencyPolicy: z.enum(['skip_if_running', 'queue', 'allow_concurrent']).default('skip_if_running'),
  reviewGateTimeoutHours: z.number().int().min(1).max(720).default(48),
  maxPipelineDepth: z.number().int().min(1).max(50).default(10),
});
export type CreatePipelineInput = z.infer<typeof CreatePipelineInput>;

export const UpdatePipelineInput = z.object({
  name: z.string().min(1).max(200).optional(),
  description: z.string().max(2000).optional(),
  triggerType: z.enum(['corpus_change', 'schedule_tick', 'manual_request']).optional(),
  triggerConfig: TriggerConfigSchema.optional(),
  steps: z.array(StepDefinitionSchema).min(1).optional(),
  retryPolicy: RetryPolicySchema.optional(),
  concurrencyPolicy: z.enum(['skip_if_running', 'queue', 'allow_concurrent']).optional(),
  reviewGateTimeoutHours: z.number().int().min(1).max(720).optional(),
  maxPipelineDepth: z.number().int().min(1).max(50).optional(),
  status: z.enum(['active', 'paused', 'disabled']).optional(),
});
export type UpdatePipelineInput = z.infer<typeof UpdatePipelineInput>;

// ============================================================
// TRIGGER & REVIEW INPUTS
// ============================================================

export const CreateManualTriggerInput = z.object({
  pipelineId: z.string().min(1),
  payload: z.record(z.string(), z.unknown()).optional(),
});
export type CreateManualTriggerInput = z.infer<typeof CreateManualTriggerInput>;

export const ReviewDecisionInput = z.object({
  decisionId: z.string().min(1),
  status: z.enum(['approved', 'rejected']),
  feedback: z.object({
    reason: z.string().min(1),
    category: z.string().min(1),
    details: z.string().optional(),
    suggestedAction: z.string().optional(),
  }).optional(),
});
export type ReviewDecisionInput = z.infer<typeof ReviewDecisionInput>;

// ============================================================
// QUERY INPUTS
// ============================================================

export const PipelineQueryInput = z.object({
  status: z.enum(['active', 'paused', 'disabled']).optional(),
  limit: z.number().int().min(1).max(100).default(20),
  offset: z.number().int().min(0).default(0),
});
export type PipelineQueryInput = z.infer<typeof PipelineQueryInput>;

export const ExecutionQueryInput = z.object({
  pipelineId: z.string().optional(),
  status: z.enum([
    'pending', 'running', 'paused_at_gate', 'paused_on_failure',
    'completed', 'failed', 'cancelled',
  ]).optional(),
  limit: z.number().int().min(1).max(100).default(20),
  offset: z.number().int().min(0).default(0),
});
export type ExecutionQueryInput = z.infer<typeof ExecutionQueryInput>;
