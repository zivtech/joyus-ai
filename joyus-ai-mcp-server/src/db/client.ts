/**
 * Drizzle Database Client
 * Singleton instance for database operations
 */

import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';

import { allSchemas } from './schemas.js';

// Create PostgreSQL connection pool
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  max: 10,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 2000,
});

// Create Drizzle client with all registered domain schemas
export const db = drizzle(pool, { schema: allSchemas });

// Re-export all schema symbols so callers can import tables/types from this module
export * from './schemas.js';

// Helper to close pool on shutdown
export async function closeDb() {
  await pool.end();
}
