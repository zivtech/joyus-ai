# Quickstart: Tenant Identity Resolution

This quickstart describes how to validate Spec 013 after implementation.

## 1. Apply schema migrations

```bash
cd joyus-ai-mcp-server
npm run db:migrate
```

Expected result:

- `tenants` exists.
- `tenant_memberships` exists.
- Every existing user has an active primary membership where `tenant_id` matches the current compatibility tenant.

## 2. Run targeted tests

```bash
cd joyus-ai-mcp-server
npm test -- --run tests/auth tests/exports.test.ts tests/content/integration/mediation-auth.test.ts tests/pipelines/routes.test.ts tests/event-adapter
```

Expected result:

- Default tenant resolution succeeds for a single-membership user.
- Explicit authorized tenant succeeds.
- Explicit unauthorized tenant fails closed.
- API-key mediation still resolves tenant from the key record.
- Operator override succeeds only for an operator role and records an audit event.

## 3. Check for legacy runtime paths

```bash
# Run from the repository root. Canonical acceptance grep (matches plan.md Acceptance Gate 3).
rg -n "x-tenant-id|EXPORT_TENANT_ALLOWLIST|EXPORT_ALLOW_ANY_TENANT|userId === tenantId|tenantId = userId|req.mcpUser\\.id" joyus-ai-mcp-server/src joyus-ai-mcp-server/tests kitty-specs/013-tenant-identity-resolution
```

Expected result:

- Remaining source matches are only documented compatibility comments, migration helpers, or tests.
- No production route authorizes tenant access from a request header alone.

## 4. Run platform checks

```bash
# Run from the repository root.
scripts/check-client-abstraction.sh
git diff --check
```

Expected result:

- No client-specific terms are introduced.
- No whitespace or encoding issues are introduced.
