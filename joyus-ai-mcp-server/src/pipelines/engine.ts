import { createId } from '@paralleldrive/cuid2';

import type {
  PipelineDefinition,
  PipelineRunOptions,
  PipelineRunReport,
  PipelineRunStatus,
  PipelineStageDefinition,
  PipelineStageReport,
  PipelineStageResult,
  StagePolicyGate,
} from './types.js';

const DEFAULT_STAGE_TIMEOUT_MS = 30_000;

function errorMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  return String(err);
}

function withTimeout<T>(promise: Promise<T>, timeoutMs: number, signal: AbortSignal): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`timeout after ${timeoutMs}ms`)), timeoutMs);

    const abortHandler = () => reject(new Error('aborted'));
    signal.addEventListener('abort', abortHandler, { once: true });

    promise
      .then((value) => resolve(value))
      .catch((err) => reject(err))
      .finally(() => {
        clearTimeout(timer);
        signal.removeEventListener('abort', abortHandler);
      });
  });
}

export class PipelineEngine {
  constructor(private readonly stagePolicyGate?: StagePolicyGate) {}

  async run(
    definition: PipelineDefinition,
    input: Record<string, unknown>,
    options?: PipelineRunOptions,
  ): Promise<PipelineRunReport> {
    const runId = createId();
    const mode = options?.mode ?? 'dry-run';
    const signal = options?.signal ?? new AbortController().signal;
    const startedAtDate = new Date();
    const startedAt = startedAtDate.toISOString();
    const state: Record<string, unknown> = {};
    const stages: PipelineStageReport[] = [];
    let status: PipelineRunStatus = 'completed';

    for (const stage of definition.stages) {
      if (signal.aborted) {
        status = 'canceled';
        stages.push({
          id: stage.id,
          status: 'canceled',
          attempts: 0,
        });
        break;
      }

      const report = await this.runStage(runId, mode, stage, input, state, signal);
      stages.push(report);

      if (report.status === 'failed') {
        status = 'failed';
        break;
      }
      if (report.status === 'canceled') {
        status = 'canceled';
        break;
      }
    }

    const endedAtDate = new Date();
    return {
      runId,
      pipelineId: definition.id,
      mode,
      status,
      startedAt,
      endedAt: endedAtDate.toISOString(),
      totalDurationMs: endedAtDate.getTime() - startedAtDate.getTime(),
      stages,
      state,
    };
  }

  private async runStage(
    runId: string,
    mode: 'dry-run' | 'apply',
    stage: PipelineStageDefinition,
    input: Record<string, unknown>,
    state: Record<string, unknown>,
    signal: AbortSignal,
  ): Promise<PipelineStageReport> {
    const maxAttempts = Math.max(1, (stage.maxRetries ?? 0) + 1);
    const timeoutMs = stage.timeoutMs ?? DEFAULT_STAGE_TIMEOUT_MS;
    const startedAt = new Date();

    let policyDecision;
    if (stage.privileged && this.stagePolicyGate) {
      policyDecision = await this.stagePolicyGate({
        runId,
        mode,
        stage,
        input,
      });
      if (!policyDecision.allow) {
        return {
          id: stage.id,
          status: 'failed',
          attempts: 0,
          startedAt: startedAt.toISOString(),
          endedAt: new Date().toISOString(),
          durationMs: Date.now() - startedAt.getTime(),
          error: policyDecision.reason ?? 'stage policy denied',
          policyDecision,
        };
      }
    }

    let attempts = 0;
    while (attempts < maxAttempts) {
      attempts += 1;
      const attemptStart = Date.now();
      try {
        const result = await withTimeout(
          stage.handler({
            runId,
            stageId: stage.id,
            mode,
            input,
            state,
            signal,
            attempt: attempts,
          }),
          timeoutMs,
          signal,
        );

        if (result.output !== undefined) {
          state[stage.id] = result.output;
        }

        return this.successReport(stage.id, attempts, startedAt, policyDecision, result);
      } catch (err) {
        const aborted = errorMessage(err) === 'aborted';
        if (aborted) {
          return {
            id: stage.id,
            status: 'canceled',
            attempts,
            startedAt: startedAt.toISOString(),
            endedAt: new Date().toISOString(),
            durationMs: Date.now() - startedAt.getTime(),
            error: 'canceled',
            policyDecision,
          };
        }

        const isLastAttempt = attempts >= maxAttempts;
        if (isLastAttempt) {
          return {
            id: stage.id,
            status: 'failed',
            attempts,
            startedAt: startedAt.toISOString(),
            endedAt: new Date().toISOString(),
            durationMs: Date.now() - startedAt.getTime(),
            error: errorMessage(err),
            policyDecision,
          };
        }

        const elapsed = Date.now() - attemptStart;
        if (elapsed < 10) {
          await new Promise((resolve) => setTimeout(resolve, 10));
        }
      }
    }

    return {
      id: stage.id,
      status: 'failed',
      attempts,
      startedAt: startedAt.toISOString(),
      endedAt: new Date().toISOString(),
      durationMs: Date.now() - startedAt.getTime(),
      error: 'stage failed unexpectedly',
      policyDecision,
    };
  }

  private successReport(
    stageId: string,
    attempts: number,
    startedAt: Date,
    policyDecision: PipelineStageReport['policyDecision'],
    result: PipelineStageResult,
  ): PipelineStageReport {
    const endedAt = new Date();
    if (result.skip) {
      return {
        id: stageId,
        status: 'skipped',
        attempts,
        startedAt: startedAt.toISOString(),
        endedAt: endedAt.toISOString(),
        durationMs: endedAt.getTime() - startedAt.getTime(),
        policyDecision,
        evidence: result.evidence,
      };
    }

    return {
      id: stageId,
      status: 'completed',
      attempts,
      startedAt: startedAt.toISOString(),
      endedAt: endedAt.toISOString(),
      durationMs: endedAt.getTime() - startedAt.getTime(),
      policyDecision,
      evidence: result.evidence,
    };
  }
}
