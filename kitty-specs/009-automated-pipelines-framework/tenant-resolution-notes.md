# Tenant Identity Resolution — Current State

**Date**: 2026-03-19
**Context**: Discovered during PR #28 review (Finding 1: pipeline routes exposed without auth)

## Problem

There is no unified tenant resolution strategy. The codebase uses three different patterns to determine which tenant a request operates on, with no spec owning the convergence.

## Current Patterns

### Pattern 1: userId = tenantId (MCP tools, pipeline routes)

The authenticated user's ID is used directly as the tenant ID. No real multi-tenancy — each user is their own tenant.

**Used by**:
- `src/tools/executor.ts:55` — `const tenantId = userId; // tenant resolution deferred to WP12`
- `src/pipelines/routes.ts` — `getTenantId()` returns `req.mcpUser.id`
- `src/tools/executors/content-executor.ts` — receives `tenantId` from tool executor context
- `src/tools/executors/pipeline-executor.ts` — receives `tenantId` from tool executor context

**Auth mechanism**: `requireBearerToken` middleware validates MCP token, sets `req.mcpUser`.

### Pattern 2: API key -> tenantId (content mediation layer)

API keys are issued per-tenant. The key lookup maps to a tenant, decoupling the caller's identity from the tenant context.

**Used by**:
- `src/content/mediation/auth.ts:59` — `req.tenantId = keyRecord.tenantId`
- `src/content/mediation/router.ts` — all mediation routes use `req.tenantId!`
- `src/content/mediation/keys.ts` — `ApiKeyManager.createKey(tenantId, ...)`
- `src/content/mediation/session.ts` — sessions scoped to `tenantId`

**Auth mechanism**: Custom `requireApiKey` middleware looks up key in `content_api_keys` table, attaches `tenantId` from the key record.

### Pattern 3: URL path param + allowlist (exports)

Tenant ID is explicit in the URL. Access is authorized against an environment variable allowlist.

**Used by**:
- `src/exports/router.ts:37` — `/tenants/:tenantId/exports/excel`
- `src/exports/service.ts:68` — `canAccessTenant(userId, tenantId)` checks `ALLOWED_TENANT_MAP` env var

**Auth mechanism**: `requireBearerToken` + `canAccessTenant()` checks an env-var-based `userId:tenantId` mapping. Falls back to `tenantId === userId` if no mapping exists.

## Data Layer

Tenant scoping is consistent at the data layer regardless of resolution pattern:
- Every table with tenant data has a `tenant_id` column
- Queries always filter by `tenantId` (Leash pattern from ADR-0002)
- Cross-tenant access returns 404 (not 403) to avoid leaking resource existence
- Pipeline schema: 9 tables, all tenant-scoped with composite indexes on `(tenant_id, ...)`
- Content schema: 10 tables, all tenant-scoped

~280 references to `tenantId`/`tenant_id` across the `src/` directory.

## What's Missing

1. **No spec owns tenant resolution** — The `WP12` references in `tools/executor.ts` are not tied to any feature spec. Different specs reuse the WP12 label for unrelated work (006: integration tests, 005: monitoring pipeline, 009: decision recording).

2. **No user-to-tenant mapping table** — Pattern 1 assumes 1:1. Pattern 2 uses API keys. Pattern 3 uses an env var. None support a user belonging to multiple tenants.

3. **No authorization check for tenant context** — When a user claims a tenant (via any pattern), there's no unified check that the user is authorized for that tenant. The exports service's `canAccessTenant()` is the closest, but it's isolated to that module.

4. **No admin/operator tenant impersonation** — An operator who needs to act on behalf of different tenants has no mechanism to do so through patterns 1 or 2.

## Recommendation

A dedicated spec should own tenant resolution with:
- A `tenant_memberships` table (userId, tenantId, role)
- A shared `resolveTenantId(req)` utility that all routes use
- Authorization: authenticated user must be a member of the requested tenant
- Default: if no tenant specified, use the user's primary tenant
- Admin override: operators with a specific role can specify any tenant

Until then, the three patterns coexist safely because:
- Pattern 1 (userId = tenantId) can't impersonate — the auth layer controls identity
- Pattern 2 (API key) is scoped by key issuance — you only get keys for your tenant
- Pattern 3 (URL + allowlist) has an explicit authorization check

## Multi-Tenant Per User

Pattern 3 (exports) is the **only place** that supports a single user accessing multiple tenants, via `EXPORT_TENANT_ALLOWLIST` env var (format: `userId1:tenantId1,userId1:tenantId2`). This is an operational escape hatch, not a first-class feature. No other module supports it.

## Fixes Applied

### PR #38 — Auth middleware and tenant resolution (2026-03-20)

Fixed two security defects from grndlvl's review on PR #28 (Finding 1a/1b):

1. **Added `requireBearerToken` to pipeline route mount** (`src/index.ts`). Pipeline routes were the only `/api` endpoints mounted without auth middleware.

2. **Removed `x-tenant-id` header trust from `getTenantId()`** (`src/pipelines/routes.ts`). The function previously accepted any value from the `x-tenant-id` request header, allowing unauthenticated callers to impersonate any tenant. Replaced with `req.mcpUser.id` (auth-derived identity), matching the pattern in `tools/executor.ts`.

### Tracking

- Issue #37: Unify tenant identity resolution across three coexisting patterns
- PR #33 comment: Flagged that the Inngest migration branch inherits both bugs
