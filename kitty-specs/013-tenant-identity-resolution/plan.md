# Implementation Plan: Tenant Identity Resolution

**Branch**: `codex/tenant-identity-resolution-37` | **Date**: 2026-05-25 | **Spec**: [spec.md](spec.md)
**Input**: GitHub issue #37 and `kitty-specs/009-automated-pipelines-framework/tenant-resolution-notes.md`

## Summary

Add a shared tenant identity layer that replaces route-local tenant derivation with membership-backed authorization. The work starts with schema and resolver tests, then ports existing surfaces in stages while preserving `userId === tenantId` compatibility through seeded memberships.

**5 work packages**: WP01 schema and migration, WP02 resolver module, WP03 exports and content mediation, WP04 bearer-token routes and tools, WP05 event adapter admin and cleanup.

## Technical Context

**Language/Version**: TypeScript 5.x, Node.js 20+
**Primary Dependencies**: Express, Drizzle ORM, Postgres, vitest
**Storage**: PostgreSQL through Drizzle migrations
**Testing**: vitest unit and route tests
**Target Platform**: Existing `joyus-ai-mcp-server/`
**Security Constraint**: Tenant identity must never be authorized by a request header alone
**Compatibility Constraint**: Existing single-tenant users must keep working through seeded memberships

## Constitution Check

| Principle | Status | Notes |
|-----------|--------|-------|
| Multi-tenant from day one | PASS | First-class tenant memberships replace per-user tenant assumptions |
| Security as platform boundary | PASS | Resolver fails closed and rejects header trust |
| Monitor everything | PASS | Operator override emits audit events |
| Client-informed, platform-generic | PASS | All examples are generic and no client details are included |
| Open source by default | PASS | Public platform capability only |

No known constitution violations.

## Project Structure

### Documentation

```
kitty-specs/013-tenant-identity-resolution/
+-- meta.json
+-- status.json
+-- spec.md
+-- plan.md
+-- research.md
+-- data-model.md
+-- quickstart.md
+-- tasks.md
+-- checklists/
|   +-- requirements.md
+-- tasks/
    +-- WP01-schema-memberships.md
    +-- WP02-shared-resolver.md
    +-- WP03-explicit-and-api-key-routes.md
    +-- WP04-bearer-routes-and-tools.md
    +-- WP05-admin-cleanup-acceptance.md
```

### Source Code Targets

```
joyus-ai-mcp-server/
+-- drizzle/migrations/
+-- src/
|   +-- auth/
|   |   +-- tenant-context.ts
|   |   +-- tenant-context.test.ts
|   +-- db/schemas.ts   # aggregator (registry that combines all domain schemas)
|   +-- db/schema.ts    # core schema module (consumed by the aggregator)
|   +-- exports/
|   +-- content/mediation/
|   +-- pipelines/
|   +-- orchestrator/
|   +-- event-adapter/
|   +-- tools/
+-- tests/
```

## Work Package Summary

| WP | Title | Deliverables | Dependencies |
|----|-------|--------------|--------------|
| WP01 | Schema and Compatibility Migration | Tenant tables, seed migration, schema exports, migration tests | None |
| WP02 | Shared Resolver | `TenantContext` types, resolver service, Express middleware adapters, unit tests | WP01 |
| WP03 | Explicit Tenant and API-Key Routes | Exports route migration, content mediation adapter, compatibility tests | WP02 |
| WP04 | Bearer Routes and Tool Execution | Pipeline, orchestrator, event adapter management, MCP tool ports | WP02, WP03 |
| WP05 | Admin UI Cleanup and Acceptance | Admin tenant selector, remove allowlist runtime path, full acceptance suite | WP04 |

## Implementation Strategy

### WP01: Schema and Compatibility Migration

- Add `tenants`, `tenant_memberships`, and `tenant_access_audit` to the shared schema.
- Generate a Drizzle migration.
- Seed every existing user into an active primary membership where `tenantId === userId`.
- Add a migration helper for optional `EXPORT_TENANT_ALLOWLIST` backfill.
- Add tests that prove seed idempotency.

### WP02: Shared Resolver

- Add `joyus-ai-mcp-server/src/auth/tenant-context.ts`.
- Implement pure resolver functions around repository interfaces before Express middleware.
- Add Express adapters for bearer-token, API-key, explicit tenant, and operator override sources.
- Add tests for all error outcomes in `data-model.md`.

### WP03: Explicit Tenant and API-Key Routes

- Port `joyus-ai-mcp-server/src/exports/router.ts` and `joyus-ai-mcp-server/src/exports/service.ts`.
- Keep existing export response shapes.
- Port `joyus-ai-mcp-server/src/content/mediation/auth.ts` through the API-key resolver path without requiring local user membership.
- Add tests for valid API key, inactive API key, authorized export tenant, and unauthorized export tenant.

### WP04: Bearer Routes and Tool Execution

- Replace route-local `getTenantId` helpers in pipeline routes and event adapter management routes.
- Replace `joyus-ai-mcp-server/src/orchestrator/middleware/tenant.ts` internals with the shared resolver.
- Add a tenant context parameter to MCP tool execution where needed.
- Preserve `userId === tenantId` compatibility via memberships, not direct assignment.

### WP05: Admin UI Cleanup and Acceptance

- Replace event adapter admin `x-tenant-id` behavior with a membership-backed tenant selector or explicit operator override path.
- Remove runtime use of `EXPORT_TENANT_ALLOWLIST` and `EXPORT_ALLOW_ANY_TENANT`.
- Add acceptance tests for default tenant, explicit authorized tenant, explicit unauthorized tenant, non-disclosure 404, API-key tenant, operator override, and non-operator impersonation denial.
- Run TypeScript and targeted vitest suites.

## Test Strategy

Required tests before implementation is complete:

- Resolver unit tests for default, requested, API-key, and operator override sources.
- Migration tests for idempotent user-to-tenant seeding.
- Exports route tests for authorized and unauthorized explicit tenants.
- Content mediation auth tests proving API-key tenant compatibility.
- Pipeline and orchestrator route tests proving bearer-token default tenant resolution.
- Event adapter admin tests proving header-only tenant selection no longer authorizes access.
- Non-disclosure tests for routes that currently return 404 on cross-tenant access.

## Rollout Notes

The compatibility migration makes current behavior equivalent before route ports begin. Once all ports use the shared resolver, environment allowlists can be removed from runtime authorization. If a production deployment still needs temporary allowlist import, run the migration helper before disabling the env vars.

## Acceptance Gates

1. `npm run typecheck` or equivalent TypeScript check in `joyus-ai-mcp-server/`.
2. Targeted vitest suites for auth, exports, content mediation, pipelines, orchestrator, and event adapter.
3. Canonical acceptance grep (identical to `quickstart.md` step 3): `rg -n "x-tenant-id|EXPORT_TENANT_ALLOWLIST|EXPORT_ALLOW_ANY_TENANT|userId === tenantId|tenantId = userId|req.mcpUser\\.id" joyus-ai-mcp-server/src joyus-ai-mcp-server/tests kitty-specs/013-tenant-identity-resolution` confirms remaining matches are tests, docs, or explicit compatibility comments.
4. `scripts/check-client-abstraction.sh` passes from repository root.
