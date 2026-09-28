import { and, eq, gt, lte } from 'drizzle-orm';
import type { PgDatabase } from 'drizzle-orm/pg-core';
import type { TablesRelationalConfig } from 'drizzle-orm/relations';

import { db as defaultDatabase } from '../db/client.js';
import { skillEnablements } from '../db/schema.js';
import type { SkillEnablement } from '../db/schema.js';

export const DEFAULT_SKILL_ENABLEMENT_TTL_MS = 24 * 60 * 60 * 1_000;

// The query-result type varies by PostgreSQL driver (node-postgres in the app,
// PGlite in tests), while the PgDatabase query-builder surface is shared.
export type SkillEnablementDatabase = PgDatabase<
  // Driver result HKTs are intentionally abstracted at this boundary.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  any,
  Record<string, unknown>,
  TablesRelationalConfig
>;

export interface SkillEnablementStoreOptions {
  clock?: () => Date;
  ttlMs?: number;
}

function requireIdentifier(name: string, value: string): void {
  if (value.trim().length === 0) {
    throw new Error(`${name} must not be blank`);
  }
}

function validateIdentifiers(
  userId: string,
  sessionId: string,
  skillName?: string,
): void {
  requireIdentifier('userId', userId);
  requireIdentifier('sessionId', sessionId);

  if (skillName !== undefined) {
    requireIdentifier('skillName', skillName);
  }
}

export class SkillEnablementStore {
  private readonly clock: () => Date;
  private readonly ttlMs: number;

  constructor(
    private readonly database: SkillEnablementDatabase = defaultDatabase,
    options: SkillEnablementStoreOptions = {},
  ) {
    const ttlMs = options.ttlMs ?? DEFAULT_SKILL_ENABLEMENT_TTL_MS;
    if (!Number.isFinite(ttlMs) || ttlMs <= 0) {
      throw new Error('ttlMs must be a positive finite number');
    }

    this.clock = options.clock ?? (() => new Date());
    this.ttlMs = ttlMs;
  }

  async enable(
    userId: string,
    sessionId: string,
    skillName: string,
  ): Promise<SkillEnablement> {
    validateIdentifiers(userId, sessionId, skillName);
    const enabledAt = this.clock();
    const expiresAt = new Date(enabledAt.getTime() + this.ttlMs);

    const [row] = await this.database
      .insert(skillEnablements)
      .values({ userId, sessionId, skillName, enabledAt, expiresAt })
      .onConflictDoUpdate({
        target: [
          skillEnablements.userId,
          skillEnablements.sessionId,
          skillEnablements.skillName,
        ],
        set: { enabledAt, expiresAt },
      })
      .returning();

    if (!row) {
      throw new Error('Failed to enable skill');
    }

    return row;
  }

  async disable(
    userId: string,
    sessionId: string,
    skillName: string,
  ): Promise<boolean> {
    validateIdentifiers(userId, sessionId, skillName);

    const deleted = await this.database
      .delete(skillEnablements)
      .where(and(
        eq(skillEnablements.userId, userId),
        eq(skillEnablements.sessionId, sessionId),
        eq(skillEnablements.skillName, skillName),
      ))
      .returning({ skillName: skillEnablements.skillName });

    return deleted.length > 0;
  }

  async list(userId: string, sessionId: string): Promise<SkillEnablement[]> {
    validateIdentifiers(userId, sessionId);
    const now = this.clock();

    return this.database
      .select()
      .from(skillEnablements)
      .where(and(
        eq(skillEnablements.userId, userId),
        eq(skillEnablements.sessionId, sessionId),
        gt(skillEnablements.expiresAt, now),
      ))
      .orderBy(skillEnablements.skillName);
  }

  async isEnabled(
    userId: string,
    sessionId: string,
    skillName: string,
  ): Promise<boolean> {
    validateIdentifiers(userId, sessionId, skillName);
    const now = this.clock();

    const rows = await this.database
      .select({ skillName: skillEnablements.skillName })
      .from(skillEnablements)
      .where(and(
        eq(skillEnablements.userId, userId),
        eq(skillEnablements.sessionId, sessionId),
        eq(skillEnablements.skillName, skillName),
        gt(skillEnablements.expiresAt, now),
      ))
      .limit(1);

    return rows.length > 0;
  }

  async purgeExpired(): Promise<number> {
    const deleted = await this.database
      .delete(skillEnablements)
      .where(lte(skillEnablements.expiresAt, this.clock()))
      .returning({ skillName: skillEnablements.skillName });

    return deleted.length;
  }
}
