/**
 * Content Infrastructure — Entitlement Resolver Interface
 *
 * Abstract interface for entitlement resolution backends.
 * The platform does NOT manage subscriptions — it queries external sources.
 */

import type { ResolvedEntitlements } from '../types.js';

// Re-export for convenience
export type { ResolvedEntitlements };

// ============================================================
// RESOLVER CONTEXT
// ============================================================

export interface ResolverContext {
  sessionId: string;
  /** Integration ID if resolution is triggered via mediation API */
  integrationId?: string;
}

// ============================================================
// RESOLVER CONFIG BASE
// ============================================================

export interface EntitlementResolverConfig {
  /** Logical name for this resolver instance (used in audit logs) */
  name: string;
  /** Default TTL in seconds if the external source does not provide one */
  defaultTtlSeconds: number;
}

// ============================================================
// ENTITLEMENT RESOLVER INTERFACE
// ============================================================

/**
 * Backend-agnostic interface for resolving user entitlements.
 *
 * Implementations must:
 * - Return a ResolvedEntitlements with productIds and metadata
 * - Include resolvedFrom identifying the backend
 * - Include resolvedAt and ttlSeconds for cache management
 * - Throw on unrecoverable errors so callers can apply fallback logic
 */
export interface EntitlementResolver {
  resolve(
    userId: string,
    tenantId: string,
    context: ResolverContext,
  ): Promise<ResolvedEntitlements>;
}
