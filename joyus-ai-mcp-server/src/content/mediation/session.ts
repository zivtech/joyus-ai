/**
 * Content Mediation — Session management service
 *
 * Tracks mediation sessions: creation, retrieval, message counting, and closure.
 * Each session ties an API key (integration) to an end user for a conversation.
 */

import { createId } from '@paralleldrive/cuid2';
import { and, eq, sql } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/node-postgres';
import { alias } from 'drizzle-orm/pg-core';

import { CACHE_TTL_SECONDS } from '../generation/cost.js';
import { contentMediationSessions, contentOperationLogs } from '../schema.js';

type DrizzleClient = ReturnType<typeof drizzle>;

export interface MediationSessionResult {
  sessionId: string;
  tenantId: string;
  userId: string;
  activeProfileId: string | null;
  startedAt: Date;
}

export interface IncrementMessageCountResult {
  idleGapSeconds: number;
  isCacheMiss: boolean;
}

export class MediationSessionService {
  constructor(private db: DrizzleClient) {}

  /**
   * Create a new mediation session.
   */
  async createSession(
    tenantId: string,
    apiKeyId: string,
    userId: string,
    activeProfileId?: string,
  ): Promise<MediationSessionResult> {
    const id = createId();
    const now = new Date();

    await this.db.insert(contentMediationSessions).values({
      id,
      tenantId,
      apiKeyId,
      userId,
      activeProfileId: activeProfileId ?? null,
      messageCount: 0,
      startedAt: now,
      lastActivityAt: now,
    });

    return {
      sessionId: id,
      tenantId,
      userId,
      activeProfileId: activeProfileId ?? null,
      startedAt: now,
    };
  }

  /**
   * Retrieve a session by id, or null if not found.
   */
  async getSession(
    sessionId: string,
  ): Promise<typeof contentMediationSessions.$inferSelect | null> {
    const rows = await this.db
      .select()
      .from(contentMediationSessions)
      .where(eq(contentMediationSessions.id, sessionId))
      .limit(1);
    return rows[0] ?? null;
  }

  /**
   * Mark a session as ended.
   */
  async closeSession(sessionId: string): Promise<void> {
    await this.db
      .update(contentMediationSessions)
      .set({ endedAt: new Date() })
      .where(eq(contentMediationSessions.id, sessionId));
  }

  /**
   * Atomically increment message count and derive the idle-gap/cache-miss metrics.
   */
  async incrementMessageCount(sessionId: string): Promise<IncrementMessageCountResult> {
    const previousSession = alias(contentMediationSessions, 'previous_session');
    const idleGapSecondsSql = sql<number>`coalesce(extract(epoch from (now() - ${previousSession.lastActivityAt}))::int, 0)`;
    const isCacheMissSql = sql<boolean>`${previousSession.lastActivityAt} is not null and extract(epoch from (now() - ${previousSession.lastActivityAt})) > ${CACHE_TTL_SECONDS}`;

    const [updatedSession] = await this.db
      .update(contentMediationSessions)
      .set({
        messageCount: sql`${contentMediationSessions.messageCount} + 1`,
        lastActivityAt: sql`now()`,
        maxIdleGapSeconds: sql`greatest(${contentMediationSessions.maxIdleGapSeconds}, ${idleGapSecondsSql})`,
        cacheMissCount: sql`${contentMediationSessions.cacheMissCount} + case when ${isCacheMissSql} then 1 else 0 end`,
      })
      .from(previousSession)
      .where(and(
        eq(contentMediationSessions.id, sessionId),
        eq(contentMediationSessions.id, previousSession.id),
      ))
      .returning({
        idleGapSeconds: idleGapSecondsSql,
        isCacheMiss: isCacheMissSql,
        tenantId: previousSession.tenantId,
      });

    if (!updatedSession) {
      throw new Error(`Mediation session not found: ${sessionId}`);
    }

    if (updatedSession.isCacheMiss) {
      await this.db.insert(contentOperationLogs).values({
        id: createId(),
        tenantId: updatedSession.tenantId,
        operation: 'cache_miss',
        sessionId,
        durationMs: 0,
        success: true,
        metadata: {
          idleGapSeconds: updatedSession.idleGapSeconds,
          cacheTtlSeconds: CACHE_TTL_SECONDS,
        },
      });
    }

    return {
      idleGapSeconds: updatedSession.idleGapSeconds,
      isCacheMiss: updatedSession.isCacheMiss,
    };
  }
}
