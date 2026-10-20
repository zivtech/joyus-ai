/**
 * Token introspection
 *
 * POST /auth/introspect lets a separate service that verifies bearer tokens
 * ask this server whether a user's MCP token is valid, without that service
 * needing read access to users.mcp_token.
 *
 * Contract:
 *   Request   Authorization: Bearer <INTROSPECTION_SERVICE_TOKEN>
 *             { "token": "<user bearer token>" }
 *   Response  200 { "active": true, "userId", "email", "defaultTenantId" | null }
 *             200 { "active": false }
 *             400 invalid body, 401 missing/wrong service token,
 *             404 route disabled (INTROSPECTION_SERVICE_TOKEN unset or empty),
 *             429 rate limited, 500 lookup failed.
 *
 * Every response carries Cache-Control: no-store. The user token is never
 * echoed or logged; only the outcome and, for active tokens, the user id are.
 */

import crypto from 'node:crypto';

import { and, eq } from 'drizzle-orm';
import { Router, type NextFunction, type Request, type Response } from 'express';
import rateLimit from 'express-rate-limit';
import { z } from 'zod';

import { db, users, tenantMemberships } from '../db/client.js';

const SERVICE_TOKEN_ENV = 'INTROSPECTION_SERVICE_TOKEN';
const MAX_TOKEN_LENGTH = 4096;

/**
 * Requests allowed per minute for the authenticated service caller. One
 * desktop poll per user every 30-60 s means this covers roughly 1,500 users
 * polling every 30 s. The bucket is keyed by the service token, so it is one
 * shared budget no matter how many addresses the caller connects from.
 */
export const INTROSPECT_RATE_LIMIT_PER_MINUTE = 3000;
const RATE_LIMIT_WINDOW_MS = 60_000;

const bodySchema = z.object({
  token: z.string().min(1).max(MAX_TOKEN_LENGTH),
});

function sha256(value: string): Buffer {
  return crypto.createHash('sha256').update(value).digest();
}

/** Configured service token, or null when the route is disabled. */
function getConfiguredServiceToken(): string | null {
  const configured = process.env[SERVICE_TOKEN_ENV];
  if (configured === undefined || configured.trim() === '') return null;
  return configured;
}

function extractBearer(header: string | undefined): string | null {
  if (!header?.startsWith('Bearer ')) return null;
  const value = header.substring(7);
  return value === '' ? null : value;
}

function setNoStore(res: Response): void {
  res.setHeader('Cache-Control', 'no-store');
}

/** Log an outcome. Never pass a token here. */
function audit(outcome: string, userId?: string): void {
  console.log(`[auth] token introspection: outcome=${outcome}${userId ? ` userId=${userId}` : ''}`);
}

/**
 * Identify a failure without logging its message: database driver errors can
 * embed the query parameters, which include the token being looked up.
 */
function describeError(error: unknown): string {
  if (!(error instanceof Error)) return 'unknown';
  const withCode = error as Error & { code?: string; cause?: { code?: string } };
  const code = withCode.code ?? withCode.cause?.code;
  return code ? `${error.name} ${code}` : error.name;
}

/** Disabled routes answer 404 so an unconfigured deployment exposes nothing to probe. */
function requireEnabled(_req: Request, res: Response, next: NextFunction): void {
  if (getConfiguredServiceToken() === null) {
    res.status(404).json({ error: 'not_found' });
    return;
  }
  next();
}

/**
 * Compare the presented service token with the configured one in constant
 * time: both sides are hashed first so the buffers are always the same length.
 * Stores a digest of the caller's token as the rate-limit key.
 */
function requireServiceToken(req: Request, res: Response, next: NextFunction): void {
  const configured = getConfiguredServiceToken();
  if (configured === null) {
    res.status(404).json({ error: 'not_found' });
    return;
  }

  const presented = extractBearer(req.headers.authorization);
  const presentedDigest = sha256(presented ?? '');
  const matches = crypto.timingSafeEqual(presentedDigest, sha256(configured));

  if (presented === null || !matches) {
    audit('unauthenticated');
    res.status(401).json({ error: 'unauthenticated' });
    return;
  }

  res.locals.introspectCallerKey = presentedDigest.toString('hex');
  next();
}

const limiter = rateLimit({
  windowMs: RATE_LIMIT_WINDOW_MS,
  limit: INTROSPECT_RATE_LIMIT_PER_MINUTE,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  // Runs after requireServiceToken, so the key is always set for real callers.
  keyGenerator: (_req, res) => String(res.locals.introspectCallerKey),
  handler: (_req, res) => {
    audit('rate_limited');
    res.status(429).json({ error: 'rate_limited' });
  },
});

async function introspect(req: Request, res: Response): Promise<void> {
  const parsed = bodySchema.safeParse(req.body);
  if (!parsed.success) {
    audit('bad_request');
    res.status(400).json({ error: 'bad_request' });
    return;
  }

  try {
    const [user] = await db
      .select({ id: users.id, email: users.email })
      .from(users)
      .where(eq(users.mcpToken, parsed.data.token))
      .limit(1);

    if (!user) {
      audit('inactive');
      res.status(200).json({ active: false });
      return;
    }

    const [defaultMembership] = await db
      .select({ tenantId: tenantMemberships.tenantId })
      .from(tenantMemberships)
      .where(and(eq(tenantMemberships.userId, user.id), eq(tenantMemberships.isDefault, true)))
      .limit(1);

    audit('active', user.id);
    res.status(200).json({
      active: true,
      userId: user.id,
      email: user.email,
      defaultTenantId: defaultMembership?.tenantId ?? null,
    });
  } catch (error: unknown) {
    // A failed lookup must not read as "token revoked", so it is a 500, not active:false.
    console.error(`[auth] token introspection: outcome=error cause=${describeError(error)}`);
    res.status(500).json({ error: 'internal_error' });
  }
}

export const introspectRouter = Router();

// Every response from this route, including rejections, is uncacheable.
introspectRouter.use((_req, res, next) => {
  setNoStore(res);
  next();
});

introspectRouter.post('/', requireEnabled, requireServiceToken, limiter, introspect);

/**
 * Error handler for body-parser failures (malformed JSON, oversized body).
 * Mount it after the router, at the same path. express.json() runs before the
 * router, so without this the app-wide handler would answer 500 and log the
 * parser's message, which can quote part of the request body.
 */
export function introspectBodyErrorHandler(
  err: unknown,
  req: Request,
  res: Response,
  next: NextFunction,
): void {
  const status = (err as { status?: unknown } | null)?.status;
  if (typeof status !== 'number' || status < 400 || status >= 500) {
    next(err);
    return;
  }

  setNoStore(res);
  requireEnabled(req, res, () => {
    requireServiceToken(req, res, () => {
      audit('bad_request');
      res.status(status === 413 ? 413 : 400).json({ error: 'bad_request' });
    });
  });
}
