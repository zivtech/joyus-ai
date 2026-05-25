# Data Model: Tenant Identity Resolution

## Entities

### Tenant

Represents a stable platform tenant.

| Field | Type | Required | Notes |
|-------|------|----------|-------|
| `id` | text | yes | Stable tenant id. Existing compatibility tenants use the user id. |
| `displayName` | text | no | Generic display label such as `Example Corp`. |
| `status` | enum | yes | `active`, `suspended`, or `archived`. |
| `metadata` | json | no | Platform-generic metadata only. |
| `createdAt` | timestamp | yes | Creation timestamp. |
| `updatedAt` | timestamp | yes | Last update timestamp. |

### TenantMembership

Maps a local user to a tenant.

| Field | Type | Required | Notes |
|-------|------|----------|-------|
| `id` | text | yes | Generated id. |
| `userId` | text | yes | References `users.id`. |
| `tenantId` | text | yes | References `tenants.id`. |
| `role` | enum | yes | `member`, `admin`, or `operator`. |
| `isPrimary` | boolean | yes | Default tenant flag for this user. |
| `status` | enum | yes | `active`, `revoked`, or `invited`. |
| `createdAt` | timestamp | yes | Creation timestamp. |
| `updatedAt` | timestamp | yes | Last update timestamp. |

Constraints:

- Unique membership on `(user_id, tenant_id)`.
- Index on `(tenant_id, role)`.
- Index on `(user_id, status)`.
- At most one active primary membership per user.

### TenantContext

Runtime object returned by the resolver. This is not stored directly.

```typescript
type TenantContextSource =
  | 'bearer_default'
  | 'bearer_requested'
  | 'api_key'
  | 'operator_override';

interface TenantContext {
  tenantId: string;
  userId?: string;
  source: TenantContextSource;
  role?: 'member' | 'admin' | 'operator';
  apiKeyId?: string;
  requestedTenantId?: string;
  overrideReason?: string;
}
```

### TenantAccessAudit

Records privileged tenant context changes.

| Field | Type | Required | Notes |
|-------|------|----------|-------|
| `id` | text | yes | Generated id. |
| `actorUserId` | text | yes | Authenticated user. |
| `targetTenantId` | text | yes | Tenant operated on. |
| `source` | text | yes | Expected value `operator_override` for this feature. |
| `reason` | text | yes | Human-readable override reason. |
| `route` | text | no | Route or tool surface. |
| `createdAt` | timestamp | yes | Audit timestamp. |

## Migration Strategy

1. Create `tenants`, `tenant_memberships`, and optional `tenant_access_audit`.
2. For every existing `users` row, create a tenant with `id = users.id` if one does not exist.
3. For every existing `users` row, create an active primary membership with `tenantId = users.id` and role `admin`.
4. Read `EXPORT_TENANT_ALLOWLIST` only in a one-time migration helper, if needed, to create additional memberships.
5. Keep existing tenant-scoped data rows unchanged. Their current `tenant_id` values remain valid.
6. After route migration, remove runtime dependence on `EXPORT_TENANT_ALLOWLIST` and `EXPORT_ALLOW_ANY_TENANT`.

## Resolver Inputs

The shared resolver accepts the following input shapes:

```typescript
interface BearerTenantRequest {
  kind: 'bearer';
  userId: string;
  requestedTenantId?: string;
  nonDisclosure?: boolean;
}

interface ApiKeyTenantRequest {
  kind: 'api_key';
  apiKeyId: string;
  tenantId: string;
  userId?: string;
}

interface OperatorTenantRequest {
  kind: 'operator_override';
  userId: string;
  requestedTenantId: string;
  reason: string;
}
```

## Error Outcomes

| Condition | Outcome |
|-----------|---------|
| Missing authenticated identity | 401 |
| No tenant specified and no primary membership | 400 |
| No tenant specified and multiple active memberships without primary | 400 |
| Requested tenant without membership | 403 or 404 based on route non-disclosure policy |
| Requested suspended or archived tenant | 403 |
| Operator override without operator role | 403 |
| API key inactive or missing tenant | 401 |
