/**
 * Event Adapter — Event Buffer & Dead Letter Queue
 *
 * PostgreSQL-backed event buffer that manages the webhook event lifecycle:
 * pending → processing → delivered | failed → dead_letter
 *
 * Concurrency safety: uses optimistic locking (UPDATE WHERE status = 'pending')
 * to prevent double-processing when multiple workers drain the buffer.
 */

import { and, eq, sql, lte, count, desc, gte, type SQL } from 'drizzle-orm';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';

import { webhookEvents } from '../schema.js';
import type { WebhookEvent, NewWebhookEvent } from '../schema.js';
import type { WebhookEventSourceType, WebhookEventStatus } from '../types.js';
import { MAX_RETRY_ATTEMPTS, RETRY_BACKOFF_BASE_MS } from '../types.js';

// ============================================================
// TYPES
// ============================================================

export interface BufferEventParams {
  tenantId: string;
  sourceType: WebhookEventSourceType;
  sourceId?: string;
  scheduleId?: string;
  payload: unknown;
  headers?: Record<string, string>;
  signatureValid?: boolean;
}

export interface DeliveryResult {
  translatedTrigger: unknown;
  triggerType: string;
  pipelineId: string;
  processingDurationMs: number;
}

export interface EventQueryParams {
  tenantId?: string;
  status?: WebhookEventStatus;
  sourceType?: WebhookEventSourceType;
  sourceId?: string;
  from?: Date;
  to?: Date;
  limit?: number;
  offset?: number;
}

// ============================================================
// BUFFER WRITE (T012)
// ============================================================

/**
 * Persist an incoming event to the buffer with status 'pending'.
 * Must be fast — called synchronously from webhook endpoint before returning 202.
 */
export async function bufferEvent(
  db: NodePgDatabase<Record<string, unknown>>,
  params: BufferEventParams,
): Promise<WebhookEvent> {
  const values: NewWebhookEvent = {
    tenantId: params.tenantId,
    sourceType: params.sourceType,
    sourceId: params.sourceId ?? null,
    scheduleId: params.scheduleId ?? null,
    payload: params.payload,
    headers: params.headers ?? null,
    signatureValid: params.signatureValid ?? null,
    status: 'pending',
    attemptCount: 0,
    forwardedToAutomation: false,
  };

  const [event] = await db.insert(webhookEvents).values(values).returning();
  return event;
}

// ============================================================
// BUFFER READ / QUERY (T013)
// ============================================================

/**
 * Query webhook events with filters. Tenant scoping is enforced:
 * tenantId must be provided for tenant queries.
 */
export async function queryEvents(
  db: NodePgDatabase<Record<string, unknown>>,
  params: EventQueryParams,
): Promise<{ events: WebhookEvent[]; total: number }> {
  const conditions: SQL[] = [];

  if (params.tenantId) {
    conditions.push(eq(webhookEvents.tenantId, params.tenantId));
  }
  if (params.status) {
    conditions.push(eq(webhookEvents.status, params.status));
  }
  if (params.sourceType) {
    conditions.push(eq(webhookEvents.sourceType, params.sourceType));
  }
  if (params.sourceId) {
    conditions.push(eq(webhookEvents.sourceId, params.sourceId));
  }
  if (params.from) {
    conditions.push(gte(webhookEvents.createdAt, params.from));
  }
  if (params.to) {
    conditions.push(lte(webhookEvents.createdAt, params.to));
  }

  const where = conditions.length > 0 ? and(...conditions) : undefined;
  const limit = params.limit ?? 50;
  const offset = params.offset ?? 0;

  const [events, totalResult] = await Promise.all([
    db
      .select()
      .from(webhookEvents)
      .where(where)
      .orderBy(desc(webhookEvents.createdAt))
      .limit(limit)
      .offset(offset),
    db
      .select({ count: count() })
      .from(webhookEvents)
      .where(where),
  ]);

  return { events, total: totalResult[0]?.count ?? 0 };
}

/**
 * Get a single event by ID, optionally scoped to a tenant.
 */
export async function getEventById(
  db: NodePgDatabase<Record<string, unknown>>,
  id: string,
  tenantId?: string,
): Promise<WebhookEvent | null> {
  const conditions: SQL[] = [eq(webhookEvents.id, id)];
  if (tenantId) {
    conditions.push(eq(webhookEvents.tenantId, tenantId));
  }

  const [event] = await db
    .select()
    .from(webhookEvents)
    .where(and(...conditions));

  return event ?? null;
}

// ============================================================
// STATUS TRANSITIONS (T014)
// ============================================================

/**
 * Atomically claim a pending event for processing.
 * Uses optimistic locking: only succeeds if status is still 'pending'.
 * Returns null if another worker already claimed it.
 */
export async function claimEvent(
  db: NodePgDatabase<Record<string, unknown>>,
  eventId: string,
): Promise<WebhookEvent | null> {
  const [event] = await db
    .update(webhookEvents)
    .set({
      status: 'processing',
      updatedAt: new Date(),
    })
    .where(and(eq(webhookEvents.id, eventId), eq(webhookEvents.status, 'pending')))
    .returning();

  return event ?? null;
}

/**
 * Mark an event as successfully delivered to the pipeline.
 */
export async function markDelivered(
  db: NodePgDatabase<Record<string, unknown>>,
  eventId: string,
  result: DeliveryResult,
): Promise<void> {
  await db
    .update(webhookEvents)
    .set({
      status: 'delivered',
      translatedTrigger: result.translatedTrigger,
      triggerType: result.triggerType,
      pipelineId: result.pipelineId,
      processingDurationMs: result.processingDurationMs,
      deliveredAt: new Date(),
      updatedAt: new Date(),
    })
    .where(eq(webhookEvents.id, eventId));
}

/**
 * Mark an event as failed. Increments attempt_count and auto-escalates
 * to dead_letter if max retries exceeded.
 */
export async function markFailed(
  db: NodePgDatabase<Record<string, unknown>>,
  eventId: string,
  reason: string,
): Promise<void> {
  // Increment attempt_count and set failure_reason
  const [updated] = await db
    .update(webhookEvents)
    .set({
      status: 'failed',
      failureReason: reason,
      attemptCount: sql`${webhookEvents.attemptCount} + 1`,
      updatedAt: new Date(),
    })
    .where(eq(webhookEvents.id, eventId))
    .returning();

  // Auto-escalate to dead letter if max retries exceeded
  if (updated && updated.attemptCount >= MAX_RETRY_ATTEMPTS) {
    await escalateToDeadLetter(db, eventId);
  }
}

// ============================================================
// RETRY WITH EXPONENTIAL BACKOFF (T015)
// ============================================================

/**
 * Get failed events eligible for retry based on exponential backoff.
 * Backoff: RETRY_BACKOFF_BASE_MS * 2^(attempt_count - 1)
 */
export async function getRetryableEvents(
  db: NodePgDatabase<Record<string, unknown>>,
): Promise<WebhookEvent[]> {
  // Select failed events where enough time has passed based on backoff
  // backoff_ms = base * 2^(attempt_count - 1)
  // eligible when: updated_at < now() - interval 'backoff_ms milliseconds'
  return db
    .select()
    .from(webhookEvents)
    .where(
      and(
        eq(webhookEvents.status, 'failed'),
        sql`${webhookEvents.attemptCount} < ${MAX_RETRY_ATTEMPTS}`,
        sql`${webhookEvents.updatedAt} < now() - (${RETRY_BACKOFF_BASE_MS} * power(2, ${webhookEvents.attemptCount} - 1)) * interval '1 millisecond'`,
      ),
    );
}

/**
 * Requeue a failed event for retry by setting status back to 'pending'.
 */
export async function requeueForRetry(
  db: NodePgDatabase<Record<string, unknown>>,
  eventId: string,
): Promise<void> {
  await db
    .update(webhookEvents)
    .set({
      status: 'pending',
      updatedAt: new Date(),
    })
    .where(and(eq(webhookEvents.id, eventId), eq(webhookEvents.status, 'failed')));
}

// ============================================================
// DEAD LETTER ESCALATION (T016)
// ============================================================

/**
 * Escalate an event to dead letter status.
 */
export async function escalateToDeadLetter(
  db: NodePgDatabase<Record<string, unknown>>,
  eventId: string,
): Promise<void> {
  await db
    .update(webhookEvents)
    .set({
      status: 'dead_letter',
      updatedAt: new Date(),
    })
    .where(eq(webhookEvents.id, eventId));
}

/**
 * Replay a failed or dead-lettered event by resetting it to pending.
 * Throws if the event is in a non-replayable state.
 */
export async function replayEvent(
  db: NodePgDatabase<Record<string, unknown>>,
  eventId: string,
): Promise<WebhookEvent> {
  const [event] = await db
    .select()
    .from(webhookEvents)
    .where(eq(webhookEvents.id, eventId));

  if (!event) {
    throw new Error(`Event ${eventId} not found`);
  }

  const replayableStates: WebhookEventStatus[] = ['failed', 'dead_letter'];
  if (!replayableStates.includes(event.status as WebhookEventStatus)) {
    throw new Error(`Cannot replay event in '${event.status}' state — only failed or dead_letter events can be replayed`);
  }

  const [updated] = await db
    .update(webhookEvents)
    .set({
      status: 'pending',
      attemptCount: 0,
      failureReason: null,
      updatedAt: new Date(),
    })
    .where(eq(webhookEvents.id, eventId))
    .returning();

  return updated;
}
