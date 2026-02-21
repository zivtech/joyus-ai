/**
 * Content Mediation — Session management service
 *
 * Tracks mediation sessions: creation, retrieval, message counting, and closure.
 * Each session ties an API key (integration) to an end user for a conversation.
 */

import { eq, sql } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/node-postgres';
import { createId } from '@paralleldrive/cuid2';
import { contentMediationSessions } from '../schema.js';

type DrizzleClient = ReturnType<typeof drizzle>;

export interface MediationSessionResult {
  sessionId: string;
  tenantId: string;
  userId: string;
  activeProfileId: string | null;
  startedAt: Date;
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
   * Atomically increment the message count and update lastActivityAt.
   */
  async incrementMessageCount(sessionId: string): Promise<void> {
    await this.db
      .update(contentMediationSessions)
      .set({
        messageCount: sql`${contentMediationSessions.messageCount} + 1`,
        lastActivityAt: new Date(),
      })
      .where(eq(contentMediationSessions.id, sessionId));
  }
}
