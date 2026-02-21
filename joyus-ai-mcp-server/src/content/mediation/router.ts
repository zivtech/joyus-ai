/**
 * Content Mediation — Express router
 *
 * All routes under /content/mediate use two-layer auth:
 *   1. X-API-Key header (identifies integration/tenant)
 *   2. Authorization: Bearer JWT (identifies end user)
 *
 * Additional routes will be added in subsequent work packages.
 */

import { Router } from 'express';
import { drizzle } from 'drizzle-orm/node-postgres';
import { createAuthMiddleware } from './auth.js';

type DrizzleClient = ReturnType<typeof drizzle>;

export function createMediationRouter(db: DrizzleClient): Router {
  const router = Router();
  const { validateApiKey, validateUserToken } = createAuthMiddleware(db);

  // Health check — no auth required
  router.get('/health', (_req, res) => {
    res.json({ status: 'ok' });
  });

  // Apply two-layer auth to all subsequent routes
  router.use(validateApiKey, validateUserToken);

  // Additional mediation routes will be mounted here in WP09+

  return router;
}
