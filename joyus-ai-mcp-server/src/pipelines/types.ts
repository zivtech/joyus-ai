export type PipelineMode = 'dry-run' | 'apply';

export type PipelineRunStatus = 'completed' | 'failed' | 'canceled';

export type PipelineStageStatus =
  | 'pending'
  | 'running'
  | 'completed'
  | 'failed'
  | 'skipped'
  | 'canceled';

export interface PipelineStageResult {
  output?: unknown;
  evidence?: Record<string, unknown>;
  skip?: boolean;
}

export interface PipelineStageContext {
  runId: string;
  stageId: string;
  mode: PipelineMode;
  input: Record<string, unknown>;
  state: Record<string, unknown>;
  signal: AbortSignal;
  attempt: number;
}

export interface PipelineStageDefinition {
  id: string;
  privileged?: boolean;
  timeoutMs?: number;
  maxRetries?: number;
  handler: (ctx: PipelineStageContext) => Promise<PipelineStageResult>;
}

export interface PipelineDefinition {
  id: string;
  name: string;
  stages: PipelineStageDefinition[];
}

export interface StagePolicyInput {
  runId: string;
  mode: PipelineMode;
  stage: PipelineStageDefinition;
  input: Record<string, unknown>;
}

export interface StagePolicyDecision {
  allow: boolean;
  reason?: string;
  evidenceRef?: string;
}

export type StagePolicyGate = (
  input: StagePolicyInput,
) => Promise<StagePolicyDecision> | StagePolicyDecision;

export interface PipelineStageReport {
  id: string;
  status: PipelineStageStatus;
  attempts: number;
  startedAt?: string;
  endedAt?: string;
  durationMs?: number;
  error?: string;
  policyDecision?: StagePolicyDecision;
  evidence?: Record<string, unknown>;
}

export interface PipelineRunReport {
  runId: string;
  pipelineId: string;
  mode: PipelineMode;
  status: PipelineRunStatus;
  startedAt: string;
  endedAt: string;
  totalDurationMs: number;
  stages: PipelineStageReport[];
  state: Record<string, unknown>;
}

export interface PipelineRunOptions {
  mode?: PipelineMode;
  signal?: AbortSignal;
}
