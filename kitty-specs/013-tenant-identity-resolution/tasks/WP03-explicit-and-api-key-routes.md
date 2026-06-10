---
work_package_id: WP03
title: Explicit Tenant and API-Key Routes
status: planned
depends_on: [WP02]
---

# WP03: Explicit Tenant and API-Key Routes

## Goal

Port route surfaces that already have explicit tenant semantics to the shared resolver.

## Scope

- Port `joyus-ai-mcp-server/src/exports/router.ts`.
- Replace `canAccessTenant()` runtime authorization in `joyus-ai-mcp-server/src/exports/service.ts`.
- Keep existing export response shapes and signed URL behavior.
- Port `joyus-ai-mcp-server/src/content/mediation/auth.ts` through the API-key resolver adapter.
- Preserve existing API key behavior and last-used updates.

## Tests

- Export request for an authorized tenant succeeds.
- Export request for an unauthorized tenant fails closed.
- Export download lookup preserves existing contract.
- Valid content mediation API key resolves tenant from key record.
- Inactive content mediation API key still fails.
- User JWT validation continues to attach user id for audit context.

## Done When

- Exports no longer authorize through `EXPORT_TENANT_ALLOWLIST` at runtime.
- Content mediation remains API-key compatible.
- Targeted exports and mediation tests pass.
