/**
 * Tenant Scoping Middleware — WP01
 *
 * Extracts tenantId from the authenticated MCP user and attaches it
 * to the request object for use by all orchestrator handlers.
 *
 * This middleware MUST run after requireBearerToken (from src/auth/middleware.ts),
 * which populates req.mcpUser.
 *
 * tenantId derivation:
 *   In the current single-tenant world, tenantId == userId (req.mcpUser.id).
 *   This is consistent with the comment in src/tools/executor.ts:
 *     "tenant resolution deferred to WP12; use userId as tenantId for now"
 *   When multi-tenancy ships, this file is the single place to update.
 *
 * Security contract:
 *   tenantId is NEVER read from the request body, query params, or custom headers.
 *   It is derived ONLY from the verified auth context (req.mcpUser), which was
 *   validated against the database by the upstream bearer-token middleware.
 */

import { Request, Response, NextFunction } from 'express';

import type { UserWithConnections } from '../../auth/verify.js';
import { MissingTenantError } from '../types.js';

// ============================================================
// TYPE EXTENSION
// ============================================================

// Extend Express.Request to carry the resolved tenant ID
declare global {
  namespace Express {
    interface Request {
      tenantId?: string;
    }
  }
}

// ============================================================
// MIDDLEWARE
// ============================================================

/**
 * Resolve and attach tenantId to the request.
 * Returns 401 if the upstream auth middleware did not populate req.mcpUser.
 *
 * Usage:
 *   router.use(requireBearerToken);
 *   router.use(resolveTenantId);
 *   router.get('/sessions', listSessionsHandler);
 */
export function resolveTenantId(req: Request, res: Response, next: NextFunction): void {
  const user = req.mcpUser as UserWithConnections | undefined;

  if (!user?.id) {
    res.status(401).json({
      error: 'Unauthorized',
      message: 'Authentication required to access orchestrator resources',
    });
    return;
  }

  // tenantId = userId until multi-tenant resolution is implemented (WP12)
  req.tenantId = user.id;
  next();
}

// ============================================================
// TYPED HELPER
// ============================================================

/**
 * Extract the validated tenantId from a request.
 * Throws MissingTenantError if the middleware chain was not set up correctly.
 * Use this in route handlers instead of accessing req.tenantId directly.
 *
 * @example
 *   const tenantId = getTenantId(req);
 *   const session = await sessionService.getSession(tenantId, sessionId);
 */
export function getTenantId(req: Request): string {
  if (!req.tenantId) {
    throw new MissingTenantError();
  }
  return req.tenantId;
}
