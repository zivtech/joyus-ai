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

import { createId } from '@paralleldrive/cuid2';
import { Router, type Request, type Response } from 'express';

import type { DrizzleClient } from '../../db/types.js';
import type { EntitlementCache } from '../entitlements/cache.js';
import type { EntitlementService } from '../entitlements/index.js';
import type { GenerationService } from '../generation/index.js';
import { contentOperationLogs } from '../schema.js';
import type { ActionProposal, JudgeOutcome, JudgeResult } from '../types.js';

import { createAuthMiddleware } from './auth.js';
import {
  DeterministicMediationJudgeService,
  createMediationResponseProposal,
  type MediationJudgeService,
} from './judge.js';
import { MediationSessionService } from './session.js';

export interface MediationDependencies {
  db: DrizzleClient;
  generationService: GenerationService;
  entitlementService: EntitlementService;
  entitlementCache: EntitlementCache;
  judgeService?: MediationJudgeService;
  sessionService?: Pick<
    MediationSessionService,
    'createSession' | 'getSession' | 'incrementMessageCount' | 'closeSession'
  >;
}

function requestIdFrom(req: Request): string {
  const header = req.headers['x-request-id'];
  if (typeof header === 'string' && header.length > 0) return header;
  if (Array.isArray(header) && header[0]) return header[0];
  return createId();
}

export function sessionMatchesRequestContext(
  session: { userId: string; tenantId: string; apiKeyId: string },
  req: { userId?: string; tenantId?: string; apiKeyRecord?: { id: string } },
): boolean {
  return (
    session.userId === req.userId &&
    session.tenantId === req.tenantId &&
    session.apiKeyId === req.apiKeyRecord?.id
  );
}

function logMediationEvent(
  level: 'info' | 'error',
  event: string,
  req: Request,
  details: Record<string, unknown>,
): void {
  const payload = {
    level,
    event,
    requestId: requestIdFrom(req),
    tenantId: req.tenantId ?? null,
    sessionId: typeof details.sessionId === 'string' ? details.sessionId : null,
    profileId: typeof details.profileId === 'string' ? details.profileId : null,
    userId: req.userId ?? null,
    ...details,
    timestamp: new Date().toISOString(),
  };

  const serialized = JSON.stringify(payload);
  if (level === 'error') {
    console.error(serialized);
    return;
  }
  console.info(serialized);
}

function statusForJudgeOutcome(outcome: JudgeOutcome): number {
  if (outcome === 'block') return 403;
  if (outcome === 'revise') return 409;
  if (outcome === 'escalate') return 202;
  return 200;
}

function judgeResponseBody(judgment: JudgeResult): Record<string, unknown> {
  return {
    error: `judge_${judgment.outcome}`,
    message: judgment.summary,
    judgment: {
      id: judgment.id,
      outcome: judgment.outcome,
      reasonCode: judgment.reasonCode,
      policyVersion: judgment.policyVersion,
      criteria: judgment.criteria,
      requiredRevision: judgment.requiredRevision,
      escalation: judgment.escalation,
    },
  };
}

async function logJudgmentAudit(
  db: DrizzleClient,
  proposal: ActionProposal,
  judgment: JudgeResult,
  durationMs: number,
): Promise<void> {
  await db.insert(contentOperationLogs).values({
    id: createId(),
    tenantId: proposal.context.tenantId,
    operation: 'mediate',
    userId: proposal.context.userId,
    sessionId: proposal.context.sessionId ?? null,
    durationMs,
    success: judgment.outcome === 'allow',
    metadata: {
      event: 'mediation.judge.evaluated',
      requestId: proposal.context.requestId ?? null,
      boundary: proposal.action.type,
      proposal,
      judgment,
      enforcement: {
        executed: judgment.outcome === 'allow',
        outcome: judgment.outcome,
      },
    },
  });
}

export function createMediationRouter(deps: MediationDependencies): Router {
  const router = Router();
  const { db, generationService, entitlementService, entitlementCache } = deps;
  const { validateApiKey, validateUserToken } = createAuthMiddleware(db);
  const judgeService = deps.judgeService ?? new DeterministicMediationJudgeService();
  const sessionService = deps.sessionService ?? new MediationSessionService(db);

  // Health check — no auth required
  router.get('/health', (_req, res) => {
    res.json({ status: 'ok' });
  });

  // Apply two-layer auth to all subsequent routes
  router.use(validateApiKey, validateUserToken);

  // POST /sessions — create a new mediation session
  router.post('/sessions', async (req: Request, res: Response): Promise<void> => {
    const requestId = requestIdFrom(req);
    try {
      const profileId = req.body?.profileId as string | undefined;
      const result = await sessionService.createSession(
        req.tenantId!,
        req.apiKeyRecord!.id,
        req.userId!,
        profileId,
      );
      logMediationEvent('info', 'mediation.session.created', req, {
        requestId,
        sessionId: result.sessionId,
        profileId: result.activeProfileId,
      });
      res.status(201).json(result);
    } catch (err: unknown) {
      logMediationEvent('error', 'mediation.session.create_failed', req, {
        requestId,
        profileId: req.body?.profileId ?? null,
        error: err instanceof Error ? err.message : String(err),
      });
      res.status(500).json({ error: 'internal_error', message: 'Failed to create session' });
    }
  });

  // POST /sessions/:sessionId/messages — send a message and get a generated response
  router.post('/sessions/:sessionId/messages', async (req: Request, res: Response): Promise<void> => {
    const requestId = requestIdFrom(req);
    const startedAt = Date.now();
    try {
      const { sessionId } = req.params;
      const body = req.body as { message?: string; maxSources?: number };
      const { message, maxSources } = body;

      if (!message) {
        logMediationEvent('error', 'mediation.message.validation_failed', req, {
          requestId,
          sessionId,
          profileId: null,
          reason: 'missing_message',
        });
        res.status(400).json({ error: 'missing_message', message: 'message field is required' });
        return;
      }

      // Validate session exists, belongs to this user, and is not closed
      const session = await sessionService.getSession(sessionId);
      if (!session || session.endedAt) {
        logMediationEvent('error', 'mediation.message.session_not_found', req, {
          requestId,
          sessionId,
          profileId: null,
        });
        res.status(404).json({ error: 'session_not_found', message: 'Session not found or already closed' });
        return;
      }
      if (!sessionMatchesRequestContext(session, req)) {
        logMediationEvent('error', 'mediation.message.session_forbidden', req, {
          requestId,
          sessionId,
          profileId: session.activeProfileId,
        });
        res.status(404).json({ error: 'session_not_found', message: 'Session not found' });
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

      const proposal = createMediationResponseProposal({
        requestId,
        tenantId: req.tenantId!,
        userId: req.userId!,
        apiKeyId: req.apiKeyRecord!.id,
        sessionId,
        profileId: session.activeProfileId,
        entitlements,
        generationResult: result,
      });
      const judgment = await judgeService.judge(proposal);
      await logJudgmentAudit(db, proposal, judgment, Date.now() - startedAt);

      if (judgment.outcome !== 'allow') {
        logMediationEvent('info', 'mediation.message.judge_halted', req, {
          requestId,
          sessionId,
          profileId: session.activeProfileId,
          durationMs: Date.now() - startedAt,
          outcome: judgment.outcome,
          reasonCode: judgment.reasonCode,
        });
        res.status(statusForJudgeOutcome(judgment.outcome)).json(judgeResponseBody(judgment));
        return;
      }

      // Increment message counter
      await sessionService.incrementMessageCount(sessionId);

      logMediationEvent('info', 'mediation.message.completed', req, {
        requestId,
        sessionId,
        profileId: session.activeProfileId,
        durationMs: Date.now() - startedAt,
        citations: result.citations.length,
        judgmentId: judgment.id,
      });

      res.json({
        message: result.text,
        citations: result.citations,
        profileUsed: result.profileUsed,
        metadata: {
          sourcesSearched: result.metadata.totalSearchResults,
          sourcesUsed: result.metadata.sourcesUsed,
          responseTime: result.metadata.durationMs,
          judgment: {
            id: judgment.id,
            outcome: judgment.outcome,
            policyVersion: judgment.policyVersion,
          },
        },
      });
    } catch (err: unknown) {
      logMediationEvent('error', 'mediation.message.failed', req, {
        requestId,
        sessionId: req.params.sessionId,
        profileId: null,
        error: err instanceof Error ? err.message : String(err),
        durationMs: Date.now() - startedAt,
      });
      res.status(500).json({ error: 'internal_error', message: 'Failed to process message' });
    }
  });

  // GET /sessions/:sessionId — retrieve session details
  router.get('/sessions/:sessionId', async (req: Request, res: Response): Promise<void> => {
    const requestId = requestIdFrom(req);
    try {
      const session = await sessionService.getSession(req.params.sessionId);
      if (!session || !sessionMatchesRequestContext(session, req)) {
        logMediationEvent('error', 'mediation.session.lookup_forbidden', req, {
          requestId,
          sessionId: req.params.sessionId,
          profileId: session?.activeProfileId ?? null,
        });
        res.status(404).json({ error: 'session_not_found', message: 'Session not found' });
        return;
      }
      logMediationEvent('info', 'mediation.session.lookup', req, {
        requestId,
        sessionId: session.id,
        profileId: session.activeProfileId,
      });
      res.json(session);
    } catch (err: unknown) {
      logMediationEvent('error', 'mediation.session.lookup_failed', req, {
        requestId,
        sessionId: req.params.sessionId,
        profileId: null,
        error: err instanceof Error ? err.message : String(err),
      });
      res.status(500).json({ error: 'internal_error', message: 'Failed to retrieve session' });
    }
  });

  // DELETE /sessions/:sessionId — close a session
  router.delete('/sessions/:sessionId', async (req: Request, res: Response): Promise<void> => {
    const requestId = requestIdFrom(req);
    try {
      const session = await sessionService.getSession(req.params.sessionId);
      if (!session || !sessionMatchesRequestContext(session, req)) {
        logMediationEvent('error', 'mediation.session.close_forbidden', req, {
          requestId,
          sessionId: req.params.sessionId,
          profileId: session?.activeProfileId ?? null,
        });
        res.status(404).json({ error: 'session_not_found', message: 'Session not found' });
        return;
      }
      await sessionService.closeSession(req.params.sessionId);
      entitlementCache.invalidate(req.params.sessionId);
      logMediationEvent('info', 'mediation.session.closed', req, {
        requestId,
        sessionId: req.params.sessionId,
        profileId: session.activeProfileId,
      });
      res.status(204).send();
    } catch (err: unknown) {
      logMediationEvent('error', 'mediation.session.close_failed', req, {
        requestId,
        sessionId: req.params.sessionId,
        profileId: null,
        error: err instanceof Error ? err.message : String(err),
      });
      res.status(500).json({ error: 'internal_error', message: 'Failed to close session' });
    }
  });

  return router;
}
