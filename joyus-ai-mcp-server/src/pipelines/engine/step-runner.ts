/**
 * StepRunner — executes a single pipeline step with retry logic.
 *
 * Looks up the appropriate handler from a StepHandlerRegistry,
 * manages retry attempts with exponential backoff, checks idempotency,
 * and updates the execution_step DB record throughout.
 */

import { eq } from 'drizzle-orm';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import type { StepType, RetryPolicy, StepResult, StepError } from '../types.js';
import { DEFAULT_RETRY_POLICY } from '../types.js';
import type { PipelineStep } from '../schema.js';
import { executionSteps } from '../schema.js';
import { computeIdempotencyKey, checkIdempotency } from './idempotency.js';
import { shouldRetry, waitForRetry } from './retry.js';

// ============================================================
// INTERFACES
// ============================================================

/** Context passed to step handlers during execution. */
export interface ExecutionContext {
  tenantId: string;
  executionId: string;
  pipelineId: string;
  triggerPayload: Record<string, unknown>;
  previousStepOutputs: Map<number, Record<string, unknown>>;
}

/** Interface for step handlers (implemented in WP05). */
export interface PipelineStepHandler {
  readonly stepType: StepType;
  execute(
    config: Record<string, unknown>,
    context: ExecutionContext,
  ): Promise<StepResult>;
}

/** Lookup step handlers by type (implemented in WP05). */
export interface StepHandlerRegistry {
  getHandler(stepType: StepType): PipelineStepHandler | undefined;
}

// ============================================================
// STEP RUNNER
// ============================================================

export class StepRunner {
  constructor(
    private readonly db: NodePgDatabase,
    private readonly registry: StepHandlerRegistry,
  ) {}

  /**
   * Run a single pipeline step, managing retries and DB state.
   *
   * @param executionStepId  - ID of the execution_steps row
   * @param pipelineStep     - The pipeline_steps definition (type, config, retry override)
   * @param context          - Execution context with tenant, pipeline, trigger data
   * @param retryPolicy      - Pipeline-level retry policy (step override takes precedence)
   */
  async runStep(
    executionStepId: string,
    pipelineStep: PipelineStep,
    context: ExecutionContext,
    retryPolicy?: RetryPolicy,
  ): Promise<StepResult> {
    const effectivePolicy: RetryPolicy =
      (pipelineStep.retryPolicyOverride as RetryPolicy | null) ?? retryPolicy ?? DEFAULT_RETRY_POLICY;

    // Mark step as running
    await this.db
      .update(executionSteps)
      .set({ status: 'running', startedAt: new Date() })
      .where(eq(executionSteps.id, executionStepId));

    // Look up handler
    const handler = this.registry.getHandler(pipelineStep.stepType);
    if (!handler) {
      const errorResult: StepResult = {
        success: false,
        error: {
          message: `No handler registered for step type: ${pipelineStep.stepType}`,
          type: 'HANDLER_NOT_FOUND',
          isTransient: false,
          retryable: false,
        },
      };
      await this.db
        .update(executionSteps)
        .set({
          status: 'failed',
          completedAt: new Date(),
          errorDetail: errorResult.error,
        })
        .where(eq(executionSteps.id, executionStepId));
      return errorResult;
    }

    // Retry loop
    let attempt = 0;
    let lastError: StepError | undefined;

    while (attempt <= effectivePolicy.maxRetries) {
      // Idempotency check
      const idempotencyKey = computeIdempotencyKey(
        context.executionId,
        pipelineStep.id,
        attempt,
      );
      const cached = await checkIdempotency(this.db, idempotencyKey);
      if (cached) {
        const noOpResult: StepResult = { success: true, outputData: cached, isNoOp: true };
        await this.db
          .update(executionSteps)
          .set({
            status: 'no_op',
            completedAt: new Date(),
            outputData: cached,
            idempotencyKey,
            attempts: attempt + 1,
          })
          .where(eq(executionSteps.id, executionStepId));
        return noOpResult;
      }

      // Update attempt counter and idempotency key
      await this.db
        .update(executionSteps)
        .set({ attempts: attempt + 1, idempotencyKey })
        .where(eq(executionSteps.id, executionStepId));

      try {
        const result = await handler.execute(
          pipelineStep.config as Record<string, unknown>,
          context,
        );

        if (result.success) {
          const finalStatus = result.isNoOp ? 'no_op' as const : 'completed' as const;
          await this.db
            .update(executionSteps)
            .set({
              status: finalStatus,
              completedAt: new Date(),
              outputData: result.outputData ?? null,
            })
            .where(eq(executionSteps.id, executionStepId));
          return result;
        }

        // Handler returned failure
        lastError = result.error ?? {
          message: 'Step handler returned failure without error details',
          type: 'UNKNOWN',
          isTransient: false,
          retryable: false,
        };
      } catch (err) {
        // Handler threw an exception — treat as transient
        lastError = {
          message: err instanceof Error ? err.message : String(err),
          type: 'EXCEPTION',
          isTransient: true,
          retryable: true,
        };
      }

      // Decide whether to retry (attempt is 0-indexed; shouldRetry compares against maxRetries)
      const retryDecision = shouldRetry(lastError, attempt, effectivePolicy);
      if (!retryDecision.retry) break;

      await waitForRetry(retryDecision.delayMs!);
      attempt++;
    }

    // All retries exhausted or non-transient error
    const failResult: StepResult = { success: false, error: lastError };
    await this.db
      .update(executionSteps)
      .set({
        status: 'failed',
        completedAt: new Date(),
        errorDetail: lastError,
      })
      .where(eq(executionSteps.id, executionStepId));
    return failResult;
  }
}
