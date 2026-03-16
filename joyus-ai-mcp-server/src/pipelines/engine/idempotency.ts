/**
 * Idempotency key generation and deduplication check.
 *
 * Each (executionId, stepId, attemptNumber) triple produces a unique SHA-256 key.
 * Before executing a step handler, the runner checks whether a completed step
 * with the same key already exists (idempotent replay).
 */

import { createHash } from 'node:crypto';
import { eq, and } from 'drizzle-orm';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { executionSteps } from '../schema.js';

/**
 * Deterministic SHA-256 key from execution + step + attempt.
 */
export function computeIdempotencyKey(
  executionId: string,
  stepId: string,
  attemptNumber: number,
): string {
  return createHash('sha256')
    .update(`${executionId}:${stepId}:${attemptNumber}`)
    .digest('hex');
}

/**
 * Return cached output if a completed execution_step with this key exists,
 * otherwise null.
 */
export async function checkIdempotency(
  db: NodePgDatabase,
  idempotencyKey: string,
): Promise<Record<string, unknown> | null> {
  const rows = await db
    .select()
    .from(executionSteps)
    .where(
      and(
        eq(executionSteps.idempotencyKey, idempotencyKey),
        eq(executionSteps.status, 'completed'),
      ),
    );

  if (rows.length === 0) return null;
  return (rows[0].outputData as Record<string, unknown>) ?? null;
}
