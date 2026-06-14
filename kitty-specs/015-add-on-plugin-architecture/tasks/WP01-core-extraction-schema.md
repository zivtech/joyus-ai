---
work_package_id: "WP01"
title: "Core Extraction & Entitlements Schema"
lane: "planned"
dependencies: []
subtasks: ["T001", "T002", "T003", "T004", "T005", "T006", "T007"]
history:
  - date: "2026-06-14"
    action: "created"
    agent: "claude-opus"
---

# WP01: Core Extraction & Entitlements Schema

**Implementation command**: `spec-kitty implement WP01`
**Target repo**: `joyus-ai` (path: `joyus-ai-mcp-server/`)
**Dependencies**: None
**Priority**: P0 (Foundation — every other WP in Spec 015 depends on this)

## Objective

Extract the generic entitlement resolution machinery (`EntitlementResolver`, `HttpEntitlementResolver`, `EntitlementCache`) from `src/content/entitlements/` into a shared `src/entitlements/core/` location so both the existing content module and the new feature-entitlement system can consume it without duplication. Simultaneously introduce the `entitlements` PostgreSQL schema (`feature_catalog`, `feature_entitlements`, `entitlement_decisions`) along with the shared TypeScript types and Zod validation the rest of Phase 1 builds on. The extraction is a **mechanical refactor only** — re-exports in `src/content/entitlements/` must keep all existing import paths valid, and T007 is a hard gate: existing content entitlement tests must stay green before anything else in Spec 015 proceeds.

## Context

### Patterns to follow

The codebase uses a consistent Drizzle + PostgreSQL schema convention established in `src/content/schema.ts` and `src/profiles/schema.ts`. Follow it exactly:

- **Schema namespace**: `pgSchema('entitlements')` — analogous to `pgSchema('content')` (`src/content/schema.ts:32`) and `pgSchema('profiles')` (`src/profiles/schema.ts`).
- **Primary keys**: `text('id').primaryKey().$defaultFn(() => createId())` from `@paralleldrive/cuid2` — NOT uuid. See `contentProducts` (`src/content/schema.ts:134`) and every other table in the repo.
- **Tenant IDs**: `text('tenant_id').notNull()` — plain text, no FK to a tenants table (none exists yet; WP12 is a future dependency). `subject_id` follows the same pattern for the same reason.
- **Type exports**: `export type FeatureCatalogEntry = typeof featureCatalog.$inferSelect` and `export type NewFeatureCatalogEntry = typeof featureCatalog.$inferInsert` — NOT `InferSelectModel`. See `src/content/schema.ts:374-408`.
- **Index names**: prefixed with the table name, e.g. `entitlements_feature_entitlements_subject_idx`. Follow the `content_products_tenant_id_idx` naming pattern.
- **drizzle.config.ts**: the `schema` array currently has 6 entries (`src/content/schema.ts:4-11`); add `'./src/entitlements/schema.ts'` as a seventh.
- **Migration naming**: migrations use sequential 4-digit prefixes (`0000_`, `0001_`, ..., `0007_` is the current highest). The next migration is `0008_entitlements_schema.sql`. `CREATE SCHEMA IF NOT EXISTS "entitlements"` must appear at the top — the `content`/`pipelines` migration (`0001_fine_young_avengers.sql:1,3`) uses `IF NOT EXISTS`; use that form (some later migrations omit it — prefer the safe form).

### The extraction target

Three items currently live in `src/content/entitlements/` and are only loosely coupled to content:

1. **`interface.ts`** — exports `EntitlementResolver` (interface, lines 47–53), `ResolverContext`, `EntitlementResolverConfig`. The `resolve()` signature takes `(userId: string, tenantId: string, context: ResolverContext): Promise<ResolvedEntitlements>` — note it is typed against `ResolvedEntitlements` from `../types.js`, which is a content-specific type. The new `src/entitlements/core/interface.ts` must either keep this import or introduce a generic resolver result type; see T001 for the decision.
2. **`cache.ts`** — exports `EntitlementCache`, a keyed in-process TTL `Map`. The key is currently `sessionId: string` (content-specific). For feature entitlements, the key will be `subject_type:subject_id`. The class is generic enough to move as-is; the new consumer uses a different key string.
3. **`http-resolver.ts`** — exports `HttpEntitlementResolver` and `HttpResolverConfig`. The `responseMapping` currently has `productsField` and optional `ttlField`. T002 adds `featuresField` to this config so the same class can drive feature-key resolution from an external billing endpoint.

### Load-bearing constraint

The extraction must leave the content path **behaviorally identical**. `src/content/entitlements/index.ts` currently re-exports `EntitlementCache`, `HttpEntitlementResolver`, `HttpResolverConfig`, `EntitlementResolver`, and `ResolverContext` (lines 224–228). After the move, those re-exports must point to the new `core/` location, and every file that currently imports from `src/content/entitlements/` must continue to compile and behave without change. **T007 is a hard gate**: do not proceed to WP02 until the existing content entitlement test suite is green.

---

## Subtasks

### T001: Extract `EntitlementResolver` interface + `HttpEntitlementResolver` + `EntitlementCache` to `src/entitlements/core/`

**Purpose**: Move the three generic resolution primitives to a location neither module owns, then add re-exports in `src/content/entitlements/` so existing import paths continue to resolve.

**Steps**:

1. Create directory `src/entitlements/core/`.
2. Create `src/entitlements/core/interface.ts`. Copy `EntitlementResolverConfig`, `ResolverContext`, and `EntitlementResolver` from the existing `src/content/entitlements/interface.ts`. The `resolve()` return type is currently `Promise<ResolvedEntitlements>` — that couples the shared interface to the content-specific `ResolvedEntitlements` shape. For Phase 1, keep this coupling (the feature resolver will return a compatible shape with `featureKeys` mapped into `productIds` to reuse the cache); add a `// TODO(spec-015-WP02): generalize resolver result type` comment so WP02 knows to revisit. Remove the `// Re-export for convenience` block at line 11 — that lived here because the content module owned it; the new location is the source.
3. Create `src/entitlements/core/cache.ts`. Copy `EntitlementCache` verbatim from `src/content/entitlements/cache.ts`. No changes to logic — the cache is key-agnostic (it stores against any string key). Add a JSDoc comment: `* Key is caller-defined: sessionId for content, 'subject_type:subject_id' for feature entitlements.`
4. Create `src/entitlements/core/http-resolver.ts`. Copy `HttpEntitlementResolver` and `HttpResolverConfig` from `src/content/entitlements/http-resolver.ts`. Do **not** add `featuresField` here — that is T002.
5. Create `src/entitlements/core/index.ts` barrel:

```typescript
// src/entitlements/core/index.ts
export type { EntitlementResolver, EntitlementResolverConfig, ResolverContext } from './interface.js';
export { EntitlementCache } from './cache.js';
export { HttpEntitlementResolver } from './http-resolver.js';
export type { HttpResolverConfig } from './http-resolver.js';
```

6. Update `src/content/entitlements/interface.ts` to re-export from core instead of defining:

```typescript
// src/content/entitlements/interface.ts
// Re-exported from shared core; content module re-exports for backward compatibility.
export type { EntitlementResolver, EntitlementResolverConfig, ResolverContext } from '../../entitlements/core/interface.js';
```

7. Update `src/content/entitlements/cache.ts` to re-export:

```typescript
// src/content/entitlements/cache.ts
export { EntitlementCache } from '../../entitlements/core/cache.js';
```

8. Update `src/content/entitlements/http-resolver.ts` to re-export:

```typescript
// src/content/entitlements/http-resolver.ts
export { HttpEntitlementResolver } from '../../entitlements/core/http-resolver.js';
export type { HttpResolverConfig } from '../../entitlements/core/http-resolver.js';
```

9. `src/content/entitlements/index.ts` already re-exports these (lines 224–228). Verify those re-exports still resolve through the shim files. No change needed if the shims export correctly.

**Files**:
- `src/entitlements/core/interface.ts` (new)
- `src/entitlements/core/cache.ts` (new)
- `src/entitlements/core/http-resolver.ts` (new)
- `src/entitlements/core/index.ts` (new)
- `src/content/entitlements/interface.ts` (modified — replaced with re-export shim)
- `src/content/entitlements/cache.ts` (modified — replaced with re-export shim)
- `src/content/entitlements/http-resolver.ts` (modified — replaced with re-export shim)

**Validation checklist**:
- [ ] `tsc --noEmit` passes with zero errors after the move
- [ ] `src/content/entitlements/index.ts` exports are unchanged at the public surface
- [ ] `import { EntitlementCache } from '../../content/entitlements/index.js'` still resolves in `EntitlementService`
- [ ] No circular imports: `core/` must not import from `content/`

**Edge cases**:
- `interface.ts` currently has `export type { ResolvedEntitlements }` as a re-export (line 11). After moving, `ResolvedEntitlements` stays in `src/content/types.ts`. The shim in `src/content/entitlements/interface.ts` does not need to re-export it — callers that need it import from `../types.js` directly. Remove that line from the core version.
- `http-resolver.ts` imports `ResolvedEntitlements` from `'../types.js'` (content-relative). In `src/entitlements/core/http-resolver.ts`, adjust the import path to `'../../content/types.js'`. This is a temporary coupling acknowledged by the TODO comment in T001.

---

### T002: Add `responseMapping.featuresField` to `HttpEntitlementResolver`

**Purpose**: Extend `HttpResolverConfig.responseMapping` so the same HTTP resolver class can drive feature-key resolution from an external billing API endpoint (FR-003), reading a `featuresField` array alongside the existing `productsField` array.

**Steps**:

1. In `src/entitlements/core/http-resolver.ts`, extend the `responseMapping` config:

```typescript
responseMapping: {
  /** Top-level field in the JSON response containing the products array (content use) */
  productsField: string;
  /** Top-level field in the JSON response containing feature keys array (feature-entitlement use) */
  featuresField?: string;
  /** Optional top-level field for TTL value (seconds) */
  ttlField?: string;
};
```

2. In the `resolve()` method, after extracting `productIds`, optionally extract `featureKeys`:

```typescript
const featureKeys: string[] = [];
if (this.config.responseMapping.featuresField) {
  const rawFeatures = response[this.config.responseMapping.featuresField];
  if (Array.isArray(rawFeatures)) {
    featureKeys.push(...rawFeatures.filter((f): f is string => typeof f === 'string'));
  }
}
```

3. Surface `featureKeys` on the returned `ResolvedEntitlements`. `ResolvedEntitlements` currently has `productIds`, `sourceIds`, `profileIds`, `resolvedFrom`, `resolvedAt`, `ttlSeconds` (`src/content/types.ts:76-84`). Add an optional `featureKeys?: string[]` field to `ResolvedEntitlements` in `src/content/types.ts`:

```typescript
export interface ResolvedEntitlements {
  productIds: string[];
  sourceIds: string[];
  profileIds: string[];
  /** Feature/add-on keys resolved for this subject. Populated by FeatureEntitlementResolver. */
  featureKeys?: string[];
  resolvedFrom: string;
  resolvedAt: Date;
  ttlSeconds?: number;
}
```

4. In `HttpEntitlementResolver.resolve()`, set `featureKeys` in the returned object:

```typescript
return {
  productIds,
  featureKeys,        // populated from featuresField; empty array when featuresField not configured
  sourceIds: [],
  profileIds: [],
  resolvedFrom: this.config.name,
  resolvedAt: new Date(),
  ttlSeconds,
};
```

**Files**:
- `src/entitlements/core/http-resolver.ts` (modified — add `featuresField`, extract feature keys)
- `src/content/types.ts` (modified — add optional `featureKeys?: string[]` to `ResolvedEntitlements`)

**Validation checklist**:
- [ ] Existing callers of `HttpResolverConfig` compile without changes (field is optional)
- [ ] `ResolvedEntitlements` with no `featureKeys` is still valid (optional field, backward compatible)
- [ ] `featuresField` absent → `featureKeys` is `[]` in the returned object, not undefined
- [ ] `tsc --noEmit` passes

**Edge cases**:
- `productsField` must remain required (content path depends on it). If a caller configures only `featuresField`, they must still provide `productsField` — or accept an empty `productIds` array (which is fine for the feature-entitlement path). Do not make `productsField` optional; document this in a JSDoc comment.

---

### T003: Create `entitlements` Drizzle schema — `feature_catalog`, `feature_entitlements`, `entitlement_decisions`

**Purpose**: Define the three new Phase 1 tables in their own `entitlements` PostgreSQL schema, following content schema conventions exactly (createId, pgSchema, text tenant/subject IDs, $inferSelect/$inferInsert).

**Steps**:

1. Create `src/entitlements/schema.ts`.
2. Declare the schema namespace: `export const entitlementsSchema = pgSchema('entitlements');`
3. Define the three tables as shown below (columns, types, indexes, and constraints taken directly from `data-model.md §2`).

```typescript
// src/entitlements/schema.ts
import { createId } from '@paralleldrive/cuid2';
import {
  pgSchema,
  text,
  timestamp,
  jsonb,
  index,
  uniqueIndex,
} from 'drizzle-orm/pg-core';

// ============================================================
// SCHEMA NAMESPACE
// ============================================================

export const entitlementsSchema = pgSchema('entitlements');

// ============================================================
// TABLES
// ============================================================

// --- FeatureCatalog ---
// Authoritative list of licensable feature/add-on keys.
// feature_key is the PK and is never reused (withdrawn rows retained — PK collision prevents reuse).

export const featureCatalog = entitlementsSchema.table('feature_catalog', {
  featureKey: text('feature_key').primaryKey(),
  displayName: text('display_name').notNull(),
  description: text('description'),
  publisher: text('publisher').notNull(),   // 'joyus' for first-party; publisher id for Phase 2 third-party
  capabilityKinds: jsonb('capability_kinds').notNull(),  // string[] e.g. ["tool","provider"]
  status: text('status').notNull(),         // 'active' | 'deprecated' | 'withdrawn'
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
});

// --- FeatureEntitlements ---
// Durable, subject-scoped grants. One live row per (subject_type, subject_id, feature_key).
// Lifecycle changes update status in place; history goes to entitlement_decisions.
// subject_id is a naked string (no FK) — no tenants table exists yet (WP12 dependency).

export const featureEntitlements = entitlementsSchema.table('feature_entitlements', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
  subjectType: text('subject_type').notNull(),   // 'tenant' | 'user'
  subjectId: text('subject_id').notNull(),        // tenantId or userId per subjectType
  featureKey: text('feature_key').notNull().references(() => featureCatalog.featureKey, { onDelete: 'restrict' }),
  status: text('status').notNull(),               // 'active' | 'suspended' | 'expired' | 'revoked'
  validFrom: timestamp('valid_from').notNull(),
  validUntil: timestamp('valid_until'),           // NULL = perpetual until explicitly revoked
  source: text('source').notNull(),               // 'admin' | 'resolver' | 'trial' | 'import'
  limits: jsonb('limits'),                        // optional quota envelope e.g. {"maxRunsPerMonth":1000}
  metadata: jsonb('metadata'),                    // free-form: billing reference, plan id, etc.
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
}, (table) => ({
  // One live grant per subject+feature. Status transitions update in place.
  subjectFeatureUnique: uniqueIndex('entitlements_fe_subject_feature_unique')
    .on(table.subjectType, table.subjectId, table.featureKey),
  // Hot path: resolve(subject) — list all grants for a subject filtered by status
  subjectStatusIdx: index('entitlements_fe_subject_status_idx')
    .on(table.subjectType, table.subjectId, table.status),
  // Catalog-side: who holds add-on Y
  featureKeyIdx: index('entitlements_fe_feature_key_idx')
    .on(table.featureKey),
  // Partial index for fast active-set resolution (hot path for the gate)
  // NOTE: Drizzle does not support partial indexes via the table builder — add this
  // manually to the generated migration SQL:
  //   CREATE INDEX entitlements_fe_active_subject_idx
  //     ON entitlements.feature_entitlements (subject_type, subject_id)
  //     WHERE status = 'active';
}));

// --- EntitlementDecisions ---
// Append-only audit of every gate allow/deny decision.
// Modeled after orchestrator_events (src/db/schema/events.ts): no UPDATE/DELETE.
// Indexes support the two query axes: per-subject audit trail, per-feature analytics.

export const entitlementDecisions = entitlementsSchema.table('entitlement_decisions', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
  subjectType: text('subject_type').notNull(),
  subjectId: text('subject_id').notNull(),
  featureKey: text('feature_key').notNull(),
  decision: text('decision').notNull(),           // 'allow' | 'deny'
  reason: text('reason').notNull(),               // 'entitled' | 'not_entitled' | 'expired' |
                                                  // 'suspended' | 'limit_exceeded' |
                                                  // 'resolver_unavailable_fallback_deny'
  resolvedFrom: text('resolved_from').notNull(),  // 'cache' | 'resolver' | 'db' | 'default_deny'
  capability: text('capability'),                 // e.g. 'tool:advanced_pipeline_run'
  sessionId: text('session_id'),                  // when available
  createdAt: timestamp('created_at').defaultNow().notNull(),
}, (table) => ({
  // Per-subject audit trail (primary consumer: compliance, debugging)
  subjectCreatedIdx: index('entitlements_decisions_subject_created_idx')
    .on(table.subjectType, table.subjectId, table.createdAt),
  // Per-feature analytics (conversion: how many denies per feature key)
  featureCreatedIdx: index('entitlements_decisions_feature_created_idx')
    .on(table.featureKey, table.createdAt),
}));

// ============================================================
// TYPE EXPORTS
// ============================================================

export type FeatureCatalogEntry    = typeof featureCatalog.$inferSelect;
export type NewFeatureCatalogEntry = typeof featureCatalog.$inferInsert;

export type FeatureEntitlement    = typeof featureEntitlements.$inferSelect;
export type NewFeatureEntitlement = typeof featureEntitlements.$inferInsert;

export type EntitlementDecision    = typeof entitlementDecisions.$inferSelect;
export type NewEntitlementDecision = typeof entitlementDecisions.$inferInsert;
```

**Files**:
- `src/entitlements/schema.ts` (new, ~110 lines)

**Validation checklist**:
- [ ] `tsc --noEmit` passes with zero errors on `schema.ts`
- [ ] All three tables are defined under `entitlementsSchema` (not top-level `pgTable`)
- [ ] `featureCatalog.featureKey` is the PK (text, not cuid — it is a stable human-readable key)
- [ ] `featureEntitlements.id` uses `createId()` from `@paralleldrive/cuid2`
- [ ] `featureEntitlements.featureKey` references `featureCatalog.featureKey` with `onDelete: 'restrict'`
- [ ] `uniqueIndex` covers `(subjectType, subjectId, featureKey)` on `featureEntitlements`
- [ ] `entitlementDecisions` has NO FK to `featureEntitlements` — it is append-only audit, must survive grant deletion
- [ ] Type exports use `$inferSelect` / `$inferInsert`

**Edge cases**:
- Drizzle's table builder does not support partial indexes via `index()` with a WHERE clause. The partial index `WHERE status = 'active'` must be added manually to the generated migration SQL after `drizzle-kit generate` (T006). Document this in a comment in the schema file.
- `featureCatalog.featureKey` is the primary key — no `id` column. This differs from every other table in the codebase. This is correct and intentional: the key is the stable external identity (reverse-DNS, e.g. `com.joyus.addon.advanced-pipelines`), and using it as PK enforces the "never reused" constraint via DB mechanics.
- `entitlementDecisions` intentionally has no FK to `feature_catalog.feature_key` — a decision row must be queryable even after a feature key is deprecated/withdrawn.

---

### T004: Create `src/entitlements/types.ts` — `Subject`, `FeatureKey`, `EffectiveEntitlement`, opaque `GateToken`, `GrantSource`, `GrantStatus`

**Purpose**: Define the TypeScript types used across the feature-entitlement system. These are the domain types for WP02 (FeatureGate) and WP03 (un-forgeable enforcement) to build on.

**Steps**:

1. Create `src/entitlements/types.ts`.
2. Define these key shapes (describe, do not fully copy — the implementer writes the exact code):

**`Subject`**: A discriminated union representing what a grant attaches to. Must be explicit — the gate never infers the subject from ambient `tenantId == userId`.
```typescript
export type SubjectType = 'tenant' | 'user';
export interface Subject {
  subjectType: SubjectType;
  subjectId: string;
}
```

**`FeatureKey`**: A branded string to prevent passing arbitrary strings where a feature key is expected.
```typescript
declare const _featureKeyBrand: unique symbol;
export type FeatureKey = string & { readonly [_featureKeyBrand]: void };
export function toFeatureKey(raw: string): FeatureKey { return raw as FeatureKey; }
```

**`GrantSource`** and **`GrantStatus`**: String literal unions mirroring the DB columns in `feature_entitlements`:
```typescript
export type GrantSource = 'admin' | 'resolver' | 'trial' | 'import';
export type GrantStatus = 'active' | 'suspended' | 'expired' | 'revoked';
```

**`EffectiveEntitlement`**: The resolved capability set for a user — the union over `{user:U} ∪ {tenant:T | U ∈ members(T)}`. This is what the gate checks (FR-019).
```typescript
export interface EffectiveEntitlement {
  featureKeys: Set<FeatureKey>;
  resolvedAt: Date;
  /** Earliest valid_until across all contributing grants; null if any grant is perpetual. */
  nextExpiry: Date | null;
  /** Which subjects contributed (user grant vs inherited tenant grant) — for audit logging */
  resolvedSubjects: Subject[];
}
```

**`GateToken`**: An opaque, non-constructible proof-of-authorization minted only by `FeatureGate.assertEntitled`. WP03 makes gated entrypoints require this token, making it impossible to reach them without going through the gate. Define the brand here; `FeatureGate` (WP02) mints it.
```typescript
declare const _gateTokenBrand: unique symbol;
export type GateToken = { readonly [_gateTokenBrand]: void };
```

**Decision audit types** (consumed by WP02's audit writer):
```typescript
export type DecisionOutcome = 'allow' | 'deny';
export type DenyReason =
  | 'not_entitled'
  | 'expired'
  | 'suspended'
  | 'limit_exceeded'
  | 'resolver_unavailable_fallback_deny';
export type ResolvedFrom = 'cache' | 'resolver' | 'db' | 'default_deny';
```

**Constants**:
```typescript
export const DEFAULT_FEATURE_CACHE_TTL_SECONDS = 3600;   // 1 hour; matches content cache default
export const FEATURE_KEY_SEPARATOR = ':';                 // used in effective-entitlement cache key: 'user:userId'
```

**Files**:
- `src/entitlements/types.ts` (new, ~60 lines)

**Validation checklist**:
- [ ] `GateToken` is non-constructible outside the module that mints it (brand approach, not class)
- [ ] `FeatureKey` is a branded string — prevents `string` from being passed as `FeatureKey` without explicit conversion
- [ ] `EffectiveEntitlement.featureKeys` is `Set<FeatureKey>` (not `string[]`) for O(1) lookup at the gate
- [ ] No imports from `./schema.ts` — `types.ts` must be importable without pulling in Drizzle

**Edge cases**:
- `GateToken` uses a unique symbol brand (not a class or runtime value). This means a `GateToken` is `{}` at runtime — it carries no data. The only thing it proves is that `assertEntitled` was called (because only that function returns one). WP03 will enforce that gated entrypoints require it as a parameter.
- `EffectiveEntitlement.nextExpiry` being `null` means at least one contributing grant is perpetual (`valid_until IS NULL`); the gate should not cache past a non-null expiry.

---

### T005: Create Zod validation (`src/entitlements/validation.ts`) — grant create/modify/revoke, catalog entry

**Purpose**: Define runtime input validation schemas for all write operations on the entitlements system, used by the operator grant REST routes and admin MCP tools (WP04).

**Steps**:

1. Create `src/entitlements/validation.ts`.
2. Define these Zod schemas (describe key shapes; implementer writes exact code):

**`createGrantSchema`** — validates inputs to create a `feature_entitlements` row:
- `subjectType`: `z.enum(['tenant', 'user'])`
- `subjectId`: `z.string().min(1)`
- `featureKey`: `z.string().min(1).regex(/^[a-z0-9]+(\.[a-z0-9-]+)+$/, 'must be reverse-DNS style')`
- `validFrom`: `z.string().datetime()` — ISO 8601; defaults to now if omitted
- `validUntil`: `z.string().datetime().optional()` — nullable = perpetual
- `source`: `z.enum(['admin', 'resolver', 'trial', 'import'])`
- `limits`: `z.record(z.unknown()).optional()`
- `metadata`: `z.record(z.unknown()).optional()`

**`modifyGrantSchema`** — partial updates to an existing grant (patch semantics):
- `status`: `z.enum(['active', 'suspended', 'expired', 'revoked']).optional()`
- `validUntil`: `z.string().datetime().nullable().optional()`
- `limits`: `z.record(z.unknown()).optional()`
- `metadata`: `z.record(z.unknown()).optional()`

**`revokeGrantSchema`** — identifies a grant to revoke (by subject + feature key):
- `subjectType`: `z.enum(['tenant', 'user'])`
- `subjectId`: `z.string().min(1)`
- `featureKey`: `z.string().min(1)`

**`createCatalogEntrySchema`** — validates inputs to create a `feature_catalog` row:
- `featureKey`: reverse-DNS regex (same as above)
- `displayName`: `z.string().min(1).max(200)`
- `description`: `z.string().max(1000).optional()`
- `publisher`: `z.string().min(1)`
- `capabilityKinds`: `z.array(z.enum(['tool', 'provider', 'pipeline_step', 'connector', 'hook'])).min(1)`
- `status`: `z.enum(['active', 'deprecated', 'withdrawn']).default('active')`

Export inferred TypeScript types from each schema:
```typescript
export type CreateGrantInput   = z.infer<typeof createGrantSchema>;
export type ModifyGrantInput   = z.infer<typeof modifyGrantSchema>;
export type RevokeGrantInput   = z.infer<typeof revokeGrantSchema>;
export type CreateCatalogInput = z.infer<typeof createCatalogEntrySchema>;
```

**Files**:
- `src/entitlements/validation.ts` (new, ~70 lines)

**Validation checklist**:
- [ ] `featureKey` regex rejects `'advanced-pipelines'` (no dots) and accepts `'com.joyus.addon.advanced-pipelines'`
- [ ] `createGrantSchema.parse({...})` throws `ZodError` if `featureKey` is missing
- [ ] `modifyGrantSchema` is partial — all fields optional; parsing `{}` succeeds
- [ ] `capabilityKinds` enum values match the `spec.md` FR-011 list exactly
- [ ] No circular imports from `types.ts` (import `GrantSource`, `GrantStatus` literal types if desired, or re-define them inline)

---

### T006: Register schema in `drizzle.config.ts`; generate migration

**Purpose**: Wire `src/entitlements/schema.ts` into Drizzle Kit so it generates the `CREATE SCHEMA` + three `CREATE TABLE` statements as migration `0008_entitlements_schema.sql`.

**Steps**:

1. Add `'./src/entitlements/schema.ts'` to the `schema` array in `drizzle.config.ts`:

```typescript
// drizzle.config.ts — add one line to the existing schema array
schema: [
  './src/db/schema.ts',
  './src/db/schema/orchestrator.ts',
  './src/content/schema.ts',
  './src/pipelines/schema.ts',
  './src/event-adapter/schema.ts',
  './src/profiles/schema.ts',
  './src/entitlements/schema.ts',   // NEW
],
```

2. Run `npx drizzle-kit generate` (or the project's existing script). This produces `drizzle/migrations/0008_<slug>_entitlements_schema.sql` and updates `drizzle/migrations/meta/_journal.json`.

3. Inspect the generated SQL. Verify it begins with `CREATE SCHEMA IF NOT EXISTS "entitlements";`. If Drizzle Kit generates `CREATE SCHEMA "entitlements";` without `IF NOT EXISTS` (as it did for the `profiles` schema in `0004_profile_isolation.sql:1`), edit the file to add `IF NOT EXISTS`. The `content` and `pipelines` schemas use the safe form (`0001_fine_young_avengers.sql:1,3`); match that.

4. Manually add the partial index to the generated SQL, after the `feature_entitlements` table's standard indexes:

```sql
--> statement-breakpoint
CREATE INDEX "entitlements_fe_active_subject_idx"
  ON "entitlements"."feature_entitlements" ("subject_type", "subject_id")
  WHERE "status" = 'active';
```

5. Commit both the generated `.sql` file and the updated `drizzle/migrations/meta/_journal.json`.

**Files**:
- `drizzle.config.ts` (modified — one line added)
- `drizzle/migrations/0008_<slug>_entitlements_schema.sql` (new, generated then patched)
- `drizzle/migrations/meta/_journal.json` (updated by drizzle-kit generate)

**Validation checklist**:
- [ ] `drizzle.config.ts` now has 7 entries in the `schema` array
- [ ] Migration file contains `CREATE SCHEMA IF NOT EXISTS "entitlements";` as first statement
- [ ] Migration file contains `CREATE TABLE "entitlements"."feature_catalog"` (with `feature_key` as PK — no `id` column)
- [ ] Migration file contains `CREATE TABLE "entitlements"."feature_entitlements"` with the unique constraint on `(subject_type, subject_id, feature_key)`
- [ ] Migration file contains `CREATE TABLE "entitlements"."entitlement_decisions"` with no FK to `feature_entitlements`
- [ ] Partial index `WHERE "status" = 'active'` is present in the migration SQL
- [ ] `npx drizzle-kit push` or `drizzle-kit migrate` applies the migration without errors against a test database
- [ ] No existing migrations are modified

**Edge cases**:
- `feature_catalog.feature_key` is a text PK (not cuid). Drizzle Kit should generate `"feature_key" text PRIMARY KEY NOT NULL` — verify it does not add a `$defaultFn` (there is none; the key is operator-provided).
- The `featureKey` FK on `feature_entitlements` uses `RESTRICT` on delete. Verify the generated SQL has `REFERENCES "entitlements"."feature_catalog"("feature_key") ON DELETE RESTRICT` (not CASCADE).
- Drizzle Kit regenerates all schemas on each run. Confirm it does not re-emit `CREATE SCHEMA IF NOT EXISTS "content"` etc. in the new migration (it should not, since those schemas already appear in the journal).

---

### T007: Verify typecheck + existing content entitlement tests pass (extraction regression gate)

**Purpose**: Confirm that the T001 extraction left the content entitlement path behaviorally identical. This is a **hard gate** — WP02 must not begin until this passes.

**Steps**:

1. Run `npm run typecheck` (or `tsc --noEmit`) from the `joyus-ai-mcp-server/` root. Zero errors required.
2. Run `npm test` and confirm:
   - The count of passing tests is equal to or greater than the pre-WP01 baseline.
   - No tests that were passing before now fail.
   - Focus on: `src/content/entitlements/` tests, `EntitlementService` tests, and any content-search tests that exercise the entitlement path.
3. If any failures, diagnose and fix in the shim files (`interface.ts`, `cache.ts`, `http-resolver.ts`) or import paths before declaring done.

**Files**:
- No new files. Minor import-path corrections to shim files if needed.

**Validation checklist**:
- [ ] `npm run typecheck` exits 0 with zero errors
- [ ] `npm test` exits 0 with no regressions vs. pre-WP01 baseline
- [ ] `EntitlementService` resolves, caches, and falls back identically to before the extraction
- [ ] Any test that touches `src/content/entitlements/` still passes
- [ ] The new `src/entitlements/` files do not introduce import cycles detectable by the build

**Edge cases**:
- TypeScript path aliases (if any) in `tsconfig.json` may need updating for the new `src/entitlements/` path. Check `tsconfig.json` for any `paths` entries.
- If the project uses `module: 'NodeNext'` or `moduleResolution: 'bundler'`, `.js` extensions in import paths matter — the shim re-exports must use `.js` suffixes consistently.

---

## Definition of Done

- [ ] `src/entitlements/core/interface.ts` — `EntitlementResolver`, `ResolverContext`, `EntitlementResolverConfig` (source of truth)
- [ ] `src/entitlements/core/cache.ts` — `EntitlementCache` (source of truth)
- [ ] `src/entitlements/core/http-resolver.ts` — `HttpEntitlementResolver`, `HttpResolverConfig` with `featuresField` added (source of truth)
- [ ] `src/entitlements/core/index.ts` — barrel export
- [ ] `src/content/entitlements/interface.ts` — re-export shim only
- [ ] `src/content/entitlements/cache.ts` — re-export shim only
- [ ] `src/content/entitlements/http-resolver.ts` — re-export shim only
- [ ] `src/content/types.ts` — `ResolvedEntitlements` extended with optional `featureKeys?: string[]`
- [ ] `src/entitlements/schema.ts` — three tables, type exports, `pgSchema('entitlements')`
- [ ] `src/entitlements/types.ts` — `Subject`, `FeatureKey`, `EffectiveEntitlement`, `GateToken`, `GrantSource`, `GrantStatus`, decision/audit types, constants
- [ ] `src/entitlements/validation.ts` — Zod schemas for grant create/modify/revoke and catalog entry, with inferred TypeScript types
- [ ] `drizzle.config.ts` — 7 schema entries
- [ ] `drizzle/migrations/0008_*_entitlements_schema.sql` — `CREATE SCHEMA IF NOT EXISTS "entitlements"`, three tables, partial index patched in manually
- [ ] `npm run typecheck` exits 0
- [ ] `npm test` exits 0 with no regressions (T007 hard gate)

---

## Risks

- **Extraction breaks content path (T007).** The content module (`EntitlementService`) imports `EntitlementCache` and `EntitlementResolver` from `./cache.js` and `./interface.js` relative to `src/content/entitlements/`. After T001, those files become re-export shims. If any import chain breaks, `EntitlementService` will fail at runtime without a compile-time error (dynamic imports, lazy requires). Mitigate: run the full test suite (T007) before merging.
- **`ResolvedEntitlements` type spread.** Adding `featureKeys?: string[]` (T002) to `ResolvedEntitlements` in `src/content/types.ts` is the one non-additive change to a widely-imported type. It is backward compatible (optional field), but any code that spreads `ResolvedEntitlements` into a constructed object literal with exact type checking may need an explicit `featureKeys: []`. Scan for `satisfies ResolvedEntitlements` usages.
- **Partial index not generated by Drizzle Kit.** The `WHERE status = 'active'` partial index is the hot-path index for the gate. If T006 forgets to patch it in, the gate will use the composite index instead — functionally correct but slower at scale. The migration review checklist must include this.
- **Migration slug collision.** `drizzle-kit generate` derives the migration filename slug from the changed schema names. Verify the generated file is indeed prefixed `0008_` and not a higher number (would indicate a gap in the journal). If there is a gap, investigate before proceeding.
- **`feature_catalog.featureKey` as text PK.** Every other table uses a cuid PK. Drizzle Kit may behave differently for text PKs without a default. Verify the generated SQL has no spurious default constraint on `feature_key`.

---

## Reviewer Guidance

- **Extraction scope**: Verify the three shim files in `src/content/entitlements/` contain *only* re-exports — no logic, no new imports from content-module internals. If any content-specific logic crept into `src/entitlements/core/`, the boundary is wrong.
- **`CREATE SCHEMA IF NOT EXISTS`**: Check the migration file's first line. The `profiles` schema migration (`0004_profile_isolation.sql`) omitted `IF NOT EXISTS`; the `content`/`pipelines` migration used it. Spec 015 requires the safe form.
- **`featureCatalog.featureKey` PK**: Confirm no `$defaultFn` is attached to this column. The key is human-supplied and stable by design; an auto-generated default would be wrong.
- **`entitlementDecisions` append-only**: Confirm there is no Drizzle `update()` or `delete()` call against this table anywhere in WP01 (there should be none — it is only written in WP02's audit writer). The append-only contract is enforced by convention in Phase 1; application-level enforcement is the only available mechanism before RLS lands (W5 dependency).
- **`featureKeys?: string[]` on `ResolvedEntitlements`**: This is the only change to existing types. Confirm it is optional and that no downstream test breaks because of a stricter type check.
- **T007 is non-negotiable**: Do not approve this WP without evidence that the pre-existing content entitlement test suite passes. A screenshot of `npm test` output or CI green is sufficient.
