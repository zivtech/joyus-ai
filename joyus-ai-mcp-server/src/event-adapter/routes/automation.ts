/**
 * Event Adapter — Automation Destination Routes (WP10)
 *
 * Manage the optional Tier 2 external automation destination per tenant:
 *   GET    /automation  — get current destination config (T050)
 *   PUT    /automation  — register or replace destination (T051)
 *   DELETE /automation  — remove destination (T052)
 *
 * Auth secrets are encrypted at rest via secret-store. They are never
 * returned in API responses — only a `hasAuth` boolean is exposed.
 */

import { Router, type Request, type Response } from 'express';
import { eq } from 'drizzle-orm';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';

import { automationDestinations } from '../schema.js';
import { AutomationDestinationInput } from '../validation.js';
import { encryptSecret } from '../services/secret-store.js';
import type { AutomationForwarder } from '../services/automation-forwarder.js';

// ============================================================
// TYPES
// ============================================================

export interface AutomationRouterDeps {
  db: NodePgDatabase<Record<string, unknown>>;
  automationForwarder?: AutomationForwarder;
}

// ============================================================
// HELPERS
// ============================================================

/**
 * Resolve tenant id from the x-tenant-id header.
 */
function resolveTenantId(req: Request): string | null {
  const header = req.headers['x-tenant-id'];
  if (Array.isArray(header)) return header[0] ?? null;
  return header ?? null;
}

/**
 * Build the public-safe response shape from a DB row.
 * Never exposes authSecretRef.
 */
function toPublicDestination(row: typeof automationDestinations.$inferSelect) {
  return {
    configured: true,
    url: row.url,
    isActive: row.isActive,
    lastForwardedAt: row.lastForwardedAt,
    failureCount: row.failureCount,
    circuitOpen: row.failureCount >= 10,
    hasAuth: !!row.authHeader || !!row.authSecretRef,
  };
}

// ============================================================
// ROUTE FACTORY
// ============================================================

export function createAutomationRouter(deps: AutomationRouterDeps): Router {
  const router = Router();

  router.get('/automation', getAutomationHandler(deps));
  router.put('/automation', putAutomationHandler(deps));
  router.delete('/automation', deleteAutomationHandler(deps));

  return router;
}

// ============================================================
// T050: GET AUTOMATION DESTINATION
// ============================================================

function getAutomationHandler(deps: AutomationRouterDeps) {
  return async (req: Request, res: Response): Promise<void> => {
    const tenantId = resolveTenantId(req);
    if (!tenantId) {
      res.status(400).json({ error: 'missing_tenant_id' });
      return;
    }

    try {
      const [row] = await deps.db
        .select()
        .from(automationDestinations)
        .where(eq(automationDestinations.tenantId, tenantId));

      if (!row) {
        res.status(200).json({ configured: false });
        return;
      }

      res.status(200).json(toPublicDestination(row));
    } catch (err) {
      console.error('[automation] get error', err);
      res.status(500).json({ error: 'internal_error' });
    }
  };
}

// ============================================================
// T051: PUT AUTOMATION DESTINATION (upsert)
// ============================================================

function putAutomationHandler(deps: AutomationRouterDeps) {
  return async (req: Request, res: Response): Promise<void> => {
    const tenantId = resolveTenantId(req);
    if (!tenantId) {
      res.status(400).json({ error: 'missing_tenant_id' });
      return;
    }

    const parsed = AutomationDestinationInput.safeParse(req.body);
    if (!parsed.success) {
      res.status(422).json({ error: 'validation_error', details: parsed.error.flatten() });
      return;
    }

    const input = parsed.data;
    const authSecretRef = input.authSecret ? encryptSecret(input.authSecret) : null;

    try {
      const [existing] = await deps.db
        .select()
        .from(automationDestinations)
        .where(eq(automationDestinations.tenantId, tenantId));

      let row: typeof automationDestinations.$inferSelect;

      if (existing) {
        const [updated] = await deps.db
          .update(automationDestinations)
          .set({
            url: input.url,
            authHeader: input.authHeader ?? null,
            authSecretRef: authSecretRef ?? (input.authSecret === undefined ? existing.authSecretRef : null),
            isActive: true,
            failureCount: 0,
            updatedAt: new Date(),
          })
          .where(eq(automationDestinations.tenantId, tenantId))
          .returning();

        row = updated;
      } else {
        const [inserted] = await deps.db
          .insert(automationDestinations)
          .values({
            tenantId,
            url: input.url,
            authHeader: input.authHeader ?? null,
            authSecretRef: authSecretRef,
            isActive: true,
            failureCount: 0,
          })
          .returning();

        row = inserted;
      }

      deps.automationForwarder?.resetCircuit(tenantId);
      console.log('[automation] upserted destination', { tenantId, url: input.url });
      res.status(200).json(toPublicDestination(row));
    } catch (err) {
      console.error('[automation] put error', err);
      res.status(500).json({ error: 'internal_error' });
    }
  };
}

// ============================================================
// T052: DELETE AUTOMATION DESTINATION
// ============================================================

function deleteAutomationHandler(deps: AutomationRouterDeps) {
  return async (req: Request, res: Response): Promise<void> => {
    const tenantId = resolveTenantId(req);
    if (!tenantId) {
      res.status(400).json({ error: 'missing_tenant_id' });
      return;
    }

    try {
      const [existing] = await deps.db
        .select()
        .from(automationDestinations)
        .where(eq(automationDestinations.tenantId, tenantId));

      if (!existing) {
        res.status(404).json({ error: 'not_found' });
        return;
      }

      await deps.db
        .delete(automationDestinations)
        .where(eq(automationDestinations.tenantId, tenantId));

      console.log('[automation] deleted destination', { tenantId });
      res.status(204).send();
    } catch (err) {
      console.error('[automation] delete error', err);
      res.status(500).json({ error: 'internal_error' });
    }
  };
}
