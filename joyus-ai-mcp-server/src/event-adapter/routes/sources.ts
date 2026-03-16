/**
 * Event Adapter — Event Source Management Routes (WP07)
 *
 * CRUD endpoints for managing event sources:
 *   GET    /sources              — list with tenant scoping and pagination (T035)
 *   POST   /sources              — create with slug generation and secret encryption (T036)
 *   PATCH  /sources/:id          — update config, lifecycle; slug is immutable (T037)
 *   DELETE /sources/:id          — soft delete (archive); blocked if active subscriptions exist (T038)
 *
 * Tenant context: resolved from x-tenant-id header (auth middleware not yet implemented).
 * Secrets: authConfig.secretRef stores AES-256-GCM encrypted ciphertext via secret-store.
 * Response: authConfig is never returned; hasSecret: boolean is returned instead.
 */

import { randomBytes } from 'node:crypto';
import { Router, type Request, type Response } from 'express';
import { eq, and, count, or } from 'drizzle-orm';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';

import { eventSources, platformSubscriptions } from '../schema.js';
import { CreateEventSourceInput, UpdateEventSourceInput } from '../validation.js';
import { encryptSecret } from '../services/secret-store.js';

// ============================================================
// TYPES
// ============================================================

export interface SourcesRouterDeps {
  db: NodePgDatabase<Record<string, unknown>>;
}

// ============================================================
// HELPERS
// ============================================================

/**
 * Generate a URL-safe slug from a human-readable name.
 * Format: <normalised-name>-<6 hex chars>
 */
function generateSlug(name: string): string {
  const base = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 50);
  const suffix = randomBytes(3).toString('hex'); // 6 hex chars
  return `${base}-${suffix}`;
}

/**
 * Build authConfig JSONB from the request body.
 * Secrets are encrypted before storage; the encrypted blob becomes secretRef.
 */
function buildAuthConfig(
  authMethod: string,
  authSecret: string | undefined,
  rawAuthConfig: Record<string, unknown> | undefined,
): Record<string, unknown> {
  switch (authMethod) {
    case 'hmac_sha256': {
      const secretRef = authSecret ? encryptSecret(authSecret) : '';
      return {
        headerName: 'x-hub-signature-256',
        algorithm: 'sha256',
        secretRef,
      };
    }
    case 'api_key_header': {
      const secretRef = authSecret ? encryptSecret(authSecret) : '';
      return {
        headerName: (rawAuthConfig?.headerName as string | undefined) ?? 'x-api-key',
        secretRef,
      };
    }
    case 'ip_allowlist':
      return {
        allowedIps: (rawAuthConfig?.allowedIps as string[] | undefined) ?? [],
      };
    default:
      return rawAuthConfig ?? {};
  }
}

/**
 * Determine whether authConfig contains a stored secret reference.
 */
function hasSecretRef(authConfig: unknown): boolean {
  if (typeof authConfig !== 'object' || authConfig === null) return false;
  const cfg = authConfig as Record<string, unknown>;
  return typeof cfg['secretRef'] === 'string' && cfg['secretRef'] !== '';
}

/**
 * Strip sensitive authConfig from a row before sending in a response.
 * Returns a safe public shape with hasSecret instead of authConfig.
 */
function toPublicSource(row: typeof eventSources.$inferSelect) {
  const { authConfig, ...rest } = row;
  return {
    ...rest,
    hasSecret: hasSecretRef(authConfig),
  };
}

/**
 * Resolve tenant id from request. Reads x-tenant-id header.
 * Returns null if the header is missing (platform-wide callers omit it).
 */
function resolveTenantId(req: Request): string | null {
  const header = req.headers['x-tenant-id'];
  if (Array.isArray(header)) return header[0] ?? null;
  return header ?? null;
}

// ============================================================
// ROUTE FACTORY
// ============================================================

export function createSourcesRouter(deps: SourcesRouterDeps): Router {
  const router = Router();

  // GET /sources/platform — list only platform-wide sources (any authenticated user)
  router.get('/sources/platform', listPlatformSourcesHandler(deps));

  // GET /sources — list sources for tenant (includes platform-wide when tenant is present)
  router.get('/sources', listSourcesHandler(deps));

  // POST /sources — create source
  router.post('/sources', createSourceHandler(deps));

  // PATCH /sources/:id — update source
  router.patch('/sources/:id', updateSourceHandler(deps));

  // DELETE /sources/:id — soft-delete (archive)
  router.delete('/sources/:id', deleteSourceHandler(deps));

  return router;
}

// ============================================================
// T035: LIST SOURCES
// ============================================================

function listSourcesHandler(deps: SourcesRouterDeps) {
  return async (req: Request, res: Response): Promise<void> => {
    const tenantId = resolveTenantId(req);

    const rawLimit = parseInt(String(req.query['limit'] ?? '50'), 10);
    const rawOffset = parseInt(String(req.query['offset'] ?? '0'), 10);
    const limit = Math.min(Math.max(isNaN(rawLimit) ? 50 : rawLimit, 1), 200);
    const offset = Math.max(isNaN(rawOffset) ? 0 : rawOffset, 0);

    try {
      const rows = tenantId
        ? await deps.db
            .select()
            .from(eventSources)
            .where(
              or(
                eq(eventSources.tenantId, tenantId),
                eq(eventSources.isPlatformWide, true),
              ),
            )
            .limit(limit)
            .offset(offset)
        : await deps.db
            .select()
            .from(eventSources)
            .where(eq(eventSources.isPlatformWide, true))
            .limit(limit)
            .offset(offset);

      res.status(200).json({
        data: rows.map(toPublicSource),
        limit,
        offset,
      });
    } catch (err) {
      console.error('[sources] list error', err);
      res.status(500).json({ error: 'internal_error' });
    }
  };
}

// ============================================================
// T057: LIST PLATFORM-WIDE SOURCES
// ============================================================

function listPlatformSourcesHandler(deps: SourcesRouterDeps) {
  return async (req: Request, res: Response): Promise<void> => {
    const rawLimit = parseInt(String(req.query['limit'] ?? '50'), 10);
    const rawOffset = parseInt(String(req.query['offset'] ?? '0'), 10);
    const limit = Math.min(Math.max(isNaN(rawLimit) ? 50 : rawLimit, 1), 200);
    const offset = Math.max(isNaN(rawOffset) ? 0 : rawOffset, 0);

    try {
      const rows = await deps.db
        .select()
        .from(eventSources)
        .where(eq(eventSources.isPlatformWide, true))
        .limit(limit)
        .offset(offset);

      res.status(200).json({
        data: rows.map(toPublicSource),
        limit,
        offset,
      });
    } catch (err) {
      console.error('[sources] list platform error', err);
      res.status(500).json({ error: 'internal_error' });
    }
  };
}

// ============================================================
// T036: CREATE SOURCE
// ============================================================

function createSourceHandler(deps: SourcesRouterDeps) {
  return async (req: Request, res: Response): Promise<void> => {
    const parsed = CreateEventSourceInput.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'validation_error', details: parsed.error.flatten() });
      return;
    }

    const input = parsed.data;
    const tenantId = resolveTenantId(req);
    const endpointSlug = generateSlug(input.name);

    const authConfig = buildAuthConfig(
      input.authMethod,
      input.authSecret,
      input.authConfig,
    );

    try {
      const [created] = await deps.db
        .insert(eventSources)
        .values({
          tenantId: tenantId ?? undefined,
          name: input.name,
          sourceType: input.sourceType,
          endpointSlug,
          authMethod: input.authMethod,
          authConfig,
          payloadMapping: input.payloadMapping ?? null,
          targetPipelineId: input.targetPipelineId ?? null,
          targetTriggerType: input.targetTriggerType ?? null,
          lifecycleState: 'active',
          isPlatformWide: tenantId === null,
        })
        .returning();

      if (!created) {
        res.status(500).json({ error: 'internal_error' });
        return;
      }

      console.log('[sources] created event source', { id: created.id, slug: created.endpointSlug });
      res.status(201).json(toPublicSource(created));
    } catch (err) {
      console.error('[sources] create error', err);
      res.status(500).json({ error: 'internal_error' });
    }
  };
}

// ============================================================
// T037: UPDATE SOURCE
// ============================================================

function updateSourceHandler(deps: SourcesRouterDeps) {
  return async (req: Request, res: Response): Promise<void> => {
    const { id } = req.params;

    // Reject attempts to change the slug
    if ('endpointSlug' in req.body) {
      res.status(422).json({ error: 'immutable_field', field: 'endpointSlug' });
      return;
    }

    const parsed = UpdateEventSourceInput.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'validation_error', details: parsed.error.flatten() });
      return;
    }

    const input = parsed.data;
    const tenantId = resolveTenantId(req);

    try {
      // Fetch existing row first to enforce tenant scoping
      const whereClause = tenantId
        ? and(eq(eventSources.id, id), eq(eventSources.tenantId, tenantId))
        : eq(eventSources.id, id);

      const [existing] = await deps.db
        .select()
        .from(eventSources)
        .where(whereClause);

      if (!existing) {
        res.status(404).json({ error: 'not_found' });
        return;
      }

      // Build partial update
      const updates: Partial<typeof eventSources.$inferInsert> = {
        updatedAt: new Date(),
      };

      if (input.name !== undefined) updates.name = input.name;
      if (input.targetPipelineId !== undefined) updates.targetPipelineId = input.targetPipelineId;
      if (input.targetTriggerType !== undefined) updates.targetTriggerType = input.targetTriggerType;
      if (input.payloadMapping !== undefined) updates.payloadMapping = input.payloadMapping;
      if (input.lifecycleState !== undefined) updates.lifecycleState = input.lifecycleState;

      // If authMethod or authSecret changes, rebuild authConfig
      if (input.authMethod !== undefined || input.authSecret !== undefined) {
        const method = input.authMethod ?? existing.authMethod;
        updates.authMethod = method;
        updates.authConfig = buildAuthConfig(
          method,
          input.authSecret,
          input.authConfig ?? (existing.authConfig as Record<string, unknown>),
        );
      } else if (input.authConfig !== undefined) {
        // Partial authConfig update without secret rotation
        updates.authConfig = {
          ...(existing.authConfig as Record<string, unknown>),
          ...input.authConfig,
        };
      }

      const [updated] = await deps.db
        .update(eventSources)
        .set(updates)
        .where(eq(eventSources.id, id))
        .returning();

      if (!updated) {
        res.status(404).json({ error: 'not_found' });
        return;
      }

      console.log('[sources] updated event source', { id: updated.id });
      res.status(200).json(toPublicSource(updated));
    } catch (err) {
      console.error('[sources] update error', err);
      res.status(500).json({ error: 'internal_error' });
    }
  };
}

// ============================================================
// T038: DELETE SOURCE (soft delete — archive)
// ============================================================

function deleteSourceHandler(deps: SourcesRouterDeps) {
  return async (req: Request, res: Response): Promise<void> => {
    const { id } = req.params;
    const tenantId = resolveTenantId(req);

    try {
      // Enforce tenant scoping when fetching
      const whereClause = tenantId
        ? and(eq(eventSources.id, id), eq(eventSources.tenantId, tenantId))
        : eq(eventSources.id, id);

      const [existing] = await deps.db
        .select()
        .from(eventSources)
        .where(whereClause);

      if (!existing) {
        res.status(404).json({ error: 'not_found' });
        return;
      }

      if (existing.lifecycleState === 'archived') {
        res.status(409).json({ error: 'already_archived' });
        return;
      }

      // Block delete if active subscriptions exist
      const [subscriptionCount] = await deps.db
        .select({ count: count() })
        .from(platformSubscriptions)
        .where(
          and(
            eq(platformSubscriptions.eventSourceId, id),
            eq(platformSubscriptions.isActive, true),
          ),
        );

      const activeCount = Number(subscriptionCount?.count ?? 0);
      if (activeCount > 0) {
        res.status(409).json({
          error: 'active_subscriptions',
          detail: `Cannot archive source with ${activeCount} active subscription(s). Deactivate them first.`,
          activeSubscriptions: activeCount,
        });
        return;
      }

      // Soft delete: set lifecycleState to 'archived'
      const [archived] = await deps.db
        .update(eventSources)
        .set({ lifecycleState: 'archived', updatedAt: new Date() })
        .where(eq(eventSources.id, id))
        .returning();

      if (!archived) {
        res.status(404).json({ error: 'not_found' });
        return;
      }

      console.log('[sources] archived event source', { id: archived.id });
      res.status(200).json(toPublicSource(archived));
    } catch (err) {
      console.error('[sources] delete error', err);
      res.status(500).json({ error: 'internal_error' });
    }
  };
}
