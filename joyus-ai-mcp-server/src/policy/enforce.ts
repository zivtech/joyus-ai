/**
 * Where the policy decision is applied (spec 016 FR-24). All three entry points
 * share these helpers so the fail-closed rules live in one place:
 *
 * - no default membership → empty list, every call refused;
 * - provider unavailable past its grace window → the same;
 * - `executeTool` decides on the default tenant always, and on the resolved
 *   tenant too when the call resolved to a different real tenant by membership.
 *
 * Ordering with entitlements (FR-33): the spec 015 FeatureGate, when it lands,
 * runs before this check in `executeTool`. Entitlement asks whether the feature
 * is licensed; policy asks whether this user may use this tool. Both must allow.
 */

import { eq, and } from 'drizzle-orm';

import { tenantMemberships } from '../db/schema.js';

import { AllowAllPolicyProvider, type PolicyProvider, PolicyUnavailableError } from './provider.js';

export type PolicyRefusal = 'policy_denied' | 'no_default_membership' | 'policy_unavailable';

export class ToolPolicyError extends Error {
  constructor(
    readonly code: PolicyRefusal,
    readonly toolName: string,
    readonly tenantId: string | null,
  ) {
    super(ToolPolicyError.describe(code, toolName, tenantId));
    this.name = 'ToolPolicyError';
  }

  private static describe(code: PolicyRefusal, toolName: string, tenantId: string | null): string {
    switch (code) {
      case 'policy_denied':
        return `Tool "${toolName}" is denied by policy for tenant ${tenantId}`;
      case 'no_default_membership':
        return `Tool "${toolName}" refused: the user has no default tenant membership`;
      case 'policy_unavailable':
        return `Tool "${toolName}" refused: the policy service is unavailable`;
    }
  }
}

/** Minimal database shape for the default-membership lookup (so tests inject a stub). */
export interface DefaultTenantLookup {
  defaultTenantFor(userId: string): Promise<string | null>;
}

type MembershipDb = {
  select: (fields: Record<string, unknown>) => {
    from: (table: typeof tenantMemberships) => {
      where: (condition: unknown) => { limit: (n: number) => Promise<{ tenantId: string }[]> };
    };
  };
};

export function dbDefaultTenantLookup(db: MembershipDb): DefaultTenantLookup {
  return {
    async defaultTenantFor(userId) {
      const [row] = await db
        .select({ tenantId: tenantMemberships.tenantId })
        .from(tenantMemberships)
        .where(and(eq(tenantMemberships.userId, userId), eq(tenantMemberships.isDefault, true)))
        .limit(1);
      return row?.tenantId ?? null;
    },
  };
}

export interface PolicyDeps {
  provider: PolicyProvider;
  lookup: DefaultTenantLookup;
}

/** True when no policy service is configured: nothing is enforced and no lookup runs. */
export function isAllowAll(provider: PolicyProvider): boolean {
  return provider instanceof AllowAllPolicyProvider;
}

/** `null` means fail closed (provider unavailable). */
async function deniedSet(provider: PolicyProvider, tenantId: string, userId?: string): Promise<Set<string> | null> {
  try {
    const decision = await provider.decide(userId === undefined ? { tenantId } : { tenantId, userId });
    return new Set(decision.deniedTools);
  } catch (error) {
    if (error instanceof PolicyUnavailableError) return null;
    throw error;
  }
}

/** `getAllTools`: filter by the default-tenant decision; no membership or outage → empty list. */
export async function filterToolsByPolicy<T extends { name: string }>(
  deps: PolicyDeps,
  userId: string,
  tools: T[],
): Promise<T[]> {
  if (isAllowAll(deps.provider)) return tools;
  const tenantId = await deps.lookup.defaultTenantFor(userId);
  if (tenantId === null) return [];
  const denied = await deniedSet(deps.provider, tenantId, userId);
  if (denied === null) return [];
  return tools.filter((tool) => !denied.has(tool.name));
}

/**
 * `executeTool`, first decision: the user's default tenant. Returns that tenant
 * id so the caller can tell whether a resolved tenant is a different one.
 */
export async function assertAllowedOnDefaultTenant(
  deps: PolicyDeps,
  userId: string,
  toolName: string,
): Promise<string | null> {
  if (isAllowAll(deps.provider)) return null;
  const tenantId = await deps.lookup.defaultTenantFor(userId);
  if (tenantId === null) throw new ToolPolicyError('no_default_membership', toolName, null);
  await assertAllowedInTenant(deps, tenantId, userId, toolName);
  return tenantId;
}

/** A decision on one tenant for one user; throws the policy refusal. */
export async function assertAllowedInTenant(
  deps: PolicyDeps,
  tenantId: string,
  userId: string,
  toolName: string,
): Promise<void> {
  if (isAllowAll(deps.provider)) return;
  const denied = await deniedSet(deps.provider, tenantId, userId);
  if (denied === null) throw new ToolPolicyError('policy_unavailable', toolName, tenantId);
  if (denied.has(toolName)) throw new ToolPolicyError('policy_denied', toolName, tenantId);
}

/** `getAuthorizedTools(tenantId)`: the tenant ceiling, no user; outage → empty list. */
export async function filterToolsByTenantCeiling<T extends { name: string }>(
  provider: PolicyProvider,
  tenantId: string,
  tools: T[],
): Promise<T[]> {
  if (isAllowAll(provider)) return tools;
  const denied = await deniedSet(provider, tenantId);
  if (denied === null) return [];
  return tools.filter((tool) => !denied.has(tool.name));
}
