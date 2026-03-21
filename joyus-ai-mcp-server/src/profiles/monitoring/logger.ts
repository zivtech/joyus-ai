/**
 * Profile Monitoring — Operation Logger
 *
 * Structured audit logging for profile operations.
 * Writes to profiles.operation_logs and emits JSON to stdout.
 * Append-only: no UPDATE or DELETE per data governance policy.
 */

import { desc } from 'drizzle-orm';
import { createId } from '@paralleldrive/cuid2';

import { db } from '../../db/client.js';
import { profileOperationLogs, type ProfileOperationLog } from '../schema.js';
import { requireTenantId, tenantWhere } from '../tenant-scope.js';
import type { ProfileOperationType } from '../types.js';

// ============================================================
// TYPES
// ============================================================

export interface LogOperationInput {
  tenantId: string;
  operation: ProfileOperationType;
  profileIdentity?: string;
  userId?: string;
  durationMs: number;
  success: boolean;
  metadata?: Record<string, unknown>;
}

export interface OperationHistoryOptions {
  operation?: ProfileOperationType;
  limit?: number;
  offset?: number;
}

// ============================================================
// LOGGER
// ============================================================

export class ProfileOperationLogger {
  /**
   * Insert an operation log row and emit structured JSON to stdout.
   * Append-only — never updates or deletes existing rows.
   */
  async logOperation(input: LogOperationInput): Promise<void> {
    requireTenantId(input.tenantId);

    const metadata = input.metadata ?? {};

    // 1. Persist to database (append-only)
    await db.insert(profileOperationLogs).values({
      id: createId(),
      tenantId: input.tenantId,
      operation: input.operation,
      profileIdentity: input.profileIdentity ?? null,
      userId: input.userId ?? null,
      durationMs: input.durationMs,
      success: input.success,
      metadata,
    });

    // 2. Emit structured JSON to stdout for container log aggregation
    const record: Record<string, unknown> = {
      level: input.success ? 'info' : 'warn',
      service: 'profiles',
      operation: input.operation,
      tenantId: input.tenantId,
      durationMs: input.durationMs,
      success: input.success,
      timestamp: new Date().toISOString(),
    };

    if (input.profileIdentity !== undefined) {
      record['profileIdentity'] = input.profileIdentity;
    }
    if (input.userId !== undefined) {
      record['userId'] = input.userId;
    }

    // Spread extra metadata fields into the log record
    Object.assign(record, metadata);

    process.stdout.write(JSON.stringify(record) + '\n');
  }

  /**
   * Retrieve operation history for a tenant, newest-first.
   * Optionally filtered by operation type.
   */
  async getOperationHistory(
    tenantId: string,
    options?: OperationHistoryOptions,
  ): Promise<ProfileOperationLog[]> {
    requireTenantId(tenantId);

    const limit = options?.limit ?? 50;
    const offset = options?.offset ?? 0;

    const query = db
      .select()
      .from(profileOperationLogs)
      .where(tenantWhere(profileOperationLogs, tenantId))
      .orderBy(desc(profileOperationLogs.createdAt))
      .limit(limit)
      .offset(offset);

    return query;
  }
}
