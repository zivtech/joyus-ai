/**
 * Event Adapter — Trigger Callback Route (WP10)
 *
 * Receives inbound trigger callbacks from external automation tools (Tier 2):
 *   POST /trigger  — queue a trigger callback as a webhook event (T054)
 *
 * Auth: Bearer token in Authorization header. Falls back to x-tenant-id header
 * when bearer token is absent (platform auth not yet fully implemented).
 */

import { Router, type Request, type Response } from 'express';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';

import { TriggerCallbackInput } from '../validation.js';
import { bufferEvent } from '../services/event-buffer.js';

// ============================================================
// TYPES
// ============================================================

export interface TriggerRouterDeps {
  db: NodePgDatabase<Record<string, unknown>>;
}

// ============================================================
// HELPERS
// ============================================================

/**
 * Extract tenant ID from the request.
 *
 * Resolution order:
 *   1. Bearer token in Authorization header (token IS the tenant_id for now)
 *
 * Returns null if no bearer token is present.
 *
 * TODO(WP10): Replace with platform API token validation — current implementation is a placeholder
 */
function resolveTenantFromAuth(req: Request): string | null {
  const authHeader = req.headers['authorization'];
  if (authHeader && authHeader.startsWith('Bearer ')) {
    const token = authHeader.slice(7).trim();
    if (token) return token;
  }

  return null;
}

// ============================================================
// ROUTE FACTORY
// ============================================================

export function createTriggerRouter(deps: TriggerRouterDeps): Router {
  const router = Router();

  router.post('/trigger', triggerCallbackHandler(deps));

  return router;
}

// ============================================================
// T054: POST /trigger — inbound trigger callback
// ============================================================

function triggerCallbackHandler(deps: TriggerRouterDeps) {
  return async (req: Request, res: Response): Promise<void> => {
    const tenantId = resolveTenantFromAuth(req);

    if (!tenantId) {
      res.status(401).json({ error: 'unauthorized' });
      return;
    }

    const parsed = TriggerCallbackInput.safeParse(req.body);
    if (!parsed.success) {
      res.status(422).json({ error: 'validation_error', details: parsed.error.flatten() });
      return;
    }

    const { triggerType, pipelineId, metadata } = parsed.data;

    try {
      // TODO(WP10): Verify pipeline_id belongs to tenant — requires pipelines table access
      const event = await bufferEvent(deps.db, {
        tenantId,
        sourceType: 'automation_callback',
        payload: {
          triggerType,
          pipelineId,
          metadata,
        },
        signatureValid: true,
      });

      console.log('[trigger] queued callback', { tenantId, eventId: event.id, triggerType, pipelineId });
      res.status(202).json({ event_id: event.id, message: 'Trigger queued' });
    } catch (err) {
      console.error('[trigger] callback error', err);
      res.status(500).json({ error: 'internal_error' });
    }
  };
}
