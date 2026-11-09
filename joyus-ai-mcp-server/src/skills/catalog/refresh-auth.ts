/**
 * Refresh-endpoint bearer authentication (refresh.md): a secret distinct from source-read
 * credentials, MCP user tokens, and the cursor key, bound to exactly one configured
 * tenant/source via `CATALOG_REFRESH_TENANT_ID`. No source/tenant selector is ever
 * accepted from path, query or body.
 */
import { timingSafeEqual } from 'node:crypto';

import { resolveAliasedSecret, type CatalogEnvConfig } from './config.js';

const BEARER_PREFIX = 'Bearer ';

/** Resolves the configured refresh secret value at request time; never cached, never logged. */
export function resolveRefreshSecret(
  config: CatalogEnvConfig,
  env: NodeJS.ProcessEnv = process.env
): string | undefined {
  return resolveAliasedSecret(config.refreshAuthSecretAlias, env);
}

/** The single tenant/source the refresh secret is bound to. Independent of auth so a missing
 * mapping can be reported (503) only after authentication has already succeeded. */
export function resolveRefreshTenantBinding(
  env: NodeJS.ProcessEnv = process.env
): string | undefined {
  const tenantId = env.CATALOG_REFRESH_TENANT_ID;
  return tenantId && tenantId.trim().length > 0 ? tenantId : undefined;
}

/** Constant-time bearer comparison; never throws, never logs either value. */
export function verifyRefreshBearer(
  authorizationHeader: string | undefined,
  expectedSecret: string
): boolean {
  if (!authorizationHeader || !authorizationHeader.startsWith(BEARER_PREFIX)) return false;
  const provided = Buffer.from(authorizationHeader.slice(BEARER_PREFIX.length), 'utf8');
  const expected = Buffer.from(expectedSecret, 'utf8');
  if (provided.length !== expected.length) {
    // Compare against itself so an early length mismatch does not create a shorter-path timing signal.
    timingSafeEqual(provided, provided);
    return false;
  }
  return timingSafeEqual(provided, expected);
}

/** Per-source manual-trigger rate limit: at most one new attempt per minute per source (burst one). */
export class ManualRefreshRateLimiter {
  private readonly lastAcceptedAtMs = new Map<string, number>();

  constructor(
    private readonly windowMs: number,
    private readonly now: () => number = Date.now
  ) {}

  tryAcquire(sourceKey: string): boolean {
    const current = this.now();
    const last = this.lastAcceptedAtMs.get(sourceKey);
    if (last !== undefined && current - last < this.windowMs) return false;
    this.lastAcceptedAtMs.set(sourceKey, current);
    return true;
  }
}
