/**
 * Orchestrator Routes Index — WP06 (T041)
 *
 * Composes all orchestrator sub-routers under a single parent router.
 * All routes require:
 *   1. requireBearerToken (upstream, applied in src/orchestrator/index.ts)
 *   2. resolveTenantId (applied here, before all sub-routers)
 *
 * Route tree (relative to /api/v1/orchestrator):
 *
 *   /sessions                          — createSessionsRouter
 *   /sessions/:sessionId/messages      — createMessagesRouter
 *   /sessions/:sessionId/events        — createEventsRouter (session-scoped SSE)
 *   /events                            — createTenantEventsRouter (tenant-wide SSE)
 *   /work-units                        — createCoordinationRouter (work units + groups)
 *   /coordination-groups               — createCoordinationRouter (same router)
 *   /openapi.json                      — createOpenApiRouter
 */

import { Router } from 'express';

import { resolveTenantId } from '../middleware/tenant.js';
import type { AgentLoopService } from '../agent-loop.service.js';
import type { CoordinationService } from '../coordination.service.js';
import type { EventService } from '../event.service.js';
import type { SessionService } from '../session.service.js';

import { createSessionsRouter } from './sessions.js';
import { createMessagesRouter } from './messages.js';
import { createEventsRouter, createTenantEventsRouter } from './events.js';
import { createCoordinationRouter } from './coordination.js';
import { createOpenApiRouter } from './openapi.js';

export interface OrchestratorRouterDeps {
  sessionService: SessionService;
  agentLoopService: AgentLoopService;
  eventService: EventService;
  coordinationService: CoordinationService;
}

/**
 * Create the complete orchestrator Express router.
 *
 * @param deps - Service dependencies injected from src/index.ts
 * @returns An Express Router to be mounted at /api/v1/orchestrator
 */
export function createOrchestratorRoutes(deps: OrchestratorRouterDeps): Router {
  const router = Router();

  // ── Apply tenant middleware to ALL orchestrator routes ─────────────────────
  // requireBearerToken must already be in the stack (applied by the caller in src/index.ts).
  // resolveTenantId extracts tenantId from req.mcpUser (set by requireBearerToken).
  router.use(resolveTenantId);

  // ── OpenAPI spec (no auth on the spec endpoint for tooling convenience) ────
  // Note: this is still behind requireBearerToken from the parent mount.
  router.use('/', createOpenApiRouter());

  // ── Session routes ──────────────────────────────────────────────────────────
  router.use('/sessions', createSessionsRouter(deps.sessionService));

  // ── Message route (nested under sessions) ──────────────────────────────────
  router.use('/sessions/:sessionId/messages', createMessagesRouter(deps.sessionService, deps.agentLoopService));

  // ── Session-scoped event SSE ────────────────────────────────────────────────
  router.use('/sessions/:sessionId/events', createEventsRouter(deps.eventService));

  // ── Tenant-wide event SSE ───────────────────────────────────────────────────
  router.use('/', createTenantEventsRouter(deps.eventService));

  // ── Coordination routes (work units + groups) ───────────────────────────────
  router.use('/', createCoordinationRouter(deps.coordinationService));

  return router;
}
