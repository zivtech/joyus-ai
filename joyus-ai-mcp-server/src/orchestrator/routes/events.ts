/**
 * Event Subscription Routes — WP06 (T044)
 *
 * SSE endpoints for real-time event streaming. Delegates to EventService
 * which handles headers, replay (Last-Event-ID), polling, and heartbeat.
 *
 * Endpoints:
 *   GET /sessions/:sessionId/events — stream events for a specific session
 *   GET /events                     — stream all tenant events (with optional type filter)
 *
 * Both endpoints support:
 *   - ?types=session.created,session.status_changed  (comma-separated type filter)
 *   - Last-Event-ID header (resume from a specific sequence number)
 *
 * IMPORTANT: Do NOT add any JSON response after calling handleSseSubscription.
 * That method takes over the response and manages it for the lifetime of the connection.
 */

import { Router } from 'express';

import { getTenantId } from '../middleware/tenant.js';
import type { EventService } from '../event.service.js';
import { eventSubscriptionQuerySchema } from '../schemas.js';
import { validate } from './helpers.js';

export function createEventsRouter(eventService: EventService): Router {
  const router = Router({ mergeParams: true });

  // ─── GET /sessions/:sessionId/events ─────────────────────────────────────────
  router.get('/', async (req, res) => {
    const tenantId = getTenantId(req);
    // mergeParams: true enables access to parent route params (:sessionId).
    // Cast required because TypeScript doesn't infer parent params on child routers.
    const { sessionId } = req.params as { sessionId: string };

    const parsed = validate(eventSubscriptionQuerySchema, req.query, res);
    if (!parsed) return;

    const types = parsed.types ? parsed.types.split(',').map((t) => t.trim()).filter(Boolean) : undefined;

    // Retrieve the Last-Event-ID header (standard SSE resume header)
    const lastEventIdHeader = req.headers['last-event-id'];
    const lastEventId =
      lastEventIdHeader && !Array.isArray(lastEventIdHeader)
        ? parseInt(lastEventIdHeader, 10) || undefined
        : undefined;

    // EventService takes ownership of the response from this point forward
    await eventService.handleSseSubscription(tenantId, req, res, {
      sessionId,
      types,
      lastEventId,
    });
  });

  return router;
}

export function createTenantEventsRouter(eventService: EventService): Router {
  const router = Router();

  // ─── GET /events ─────────────────────────────────────────────────────────────
  router.get('/', async (req, res) => {
    const tenantId = getTenantId(req);

    const parsed = validate(eventSubscriptionQuerySchema, req.query, res);
    if (!parsed) return;

    const types = parsed.types ? parsed.types.split(',').map((t) => t.trim()).filter(Boolean) : undefined;

    const lastEventIdHeader = req.headers['last-event-id'];
    const lastEventId =
      lastEventIdHeader && !Array.isArray(lastEventIdHeader)
        ? parseInt(lastEventIdHeader, 10) || undefined
        : undefined;

    await eventService.handleSseSubscription(tenantId, req, res, {
      types,
      lastEventId,
    });
  });

  return router;
}
