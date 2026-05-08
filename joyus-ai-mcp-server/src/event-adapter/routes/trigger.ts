/**
 * Event Adapter — Trigger Callback Route
 *
 * Receives inbound trigger callbacks from external automation tools (Tier 2):
 *   POST /trigger  — queue a trigger callback as a webhook event
 *
 * Auth: Bearer token validated against the tenant's automationDestinations.authSecretRef.
 * Tenant is resolved from the matched destination record — no MCP user session required.
 */

import { and, eq, isNotNull } from 'drizzle-orm';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { Router, type Request, type Response } from 'express';

import { pipelines } from '../../pipelines/schema.js';
import { automationDestinations } from '../schema.js';
import { bufferEvent } from '../services/event-buffer.js';
import { decryptSecret } from '../services/secret-store.js';
import { TriggerCallbackInput } from '../validation.js';

// ============================================================
// TYPES
// ============================================================

export interface TriggerRouterDeps {
  db: NodePgDatabase<Record<string, unknown>>;
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
// POST /trigger — inbound trigger callback
// ============================================================

function triggerCallbackHandler(deps: TriggerRouterDeps) {
  return async (req: Request, res: Response): Promise<void> => {
    const authHeader = req.headers['authorization'];
    const token = authHeader?.startsWith('Bearer ') ? authHeader.slice(7).trim() : null;

    if (!token) {
      res.status(401).json({ error: 'unauthorized' });
      return;
    }

    // Resolve tenant by matching the bearer token against each destination's decrypted secret.
    // The automation tool uses the same shared secret for outbound auth and inbound callbacks.
    const destinations = await deps.db
      .select()
      .from(automationDestinations)
      .where(and(eq(automationDestinations.isActive, true), isNotNull(automationDestinations.authSecretRef)));

    const destination = destinations.find((d) => {
      if (!d.authSecretRef) return false;
      return decryptSecret(d.authSecretRef) === token;
    });

    if (!destination) {
      res.status(401).json({ error: 'unauthorized' });
      return;
    }

    const tenantId = destination.tenantId;

    const parsed = TriggerCallbackInput.safeParse(req.body);
    if (!parsed.success) {
      res.status(422).json({ error: 'validation_error', details: parsed.error.flatten() });
      return;
    }

    const { triggerType, pipelineId, metadata } = parsed.data;

    try {
      const [pipeline] = await deps.db
        .select({ id: pipelines.id })
        .from(pipelines)
        .where(and(eq(pipelines.id, pipelineId), eq(pipelines.tenantId, tenantId)))
        .limit(1);

      if (!pipeline) {
        res.status(404).json({ error: 'pipeline_not_found' });
        return;
      }

      const event = await bufferEvent(deps.db, {
        tenantId,
        sourceType: 'automation_callback',
        payload: { triggerType, pipelineId, metadata },
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
