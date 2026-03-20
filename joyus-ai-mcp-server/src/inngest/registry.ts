/**
 * Inngest Step Registry — mutable singleton with lazy proxy.
 *
 * Starts empty so pipeline functions can be created at module load time.
 * Populated with the real registry during `initializePipelineModule()`.
 *
 * `lazyRegistry` is a proxy that delegates to the current singleton at
 * call time, so Inngest functions created with it at module load always
 * see the real registry once it has been set.
 */

import type { StepHandlerRegistry } from '../pipelines/engine/step-runner.js';

// Mutable singleton — populated during pipeline module initialization
let _registry: StepHandlerRegistry = {
  getHandler: () => undefined,
};

/**
 * Replace the step registry singleton. Called once during pipeline module init.
 */
export function setStepRegistry(registry: StepHandlerRegistry): void {
  _registry = registry;
}

/**
 * Get the current step registry.
 */
export function getStepRegistry(): StepHandlerRegistry {
  return _registry;
}

/**
 * A proxy registry that always delegates to the current singleton.
 * Pass this to pipeline function factories at module load time so they
 * pick up the real registry at invocation time.
 */
export const lazyRegistry: StepHandlerRegistry = {
  getHandler: (...args) => _registry.getHandler(...args),
};
