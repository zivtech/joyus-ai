/**
 * Drizzle Database Client Type
 *
 * Canonical definition of DrizzleClient used across all content and tool
 * modules. Import from here instead of redeclaring locally.
 */

import { drizzle } from 'drizzle-orm/node-postgres';

export type DrizzleClient = ReturnType<typeof drizzle>;
