/**
 * Tenant profile access contract for Feature 008.
 *
 * Defines lifecycle semantics and fail-closed profile access checks used by
 * generation and mediation paths.
 */

import { createId } from '@paralleldrive/cuid2';
import { drizzle } from 'drizzle-orm/node-postgres';
import { contentOperationLogs } from '../schema.js';
import type { ResolvedEntitlements } from '../types.js';

type DrizzleClient = ReturnType<typeof drizzle>;

export const PROFILE_LIFECYCLE_STATES = ['draft', 'active', 'deprecated', 'archived'] as const;
export type ProfileLifecycleState = (typeof PROFILE_LIFECYCLE_STATES)[number];

export class ProfileAccessDeniedError extends Error {
  constructor(
    public readonly profileId: string,
    public readonly tenantId: string,
    public readonly userId: string,
  ) {
    super(`Profile ${profileId} is not accessible for tenant ${tenantId}`);
    this.name = 'ProfileAccessDeniedError';
  }
}

export function isProfileAccessible(
  profileId: string | undefined,
  entitlements: ResolvedEntitlements,
): boolean {
  if (!profileId) return true;
  return entitlements.profileIds.includes(profileId);
}

export async function assertProfileAccessOrAudit(
  db: DrizzleClient,
  args: {
    profileId?: string;
    tenantId: string;
    userId: string;
    entitlements: ResolvedEntitlements;
    sessionId?: string;
  },
): Promise<void> {
  const { profileId, tenantId, userId, entitlements, sessionId } = args;
  if (!profileId || isProfileAccessible(profileId, entitlements)) {
    return;
  }

  await db.insert(contentOperationLogs).values({
    id: createId(),
    tenantId,
    operation: 'profile_access_denied',
    userId,
    durationMs: 0,
    success: false,
    metadata: {
      eventType: 'tenant_profile_access',
      decision: 'deny',
      profileId,
      allowedProfileIds: entitlements.profileIds,
      sessionId: sessionId ?? null,
      resolvedFrom: entitlements.resolvedFrom,
    },
  });

  throw new ProfileAccessDeniedError(profileId, tenantId, userId);
}
