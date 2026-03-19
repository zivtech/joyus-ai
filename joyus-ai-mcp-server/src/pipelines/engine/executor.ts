/**
 * PipelineExecutor — core runtime that processes trigger events and
 * orchestrates pipeline execution.
 *
 * Subscribes to event-bus events, matches them to active pipelines via
 * trigger handlers, enforces concurrency and depth policies, then runs
 * pipeline steps sequentially through the StepRunner.
 */

import { createId } from '@paralleldrive/cuid2';
import { eq, and, inArray, gt } from 'drizzle-orm';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import type { RetryPolicy } from '../types.js';
import { DEFAULT_RETRY_POLICY } from '../types.js';
import {
  pipelines,
  pipelineSteps,
  pipelineExecutions,
  executionSteps,
  triggerEvents,
} from '../schema.js';
import type { Pipeline, PipelineStep } from '../schema.js';
import type { EventBus, EventEnvelope } from '../event-bus/interface.js';
import type { TriggerRegistry } from '../triggers/registry.js';
import type { TriggerContext, TriggerResult } from '../triggers/interface.js';
import type { StepRunner, ExecutionContext } from './step-runner.js';
import { computeIdempotencyKey } from './idempotency.js';

// ============================================================
// EXECUTOR
// ============================================================

export class PipelineExecutor {
  private readonly subscriptionIds: string[] = [];
  private readonly inFlightExecutions = new Set<Promise<void>>();

  constructor(
    private readonly db: NodePgDatabase,
    private readonly eventBus: EventBus,
    private readonly triggerRegistry: TriggerRegistry,
    private readonly stepRunner: StepRunner,
  ) {}

  // ----------------------------------------------------------
  // LIFECYCLE
  // ----------------------------------------------------------

  /**
   * Subscribe to all registered trigger event types.
   */
  start(): void {
    const handlers = this.triggerRegistry.getAll();
    for (const handler of handlers) {
      const subId = this.eventBus.subscribe(
        handler.triggerType,
        (event) => this.processEvent(event),
      );
      this.subscriptionIds.push(subId);
    }
  }

  /**
   * Unsubscribe all handlers, wait for in-flight executions, close bus.
   */
  async stop(): Promise<void> {
    for (const subId of this.subscriptionIds) {
      this.eventBus.unsubscribe(subId);
    }
    this.subscriptionIds.length = 0;

    // Wait for all in-flight pipeline executions to settle
    await Promise.allSettled(Array.from(this.inFlightExecutions));

    await this.eventBus.close();
  }

  // ----------------------------------------------------------
  // REVIEW GATE RESUME
  // ----------------------------------------------------------

  /**
   * Resume an execution that was paused at a review gate.
   * Called by DecisionRecorder after all decisions for a gate step are complete
   * and the execution status has been set back to 'running'.
   *
   * Loads the execution and remaining steps (position > gate step position),
   * then runs them sequentially exactly as executePipeline() does.
   */
  async resumeFromGate(executionId: string): Promise<void> {
    const [execution] = await this.db
      .select()
      .from(pipelineExecutions)
      .where(eq(pipelineExecutions.id, executionId))
      .limit(1);

    if (!execution || execution.status !== 'running') return;

    const pipeline = (
      await this.db
        .select()
        .from(pipelines)
        .where(eq(pipelines.id, execution.pipelineId))
        .limit(1)
    )[0];

    if (!pipeline) return;

    // Recover the original trigger payload for step execution context
    const triggerEventRows = await this.db
      .select()
      .from(triggerEvents)
      .where(eq(triggerEvents.id, execution.triggerEventId))
      .limit(1);
    const triggerPayload = (triggerEventRows[0]?.payload as Record<string, unknown>) ?? {};

    // Load all steps for the pipeline, then filter to those after the gate
    const allSteps = await this.db
      .select()
      .from(pipelineSteps)
      .where(
        and(
          eq(pipelineSteps.pipelineId, pipeline.id),
          gt(pipelineSteps.position, execution.currentStepPosition),
        ),
      );
    allSteps.sort((a, b) => a.position - b.position);

    if (allSteps.length === 0) {
      // No steps after the gate — mark completed
      await this.db
        .update(pipelineExecutions)
        .set({ status: 'completed', completedAt: new Date() })
        .where(eq(pipelineExecutions.id, executionId));
      return;
    }

    // Load existing execution step records for remaining positions
    const remainingPositions = allSteps.map((s) => s.position);
    const execStepRecords = await this.db
      .select()
      .from(executionSteps)
      .where(
        and(
          eq(executionSteps.executionId, executionId),
          inArray(executionSteps.position, remainingPositions),
        ),
      );

    // Map position → execStep id for lookup
    const execStepByPosition = new Map(execStepRecords.map((e) => [e.position, e]));

    const previousStepOutputs = new Map<number, Record<string, unknown>>();
    let stepsCompleted = execution.stepsCompleted;

    const executionPromise = (async () => {
      for (const step of allSteps) {
        if (step.stepType === 'review_gate') {
          await this.db
            .update(pipelineExecutions)
            .set({ status: 'paused_at_gate', currentStepPosition: step.position })
            .where(eq(pipelineExecutions.id, executionId));
          return;
        }

        const execStep = execStepByPosition.get(step.position);
        if (!execStep) continue;

        const context: import('./step-runner.js').ExecutionContext = {
          tenantId: pipeline.tenantId,
          executionId,
          pipelineId: pipeline.id,
          triggerPayload: triggerPayload,
          previousStepOutputs,
        };

        const retryPolicy = (pipeline.retryPolicy as RetryPolicy | null) ?? DEFAULT_RETRY_POLICY;
        const result = await this.stepRunner.runStep(execStep.id, step, context, retryPolicy);

        if (result.success || result.isNoOp) {
          stepsCompleted++;
          if (result.outputData) {
            previousStepOutputs.set(step.position, result.outputData);
          }
          await this.db
            .update(pipelineExecutions)
            .set({ stepsCompleted, currentStepPosition: step.position })
            .where(eq(pipelineExecutions.id, executionId));
        } else {
          await this.db
            .update(pipelineExecutions)
            .set({
              status: 'paused_on_failure',
              currentStepPosition: step.position,
              errorDetail: result.error ?? { message: 'Step failed' },
            })
            .where(eq(pipelineExecutions.id, executionId));
          return;
        }
      }

      await this.db
        .update(pipelineExecutions)
        .set({ status: 'completed', completedAt: new Date(), stepsCompleted })
        .where(eq(pipelineExecutions.id, executionId));
    })().catch((err) => {
      console.error(
        `[PipelineExecutor] Unhandled error resuming execution ${executionId}:`,
        err instanceof Error ? err.message : String(err),
      );
    });

    this.inFlightExecutions.add(executionPromise);
    executionPromise.finally(() => {
      this.inFlightExecutions.delete(executionPromise);
    });
  }

  // ----------------------------------------------------------
  // EVENT PROCESSING
  // ----------------------------------------------------------

  /**
   * Process a single event: match it to pipelines, enforce policies,
   * execute matched pipelines.
   */
  async processEvent(event: EventEnvelope): Promise<void> {
    const handler = this.triggerRegistry.getHandler(event.eventType);
    if (!handler) return;

    // Reuse the event ID from the bus — PgNotifyBus already inserted and
    // acknowledged the trigger_events row before dispatching this handler.
    const triggerEventId = event.id;

    // Fetch active pipelines for this tenant
    const activePipelines = await this.db
      .select()
      .from(pipelines)
      .where(
        and(
          eq(pipelines.tenantId, event.tenantId),
          eq(pipelines.status, 'active'),
        ),
      );

    if (activePipelines.length === 0) {
      await this.db
        .update(triggerEvents)
        .set({ status: 'processed', processedAt: new Date() })
        .where(eq(triggerEvents.id, triggerEventId));
      return;
    }

    // Fetch steps for all active pipelines
    const pipelineIds = activePipelines.map((p) => p.id);
    const allSteps = await this.db
      .select()
      .from(pipelineSteps)
      .where(inArray(pipelineSteps.pipelineId, pipelineIds));

    // Build step lookup: pipelineId → sorted steps
    const stepsByPipeline = new Map<string, PipelineStep[]>();
    for (const step of allSteps) {
      const existing = stepsByPipeline.get(step.pipelineId) ?? [];
      existing.push(step);
      stepsByPipeline.set(step.pipelineId, existing);
    }
    for (const steps of stepsByPipeline.values()) {
      steps.sort((a, b) => a.position - b.position);
    }

    // Build trigger context (bridge EventBus envelope → TriggerContext)
    const chainDepth = typeof event.payload['depth'] === 'number'
      ? (event.payload['depth'] as number)
      : 0;

    const triggerContext: TriggerContext = {
      event: {
        eventId: event.id,
        tenantId: event.tenantId,
        eventType: event.eventType,
        payload: event.payload,
        timestamp: event.createdAt,
      },
      tenantId: event.tenantId,
      currentDepth: chainDepth,
    };

    // Match pipelines
    const matches: TriggerResult[] = handler.getMatchingPipelines(
      triggerContext,
      activePipelines,
    );

    // Track which pipelines were triggered
    const triggeredPipelineIds: string[] = [];

    // Execute each matched pipeline
    for (const match of matches) {
      const pipeline = activePipelines.find((p) => p.id === match.pipelineId);
      if (!pipeline) continue;

      const steps = stepsByPipeline.get(pipeline.id) ?? [];
      if (steps.length === 0) continue;

      // Depth check
      if (chainDepth >= pipeline.maxPipelineDepth) {
        continue;
      }

      // Concurrency check
      const shouldSkip = await this.checkConcurrency(pipeline);
      if (shouldSkip) continue;

      triggeredPipelineIds.push(pipeline.id);

      // Fire and track the execution
      const executionPromise = this.executePipeline(
        pipeline,
        steps,
        triggerEventId,
        match.triggerPayload,
        chainDepth,
      ).catch((err) => {
        console.error(
          `[PipelineExecutor] Unhandled error executing pipeline ${pipeline.id}:`,
          err instanceof Error ? err.message : String(err),
        );
      });

      this.inFlightExecutions.add(executionPromise);
      executionPromise.finally(() => {
        this.inFlightExecutions.delete(executionPromise);
      });
    }

    // Update trigger event as processed
    await this.db
      .update(triggerEvents)
      .set({
        status: 'processed',
        processedAt: new Date(),
        pipelinesTriggered: triggeredPipelineIds,
      })
      .where(eq(triggerEvents.id, triggerEventId));
  }

  // ----------------------------------------------------------
  // PIPELINE EXECUTION
  // ----------------------------------------------------------

  /**
   * Execute a single pipeline: create execution record, create step records,
   * run steps sequentially.
   */
  private async executePipeline(
    pipeline: Pipeline,
    steps: PipelineStep[],
    triggerEventId: string,
    triggerPayload: Record<string, unknown>,
    chainDepth: number,
  ): Promise<void> {
    const executionId = createId();

    // Create pipeline_executions record
    await this.db.insert(pipelineExecutions).values({
      id: executionId,
      pipelineId: pipeline.id,
      tenantId: pipeline.tenantId,
      triggerEventId,
      status: 'running',
      stepsTotal: steps.length,
      stepsCompleted: 0,
      currentStepPosition: 0,
      triggerChainDepth: chainDepth,
      outputArtifacts: [],
    });

    // Create all execution_step records upfront
    const execStepRecords = steps.map((step) => ({
      id: createId(),
      executionId,
      stepId: step.id,
      position: step.position,
      status: 'pending' as const,
      attempts: 0,
      idempotencyKey: computeIdempotencyKey(executionId, step.id, 0),
    }));

    await this.db.insert(executionSteps).values(execStepRecords);

    // Run steps sequentially
    const previousStepOutputs = new Map<number, Record<string, unknown>>();
    let stepsCompleted = 0;

    for (let i = 0; i < steps.length; i++) {
      const step = steps[i];
      const execStep = execStepRecords[i];

      // Review gate placeholder (WP06)
      if (step.stepType === 'review_gate') {
        await this.db
          .update(pipelineExecutions)
          .set({
            status: 'paused_at_gate',
            currentStepPosition: step.position,
          })
          .where(eq(pipelineExecutions.id, executionId));

        await this.db
          .update(executionSteps)
          .set({ status: 'pending' })
          .where(eq(executionSteps.id, execStep.id));
        return;
      }

      // Build execution context
      const context: ExecutionContext = {
        tenantId: pipeline.tenantId,
        executionId,
        pipelineId: pipeline.id,
        triggerPayload,
        previousStepOutputs,
      };

      // Run the step
      const retryPolicy = (pipeline.retryPolicy as RetryPolicy | null) ?? DEFAULT_RETRY_POLICY;
      const result = await this.stepRunner.runStep(
        execStep.id,
        step,
        context,
        retryPolicy,
      );

      if (result.success || result.isNoOp) {
        stepsCompleted++;
        if (result.outputData) {
          previousStepOutputs.set(step.position, result.outputData);
        }
        await this.db
          .update(pipelineExecutions)
          .set({
            stepsCompleted,
            currentStepPosition: step.position,
          })
          .where(eq(pipelineExecutions.id, executionId));
      } else {
        // Step failed — pause execution
        await this.db
          .update(pipelineExecutions)
          .set({
            status: 'paused_on_failure',
            currentStepPosition: step.position,
            errorDetail: result.error ?? { message: 'Step failed' },
          })
          .where(eq(pipelineExecutions.id, executionId));
        return;
      }
    }

    // All steps completed
    await this.db
      .update(pipelineExecutions)
      .set({
        status: 'completed',
        completedAt: new Date(),
        stepsCompleted,
      })
      .where(eq(pipelineExecutions.id, executionId));
  }

  // ----------------------------------------------------------
  // CONCURRENCY
  // ----------------------------------------------------------

  /**
   * Check concurrency policy for a pipeline.
   * Returns true if the pipeline execution should be skipped.
   */
  private async checkConcurrency(pipeline: Pipeline): Promise<boolean> {
    if (pipeline.concurrencyPolicy === 'allow_concurrent') return false;

    const nonTerminalStatuses = ['pending', 'running', 'paused_at_gate'] as const;

    const existing = await this.db
      .select()
      .from(pipelineExecutions)
      .where(
        and(
          eq(pipelineExecutions.pipelineId, pipeline.id),
          inArray(pipelineExecutions.status, [...nonTerminalStatuses]),
        ),
      );

    if (existing.length > 0 && pipeline.concurrencyPolicy === 'skip_if_running') {
      return true;
    }

    // 'queue' policy: for now, also skip (queuing is a WP07+ concern)
    if (existing.length > 0 && pipeline.concurrencyPolicy === 'queue') {
      return true;
    }

    return false;
  }
}
