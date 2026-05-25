---
work_package_id: WP05
title: Admin Cleanup and Acceptance
status: planned
depends_on: [WP04]
---

# WP05: Admin Cleanup and Acceptance

## Goal

Finish the migration by replacing header-only admin tenant selection and removing runtime allowlist bypasses.

## Scope

- Replace event adapter admin `x-tenant-id` behavior with a membership-backed selector or explicit operator override.
- Require operator override reason when crossing ordinary membership boundaries.
- Remove runtime dependence on `EXPORT_TENANT_ALLOWLIST`.
- Remove runtime dependence on `EXPORT_ALLOW_ANY_TENANT`.
- Run final acceptance checks.

## Tests

- Admin user sees only authorized tenants by default.
- Operator override can access a target tenant only with operator role and reason.
- Non-operator override fails.
- Override emits a tenant access audit event.
- Legacy env allowlist no longer authorizes runtime access.

## Done When

- `npm run typecheck` or equivalent passes in `joyus-ai-mcp-server/`.
- Targeted vitest suites pass.
- `scripts/check-client-abstraction.sh` passes.
- `git diff --check` passes.
