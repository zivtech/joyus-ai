/**
 * Manual Trigger Pipeline — Feature 011 migration.
 *
 * Inngest durable function that handles ad-hoc pipeline execution
 * triggered by the `pipeline/manual.triggered` event. This event is
 * emitted by the POST /pipelines/:id/trigger REST route.
 *
 * Without this handler the event was a dead letter — sent to Inngest
 * but never consumed. This function closes that gap.
 *
 * Executes two steps in sequence:
 *   1. source-query      — fetch relevant content based on the trigger payload
 *   2. content-generation — produce output from the queried sources
 *
 * Per-tenant concurrency:
 *   At most 1 concurrent manual execution per tenant, preventing
 *   overlapping runs when operators trigger the same pipeline rapidly.
 *
 * Design notes:
 * - Factory pattern matches corpus-update and content-audit pipelines.
 * - Stub results are returned for unregistered step types so the function
 *   completes successfully in evaluation / spike environments.
 * - The `payload` from the trigger route is forwarded as `triggerPayload`
 *   so downstream steps can act on operator-supplied parameters.
 */
import { createId } from '@paralleldrive/cuid2';
import { and, eq } from 'drizzle-orm';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';

import {
  executionSteps,
  pipelineExecutions,
  pipelines,
  pipelineSteps,
  triggerEvents,
} from '../../pipelines/schema.js';
import type { Pipeline, PipelineStep } from '../../pipelines/schema.js';
import type {
  ExecutionContext,
  StepHandlerRegistry,
  StepResult,
  StepType,
} from '../../pipelines/types.js';
import { createInngestAdapter } from '../adapter.js';
import { inngest } from '../client.js';

export interface ManualTriggerPipelineDeps {
  db?: NodePgDatabase;
}

interface ManualExecutionStepRecord {
  id: string;
  executionId: string;
  stepId: string;
  position: number;
  status: 'pending';
  attempts: number;
  idempotencyKey: string;
}

interface ManualExecutionRecords {
  executionId: string;
  triggerEventId: string;
  execStepRecords: ManualExecutionStepRecord[];
}

const MANUAL_TRIGGER_OVERRIDE_FIELDS: Partial<Record<StepType, readonly string[]>> = {
  content_generation: ['prompt', 'profileId', 'sourceIds'],
  fidelity_check: ['profileId', 'contentIds', 'useUpstreamOutputs'],
  notification: ['message'],
  profile_generation: ['profileIds', 'forceRegenerate'],
  source_query: ['query', 'sourceIds', 'maxResults'],
};

function applyManualPayloadOverrides(
  stepType: StepType,
  storedConfig: Record<string, unknown>,
  payload: Record<string, unknown>,
): Record<string, unknown> {
  const overrides: Record<string, unknown> = {};
  const allowedFields = MANUAL_TRIGGER_OVERRIDE_FIELDS[stepType] ?? [];

  for (const field of allowedFields) {
    if (Object.prototype.hasOwnProperty.call(payload, field)) {
      overrides[field] = payload[field];
    }
  }

  return {
    ...storedConfig,
    ...overrides,
    type: stepType,
  };
}

// ---------------------------------------------------------------------------
// Stub result — returned when a handler is not available in the registry
// ---------------------------------------------------------------------------

function stubResult(stepType: string): StepResult {
  return {
    success: true,
    isNoOp: true,
    outputData: {
      stub: true,
      reason: `No handler registered for step type '${stepType}'`,
    },
  };
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

/**
 * Create the manual-trigger Inngest function with the provided step registry.
 *
 * Call this once during server initialisation, passing the populated registry:
 *   const fn = createManualTriggerPipeline(registry, { db });
 *   // then include fn in the array passed to serve()
 *
 * @param registry - Registry that maps StepType -> PipelineStepHandler
 */
export function createManualTriggerPipeline(
  registry: StepHandlerRegistry,
  deps: ManualTriggerPipelineDeps = {},
) {
  return inngest.createFunction(
    {
      id: 'manual-trigger-pipeline',
      name: 'Manual Trigger Pipeline',
      concurrency: {
        key: 'event.data.tenantId',
        limit: 1,
      },
    },
    { event: 'pipeline/manual.triggered' },
    async ({ event, step }) => {
      const { tenantId, pipelineId, payload } = event.data;

      if (!deps.db) {
        return {
          status: 'completed' as const,
          executionId: createId(),
          tenantId,
          pipelineId,
          steps: [],
          isNoOp: true,
          reason: 'No database configured for manual trigger pipeline',
        };
      }

      const db = deps.db;

      const definition = await step.run(
        'load-pipeline-definition',
        async () => {
          const [pipelineRow] = await db
            .select()
            .from(pipelines)
            .where(
              and(eq(pipelines.id, pipelineId), eq(pipelines.tenantId, tenantId)),
            )
            .limit(1);

          if (!pipelineRow) {
            return { pipeline: undefined, steps: [] as PipelineStep[] };
          }

          const stepRows = await db
            .select()
            .from(pipelineSteps)
            .where(eq(pipelineSteps.pipelineId, pipelineId))
            .orderBy(pipelineSteps.position);

          return { pipeline: pipelineRow, steps: stepRows };
        },
      ) as unknown as { pipeline: Pipeline | undefined; steps: PipelineStep[] };
      const { pipeline, steps: pipelineStepRows } = definition;

      if (!pipeline) {
        return {
          status: 'failed' as const,
          executionId: createId(),
          tenantId,
          pipelineId,
          error: { message: `Pipeline not found: ${pipelineId}` },
        };
      }

      if (pipeline.status !== 'active') {
        return {
          status: 'failed' as const,
          executionId: createId(),
          tenantId,
          pipelineId,
          error: { message: `Pipeline is ${pipeline.status}, must be active to trigger` },
        };
      }

      const records = await step.run('create-execution-records', async () => {
        const executionId = createId();
        const triggerEventId = createId();
        const execStepRecords = pipelineStepRows.map((pipelineStep) => ({
          id: createId(),
          executionId,
          stepId: pipelineStep.id,
          position: pipelineStep.position,
          status: 'pending' as const,
          attempts: 0,
          idempotencyKey: `${executionId}:${pipelineStep.id}:0`,
        }));

        await db.insert(triggerEvents).values({
          id: triggerEventId,
          tenantId,
          eventType: 'manual_request',
          payload,
          status: 'acknowledged',
          acknowledgedAt: new Date(),
        });

        await db.insert(pipelineExecutions).values({
          id: executionId,
          pipelineId: pipeline.id,
          tenantId,
          triggerEventId,
          status: 'running',
          stepsCompleted: 0,
          stepsTotal: pipelineStepRows.length,
          currentStepPosition: 0,
          triggerChainDepth: 0,
          outputArtifacts: [],
        });

        if (execStepRecords.length > 0) {
          await db.insert(executionSteps).values(execStepRecords);
        }

        return { executionId, triggerEventId, execStepRecords };
      }) as unknown as ManualExecutionRecords;

      const { executionId, triggerEventId, execStepRecords } = records;
      const baseContext: Omit<ExecutionContext, 'previousStepOutputs'> = {
        tenantId,
        executionId,
        pipelineId,
        triggerPayload: payload,
      };

      const previousStepOutputs = new Map<number, Record<string, unknown>>();
      const stepResults: Array<{
        position: number;
        stepType: string;
        success: boolean;
        isNoOp: boolean;
        outputData?: Record<string, unknown>;
        error?: StepResult['error'];
      }> = [];

      for (const [index, pipelineStep] of pipelineStepRows.entries()) {
        const execStep = execStepRecords[index];

        if (pipelineStep.stepType === 'review_gate') {
          await step.run(`pause-at-review-gate-${pipelineStep.position}`, async () => {
            await db
              .update(pipelineExecutions)
              .set({
                status: 'paused_at_gate',
                currentStepPosition: pipelineStep.position,
              })
              .where(eq(pipelineExecutions.id, executionId));
          });

          return {
            status: 'paused_at_gate' as const,
            executionId,
            tenantId,
            pipelineId,
            steps: stepResults,
          };
        }

        const handler = registry.getHandler(pipelineStep.stepType);
        const result = handler
          ? await createInngestAdapter(handler).run(
              step,
              pipelineStep.name,
              applyManualPayloadOverrides(
                pipelineStep.stepType,
                pipelineStep.config as Record<string, unknown>,
                payload,
              ),
              { ...baseContext, previousStepOutputs },
            )
          : await step.run(pipelineStep.name, async () =>
              stubResult(pipelineStep.stepType),
            );

        stepResults.push({
          position: pipelineStep.position,
          stepType: pipelineStep.stepType,
          success: result.success,
          isNoOp: result.isNoOp ?? false,
          outputData: result.outputData,
          error: result.error,
        });

        if (result.success || result.isNoOp) {
          if (result.outputData) {
            previousStepOutputs.set(pipelineStep.position, result.outputData);
          }

          await step.run(`record-step-${pipelineStep.position}-completed`, async () => {
            await db
              .update(executionSteps)
              .set({
                status: result.isNoOp ? 'no_op' : 'completed',
                attempts: 1,
                outputData: result.outputData ?? null,
                completedAt: new Date(),
              })
              .where(eq(executionSteps.id, execStep.id));

            await db
              .update(pipelineExecutions)
              .set({
                stepsCompleted: stepResults.length,
                currentStepPosition: pipelineStep.position,
              })
              .where(eq(pipelineExecutions.id, executionId));
          });
        } else {
          await step.run(`record-step-${pipelineStep.position}-failed`, async () => {
            await db
              .update(executionSteps)
              .set({
                status: 'failed',
                attempts: 1,
                errorDetail: result.error ?? { message: 'Step failed' },
                completedAt: new Date(),
              })
              .where(eq(executionSteps.id, execStep.id));

            await db
              .update(pipelineExecutions)
              .set({
                status: 'paused_on_failure',
                currentStepPosition: pipelineStep.position,
                errorDetail: result.error ?? { message: 'Step failed' },
              })
              .where(eq(pipelineExecutions.id, executionId));
          });

          return {
            status: 'paused_on_failure' as const,
            executionId,
            tenantId,
            pipelineId,
            steps: stepResults,
          };
        }
      }

      await step.run('complete-execution', async () => {
        await db
          .update(triggerEvents)
          .set({
            status: 'processed',
            processedAt: new Date(),
            pipelinesTriggered: [pipeline.id],
          })
          .where(eq(triggerEvents.id, triggerEventId));

        await db
          .update(pipelineExecutions)
          .set({
            status: 'completed',
            completedAt: new Date(),
            stepsCompleted: stepResults.length,
          })
          .where(eq(pipelineExecutions.id, executionId));
      });

      return {
        status: 'completed' as const,
        executionId,
        tenantId,
        pipelineId,
        steps: stepResults,
      };
    },
  );
}
