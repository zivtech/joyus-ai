/**
 * Session Service — WP01
 *
 * Core CRUD service for orchestrator session lifecycle.
 * Every query is tenant-scoped: tenantId MUST be included in all WHERE clauses.
 *
 * State machine enforced at the service boundary:
 *   pending  → running | cancelled
 *   running  → suspended | completed | failed
 *   suspended→ running | failed
 *   completed→ (terminal)
 *   failed   → (terminal)
 *   cancelled→ (terminal)
 */

import { createId } from '@paralleldrive/cuid2';
import { and, asc, count, desc, eq, lt, sql } from 'drizzle-orm';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';

import { orchestratorSessions } from '../db/schema/orchestrator.js';
import type { OrchestratorSession } from '../db/schema/orchestrator.js';
import { inngest } from '../inngest/client.js';

import {
  type CreateSessionInput,
  type ListSessionsFilters,
  type SessionStatus,
  type UpdateSessionStatusInput,
  InvalidStatusTransitionError,
  SessionNotFoundError,
  SESSION_TRANSITIONS,
  createSessionInputSchema,
  listSessionsFiltersSchema,
  updateSessionStatusInputSchema,
} from './types.js';

/** Inngest client interface (subset used here — facilitates testing).
 *  Picks the typed `send` from the real client so call-sites stay constrained
 *  to declared event schemas. */
type InngestClient = Pick<typeof inngest, 'send'>;

export type { OrchestratorSession };

export interface PaginatedSessions {
  items: OrchestratorSession[];
  /** Cursor for the next page — undefined when no more results */
  cursor: string | undefined;
}

export class SessionService {
  /**
   * @param db - Drizzle database instance
   * @param concurrencyPerTenant - Per-tenant concurrency limit (from env). When a
   *   session is created and the tenant already has >= this many running/pending
   *   sessions, an `orchestrator/session.queued` observability event is emitted.
   * @param inngestClient - Inngest client for event emission. Defaults to the
   *   shared singleton; injectable for tests.
   */
  constructor(
    private readonly db: NodePgDatabase<Record<string, unknown>>,
    private readonly concurrencyPerTenant: number = parseInt(
      process.env.ORCHESTRATOR_CONCURRENCY_PER_TENANT ?? '10',
      10,
    ),
    private readonly inngestClient: InngestClient = inngest,
  ) {}

  /**
   * Create a new session in 'pending' status.
   * tenantId and userId are validated by Zod — never trust raw input.
   *
   * T015: If the tenant is already at or above their concurrency limit (running
   * or pending sessions), emits `orchestrator/session.queued` for observability.
   * Inngest will queue the resulting session.created event automatically when
   * the per-tenant concurrency key is saturated.
   */
  async createSession(input: CreateSessionInput): Promise<OrchestratorSession> {
    const validated = createSessionInputSchema.parse(input);

    const id = createId();
    const now = new Date();

    const [session] = await this.db
      .insert(orchestratorSessions)
      .values({
        id,
        tenantId: validated.tenantId,
        userId: validated.userId,
        status: 'pending',
        metadata: validated.metadata,
        createdAt: now,
        updatedAt: now,
      })
      .returning();

    try {
      await this.inngestClient.send({
        name: 'orchestrator/session.created',
        data: {
          sessionId: id,
          tenantId: validated.tenantId,
          userId: validated.userId,
        },
      });
    } catch (err) {
      console.error('[SessionService] Failed to emit session.created event:', err);
    }

    // T015: Emit queued event when the tenant is at or above concurrency capacity.
    // Count active (running + pending) sessions for this tenant — if at or over
    // the limit, the new session will be queued by Inngest's concurrency controls.
    void this.emitQueuedEventIfAtCapacity(validated.tenantId, session.id);

    return session;
  }

  /**
   * Emit `orchestrator/session.queued` if the tenant has reached their concurrency
   * limit. Non-blocking: errors are logged but do not fail session creation.
   */
  private async emitQueuedEventIfAtCapacity(
    tenantId: string,
    sessionId: string,
  ): Promise<void> {
    try {
      const [row] = await this.db
        .select({ total: count() })
        .from(orchestratorSessions)
        .where(
          and(
            eq(orchestratorSessions.tenantId, tenantId),
            sql`${orchestratorSessions.status} IN ('running', 'pending')`,
          ),
        );

      const activeCount = row?.total ?? 0;
      if (activeCount >= this.concurrencyPerTenant) {
        await this.inngestClient.send({
          name: 'orchestrator/session.queued',
          data: {
            sessionId,
            tenantId,
            queuedAt: new Date().toISOString(),
          },
        });
      }
    } catch (err) {
      // Observability event failure must not surface to the caller
      console.error('[SessionService] Failed to emit session.queued event:', err);
    }
  }

  /**
   * Get a session by ID, scoped to the tenant.
   * Returns null if the session doesn't exist OR belongs to a different tenant.
   * This prevents cross-tenant information leakage via timing/error message differences.
   */
  async getSession(tenantId: string, sessionId: string): Promise<OrchestratorSession | null> {
    const [session] = await this.db
      .select()
      .from(orchestratorSessions)
      .where(
        and(
          eq(orchestratorSessions.id, sessionId),
          eq(orchestratorSessions.tenantId, tenantId),
        ),
      )
      .limit(1);

    return session ?? null;
  }

  /**
   * Update session status with state machine validation.
   * Optionally records the inngestRunId when transitioning to 'running'.
   */
  async updateSessionStatus(input: UpdateSessionStatusInput): Promise<OrchestratorSession> {
    const validated = updateSessionStatusInputSchema.parse(input);
    const { tenantId, sessionId, newStatus, inngestRunId } = validated;

    const current = await this.getSession(tenantId, sessionId);
    if (!current) {
      throw new SessionNotFoundError(sessionId, tenantId);
    }

    this.assertValidTransition(current.status as SessionStatus, newStatus);

    const now = new Date();
    const updates: Partial<typeof orchestratorSessions.$inferInsert> = {
      status: newStatus,
      updatedAt: now,
    };

    if (inngestRunId !== undefined) {
      updates.inngestRunId = inngestRunId;
    }

    if (newStatus === 'completed' || newStatus === 'failed') {
      updates.completedAt = now;
    }

    const [updated] = await this.db
      .update(orchestratorSessions)
      .set(updates)
      .where(
        and(
          eq(orchestratorSessions.id, sessionId),
          eq(orchestratorSessions.tenantId, tenantId),
        ),
      )
      .returning();

    return updated;
  }

  /**
   * List sessions for a tenant with optional filters and cursor-based pagination.
   * Results are ordered by createdAt DESC.
   */
  async listSessions(
    tenantId: string,
    filters: ListSessionsFilters = { limit: 20 },
  ): Promise<PaginatedSessions> {
    const validated = listSessionsFiltersSchema.parse(filters);
    const { status, userId, limit, cursor } = validated;

    const conditions = [eq(orchestratorSessions.tenantId, tenantId)];

    if (status !== undefined) {
      conditions.push(eq(orchestratorSessions.status, status));
    }

    if (userId !== undefined) {
      conditions.push(eq(orchestratorSessions.userId, userId));
    }

    if (cursor !== undefined) {
      // Cursor is a base64-encoded createdAt ISO string
      const cursorDate = new Date(Buffer.from(cursor, 'base64').toString('utf-8'));
      conditions.push(lt(orchestratorSessions.createdAt, cursorDate));
    }

    const rows = await this.db
      .select()
      .from(orchestratorSessions)
      .where(and(...conditions))
      .orderBy(desc(orchestratorSessions.createdAt))
      .limit(limit + 1); // fetch one extra to determine if there's a next page

    const hasMore = rows.length > limit;
    const items = hasMore ? rows.slice(0, limit) : rows;

    const nextCursor =
      hasMore && items.length > 0
        ? Buffer.from(items[items.length - 1].createdAt.toISOString()).toString('base64')
        : undefined;

    return { items, cursor: nextCursor };
  }

  /**
   * Find sessions that were running when the process crashed (orphaned sessions).
   * An orphaned session has status 'running' but no active Inngest run tracking it.
   * Returns sessions created before the provided cutoff (default: 10 minutes ago).
   */
  async findOrphanedSessions(
    tenantId: string,
    cutoffMs = 10 * 60 * 1000,
  ): Promise<OrchestratorSession[]> {
    const cutoff = new Date(Date.now() - cutoffMs);

    return this.db
      .select()
      .from(orchestratorSessions)
      .where(
        and(
          eq(orchestratorSessions.tenantId, tenantId),
          eq(orchestratorSessions.status, 'running'),
          lt(orchestratorSessions.updatedAt, cutoff),
        ),
      )
      .orderBy(asc(orchestratorSessions.createdAt));
  }

  /**
   * Find all running sessions with stale updatedAt across all tenants.
   * Used for server-startup crash recovery.
   */
  async findAllOrphanedSessions(cutoffMs = 10 * 60 * 1000): Promise<OrchestratorSession[]> {
    const cutoff = new Date(Date.now() - cutoffMs);

    return this.db
      .select()
      .from(orchestratorSessions)
      .where(
        and(
          eq(orchestratorSessions.status, 'running'),
          lt(orchestratorSessions.updatedAt, cutoff),
        ),
      )
      .orderBy(asc(orchestratorSessions.tenantId), asc(orchestratorSessions.createdAt));
  }

  /**
   * Find all pending sessions with stale updatedAt across all tenants.
   * Used for server-startup crash recovery when the Inngest send fails after
   * session creation, leaving sessions stuck in 'pending'.
   */
  async findAllOrphanedPendingSessions(cutoffMs = 10 * 60 * 1000): Promise<OrchestratorSession[]> {
    const cutoff = new Date(Date.now() - cutoffMs);

    return this.db
      .select()
      .from(orchestratorSessions)
      .where(
        and(
          eq(orchestratorSessions.status, 'pending'),
          lt(orchestratorSessions.updatedAt, cutoff),
        ),
      )
      .orderBy(asc(orchestratorSessions.tenantId), asc(orchestratorSessions.createdAt));
  }

  /**
   * Mark a stuck pending session as failed (crash recovery path for pending sessions).
   * Used when the Inngest session.created event was never delivered and the session
   * is stuck in 'pending'. Does NOT go through the normal state machine.
   */
  async markOrphanedPendingAsFailed(
    tenantId: string,
    sessionId: string,
  ): Promise<OrchestratorSession | null> {
    const now = new Date();
    const recoveryPatch = JSON.stringify({
      recoveredFromCrash: true,
      recoveredAt: now.toISOString(),
    });

    const [updated] = await this.db
      .update(orchestratorSessions)
      .set({
        status: 'failed',
        updatedAt: now,
        completedAt: now,
        metadata: sql`COALESCE(${orchestratorSessions.metadata}, '{}'::jsonb) || ${recoveryPatch}::jsonb`,
      })
      .where(
        and(
          eq(orchestratorSessions.id, sessionId),
          eq(orchestratorSessions.tenantId, tenantId),
          eq(orchestratorSessions.status, 'pending'),
        ),
      )
      .returning();

    return updated ?? null;
  }

  /**
   * Mark an orphaned session as failed (crash recovery path).
   * Does NOT go through the normal state machine — orphaned sessions
   * may have been interrupted mid-transition.
   */
  async markOrphanedAsFailed(
    tenantId: string,
    sessionId: string,
  ): Promise<OrchestratorSession | null> {
    const now = new Date();
    // Merge recovery metadata into the existing JSONB value using PostgreSQL's ||
    // operator. COALESCE guards against a null metadata column (schema allows null).
    const recoveryPatch = JSON.stringify({
      recoveredFromCrash: true,
      recoveredAt: now.toISOString(),
    });

    const [updated] = await this.db
      .update(orchestratorSessions)
      .set({
        status: 'failed',
        updatedAt: now,
        completedAt: now,
        metadata: sql`COALESCE(${orchestratorSessions.metadata}, '{}'::jsonb) || ${recoveryPatch}::jsonb`,
      })
      .where(
        and(
          eq(orchestratorSessions.id, sessionId),
          eq(orchestratorSessions.tenantId, tenantId),
          eq(orchestratorSessions.status, 'running'),
        ),
      )
      .returning();

    return updated ?? null;
  }

  // ---------------------------------------------------------------------------
  // Private helpers
  // ---------------------------------------------------------------------------

  private assertValidTransition(from: SessionStatus, to: SessionStatus): void {
    const allowed = SESSION_TRANSITIONS[from];
    if (!allowed.includes(to)) {
      throw new InvalidStatusTransitionError(from, to);
    }
  }
}
