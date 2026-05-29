import { and, eq } from 'drizzle-orm';
import type { Request, Response } from 'express';

import { tenantMemberships, type TenantMembership, type TenantRole } from '../db/schema.js';

export type TenantResolutionSource =
  | 'api_key'
  | 'env_allowlist'
  | 'membership'
  | 'operator'
  | 'self';

export interface TenantContext {
  actorUserId?: string;
  tenantId: string | null;
  role?: TenantRole;
  source: TenantResolutionSource;
}

export interface ResolveTenantForUserOptions {
  requestedTenantId?: string | null;
  db?: unknown;
  lookupDefaultTenant?: boolean;
  allowPlatformWide?: boolean;
  platformWideRequested?: boolean;
}

export interface ResolveTenantRequestOptions extends ResolveTenantForUserOptions {
  tenantParamKeys?: string[];
  tenantQueryKeys?: string[];
  tenantHeaderNames?: string[];
}

type TenantMembershipLookupDb = {
  select: () => {
    from: (table: typeof tenantMemberships) => {
      where: (condition: unknown) => {
        limit: (limit: number) => Promise<TenantMembership[]>;
      };
    };
  };
};

declare global {
  namespace Express {
    interface Request {
      tenantContext?: TenantContext;
    }
  }
}

export class TenantResolutionError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'TenantResolutionError';
  }
}

function normalizeTenantId(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function firstRequestValue(value: unknown): string | null {
  if (Array.isArray(value)) {
    return normalizeTenantId(value[0]);
  }
  return normalizeTenantId(value);
}

export function parseTenantAllowlist(raw: string): Map<string, Set<string>> {
  const result = new Map<string, Set<string>>();
  raw
    .split(',')
    .map((entry) => entry.trim())
    .filter(Boolean)
    .forEach((entry) => {
      const [userId, tenantId] = entry.split(':').map((part) => part.trim());
      if (!userId || !tenantId) return;
      const existing = result.get(userId) || new Set<string>();
      existing.add(tenantId);
      result.set(userId, existing);
    });
  return result;
}

export function canAccessTenantFromEnvironment(userId: string, tenantId: string): boolean {
  if (process.env.EXPORT_ALLOW_ANY_TENANT === 'true') return true;
  const allowlist = parseTenantAllowlist(process.env.EXPORT_TENANT_ALLOWLIST || '');
  const allowedTenants = allowlist.get(userId);
  return Boolean(allowedTenants && allowedTenants.has(tenantId));
}

/**
 * Synchronous tenant self/allowlist access check shared by callers that cannot
 * perform a membership DB lookup (e.g. the exports service). A user may always
 * access their own tenant; otherwise the environment allowlist applies.
 */
export function canAccessTenant(userId: string, tenantId: string): boolean {
  if (tenantId === userId) return true;
  return canAccessTenantFromEnvironment(userId, tenantId);
}

function asMembershipDb(db: unknown): TenantMembershipLookupDb | null {
  if (!db || typeof db !== 'object' || !('select' in db)) return null;
  return db as TenantMembershipLookupDb;
}

async function findDefaultMembership(
  db: TenantMembershipLookupDb,
  userId: string,
): Promise<TenantMembership | null> {
  const [membership] = await db
    .select()
    .from(tenantMemberships)
    .where(and(eq(tenantMemberships.userId, userId), eq(tenantMemberships.isDefault, true)))
    .limit(1);
  return membership ?? null;
}

async function findDirectMembership(
  db: TenantMembershipLookupDb,
  userId: string,
  requestedTenantId: string,
): Promise<TenantMembership | null> {
  const [membership] = await db
    .select()
    .from(tenantMemberships)
    .where(and(eq(tenantMemberships.userId, userId), eq(tenantMemberships.tenantId, requestedTenantId)))
    .limit(1);
  return membership ?? null;
}

async function findOperatorMembership(
  db: TenantMembershipLookupDb,
  userId: string,
): Promise<TenantMembership | null> {
  const [membership] = await db
    .select()
    .from(tenantMemberships)
    .where(and(eq(tenantMemberships.userId, userId), eq(tenantMemberships.role, 'operator')))
    .limit(1);
  return membership ?? null;
}

export async function resolveTenantContextForUser(
  userId: string | undefined | null,
  options: ResolveTenantForUserOptions = {},
): Promise<TenantContext> {
  const actorUserId = normalizeTenantId(userId);
  if (!actorUserId) {
    throw new TenantResolutionError(401, 'tenant_auth_required', 'Authentication required to resolve tenant context');
  }

  const requestedTenantId = normalizeTenantId(options.requestedTenantId);
  const membershipDb = asMembershipDb(options.db);

  if (options.platformWideRequested) {
    if (!options.allowPlatformWide) {
      throw new TenantResolutionError(403, 'tenant_platform_forbidden', 'Platform-wide tenant access is not allowed here');
    }
    if (!membershipDb) {
      throw new TenantResolutionError(403, 'tenant_platform_forbidden', 'Operator membership is required for platform-wide access');
    }

    try {
      const operatorMembership = await findOperatorMembership(membershipDb, actorUserId);
      if (operatorMembership) {
        return {
          actorUserId,
          tenantId: null,
          role: operatorMembership.role,
          source: 'operator',
        };
      }
    } catch {
      throw new TenantResolutionError(503, 'tenant_lookup_unavailable', 'Tenant authorization lookup failed');
    }

    throw new TenantResolutionError(403, 'tenant_platform_forbidden', 'Operator membership is required for platform-wide access');
  }

  if (!requestedTenantId) {
    if (options.lookupDefaultTenant && membershipDb) {
      try {
        const defaultMembership = await findDefaultMembership(membershipDb, actorUserId);
        if (defaultMembership) {
          return {
            actorUserId,
            tenantId: defaultMembership.tenantId,
            role: defaultMembership.role,
            source: 'membership',
          };
        }
      } catch {
        // Fail closed: a default-membership lookup error must not silently
        // downgrade the actor to self-scope (which could be the wrong tenant).
        // Mirror the explicit-tenant path and surface a 503.
        throw new TenantResolutionError(503, 'tenant_lookup_unavailable', 'Tenant authorization lookup failed');
      }
    }

    return { actorUserId, tenantId: actorUserId, source: 'self' };
  }

  if (requestedTenantId === actorUserId) {
    return { actorUserId, tenantId: requestedTenantId, source: 'self' };
  }

  if (canAccessTenantFromEnvironment(actorUserId, requestedTenantId)) {
    return { actorUserId, tenantId: requestedTenantId, source: 'env_allowlist' };
  }

  if (membershipDb) {
    try {
      // Operator superpower is an explicit, named branch: an operator (any
      // tenant) may resolve any requested tenant. Checked first so the
      // authorization widening can never be silently dropped by a future edit.
      const operatorMembership = await findOperatorMembership(membershipDb, actorUserId);
      if (operatorMembership) {
        return {
          actorUserId,
          tenantId: requestedTenantId,
          role: operatorMembership.role,
          source: 'operator',
        };
      }

      // Otherwise the actor must hold a direct membership in the requested tenant.
      const membership = await findDirectMembership(membershipDb, actorUserId, requestedTenantId);
      if (membership) {
        return {
          actorUserId,
          tenantId: requestedTenantId,
          role: membership.role,
          source: 'membership',
        };
      }
    } catch (error) {
      if (error instanceof TenantResolutionError) throw error;
      throw new TenantResolutionError(503, 'tenant_lookup_unavailable', 'Tenant authorization lookup failed');
    }
  }

  throw new TenantResolutionError(403, 'tenant_forbidden', `User ${actorUserId} is not authorized for tenant ${requestedTenantId}`);
}

function requestedTenantFromRequest(req: Request, options: ResolveTenantRequestOptions): string | null {
  for (const key of options.tenantParamKeys ?? ['tenantId', 'tenant_id']) {
    const value = firstRequestValue(req.params?.[key]);
    if (value) return value;
  }

  for (const key of options.tenantQueryKeys ?? []) {
    const value = firstRequestValue(req.query?.[key]);
    if (value) return value;
  }

  for (const name of options.tenantHeaderNames ?? []) {
    const value = firstRequestValue(req.headers[name.toLowerCase()]);
    if (value) return value;
  }

  return null;
}

function platformWideRequested(req: Request, options: ResolveTenantRequestOptions): boolean {
  if (options.platformWideRequested) return true;
  const allTenants = firstRequestValue(req.query?.all_tenants);
  return allTenants === 'true' || allTenants === '1';
}

export function attachTenantContext(req: Request, context: TenantContext): void {
  req.tenantContext = context;
  if (context.tenantId) {
    req.tenantId = context.tenantId;
  } else {
    delete req.tenantId;
  }
}

export async function resolveTenantContext(
  req: Request,
  options: ResolveTenantRequestOptions = {},
): Promise<TenantContext> {
  // Supported actor sources: Layer-2 MCP user auth (req.mcpUser) takes
  // precedence; otherwise the Layer-1 API-key fast-path applies. Every caller
  // populates req.mcpUser before reaching the resolver, so there is no
  // session-only path here.
  if (!req.mcpUser?.id && req.apiKeyRecord && req.tenantId) {
    const requestedTenantId =
      normalizeTenantId(options.requestedTenantId) ?? requestedTenantFromRequest(req, options);
    // Fail closed on a conflicting explicit tenant request: the API key is
    // bound to a single tenant, so an explicit request for a different tenant
    // must be rejected rather than silently ignored.
    if (requestedTenantId && requestedTenantId !== req.tenantId) {
      throw new TenantResolutionError(
        403,
        'tenant_forbidden',
        `API key is scoped to tenant ${req.tenantId}; requested tenant ${requestedTenantId} is not permitted`,
      );
    }
    // actorUserId is intentionally optional here: an API-key-only context
    // (Layer-1 auth without a validated user JWT) has no end-user actor, so
    // req.userId may be undefined. TenantContext.actorUserId is typed optional
    // and audit writers tolerate a missing actor for these contexts.
    const context: TenantContext = {
      actorUserId: req.userId,
      tenantId: req.tenantId,
      source: 'api_key',
    };
    attachTenantContext(req, context);
    return context;
  }

  const actorUserId = req.mcpUser?.id;
  const context = await resolveTenantContextForUser(actorUserId, {
    ...options,
    requestedTenantId: options.requestedTenantId ?? requestedTenantFromRequest(req, options),
    platformWideRequested: platformWideRequested(req, options),
  });
  attachTenantContext(req, context);
  return context;
}

export function sendTenantResolutionError(res: Response, error: unknown): void {
  if (error instanceof TenantResolutionError) {
    res.status(error.status).json({
      error: error.code,
      message: error.message,
    });
    return;
  }

  const message = error instanceof Error ? error.message : 'Tenant resolution failed';
  res.status(500).json({
    error: 'tenant_resolution_failed',
    message,
  });
}
