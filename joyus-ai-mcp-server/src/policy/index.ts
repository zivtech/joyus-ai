/**
 * Provider selection (spec 016 FR-31): `POLICY_SERVICE_URL` and
 * `POLICY_SERVICE_TOKEN` select `HttpPolicyProvider`; otherwise
 * `AllowAllPolicyProvider`, which enforces nothing and runs no lookups, so the
 * suite is unchanged by default (SC-06).
 */

import { config } from '../config.js';
import { db } from '../db/client.js';

import { dbDefaultTenantLookup, type PolicyDeps } from './enforce.js';
import { AllowAllPolicyProvider, HttpPolicyProvider, type PolicyProvider } from './provider.js';

export * from './enforce.js';
export * from './provider.js';
export { postToolRegistry } from './registry.js';

let provider: PolicyProvider | null = null;

export function providerFromEnv(env: { POLICY_SERVICE_URL?: string; POLICY_SERVICE_TOKEN?: string } = config): PolicyProvider {
  if (env.POLICY_SERVICE_URL && env.POLICY_SERVICE_TOKEN) {
    return new HttpPolicyProvider({ baseUrl: env.POLICY_SERVICE_URL, serviceToken: env.POLICY_SERVICE_TOKEN });
  }
  return new AllowAllPolicyProvider();
}

export function getPolicyProvider(): PolicyProvider {
  provider ??= providerFromEnv();
  return provider;
}

/** Inject a provider (tests, or a host that builds its own). `null` restores env selection. */
export function setPolicyProvider(next: PolicyProvider | null): void {
  provider = next;
}

export function policyDeps(): PolicyDeps {
  return { provider: getPolicyProvider(), lookup: dbDefaultTenantLookup(db as never) };
}
