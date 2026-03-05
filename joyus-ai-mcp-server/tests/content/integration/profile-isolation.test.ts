import { describe, expect, it, vi } from 'vitest';

import {
  assertProfileAccessOrAudit,
  isProfileAccessible,
  ProfileAccessDeniedError,
} from '../../../src/content/profiles/access.js';
import type { ResolvedEntitlements } from '../../../src/content/types.js';

function makeEntitlements(profileIds: string[]): ResolvedEntitlements {
  return {
    productIds: ['prod-1'],
    sourceIds: ['source-1'],
    profileIds,
    resolvedFrom: 'test',
    resolvedAt: new Date(),
  };
}

describe('Profile isolation contract', () => {
  it('treats missing profileId as accessible', () => {
    expect(isProfileAccessible(undefined, makeEntitlements([]))).toBe(true);
  });

  it('allows access when profileId is in entitlement scope', async () => {
    const values = vi.fn(async () => undefined);
    const insert = vi.fn(() => ({ values }));
    const db = { insert } as never;

    await expect(
      assertProfileAccessOrAudit(db, {
        profileId: 'profile-1',
        tenantId: 'tenant-1',
        userId: 'user-1',
        entitlements: makeEntitlements(['profile-1']),
        sessionId: 'session-1',
      }),
    ).resolves.toBeUndefined();

    expect(insert).not.toHaveBeenCalled();
  });

  it('denies cross-tenant profile access and writes audit event', async () => {
    const values = vi.fn(async () => undefined);
    const insert = vi.fn(() => ({ values }));
    const db = { insert } as never;

    await expect(
      assertProfileAccessOrAudit(db, {
        profileId: 'profile-denied',
        tenantId: 'tenant-1',
        userId: 'user-1',
        entitlements: makeEntitlements(['profile-allowed']),
        sessionId: 'session-1',
      }),
    ).rejects.toBeInstanceOf(ProfileAccessDeniedError);

    expect(insert).toHaveBeenCalledOnce();
    expect(values).toHaveBeenCalledOnce();
    const auditRecord = values.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(auditRecord.operation).toBe('profile_access_denied');
    expect(auditRecord.success).toBe(false);
    expect((auditRecord.metadata as Record<string, unknown>).profileId).toBe('profile-denied');
  });
});
