/**
 * Schema Registry
 *
 * Aggregates all Drizzle ORM schemas from every domain module into a single
 * object for use by the database client. Domain modules register their schemas
 * here rather than having db/client.ts import directly from higher-level modules.
 *
 * To add a new domain schema: import it here and spread it into the default export.
 */

import * as contentSchema from '../content/schema.js';
import * as eventAdapterSchema from '../event-adapter/schema.js';
import * as exportsSchema from '../exports/schema.js';
import * as pipelinesSchema from '../pipelines/schema.js';
import * as profilesSchema from '../profiles/schema.js';

import * as approvalsSchema from './schema/approvals.js';
import * as coordinationSchema from './schema/coordination.js';
import * as eventsSchema from './schema/events.js';
import * as orchestratorSchema from './schema/orchestrator.js';
import * as coreSchema from './schema.js';

/**
 * Combined schema object passed to Drizzle at client creation time.
 * All tables and relations from every domain are included.
 */
export const allSchemas = {
  ...coreSchema,
  ...contentSchema,
  ...pipelinesSchema,
  ...eventAdapterSchema,
  ...exportsSchema,
  ...profilesSchema,
  ...orchestratorSchema,
  ...eventsSchema,
  ...coordinationSchema,
  ...approvalsSchema,
};

// Re-export each domain namespace for convenience
export * from './schema.js';
export * from '../content/schema.js';
export * from '../pipelines/schema.js';
export * from '../event-adapter/schema.js';
export * from '../exports/schema.js';
export * from '../profiles/schema.js';
export * from './schema/orchestrator.js';
export * from './schema/events.js';
export * from './schema/coordination.js';
export * from './schema/approvals.js';
