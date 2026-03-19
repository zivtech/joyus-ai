/**
 * InngestStepHandlerAdapter — Feature 010 evaluation spike.
 *
 * Wraps a PipelineStepHandler so it can be invoked inside an Inngest
 * `step.run()` call. This gives Inngest durable-execution semantics
 * (checkpointing, retries) around existing handler logic.
 */
import type { PipelineStepHandler, ExecutionContext } from '../pipelines/engine/step-runner.js';
import type { StepResult } from '../pipelines/types.js';

// ---------------------------------------------------------------------------
// Minimal Inngest step API surface we depend on
// ---------------------------------------------------------------------------

/**
 * The subset of the Inngest `step` object that the adapter requires.
 * Keeping this narrow makes it easy to mock in tests.
 *
 * We use `Promise<unknown>` rather than the generic `Promise<T>` because
 * Inngest's real `step.run()` returns `Promise<Jsonify<Awaited<T>>>`, which
 * is not assignable to `Promise<T>`. Since the adapter always returns a
 * `StepResult`, we cast at the call site instead.
 */
export interface InngestStep {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  run(name: string, fn: () => Promise<any>): Promise<unknown>;
}

// ---------------------------------------------------------------------------
// Adapter interface & factory
// ---------------------------------------------------------------------------

export interface InngestStepHandlerAdapter {
  /**
   * Execute the wrapped handler inside an Inngest step checkpoint.
   *
   * @param step     - Inngest step object (from the function handler arg)
   * @param stepName - Human-readable step name shown in the Inngest UI
   * @param config   - Step configuration passed through to handler.execute()
   * @param context  - Execution context passed through to handler.execute()
   */
  run(
    step: InngestStep,
    stepName: string,
    config: Record<string, unknown>,
    context: ExecutionContext,
  ): Promise<StepResult>;
}

/**
 * Wrap a PipelineStepHandler so its execute() call is checkpointed by Inngest.
 *
 * Usage:
 *   const adapter = createInngestAdapter(myHandler);
 *   const result  = await adapter.run(step, 'profile-generation', config, ctx);
 */
export function createInngestAdapter(handler: PipelineStepHandler): InngestStepHandlerAdapter {
  return {
    async run(
      step: InngestStep,
      stepName: string,
      config: Record<string, unknown>,
      context: ExecutionContext,
    ): Promise<StepResult> {
      return step.run(stepName, () => handler.execute(config, context)) as Promise<StepResult>;
    },
  };
}
