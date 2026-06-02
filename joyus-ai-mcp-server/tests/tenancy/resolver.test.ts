import { describe, it, expect, vi, afterEach } from 'vitest';
import type { Request } from 'express';

import type { TenantMembership } from '../../src/db/schema.js';
import {
  resolveTenantContext,
  resolveTenantContextForUser,
  tenantIdFromRequest,
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

// A membership DB whose lookups always reject — used to assert fail-closed
// behavior (503) on transient DB outages.
function makeFailingDb() {
  return {
    select: vi.fn().mockImplementation(() => ({
      from: vi.fn().mockImplementation(() => ({
        where: vi.fn().mockImplementation(() => ({
          limit: vi.fn().mockImplementation(async () => {
            throw new Error('connection refused');
          }),
        })),
      })),
    })),
  };
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

  it('allows an explicitly requested tenant from the environment allowlist only when opted in', async () => {
    vi.stubEnv('EXPORT_ALLOW_ANY_TENANT', 'false');
    vi.stubEnv('EXPORT_TENANT_ALLOWLIST', 'user-1:tenant-allowed');

    const context = await resolveTenantContextForUser('user-1', {
      requestedTenantId: 'tenant-allowed',
      allowEnvironmentAllowlist: true,
    });

    expect(context).toMatchObject({
      tenantId: 'tenant-allowed',
      source: 'env_allowlist',
    });
  });

  it('ignores the environment allowlist when a caller does not opt in', async () => {
    // The EXPORT_* allowlist is scoped to the exports feature: a non-exports
    // caller (orchestrator / admin / tools) must not gain cross-tenant access
    // from it, so without allowEnvironmentAllowlist the request fails closed.
    vi.stubEnv('EXPORT_ALLOW_ANY_TENANT', 'false');
    vi.stubEnv('EXPORT_TENANT_ALLOWLIST', 'user-1:tenant-allowed');

    await expect(
      resolveTenantContextForUser('user-1', {
        requestedTenantId: 'tenant-allowed',
      }),
    ).rejects.toMatchObject({
      status: 403,
      code: 'tenant_forbidden',
    });
  });

  it('allows an explicitly requested tenant when a membership exists', async () => {
    // Operator lookup runs first (no operator row), then the direct-membership
    // lookup for the requested tenant succeeds.
    const db = makeDb([
      [],
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
    // Operator lookup runs first and short-circuits the direct-membership check.
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

  it('denies a member requesting a tenant they do not belong to even when operator rows exist for other users', async () => {
    // The actor has no operator membership of their own and no direct
    // membership in the requested tenant. Operator rows belonging to OTHER
    // users must never widen this actor's access — the per-user operator
    // lookup returns empty, and the direct-membership lookup returns empty.
    const db = makeDb([
      [], // findOperatorMembership(actor) → no operator membership for this user
      [], // findDirectMembership(actor, requested) → not a member of this tenant
    ]);

    await expect(
      resolveTenantContextForUser('member-user', {
        db,
        requestedTenantId: 'tenant-not-mine',
      }),
    ).rejects.toMatchObject({
      status: 403,
      code: 'tenant_forbidden',
    });
  });

  it('fails closed with 503 when the default-membership lookup errors', async () => {
    const db = makeFailingDb();

    await expect(
      resolveTenantContextForUser('user-1', {
        db,
        lookupDefaultTenant: true,
      }),
    ).rejects.toMatchObject({
      status: 503,
      code: 'tenant_lookup_unavailable',
    });
  });

  it('fails closed with 503 when an explicit-tenant lookup errors', async () => {
    const db = makeFailingDb();

    await expect(
      resolveTenantContextForUser('user-1', {
        db,
        requestedTenantId: 'tenant-x',
      }),
    ).rejects.toMatchObject({
      status: 503,
      code: 'tenant_lookup_unavailable',
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

  it('rejects an API-key request that explicitly asks for a different tenant', async () => {
    const req = {
      apiKeyRecord: { id: 'key-1' },
      tenantId: 'tenant-from-api-key',
      userId: 'external-user-1',
    } as unknown as Request;

    await expect(
      resolveTenantContext(req, { requestedTenantId: 'tenant-other' }),
    ).rejects.toMatchObject({
      status: 403,
      code: 'tenant_forbidden',
    });
  });

  it('keeps the API-key fast-path when the explicit request matches the key tenant', async () => {
    const req = {
      apiKeyRecord: { id: 'key-1' },
      tenantId: 'tenant-from-api-key',
      userId: 'external-user-1',
    } as unknown as Request;

    const context = await resolveTenantContext(req, { requestedTenantId: 'tenant-from-api-key' });

    expect(context).toMatchObject({
      tenantId: 'tenant-from-api-key',
      source: 'api_key',
    });
  });

  it('rejects missing authenticated user context', async () => {
    await expect(resolveTenantContextForUser(null)).rejects.toBeInstanceOf(TenantResolutionError);
  });
});

describe('tenantIdFromRequest', () => {
  it('preserves an operator platform-wide null instead of collapsing to the user id', () => {
    // The whole point of the fix: an authorized all-tenants context (tenantId
    // null) must NOT be coerced back to the actor's user id by a `??` chain.
    const req = {
      mcpUser: { id: 'operator-1' },
      tenantContext: { actorUserId: 'operator-1', tenantId: null, source: 'operator' as const },
    } as unknown as Request;

    expect(tenantIdFromRequest(req)).toBeNull();
  });

  it('returns the resolved tenant id when the context carries one', () => {
    const req = {
      mcpUser: { id: 'user-1' },
      tenantContext: { actorUserId: 'user-1', tenantId: 'tenant-7', source: 'membership' as const },
    } as unknown as Request;

    expect(tenantIdFromRequest(req)).toBe('tenant-7');
  });

  it('falls back to the authenticated user id only when no context is attached', () => {
    const req = { mcpUser: { id: 'user-1' } } as unknown as Request;
    expect(tenantIdFromRequest(req)).toBe('user-1');
  });
});
