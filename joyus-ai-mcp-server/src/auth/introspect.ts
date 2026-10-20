/**
 * Token introspection for the private policy service (spec 016 FR-01).
 *
 * The policy service's database role has no grant on `users.mcp_token`, so it
 * asks this route whether a desktop or admin bearer is active. Protected by
 * `POLICY_INTROSPECTION_TOKEN`; the user's token travels in the body, never in
 * the URL, and is never logged or echoed.
 */

import { timingSafeEqual } from 'node:crypto';

import { eq, and } from 'drizzle-orm';
import type { Request, Response } from 'express';

import { db } from '../db/client.js';
import { tenantMemberships, users } from '../db/schema.js';

export interface IntrospectionResult {
  active: boolean;
  userId?: string;
  email?: string;
  defaultTenantId?: string | null;
}

export interface IntrospectDeps {
  serviceToken: string | undefined;
  lookup: (token: string) => Promise<IntrospectionResult>;
}

function sameToken(given: string, expected: string): boolean {
  const a = Buffer.from(given);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

/** Database-backed lookup: active when a user holds the token; includes the default tenant. */
export async function lookupToken(token: string): Promise<IntrospectionResult> {
  const [user] = await db.select({ id: users.id, email: users.email }).from(users).where(eq(users.mcpToken, token)).limit(1);
  if (!user) return { active: false };
  const [membership] = await db
    .select({ tenantId: tenantMemberships.tenantId })
    .from(tenantMemberships)
    .where(and(eq(tenantMemberships.userId, user.id), eq(tenantMemberships.isDefault, true)))
    .limit(1);
  return { active: true, userId: user.id, email: user.email, defaultTenantId: membership?.tenantId ?? null };
}

/** `POST /auth/introspect` `{ token }` → `200 { active, userId, email, defaultTenantId }` or `200 { active: false }`. */
export function createIntrospectHandler(deps: IntrospectDeps) {
  return async (req: Request, res: Response): Promise<void> => {
    const header = req.headers.authorization;
    const given = header?.startsWith('Bearer ') ? header.substring(7) : undefined;
    if (!deps.serviceToken || !given || !sameToken(given, deps.serviceToken)) {
      res.status(deps.serviceToken ? 401 : 404).json({ error: deps.serviceToken ? 'unauthenticated' : 'not_configured' });
      return;
    }
    const token = (req.body as { token?: unknown } | undefined)?.token;
    if (typeof token !== 'string' || token.length === 0 || token.length > 4096) {
      res.status(400).json({ error: 'invalid_request' });
      return;
    }
    try {
      const result = await deps.lookup(token);
      res.set('Cache-Control', 'no-store');
      res.status(200).json(result);
    } catch (error) {
      console.error('[introspect] lookup failed', error instanceof Error ? error.name : '');
      res.status(503).json({ error: 'unavailable' });
    }
  };
}
