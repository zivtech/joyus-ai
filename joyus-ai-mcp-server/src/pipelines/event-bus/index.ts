/**
 * Automated Pipelines Framework — EventBus barrel export + factory
 */

export type { EventBus, EventEnvelope, EventHandler } from './interface.js';
export { InMemoryEventBus } from './interface.js';
export { PgNotifyBus } from './pg-notify-bus.js';

import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { InMemoryEventBus } from './interface.js';
import { PgNotifyBus } from './pg-notify-bus.js';
import type { EventBus } from './interface.js';

export interface CreateEventBusOptions {
  useInMemory?: boolean;
}

/**
 * Factory that returns InMemoryEventBus when `options.useInMemory` is true or
 * NODE_ENV === 'test', otherwise creates and starts a PgNotifyBus.
 */
export async function createEventBus(
  db: NodePgDatabase,
  connectionString: string,
  options?: CreateEventBusOptions,
): Promise<EventBus> {
  const useInMemory = options?.useInMemory === true || process.env['NODE_ENV'] === 'test';

  if (useInMemory) {
    return new InMemoryEventBus();
  }

  const bus = new PgNotifyBus(db, connectionString);
  await bus.start();
  return bus;
}
