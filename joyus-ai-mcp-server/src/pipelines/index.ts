/**
 * Automated Pipelines Framework — Module Entry Point
 *
 * Re-exports schema, types, validation, engine, steps, review, routes, and init.
 */

export * from './schema.js';
export * from './types.js';
export * from './validation.js';
export * from './engine/index.js';
export * from './steps/index.js';
export * from './review/index.js';
export * from './templates/index.js';
export { createPipelineRouter, type PipelineRouterDeps } from './routes.js';
export {
  initializePipelineModule,
  type PipelineModuleConfig,
  type PipelineModule,
} from './init.js';
export * from './analytics/index.js';
