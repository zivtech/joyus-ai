/**
 * Environment configuration validation
 *
 * Validates required env vars at import time using Zod.
 * Import this module early in the application entry point.
 */

import 'dotenv/config';

import { z } from 'zod';

const optionalNonEmpty = (schema: z.ZodString) =>
  z.preprocess((value) => (value === '' ? undefined : value), schema.optional());

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  PORT: z.coerce.number().default(3000),
  DATABASE_URL: z.string().optional(),
  SESSION_SECRET: z.string().optional(),
  TOKEN_ENCRYPTION_KEY: optionalNonEmpty(
    z.string().regex(/^[a-fA-F0-9]{64}$/, 'must be 64 hex characters'),
  ),
  GOOGLE_HOSTED_DOMAIN: z.string().default('example.com'),
  INNGEST_EVENT_KEY: z.string().optional(),
  INNGEST_SIGNING_KEY: z.string().optional(),
  /** Private policy service (spec 016). Both set: HttpPolicyProvider; else AllowAll. */
  POLICY_MODE: z.enum(['optional', 'required']).default('optional'),
  POLICY_SERVICE_URL: optionalNonEmpty(z.string().url()),
  POLICY_SERVICE_TOKEN: optionalNonEmpty(z.string().min(16)),
  /** Bearer the policy service presents on POST /auth/introspect. Unset: route answers 404. */
  POLICY_INTROSPECTION_TOKEN: optionalNonEmpty(z.string().min(16)),
});

export function assertPolicyConfiguration(env: { POLICY_MODE?: string; POLICY_SERVICE_URL?: string; POLICY_SERVICE_TOKEN?: string }): void {
  const url = Boolean(env.POLICY_SERVICE_URL);
  const token = Boolean(env.POLICY_SERVICE_TOKEN);
  if (url !== token || (env.POLICY_MODE === 'required' && (!url || !token))) {
    throw new Error('Policy configuration is incomplete');
  }
}

// Validate at import time
const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
  if (parsed.error.issues.some((issue) => String(issue.path[0]).startsWith('POLICY_'))) throw new Error('Invalid policy configuration');
  console.error('[joyus] Invalid environment configuration:');
  for (const issue of parsed.error.issues) {
    console.error(`  ${issue.path.join('.')}: ${issue.message}`);
  }
  if (process.env.NODE_ENV === 'production') {
    throw new Error('FATAL: Invalid environment configuration');
  }
}

export const config = parsed.success ? parsed.data : envSchema.parse({});

assertPolicyConfiguration(config);
