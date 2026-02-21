/**
 * Drizzle Database Client
 * Singleton instance for database operations
 */

import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';

import * as schema from './schema.js';
import * as contentSchema from '../content/schema.js';

// Create PostgreSQL connection pool
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  max: 10,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 2000,
});

// Create Drizzle client with both public and content schemas
export const db = drizzle(pool, { schema: { ...schema, ...contentSchema } });

// Export schemas for convenience
export * from './schema.js';
export * from '../content/schema.js';

// Helper to close pool on shutdown
export async function closeDb() {
  await pool.end();
}
