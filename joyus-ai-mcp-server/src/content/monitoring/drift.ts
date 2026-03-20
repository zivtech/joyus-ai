/**
 * Drift Monitor — background service that scores recent generations for
 * voice drift and persists aggregate drift reports per profile.
 */

import { eq, and, isNull, gte, isNotNull, desc } from 'drizzle-orm';
import { createId } from '@paralleldrive/cuid2';
import { contentGenerationLogs, contentDriftReports } from '../schema.js';
import type { VoiceAnalyzer, DriftAnalysis } from './voice-analyzer.js';
import type { DrizzleClient } from '../../db/types.js';

const MAX_BATCH = 100;

export class DriftMonitor {
  private intervalId: ReturnType<typeof setInterval> | null = null;

  constructor(
    private readonly analyzer: VoiceAnalyzer,
    private readonly db: DrizzleClient,
  ) {}

  /**
   * Score all unscored generation logs within the given window that have a
   * profileId, then write aggregate drift reports per profile.
   */
  async evaluateRecentGenerations(windowHours = 24): Promise<void> {
    const windowStart = new Date(Date.now() - windowHours * 60 * 60 * 1000);

    const logs = await this.db
      .select()
      .from(contentGenerationLogs)
      .where(
        and(
          isNull(contentGenerationLogs.driftScore),
          isNotNull(contentGenerationLogs.profileId),
          gte(contentGenerationLogs.createdAt, windowStart),
        ),
      )
      .limit(MAX_BATCH);

    if (logs.length === 0) return;

    // Group logs by profileId
    const byProfile = new Map<string, typeof logs>();
    for (const log of logs) {
      const pid = log.profileId;
      if (!pid) continue;
      if (!byProfile.has(pid)) byProfile.set(pid, []);
      byProfile.get(pid)!.push(log);
    }

    // Analyze each profile group
    for (const [profileId, profileLogs] of byProfile) {
      const analyses: DriftAnalysis[] = [];

      for (const log of profileLogs) {
        const content = log.query;
        const analysis = await this.analyzer.analyze(
          content,
          profileId,
          log.tenantId,
        );
        analyses.push(analysis);

        await this.db
          .update(contentGenerationLogs)
          .set({ driftScore: analysis.overallScore })
          .where(eq(contentGenerationLogs.id, log.id));
      }

      if (analyses.length > 0) {
        await this.generateReport(
          profileLogs[0].tenantId,
          profileId,
          windowStart,
          new Date(),
          analyses,
        );
      }
    }
  }

  private async generateReport(
    tenantId: string,
    profileId: string,
    windowStart: Date,
    windowEnd: Date,
    analyses: DriftAnalysis[],
  ): Promise<void> {
    if (analyses.length === 0) return;

    const overallDriftScore =
      analyses.reduce((sum, a) => sum + a.overallScore, 0) / analyses.length;

    // Aggregate dimension scores across all analyses
    const dimTotals: Record<string, { sum: number; count: number }> = {};
    for (const a of analyses) {
      for (const [dim, score] of Object.entries(a.dimensionScores)) {
        if (!dimTotals[dim]) dimTotals[dim] = { sum: 0, count: 0 };
        dimTotals[dim].sum += score;
        dimTotals[dim].count++;
      }
    }
    const dimensionScores: Record<string, number> = {};
    for (const [dim, { sum, count }] of Object.entries(dimTotals)) {
      dimensionScores[dim] = sum / count;
    }

    // Deduplicate recommendations across analyses
    const recommendations = [
      ...new Set(analyses.flatMap((a) => a.recommendations)),
    ];

    await this.db.insert(contentDriftReports).values({
      id: createId(),
      tenantId,
      profileId,
      windowStart,
      windowEnd,
      generationsEvaluated: analyses.length,
      overallDriftScore,
      dimensionScores,
      recommendations,
    });
  }

  /**
   * Start the background evaluation loop.
   * Idempotent — calling start() twice has no effect.
   */
  start(intervalMinutes = 60): void {
    if (this.intervalId) return;
    this.intervalId = setInterval(() => {
      this.evaluateRecentGenerations().catch((err) => {
        console.error('[drift-monitor] Evaluation failed:', err);
      });
    }, intervalMinutes * 60 * 1000);
    console.log(`[drift-monitor] Started (interval: ${intervalMinutes}m)`);
  }

  stop(): void {
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
      console.log('[drift-monitor] Stopped');
    }
  }
}

// ============================================================
// QUERY HELPERS (used by MCP monitoring tools)
// ============================================================

/**
 * Returns the most recent drift report for a given tenant + profile,
 * optionally filtered to reports whose window ended within the last N days.
 */
export async function getLatestDriftReport(
  db: DrizzleClient,
  tenantId: string,
  profileId: string,
): Promise<typeof contentDriftReports.$inferSelect | null> {
  const rows = await db
    .select()
    .from(contentDriftReports)
    .where(
      and(
        eq(contentDriftReports.tenantId, tenantId),
        eq(contentDriftReports.profileId, profileId),
      ),
    )
    .orderBy(desc(contentDriftReports.windowEnd))
    .limit(1);

  return rows[0] ?? null;
}

/**
 * Returns the latest drift report for each profile belonging to a tenant.
 * Useful for a tenant-level drift summary dashboard.
 */
export async function getDriftSummary(
  db: DrizzleClient,
  tenantId: string,
): Promise<Array<typeof contentDriftReports.$inferSelect>> {
  const reports = await db
    .select()
    .from(contentDriftReports)
    .where(eq(contentDriftReports.tenantId, tenantId))
    .orderBy(desc(contentDriftReports.windowEnd));

  // Keep only the latest report per profileId
  const byProfile = new Map<
    string,
    typeof contentDriftReports.$inferSelect
  >();
  for (const report of reports) {
    if (!byProfile.has(report.profileId)) {
      byProfile.set(report.profileId, report);
    }
  }
  return Array.from(byProfile.values());
}
