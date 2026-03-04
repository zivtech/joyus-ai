/**
 * Content Operation Logger
 *
 * Structured logging for all content operations (sync, search, resolve,
 * generate, mediate). Writes to operation_logs table for queryable history
 * and emits JSON to stdout for container log aggregation.
 *
 * Records are append-only — no UPDATE or DELETE per data governance policy.
 */

import { db, contentOperationLogs } from '../../db/client.js';
import type { ContentOperationType } from '../types.js';

// ============================================================
// TYPES
// ============================================================

export interface ContentLogEntry {
  tenantId: string;
  operation: ContentOperationType;
  sourceId?: string;
  userId?: string;
  durationMs: number;
  success: boolean;
  metadata: Record<string, unknown>;
}

// ============================================================
// LOGGER
// ============================================================

export class ContentLogger {
  /**
   * Write a structured log entry to operation_logs and stdout.
   * Append-only — never updates or deletes existing rows.
   */
  async log(entry: ContentLogEntry): Promise<void> {
    // 1. Persist to database (append-only)
    await db.insert(contentOperationLogs).values({
      tenantId: entry.tenantId,
      operation: entry.operation,
      sourceId: entry.sourceId ?? null,
      userId: entry.userId ?? null,
      durationMs: entry.durationMs,
      success: entry.success,
      metadata: entry.metadata,
    });

    // 2. Emit structured JSON to stdout for container log aggregation
    const record = {
      level: 'info',
      operation: entry.operation,
      tenantId: entry.tenantId,
      ...(entry.sourceId !== undefined && { sourceId: entry.sourceId }),
      ...(entry.userId !== undefined && { userId: entry.userId }),
      durationMs: entry.durationMs,
      success: entry.success,
      ...entry.metadata,
      timestamp: new Date().toISOString(),
    };
    process.stdout.write(JSON.stringify(record) + '\n');
  }

  // ============================================================
  // CONVENIENCE METHODS
  // ============================================================

  async logSync(
    sourceId: string,
    tenantId: string,
    durationMs: number,
    success: boolean,
    metadata?: Record<string, unknown>,
  ): Promise<void> {
    await this.log({
      tenantId,
      operation: 'sync',
      sourceId,
      durationMs,
      success,
      metadata: metadata ?? {},
    });
  }

  async logSearch(
    userId: string,
    tenantId: string,
    query: string,
    durationMs: number,
    resultCount: number,
  ): Promise<void> {
    await this.log({
      tenantId,
      operation: 'search',
      userId,
      durationMs,
      success: true,
      metadata: { query, resultCount },
    });
  }

  async logResolve(
    userId: string,
    tenantId: string,
    durationMs: number,
    success: boolean,
    productCount: number,
  ): Promise<void> {
    await this.log({
      tenantId,
      operation: 'resolve',
      userId,
      durationMs,
      success,
      metadata: { productCount },
    });
  }

  async logGenerate(
    userId: string,
    tenantId: string,
    durationMs: number,
    citationCount: number,
    profileId?: string,
  ): Promise<void> {
    await this.log({
      tenantId,
      operation: 'generate',
      userId,
      durationMs,
      success: true,
      metadata: { citationCount, ...(profileId !== undefined && { profileId }) },
    });
  }

  async logMediate(
    userId: string,
    tenantId: string,
    sessionId: string,
    durationMs: number,
    success: boolean,
  ): Promise<void> {
    await this.log({
      tenantId,
      operation: 'mediate',
      userId,
      durationMs,
      success,
      metadata: { sessionId },
    });
  }
}
