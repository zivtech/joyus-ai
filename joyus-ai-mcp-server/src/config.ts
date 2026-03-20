/**
 * Environment configuration validation
 *
 * Validates required env vars at import time using Zod.
 * Import this module early in the application entry point.
 */

import { z } from 'zod';

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  PORT: z.coerce.number().default(3000),
  DATABASE_URL: z.string().optional(),
  SESSION_SECRET: z.string().optional(),
  TOKEN_ENCRYPTION_KEY: z.string().optional(),
  INNGEST_EVENT_KEY: z.string().optional(),
  INNGEST_SIGNING_KEY: z.string().optional(),
});

// Validate at import time
const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
  console.error('[joyus] Invalid environment configuration:');
  for (const issue of parsed.error.issues) {
    console.error(`  ${issue.path.join('.')}: ${issue.message}`);
  }
  if (process.env.NODE_ENV === 'production') {
    throw new Error('FATAL: Invalid environment configuration');
  }
}

export const config = parsed.success ? parsed.data : envSchema.parse({});
