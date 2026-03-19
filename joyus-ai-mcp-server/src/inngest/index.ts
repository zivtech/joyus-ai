/**
 * Inngest module barrel — Feature 010 evaluation spike.
 *
 * Exports client and all registered functions.
 * Import `allFunctions` to pass to the serve() adapter in index.ts.
 */
export { inngest } from './client.js';
export { stubFunction } from './functions/stub.js';

import { stubFunction } from './functions/stub.js';

export const allFunctions = [stubFunction];
