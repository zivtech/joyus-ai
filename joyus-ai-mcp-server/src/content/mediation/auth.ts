/**
 * Content Mediation — Two-layer authentication middleware
 *
 * Layer 1: API key validation (X-API-Key header) — identifies the integration/tenant
 * Layer 2: User JWT validation (Authorization: Bearer) — identifies the end user
 */

import { Request, Response, NextFunction } from 'express';
import { eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/node-postgres';
import crypto from 'node:crypto';
import * as jose from 'jose';
import { contentApiKeys } from '../schema.js';

type DrizzleClient = ReturnType<typeof drizzle>;

// Extend Express Request with auth context
declare global {
  namespace Express {
    interface Request {
      apiKeyRecord?: typeof contentApiKeys.$inferSelect;
      userId?: string;
      tenantId?: string;
    }
  }
}

export function hashApiKey(key: string): string {
  return crypto.createHash('sha256').update(key).digest('hex');
}

export function createAuthMiddleware(db: DrizzleClient) {
  return {
    /**
     * Layer 1: Validate X-API-Key header against stored key hashes.
     * Attaches apiKeyRecord and tenantId to req on success.
     */
    validateApiKey: async (req: Request, res: Response, next: NextFunction): Promise<void> => {
      const apiKey = req.headers['x-api-key'] as string | undefined;
      if (!apiKey) {
        res.status(401).json({ error: 'missing_api_key', message: 'X-API-Key header required' });
        return;
      }

      let keyRecord: typeof contentApiKeys.$inferSelect | undefined;
      try {
        const keyHash = hashApiKey(apiKey);
        const rows = await db
          .select()
          .from(contentApiKeys)
          .where(eq(contentApiKeys.keyHash, keyHash))
          .limit(1);
        keyRecord = rows[0];
      } catch {
        // Fail closed: auth lookup error must never allow request flow.
        res.status(503).json({
          error: 'auth_service_unavailable',
          message: 'API key validation service unavailable',
        });
        return;
      }

      if (!keyRecord || !keyRecord.isActive) {
        res.status(401).json({ error: 'invalid_api_key', message: 'Invalid or inactive API key' });
        return;
      }

      req.apiKeyRecord = keyRecord;
      req.tenantId = keyRecord.tenantId;

      // Update lastUsedAt — fire and forget, non-blocking
      db.update(contentApiKeys)
        .set({ lastUsedAt: new Date() })
        .where(eq(contentApiKeys.id, keyRecord.id))
        .catch(() => {});

      next();
    },

    /**
     * Layer 2: Validate Authorization: Bearer JWT against the JWKS URI
     * stored on the API key record. Must run after validateApiKey.
     */
    validateUserToken: async (req: Request, res: Response, next: NextFunction): Promise<void> => {
      const authHeader = req.headers.authorization;
      if (!authHeader?.startsWith('Bearer ')) {
        res.status(401).json({
          error: 'missing_user_token',
          message: 'Authorization: Bearer <token> required',
        });
        return;
      }

      const token = authHeader.substring(7);
      const apiKeyRecord = req.apiKeyRecord;
      if (!apiKeyRecord) {
        res.status(401).json({
          error: 'missing_api_key',
          message: 'API key validation must precede user token validation',
        });
        return;
      }

      const { jwksUri, issuer, audience } = apiKeyRecord;
      if (!jwksUri) {
        res.status(401).json({
          error: 'invalid_configuration',
          message: 'JWKS URI not configured for this API key',
        });
        return;
      }

      try {
        const JWKS = jose.createRemoteJWKSet(new URL(jwksUri));
        const { payload } = await jose.jwtVerify(token, JWKS, {
          ...(issuer ? { issuer } : {}),
          ...(audience ? { audience } : {}),
        });

        if (typeof payload.sub !== 'string' || payload.sub.length === 0) {
          res.status(401).json({ error: 'invalid_user_token', message: 'Invalid user token subject' });
          return;
        }

        req.userId = payload.sub;
        next();
      } catch (err) {
        if (err instanceof jose.errors.JWTExpired) {
          res.status(401).json({ error: 'token_expired', message: 'User token has expired' });
          return;
        }
        res.status(401).json({ error: 'invalid_user_token', message: 'Invalid user token' });
      }
    },
  };
}
