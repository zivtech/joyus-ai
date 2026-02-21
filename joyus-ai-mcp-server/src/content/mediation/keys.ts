/**
 * Content Mediation — API Key management service
 *
 * Handles creation, revocation, and listing of integration API keys.
 * Raw keys are never stored — only their SHA-256 hashes.
 */

import crypto from 'node:crypto';
import { eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/node-postgres';
import { createId } from '@paralleldrive/cuid2';
import { contentApiKeys } from '../schema.js';
import { hashApiKey } from './auth.js';

type DrizzleClient = ReturnType<typeof drizzle>;

export interface CreateKeyInput {
  integrationName: string;
  jwksUri?: string;
  issuer?: string;
  audience?: string;
}

export class ApiKeyService {
  constructor(private db: DrizzleClient) {}

  /**
   * Create a new API key for the given tenant.
   * Returns the raw key (shown once) and its database id.
   */
  async createKey(
    tenantId: string,
    input: CreateKeyInput,
  ): Promise<{ key: string; id: string }> {
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

    return { key: rawKey, id };
  }

  /**
   * Deactivate an API key. Does not delete — preserves audit history.
   */
  async revokeKey(keyId: string): Promise<void> {
    await this.db
      .update(contentApiKeys)
      .set({ isActive: false })
      .where(eq(contentApiKeys.id, keyId));
  }

  /**
   * List all API keys for a tenant (active and inactive).
   */
  async listKeys(tenantId: string): Promise<Array<typeof contentApiKeys.$inferSelect>> {
    return this.db
      .select()
      .from(contentApiKeys)
      .where(eq(contentApiKeys.tenantId, tenantId));
  }
}
