/**
 * Event Adapter — Health Check Route (WP09)
 *
 * Endpoint for monitoring aggregate metrics and system health:
 *   GET /health — aggregate event metrics and scheduler status (T048)
 *
 * No auth required. Always returns HTTP 200 regardless of health status.
 * Status field reflects operational state: healthy | degraded | unhealthy.
 */

import { Router, type Request, type Response } from 'express';
import { eq, and, count, sql, gte, lt } from 'drizzle-orm';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';

import { webhookEvents, eventScheduledTasks } from '../schema.js';
import type { SchedulerService } from '../services/scheduler.js';

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

// ============================================================
// TYPES
// ============================================================

export interface HealthRouterDeps {
  db: NodePgDatabase<Record<string, unknown>>;
  scheduler?: SchedulerService;
}

interface HealthResponse {
  status: 'healthy' | 'degraded' | 'unhealthy';
  timestamp: string;
  events: { last_hour: number; last_24h: number };
  delivery: { delivered: number; failed: number; success_rate_pct: number };
  queue: { pending: number; processing: number; dead_letter: number };
  schedules: { active: number; overdue: number };
  latency: { avg_ms: number | null; p95_ms: number | null };
  scheduler: { last_tick: string | null; healthy: boolean };
}

// ============================================================
// ROUTE FACTORY
// ============================================================

export function createHealthRouter(deps: HealthRouterDeps): Router {
  const router = Router();

  // GET /health — aggregate metrics
  router.get('/health', healthHandler(deps));

  return router;
}

// ============================================================
// T048: HEALTH CHECK
// ============================================================

function healthHandler(deps: HealthRouterDeps) {
  return async (req: Request, res: Response): Promise<void> => {
    const tenantId = resolveTenantId(req);
    const now = new Date();
    const oneHourAgo = new Date(now.getTime() - 60 * 60 * 1000);
    const twentyFourHoursAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000);
    const fiveMinutesAgo = new Date(now.getTime() - 5 * 60 * 1000);
    const twoMinutesAgo = new Date(now.getTime() - 2 * 60 * 1000);

    // Build optional tenant filter for webhookEvents queries.
    // Schedule counts are platform-scoped (no tenant filter).
    const tenantFilter = tenantId ? eq(webhookEvents.tenantId, tenantId) : undefined;

    try {
      const [
        lastHourResult,
        last24hResult,
        deliveredResult,
        failedResult,
        pendingResult,
        processingResult,
        deadLetterResult,
        activeSchedulesResult,
        overdueSchedulesResult,
        avgLatencyResult,
      ] = await Promise.all([
        // events.last_hour (tenant-scoped when tenantId present)
        deps.db
          .select({ count: count() })
          .from(webhookEvents)
          .where(and(tenantFilter, gte(webhookEvents.createdAt, oneHourAgo))),

        // events.last_24h (tenant-scoped when tenantId present)
        deps.db
          .select({ count: count() })
          .from(webhookEvents)
          .where(and(tenantFilter, gte(webhookEvents.createdAt, twentyFourHoursAgo))),

        // delivery.delivered (last 24h, tenant-scoped)
        deps.db
          .select({ count: count() })
          .from(webhookEvents)
          .where(
            and(
              tenantFilter,
              eq(webhookEvents.status, 'delivered'),
              gte(webhookEvents.createdAt, twentyFourHoursAgo),
            ),
          ),

        // delivery.failed (last 24h — failed + dead_letter, tenant-scoped)
        deps.db
          .select({ count: count() })
          .from(webhookEvents)
          .where(
            and(
              tenantFilter,
              sql`${webhookEvents.status} IN ('failed', 'dead_letter')`,
              gte(webhookEvents.createdAt, twentyFourHoursAgo),
            ),
          ),

        // queue.pending (tenant-scoped)
        deps.db
          .select({ count: count() })
          .from(webhookEvents)
          .where(and(tenantFilter, eq(webhookEvents.status, 'pending'))),

        // queue.processing (tenant-scoped)
        deps.db
          .select({ count: count() })
          .from(webhookEvents)
          .where(and(tenantFilter, eq(webhookEvents.status, 'processing'))),

        // queue.dead_letter (tenant-scoped)
        deps.db
          .select({ count: count() })
          .from(webhookEvents)
          .where(and(tenantFilter, eq(webhookEvents.status, 'dead_letter'))),

        // schedules.active — platform-scoped (no tenant filter)
        deps.db
          .select({ count: count() })
          .from(eventScheduledTasks)
          .where(eq(eventScheduledTasks.lifecycleState, 'active')),

        // schedules.overdue: active AND next_fire_at < now() - 5 min — platform-scoped
        deps.db
          .select({ count: count() })
          .from(eventScheduledTasks)
          .where(
            and(
              eq(eventScheduledTasks.lifecycleState, 'active'),
              lt(eventScheduledTasks.nextFireAt, fiveMinutesAgo),
            ),
          ),

        // latency.avg_ms: avg processing_duration_ms for delivered events in last 24h (tenant-scoped)
        deps.db
          .select({
            avg: sql<number>`avg(${webhookEvents.processingDurationMs})`,
          })
          .from(webhookEvents)
          .where(
            and(
              tenantFilter,
              eq(webhookEvents.status, 'delivered'),
              gte(webhookEvents.createdAt, twentyFourHoursAgo),
            ),
          ),
      ]);

      const lastHour = Number(lastHourResult[0]?.count ?? 0);
      const last24h = Number(last24hResult[0]?.count ?? 0);
      const delivered = Number(deliveredResult[0]?.count ?? 0);
      const failed = Number(failedResult[0]?.count ?? 0);
      const pending = Number(pendingResult[0]?.count ?? 0);
      const processing = Number(processingResult[0]?.count ?? 0);
      const deadLetter = Number(deadLetterResult[0]?.count ?? 0);
      const activeSchedules = Number(activeSchedulesResult[0]?.count ?? 0);
      const overdueSchedules = Number(overdueSchedulesResult[0]?.count ?? 0);
      const rawAvg = avgLatencyResult[0]?.avg;
      const avgMs = rawAvg != null ? Math.round(Number(rawAvg) * 10) / 10 : null;

      // success_rate_pct: (delivered / (delivered + failed)) * 100
      const totalFinished = delivered + failed;
      const successRatePct =
        totalFinished > 0
          ? Math.round((delivered / totalFinished) * 1000) / 10
          : 100;

      // Scheduler status
      const lastTickAt = deps.scheduler?.lastTickAt ?? null;
      const schedulerHealthy =
        lastTickAt != null ? lastTickAt >= twoMinutesAgo : deps.scheduler == null;

      // Overall status computation
      let status: 'healthy' | 'degraded' | 'unhealthy';
      if (pending > 1000 || !schedulerHealthy) {
        status = 'unhealthy';
      } else if (deadLetter > 50 || successRatePct < 90 || overdueSchedules > 0) {
        status = 'degraded';
      } else {
        status = 'healthy';
      }

      const body: HealthResponse = {
        status,
        timestamp: now.toISOString(),
        events: {
          last_hour: lastHour,
          last_24h: last24h,
        },
        delivery: {
          delivered,
          failed,
          success_rate_pct: successRatePct,
        },
        queue: {
          pending,
          processing,
          dead_letter: deadLetter,
        },
        schedules: {
          active: activeSchedules,
          overdue: overdueSchedules,
        },
        latency: {
          avg_ms: avgMs,
          // TODO: implement p95 via raw SQL percentile_cont() query
          p95_ms: null,
        },
        scheduler: {
          last_tick: lastTickAt?.toISOString() ?? null,
          healthy: schedulerHealthy,
        },
      };

      // Always return 200 — caller inspects status field
      res.status(200).json(body);
    } catch (err) {
      console.error('[health] metrics error', err);
      res.status(500).json({ error: 'internal_error' });
    }
  };
}
