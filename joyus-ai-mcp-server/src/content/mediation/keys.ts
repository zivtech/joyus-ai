/**
 * Content Mediation — API Key management service
 *
 * Handles creation, revocation, and listing of integration API keys.
 * Raw keys are never stored — only their SHA-256 hashes.
 */

import crypto from 'node:crypto';

import { createId } from '@paralleldrive/cuid2';
import { eq } from 'drizzle-orm';

import type { DrizzleClient } from '../../db/types.js';
import { contentApiKeys } from '../schema.js';

import { hashApiKey } from './auth.js';

export interface CreateKeyInput {
  integrationName: string;
  jwksUri?: string;
  issuer?: string;
  audience?: string;
}

export type RevokeKeyResult =
  | { status: 'not_found' }
  | { status: 'already_revoked'; key: typeof contentApiKeys.$inferSelect }
  | { status: 'revoked'; key: typeof contentApiKeys.$inferSelect };

export class ApiKeyService {
  constructor(private db: DrizzleClient) {}

  /**
   * Create a new API key for the given tenant.
   * Returns the raw key (shown once) and its database id.
   */
  async createKey(
    tenantId: string,
    input: CreateKeyInput
  ): Promise<{ key: string; id: string; keyPrefix: string }> {
    const rawKey = 'jyk_' + crypto.randomBytes(16).toString('hex');
    const keyHash = hashApiKey(rawKey);
    const keyPrefix = rawKey.substring(0, 8);
    const id = createId();

    await this.db.insert(contentApiKeys).values({
      id,
      tenantId,
      keyHash,
      keyPrefix,
      integrationName: input.integrationName,
      jwksUri: input.jwksUri ?? null,
      issuer: input.issuer ?? null,
      audience: input.audience ?? null,
      isActive: true,
    });

    return { key: rawKey, id, keyPrefix };
  }

  /**
   * Deactivate an API key. Does not delete — preserves audit history.
   */
  async revokeKey(keyId: string): Promise<RevokeKeyResult> {
    const existingRows = await this.db
      .select()
      .from(contentApiKeys)
      .where(eq(contentApiKeys.id, keyId))
      .limit(1);
    const existing = existingRows[0];

    if (!existing) {
      return { status: 'not_found' };
    }

    if (!existing.isActive) {
      return { status: 'already_revoked', key: existing };
    }

    const updatedRows = await this.db
      .update(contentApiKeys)
      .set({ isActive: false })
      .where(eq(contentApiKeys.id, keyId))
      .returning();

    return {
      status: 'revoked',
      key: updatedRows[0] ?? { ...existing, isActive: false },
    };
  }

  /**
   * List all API keys for a tenant (active and inactive).
   */
  async listKeys(tenantId: string): Promise<Array<typeof contentApiKeys.$inferSelect>> {
    return this.db.select().from(contentApiKeys).where(eq(contentApiKeys.tenantId, tenantId));
  }
}
