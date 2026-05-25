import { describe, it, expect, vi, afterEach } from 'vitest';
import type { Request } from 'express';

import type { TenantMembership } from '../../src/db/schema.js';
import {
  resolveTenantContext,
  resolveTenantContextForUser,
  TenantResolutionError,
} from '../../src/tenancy/resolver.js';

function membership(overrides: Partial<TenantMembership> = {}): TenantMembership {
  return {
    id: 'membership-1',
    userId: 'user-1',
    tenantId: 'tenant-1',
    role: 'member',
    isDefault: false,
    createdAt: new Date('2026-01-01T00:00:00Z'),
    updatedAt: new Date('2026-01-01T00:00:00Z'),
    ...overrides,
  };
}

function makeDb(resultSets: TenantMembership[][]) {
  let callIndex = 0;
  const db = {
    select: vi.fn().mockImplementation(() => ({
      from: vi.fn().mockImplementation(() => ({
        where: vi.fn().mockImplementation(() => ({
          limit: vi.fn().mockImplementation(async () => resultSets[callIndex++] ?? []),
        })),
      })),
    })),
  };
  return db;
}

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('tenant resolver', () => {
  it('defaults to the authenticated user id when no membership is available', async () => {
    const context = await resolveTenantContextForUser('user-1');
    expect(context).toMatchObject({
      actorUserId: 'user-1',
      tenantId: 'user-1',
      source: 'self',
    });
  });

  it('uses the default membership when membership lookup is enabled', async () => {
    const db = makeDb([
      [membership({ tenantId: 'tenant-primary', isDefault: true, role: 'admin' })],
    ]);

    const context = await resolveTenantContextForUser('user-1', {
      db,
      lookupDefaultTenant: true,
    });

    expect(context).toMatchObject({
      tenantId: 'tenant-primary',
      role: 'admin',
      source: 'membership',
    });
  });

  it('allows an explicitly requested tenant from the existing environment allowlist', async () => {
    vi.stubEnv('EXPORT_ALLOW_ANY_TENANT', 'false');
    vi.stubEnv('EXPORT_TENANT_ALLOWLIST', 'user-1:tenant-allowed');

    const context = await resolveTenantContextForUser('user-1', {
      requestedTenantId: 'tenant-allowed',
    });

    expect(context).toMatchObject({
      tenantId: 'tenant-allowed',
      source: 'env_allowlist',
    });
  });

  it('allows an explicitly requested tenant when a membership exists', async () => {
    const db = makeDb([
      [membership({ tenantId: 'tenant-member', role: 'member' })],
    ]);

    const context = await resolveTenantContextForUser('user-1', {
      db,
      requestedTenantId: 'tenant-member',
    });

    expect(context).toMatchObject({
      tenantId: 'tenant-member',
      role: 'member',
      source: 'membership',
    });
  });

  it('allows operators to resolve any explicitly requested tenant', async () => {
    const db = makeDb([
      [membership({ tenantId: 'operator-home', role: 'operator' })],
    ]);

    const context = await resolveTenantContextForUser('user-1', {
      db,
      requestedTenantId: 'tenant-any',
    });

    expect(context).toMatchObject({
      tenantId: 'tenant-any',
      role: 'operator',
      source: 'operator',
    });
  });

  it('allows operators to request platform-wide context only where enabled', async () => {
    const db = makeDb([
      [membership({ tenantId: 'operator-home', role: 'operator' })],
    ]);

    const context = await resolveTenantContextForUser('user-1', {
      db,
      allowPlatformWide: true,
      platformWideRequested: true,
    });

    expect(context).toMatchObject({
      tenantId: null,
      role: 'operator',
      source: 'operator',
    });
  });

  it('denies an explicitly requested tenant without membership or allowlist access', async () => {
    await expect(
      resolveTenantContextForUser('user-1', {
        requestedTenantId: 'tenant-denied',
      }),
    ).rejects.toMatchObject({
      status: 403,
      code: 'tenant_forbidden',
    });
  });

  it('preserves API-key tenant context for content mediation requests', async () => {
    const req = {
      apiKeyRecord: { id: 'key-1' },
      tenantId: 'tenant-from-api-key',
      userId: 'external-user-1',
    } as unknown as Request;

    const context = await resolveTenantContext(req);

    expect(context).toMatchObject({
      actorUserId: 'external-user-1',
      tenantId: 'tenant-from-api-key',
      source: 'api_key',
    });
    expect(req.tenantContext?.tenantId).toBe('tenant-from-api-key');
  });

  it('rejects missing authenticated user context', async () => {
    await expect(resolveTenantContextForUser(null)).rejects.toBeInstanceOf(TenantResolutionError);
  });
});
