/**
 * Schema Registry
 *
 * Aggregates all Drizzle ORM schemas from every domain module into a single
 * object for use by the database client. Domain modules register their schemas
 * here rather than having db/client.ts import directly from higher-level modules.
 *
 * To add a new domain schema: import it here and spread it into the default export.
 */

import * as coreSchema from './schema.js';
import * as contentSchema from '../content/schema.js';
import * as pipelinesSchema from '../pipelines/schema.js';

/**
 * Combined schema object passed to Drizzle at client creation time.
 * All tables and relations from every domain are included.
 */
export const allSchemas = {
  ...coreSchema,
  ...contentSchema,
  ...pipelinesSchema,
};

// Re-export each domain namespace for convenience
export * from './schema.js';
export * from '../content/schema.js';
export * from '../pipelines/schema.js';
