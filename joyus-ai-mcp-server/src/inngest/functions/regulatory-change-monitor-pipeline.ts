/**
 * Regulatory Change Monitor Pipeline — Feature 011 migration.
 *
 * Inngest durable function that runs on a schedule tick to monitor regulatory
 * sources for changes. Executes four steps in sequence:
 *   1. source-query        — query regulatory source for recent updates
 *   2. content-generation  — produce a change summary
 *   3. review-gate         — pause and wait for human approval (48h timeout)
 *   4. notification        — notify stakeholders on approval
 *
 * The review gate uses step.waitForEvent() to durably pause execution.
 * If the gate returns null (timeout) or 'rejected', execution terminates
 * early without running the notification step.
 */
import { createId } from '@paralleldrive/cuid2';
import { inngest } from '../client.js';
import { createInngestAdapter } from '../adapter.js';
import type { StepHandlerRegistry, ExecutionContext } from '../../pipelines/engine/step-runner.js';
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
 * Create the regulatory-change-monitor Inngest function with the provided
 * step registry.
 *
 * Triggered by the `pipeline/schedule.tick` event fired by the
 * schedule-tick-pipeline cron function.
 *
 * @param registry - Registry that maps StepType -> PipelineStepHandler
 */
export function createRegulatoryChangeMonitorPipeline(registry: StepHandlerRegistry) {
  return inngest.createFunction(
    {
      id: 'regulatory-change-monitor-pipeline',
      name: 'Regulatory Change Monitor Pipeline',
      concurrency: {
        key: 'event.data.tenantId',
        limit: 1,
      },
    },
    { event: 'pipeline/schedule.tick' },
    async ({ event, step }) => {
      const { tenantId, scheduledAt } = event.data;

      const executionId = createId();
      const pipelineId = 'regulatory-change-monitor';

      const baseContext: Omit<ExecutionContext, 'previousStepOutputs'> = {
        tenantId,
        executionId,
        pipelineId,
        triggerPayload: { scheduledAt },
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
          { type: 'source_query', query: 'recent regulatory changes', sourceIds: [], maxResults: 20 },
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

      const previousStep1Outputs = new Map<number, Record<string, unknown>>([
        [0, step1Result.outputData ?? {}],
      ]);

      const contentGenHandler = registry.getHandler('content_generation');

      let step2Result: StepResult;
      if (contentGenHandler) {
        const adapter = createInngestAdapter(contentGenHandler);
        step2Result = await adapter.run(
          step,
          'content-generation',
          { type: 'content_generation', prompt: 'Summarise the most significant regulatory changes...' },
          { ...baseContext, previousStepOutputs: previousStep1Outputs },
        );
      } else {
        step2Result = await step.run('content-generation', async () =>
          stubResult('content_generation'),
        );
      }

      // ------------------------------------------------------------------
      // Step 3: Review Gate (48h timeout)
      // ------------------------------------------------------------------

      const reviewResult = await step.waitForEvent('wait-for-review', {
        event: 'pipeline/review.decided',
        timeout: '48h',
        if: `async.data.executionId == '${executionId}'`,
      });

      if (!reviewResult) {
        return {
          status: 'timed_out' as const,
          executionId,
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
            notification: null,
          },
        };
      }

      if (reviewResult.data.decision === 'rejected') {
        return {
          status: 'rejected' as const,
          executionId,
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
            notification: null,
          },
        };
      }

      // ------------------------------------------------------------------
      // Step 4: Notification (runs only on approval)
      // ------------------------------------------------------------------

      const previousStepOutputs = new Map<number, Record<string, unknown>>([
        [0, step1Result.outputData ?? {}],
        [1, step2Result.outputData ?? {}],
      ]);

      const notificationHandler = registry.getHandler('notification');

      let step4Result: StepResult;
      if (notificationHandler) {
        const adapter = createInngestAdapter(notificationHandler);
        step4Result = await adapter.run(
          step,
          'notification',
          { type: 'notification', channel: 'email', message: 'Regulatory change summary is ready...' },
          { ...baseContext, previousStepOutputs },
        );
      } else {
        step4Result = await step.run('notification', async () =>
          stubResult('notification'),
        );
      }

      // ------------------------------------------------------------------
      // Summary
      // ------------------------------------------------------------------

      return {
        status: 'completed' as const,
        executionId,
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
          notification: {
            success: step4Result.success,
            isNoOp: step4Result.isNoOp ?? false,
            outputData: step4Result.outputData,
            error: step4Result.error,
          },
        },
      };
    },
  );
}
