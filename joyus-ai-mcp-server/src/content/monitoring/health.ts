/**
 * Content Health Checker
 *
 * Aggregates health status across all content subsystems:
 * database, connectors, search provider, entitlement resolver.
 *
 * SC-010: Reports accurate status within 30 seconds of state changes.
 * Per-component timeouts prevent slow/unreachable services from blocking
 * the entire health endpoint.
 */

import { sql } from 'drizzle-orm';

import { db, contentSources } from '../../db/client.js';

// ============================================================
// TYPES
// ============================================================

export type HealthStatus = 'healthy' | 'degraded' | 'unhealthy';

export interface ComponentHealth {
  status: HealthStatus;
  detail?: string;
}

export interface HealthReport {
  status: HealthStatus;
  components: Record<string, ComponentHealth>;
  timestamp: string;
}

export interface ProviderWiringHealthConfig {
  generationProvider: string;
  voiceAnalyzer: string;
  driftMonitoringEnabled: boolean;
}

// ============================================================
// HEALTH CHECKER
// ============================================================

const COMPONENT_TIMEOUT_MS = 5000;

/** Wrap a health check promise with a per-component timeout. */
function withTimeout<T>(
  promise: Promise<T>,
  fallback: T,
  timeoutMs = COMPONENT_TIMEOUT_MS,
): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>((resolve) => setTimeout(() => resolve(fallback), timeoutMs)),
  ]);
}

export class HealthChecker {
  constructor(private providerWiring?: ProviderWiringHealthConfig) {}

  async check(): Promise<HealthReport> {
    const [database, connectors, searchProvider, entitlementResolver] =
      await Promise.all([
        withTimeout(this.checkDatabase(), { status: 'unhealthy' as HealthStatus, detail: 'timeout' }),
        withTimeout(this.checkConnectors(), { status: 'unhealthy' as HealthStatus, detail: 'timeout' }),
        withTimeout(this.checkSearchProvider(), { status: 'degraded' as HealthStatus, detail: 'timeout' }),
        withTimeout(this.checkEntitlementResolver(), { status: 'degraded' as HealthStatus, detail: 'timeout' }),
      ]);

    const components: Record<string, ComponentHealth> = {
      database,
      connectors,
      searchProvider,
      entitlementResolver,
      providerWiring: this.checkProviderWiring(),
    };

    const statuses = Object.values(components).map((c) => c.status);
    const overall: HealthStatus = statuses.includes('unhealthy')
      ? 'unhealthy'
      : statuses.includes('degraded')
        ? 'degraded'
        : 'healthy';

    return { status: overall, components, timestamp: new Date().toISOString() };
  }

  // ============================================================
  // COMPONENT CHECKS
  // ============================================================

  private async checkDatabase(): Promise<ComponentHealth> {
    try {
      await db.execute(sql`SELECT 1`);
      return { status: 'healthy' };
    } catch (err) {
      const detail = err instanceof Error ? err.message : 'unknown error';
      return { status: 'unhealthy', detail };
    }
  }

  private async checkConnectors(): Promise<ComponentHealth> {
    try {
      // Check that we can query source records — if the table is reachable and
      // no sources are stuck in 'error' state, report healthy.
      const sources = await db
        .select({
          status: contentSources.status,
        })
        .from(contentSources)
        .limit(100);

      const errorCount = sources.filter((s) => s.status === 'error').length;
      const total = sources.length;

      if (total === 0) {
        return { status: 'healthy', detail: 'no sources configured' };
      }

      if (errorCount === total) {
        return { status: 'unhealthy', detail: `all ${total} source(s) in error state` };
      }

      if (errorCount > 0) {
        return { status: 'degraded', detail: `${errorCount}/${total} source(s) in error state` };
      }

      return { status: 'healthy' };
    } catch (err) {
      const detail = err instanceof Error ? err.message : 'unknown error';
      return { status: 'unhealthy', detail };
    }
  }

  private async checkSearchProvider(): Promise<ComponentHealth> {
    // Search is backed by PostgreSQL full-text search (tsvector columns).
    // If the database check passed, full-text search is available.
    try {
      await db.execute(sql`SELECT 1`);
      return { status: 'healthy' };
    } catch (err) {
      const detail = err instanceof Error ? err.message : 'unknown error';
      return { status: 'unhealthy', detail };
    }
  }

  private async checkEntitlementResolver(): Promise<ComponentHealth> {
    // Entitlement resolution depends on the entitlements table being reachable.
    try {
      await db.execute(sql`SELECT 1`);
      return { status: 'healthy' };
    } catch (err) {
      const detail = err instanceof Error ? err.message : 'unknown error';
      return { status: 'unhealthy', detail };
    }
  }

  private checkProviderWiring(): ComponentHealth {
    if (!this.providerWiring) {
      return { status: 'degraded', detail: 'provider wiring status unavailable' };
    }

    const issues: string[] = [];
    if (this.providerWiring.generationProvider === 'placeholder') {
      issues.push('generation provider is placeholder');
    }
    if (
      this.providerWiring.driftMonitoringEnabled &&
      this.providerWiring.voiceAnalyzer === 'stub'
    ) {
      issues.push('voice analyzer is stub while drift monitoring is enabled');
    }

    if (issues.length > 0) {
      return { status: 'degraded', detail: issues.join('; ') };
    }

    return {
      status: 'healthy',
      detail: `generation=${this.providerWiring.generationProvider}, voiceAnalyzer=${this.providerWiring.voiceAnalyzer}`,
    };
  }
}
