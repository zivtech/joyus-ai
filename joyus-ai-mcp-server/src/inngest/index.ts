/**
 * Inngest module barrel.
 *
 * Exports client and all registered functions.
 * Import `allFunctions` to pass to the serve() adapter in index.ts.
 *
 * `allFunctions` registers all pipeline functions with an empty step registry
 * (stub mode). When a real StepHandlerRegistry is available (see pipelines/init.ts),
 * construct the pipeline functions with it and replace allFunctions at serve() time.
 */
export { inngest } from './client.js';
export { stubFunction } from './functions/stub.js';
export { createCorpusUpdatePipeline } from './functions/corpus-update-pipeline.js';
export { createScheduleTickPipeline } from './functions/schedule-tick-pipeline.js';
export { createContentAuditPipeline } from './functions/content-audit-pipeline.js';
export { createRegulatoryChangeMonitorPipeline } from './functions/regulatory-change-monitor-pipeline.js';
export { createInngestAdapter } from './adapter.js';
export type { InngestStep, InngestStepHandlerAdapter } from './adapter.js';

import { stubFunction } from './functions/stub.js';
import { createCorpusUpdatePipeline } from './functions/corpus-update-pipeline.js';
import { createScheduleTickPipeline } from './functions/schedule-tick-pipeline.js';
import { createContentAuditPipeline } from './functions/content-audit-pipeline.js';
import { createRegulatoryChangeMonitorPipeline } from './functions/regulatory-change-monitor-pipeline.js';
import type { StepHandlerRegistry } from '../pipelines/types.js';

// Empty registry — functions run in stub mode until a real registry is provided.
// WP03 (deletion cleanup) will restructure how the registry is wired.
const emptyRegistry: StepHandlerRegistry = {
  getHandler: () => undefined,
};

export const allFunctions = [
  stubFunction,
  createCorpusUpdatePipeline(emptyRegistry),
  createContentAuditPipeline(emptyRegistry),
  createRegulatoryChangeMonitorPipeline(emptyRegistry),
  createScheduleTickPipeline(),
];
