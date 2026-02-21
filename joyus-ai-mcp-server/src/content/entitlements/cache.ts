/**
 * Content Infrastructure — Session-Scoped Entitlement Cache
 *
 * In-memory TTL cache for resolved entitlements. Avoids repeated external
 * calls within a session. No external cache dependency for MVP.
 */

import type { ResolvedEntitlements } from '../types.js';

// ============================================================
// INTERNAL TYPES
// ============================================================

interface CachedEntitlements {
  entitlements: ResolvedEntitlements;
  /** Unix timestamp (ms) at which this entry expires */
  expiresAt: number;
}

// ============================================================
// CACHE
// ============================================================

export class EntitlementCache {
  private readonly cache = new Map<string, CachedEntitlements>();

  /**
   * Return cached entitlements for sessionId, or null if absent / expired.
   */
  get(sessionId: string): ResolvedEntitlements | null {
    const entry = this.cache.get(sessionId);
    if (!entry) return null;
    if (Date.now() > entry.expiresAt) {
      this.cache.delete(sessionId);
      return null;
    }
    return entry.entitlements;
  }

  /**
   * Store entitlements for sessionId. TTL is taken from entitlements.ttlSeconds
   * when present, otherwise defaults to 3600s.
   */
  set(sessionId: string, entitlements: ResolvedEntitlements): void {
    const ttlSeconds = entitlements.ttlSeconds ?? 3600;
    const expiresAt = Date.now() + ttlSeconds * 1000;
    this.cache.set(sessionId, { entitlements, expiresAt });
  }

  /**
   * Remove entitlements for a specific session (e.g., on session end or
   * forced re-resolution).
   */
  invalidate(sessionId: string): void {
    this.cache.delete(sessionId);
  }

  /**
   * Remove all expired entries. Should be called periodically by a scheduler
   * or cleanup interval to prevent unbounded memory growth.
   */
  cleanup(): void {
    const now = Date.now();
    for (const [key, entry] of this.cache.entries()) {
      if (now > entry.expiresAt) {
        this.cache.delete(key);
      }
    }
  }

  /** Current number of cached sessions (including potentially expired ones). */
  get size(): number {
    return this.cache.size;
  }
}
