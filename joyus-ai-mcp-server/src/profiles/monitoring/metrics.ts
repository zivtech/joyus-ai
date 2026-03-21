/**
 * Profile Monitoring — In-Memory Metrics
 *
 * Lightweight counters for generation throughput, failure rates,
 * rollback counts, and cache hit/miss ratios.
 * Counters are per-process (no external store required for MVP).
 */

// ============================================================
// TYPES
// ============================================================

export interface TenantCounters {
  generationCount: number;
  generationFailures: number;
  totalDurationMs: number;
  rollbackCount: number;
  cacheHits: number;
  cacheMisses: number;
}

export interface ProfileMetricsSummary {
  tenantId: string | null;
  generationCount: number;
  generationFailures: number;
  failureRate: number;
  avgDurationMs: number;
  rollbackCount: number;
  cacheHits: number;
  cacheMisses: number;
  cacheHitRate: number;
  collectedAt: string;
}

// ============================================================
// METRICS COLLECTOR
// ============================================================

export class ProfileMetrics {
  /** Per-tenant counters keyed by tenantId. */
  private readonly tenantCounters = new Map<string, TenantCounters>();

  /** Global counters (across all tenants). */
  private readonly global: TenantCounters = this.emptyCounters();

  // ----------------------------------------------------------
  // RECORD METHODS
  // ----------------------------------------------------------

  /** Record a completed profile generation (success or failure). */
  recordGeneration(tenantId: string, durationMs: number, success: boolean): void {
    const counters = this.getOrCreate(tenantId);
    counters.generationCount += 1;
    counters.totalDurationMs += durationMs;
    if (!success) {
      counters.generationFailures += 1;
    }

    this.global.generationCount += 1;
    this.global.totalDurationMs += durationMs;
    if (!success) {
      this.global.generationFailures += 1;
    }
  }

  /** Record a profile rollback operation. */
  recordRollback(tenantId: string): void {
    this.getOrCreate(tenantId).rollbackCount += 1;
    this.global.rollbackCount += 1;
  }

  /** Record a cache hit on resolved profile lookup. */
  recordCacheHit(tenantId: string): void {
    this.getOrCreate(tenantId).cacheHits += 1;
    this.global.cacheHits += 1;
  }

  /** Record a cache miss on resolved profile lookup. */
  recordCacheMiss(tenantId: string): void {
    this.getOrCreate(tenantId).cacheMisses += 1;
    this.global.cacheMisses += 1;
  }

  // ----------------------------------------------------------
  // READ METHODS
  // ----------------------------------------------------------

  /**
   * Return aggregated metrics.
   * When tenantId is provided, returns per-tenant summary.
   * When omitted, returns global (cross-tenant) summary.
   */
  getMetrics(tenantId?: string): ProfileMetricsSummary {
    const counters = tenantId ? (this.tenantCounters.get(tenantId) ?? this.emptyCounters()) : this.global;
    return this.summarize(tenantId ?? null, counters);
  }

  /** Return summaries for all tracked tenants. */
  getAllTenantMetrics(): ProfileMetricsSummary[] {
    const summaries: ProfileMetricsSummary[] = [];
    for (const [tenantId, counters] of this.tenantCounters) {
      summaries.push(this.summarize(tenantId, counters));
    }
    return summaries;
  }

  /** Reset all counters (useful for testing). */
  reset(): void {
    this.tenantCounters.clear();
    Object.assign(this.global, this.emptyCounters());
  }

  // ----------------------------------------------------------
  // PRIVATE HELPERS
  // ----------------------------------------------------------

  private getOrCreate(tenantId: string): TenantCounters {
    let counters = this.tenantCounters.get(tenantId);
    if (!counters) {
      counters = this.emptyCounters();
      this.tenantCounters.set(tenantId, counters);
    }
    return counters;
  }

  private emptyCounters(): TenantCounters {
    return {
      generationCount: 0,
      generationFailures: 0,
      totalDurationMs: 0,
      rollbackCount: 0,
      cacheHits: 0,
      cacheMisses: 0,
    };
  }

  private summarize(tenantId: string | null, c: TenantCounters): ProfileMetricsSummary {
    const totalCacheLookups = c.cacheHits + c.cacheMisses;
    return {
      tenantId,
      generationCount: c.generationCount,
      generationFailures: c.generationFailures,
      failureRate: c.generationCount > 0 ? c.generationFailures / c.generationCount : 0,
      avgDurationMs: c.generationCount > 0 ? Math.round(c.totalDurationMs / c.generationCount) : 0,
      rollbackCount: c.rollbackCount,
      cacheHits: c.cacheHits,
      cacheMisses: c.cacheMisses,
      cacheHitRate: totalCacheLookups > 0 ? c.cacheHits / totalCacheLookups : 0,
      collectedAt: new Date().toISOString(),
    };
  }
}
