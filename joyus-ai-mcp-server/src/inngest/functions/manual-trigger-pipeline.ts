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
import { inngest } from '../client.js';
import { createInngestAdapter } from '../adapter.js';
import type { StepHandlerRegistry, ExecutionContext } from '../../pipelines/types.js';
import type { StepResult } from '../../pipelines/types.js';

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
 *   const fn = createManualTriggerPipeline(registry);
 *   // then include fn in the array passed to serve()
 *
 * @param registry - Registry that maps StepType -> PipelineStepHandler
 */
export function createManualTriggerPipeline(registry: StepHandlerRegistry) {
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

      const executionId = createId();

      const baseContext: Omit<ExecutionContext, 'previousStepOutputs'> = {
        tenantId,
        executionId,
        pipelineId,
        triggerPayload: payload,
      };

      // ------------------------------------------------------------------
      // Step 1: Source Query
      // ------------------------------------------------------------------

      const sourceQueryHandler = registry.getHandler('source_query');

      let step1Result: StepResult;
      if (sourceQueryHandler) {
        const adapter = createInngestAdapter(sourceQueryHandler);
        step1Result = await adapter.run(
          step,
          'source-query',
          { type: 'source_query', ...payload },
          { ...baseContext, previousStepOutputs: new Map() },
        );
      } else {
        step1Result = await step.run('source-query', async () =>
          stubResult('source_query'),
        );
      }

      // ------------------------------------------------------------------
      // Step 2: Content Generation
      // ------------------------------------------------------------------

      const previousStepOutputs = new Map<number, Record<string, unknown>>([
        [0, step1Result.outputData ?? {}],
      ]);

      const contentGenHandler = registry.getHandler('content_generation');

      let step2Result: StepResult;
      if (contentGenHandler) {
        const adapter = createInngestAdapter(contentGenHandler);
        step2Result = await adapter.run(
          step,
          'content-generation',
          { type: 'content_generation', ...payload },
          { ...baseContext, previousStepOutputs },
        );
      } else {
        step2Result = await step.run('content-generation', async () =>
          stubResult('content_generation'),
        );
      }

      // ------------------------------------------------------------------
      // Summary
      // ------------------------------------------------------------------

      return {
        status: 'completed' as const,
        executionId,
        tenantId,
        pipelineId,
        steps: {
          sourceQuery: {
            success: step1Result.success,
            isNoOp: step1Result.isNoOp ?? false,
            outputData: step1Result.outputData,
            error: step1Result.error,
          },
          contentGeneration: {
            success: step2Result.success,
            isNoOp: step2Result.isNoOp ?? false,
            outputData: step2Result.outputData,
            error: step2Result.error,
          },
        },
      };
    },
  );
}
