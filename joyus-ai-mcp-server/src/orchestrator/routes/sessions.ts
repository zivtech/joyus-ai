/**
 * Session Routes — WP06 (T042)
 *
 * CRUD endpoints for orchestrator session management.
 *
 * Endpoints:
 *   POST   /sessions            — create session
 *   GET    /sessions            — list sessions (tenant-scoped, cursor-paginated)
 *   GET    /sessions/:sessionId — get session details
 *   PATCH  /sessions/:sessionId — update session via action (suspend/resume/stop/kill)
 *
 * Security contract:
 *   - tenantId is NEVER read from the request body or query. Always via getTenantId().
 *   - Sessions not found AND sessions belonging to other tenants both return 404
 *     (prevents cross-tenant ID enumeration).
 *   - InvalidStatusTransitionError returns 409 Conflict.
 */

import { Router } from 'express';

import type { MemoryService } from '../memory.service.js';
import { getTenantId } from '../middleware/tenant.js';
import {
  createSessionRequestSchema,
  updateSessionRequestSchema,
  listSessionsQuerySchema,
  listTurnsQuerySchema,
  SESSION_ACTION_TO_STATUS,
} from '../schemas.js';
import type { SessionService } from '../session.service.js';
import {
  InvalidStatusTransitionError,
  SessionNotFoundError,
} from '../types.js';
import type { UsageService } from '../usage.service.js';

import { apiError, validate } from './helpers.js';

export function createSessionsRouter(
  sessionService: SessionService,
  memoryService?: MemoryService,
  usageService?: UsageService,
): Router {
  const router = Router();

  // ─── POST /sessions ─────────────────────────────────────────────────────────
  router.post('/', async (req, res) => {
    const tenantId = getTenantId(req);

    const parsed = validate(createSessionRequestSchema, req.body, res);
    if (!parsed) return;

    const session = await sessionService.createSession({
      tenantId,
      userId: parsed.userId,
      metadata: parsed.metadata ?? {},
    });

    return res.status(201).json(session);
  });

  // ─── GET /sessions ───────────────────────────────────────────────────────────
  router.get('/', async (req, res) => {
    const tenantId = getTenantId(req);

    const parsed = validate(listSessionsQuerySchema, req.query, res);
    if (!parsed) return;

    const result = await sessionService.listSessions(tenantId, {
      status: parsed.status,
      userId: parsed.userId,
      // parsed.limit always has a value (default: 20 in schema) but TypeScript
      // infers number | undefined for optional-input/required-output fields.
      limit: parsed.limit ?? 20,
      cursor: parsed.cursor,
    });

    return res.json({
      items: result.items,
      cursor: result.cursor,
    });
  });

  // ─── GET /sessions/:sessionId ────────────────────────────────────────────────
  router.get('/:sessionId', async (req, res) => {
    const tenantId = getTenantId(req);
    const { sessionId } = req.params;

    const session = await sessionService.getSession(tenantId, sessionId);
    if (!session) {
      return res.status(404).json(apiError('NOT_FOUND', 'Session not found'));
    }

    const usage = usageService
      ? await usageService.getSessionUsage(tenantId, sessionId)
      : null;

    return res.json({ ...session, ...(usage ? { usage } : {}) });
  });

  // ─── PATCH /sessions/:sessionId ──────────────────────────────────────────────
  // Body: { action: 'suspend' | 'resume' | 'stop' | 'kill' }
  // Maps action → status; state machine is enforced by SessionService.
  router.patch('/:sessionId', async (req, res) => {
    const tenantId = getTenantId(req);
    const { sessionId } = req.params;

    const parsed = validate(updateSessionRequestSchema, req.body, res);
    if (!parsed) return;

    const newStatus = SESSION_ACTION_TO_STATUS[parsed.action];

    try {
      const updated = await sessionService.updateSessionStatus({
        tenantId,
        sessionId,
        newStatus,
      });
      return res.json(updated);
    } catch (err) {
      if (err instanceof SessionNotFoundError) {
        return res.status(404).json(apiError('NOT_FOUND', 'Session not found'));
      }
      if (err instanceof InvalidStatusTransitionError) {
        return res.status(409).json(
          apiError('INVALID_TRANSITION', err.message),
        );
      }
      throw err;
    }
  });

  // ─── GET /sessions/:sessionId/turns ──────────────────────────────────────────
  router.get('/:sessionId/turns', async (req, res) => {
    const tenantId = getTenantId(req);
    const { sessionId } = req.params;

    const session = await sessionService.getSession(tenantId, sessionId);
    if (!session) {
      return res.status(404).json(apiError('NOT_FOUND', 'Session not found'));
    }

    const parsed = validate(listTurnsQuerySchema, req.query, res);
    if (!parsed) return;

    if (!memoryService) {
      return res.status(501).json(apiError('NOT_IMPLEMENTED', 'Memory service not available'));
    }

    const turns = await memoryService.loadHistory(
      sessionId,
      tenantId,
      (parsed.limit ?? 50) + 1,
    );

    const filtered = parsed.after_sequence !== null && parsed.after_sequence !== undefined
      ? turns.filter((t) => t.sequence > parsed.after_sequence!)
      : turns;

    const limit = parsed.limit ?? 50;
    const hasMore = filtered.length > limit;
    const items = filtered.slice(0, limit);

    return res.json({ items, hasMore });
  });

  return router;
}
