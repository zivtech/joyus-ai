/**
 * StepRegistry — maps StepType values to their handler implementations.
 *
 * review_gate is intentionally NOT registered here; it is handled
 * directly by the pipeline executor.
 */

import type { StepType } from '../types.js';
import type { StepHandlerRegistry } from '../types.js';
import type { PipelineStepHandler, StepHandlerDependencies } from './interface.js';
import { ProfileGenerationHandler } from './profile-generation.js';
import { FidelityCheckHandler } from './fidelity-check.js';
import { ContentGenerationHandler } from './content-generation.js';
import { SourceQueryHandler } from './source-query.js';
import { NotificationHandler } from './notification.js';

export class StepRegistry implements StepHandlerRegistry {
  private readonly handlers = new Map<StepType, PipelineStepHandler>();

  register(handler: PipelineStepHandler): void {
    this.handlers.set(handler.stepType, handler);
  }

  getHandler(stepType: StepType): PipelineStepHandler | undefined {
    return this.handlers.get(stepType);
  }

  getRegisteredTypes(): StepType[] {
    return Array.from(this.handlers.keys());
  }

  validateStepConfig(stepType: StepType, config: Record<string, unknown>): string[] {
    const handler = this.handlers.get(stepType);
    if (!handler) {
      return [`No handler registered for step type: ${stepType}`];
    }
    return handler.validateConfig(config);
  }
}

/**
 * Factory that creates a fully-populated StepRegistry with all built-in handlers.
 * review_gate is excluded — handled by the executor directly.
 */
export function createStepRegistry(deps: StepHandlerDependencies): StepRegistry {
  const registry = new StepRegistry();
  registry.register(new ProfileGenerationHandler(deps));
  registry.register(new FidelityCheckHandler(deps));
  registry.register(new ContentGenerationHandler(deps));
  registry.register(new SourceQueryHandler(deps));
  registry.register(new NotificationHandler(deps));
  return registry;
}
