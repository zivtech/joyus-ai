# Spec 013: Tenant Identity Resolution

## Overview

Joyus AI currently resolves tenant identity through three coexisting patterns:

1. Bearer-token routes use the authenticated user id as the tenant id.
2. Content mediation routes derive tenant id from an API key record.
3. Export routes accept an explicit tenant path parameter and authorize it with an environment allowlist.

These patterns are locally safe, but they do not provide a single platform contract for users who belong to more than one tenant, for service integrations scoped by API key, or for operators who need explicit tenant override behavior. This spec creates that contract.

**Outcome**: Every platform surface resolves tenant context through one shared tenant identity layer, using membership-backed authorization, safe defaults, and explicit override semantics.

## Goals

1. Define a first-class user-to-tenant membership model with roles and primary tenant behavior.
2. Provide a shared tenant resolution contract for bearer-token routes, API-key routes, explicit tenant path routes, and admin UI routes.
3. Preserve current single-tenant behavior during migration by seeding each existing user into a tenant matching their user id.
4. Replace route-local tenant allowlists and header trust with membership-backed authorization.
5. Define tests that prove authorized, unauthorized, default, non-disclosure, and operator override paths.

## Non-Goals

- Client-specific tenant names, examples, roles, or domain vocabulary.
- A new external identity provider or single sign-on integration.
- Billing, subscription, or entitlement policy beyond tenant access authorization.
- Changing tenant-scoped data tables other than adding the shared tenant and membership records needed for resolution.
- Reworking every domain query; existing tenant filters remain the data isolation boundary.

## Current State

The codebase already filters tenant data by `tenantId` or `tenant_id` at the data layer. The gap is request-time identity resolution.

| Surface | Current source of tenant id | Current authorization |
|---------|-----------------------------|-----------------------|
| MCP tool execution | `userId` | Bearer token identity only |
| Pipeline REST routes | `req.mcpUser.id` or session user id | Bearer token or session identity only |
| Orchestrator routes | `req.mcpUser.id` via `joyus-ai-mcp-server/src/orchestrator/middleware/tenant.ts` | Bearer token identity only |
| Event adapter management routes | `req.mcpUser.id` in most routes | Bearer token identity only |
| Event adapter admin UI | `x-tenant-id` header or null platform view | Authenticated session, no tenant membership check |
| Content mediation routes | `content_api_keys.tenant_id` | API key plus optional end-user JWT |
| Export routes | `/tenants/:tenantId` | `EXPORT_TENANT_ALLOWLIST`, `EXPORT_ALLOW_ANY_TENANT`, or `tenantId === userId` |

The current notes live in `kitty-specs/009-automated-pipelines-framework/tenant-resolution-notes.md`. This spec supersedes those notes as the owning convergence plan.

## Functional Requirements

### Shared Tenant Model

- FR-001: The platform MUST store tenants as first-class records with stable `tenant_id` values.
- FR-002: The platform MUST store user memberships in `tenant_memberships` with `userId`, `tenantId`, `role`, and `isPrimary`.
- FR-003: A user MAY belong to multiple tenants.
- FR-004: A user MUST have at most one primary tenant.
- FR-005: Existing users MUST receive a backward-compatible default membership where `tenantId` equals `userId`.

### Resolution Contract

- FR-006: The platform MUST expose one shared tenant resolution module used by route handlers and tool execution.
- FR-007: The shared resolver MUST return a typed `TenantContext` containing `tenantId`, `userId` when present, `source`, `role`, and `overrideReason` when applicable.
- FR-008: If a request does not specify a tenant and the authenticated user has one primary membership, the resolver MUST use that primary tenant.
- FR-009: If a request does not specify a tenant and the authenticated user has multiple memberships but no primary tenant, the resolver MUST fail closed with a 400 response.
- FR-010: If a request specifies a tenant, the resolver MUST authorize the authenticated user against `tenant_memberships` before attaching tenant context.
- FR-011: Unauthorized explicit tenant requests MUST fail without exposing protected resource existence. Existing route contracts that return 404 for cross-tenant resource access MUST keep returning 404.

### Auth Surface Behavior

- FR-012: Bearer-token routes MUST derive user identity from `req.mcpUser` and tenant authorization from memberships.
- FR-013: API-key mediation routes MUST continue to derive tenant id from the API key record, then bind end-user identity when a user token is present.
- FR-014: Explicit tenant path routes MUST treat the path tenant as a requested tenant and authorize it through the shared resolver.
- FR-015: Event adapter admin UI routes MUST stop using `x-tenant-id` as an authorization source. Any tenant selector or requested tenant must flow through the shared resolver.
- FR-016: Header-based tenant selection MUST be rejected unless the caller path is explicitly documented as an internal, authenticated operator-only path.

### Operator Override

- FR-017: Operator override MUST be explicit and role-gated.
- FR-018: Operator override MUST record the authenticated user, target tenant, reason, source, and timestamp in an audit event.
- FR-019: Non-operator users MUST NOT be able to impersonate or override tenant context.
- FR-020: Environment variables such as `EXPORT_ALLOW_ANY_TENANT` MUST NOT bypass membership checks in production mode.

### Compatibility and Rollout

- FR-021: During migration, existing `userId === tenantId` behavior MUST remain valid through seeded memberships.
- FR-022: Export tenant allowlist behavior MAY remain as a temporary compatibility input only long enough to seed memberships.
- FR-023: The final runtime path MUST not depend on `EXPORT_TENANT_ALLOWLIST` for tenant authorization.
- FR-024: Existing API key records MUST continue working without key rotation.
- FR-025: Existing tenant-scoped tables MUST continue to use current tenant filters.

## User Scenarios

### Scenario 1: Default tenant for single-tenant user

1. An authenticated user calls a bearer-token route without specifying a tenant.
2. The resolver finds exactly one primary membership.
3. The route operates under that tenant context.

### Scenario 2: Explicit authorized tenant

1. An authenticated user calls an export route with `/tenants/tenant_a/...`.
2. The resolver checks membership for `tenant_a`.
3. The route succeeds only if the user has an active membership for `tenant_a`.

### Scenario 3: Explicit unauthorized tenant

1. An authenticated user requests `/tenants/tenant_b/...`.
2. The resolver finds no active membership for `tenant_b`.
3. The route fails with the existing non-disclosure response contract.

### Scenario 4: API-key scoped mediation

1. A service integration sends a valid API key.
2. The resolver derives tenant context from the API key record.
3. If an end-user token is supplied, the request binds that user identity for audit without changing the API-key tenant.

### Scenario 5: Operator override

1. An operator requests a target tenant and supplies an override reason.
2. The resolver verifies an operator role.
3. The route operates under the target tenant and emits an audit event.

## Success Criteria

1. All runtime surfaces listed in Current State use the shared resolver or an approved adapter around it.
2. Existing single-tenant users continue to operate with no request changes.
3. A user with two memberships can select either authorized tenant.
4. Unauthorized tenant selection fails closed and preserves existing 404 non-disclosure contracts.
5. Content mediation API keys continue to resolve their configured tenant.
6. Operator override is role-gated and audited.
7. TypeScript compilation and targeted tenant-resolution tests pass.

## Security and Governance

- Tenant identity is a security boundary. Resolver failures are treated as authorization failures, not validation warnings.
- Request headers are never trusted for tenant authorization by default.
- All examples in this spec use generic tenant ids such as `tenant_a`, `tenant_b`, and `Example Corp`.
- This spec follows the client abstraction rule in `AGENTS.md`; no client names or client-specific terminology are introduced.

## Dependencies

- Existing auth middleware in `joyus-ai-mcp-server/src/auth/middleware.ts`.
- Existing user records in `joyus-ai-mcp-server/src/db/schema.ts`.
- Existing tenant-scoped data tables in content, pipeline, event adapter, profile, export, and orchestrator modules.
- Existing API-key table in `joyus-ai-mcp-server/src/content/schema.ts`.

## Risks

| Risk | Severity | Mitigation |
|------|----------|------------|
| Breaking existing single-tenant routes | High | Seed `tenant_memberships` with `tenantId === userId` and test default resolution |
| Accidental header trust remains | High | Search and test every route-local `resolveTenantId` and `x-tenant-id` path |
| API-key mediation changes tenant semantics | Medium | Treat API key tenant as authoritative and add compatibility tests |
| Operator override becomes too broad | High | Require role, explicit reason, and audit event |
| Route status codes drift | Medium | Preserve 404 non-disclosure tests for cross-tenant resource access |

## Adoption Plan

1. Add schema and compatibility migration.
2. Add shared resolver with tests before porting routes.
3. Port exports first because it already has explicit tenant semantics.
4. Port bearer-token routes and tool execution.
5. Port event adapter admin UI and management routes.
6. Remove export allowlist bypass from the runtime path after migration tests pass.

## Measurement

- Owner: Engineering Operations.
- Review cadence: weekly until all route-local tenant resolution helpers are removed.
- Primary metric: count of tenant resolution call sites using shared resolver.
- Secondary metric: count of route-local tenant header or `userId === tenantId` fallbacks remaining.
