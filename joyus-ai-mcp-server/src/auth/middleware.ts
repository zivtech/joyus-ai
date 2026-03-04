/**
 * Shared auth middleware
 *
 * Consolidates session and bearer-token checks used across routes.
 * Pattern follows content/mediation/auth.ts — no DB import at module level.
 */

import { Request, Response, NextFunction } from 'express';

import { getUserFromToken, type UserWithConnections } from './verify.js';

// Extend Express.Request to carry the authenticated MCP user
declare global {
  namespace Express {
    interface Request {
      mcpUser?: UserWithConnections;
    }
  }
}

/**
 * Require a valid MCP Bearer token.
 * Checks the Authorization header first, falls back to ?token= query param (for SSE).
 * On success, attaches the user to req.mcpUser.
 */
export async function requireBearerToken(req: Request, res: Response, next: NextFunction): Promise<void> {
  const authHeader = req.headers.authorization;
  let token: string | undefined;

  if (authHeader?.startsWith('Bearer ')) {
    token = authHeader.substring(7);
  } else if (typeof req.query.token === 'string') {
    token = req.query.token;
  }

  if (!token) {
    res.status(401).json({ error: 'Missing or invalid authorization' });
    return;
  }

  const user = await getUserFromToken(token);
  if (!user) {
    res.status(401).json({ error: 'Invalid token' });
    return;
  }

  req.mcpUser = user;
  next();
}

/**
 * Require an active session with userId.
 * Returns 401 JSON — suitable for API routes and form POSTs.
 */
export function requireSession(req: Request, res: Response, next: NextFunction): void {
  if (!req.session?.userId) {
    res.status(401).json({ error: 'Unauthorized' });
    return;
  }
  next();
}

/**
 * Require an active session with userId.
 * Redirects to /auth — suitable for browser UI routes.
 */
export function requireSessionOrRedirect(req: Request, res: Response, next: NextFunction): void {
  if (!req.session?.userId) {
    res.redirect('/auth');
    return;
  }
  next();
}
