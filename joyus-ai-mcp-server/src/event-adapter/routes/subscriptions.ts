/**
 * Event Adapter — Platform Subscription Routes (WP11)
 *
 * Endpoints for tenants to subscribe/unsubscribe to platform-wide event sources:
 *   POST   /sources/:id/subscribe    — subscribe tenant to a platform-wide source (T058)
 *   DELETE /sources/:id/unsubscribe  — remove tenant subscription (T058)
 *   GET    /sources/:id/subscriptions — list all subscriptions for a source (T058, admin only)
 */

import { Router, type Request, type Response } from 'express';
import { eq, and } from 'drizzle-orm';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';

import { eventSources, platformSubscriptions } from '../schema.js';

// ============================================================
// TYPES
// ============================================================

export interface SubscriptionsRouterDeps {
  db: NodePgDatabase<Record<string, unknown>>;
}

// ============================================================
// HELPERS
// ============================================================

/**
 * Resolve tenant id from request. Reads x-tenant-id header.
 * Returns null if the header is missing (platform admin callers omit it).
 */
function resolveTenantId(req: Request): string | null {
  const header = req.headers['x-tenant-id'];
  if (Array.isArray(header)) return header[0] ?? null;
  return header ?? null;
}

// ============================================================
// ROUTE FACTORY
// ============================================================

export function createSubscriptionsRouter(deps: SubscriptionsRouterDeps): Router {
  const router = Router();

  // POST /sources/:id/subscribe — subscribe tenant to platform-wide source
  router.post('/sources/:id/subscribe', subscribeHandler(deps));

  // DELETE /sources/:id/unsubscribe — remove tenant subscription
  router.delete('/sources/:id/unsubscribe', unsubscribeHandler(deps));

  // GET /sources/:id/subscriptions — list subscriptions (platform admin only)
  router.get('/sources/:id/subscriptions', listSubscriptionsHandler(deps));

  return router;
}

// ============================================================
// T058: SUBSCRIBE
// ============================================================

function subscribeHandler(deps: SubscriptionsRouterDeps) {
  return async (req: Request, res: Response): Promise<void> => {
    const { id } = req.params;
    const tenantId = resolveTenantId(req);

    // Tenants must have a tenant id to subscribe
    if (!tenantId) {
      res.status(403).json({ error: 'forbidden' });
      return;
    }

    // Validate body
    const targetPipelineId = req.body?.target_pipeline_id;
    if (!targetPipelineId || typeof targetPipelineId !== 'string' || targetPipelineId.trim() === '') {
      res.status(400).json({ error: 'validation_error', details: 'target_pipeline_id is required' });
      return;
    }

    try {
      // Verify source exists and is platform-wide
      const [source] = await deps.db
        .select()
        .from(eventSources)
        .where(eq(eventSources.id, id));

      if (!source) {
        res.status(404).json({ error: 'not_found' });
        return;
      }

      if (!source.isPlatformWide) {
        res.status(422).json({ error: 'not_platform_wide' });
        return;
      }

      // TODO(WP11): Verify target_pipeline_id belongs to tenant — requires pipelines table access
      // This ownership check is deferred: the pipelines table lives outside this module boundary.
      // Consistent with WP08/WP10 approach — caller is responsible for passing a valid pipeline id.

      // Insert subscription
      const [created] = await deps.db
        .insert(platformSubscriptions)
        .values({
          tenantId,
          eventSourceId: id,
          targetPipelineId: targetPipelineId.trim(),
          isActive: true,
        })
        .returning();

      console.log('[subscriptions] subscribed tenant to source', { tenantId, sourceId: id, id: created.id });
      res.status(201).json(created);
    } catch (err: unknown) {
      // Detect UNIQUE constraint violation (duplicate subscription)
      const isUniqueViolation =
        err instanceof Error &&
        (err.message.includes('unique') || err.message.includes('duplicate') || (err as NodeJS.ErrnoException).code === '23505');

      if (isUniqueViolation) {
        // Look up the existing subscription to return its id
        try {
          const [existing] = await deps.db
            .select()
            .from(platformSubscriptions)
            .where(
              and(
                eq(platformSubscriptions.tenantId, tenantId),
                eq(platformSubscriptions.eventSourceId, id),
              ),
            );

          res.status(409).json({
            error: 'already_subscribed',
            subscription_id: existing?.id ?? null,
          });
        } catch {
          res.status(409).json({ error: 'already_subscribed' });
        }
        return;
      }

      console.error('[subscriptions] subscribe error', err);
      res.status(500).json({ error: 'internal_error' });
    }
  };
}

// ============================================================
// T058: UNSUBSCRIBE
// ============================================================

function unsubscribeHandler(deps: SubscriptionsRouterDeps) {
  return async (req: Request, res: Response): Promise<void> => {
    const { id } = req.params;
    const tenantId = resolveTenantId(req);

    if (!tenantId) {
      res.status(403).json({ error: 'forbidden' });
      return;
    }

    try {
      const [deleted] = await deps.db
        .delete(platformSubscriptions)
        .where(
          and(
            eq(platformSubscriptions.tenantId, tenantId),
            eq(platformSubscriptions.eventSourceId, id),
          ),
        )
        .returning();

      if (!deleted) {
        res.status(404).json({ error: 'not_found' });
        return;
      }

      console.log('[subscriptions] unsubscribed tenant from source', { tenantId, sourceId: id });
      res.status(204).send();
    } catch (err) {
      console.error('[subscriptions] unsubscribe error', err);
      res.status(500).json({ error: 'internal_error' });
    }
  };
}

// ============================================================
// T058: LIST SUBSCRIPTIONS (platform admin only)
// ============================================================

function listSubscriptionsHandler(deps: SubscriptionsRouterDeps) {
  return async (req: Request, res: Response): Promise<void> => {
    const { id } = req.params;
    const tenantId = resolveTenantId(req);

    // Only platform admins (no tenant id) may list all subscriptions
    if (tenantId !== null) {
      res.status(403).json({ error: 'forbidden' });
      return;
    }

    const rawLimit = parseInt(String(req.query['limit'] ?? '50'), 10);
    const rawOffset = parseInt(String(req.query['offset'] ?? '0'), 10);
    const limit = Math.min(Math.max(isNaN(rawLimit) ? 50 : rawLimit, 1), 200);
    const offset = Math.max(isNaN(rawOffset) ? 0 : rawOffset, 0);

    try {
      const rows = await deps.db
        .select()
        .from(platformSubscriptions)
        .where(eq(platformSubscriptions.eventSourceId, id))
        .limit(limit)
        .offset(offset);

      res.status(200).json({
        data: rows,
        limit,
        offset,
      });
    } catch (err) {
      console.error('[subscriptions] list error', err);
      res.status(500).json({ error: 'internal_error' });
    }
  };
}
