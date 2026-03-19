/**
 * Automated Pipelines Framework — Shared TypeScript Types & Constants
 *
 * String literal unions mirroring DB enums, interfaces for JSONB columns,
 * and framework-wide constants.
 */

// ============================================================
// ENUM MIRRORS (string literal unions)
// ============================================================

export type PipelineStatus = 'active' | 'paused' | 'disabled';

export type ExecutionStatus =
  | 'pending' | 'running' | 'paused_at_gate' | 'paused_on_failure'
  | 'completed' | 'failed' | 'cancelled';

export type ExecutionStepStatus =
  | 'pending' | 'running' | 'completed' | 'failed' | 'skipped' | 'no_op';

export type TriggerEventType = 'corpus_change' | 'schedule_tick' | 'manual_request';

export type TriggerEventStatus = 'pending' | 'acknowledged' | 'processed' | 'failed' | 'expired';

export type StepType =
  | 'profile_generation' | 'fidelity_check' | 'content_generation'
  | 'source_query' | 'review_gate' | 'notification';

export type ConcurrencyPolicy = 'skip_if_running' | 'queue' | 'allow_concurrent';

export type ReviewDecisionStatus = 'pending' | 'approved' | 'rejected';

export type QualitySignalSeverity = 'info' | 'warning' | 'critical';

// ============================================================
// INTERFACES — JSONB column shapes
// ============================================================

export interface RetryPolicy {
  maxRetries: number;
  baseDelayMs: number;
  maxDelayMs: number;
  backoffMultiplier: number;
}

// --- Trigger configs (discriminated on `type`) ---

export interface CorpusChangeTriggerConfig {
  type: 'corpus_change';
  corpusFilter?: Record<string, unknown>;
}

export interface ScheduleTriggerConfig {
  type: 'schedule_tick';
  cronExpression: string;
  timezone?: string;
}

export interface ManualRequestTriggerConfig {
  type: 'manual_request';
}

export type TriggerConfig =
  | CorpusChangeTriggerConfig
  | ScheduleTriggerConfig
  | ManualRequestTriggerConfig;

// --- Step configs (discriminated on `type`) ---

export interface ProfileGenerationStepConfig {
  type: 'profile_generation';
  profileIds: string[];
  forceRegenerate?: boolean;
}

export interface FidelityCheckStepConfig {
  type: 'fidelity_check';
  thresholds: { minScore: number; dimensions?: string[] };
}

export interface ContentGenerationStepConfig {
  type: 'content_generation';
  prompt: string;
  profileId: string;
  sourceIds?: string[];
}

export interface SourceQueryStepConfig {
  type: 'source_query';
  query: string;
  sourceIds?: string[];
  maxResults?: number;
}

export interface ReviewGateStepConfig {
  type: 'review_gate';
  artifactSelection: 'all_preceding' | 'specific';
  artifactStepPositions?: number[];
}

export interface NotificationStepConfig {
  type: 'notification';
  channel: 'email' | 'slack' | 'webhook';
  message: string;
  recipients?: string[];
}

export type StepConfig =
  | ProfileGenerationStepConfig
  | FidelityCheckStepConfig
  | ContentGenerationStepConfig
  | SourceQueryStepConfig
  | ReviewGateStepConfig
  | NotificationStepConfig;

// --- Core execution types (relocated from engine/step-runner.ts in WP03) ---

/** Context passed to step handlers during execution. */
export interface ExecutionContext {
  tenantId: string;
  executionId: string;
  pipelineId: string;
  triggerPayload: Record<string, unknown>;
  previousStepOutputs: Map<number, Record<string, unknown>>;
}

/** Interface for step handlers. */
export interface PipelineStepHandler {
  readonly stepType: StepType;
  execute(
    config: Record<string, unknown>,
    context: ExecutionContext,
  ): Promise<StepResult>;
}

/** Lookup step handlers by type. */
export interface StepHandlerRegistry {
  getHandler(stepType: StepType): PipelineStepHandler | undefined;
}

// --- Event bus ---

export interface EventEnvelope {
  eventId: string;
  tenantId: string;
  eventType: TriggerEventType;
  payload: Record<string, unknown>;
  timestamp: Date;
}

// --- Step execution results ---

export interface StepResult {
  success: boolean;
  outputData?: Record<string, unknown>;
  error?: StepError;
  isNoOp?: boolean;
}

export interface StepError {
  message: string;
  type: string;
  isTransient: boolean;
  retryable: boolean;
}

// --- Artifacts & review ---

export interface ArtifactRef {
  type: string;
  id: string;
  metadata?: Record<string, unknown>;
}

export interface ReviewFeedback {
  reason: string;
  category: string;
  details?: string;
  suggestedAction?: string;
}

// ============================================================
// CONSTANTS
// ============================================================

export const DEFAULT_RETRY_POLICY: RetryPolicy = {
  maxRetries: 3,
  baseDelayMs: 30000,
  maxDelayMs: 300000,
  backoffMultiplier: 2,
};

export const DEFAULT_POLL_INTERVAL_MS = 30000;

export const DEFAULT_REVIEW_GATE_TIMEOUT_HOURS = 48;

export const DEFAULT_MAX_PIPELINE_DEPTH = 10;

export const MAX_PIPELINES_PER_TENANT = 20;

export const ESCALATION_CHECK_INTERVAL_CRON = '0 * * * *';
