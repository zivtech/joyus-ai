/**
 * Corpus Update Pipeline — Feature 010 evaluation spike.
 *
 * Inngest durable function that runs when a corpus changes.
 * Executes two pipeline steps in sequence:
 *   1. profile-generation — rebuild author/voice profiles from updated corpus
 *   2. fidelity-check     — verify generated content meets quality thresholds
 *
 * Design notes:
 * - The function is created via a factory that accepts a StepHandlerRegistry,
 *   enabling dependency injection and keeping this module free of global state.
 * - If a handler is not registered (e.g., in a spike/evaluation environment),
 *   a stub result is returned so the function can still complete successfully.
 * - executionId is generated with cuid2 for URL-safe, collision-resistant IDs.
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
      reason: `No handler registered for step type '${stepType}' (evaluation spike)`,
    },
  };
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

/**
 * Create the corpus-update Inngest function with the provided step registry.
 *
 * Call this once during server initialisation, passing the populated registry:
 *   const fn = createCorpusUpdatePipeline(registry);
 *   // then pass fn to serve()
 *
 * @param registry - Registry that maps StepType -> PipelineStepHandler
 */
export function createCorpusUpdatePipeline(registry: StepHandlerRegistry) {
  return inngest.createFunction(
    {
      id: 'corpus-update-pipeline',
      name: 'Corpus Update Pipeline',
    },
    { event: 'pipeline/corpus.changed' },
    async ({ event, step }) => {
      const { tenantId, corpusId, changeType } = event.data;

      const executionId = createId();
      const pipelineId = 'corpus-update';

      const baseContext: Omit<ExecutionContext, 'previousStepOutputs'> = {
        tenantId,
        executionId,
        pipelineId,
        triggerPayload: { corpusId, changeType },
      };

      // ------------------------------------------------------------------
      // Step 1: Profile Generation
      // ------------------------------------------------------------------

      const profileGenHandler = registry.getHandler('profile_generation');

      let step1Result: StepResult;
      if (profileGenHandler) {
        const adapter = createInngestAdapter(profileGenHandler);
        step1Result = await adapter.run(
          step,
          'profile-generation',
          { type: 'profile_generation', profileIds: [], forceRegenerate: false },
          { ...baseContext, previousStepOutputs: new Map() },
        );
      } else {
        step1Result = await step.run('profile-generation', async () =>
          stubResult('profile_generation'),
        );
      }

      // ------------------------------------------------------------------
      // Step 2: Fidelity Check
      // ------------------------------------------------------------------

      const previousStepOutputs = new Map<number, Record<string, unknown>>([
        [0, step1Result.outputData ?? {}],
      ]);

      const fidelityHandler = registry.getHandler('fidelity_check');

      let step2Result: StepResult;
      if (fidelityHandler) {
        const adapter = createInngestAdapter(fidelityHandler);
        step2Result = await adapter.run(
          step,
          'fidelity-check',
          { type: 'fidelity_check', thresholds: { minScore: 0.8 } },
          { ...baseContext, previousStepOutputs },
        );
      } else {
        step2Result = await step.run('fidelity-check', async () =>
          stubResult('fidelity_check'),
        );
      }

      // ------------------------------------------------------------------
      // Summary
      // ------------------------------------------------------------------

      return {
        executionId,
        tenantId,
        corpusId,
        changeType,
        steps: {
          profileGeneration: {
            success: step1Result.success,
            isNoOp: step1Result.isNoOp ?? false,
            outputData: step1Result.outputData,
            error: step1Result.error,
          },
          fidelityCheck: {
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
