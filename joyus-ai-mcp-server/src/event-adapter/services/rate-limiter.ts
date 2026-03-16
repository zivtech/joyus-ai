/**
 * Event Adapter — Rate Limiter
 *
 * In-memory sliding window rate limiter for webhook ingestion.
 * Enforces per-source and per-tenant limits simultaneously.
 *
 * V1 uses an in-memory Map — appropriate for single-process deployments.
 * TODO: At scale, replace with Redis ZSET per key using
 * ZADD + ZREMRANGEBYSCORE + ZCARD pipeline for distributed rate limiting.
 */

// ============================================================
// TYPES
// ============================================================

export interface RateLimitResult {
  allowed: boolean;
  retryAfterMs?: number;
  /** Current count within the window (for headers) */
  currentCount: number;
  /** Maximum allowed within the window */
  limit: number;
  /** Window reset time as epoch seconds */
  resetAt: number;
}

export interface RateLimiterConfig {
  /** Max requests per source per window (default: 60) */
  perSourceLimit?: number;
  /** Max requests per tenant per window (default: 300) */
  perTenantLimit?: number;
  /** Window duration in ms (default: 60000 = 1 minute) */
  windowMs?: number;
}

// ============================================================
// RATE LIMITER
// ============================================================

const DEFAULT_PER_SOURCE_LIMIT = 60;
const DEFAULT_PER_TENANT_LIMIT = 300;
const DEFAULT_WINDOW_MS = 60_000;

export class RateLimiter {
  private windows = new Map<string, number[]>();
  private readonly perSourceLimit: number;
  private readonly perTenantLimit: number;
  private readonly windowMs: number;

  constructor(config: RateLimiterConfig = {}) {
    this.perSourceLimit = config.perSourceLimit ?? DEFAULT_PER_SOURCE_LIMIT;
    this.perTenantLimit = config.perTenantLimit ?? DEFAULT_PER_TENANT_LIMIT;
    this.windowMs = config.windowMs ?? DEFAULT_WINDOW_MS;
  }

  /**
   * Check and record a request against both source and tenant limits.
   * Both limits must pass for the request to be allowed.
   */
  checkRateLimit(sourceId: string, tenantId: string): RateLimitResult {
    const now = Date.now();

    const sourceResult = this.checkKey(`source:${sourceId}`, this.perSourceLimit, now);
    const tenantResult = this.checkKey(`tenant:${tenantId}`, this.perTenantLimit, now);

    // Use the more restrictive result
    if (!sourceResult.allowed || !tenantResult.allowed) {
      const retryAfterMs = Math.max(
        sourceResult.retryAfterMs ?? 0,
        tenantResult.retryAfterMs ?? 0,
      );

      // Report the limit that was hit
      const limitResult = !sourceResult.allowed ? sourceResult : tenantResult;
      return {
        allowed: false,
        retryAfterMs,
        currentCount: limitResult.currentCount,
        limit: limitResult.limit,
        resetAt: limitResult.resetAt,
      };
    }

    // Record the request for both keys
    this.recordRequest(`source:${sourceId}`, now);
    this.recordRequest(`tenant:${tenantId}`, now);

    // Return the more restrictive remaining count
    const sourceRemaining = this.perSourceLimit - sourceResult.currentCount - 1;
    const tenantRemaining = this.perTenantLimit - tenantResult.currentCount - 1;

    if (sourceRemaining <= tenantRemaining) {
      return {
        allowed: true,
        currentCount: sourceResult.currentCount + 1,
        limit: this.perSourceLimit,
        resetAt: sourceResult.resetAt,
      };
    }
    return {
      allowed: true,
      currentCount: tenantResult.currentCount + 1,
      limit: this.perTenantLimit,
      resetAt: tenantResult.resetAt,
    };
  }

  private checkKey(
    key: string,
    limit: number,
    now: number,
  ): RateLimitResult {
    this.evictExpired(key, now);

    const timestamps = this.windows.get(key) ?? [];
    const currentCount = timestamps.length;
    const windowStart = now - this.windowMs;
    const resetAt = Math.ceil((windowStart + this.windowMs) / 1000);

    if (currentCount >= limit) {
      // Find earliest timestamp to compute retry-after
      const earliest = timestamps[0] ?? now;
      const retryAfterMs = earliest + this.windowMs - now;
      return {
        allowed: false,
        retryAfterMs: Math.max(retryAfterMs, 1),
        currentCount,
        limit,
        resetAt,
      };
    }

    return { allowed: true, currentCount, limit, resetAt };
  }

  private recordRequest(key: string, now: number): void {
    const timestamps = this.windows.get(key) ?? [];
    timestamps.push(now);
    this.windows.set(key, timestamps);
  }

  private evictExpired(key: string, now: number): void {
    const timestamps = this.windows.get(key);
    if (!timestamps) return;

    const windowStart = now - this.windowMs;
    // Remove timestamps outside the window
    while (timestamps.length > 0 && timestamps[0] <= windowStart) {
      timestamps.shift();
    }

    if (timestamps.length === 0) {
      this.windows.delete(key);
    }
  }

  /** Clear all state (for testing) */
  reset(): void {
    this.windows.clear();
  }
}
