/**
 * Content Mediation — Express router with full endpoint handlers
 *
 * All routes under /content/mediate use two-layer auth:
 *   1. X-API-Key header (identifies integration/tenant)
 *   2. Authorization: Bearer JWT (identifies end user)
 *
 * Routes:
 *   GET    /health                          — health check (no auth)
 *   POST   /sessions                        — create session
 *   GET    /sessions/:sessionId             — get session
 *   DELETE /sessions/:sessionId             — close session
 *   POST   /sessions/:sessionId/messages    — send message, get response
 */

import { Router, type Request, type Response } from 'express';
import { drizzle } from 'drizzle-orm/node-postgres';
import { createAuthMiddleware } from './auth.js';
import { MediationSessionService } from './session.js';
import { ProfileAccessDeniedError } from '../profiles/access.js';
import type { GenerationService } from '../generation/index.js';
import type { EntitlementService } from '../entitlements/index.js';
import type { EntitlementCache } from '../entitlements/cache.js';

type DrizzleClient = ReturnType<typeof drizzle>;

export interface MediationDependencies {
  db: DrizzleClient;
  generationService: GenerationService;
  entitlementService: EntitlementService;
  entitlementCache: EntitlementCache;
}

type SessionRecord = Awaited<ReturnType<MediationSessionService['getSession']>>;

export function isSessionAccessible(
  session: SessionRecord,
  userId: string,
  tenantId: string,
): session is NonNullable<SessionRecord> {
  if (!session || session.endedAt) return false;
  return session.userId === userId && session.tenantId === tenantId;
}

export function createMediationRouter(deps: MediationDependencies): Router {
  const router = Router();
  const { db, generationService, entitlementService, entitlementCache } = deps;
  const { validateApiKey, validateUserToken } = createAuthMiddleware(db);
  const sessionService = new MediationSessionService(db);

  // Health check — no auth required
  router.get('/health', (_req, res) => {
    res.json({ status: 'ok' });
  });

  // Apply two-layer auth to all subsequent routes
  router.use(validateApiKey, validateUserToken);

  // POST /sessions — create a new mediation session
  router.post('/sessions', async (req: Request, res: Response): Promise<void> => {
    try {
      const profileId = req.body?.profileId as string | undefined;
      const result = await sessionService.createSession(
        req.tenantId!,
        req.apiKeyRecord!.id,
        req.userId!,
        profileId,
      );
      res.status(201).json(result);
    } catch (err) {
      res.status(500).json({ error: 'internal_error', message: 'Failed to create session' });
    }
  });

  // POST /sessions/:sessionId/messages — send a message and get a generated response
  router.post('/sessions/:sessionId/messages', async (req: Request, res: Response): Promise<void> => {
    try {
      const { sessionId } = req.params;
      const body = req.body as { message?: string; maxSources?: number };
      const { message, maxSources } = body;

      if (!message) {
        res.status(400).json({ error: 'missing_message', message: 'message field is required' });
        return;
      }

      // Validate session exists, belongs to this user, and is not closed
      const session = await sessionService.getSession(sessionId);
      if (!isSessionAccessible(session, req.userId!, req.tenantId!)) {
        res.status(404).json({ error: 'session_not_found', message: 'Session not found or already closed' });
        return;
      }

      // Resolve entitlements for this session
      const entitlements = await entitlementService.resolve(
        req.userId!,
        req.tenantId!,
        { sessionId, integrationId: req.apiKeyRecord!.id },
      );

      // Generate response with content retrieval
      const result = await generationService.generate(
        message,
        req.userId!,
        req.tenantId!,
        entitlements,
        {
          profileId: session.activeProfileId ?? undefined,
          maxSources,
          sessionId,
        },
      );

      // Increment message counter
      await sessionService.incrementMessageCount(sessionId);

      res.json({
        message: result.text,
        citations: result.citations,
        profileUsed: result.profileUsed,
        metadata: {
          sourcesSearched: result.metadata.totalSearchResults,
          sourcesUsed: result.metadata.sourcesUsed,
          responseTime: result.metadata.durationMs,
        },
      });
    } catch (err) {
      if (err instanceof ProfileAccessDeniedError) {
        res.status(403).json({
          error: 'profile_access_denied',
          message: 'Active profile is not accessible for this tenant/session',
        });
        return;
      }
      console.error('[mediation] message processing failed', err);
      res.status(500).json({ error: 'internal_error', message: 'Failed to process message' });
    }
  });

  // GET /sessions/:sessionId — retrieve session details
  router.get('/sessions/:sessionId', async (req: Request, res: Response): Promise<void> => {
    try {
      const session = await sessionService.getSession(req.params.sessionId);
      if (!isSessionAccessible(session, req.userId!, req.tenantId!)) {
        res.status(404).json({ error: 'session_not_found', message: 'Session not found' });
        return;
      }
      res.json(session);
    } catch (err) {
      res.status(500).json({ error: 'internal_error', message: 'Failed to retrieve session' });
    }
  });

  // DELETE /sessions/:sessionId — close a session
  router.delete('/sessions/:sessionId', async (req: Request, res: Response): Promise<void> => {
    try {
      const session = await sessionService.getSession(req.params.sessionId);
      if (!isSessionAccessible(session, req.userId!, req.tenantId!)) {
        res.status(404).json({ error: 'session_not_found', message: 'Session not found' });
        return;
      }
      await sessionService.closeSession(req.params.sessionId);
      entitlementCache.invalidate(req.params.sessionId);
      res.status(204).send();
    } catch (err) {
      res.status(500).json({ error: 'internal_error', message: 'Failed to close session' });
    }
  });

  return router;
}
