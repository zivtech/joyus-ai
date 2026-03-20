/**
 * Event Adapter — Activity Log Routes (WP09)
 *
 * Endpoints for querying event history and replaying failed events:
 *   GET  /events          — paginated event query with filters (T046)
 *   POST /events/:id/replay — replay a failed or dead-lettered event (T047)
 *
 * Tenant context: resolved from x-tenant-id header.
 * Payload and headers are NOT returned in list responses (can be large).
 * Cross-tenant access returns 404, not 403.
 */

import { Router, type Request, type Response } from 'express';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';

import { EventQueryInput } from '../validation.js';
import { queryEvents, getEventById, replayEvent } from '../services/event-buffer.js';
import type { WebhookEvent } from '../schema.js';

// ============================================================
// TYPES
// ============================================================

export interface EventsRouterDeps {
  db: NodePgDatabase<Record<string, unknown>>;
}

/**
 * Public-safe event shape — excludes payload and headers to avoid large responses.
 */
interface EventSummary {
  id: string;
  tenantId: string;
  sourceType: string;
  sourceId: string | null;
  scheduleId: string | null;
  status: string;
  triggerType: string | null;
  pipelineId: string | null;
  attemptCount: number;
  failureReason: string | null;
  processingDurationMs: number | null;
  signatureValid: boolean | null;
  createdAt: Date;
  updatedAt: Date;
  deliveredAt: Date | null;
}

// ============================================================
// HELPERS
// ============================================================

/**
 * Resolve tenant id from request. Reads x-tenant-id header.
 * Returns null if the header is missing.
 */
function resolveTenantId(req: Request): string | null {
  const header = req.headers['x-tenant-id'];
  if (Array.isArray(header)) return header[0] ?? null;
  return header ?? null;
}

/**
 * Strip payload and headers from an event row before returning in a list response.
 */
function toEventSummary(event: WebhookEvent): EventSummary {
  return {
    id: event.id,
    tenantId: event.tenantId,
    sourceType: event.sourceType,
    sourceId: event.sourceId,
    scheduleId: event.scheduleId,
    status: event.status,
    triggerType: event.triggerType,
    pipelineId: event.pipelineId,
    attemptCount: event.attemptCount,
    failureReason: event.failureReason,
    processingDurationMs: event.processingDurationMs,
    signatureValid: event.signatureValid,
    createdAt: event.createdAt,
    updatedAt: event.updatedAt,
    deliveredAt: event.deliveredAt,
  };
}

// ============================================================
// ROUTE FACTORY
// ============================================================

export function createEventsRouter(deps: EventsRouterDeps): Router {
  const router = Router();

  // GET /events — paginated activity log
  router.get('/events', listEventsHandler(deps));

  // POST /events/:id/replay — replay failed or dead-lettered event
  router.post('/events/:id/replay', replayEventHandler(deps));

  return router;
}

// ============================================================
// T046: LIST EVENTS
// ============================================================

function listEventsHandler(deps: EventsRouterDeps) {
  return async (req: Request, res: Response): Promise<void> => {
    const tenantId = resolveTenantId(req);

    // Parse and coerce query params
    const rawQuery = {
      status: req.query['status'],
      sourceType: req.query['source_type'],
      sourceId: req.query['source_id'],
      from: req.query['from'],
      to: req.query['to'],
      limit: req.query['limit'] !== undefined ? Number(req.query['limit']) : undefined,
      offset: req.query['offset'] !== undefined ? Number(req.query['offset']) : undefined,
    };

    const parsed = EventQueryInput.safeParse(rawQuery);
    if (!parsed.success) {
      res.status(400).json({ error: 'validation_error', details: parsed.error.flatten() });
      return;
    }

    const { status, sourceType, from, to, limit, offset } = parsed.data;

    try {
      const { events, total } = await queryEvents(deps.db, {
        tenantId: tenantId ?? undefined,
        status,
        sourceType,
        from: from ? new Date(from) : undefined,
        to: to ? new Date(to) : undefined,
        limit,
        offset,
      });

      res.status(200).json({
        data: events.map(toEventSummary),
        total,
        limit,
        offset,
      });
    } catch (err) {
      console.error('[events] list error', err);
      res.status(500).json({ error: 'internal_error' });
    }
  };
}

// ============================================================
// T047: REPLAY EVENT
// ============================================================

function replayEventHandler(deps: EventsRouterDeps) {
  return async (req: Request, res: Response): Promise<void> => {
    const { id } = req.params;
    const tenantId = resolveTenantId(req);

    try {
      // Enforce tenant scoping — cross-tenant returns 404
      const event = await getEventById(deps.db, id, tenantId ?? undefined);
      if (!event) {
        res.status(404).json({ error: 'not_found' });
        return;
      }

      try {
        await replayEvent(deps.db, id);
      } catch (err) {
        const detail = err instanceof Error ? err.message : String(err);
        res.status(422).json({ error: 'Event cannot be replayed', detail });
        return;
      }

      console.log('[events] queued event for replay', { id });
      res.status(202).json({
        event_id: id,
        status: 'pending',
        message: 'Event queued for reprocessing',
      });
    } catch (err) {
      console.error('[events] replay error', { id, err });
      res.status(500).json({ error: 'internal_error' });
    }
  };
}
