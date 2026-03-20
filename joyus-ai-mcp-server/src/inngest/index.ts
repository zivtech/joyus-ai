/**
 * Inngest module barrel.
 *
 * Exports client and all registered functions.
 * Import `allFunctions` to pass to the serve() adapter in index.ts.
 *
 * Pipeline functions are created with `lazyRegistry`, a proxy that delegates
 * to the mutable singleton at call time. Once `setStepRegistry()` is called
 * during pipeline module init, all functions see the real registry.
 */
export { inngest } from './client.js';
export { stubFunction } from './functions/stub.js';
export { createCorpusUpdatePipeline } from './functions/corpus-update-pipeline.js';
export { createScheduleTickPipeline } from './functions/schedule-tick-pipeline.js';
export { createContentAuditPipeline } from './functions/content-audit-pipeline.js';
export { createRegulatoryChangeMonitorPipeline } from './functions/regulatory-change-monitor-pipeline.js';
export { createInngestAdapter } from './adapter.js';
export type { InngestStep, InngestStepHandlerAdapter } from './adapter.js';
export { setStepRegistry, getStepRegistry } from './registry.js';

import { stubFunction } from './functions/stub.js';
import { createCorpusUpdatePipeline } from './functions/corpus-update-pipeline.js';
import { createScheduleTickPipeline } from './functions/schedule-tick-pipeline.js';
import { createContentAuditPipeline } from './functions/content-audit-pipeline.js';
import { createRegulatoryChangeMonitorPipeline } from './functions/regulatory-change-monitor-pipeline.js';
import { lazyRegistry } from './registry.js';

export const allFunctions = [
  stubFunction,
  createCorpusUpdatePipeline(lazyRegistry),
  createContentAuditPipeline(lazyRegistry),
  createRegulatoryChangeMonitorPipeline(lazyRegistry),
  createScheduleTickPipeline(),
];
