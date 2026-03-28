---
work_package_id: WP02
title: Profile Access Control
lane: planned
dependencies: [WP01]
subtasks: [T008, T009, T010, T011, T012]
history:
- date: '2026-03-14'
  action: created
  agent: claude-opus
---

# WP02: Profile Access Control

**Implementation command**: `spec-kitty implement WP02 --base WP01`
**Target repo**: `joyus-ai`
**Dependencies**: WP01 (Profile Schema & Tenant Scoping)
**Priority**: P0 (Security foundation — every operation goes through this)

## Objective

Implement the `assertProfileAccessOrAudit()` guard, custom error types, audit log writer, and session-profile binding validation. This is the single enforcement point for tenant isolation — all profile operations (read, write, use-in-generation, version-pin) must pass through this guard before touching any profile data.

## Context

The `joyus-ai` platform uses Express middleware for authentication. The existing `src/content/mediation/auth.ts` establishes the pattern:
- `req.tenantId` is set by the API key validation middleware
- `req.userId` is set by the JWT validation middleware
- Both are available on every authenticated request

The profile access guard follows a different pattern than the auth middleware — it is not Express middleware itself. Instead, it is a function called by route handlers and service methods:

```typescript
// Usage in a route handler:
const profile = await assertProfileAccessOrAudit(db, {
  tenantId: req.tenantId,
  userId: req.userId,
  profileId: req.params.id,
  action: 'read',
});
// If we get here, access is allowed and the profile is returned
```

The guard:
1. Fetches the profile from the DB
2. Checks if the profile exists
3. Checks if `profile.tenantId === requestingTenantId`
4. Logs the access attempt (success or failure) to the audit log
5. Returns the profile on success, throws on failure

**Security design decision**: On both "profile not found" and "wrong tenant", return a uniform `ProfileNotFoundError` with 404 status. This prevents tenant enumeration attacks — an attacker cannot distinguish between "this profile doesn't exist" and "this profile exists but belongs to another tenant."

---

## Subtasks

### T008: Implement ProfileAccessDeniedError and ProfileNotFoundError (`src/profiles/access/errors.ts`)

**Purpose**: Define custom error types for profile access control that carry structured metadata for audit logging and error responses.

**Steps**:
1. Create `src/profiles/access/errors.ts`
2. Define `ProfileNotFoundError` — thrown when profile doesn't exist OR belongs to wrong tenant
3. Define `ProfileAccessDeniedError` — internal-only error used for audit logging (never exposed to client)

```typescript
// src/profiles/access/errors.ts

export class ProfileNotFoundError extends Error {
  readonly statusCode = 404;
  readonly code = 'PROFILE_NOT_FOUND';

  constructor(profileId: string) {
    super(`Profile not found: ${profileId}`);
    this.name = 'ProfileNotFoundError';
  }
}

/**
 * Internal error used ONLY for audit logging when a cross-tenant access
 * attempt is detected. This error is caught by the guard and converted
 * to a ProfileNotFoundError before being thrown to the caller.
 *
 * It is never sent to the client directly.
 */
export class ProfileAccessDeniedError extends Error {
  readonly statusCode = 403;
  readonly code = 'PROFILE_ACCESS_DENIED';

  constructor(
    public readonly profileId: string,
    public readonly requestingTenantId: string,
    public readonly owningTenantId: string,
  ) {
    super(`Tenant ${requestingTenantId} denied access to profile ${profileId} owned by ${owningTenantId}`);
    this.name = 'ProfileAccessDeniedError';
  }
}
```

**Files**:
- `src/profiles/access/errors.ts` (new, ~35 lines)

**Validation**:
- [ ] `ProfileNotFoundError` has `statusCode: 404`
- [ ] `ProfileAccessDeniedError` carries `profileId`, `requestingTenantId`, `owningTenantId`
- [ ] `tsc --noEmit` passes

---

### T009: Implement audit log writer (`src/profiles/access/audit.ts`)

**Purpose**: Provide a structured interface for writing profile audit entries. The writer only exposes `logAccess()` and `logDenial()` — no update or delete methods — making the audit log append-only by design.

**Steps**:
1. Create `src/profiles/access/audit.ts`
2. Implement `ProfileAuditWriter` class with `logAccess` and `logDenial` methods
3. Implement `queryAuditLog` helper for the audit query route

```typescript
// src/profiles/access/audit.ts
import { eq, and, desc, gte, lte } from 'drizzle-orm';
import { createId } from '@paralleldrive/cuid2';
import { profileAuditLog } from '../schema.js';
import type { AuditAction } from '../types.js';
import type { DrizzleClient } from '../../content/types.js';

export class ProfileAuditWriter {
  constructor(private readonly db: DrizzleClient) {}

  /**
   * Log a successful profile access. Called by the guard on allowed access.
   */
  async logAccess(params: {
    tenantId: string;
    userId: string;
    profileId: string;
    action: AuditAction;
    metadata?: Record<string, unknown>;
  }): Promise<void> {
    await this.db.insert(profileAuditLog).values({
      id: createId(),
      tenantId: params.tenantId,
      userId: params.userId,
      profileId: params.profileId,
      action: params.action,
      result: 'allowed',
      metadata: params.metadata ?? {},
    });
  }

  /**
   * Log a denied profile access attempt. Called by the guard on cross-tenant denial.
   */
  async logDenial(params: {
    tenantId: string;
    userId: string;
    profileId: string;
    action: AuditAction;
    metadata?: Record<string, unknown>;
  }): Promise<void> {
    await this.db.insert(profileAuditLog).values({
      id: createId(),
      tenantId: params.tenantId,
      userId: params.userId,
      profileId: params.profileId,
      action: 'access_denied',
      result: 'denied',
      metadata: {
        attemptedAction: params.action,
        ...(params.metadata ?? {}),
      },
    });
  }
}

/**
 * Query audit log entries for a tenant + profile with optional filters.
 */
export async function queryAuditLog(
  db: DrizzleClient,
  params: {
    tenantId: string;
    profileId: string;
    action?: AuditAction;
    startDate?: Date;
    endDate?: Date;
    limit: number;
    offset: number;
  },
): Promise<Array<typeof profileAuditLog.$inferSelect>> {
  const conditions = [
    eq(profileAuditLog.tenantId, params.tenantId),
    eq(profileAuditLog.profileId, params.profileId),
  ];

  if (params.action) {
    conditions.push(eq(profileAuditLog.action, params.action));
  }
  if (params.startDate) {
    conditions.push(gte(profileAuditLog.createdAt, params.startDate));
  }
  if (params.endDate) {
    conditions.push(lte(profileAuditLog.createdAt, params.endDate));
  }

  return db
    .select()
    .from(profileAuditLog)
    .where(and(...conditions))
    .orderBy(desc(profileAuditLog.createdAt))
    .limit(params.limit)
    .offset(params.offset);
}
```

**Files**:
- `src/profiles/access/audit.ts` (new, ~80 lines)

**Validation**:
- [ ] `ProfileAuditWriter` exposes only `logAccess` and `logDenial` — no update/delete
- [ ] `logDenial` always sets `action: 'access_denied'` and `result: 'denied'` regardless of the attempted action
- [ ] `queryAuditLog` filters by `tenantId` (mandatory — never returns cross-tenant entries)
- [ ] `tsc --noEmit` passes

**Edge Cases**:
- Audit writes are fire-and-forget in the guard (they should not block the response). But if the audit write fails, the guard should still return the profile — do not fail the request because the audit log is down. Log the audit write failure to stderr.
- `DrizzleClient` type is imported from `src/content/types.ts` to reuse the existing type definition. If the content module is not available, define it locally.

---

### T010: Implement assertProfileAccessOrAudit guard (`src/profiles/access/guard.ts`)

**Purpose**: The single enforcement point for profile tenant isolation. Every code path that touches a profile calls this function.

**Steps**:
1. Create `src/profiles/access/guard.ts`
2. Implement `assertProfileAccessOrAudit` — fetch profile, check tenant, audit, return or throw
3. Handle the "profile not found" and "wrong tenant" cases uniformly

```typescript
// src/profiles/access/guard.ts
import { eq } from 'drizzle-orm';
import { profiles } from '../schema.js';
import { ProfileNotFoundError, ProfileAccessDeniedError } from './errors.js';
import { ProfileAuditWriter } from './audit.js';
import type { AuditAction } from '../types.js';
import type { DrizzleClient } from '../../content/types.js';

/**
 * Assert that the requesting tenant has access to the specified profile.
 *
 * On success: logs the access and returns the profile row.
 * On failure (not found or wrong tenant): logs the denial and throws ProfileNotFoundError.
 *
 * IMPORTANT: This function ALWAYS returns 404 for both "not found" and "wrong tenant"
 * to prevent tenant enumeration attacks.
 */
export async function assertProfileAccessOrAudit(
  db: DrizzleClient,
  params: {
    tenantId: string;
    userId: string;
    profileId: string;
    action: AuditAction;
    metadata?: Record<string, unknown>;
  },
): Promise<typeof profiles.$inferSelect> {
  const auditWriter = new ProfileAuditWriter(db);

  const rows = await db
    .select()
    .from(profiles)
    .where(eq(profiles.id, params.profileId))
    .limit(1);
  const profile = rows[0];

  // Case 1: Profile does not exist
  if (!profile) {
    // Log denial — the profileId is logged even though the profile doesn't exist,
    // so we can detect enumeration attempts
    await auditWriter.logDenial({
      tenantId: params.tenantId,
      userId: params.userId,
      profileId: params.profileId,
      action: params.action,
      metadata: { reason: 'not_found', ...params.metadata },
    }).catch((err) => {
      console.error('[profile-access] Failed to write audit denial:', err);
    });

    throw new ProfileNotFoundError(params.profileId);
  }

  // Case 2: Profile exists but belongs to a different tenant
  if (profile.tenantId !== params.tenantId) {
    await auditWriter.logDenial({
      tenantId: params.tenantId,
      userId: params.userId,
      profileId: params.profileId,
      action: params.action,
      metadata: {
        reason: 'tenant_mismatch',
        owningTenantId: profile.tenantId,
        ...params.metadata,
      },
    }).catch((err) => {
      console.error('[profile-access] Failed to write audit denial:', err);
    });

    // Throw 404 (not 403) to prevent enumeration
    throw new ProfileNotFoundError(params.profileId);
  }

  // Case 3: Access allowed
  await auditWriter.logAccess({
    tenantId: params.tenantId,
    userId: params.userId,
    profileId: params.profileId,
    action: params.action,
    metadata: params.metadata,
  }).catch((err) => {
    console.error('[profile-access] Failed to write audit access:', err);
  });

  return profile;
}
```

**Files**:
- `src/profiles/access/guard.ts` (new, ~70 lines)

**Validation**:
- [ ] Profile not found -> logs denial with reason `not_found`, throws `ProfileNotFoundError` (404)
- [ ] Wrong tenant -> logs denial with reason `tenant_mismatch`, throws `ProfileNotFoundError` (404, not 403)
- [ ] Correct tenant -> logs access, returns the profile row
- [ ] Audit write failures are caught and logged to stderr (never fail the request)
- [ ] `tsc --noEmit` passes

**Edge Cases**:
- The guard creates a new `ProfileAuditWriter` on each call. This is cheap (no state, just a db reference). If performance profiling shows this as a bottleneck, pass the writer as a parameter.
- The `metadata` parameter allows callers to add context (e.g., which route, which MCP tool, what version was requested).

---

### T011: Implement session-profile binding validation

**Purpose**: When a mediation session references a profile via `activeProfileId`, validate that the session's tenant matches the profile's tenant. This prevents cross-tenant profile leakage through session binding.

**Steps**:
1. Create a validation function `validateSessionProfileBinding` in `src/profiles/access/guard.ts` (or a separate file)
2. Called during session creation or profile binding — NOT as middleware, but as a service function

```typescript
// Add to src/profiles/access/guard.ts

/**
 * Validate that a mediation session's tenant matches the profile's tenant.
 * Called when binding a profile to a session or creating a session with activeProfileId.
 *
 * Returns the profile if valid, throws ProfileNotFoundError if invalid.
 */
export async function validateSessionProfileBinding(
  db: DrizzleClient,
  params: {
    sessionTenantId: string;
    userId: string;
    profileId: string;
  },
): Promise<typeof profiles.$inferSelect> {
  return assertProfileAccessOrAudit(db, {
    tenantId: params.sessionTenantId,
    userId: params.userId,
    profileId: params.profileId,
    action: 'use_in_generation',
    metadata: { context: 'session_profile_binding' },
  });
}
```

**Files**:
- `src/profiles/access/guard.ts` (modified — add function)

**Validation**:
- [ ] Session with matching tenant -> returns profile
- [ ] Session with different tenant -> throws `ProfileNotFoundError`
- [ ] Access logged with `action: 'use_in_generation'` and `context: 'session_profile_binding'`

---

### T012: Create access module barrel and unit tests

**Purpose**: Barrel export for the access module and comprehensive unit tests for all access control logic.

**Steps**:
1. Create `src/profiles/access/index.ts` barrel export
2. Create `tests/profiles/access/guard.test.ts` — unit tests for assertProfileAccessOrAudit
3. Create `tests/profiles/access/audit.test.ts` — unit tests for ProfileAuditWriter

```typescript
// src/profiles/access/index.ts
export { ProfileNotFoundError, ProfileAccessDeniedError } from './errors.js';
export { ProfileAuditWriter, queryAuditLog } from './audit.js';
export { assertProfileAccessOrAudit, validateSessionProfileBinding } from './guard.js';
```

**Test cases for guard.test.ts**:
- Profile exists, same tenant -> returns profile, audit log has `allowed` entry
- Profile exists, different tenant -> throws ProfileNotFoundError (not 403), audit log has `denied` entry
- Profile does not exist -> throws ProfileNotFoundError, audit log has `denied` entry with `not_found` reason
- Audit write failure -> still returns profile / still throws error (audit failure is non-blocking)

**Test cases for audit.test.ts**:
- `logAccess` creates entry with `result: 'allowed'`
- `logDenial` creates entry with `result: 'denied'` and `action: 'access_denied'`
- `queryAuditLog` filters by tenantId (never returns other tenants' entries)
- `queryAuditLog` respects action, date range, limit, and offset filters

**Files**:
- `src/profiles/access/index.ts` (new, ~5 lines)
- `tests/profiles/access/guard.test.ts` (new, ~120 lines)
- `tests/profiles/access/audit.test.ts` (new, ~80 lines)

**Validation**:
- [ ] All unit tests pass
- [ ] `tsc --noEmit` passes on all files
- [ ] `npm run typecheck` exits 0
- [ ] `npm test` exits 0 with no regressions

---

## Definition of Done

- [ ] `src/profiles/access/errors.ts` — `ProfileNotFoundError`, `ProfileAccessDeniedError`
- [ ] `src/profiles/access/audit.ts` — `ProfileAuditWriter`, `queryAuditLog`
- [ ] `src/profiles/access/guard.ts` — `assertProfileAccessOrAudit`, `validateSessionProfileBinding`
- [ ] `src/profiles/access/index.ts` — barrel export
- [ ] Unit tests for guard (4+ test cases) and audit writer (4+ test cases)
- [ ] Both "not found" and "wrong tenant" return 404 (not 403)
- [ ] Audit write failures are non-blocking
- [ ] `npm run typecheck` exits 0
- [ ] `npm test` exits 0 with no regressions

## Risks

- **Uniform 404 trade-off**: Returning 404 for both "not found" and "wrong tenant" prevents enumeration but makes debugging harder. The audit log captures the real reason (`not_found` vs `tenant_mismatch`) — operators can distinguish via audit queries.
- **Audit write latency**: Each profile access writes an audit entry. Under high throughput, this adds ~1-2ms per request. If this becomes a bottleneck, batch audit writes or use COPY protocol. For now, single inserts are acceptable.
- **DrizzleClient type import**: Importing from `../../content/types.ts` creates a cross-module dependency. If the content module is not available, define `DrizzleClient` locally.

## Reviewer Guidance

- Verify the guard ALWAYS throws `ProfileNotFoundError` (never `ProfileAccessDeniedError`) to the caller. The `ProfileAccessDeniedError` is internal only — for audit metadata.
- Check that audit writes use `.catch()` — they must never fail the request.
- Confirm the audit log writer has no `update` or `delete` methods — append-only by design.
- Verify `queryAuditLog` always filters by `tenantId` as a mandatory condition.
