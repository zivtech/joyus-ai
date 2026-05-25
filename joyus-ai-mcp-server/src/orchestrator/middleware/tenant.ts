/**
 * Tenant Scoping Middleware — WP01
 *
 * Resolves tenantId from the authenticated MCP user and attaches it to the
 * request object for use by all orchestrator handlers.
 *
 * This middleware MUST run after requireBearerToken (from src/auth/middleware.ts),
 * which populates req.mcpUser.
 *
 * tenantId derivation:
 *   Shared tenancy resolver first checks the user's default membership.
 *   If no membership is present, it falls back to the historical userId ==
 *   tenantId behavior for backward compatibility.
 *
 * Security contract:
 *   tenantId is never read from the request body, query params, or custom
 *   headers for orchestrator routes. It is derived from the verified auth
 *   context and tenant membership state.
 */

import { Request, Response, NextFunction } from 'express';

import type { UserWithConnections } from '../../auth/verify.js';
import { db } from '../../db/client.js';
import { resolveTenantContext, sendTenantResolutionError } from '../../tenancy/resolver.js';
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

  resolveTenantContext(req, {
    db,
    lookupDefaultTenant: true,
  })
    .then(() => next())
    .catch((error) => sendTenantResolutionError(res, error));
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
