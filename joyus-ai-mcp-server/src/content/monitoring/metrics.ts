/**
 * Content Metrics Collector
 *
 * Computes operational metrics from operation_logs and entity tables.
 * All aggregations run against the last hour unless otherwise noted.
 * No separate metrics store needed for MVP — queries use indexed columns.
 */

import { sql, eq, and, gte } from 'drizzle-orm';

import {
  db,
  contentOperationLogs,
  contentDriftReports,
} from '../../db/client.js';

// ============================================================
// METRIC TYPES
// ============================================================

export interface SyncMetrics {
  totalSyncs: number;
  successRate: number;
  avgDurationMs: number;
  activeSyncs: number;
}

export interface SearchMetrics {
  totalQueries: number;
  avgDurationMs: number;
  p95DurationMs: number;
}

export interface EntitlementMetrics {
  totalResolutions: number;
  avgDurationMs: number;
  cacheHitRate: number;
  failureRate: number;
}

export interface GenerationMetrics {
  totalGenerations: number;
  avgCitationCount: number;
  avgResponseLength: number;
}

export interface DriftMetrics {
  monitoredProfiles: number;
  avgDriftScore: number;
  profilesAboveThreshold: number;
}

export interface ContentMetrics {
  sync: SyncMetrics;
  search: SearchMetrics;
  entitlements: EntitlementMetrics;
  generation: GenerationMetrics;
  drift: DriftMetrics;
  collectedAt: string;
}

// ============================================================
// METRICS COLLECTOR
// ============================================================

/** Threshold above which a profile is considered high-drift. */
const DRIFT_THRESHOLD = 0.7;

function oneHourAgo(): Date {
  return new Date(Date.now() - 60 * 60 * 1000);
}

export class MetricsCollector {
  async getMetrics(): Promise<ContentMetrics> {
    const [sync, search, entitlements, generation, drift] = await Promise.all([
      this.getSyncMetrics(),
      this.getSearchMetrics(),
      this.getEntitlementMetrics(),
      this.getGenerationMetrics(),
      this.getDriftMetrics(),
    ]);

    return { sync, search, entitlements, generation, drift, collectedAt: new Date().toISOString() };
  }

  // ============================================================
  // METRIC CATEGORIES
  // ============================================================

  private async getSyncMetrics(): Promise<SyncMetrics> {
    const window = oneHourAgo();

    const rows = await db
      .select({
        total: sql<number>`count(*)::int`,
        successes: sql<number>`count(*) filter (where ${contentOperationLogs.success} = true)::int`,
        avgDuration: sql<number>`coalesce(avg(${contentOperationLogs.durationMs}), 0)::float`,
      })
      .from(contentOperationLogs)
      .where(
        and(
          eq(contentOperationLogs.operation, 'sync'),
          gte(contentOperationLogs.createdAt, window),
        ),
      );

    // Active syncs: sync operations that started recently and have no success/failure logged yet
    // Approximated as syncs with very short duration (still running not observable from logs alone)
    const activeSyncsRows = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(contentOperationLogs)
      .where(
        and(
          eq(contentOperationLogs.operation, 'sync'),
          eq(contentOperationLogs.success, false),
          gte(contentOperationLogs.createdAt, new Date(Date.now() - 5 * 60 * 1000)), // last 5 minutes
        ),
      );

    const row = rows[0];
    const total = row?.total ?? 0;
    const successes = row?.successes ?? 0;

    return {
      totalSyncs: total,
      successRate: total > 0 ? successes / total : 1,
      avgDurationMs: Math.round(row?.avgDuration ?? 0),
      activeSyncs: activeSyncsRows[0]?.count ?? 0,
    };
  }

  private async getSearchMetrics(): Promise<SearchMetrics> {
    const window = oneHourAgo();

    const rows = await db
      .select({
        total: sql<number>`count(*)::int`,
        avgDuration: sql<number>`coalesce(avg(${contentOperationLogs.durationMs}), 0)::float`,
        p95Duration: sql<number>`coalesce(percentile_cont(0.95) within group (order by ${contentOperationLogs.durationMs}), 0)::float`,
      })
      .from(contentOperationLogs)
      .where(
        and(
          eq(contentOperationLogs.operation, 'search'),
          gte(contentOperationLogs.createdAt, window),
        ),
      );

    const row = rows[0];
    return {
      totalQueries: row?.total ?? 0,
      avgDurationMs: Math.round(row?.avgDuration ?? 0),
      p95DurationMs: Math.round(row?.p95Duration ?? 0),
    };
  }

  private async getEntitlementMetrics(): Promise<EntitlementMetrics> {
    const window = oneHourAgo();

    const rows = await db
      .select({
        total: sql<number>`count(*)::int`,
        failures: sql<number>`count(*) filter (where ${contentOperationLogs.success} = false)::int`,
        avgDuration: sql<number>`coalesce(avg(${contentOperationLogs.durationMs}), 0)::float`,
        cacheHits: sql<number>`count(*) filter (where (${contentOperationLogs.metadata}->>'cacheHit')::boolean = true)::int`,
      })
      .from(contentOperationLogs)
      .where(
        and(
          eq(contentOperationLogs.operation, 'resolve'),
          gte(contentOperationLogs.createdAt, window),
        ),
      );

    const row = rows[0];
    const total = row?.total ?? 0;
    const failures = row?.failures ?? 0;
    const cacheHits = row?.cacheHits ?? 0;

    return {
      totalResolutions: total,
      avgDurationMs: Math.round(row?.avgDuration ?? 0),
      cacheHitRate: total > 0 ? cacheHits / total : 0,
      failureRate: total > 0 ? failures / total : 0,
    };
  }

  private async getGenerationMetrics(): Promise<GenerationMetrics> {
    const window = oneHourAgo();

    const rows = await db
      .select({
        total: sql<number>`count(*)::int`,
        avgCitations: sql<number>`coalesce(avg((${contentOperationLogs.metadata}->>'citationCount')::int), 0)::float`,
        avgResponseLength: sql<number>`coalesce(avg((${contentOperationLogs.metadata}->>'responseLength')::int), 0)::float`,
      })
      .from(contentOperationLogs)
      .where(
        and(
          eq(contentOperationLogs.operation, 'generate'),
          gte(contentOperationLogs.createdAt, window),
        ),
      );

    const row = rows[0];
    return {
      totalGenerations: row?.total ?? 0,
      avgCitationCount: Math.round((row?.avgCitations ?? 0) * 10) / 10,
      avgResponseLength: Math.round(row?.avgResponseLength ?? 0),
    };
  }

  private async getDriftMetrics(): Promise<DriftMetrics> {
    // Query latest drift reports (last 24 hours) to compute profile-level aggregates
    const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);

    const rows = await db
      .select({
        monitoredProfiles: sql<number>`count(distinct ${contentDriftReports.profileId})::int`,
        avgDriftScore: sql<number>`coalesce(avg(${contentDriftReports.overallDriftScore}), 0)::float`,
        profilesAboveThreshold: sql<number>`count(distinct ${contentDriftReports.profileId}) filter (where ${contentDriftReports.overallDriftScore} > ${DRIFT_THRESHOLD})::int`,
      })
      .from(contentDriftReports)
      .where(gte(contentDriftReports.createdAt, oneDayAgo));

    const row = rows[0];
    return {
      monitoredProfiles: row?.monitoredProfiles ?? 0,
      avgDriftScore: Math.round((row?.avgDriftScore ?? 0) * 1000) / 1000,
      profilesAboveThreshold: row?.profilesAboveThreshold ?? 0,
    };
  }
}
