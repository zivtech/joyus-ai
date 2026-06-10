# Research: Tenant Identity Resolution

## Decision: Membership-backed tenant authorization

**Decision**: Add `tenants` and `tenant_memberships` as shared platform tables. Use `tenant_memberships` as the authorization source for bearer-token users and operator override checks.

**Rationale**: The current `userId === tenantId` convention cannot represent a user who belongs to multiple tenants. The exports allowlist can represent that case only through environment configuration. A membership table provides a durable, auditable, queryable policy source.

**Evidence**: Issue #37 and `kitty-specs/009-automated-pipelines-framework/tenant-resolution-notes.md` both identify the missing user-to-tenant mapping as the central architectural gap.

## Decision: API-key tenant remains authoritative

**Decision**: Content mediation keeps the API key record as the source of tenant id. The shared resolver accepts an API-key source and returns a `TenantContext` without requiring the external end-user subject to exist in the local `users` table.

**Rationale**: API keys are issued per tenant and already decouple integration identity from local user identity. Requiring all external subjects to be local users would break the mediation model and force a new identity provider integration that is out of scope.

## Decision: Explicit requested tenant must be authorized

**Decision**: Explicit path or query tenant selection is modeled as `requestedTenantId`. The resolver authorizes it against memberships unless the request is API-key scoped or an operator override.

**Rationale**: This preserves exports route semantics while replacing `EXPORT_TENANT_ALLOWLIST` with a first-class database policy.

## Decision: Primary tenant default

**Decision**: Requests without an explicit tenant use the user's primary membership. If no primary exists and multiple memberships are active, the resolver fails closed with a 400 error.

**Rationale**: Silent selection among multiple tenants is unsafe. A primary tenant preserves simple user flows without allowing ambiguous tenant context.

## Decision: Operator override is separate from membership

**Decision**: Operators need an explicit override path with role gating and audit logging. Override is not treated as ordinary membership.

**Rationale**: Operational support needs are real, but silent all-tenant access would erase the authorization boundary. Keeping override separate makes privileged actions visible and testable.

## Alternatives Considered

| Alternative | Rejected because |
|-------------|-----------------|
| Keep `userId === tenantId` permanently | Cannot support multi-tenant users or operator workflows |
| Expand `EXPORT_TENANT_ALLOWLIST` to all modules | Env configuration is not auditable enough and does not scale to route logic |
| Trust `x-tenant-id` headers after bearer auth | Headers identify requested context, not authorization; they must not be trusted by themselves |
| Require API-key end users to be local users | Breaks content mediation integrations and expands scope into identity provider federation |
