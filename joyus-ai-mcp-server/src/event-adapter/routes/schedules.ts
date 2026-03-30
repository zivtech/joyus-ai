/**
 * Event Adapter — Schedule Management Routes (WP08)
 *
 * CRUD endpoints for managing recurring scheduled tasks:
 *   GET    /schedules              — list with tenant scoping and pagination
 *   POST   /schedules              — create with cron validation
 *   PATCH  /schedules/:id          — update with cron re-evaluation
 *   DELETE /schedules/:id          — soft delete (archive)
 *
 * Tenant context: resolved from x-tenant-id header (same pattern as sources.ts).
 * Cron validation: uses validateCronExpression and isValidTimezone from scheduler service.
 * nextFireAt: computed on create, recomputed on cron/timezone/lifecycle changes.
 */

import { Router, type Request, type Response } from 'express';
import { eq, and, count } from 'drizzle-orm';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';

import { eventScheduledTasks } from '../schema.js';
import { CreateScheduleInput, UpdateScheduleInput } from '../validation.js';
import {
  validateCronExpression,
  computeNextFireAt,
  isValidTimezone,
} from '../services/scheduler.js';

// ============================================================
// TYPES
// ============================================================

export interface SchedulesRouterDeps {
  db: NodePgDatabase<Record<string, unknown>>;
}

// ============================================================
// HELPERS
// ============================================================

/**
 * Resolve tenant id from request. Reads x-tenant-id header.
 * Returns null if the header is missing (platform-admin context).
 */
function resolveTenantId(req: Request): string | null {
  const header = req.headers['x-tenant-id'];
  if (Array.isArray(header)) return header[0] ?? null;
  return header ?? null;
}

/** Shape returned for each schedule in list/create/update responses. */
function toScheduleSummary(row: typeof eventScheduledTasks.$inferSelect) {
  return {
    id: row.id,
    name: row.name,
    cronExpression: row.cronExpression,
    timezone: row.timezone,
    targetPipelineId: row.targetPipelineId,
    triggerType: row.triggerType,
    triggerMetadata: row.triggerMetadata,
    lifecycleState: row.lifecycleState,
    pausedBy: row.pausedBy,
    lastFiredAt: row.lastFiredAt,
    nextFireAt: row.nextFireAt,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

// ============================================================
// ROUTE FACTORY
// ============================================================

export function createSchedulesRouter(deps: SchedulesRouterDeps): Router {
  const router = Router();

  // GET /schedules — list schedules for tenant
  router.get('/schedules', listSchedulesHandler(deps));

  // POST /schedules — create schedule
  router.post('/schedules', createScheduleHandler(deps));

  // PATCH /schedules/:id — update schedule
  router.patch('/schedules/:id', updateScheduleHandler(deps));

  // DELETE /schedules/:id — soft-delete (archive)
  router.delete('/schedules/:id', deleteScheduleHandler(deps));

  return router;
}

// ============================================================
// GET /schedules — LIST SCHEDULES
// ============================================================

function listSchedulesHandler(deps: SchedulesRouterDeps) {
  return async (req: Request, res: Response): Promise<void> => {
    const tenantId = resolveTenantId(req);

    const rawLimit = parseInt(String(req.query['limit'] ?? '50'), 10);
    const rawOffset = parseInt(String(req.query['offset'] ?? '0'), 10);
    const limit = Math.min(Math.max(isNaN(rawLimit) ? 50 : rawLimit, 1), 200);
    const offset = Math.max(isNaN(rawOffset) ? 0 : rawOffset, 0);
    const lifecycleStateFilter = req.query['lifecycle_state'] as string | undefined;

    try {
      // Build where clause
      let rows: (typeof eventScheduledTasks.$inferSelect)[];
      let totalResult: { count: number }[];

      if (tenantId) {
        if (lifecycleStateFilter) {
          const where = and(
            eq(eventScheduledTasks.tenantId, tenantId),
            eq(eventScheduledTasks.lifecycleState, lifecycleStateFilter as 'active' | 'paused' | 'disabled' | 'archived'),
          );
          [rows, totalResult] = await Promise.all([
            deps.db
              .select()
              .from(eventScheduledTasks)
              .where(where)
              .limit(limit)
              .offset(offset),
            deps.db
              .select({ count: count() })
              .from(eventScheduledTasks)
              .where(where),
          ]);
        } else {
          const where = eq(eventScheduledTasks.tenantId, tenantId);
          [rows, totalResult] = await Promise.all([
            deps.db
              .select()
              .from(eventScheduledTasks)
              .where(where)
              .limit(limit)
              .offset(offset),
            deps.db
              .select({ count: count() })
              .from(eventScheduledTasks)
              .where(where),
          ]);
        }
      } else {
        [rows, totalResult] = await Promise.all([
          deps.db
            .select()
            .from(eventScheduledTasks)
            .limit(limit)
            .offset(offset),
          deps.db
            .select({ count: count() })
            .from(eventScheduledTasks),
        ]);
      }

      const schedules = rows.map(toScheduleSummary);
      const total = totalResult[0]?.count ?? 0;

      res.status(200).json({ schedules, total, limit, offset });
    } catch (err) {
      console.error('[schedules] list error', err);
      res.status(500).json({ error: 'internal_error' });
    }
  };
}

// ============================================================
// POST /schedules — CREATE SCHEDULE
// ============================================================

function createScheduleHandler(deps: SchedulesRouterDeps) {
  return async (req: Request, res: Response): Promise<void> => {
    const parsed = CreateScheduleInput.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'validation_error', details: parsed.error.flatten() });
      return;
    }

    const input = parsed.data;
    const tenantId = resolveTenantId(req);

    // Require tenant context for schedule creation
    if (!tenantId) {
      res.status(400).json({ error: 'tenant_required', detail: 'x-tenant-id header is required for schedule management' });
      return;
    }

    // Validate cron expression semantically
    if (!validateCronExpression(input.cronExpression)) {
      res.status(422).json({ error: 'invalid_cron_expression', detail: 'The cron expression is not valid' });
      return;
    }

    // Validate timezone
    if (!isValidTimezone(input.timezone)) {
      res.status(422).json({ error: 'invalid_timezone', detail: 'The timezone is not a valid IANA timezone identifier' });
      return;
    }

    // Compute initial nextFireAt
    const nextFireAt = computeNextFireAt(input.cronExpression, new Date(), input.timezone);

    try {
      const [created] = await deps.db
        .insert(eventScheduledTasks)
        .values({
          tenantId,
          name: input.name,
          cronExpression: input.cronExpression,
          timezone: input.timezone,
          targetPipelineId: input.targetPipelineId,
          triggerType: input.triggerType,
          triggerMetadata: input.triggerMetadata ?? null,
          lifecycleState: 'active',
          nextFireAt: nextFireAt ?? null,
        })
        .returning();

      if (!created) {
        res.status(500).json({ error: 'internal_error' });
        return;
      }

      console.log('[schedules] created schedule', { id: created.id, name: created.name });
      res.status(201).json(toScheduleSummary(created));
    } catch (err) {
      console.error('[schedules] create error', err);
      res.status(500).json({ error: 'internal_error' });
    }
  };
}

// ============================================================
// PATCH /schedules/:id — UPDATE SCHEDULE
// ============================================================

function updateScheduleHandler(deps: SchedulesRouterDeps) {
  return async (req: Request, res: Response): Promise<void> => {
    const { id } = req.params;

    const parsed = UpdateScheduleInput.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'validation_error', details: parsed.error.flatten() });
      return;
    }

    const input = parsed.data;
    const tenantId = resolveTenantId(req);
    const isPlatformAdmin = tenantId === null;

    // Platform-admin gate: only platform admins (no x-tenant-id) may set or clear `disabled`
    if (!isPlatformAdmin && input.lifecycleState !== undefined) {
      const existingLifecycle = input.lifecycleState;
      if (existingLifecycle === 'disabled') {
        res.status(403).json({ error: 'forbidden', detail: 'Only platform administrators can set or clear the disabled state' });
        return;
      }
    }

    // Validate new cron expression if provided
    if (input.cronExpression !== undefined && !validateCronExpression(input.cronExpression)) {
      res.status(422).json({ error: 'invalid_cron_expression', detail: 'The cron expression is not valid' });
      return;
    }

    // Validate new timezone if provided
    if (input.timezone !== undefined && !isValidTimezone(input.timezone)) {
      res.status(422).json({ error: 'invalid_timezone', detail: 'The timezone is not a valid IANA timezone identifier' });
      return;
    }

    try {
      // Fetch existing row to enforce tenant scoping
      const whereClause = tenantId
        ? and(eq(eventScheduledTasks.id, id), eq(eventScheduledTasks.tenantId, tenantId))
        : eq(eventScheduledTasks.id, id);

      const [existing] = await deps.db
        .select()
        .from(eventScheduledTasks)
        .where(whereClause);

      if (!existing) {
        res.status(404).json({ error: 'not_found' });
        return;
      }

      // Platform-admin gate: block tenant admins from transitioning disabled → active
      if (!isPlatformAdmin && existing.lifecycleState === 'disabled' && input.lifecycleState === 'active') {
        res.status(403).json({ error: 'forbidden', detail: 'Only platform administrators can set or clear the disabled state' });
        return;
      }

      // Build partial update
      const updates: Partial<typeof eventScheduledTasks.$inferInsert> = {
        updatedAt: new Date(),
      };

      if (input.name !== undefined) updates.name = input.name;
      if (input.targetPipelineId !== undefined) updates.targetPipelineId = input.targetPipelineId;
      if (input.triggerType !== undefined) updates.triggerType = input.triggerType;
      if (input.triggerMetadata !== undefined) updates.triggerMetadata = input.triggerMetadata;
      if (input.lifecycleState !== undefined) updates.lifecycleState = input.lifecycleState;

      // Recompute nextFireAt when cron or timezone changes
      const newCron = input.cronExpression ?? existing.cronExpression;
      const newTimezone = input.timezone ?? existing.timezone;
      const cronChanged = input.cronExpression !== undefined;
      const timezoneChanged = input.timezone !== undefined;
      const resumingFromPause =
        input.lifecycleState === 'active' && existing.lifecycleState === 'paused';

      if (cronChanged) updates.cronExpression = newCron;
      if (timezoneChanged) updates.timezone = newTimezone;

      if (cronChanged || timezoneChanged || resumingFromPause) {
        const nextFireAt = computeNextFireAt(newCron, new Date(), newTimezone);
        updates.nextFireAt = nextFireAt ?? null;
      }

      // Clear pausedBy when resuming
      if (resumingFromPause) {
        updates.pausedBy = null;
      }

      const [updated] = await deps.db
        .update(eventScheduledTasks)
        .set(updates)
        .where(eq(eventScheduledTasks.id, id))
        .returning();

      if (!updated) {
        res.status(404).json({ error: 'not_found' });
        return;
      }

      console.log('[schedules] updated schedule', { id: updated.id });
      res.status(200).json(toScheduleSummary(updated));
    } catch (err) {
      console.error('[schedules] update error', err);
      res.status(500).json({ error: 'internal_error' });
    }
  };
}

// ============================================================
// DELETE /schedules/:id — SOFT DELETE (archive)
// ============================================================

function deleteScheduleHandler(deps: SchedulesRouterDeps) {
  return async (req: Request, res: Response): Promise<void> => {
    const { id } = req.params;
    const tenantId = resolveTenantId(req);

    try {
      // Enforce tenant scoping when fetching
      const whereClause = tenantId
        ? and(eq(eventScheduledTasks.id, id), eq(eventScheduledTasks.tenantId, tenantId))
        : eq(eventScheduledTasks.id, id);

      const [existing] = await deps.db
        .select()
        .from(eventScheduledTasks)
        .where(whereClause);

      if (!existing) {
        res.status(404).json({ error: 'not_found' });
        return;
      }

      if (existing.lifecycleState === 'archived') {
        res.status(409).json({ error: 'already_archived' });
        return;
      }

      // Soft delete: set lifecycleState to 'archived', keep nextFireAt for history
      await deps.db
        .update(eventScheduledTasks)
        .set({ lifecycleState: 'archived', updatedAt: new Date() })
        .where(eq(eventScheduledTasks.id, id));

      console.log('[schedules] archived schedule', { id });
      res.status(204).end();
    } catch (err) {
      console.error('[schedules] delete error', err);
      res.status(500).json({ error: 'internal_error' });
    }
  };
}
