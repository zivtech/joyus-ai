---
work_package_id: "WP04"
title: "Operator Grant Administration (write path)"
lane: "planned"
dependencies: ["WP01", "WP02"]
subtasks: ["T020", "T021", "T022", "T023", "T024", "T025", "T026"]
history:
  - date: "2026-06-14"
    action: "created"
    agent: "claude-opus"
---

# WP04: Operator Grant Administration (write path)

**Implementation command**: `spec-kitty implement WP04`
**Target repo**: `joyus-ai`
**Dependencies**: WP01 (schema + types), WP02 (FeatureGate + subject-scoped cache)
**Priority**: P1 — creates grants (Scenario 1). Without this, Phase 1 can enforce grants but cannot create them through any defined interface.

## Objective

Build the authorized write surface for `feature_entitlements` and `feature_catalog`: a `GrantsService`, a `CatalogService`, operator REST endpoints, and admin-only MCP tools. Every mutating operation is idempotent, carries actor identity in the audit trail, and triggers subject-cache invalidation on WP02's cache so revocations take effect before TTL expiry on the local node.

This is also the boundary where billing automation later attaches (`source=resolver|import`). The design must not bake in assumptions that make that harder.

## Context

### Auth model in the codebase today

The codebase has **no operator/admin role**. The `users` table (`src/db/schema.ts:54-60`) has only `id`, `email`, `name`, `mcpToken`, `createdAt`, `updatedAt` — no `isOperator`, no `role` column. Authentication is bearer-token-via-`mcpToken` (`src/auth/verify.ts:26-33`), which resolves to `req.mcpUser` (a `UserWithConnections`) via `requireBearerToken` middleware (`src/auth/middleware.ts:26-48`). Every authenticated user is a peer — there is no privileged tier.

**This WP must define the operator/admin boundary.** The minimum viable approach is an **env-var allowlist**: `OPERATOR_USER_IDS=id1,id2,...` loaded at startup. A middleware reads this set and rejects any `req.mcpUser.id` not in it with 403. This requires zero schema migration, ships fast, and can be replaced later with `users.isOperator` column + a migration once the need for self-serve operator promotion is clear. The implementer must **confirm this decision** before wiring middleware — the alternative (adding `isOperator: boolean` to the `users` table, `src/db/schema.ts`) is equally valid and preferable if the operator set needs to be managed without a redeploy.

**Precedent for a distinct admin tier:** `index.ts:373-405` already implements a separate `/event-adapter/admin` route protected by `session.adminUserId` (a session-cookie-based admin gate, distinct from bearer auth). This WP's operator gate follows the same principle — a distinct check, not reuse of the tenant-user bearer path — but uses the bearer token plus the operator check rather than session cookies, since the MCP and REST surfaces both expect bearer auth.

**The crux of the security model:** A tenant user's bearer token must never satisfy the operator check. The operator check must be applied as a **separate, explicit middleware** layered on top of `requireBearerToken` — not as a conditional inside route handlers where it could be skipped.

### Existing patterns to follow

- **ToolDefinition shape** (`src/tools/index.ts:19-27`): `{ name, description, inputSchema: { type: 'object', properties, required? } }`. Admin MCP tools follow this exactly.
- **Bearer token auth** (`src/auth/middleware.ts`): `requireBearerToken` sets `req.mcpUser`. Admin routes add `requireOperator` after this.
- **Route mounting** (`src/index.ts:309-335`): routes are mounted with `app.use('/path', middleware, router)`. Admin entitlement routes mount as `/api/v1/admin/entitlements` and `/api/v1/admin/catalog`.
- **Drizzle ORM** (`src/content/schema.ts`): CUID2 PKs, `$inferSelect`/`$inferInsert` types, `pgSchema` namespace. The `entitlements` schema was introduced by WP01.
- **Content module init pattern** (`src/content/index.js`): modules export an `initializeXxx` function called from `index.ts`. This WP's services wire the same way.

### Subject-cache invalidation hook (WP02 dependency)

WP02 (`FeatureGate` + `EntitlementCache`) must expose an explicit `invalidateSubject(subject: Subject): void` method. WP04 calls this after every `GrantsService.grant()`, `modify()`, and `revoke()`. If WP02 has not landed yet, stub the call — but do not skip it. This is the invalidation on the local node; cross-instance propagation is TTL-bounded (FR-018, accepted as Phase 1 baseline).

---

## Subtasks

### T020: `GrantsService` — idempotent grant/modify/revoke with actor audit

**Purpose**: The single authoritative write surface for `feature_entitlements` rows. Every operation is idempotent (safe to retry), records actor identity to `entitlement_decisions` (or a grant-history log), and returns the current post-operation row.

**Steps**:
1. Create `src/entitlements/grants.service.ts`.
2. Inject `DrizzleClient` and the WP02 `FeatureGate` (for cache invalidation) via constructor.
3. Implement `grant`, `modify`, and `revoke` as described below.
4. Write a grant-history record on every mutation using WP01's `entitlements.entitlement_decisions` table — this is the audit trail for FR-015. The record carries: `subject_type`, `subject_id`, `feature_key`, `decision='allow'|'deny'` (for grant) or a grant-lifecycle action (for modify/revoke), `reason`, `resolved_from='db'`, and the `actorId` in `metadata` (or a dedicated `actor_id` column if WP01 adds one — confirm with WP01 implementer).
5. After every mutating DB write, call `featureGate.invalidateSubject(subject)`.

**Idempotency contract:**

The `UNIQUE (subject_type, subject_id, feature_key)` constraint (WP01 `data-model.md`) means there is exactly one live row per subject+feature. All three operations implement an **upsert/transition** pattern — they never error on "already in that state":

```typescript
// src/entitlements/grants.service.ts

import { createId } from '@paralleldrive/cuid2';
import { and, eq } from 'drizzle-orm';

import type { DrizzleClient } from '../db/types.js';
import type { FeatureGate } from './gate.js';            // WP02
import {
  featureEntitlements,
  entitlementDecisions,
} from './schema.js';                                     // WP01
import type {
  Subject,
  FeatureKey,
  GrantSource,
  GrantStatus,
} from './types.js';                                     // WP01

export interface GrantInput {
  subject: Subject;
  featureKey: FeatureKey;
  source: GrantSource;                // 'admin' | 'resolver' | 'trial' | 'import'
  validFrom?: Date;                   // defaults to now()
  validUntil?: Date | null;           // null = perpetual
  limits?: Record<string, unknown> | null;
  metadata?: Record<string, unknown> | null;
}

export interface ModifyInput {
  subject: Subject;
  featureKey: FeatureKey;
  validUntil?: Date | null;
  limits?: Record<string, unknown> | null;
  metadata?: Record<string, unknown> | null;
  status?: GrantStatus;
}

export class GrantsService {
  constructor(
    private readonly db: DrizzleClient,
    private readonly featureGate: FeatureGate,           // for cache invalidation
    private readonly actorId: string,                    // operator user id — set per-request
  ) {}

  /**
   * Create or reactivate a grant (upsert by subject+featureKey).
   * If a row already exists (any status), transitions it to 'active' with the new params.
   * Idempotent: calling with the same inputs leaves the row unchanged and is not an error.
   */
  async grant(input: GrantInput): Promise<typeof featureEntitlements.$inferSelect> {
    const now = new Date();
    const validFrom = input.validFrom ?? now;

    const existing = await this.findExisting(input.subject, input.featureKey);

    let row: typeof featureEntitlements.$inferSelect;

    if (!existing) {
      const [inserted] = await this.db
        .insert(featureEntitlements)
        .values({
          id: createId(),
          subjectType: input.subject.subjectType,
          subjectId: input.subject.subjectId,
          featureKey: input.featureKey,
          status: 'active',
          validFrom,
          validUntil: input.validUntil ?? null,
          source: input.source,
          limits: input.limits ?? null,
          metadata: input.metadata ?? null,
          createdAt: now,
          updatedAt: now,
        })
        .returning();
      row = inserted;
    } else {
      const [updated] = await this.db
        .update(featureEntitlements)
        .set({
          status: 'active',
          validFrom,
          validUntil: input.validUntil ?? null,
          source: input.source,
          limits: input.limits ?? null,
          metadata: input.metadata ?? null,
          updatedAt: now,
        })
        .where(eq(featureEntitlements.id, existing.id))
        .returning();
      row = updated;
    }

    await this.writeAudit(input.subject, input.featureKey, 'grant', 'entitled');
    this.featureGate.invalidateSubject(input.subject);

    return row;
  }

  /**
   * Modify an existing grant's window, limits, or status.
   * No-ops gracefully if the row does not exist (returns null).
   */
  async modify(input: ModifyInput): Promise<typeof featureEntitlements.$inferSelect | null> {
    const existing = await this.findExisting(input.subject, input.featureKey);
    if (!existing) return null;

    const [updated] = await this.db
      .update(featureEntitlements)
      .set({
        ...(input.validUntil !== undefined ? { validUntil: input.validUntil } : {}),
        ...(input.limits !== undefined ? { limits: input.limits } : {}),
        ...(input.metadata !== undefined ? { metadata: input.metadata } : {}),
        ...(input.status !== undefined ? { status: input.status } : {}),
        updatedAt: new Date(),
      })
      .where(eq(featureEntitlements.id, existing.id))
      .returning();

    await this.writeAudit(input.subject, input.featureKey, 'modify', 'entitled');
    this.featureGate.invalidateSubject(input.subject);

    return updated;
  }

  /**
   * Revoke a grant — transitions status to 'revoked'.
   * Idempotent: if already revoked or absent, is a no-op.
   */
  async revoke(
    subject: Subject,
    featureKey: FeatureKey,
  ): Promise<typeof featureEntitlements.$inferSelect | null> {
    const existing = await this.findExisting(subject, featureKey);
    if (!existing || existing.status === 'revoked') return existing ?? null;

    const [updated] = await this.db
      .update(featureEntitlements)
      .set({ status: 'revoked', updatedAt: new Date() })
      .where(eq(featureEntitlements.id, existing.id))
      .returning();

    await this.writeAudit(subject, featureKey, 'revoke', 'not_entitled');
    this.featureGate.invalidateSubject(subject);

    return updated;
  }

  /** List all grants for a subject (all statuses). */
  async listForSubject(
    subject: Subject,
  ): Promise<Array<typeof featureEntitlements.$inferSelect>> {
    return this.db
      .select()
      .from(featureEntitlements)
      .where(
        and(
          eq(featureEntitlements.subjectType, subject.subjectType),
          eq(featureEntitlements.subjectId, subject.subjectId),
        ),
      );
  }

  private async findExisting(subject: Subject, featureKey: FeatureKey) {
    const [row] = await this.db
      .select()
      .from(featureEntitlements)
      .where(
        and(
          eq(featureEntitlements.subjectType, subject.subjectType),
          eq(featureEntitlements.subjectId, subject.subjectId),
          eq(featureEntitlements.featureKey, featureKey),
        ),
      )
      .limit(1);
    return row ?? null;
  }

  private async writeAudit(
    subject: Subject,
    featureKey: FeatureKey,
    action: string,
    decision: 'allow' | 'deny' | 'entitled' | 'not_entitled',
  ): Promise<void> {
    await this.db.insert(entitlementDecisions).values({
      id: createId(),
      subjectType: subject.subjectType,
      subjectId: subject.subjectId,
      featureKey,
      decision: decision === 'entitled' || decision === 'allow' ? 'allow' : 'deny',
      reason: decision === 'entitled' ? 'entitled' : 'not_entitled',
      resolvedFrom: 'db',
      capability: `admin:${action}`,
      sessionId: null,
      createdAt: new Date(),
      // actor identity carried in capability field as 'admin:grant|modify|revoke'
      // If WP01 adds a dedicated actor_id column, store this.actorId there instead.
    });
  }
}
```

**DECISION REQUIRED — actor identity in audit:**
The `entitlement_decisions` schema in WP01 (`data-model.md`) does not include an `actor_id` column. FR-015 requires "actor identity" in every grant write. Options:
- (A) Add `actor_id text NULL` to `entitlement_decisions` in WP01 and record `this.actorId` there. **Recommended** — makes actor queryable.
- (B) Embed actor in `capability` field as a structured string (e.g. `admin:grant:userId`). Zero schema change; harder to query.

Confirm with WP01 implementer before landing. The `GrantsService` code above uses option B as a fallback but is written to easily adopt A.

**Files**:
- `src/entitlements/grants.service.ts` (new, ~140 lines)

**Validation**:
- [ ] `tsc --noEmit` passes with zero errors
- [ ] `grant()` with no existing row inserts a new `active` row
- [ ] `grant()` with an existing `revoked` row transitions it to `active` (no duplicate row)
- [ ] `revoke()` called twice on the same subject+feature is a no-op on the second call
- [ ] Every mutation writes one row to `entitlement_decisions`
- [ ] `featureGate.invalidateSubject()` is called on every mutation

**Edge Cases**:
- `validFrom` default is `now()` — callers that set a future `validFrom` are creating a not-yet-active grant; the resolver must filter `valid_from <= now()` as well as `valid_until` (confirm in WP02 resolver).
- The `GrantsService` is **not a singleton** — it is instantiated per-request with the requesting actor's `actorId`. Do not store actor state on a shared service instance.
- `featureKey` FK → `feature_catalog` (RESTRICT on delete): inserting a grant for an unknown `featureKey` will fail at the DB level with a FK violation. Routes must handle this and return 422.

---

### T021: `CatalogService` — create and list `feature_catalog` entries

**Purpose**: Manage the authoritative list of licensable features. Operators need to register a feature before they can grant it.

**Steps**:
1. Create `src/entitlements/catalog.service.ts`.
2. Implement `create` and `list` methods against `entitlements.feature_catalog` (WP01 schema).
3. `create` is idempotent on `feature_key` (PK): attempt insert; if PK collision, return existing row (do not error).
4. `list` supports optional `status` filter (`active`/`deprecated`/`withdrawn`).

```typescript
// src/entitlements/catalog.service.ts

import { createId } from '@paralleldrive/cuid2';
import { eq } from 'drizzle-orm';

import type { DrizzleClient } from '../db/types.js';
import { featureCatalog } from './schema.js';             // WP01
import type { FeatureKey } from './types.js';             // WP01

export interface CreateCatalogEntryInput {
  featureKey: FeatureKey;           // e.g. 'com.joyus.addon.advanced-pipelines'
  displayName: string;
  description?: string;
  publisher: string;                // 'joyus' for first-party
  capabilityKinds: string[];        // ['tool', 'provider', ...]
  status?: 'active' | 'deprecated' | 'withdrawn';
}

export class CatalogService {
  constructor(private readonly db: DrizzleClient) {}

  /**
   * Register a new feature in the catalog.
   * If the feature_key already exists, returns the existing row (idempotent).
   * Note: feature keys are never reused — 'withdrawn' entries block reinsertion at the PK level.
   */
  async create(
    input: CreateCatalogEntryInput,
  ): Promise<typeof featureCatalog.$inferSelect> {
    const existing = await this.findByKey(input.featureKey);
    if (existing) return existing;

    const now = new Date();
    const [inserted] = await this.db
      .insert(featureCatalog)
      .values({
        featureKey: input.featureKey,
        displayName: input.displayName,
        description: input.description ?? null,
        publisher: input.publisher,
        capabilityKinds: input.capabilityKinds,
        status: input.status ?? 'active',
        createdAt: now,
        updatedAt: now,
      })
      .returning();

    return inserted;
  }

  /** List catalog entries, optionally filtered by status. */
  async list(
    statusFilter?: 'active' | 'deprecated' | 'withdrawn',
  ): Promise<Array<typeof featureCatalog.$inferSelect>> {
    if (statusFilter) {
      return this.db
        .select()
        .from(featureCatalog)
        .where(eq(featureCatalog.status, statusFilter));
    }
    return this.db.select().from(featureCatalog);
  }

  private async findByKey(
    featureKey: FeatureKey,
  ): Promise<typeof featureCatalog.$inferSelect | null> {
    const [row] = await this.db
      .select()
      .from(featureCatalog)
      .where(eq(featureCatalog.featureKey, featureKey))
      .limit(1);
    return row ?? null;
  }
}
```

**Files**:
- `src/entitlements/catalog.service.ts` (new, ~60 lines)

**Validation**:
- [ ] `create()` with a new `featureKey` inserts and returns the row
- [ ] `create()` called twice with the same `featureKey` returns the same row, no duplicate
- [ ] `list({ status: 'active' })` returns only active entries
- [ ] `tsc --noEmit` passes

**Edge Cases**:
- A `withdrawn` feature key cannot be re-registered (PK collision → returns the withdrawn row). The caller sees the withdrawn row and should treat it as a permanent tombstone, not a conflict to retry.

---

### T022: Operator REST routes for grants and catalog

**Purpose**: HTTP surface for operator tooling, billing automation (`source=import`), and CLI scripts. Admin-only: guarded by `requireBearerToken` + `requireOperator`.

**Steps**:
1. Create `src/entitlements/admin-routes.ts` exporting `createAdminEntitlementsRouter(services)`.
2. Mount at `/api/v1/admin/entitlements` in `src/index.ts` (before the generic `/api` bearer router at line 335, following the content-route precedent at line 321).
3. Use Zod validation from WP01 (`validation.ts`) for all request bodies.
4. Return structured JSON errors on validation failure (422) and FK violation (422 "unknown feature_key").

**Routes**:

```
POST   /api/v1/admin/entitlements/catalog
         Body: CreateCatalogEntryInput
         → 201 { entry }

GET    /api/v1/admin/entitlements/catalog
         Query: ?status=active|deprecated|withdrawn
         → 200 { entries: [] }

POST   /api/v1/admin/entitlements/grants
         Body: { subject_type, subject_id, feature_key, source, valid_from?, valid_until?, limits?, metadata? }
         → 201 { grant }

PATCH  /api/v1/admin/entitlements/grants
         Body: { subject_type, subject_id, feature_key, valid_until?, limits?, status? }
         → 200 { grant } | 404 if not found

DELETE /api/v1/admin/entitlements/grants
         Body: { subject_type, subject_id, feature_key }
         → 200 { grant } | 200 { revoked: false } if already absent

GET    /api/v1/admin/entitlements/grants
         Query: ?subject_type=&subject_id=
         → 200 { grants: [] }
```

**Sketch** (router factory pattern, matching `createPipelineRouter` / `createAdminRouter`):

```typescript
// src/entitlements/admin-routes.ts
import { Router } from 'express';
import { z } from 'zod';

import { requireBearerToken } from '../auth/middleware.js';
import { requireOperator } from './operator-auth.js';        // T024
import type { GrantsService } from './grants.service.js';
import type { CatalogService } from './catalog.service.js';

export function createAdminEntitlementsRouter(services: {
  getGrantsService: (actorId: string) => GrantsService;     // factory — injects actorId per request
  catalogService: CatalogService;
}): Router {
  const router = Router();

  // All routes require bearer auth + operator role
  router.use(requireBearerToken, requireOperator);

  router.post('/catalog', async (req, res) => { /* ... */ });
  router.get('/catalog', async (req, res) => { /* ... */ });
  router.post('/grants', async (req, res) => { /* ... */ });
  router.patch('/grants', async (req, res) => { /* ... */ });
  router.delete('/grants', async (req, res) => { /* ... */ });
  router.get('/grants', async (req, res) => { /* ... */ });

  return router;
}
```

**Files**:
- `src/entitlements/admin-routes.ts` (new, ~130 lines)
- `src/index.ts` (modified: add `app.use('/api/v1/admin/entitlements', createAdminEntitlementsRouter(...))`)

**Validation**:
- [ ] A valid operator token + valid body → 201/200 with the expected shape
- [ ] A valid but non-operator bearer token → 403
- [ ] No bearer token → 401 (from `requireBearerToken`)
- [ ] Body missing required fields → 422 with Zod error detail
- [ ] Grant with unknown `feature_key` → 422 "unknown_feature_key"

**Edge Cases**:
- `DELETE /grants` uses a request body (non-standard but consistent). If HTTP client constraints are a concern, an alternative is `POST /grants/revoke`. Decide and document.
- Mount **before** `app.use('/api', requireBearerToken, ...)` (line 335 in `index.ts`) to avoid double middleware application.

---

### T023: Admin-only MCP tools for grants and catalog

**Purpose**: Expose grant administration through the MCP surface so operators can manage entitlements directly from Claude Desktop or the Joyus AI MCP client, without switching to a separate HTTP tool.

**Steps**:
1. Create `src/tools/admin-entitlement-tools.ts` exporting `adminEntitlementTools: ToolDefinition[]`.
2. Add `entitlement_admin_grant`, `entitlement_admin_revoke`, `entitlement_admin_list_grants`, `entitlement_admin_register_feature`, `entitlement_admin_list_catalog` tools matching the `ToolDefinition` shape exactly (`src/tools/index.ts:19-27`).
3. Create `src/tools/executors/admin-entitlement-executor.ts` with `executeAdminEntitlementTool`.
4. Wire into `executeTool` (`src/tools/executor.ts`): add an `entitlement_admin_` prefix branch — **after** the operator check confirms `req.mcpUser` is an operator (see T024).
5. Wire into `getAllTools` (`src/tools/index.ts`): admin tools are included **only** for operator users; non-operator users must not see them in `tools/list`.

**Tool definitions**:

```typescript
// src/tools/admin-entitlement-tools.ts
import { ToolDefinition } from './index.js';

export const adminEntitlementTools: ToolDefinition[] = [
  {
    name: 'entitlement_admin_grant',
    description:
      'OPERATOR ONLY. Grant a feature entitlement to a subject (user or tenant). ' +
      'Idempotent — reactivates an existing revoked grant rather than creating a duplicate.',
    inputSchema: {
      type: 'object',
      properties: {
        subject_type: { type: 'string', enum: ['user', 'tenant'], description: 'Subject kind.' },
        subject_id: { type: 'string', description: 'User ID or tenant ID.' },
        feature_key: { type: 'string', description: 'Reverse-DNS feature key, e.g. com.joyus.addon.advanced-pipelines.' },
        source: { type: 'string', enum: ['admin', 'trial', 'import'], description: 'Grant provenance.' },
        valid_until: { type: 'string', description: 'ISO 8601 expiry datetime. Omit for perpetual.' },
        limits: { type: 'object', description: 'Optional quota envelope, e.g. {"maxRunsPerMonth": 1000}.' },
      },
      required: ['subject_type', 'subject_id', 'feature_key', 'source'],
    },
  },
  {
    name: 'entitlement_admin_revoke',
    description:
      'OPERATOR ONLY. Revoke a feature entitlement. Idempotent. Cache is invalidated immediately on this node.',
    inputSchema: {
      type: 'object',
      properties: {
        subject_type: { type: 'string', enum: ['user', 'tenant'] },
        subject_id: { type: 'string' },
        feature_key: { type: 'string' },
      },
      required: ['subject_type', 'subject_id', 'feature_key'],
    },
  },
  {
    name: 'entitlement_admin_list_grants',
    description: 'OPERATOR ONLY. List all grants for a subject (all statuses).',
    inputSchema: {
      type: 'object',
      properties: {
        subject_type: { type: 'string', enum: ['user', 'tenant'] },
        subject_id: { type: 'string' },
      },
      required: ['subject_type', 'subject_id'],
    },
  },
  {
    name: 'entitlement_admin_register_feature',
    description:
      'OPERATOR ONLY. Register a new feature in the catalog. Idempotent on feature_key.',
    inputSchema: {
      type: 'object',
      properties: {
        feature_key: { type: 'string' },
        display_name: { type: 'string' },
        description: { type: 'string' },
        publisher: { type: 'string' },
        capability_kinds: {
          type: 'array',
          items: { type: 'string', enum: ['tool', 'provider', 'pipeline_step', 'connector', 'hook'] },
        },
      },
      required: ['feature_key', 'display_name', 'publisher', 'capability_kinds'],
    },
  },
  {
    name: 'entitlement_admin_list_catalog',
    description: 'OPERATOR ONLY. List registered features in the catalog.',
    inputSchema: {
      type: 'object',
      properties: {
        status: { type: 'string', enum: ['active', 'deprecated', 'withdrawn'] },
      },
      required: [],
    },
  },
];
```

**Wire-in to `getAllTools`** (`src/tools/index.ts`):
```typescript
// Add parameter: isOperator: boolean
export async function getAllTools(userId: string, isOperator: boolean = false): Promise<ToolDefinition[]> {
  // ... existing logic ...
  if (isOperator) {
    tools.push(...adminEntitlementTools);
  }
  return tools;
}
```

The MCP request handler in `index.ts` must pass `isOperatorUser(req.mcpUser.id)` as the second arg.

**Files**:
- `src/tools/admin-entitlement-tools.ts` (new, ~70 lines)
- `src/tools/executors/admin-entitlement-executor.ts` (new, ~60 lines)
- `src/tools/index.ts` (modified: import + `getAllTools` signature + conditional push)
- `src/tools/executor.ts` (modified: `entitlement_admin_` branch)

**Validation**:
- [ ] A non-operator user's `tools/list` response does not include `entitlement_admin_*` tools
- [ ] An operator user's `tools/list` includes all five admin tools
- [ ] `entitlement_admin_grant` with a valid payload executes without error
- [ ] `entitlement_admin_grant` called by a non-operator via the MCP tool path → error (the prefix branch must check operator status before dispatching)

---

### T024: Authorization — operator/admin role distinct from tenant users

**Purpose**: Define and enforce the operator boundary so no tenant user can invoke the grant surface, regardless of how they authenticate.

**Decision required (implementer must confirm before coding):**

**Option A — env-var allowlist (recommended for Phase 1):**
```
OPERATOR_USER_IDS=cuid_abc123,cuid_def456
```
`requireOperator` middleware reads this at startup into a `Set<string>` and checks `req.mcpUser.id` against it. Zero schema changes. Safe to ship fast. Operationally requires a redeploy to add/remove operators, which is acceptable for the small operator set in Phase 1.

**Option B — `users.isOperator` column:**
Add `isOperator: boolean('is_operator').notNull().default(false)` to `src/db/schema.ts` (the `users` table at line 54). Generate a Drizzle migration. `requireOperator` fetches the user record and checks the field. Enables self-serve operator promotion without redeploy. Adds a migration and a DB read per admin request.

**Recommendation:** Start with Option A. Add a `TODO: migrate to Option B when operator set exceeds 5` comment so the threshold for switching is explicit rather than open-ended.

**Implementation (Option A):**

```typescript
// src/entitlements/operator-auth.ts

import { Request, Response, NextFunction } from 'express';

// Loaded once at module initialization; changes require a process restart.
const OPERATOR_USER_IDS: ReadonlySet<string> = new Set(
  (process.env.OPERATOR_USER_IDS ?? '').split(',').map(s => s.trim()).filter(Boolean),
);

/**
 * Returns true if the given userId is a configured platform operator.
 * Used for both REST middleware and MCP tool filtering.
 */
export function isOperatorUser(userId: string): boolean {
  return OPERATOR_USER_IDS.has(userId);
}

/**
 * Express middleware: rejects non-operators with 403.
 * Must be applied AFTER requireBearerToken (depends on req.mcpUser).
 */
export function requireOperator(req: Request, res: Response, next: NextFunction): void {
  if (!req.mcpUser) {
    // requireBearerToken was not applied before this — programming error.
    res.status(500).json({ error: 'auth_configuration_error', message: 'Bearer auth must precede operator check' });
    return;
  }
  if (!isOperatorUser(req.mcpUser.id)) {
    res.status(403).json({ error: 'forbidden', message: 'Operator role required' });
    return;
  }
  next();
}
```

**MCP tool path enforcement** — the `entitlement_admin_` branch in `executeTool` must also call `isOperatorUser(userId)` and throw if false, because `executeTool` takes a plain `userId` string, not `req.mcpUser`. This is the second enforcement point and is non-optional: MCP tool execution goes through `executeTool` directly, not through the REST middleware chain.

```typescript
// In src/tools/executor.ts — add before the entitlement_admin_ handler:
if (toolName.startsWith('entitlement_admin_')) {
  if (!isOperatorUser(userId)) {
    throw new Error('Operator role required for entitlement administration');
  }
  return executeAdminEntitlementTool(toolName, input, { userId, db });
}
```

**Security invariant:** A tenant user's bearer token authenticates them as a regular user. The `isOperatorUser` check is a separate, explicit gate. These two checks must NEVER be collapsed into one (e.g., "if admin OR has right token") — they are orthogonal.

**Files**:
- `src/entitlements/operator-auth.ts` (new, ~35 lines)
- `src/tools/executor.ts` (modified: add `entitlement_admin_` branch with operator check)
- `.env.example` (modified: document `OPERATOR_USER_IDS=`)

**Validation**:
- [ ] `OPERATOR_USER_IDS` unset → `OPERATOR_USER_IDS` is empty set → all requests return 403
- [ ] `OPERATOR_USER_IDS=known_id` → requests from `known_id` pass; all others return 403
- [ ] A tenant user calling `entitlement_admin_grant` via MCP tool path → throws, not executes
- [ ] `isOperatorUser` is pure and testable without Express context

**Edge Cases**:
- If `OPERATOR_USER_IDS` is an empty string (misconfiguration), no one is an operator. This is the safe default — fail closed on the grant surface.
- Do not log the contents of `OPERATOR_USER_IDS` at startup; log only the count: `Operator user set initialized: N users`.

---

### T025: Cache invalidation on grant/revoke

**Purpose**: Ensure that a revocation takes effect on the local node without waiting for TTL expiry. Hooks into WP02's subject-scoped `EntitlementCache`.

**Steps**:
1. Confirm WP02 exposes `featureGate.invalidateSubject(subject: Subject): void` (or `entitlementCache.invalidate(subject)`). If the interface is not yet settled, define it here and coordinate with WP02.
2. `GrantsService` already calls this in T020 — this task is the integration verification and the documentation of the cross-node TTL bound.
3. Add a comment in `GrantsService` that explicitly names the TTL bound:

```typescript
// Cache invalidation on this node is immediate.
// Cross-node propagation is TTL-bounded (FR-018 Phase 1 baseline: default 1h).
// A revoked grant may remain active on other instances for up to one TTL window.
// Operators who need sub-TTL cross-node revocation must restart all instances
// or reduce DEFAULT_FEATURE_ENTITLEMENT_TTL_SECONDS in config.
this.featureGate.invalidateSubject(input.subject);
```

4. Add `DEFAULT_FEATURE_ENTITLEMENT_TTL_SECONDS` to `src/entitlements/types.ts` (or a config file) with a default of `3600` (1 hour). Make it overridable via `process.env.FEATURE_ENTITLEMENT_TTL_SECONDS` so operators who need faster revocation can reduce TTL without a code change.

**Files**:
- `src/entitlements/grants.service.ts` (modified: add comment block)
- `src/entitlements/types.ts` (modified: add TTL constant)
- No new files required if WP02 exposes the invalidation method

**Validation**:
- [ ] After `revoke()`, calling `featureGate.isEntitled(subject, featureKey)` on the same node returns `false` without waiting for TTL
- [ ] If WP02's `invalidateSubject` is stubbed (WP02 not yet landed), the stub call does not throw and a log warning is emitted

---

### T026: Unit tests — authz, idempotency, audited writes, invalidation on change

**Purpose**: Prove the correctness of the four most important WP04 invariants. These tests are the first line of defense before WP06 integration tests run.

**Test file**: `src/entitlements/__tests__/grants.service.test.ts` (and `operator-auth.test.ts`)

**Required test cases**:

**1. Authorization: tenant user is denied on both surfaces**
```typescript
// REST surface
it('returns 403 when non-operator bearer token calls POST /grants', async () => {
  // Arrange: regular user token, not in OPERATOR_USER_IDS
  // Act: POST /api/v1/admin/entitlements/grants
  // Assert: 403 { error: 'forbidden' }
});

// MCP tool surface
it('throws when non-operator userId calls entitlement_admin_grant via executeTool', async () => {
  // Arrange: userId not in OPERATOR_USER_IDS
  // Act: executeTool(nonOperatorUserId, 'entitlement_admin_grant', validInput)
  // Assert: throws / rejects with 'Operator role required'
});
```

**2. Idempotency**
```typescript
it('grant() called twice produces one row, not two', async () => {
  await grantsService.grant(input);
  await grantsService.grant(input);
  const rows = await db.select().from(featureEntitlements).where(/* subject+feature */);
  expect(rows).toHaveLength(1);
  expect(rows[0].status).toBe('active');
});

it('grant() on a revoked row reactivates it without inserting a new row', async () => {
  await grantsService.grant(input);
  await grantsService.revoke(subject, featureKey);
  await grantsService.grant(input);
  const rows = await db.select().from(featureEntitlements).where(/* subject+feature */);
  expect(rows).toHaveLength(1);
  expect(rows[0].status).toBe('active');
});

it('revoke() called twice is a no-op on second call', async () => {
  await grantsService.grant(input);
  const first = await grantsService.revoke(subject, featureKey);
  const second = await grantsService.revoke(subject, featureKey);
  expect(first?.status).toBe('revoked');
  expect(second?.status).toBe('revoked');
});
```

**3. Audited writes carry actor identity**
```typescript
it('every grant() writes one audit row with the actor id in capability field', async () => {
  const actorId = 'operator-cuid-123';
  const service = new GrantsService(db, mockGate, actorId);
  await service.grant(input);
  const auditRows = await db.select().from(entitlementDecisions)
    .where(/* subject+feature */);
  expect(auditRows).toHaveLength(1);
  expect(auditRows[0].capability).toContain(actorId);  // adjust if actor_id column added
});

it('revoke() writes one audit row with decision=deny', async () => {
  const service = new GrantsService(db, mockGate, 'operator-id');
  await service.grant(input);
  await service.revoke(subject, featureKey);
  const auditRows = await db.select().from(entitlementDecisions)
    .where(/* subject+feature */);
  expect(auditRows).toHaveLength(2);
  expect(auditRows[1].decision).toBe('deny');
});
```

**4. Cache invalidation is called on every mutation**
```typescript
it('invalidateSubject is called on grant', async () => {
  const mockGate = { invalidateSubject: jest.fn() };
  const service = new GrantsService(db, mockGate as any, 'operator-id');
  await service.grant(input);
  expect(mockGate.invalidateSubject).toHaveBeenCalledWith(input.subject);
});

it('invalidateSubject is called on revoke', async () => {
  const mockGate = { invalidateSubject: jest.fn() };
  const service = new GrantsService(db, mockGate as any, 'operator-id');
  await service.grant(input);
  await service.revoke(input.subject, input.featureKey);
  expect(mockGate.invalidateSubject).toHaveBeenCalledTimes(2);
});
```

**5. `isOperatorUser` correctly reads the env-var set**
```typescript
it('returns false when OPERATOR_USER_IDS is unset', () => {
  // Module must be re-required with env cleared, or use dependency injection
  expect(isOperatorUser('any-id')).toBe(false);
});
it('returns true only for IDs in OPERATOR_USER_IDS', () => {
  process.env.OPERATOR_USER_IDS = 'op1,op2';
  // re-initialize module or use injected set
  expect(isOperatorUser('op1')).toBe(true);
  expect(isOperatorUser('op3')).toBe(false);
});
```

Note: because `OPERATOR_USER_IDS` is read at module initialization, testing requires either module re-initialization, dependency injection of the set, or extracting `buildOperatorSet(envVal)` as a pure function and testing that instead. **Recommend the pure function approach.**

**Files**:
- `src/entitlements/__tests__/grants.service.test.ts` (new, ~120 lines)
- `src/entitlements/__tests__/operator-auth.test.ts` (new, ~30 lines)

**Validation**:
- [ ] All test cases pass
- [ ] `npm test` exits 0 with no regressions in existing content/search tests (WP01's T007 gate still holds)

---

## Definition of Done

- [ ] `src/entitlements/grants.service.ts` — `GrantsService` with `grant`, `modify`, `revoke`, `listForSubject`; idempotent; audit on every write; cache invalidation on every mutation
- [ ] `src/entitlements/catalog.service.ts` — `CatalogService` with `create` (idempotent on PK), `list`
- [ ] `src/entitlements/operator-auth.ts` — `requireOperator` middleware + `isOperatorUser` function; env-var allowlist (or schema column if Option B chosen — decision documented)
- [ ] `src/entitlements/admin-routes.ts` — six REST endpoints; Zod validation; 401/403/422 error handling
- [ ] `src/tools/admin-entitlement-tools.ts` — five `ToolDefinition` entries
- [ ] `src/tools/executors/admin-entitlement-executor.ts` — dispatches admin tool calls to `GrantsService`/`CatalogService`
- [ ] `src/tools/index.ts` — `getAllTools` omits admin tools for non-operators
- [ ] `src/tools/executor.ts` — `entitlement_admin_` prefix branch with operator check
- [ ] `src/index.ts` — admin router mounted at `/api/v1/admin/entitlements`
- [ ] `.env.example` — `OPERATOR_USER_IDS` documented
- [ ] Unit tests covering: authz denied (both surfaces), idempotency, audited writes with actor, invalidation on mutation
- [ ] `npm run validate` (typecheck + lint + test) exits 0 with no regressions

---

## Risks

**1. Authorization boundary is the top risk.**
The `users` table has no role field. This WP must create the boundary from scratch. If `requireOperator` is accidentally omitted from even one route, a tenant user can self-grant. Mitigate: the middleware chain is explicit (`router.use(requireBearerToken, requireOperator)`) and applies to the entire router, not individual handlers. The unit test must confirm a non-operator token returns 403.

**2. `GrantsService` is stateful per actor — not a singleton.**
If instantiated as a singleton and the `actorId` is stored on the instance, concurrent requests will share and corrupt actor identity in the audit trail. Instantiate per request or pass `actorId` as a method argument.

**3. Actor identity in audit trail has no dedicated column today.**
`entitlement_decisions` (WP01) does not have an `actor_id` column. The workaround (embedding in `capability`) is auditable but not queryable by actor. If FR-015 compliance requires querying "all grants made by operator X," the column must be added in WP01. Coordinate before merging.

**4. `featureGate.invalidateSubject` interface must be stable before this WP merges.**
WP04 depends on WP02 exposing a specific method signature. If WP02 has not landed, use a stub interface and document the dependency explicitly in the PR.

**5. Cache invalidation is local-node only.**
Documented in T025. In a multi-instance deployment, a revoked grant can remain live on other nodes for up to the TTL window (default 1h). This is the stated Phase 1 baseline (FR-018). The operational knob (`FEATURE_ENTITLEMENT_TTL_SECONDS`) is the mitigation. Document this in the operator guide.

**6. FK violation on unknown `feature_key`.**
`feature_entitlements.feature_key` FK references `feature_catalog`. Inserting a grant for an unregistered feature will fail with a DB-level FK violation. Routes must catch this and return 422 "unknown_feature_key" — not 500.

---

## Reviewer Guidance

- **Check the operator boundary first.** The crux of this WP is that a tenant user cannot grant themselves. Verify `requireOperator` is applied at the router level (not per-handler), and that `executeTool`'s `entitlement_admin_` branch has its own `isOperatorUser` check — because MCP tool calls do not go through the REST middleware chain.
- **Verify idempotency at the DB layer.** `GrantsService.grant()` must never produce two rows for the same `(subject_type, subject_id, feature_key)`. The `UNIQUE` constraint enforces this at the DB level, but the application logic (upsert-not-insert) must handle the case cleanly rather than surfacing a constraint violation to the caller.
- **Audit trail is append-only.** `entitlement_decisions` is an append-only log. Verify no UPDATE or DELETE statements are issued against it anywhere in this WP.
- **`getAllTools` operator branching.** Confirm admin tools are filtered out for non-operators in the `tools/list` response — not just guarded in `executeTool`. A non-operator discovering admin tools through `tools/list` and hitting 403 on execution is a poor UX and leaks surface area.
- **Confirm the actor identity decision** (column vs. embedded-in-capability) is resolved before merge and documented in the PR.
- **`.env.example` must be updated.** `OPERATOR_USER_IDS` must be listed with an explanatory comment. Missing env docs are how production operators misconfigure deployments.
