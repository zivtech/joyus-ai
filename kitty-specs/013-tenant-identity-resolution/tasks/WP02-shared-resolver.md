---
work_package_id: WP02
title: Shared Resolver
status: planned
depends_on: [WP01]
---

# WP02: Shared Resolver

## Goal

Implement the shared tenant context resolver used by all route families.

## Scope

- Add `joyus-ai-mcp-server/src/auth/tenant-context.ts`.
- Define `TenantContext`, resolver input types, and typed resolver errors.
- Implement bearer default, bearer requested tenant, API-key tenant, and operator override resolution.
- Add Express middleware helpers that attach `req.tenantContext` and `req.tenantId`.
- Emit tenant access audit events for operator override.

## Tests

- Missing auth identity returns 401.
- Single primary membership defaults successfully.
- Multiple memberships without primary fail with 400.
- Explicit authorized tenant succeeds.
- Explicit unauthorized tenant fails with the configured disclosure mode.
- API-key tenant context succeeds without requiring local user membership.
- Operator override requires operator role and reason.

## Done When

- Resolver unit tests pass.
- Route code can call the resolver without importing route-specific policy.
- Failure responses are typed and consistent.
