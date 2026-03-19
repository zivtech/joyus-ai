/**
 * Inngest module barrel — Feature 010 evaluation spike.
 *
 * Exports client and all registered functions.
 * Import `allFunctions` to pass to the serve() adapter in index.ts.
 *
 * Note: `allFunctions` contains only the stub for now.
 * To include the corpus-update pipeline with a real handler registry, use
 * `createCorpusUpdatePipeline(registry)` during server initialisation and
 * append the result to the functions list passed to serve().
 */
export { inngest } from './client.js';
export { stubFunction } from './functions/stub.js';
export { createCorpusUpdatePipeline } from './functions/corpus-update-pipeline.js';
export { createInngestAdapter } from './adapter.js';
export type { InngestStep, InngestStepHandlerAdapter } from './adapter.js';

import { stubFunction } from './functions/stub.js';

export const allFunctions = [stubFunction];
