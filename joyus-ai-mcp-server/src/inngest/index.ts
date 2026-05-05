/**
 * Inngest module barrel.
 *
 * Exports client and all registered functions.
 * Import `createAllFunctions` to pass to the serve() adapter in index.ts.
 *
 * `allFunctions` registers all pipeline functions with an empty step registry
 * (stub mode) for tests and lightweight imports. Server startup should call
 * `createAllFunctions()` with the populated StepHandlerRegistry and database.
 */
export { inngest } from './client.js';
export { createContentAuditPipeline } from './functions/content-audit-pipeline.js';
export { createCorpusUpdatePipeline } from './functions/corpus-update-pipeline.js';
export { createManualTriggerPipeline } from './functions/manual-trigger-pipeline.js';
export { createRegulatoryChangeMonitorPipeline } from './functions/regulatory-change-monitor-pipeline.js';
export { createScheduleTickPipeline } from './functions/schedule-tick-pipeline.js';
export { stubFunction } from './functions/stub.js';
export { createInngestAdapter } from './adapter.js';
export type { InngestStep, InngestStepHandlerAdapter } from './adapter.js';

import type { NodePgDatabase } from 'drizzle-orm/node-postgres';

import type { StepHandlerRegistry } from '../pipelines/types.js';

import { createContentAuditPipeline } from './functions/content-audit-pipeline.js';
import { createCorpusUpdatePipeline } from './functions/corpus-update-pipeline.js';
import { createManualTriggerPipeline } from './functions/manual-trigger-pipeline.js';
import { createRegulatoryChangeMonitorPipeline } from './functions/regulatory-change-monitor-pipeline.js';
import { createScheduleTickPipeline } from './functions/schedule-tick-pipeline.js';
import { stubFunction } from './functions/stub.js';

export interface InngestFunctionDeps {
  db?: NodePgDatabase;
}

// Empty registry — functions run in stub mode until a real registry is provided.
// WP03 (deletion cleanup) will restructure how the registry is wired.
const emptyRegistry: StepHandlerRegistry = {
  getHandler: () => undefined,
};

export function createAllFunctions(
  registry: StepHandlerRegistry,
  deps: InngestFunctionDeps = {},
) {
  return [
    stubFunction,
    createCorpusUpdatePipeline(registry),
    createContentAuditPipeline(registry),
    createRegulatoryChangeMonitorPipeline(registry),
    createScheduleTickPipeline(),
    createManualTriggerPipeline(registry, deps),
  ];
}

export const allFunctions = createAllFunctions(emptyRegistry);
