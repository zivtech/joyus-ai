---
work_package_id: "WP02"
title: "FeatureGate Decision Core"
lane: "planned"
dependencies: ["WP01"]
subtasks: ["T008", "T009", "T010", "T011", "T012", "T013", "T014"]
history:
  - date: "2026-06-14"
    action: "created"
    agent: "claude-opus"
---

# WP02: FeatureGate Decision Core

**Implementation command**: `spec-kitty implement WP02`
**Target repo**: `joyus-ai`
**Dependencies**: WP01 (shared `src/entitlements/core/`, `entitlements` schema, `Subject` type, opaque `GateToken` type stub)
**Priority**: P0 (security core — WP03, WP04, WP05 all depend on this)

## Objective

Build the complete feature-entitlement decision stack: a DB-backed, expiry-aware resolver; a subject-scoped cache with TTL capping to next grant expiry; a `MembershipResolver` seam (stubbed for Phase 1); an append-only audit writer; and the `FeatureGate` service that owns `isEntitled`/`assertEntitled`, computes the effective-entitlement union over the actor's subject set, and is the sole minter of the opaque `GateToken`. The gate fails closed on both access and lapsed grants at every step.

## Context

The existing `EntitlementService` (`src/content/entitlements/index.ts`) establishes the resolution pattern this WP reuses: cache → resolver → DB fallback → restricted mode. WP02 adopts that machinery (extracted to `src/entitlements/core/` by WP01) but inverts three key behaviors:

| Axis | Content `EntitlementService` | WP02 `FeatureGate` |
|---|---|---|
| **Cache key** | `sessionId` (session-scoped) | `subject_type:subject_id` (durable, subject-scoped) |
| **Deny semantics** | Silent — empty result | Explicit — throws `FeatureNotEntitledError` |
| **DB fallback expiry** | No expiry filter (selects most-recent row) | MUST filter `status='active' AND (valid_until IS NULL OR valid_until > now())` |

The third difference is the load-bearing correctness requirement of this entire WP. The content DB fallback (`index.ts:75-109`) selects by `userId+tenantId`, ordered by `resolvedAt DESC`, with no `expiresAt` filter. Naively copying that pattern into the feature fallback would serve a lapsed paid grant during a resolver outage — **failing open on a lapsed grant**. Every DB-touching code path in WP02 must carry the active+non-expired filter.

The explicit-deny contract also runs in the opposite direction from content: the content gate is silent (unentitled returns empty results), so callers cannot know whether emptiness means "no content" or "no access." The feature gate signals through an exception so the API/MCP layer can return a structured upgrade response. This means `FeatureGate.assertEntitled` is a hard throw, not a soft return, and every caller must handle `FeatureNotEntitledError` explicitly rather than silently swallowing absent results.

The `GateToken` mint point established here is the structural anchor for WP03's un-forgeable enforcement. `assertEntitled` is the only place a `GateToken` is produced; the type is defined so it cannot be constructed anywhere else. WP03 then wires gated entrypoints to require a token as their proof-of-gate parameter. The type shape must be locked down here even though WP03 does the wiring — if a future implementer can construct a `GateToken` without calling `assertEntitled`, FR-016's structural guarantee collapses to theater.

## Subtasks

---

### T008: `FeatureEntitlementResolver` — DB-leads, expiry-aware

**Purpose**: Resolve the set of active, non-expired `feature_key`s for a given subject from `entitlements.feature_entitlements`. This is the primary (DB-leads) resolver; an optional external `HttpEntitlementResolver` may front it in environments where a billing API is authoritative, but the DB is always the fallback source of truth.

**Steps**:

1. Create `src/entitlements/feature/resolver.ts`.
2. Implement `FeatureEntitlementResolver` against the `EntitlementResolver` interface from `src/entitlements/core/interface.ts` (extracted by WP01). The interface is generic over the ID pair; adapt it to take `subjectType` and `subjectId` in the `ResolverContext` or define a `FeatureResolverContext` that extends `ResolverContext` with those fields.
3. The DB query MUST be the expiry-aware form shown below — no exceptions, no "we'll add that later."
4. Return the resolved set as a `FeatureSet` (a `Set<string>` of feature keys) plus the TTL metadata needed by T010 to cap the cache entry.

**Critical interfaces and algorithm**:

```typescript
// src/entitlements/feature/resolver.ts

import { and, eq, gt, isNull, or } from 'drizzle-orm';
import type { DrizzleClient } from '../../db/types.js';
import type { Subject } from '../types.js';  // from WP01 T004
import { featureEntitlements } from '../schema.js';  // from WP01 T003

export interface FeatureResolverResult {
  /** Resolved feature keys, post-filter (active + non-expired only). */
  featureKeys: Set<string>;
  /**
   * Unix timestamp (ms) of the earliest valid_until among resolved grants,
   * or null if all grants are perpetual. Used by the cache to cap TTL so
   * no grant outlives its valid_until by more than one cache window (FR-017).
   */
  nextExpiryMs: number | null;
  resolvedFrom: string;
  resolvedAt: Date;
}

export class FeatureEntitlementResolver {
  constructor(
    private readonly db: DrizzleClient,
    private readonly resolverName = 'feature-db',
  ) {}

  async resolve(subject: Subject): Promise<FeatureResolverResult> {
    const now = new Date();

    // FR-017: MUST filter status='active' AND (valid_until IS NULL OR valid_until > now).
    // Do NOT omit the valid_until filter — the content DB fallback omits it and would
    // serve lapsed licensed features on outage. That is the bug this code exists to prevent.
    const rows = await this.db
      .select({
        featureKey: featureEntitlements.featureKey,
        validUntil: featureEntitlements.validUntil,
      })
      .from(featureEntitlements)
      .where(
        and(
          eq(featureEntitlements.subjectType, subject.subjectType),
          eq(featureEntitlements.subjectId, subject.subjectId),
          eq(featureEntitlements.status, 'active'),
          or(
            isNull(featureEntitlements.validUntil),
            gt(featureEntitlements.validUntil, now),
          ),
        ),
      );

    const featureKeys = new Set(rows.map((r) => r.featureKey));

    // Find the earliest upcoming expiry to cap the cache TTL (FR-017).
    const expiringRows = rows.filter((r) => r.validUntil !== null);
    const nextExpiryMs =
      expiringRows.length > 0
        ? Math.min(...expiringRows.map((r) => r.validUntil!.getTime()))
        : null;

    return {
      featureKeys,
      nextExpiryMs,
      resolvedFrom: this.resolverName,
      resolvedAt: now,
    };
  }
}
```

**Files**:
- `src/entitlements/feature/resolver.ts` (new, ~60 lines)

**Validation**:
- [ ] A grant with `valid_until = yesterday` is NOT returned
- [ ] A grant with `valid_until = tomorrow` IS returned
- [ ] A grant with `valid_until = null` IS returned (perpetual)
- [ ] A grant with `status = 'suspended'` is NOT returned
- [ ] `nextExpiryMs` is `null` when all returned grants are perpetual
- [ ] `nextExpiryMs` is the earliest expiry when multiple expiring grants exist
- [ ] `tsc --noEmit` passes

**Edge Cases**:
- The Drizzle `gt(column, now)` compares a `timestamp` column against a JS `Date`. Confirm Drizzle's pg adapter handles this without timezone coercion. If not, use `sql\`${featureEntitlements.validUntil} > NOW()\`` as the fallback.
- An empty result (no rows) is a valid, non-error outcome: the subject simply holds no active grants. Return `{ featureKeys: new Set(), nextExpiryMs: null, ... }`.

---

### T009: `MembershipResolver` interface + `NullMembershipResolver`

**Purpose**: Define the seam through which Phase 1.5 (org seat-licensing, WP12) will inject real tenant membership. Pre-WP12, the membership set is empty (`[]`), so the effective union in the gate reduces to `{user:U}` — the individual path works day one with zero tenant system.

**Steps**:

1. Create `src/entitlements/feature/membership.ts`.
2. Define the `MembershipResolver` interface. It takes a `userId` and returns the list of `Subject`s whose grants should be unioned into that user's effective entitlement. Pre-WP12, this is always `[]`.
3. Implement `NullMembershipResolver` returning `[]`.

**Interfaces**:

```typescript
// src/entitlements/feature/membership.ts

import type { Subject } from '../types.js';

/**
 * Resolves the set of non-user subjects (e.g. tenant orgs) whose grants
 * are inherited by the given user. Pre-WP12 this always returns [].
 *
 * Phase 1.5: replace NullMembershipResolver with a DB-backed implementation
 * that reads tenant↔user membership (WP12-owned table) and returns the
 * relevant { subjectType: 'tenant', subjectId: tenantId } entries.
 */
export interface MembershipResolver {
  getMemberSubjects(userId: string): Promise<Subject[]>;
}

/**
 * Phase 1 stub. Returns no inherited subjects.
 * The gate's effective union degrades to {user:U} only.
 * Replace with a real implementation when WP12 lands (Phase 1.5).
 */
export class NullMembershipResolver implements MembershipResolver {
  async getMemberSubjects(_userId: string): Promise<Subject[]> {
    return [];
  }
}
```

**Files**:
- `src/entitlements/feature/membership.ts` (new, ~25 lines)

**Validation**:
- [ ] `NullMembershipResolver` returns `[]` for any input
- [ ] `MembershipResolver` interface is satisfied by both `NullMembershipResolver` and a future DB-backed implementation
- [ ] `tsc --noEmit` passes

**Edge Cases**:
- Leave a clear `// Phase 1.5: replace with WP12 implementation` comment so the activation path is self-documenting.
- The interface takes `userId` (string), not a full `Subject` — callers always pass the actor's user ID.

---

### T010: Subject-scoped cache wiring

**Purpose**: Wire the `EntitlementCache` (extracted to `src/entitlements/core/cache.ts` by WP01) for subject-scoped, expiry-aware caching of feature key sets. The cache key is `subject_type:subject_id`. The TTL is `min(defaultTtlSeconds, time-to-next-grant-expiry)` so a cached set never survives past the earliest `valid_until` of its constituent grants.

**Steps**:

1. Create `src/entitlements/feature/feature-cache.ts`.
2. Wrap `EntitlementCache` (or parameterize it — depending on the WP01 extraction approach) with a `FeatureEntitlementCache` that:
   - Uses `subject_type:subject_id` as the cache key
   - Caps the TTL at `min(configuredTtlMs, msUntilNextExpiry)` when `nextExpiryMs` is provided by the resolver
   - Exposes explicit `invalidate(subject: Subject)` for use by the grant write path (WP04 T025)
3. The cached value is a `Set<string>` of active feature keys (the post-filter resolved set from T008).

**Implementation**:

```typescript
// src/entitlements/feature/feature-cache.ts

import type { Subject } from '../types.js';

// Reuse the generic cache from core (extracted by WP01).
// EntitlementCache is parameterized over its value type in WP01's extraction.
// If WP01 extracted it as content-specific, create a parallel generic version here.
import { EntitlementCache } from '../core/cache.js';

export const DEFAULT_FEATURE_CACHE_TTL_MS = 60 * 60 * 1000; // 1 hour

/**
 * Subject-keyed cache for resolved feature key sets.
 *
 * Key format: `${subjectType}:${subjectId}` — e.g. "user:usr_abc123"
 * TTL: min(DEFAULT_FEATURE_CACHE_TTL_MS, msUntilNextExpiry)
 *
 * Unlike the content cache (keyed by sessionId, invalidated on session close),
 * this cache is keyed by stable subject identity and invalidated on grant change.
 */
export class FeatureEntitlementCache {
  // If EntitlementCache from core is still content-typed, use a local Map here
  // and replicate the same get/set/invalidate/cleanup pattern. Do not import a
  // content-typed class — prefer a clean generic or a local reimplementation.
  private readonly inner: Map<string, { keys: Set<string>; expiresAt: number }> = new Map();

  private cacheKey(subject: Subject): string {
    return `${subject.subjectType}:${subject.subjectId}`;
  }

  get(subject: Subject): Set<string> | null {
    const key = this.cacheKey(subject);
    const entry = this.inner.get(key);
    if (!entry) return null;
    if (Date.now() > entry.expiresAt) {
      this.inner.delete(key);
      return null;
    }
    return entry.keys;
  }

  /**
   * Store the resolved feature key set for a subject.
   *
   * @param subject - the subject being cached
   * @param keys - post-filter set of active feature keys
   * @param nextExpiryMs - Unix ms of earliest grant valid_until, or null for perpetual.
   *   The cache TTL is capped to min(DEFAULT_FEATURE_CACHE_TTL_MS, msUntilNextExpiry)
   *   so a cached entry never outlives the earliest expiring grant (FR-017).
   */
  set(subject: Subject, keys: Set<string>, nextExpiryMs: number | null): void {
    const key = this.cacheKey(subject);
    const defaultExpiry = Date.now() + DEFAULT_FEATURE_CACHE_TTL_MS;
    const expiresAt =
      nextExpiryMs !== null
        ? Math.min(defaultExpiry, nextExpiryMs)
        : defaultExpiry;
    this.inner.set(key, { keys, expiresAt });
  }

  /**
   * Explicit invalidation — called by the grant write path (WP04 T025)
   * on grant/revoke/suspend/expire events.
   *
   * Multi-instance caveat (FR-018): this invalidates only the local node.
   * Cross-node propagation relies on TTL expiry until a pub/sub bus is added.
   */
  invalidate(subject: Subject): void {
    this.inner.delete(this.cacheKey(subject));
  }

  cleanup(): void {
    const now = Date.now();
    for (const [key, entry] of this.inner.entries()) {
      if (now > entry.expiresAt) this.inner.delete(key);
    }
  }
}
```

**Files**:
- `src/entitlements/feature/feature-cache.ts` (new, ~60 lines)

**Validation**:
- [ ] Cache key is `"user:usr_abc"` for `{ subjectType: 'user', subjectId: 'usr_abc' }`
- [ ] When `nextExpiryMs` is 30 minutes from now and default TTL is 1 hour, effective TTL is 30 minutes
- [ ] When `nextExpiryMs` is 2 hours from now and default TTL is 1 hour, effective TTL is 1 hour
- [ ] `get()` returns `null` for an entry past its `expiresAt`
- [ ] `invalidate()` removes the entry immediately
- [ ] `tsc --noEmit` passes

**Edge Cases**:
- If WP01's extracted `EntitlementCache` is still typed to `ResolvedEntitlements` (content-module type), do not import it here. Write `FeatureEntitlementCache` as a self-contained class. The content cache can stay content-typed; this is the feature cache. Clean separation is preferable to a complex generic that both modules share.
- `nextExpiryMs` precision: it is a Unix millisecond timestamp from the resolver. `Date.now()` subtraction gives ms-until-expiry; if the result is negative (grant already expired at resolve time but passed the DB filter due to clock skew), clamp to 0 — the entry should not be cached at all. Log a warning.

---

### T011: `entitlement_decisions` append-only audit writer

**Purpose**: Write an allow or deny record to `entitlements.entitlement_decisions` for every gate decision. This table is append-only (no UPDATE/DELETE), following the `orchestrator_events` precedent. The audit writer has two methods and nothing else — it is not a general-purpose logger.

**Steps**:

1. Create `src/entitlements/feature/audit.ts`.
2. Implement `EntitlementAuditWriter` with `logAllow` and `logDeny` only.
3. Both methods write to `entitlements.entitlement_decisions` via Drizzle insert. Failures should NOT propagate to the caller — audit write failure must not block a gate decision. Log the error to `console.error` (or the platform's logger) and swallow.

**Implementation**:

```typescript
// src/entitlements/feature/audit.ts

import { createId } from '@paralleldrive/cuid2';
import type { DrizzleClient } from '../../db/types.js';
import { entitlementDecisions } from '../schema.js';  // from WP01 T003
import type { Subject } from '../types.js';

export type DecisionReason =
  | 'entitled'
  | 'not_entitled'
  | 'expired'
  | 'suspended'
  | 'limit_exceeded'
  | 'resolver_unavailable_fallback_deny';

export type ResolvedFrom = 'cache' | 'resolver' | 'db' | 'default_deny';

export interface AuditContext {
  /** The feature key being gated */
  featureKey: string;
  /** Which source produced the decision */
  resolvedFrom: ResolvedFrom;
  /** The specific capability being accessed, e.g. "tool:advanced_pipeline_run" */
  capability?: string;
  /** MCP/HTTP session id when available */
  sessionId?: string;
}

export class EntitlementAuditWriter {
  constructor(private readonly db: DrizzleClient) {}

  async logAllow(subject: Subject, ctx: AuditContext): Promise<void> {
    await this.write(subject, 'allow', 'entitled', ctx);
  }

  async logDeny(subject: Subject, reason: DecisionReason, ctx: AuditContext): Promise<void> {
    await this.write(subject, 'deny', reason, ctx);
  }

  private async write(
    subject: Subject,
    decision: 'allow' | 'deny',
    reason: DecisionReason,
    ctx: AuditContext,
  ): Promise<void> {
    try {
      await this.db.insert(entitlementDecisions).values({
        id: createId(),
        subjectType: subject.subjectType,
        subjectId: subject.subjectId,
        featureKey: ctx.featureKey,
        decision,
        reason,
        resolvedFrom: ctx.resolvedFrom,
        capability: ctx.capability ?? null,
        sessionId: ctx.sessionId ?? null,
        createdAt: new Date(),
      });
    } catch (err) {
      // Audit write failure must NOT block the gate decision.
      // Log and swallow — a missed audit row is preferable to a broken request.
      console.error('[EntitlementAuditWriter] Failed to write decision row', {
        decision,
        featureKey: ctx.featureKey,
        subject,
        err,
      });
    }
  }
}
```

**Files**:
- `src/entitlements/feature/audit.ts` (new, ~60 lines)

**Validation**:
- [ ] `logAllow` writes `decision='allow'`, `reason='entitled'`
- [ ] `logDeny` writes `decision='deny'` with the provided reason
- [ ] A DB insert failure does NOT throw from `logAllow`/`logDeny`
- [ ] `capability` and `sessionId` are nullable (written as `null` when absent)
- [ ] `tsc --noEmit` passes

**Edge Cases**:
- FR-006 says the table is append-only. The `EntitlementAuditWriter` never calls `update` or `delete`. A code reviewer should flag any such calls as a spec violation.
- When FR-019's union resolves an allow via a *tenant* subject rather than the user's own grant, the `subject` passed to `logAllow` should be the specific subject that satisfied the allow (the tenant, not the user). The gate (T012) is responsible for passing the right subject to the audit call.

---

### T012: `FeatureGate` service — union, resolution order, `GateToken` mint

**Purpose**: The single enforcement service. Resolves a user's effective entitlement as the union of `{user:U} ∪ membershipSubjects`, runs cache→resolver→DB-fallback→deny at every step (all expiry-aware), mints a `GateToken` on allow, and throws `FeatureNotEntitledError` on deny. This is the only place in the codebase that may mint a `GateToken`.

**Steps**:

1. Create `src/entitlements/feature/gate.ts`.
2. `FeatureGate` constructor takes `FeatureEntitlementResolver`, `FeatureEntitlementCache`, `MembershipResolver`, `EntitlementAuditWriter`.
3. Implement `isEntitled` and `assertEntitled` per the signatures below.
4. The union algorithm: resolve the subject set for the actor, resolve each subject's feature keys (cache→resolver→DB-fallback→deny), union all sets; allow if the feature key appears in the union.
5. `GateToken` is imported from `src/entitlements/types.ts` (defined by WP01 T004). `assertEntitled` is the sole caller of the token mint function. The mint function must be unexported and co-located with the type, making external construction impossible at the type level. If WP01 only stubbed the type, complete the brand/mint pattern here.

**Critical implementation**:

```typescript
// src/entitlements/feature/gate.ts

import type { Subject } from '../types.js';
import {
  mintGateToken,  // unexported from types.ts; only re-exported here for assertEntitled's use
  type GateToken,
} from '../types.js';
import type { FeatureEntitlementResolver } from './resolver.js';
import type { FeatureEntitlementCache } from './feature-cache.js';
import type { MembershipResolver } from './membership.js';
import type { EntitlementAuditWriter } from './audit.js';
import { FeatureNotEntitledError } from './errors.js';  // T013

// ── GateToken type (if WP01 T004 only stubbed it, complete it here) ────────
//
// The GateToken is an opaque branded type. There is exactly ONE mint function.
// It is NOT exported from this module — only assertEntitled calls it.
// WP03 will wire gated entrypoints to require a GateToken parameter.
//
// If WP01 T004 already defined the brand+mint in src/entitlements/types.ts,
// import mintGateToken from there. If it only declared the type, add the mint:
//
//   declare const _gateTokenBrand: unique symbol;
//   export type GateToken = { readonly [_gateTokenBrand]: true };
//   // Not exported — only assertEntitled calls this:
//   export function mintGateToken(): GateToken {
//     return {} as GateToken;
//   }

export class FeatureGate {
  constructor(
    private readonly resolver: FeatureEntitlementResolver,
    private readonly cache: FeatureEntitlementCache,
    private readonly membershipResolver: MembershipResolver,
    private readonly audit: EntitlementAuditWriter,
  ) {}

  /**
   * Non-throwing entitlement check. Does NOT mint a GateToken.
   * Use assertEntitled for enforcement — isEntitled is for conditional logic
   * (e.g. filtering tool lists) where a token is not yet needed.
   */
  async isEntitled(userId: string, featureKey: string): Promise<boolean> {
    const { entitled } = await this.resolveEffective(userId, featureKey);
    return entitled;
  }

  /**
   * Enforcement method. Throws FeatureNotEntitledError on deny.
   * Returns an opaque GateToken on allow — the ONLY place a GateToken is minted.
   *
   * The GateToken is the proof-of-gate that WP03 wires into gated entrypoints.
   * No other code path may produce a GateToken. The type is branded/opaque
   * so this cannot be circumvented at the type level.
   *
   * @param userId - the authenticated actor (always a user id; never inferred
   *   from tenantId — the gate takes an explicit subject)
   * @param featureKey - the feature being gated (e.g. "com.joyus.addon.advanced-pipelines")
   * @param capability - optional human-readable capability name for audit + error payload
   * @param sessionId - MCP/HTTP session id for audit correlation
   */
  async assertEntitled(
    userId: string,
    featureKey: string,
    capability?: string,
    sessionId?: string,
  ): Promise<GateToken> {
    const { entitled, satisfyingSubject, resolvedFrom } = await this.resolveEffective(
      userId,
      featureKey,
    );

    if (entitled && satisfyingSubject) {
      await this.audit.logAllow(satisfyingSubject, {
        featureKey,
        resolvedFrom,
        capability,
        sessionId,
      });
      // The ONE and ONLY mint point. mintGateToken is not exported from this module.
      return mintGateToken();
    }

    await this.audit.logDeny(
      { subjectType: 'user', subjectId: userId },
      'not_entitled',
      { featureKey, resolvedFrom, capability, sessionId },
    );
    throw new FeatureNotEntitledError(featureKey, capability);
  }

  /**
   * Resolve the effective entitlement for a user across their full subject set.
   *
   * Algorithm (FR-019):
   *   subjectSet = { user:userId } ∪ membershipResolver.getMemberSubjects(userId)
   *   for each subject in subjectSet:
   *     resolve featureKeys (cache → resolver → DB fallback → empty)
   *   effectiveKeys = union of all per-subject featureKeys
   *   entitled = featureKey ∈ effectiveKeys
   *
   * Pre-WP12: membershipResolver returns [] so subjectSet = { user:userId }.
   * Post-WP12: membershipResolver returns tenant subjects; one tenant grant
   *   entitles every member with no per-user rows required.
   *
   * Resolution order per subject (FR-005, FR-017):
   *   1. Cache (subject-keyed; post-filter set)
   *   2. Resolver (FeatureEntitlementResolver.resolve; expiry-aware)
   *   3. DB fallback (same expiry-aware query as the resolver — NOT the content fallback)
   *   4. Empty set (default deny — never grant on fallback)
   *
   * All steps return the post-filter set; no step may return expired grants.
   */
  private async resolveEffective(
    userId: string,
    featureKey: string,
  ): Promise<{
    entitled: boolean;
    satisfyingSubject: Subject | null;
    resolvedFrom: 'cache' | 'resolver' | 'db' | 'default_deny';
  }> {
    const userSubject: Subject = { subjectType: 'user', subjectId: userId };
    const memberSubjects = await this.membershipResolver.getMemberSubjects(userId);
    const subjectSet: Subject[] = [userSubject, ...memberSubjects];

    for (const subject of subjectSet) {
      const { keys, resolvedFrom } = await this.resolveSubject(subject);
      if (keys.has(featureKey)) {
        return { entitled: true, satisfyingSubject: subject, resolvedFrom };
      }
    }

    return { entitled: false, satisfyingSubject: null, resolvedFrom: 'default_deny' };
  }

  /**
   * Resolve the feature key set for a single subject.
   * Order: cache → resolver → DB fallback → empty.
   * All steps are expiry-aware (returning only active, non-expired grants).
   */
  private async resolveSubject(subject: Subject): Promise<{
    keys: Set<string>;
    resolvedFrom: 'cache' | 'resolver' | 'db' | 'default_deny';
  }> {
    // 1. Cache
    const cached = this.cache.get(subject);
    if (cached !== null) {
      return { keys: cached, resolvedFrom: 'cache' };
    }

    // 2. Resolver (DB-leads implementation; may be fronted by HttpEntitlementResolver
    //    in environments where a billing API is authoritative)
    try {
      const result = await this.resolver.resolve(subject);
      this.cache.set(subject, result.featureKeys, result.nextExpiryMs);
      return { keys: result.featureKeys, resolvedFrom: 'resolver' };
    } catch (_resolverErr) {
      // Resolver failed — fall through to DB fallback.
    }

    // 3. DB fallback — MUST use the same expiry-aware query as the resolver.
    // WARNING: Do NOT copy the content DB fallback (index.ts:75-109). That query
    // selects the most-recent row with no expiresAt filter and would serve a lapsed
    // paid grant on outage. The expiry-aware query lives in FeatureEntitlementResolver.
    // Call it directly (bypass cache) for the fallback read.
    try {
      const fallback = await this.resolver.resolve(subject);
      // Do not cache the fallback result — the resolver was unavailable and the
      // data may be stale in ways we can't detect. Let the next call retry normally.
      return { keys: fallback.featureKeys, resolvedFrom: 'db' };
    } catch (_fallbackErr) {
      // Both resolver paths failed. Default deny.
    }

    // 4. Default deny — never grant on total failure (FR-005).
    return { keys: new Set(), resolvedFrom: 'default_deny' };
  }
}
```

> **Implementation note on the DB fallback**: The code above calls `this.resolver.resolve(subject)` twice (once as primary, once as fallback) because `FeatureEntitlementResolver` IS the DB layer. In the DB-leads design, the "resolver" reads the DB. If Phase 1 also wires an `HttpEntitlementResolver` in front (external billing), the class should accept a separate `dbFallbackResolver: FeatureEntitlementResolver` parameter that goes directly to DB, bypassing the HTTP layer. The critical invariant is: **the fallback path must use the expiry-aware DB query, never a raw select without the filter**.

**Files**:
- `src/entitlements/feature/gate.ts` (new, ~120 lines)

**Validation**:
- [ ] `assertEntitled` returns a `GateToken` when entitled
- [ ] `assertEntitled` throws `FeatureNotEntitledError` when not entitled
- [ ] `isEntitled` returns `boolean` and does NOT throw
- [ ] Resolution order is cache → resolver → fallback → deny (not resolver → cache)
- [ ] Pre-WP12: union is just `{user:U}` (NullMembershipResolver returns `[]`)
- [ ] `assertEntitled` takes `userId` explicitly — never reads `tenantId` from ambient context
- [ ] `logAllow` receives the satisfying subject (which subject's grant allowed it)
- [ ] `logDeny` is called with `reason='not_entitled'` on default deny
- [ ] `mintGateToken` is not accessible outside this module + `types.ts`
- [ ] `tsc --noEmit` passes

**Edge Cases**:
- **Do not infer userId from tenantId**: The spec explicitly calls out `executor.ts:104`'s `tenantId == userId` collapse as a known shortcut that must not enter the gate API. `assertEntitled` takes `userId` as its first argument — the caller supplies it from the authenticated request context.
- **Union short-circuits on first match**: The loop over `subjectSet` returns on the first subject that satisfies the feature key. This means the audit log captures which subject (user vs which tenant) allowed the access — important for post-WP12 debugging of inherited vs. personal entitlements.
- **Audit on fallback deny**: When the fallback produces an empty set and the feature is not entitled, `logDeny` should use `reason='resolver_unavailable_fallback_deny'` if the resolver threw (distinguish from clean `not_entitled`). The `resolveSubject` private method needs to propagate whether a resolver error occurred to inform the deny reason. Adjust the implementation to track this.
- **`isEntitled` does not audit**: Checking for tool list visibility should not produce deny audit rows (that would flood the log with benign list-filter calls). Only `assertEntitled` writes audit rows. If a future caller needs deny audit from `isEntitled`, that is a separate design decision.

---

### T013: `FeatureNotEntitledError` + structured upgrade payload

**Purpose**: Define the error class thrown by `assertEntitled` on deny, carrying the structured payload that the API and MCP layers map to HTTP 402/403 and MCP tool errors. This is the explicit-deny signal — the opposite of the content path's silent empty result.

**Steps**:

1. Create `src/entitlements/feature/errors.ts`.
2. Implement `FeatureNotEntitledError extends Error` with a machine-readable `upgradePayload`.
3. Define `UpgradePayload` — the shape the HTTP layer maps to a 402/403 body and the MCP layer maps to a non-empty tool error.

**Implementation**:

```typescript
// src/entitlements/feature/errors.ts

/**
 * Machine-readable payload attached to FeatureNotEntitledError.
 * The HTTP layer maps this to a 402/403 response body.
 * The MCP layer maps this to a non-empty tool error with isError: true.
 */
export interface UpgradePayload {
  /** The feature key that was denied, e.g. "com.joyus.addon.advanced-pipelines" */
  featureKey: string;
  /** The specific capability that was blocked, e.g. "tool:advanced_pipeline_run" */
  capability?: string;
  /** Human-readable reason for the denial */
  message: string;
  /** HTTP status hint: 402 for "this is a licensed feature", 403 for "suspended/revoked" */
  httpStatus: 402 | 403;
  /**
   * Upgrade action hint for the client UI.
   * "upgrade_required" = not licensed at all.
   * "contact_admin" = licensed at org level but user is not a member, or suspended.
   */
  upgradeAction: 'upgrade_required' | 'contact_admin';
}

export class FeatureNotEntitledError extends Error {
  public readonly featureKey: string;
  public readonly upgradePayload: UpgradePayload;

  constructor(featureKey: string, capability?: string) {
    const message = capability
      ? `Not entitled to use ${capability} (requires feature: ${featureKey})`
      : `Not entitled to feature: ${featureKey}`;

    super(message);
    this.name = 'FeatureNotEntitledError';
    this.featureKey = featureKey;
    this.upgradePayload = {
      featureKey,
      capability,
      message,
      httpStatus: 402,
      upgradeAction: 'upgrade_required',
    };

    // Maintains proper prototype chain in transpiled environments
    Object.setPrototypeOf(this, FeatureNotEntitledError.prototype);
  }
}

/**
 * Type guard for FeatureNotEntitledError.
 * Use in Express error handlers and MCP tool dispatch to produce structured responses.
 */
export function isFeatureNotEntitledError(err: unknown): err is FeatureNotEntitledError {
  return err instanceof FeatureNotEntitledError;
}

/**
 * Map a FeatureNotEntitledError to the MCP tool error shape.
 * Returns content array with isError: true per the MCP spec.
 */
export function toMcpToolError(err: FeatureNotEntitledError): {
  content: Array<{ type: 'text'; text: string }>;
  isError: true;
} {
  return {
    content: [
      {
        type: 'text',
        text: JSON.stringify(err.upgradePayload),
      },
    ],
    isError: true,
  };
}
```

**Files**:
- `src/entitlements/feature/errors.ts` (new, ~65 lines)

**Validation**:
- [ ] `new FeatureNotEntitledError('com.joyus.addon.x').upgradePayload.httpStatus === 402`
- [ ] `isFeatureNotEntitledError(new FeatureNotEntitledError('x'))` is `true`
- [ ] `isFeatureNotEntitledError(new Error('other'))` is `false`
- [ ] `toMcpToolError(err).isError === true`
- [ ] `toMcpToolError(err).content[0].type === 'text'`
- [ ] `tsc --noEmit` passes

**Edge Cases**:
- `httpStatus: 402` is the default for "upgrade required." A future caller may want 403 for suspended/revoked grants (the user IS entitled but the grant is suspended — different UX). The `upgradePayload` shape allows the gate to vary this in a future revision; for Phase 1 always emit 402.
- `Object.setPrototypeOf` is required for `instanceof` to work correctly with transpiled ES classes. Do not omit it.

---

### T014: Unit tests

**Purpose**: Verify the resolver's expiry/fail-closed behavior, the union degrades to `{user}` pre-WP12, the cache caps TTL to next expiry and responds to explicit invalidation, the audit writer is append-only and swallows write failures, and the gate's full resolution order including deny reasons.

**Steps**:

1. Create `tests/entitlements/unit/feature-resolver.test.ts`
2. Create `tests/entitlements/unit/feature-cache.test.ts`
3. Create `tests/entitlements/unit/entitlement-audit.test.ts`
4. Create `tests/entitlements/unit/feature-gate.test.ts`

Follow the Vitest + mock-DB pattern established in `tests/content/integration/entitlements.test.ts`: use `vi.fn()` for DB/resolver mocks, no real DB connections.

**Test cases — resolver (T008)**:

```typescript
// tests/entitlements/unit/feature-resolver.test.ts

describe('FeatureEntitlementResolver', () => {
  it('returns only active, non-expired grants', async () => {
    // Mock DB returns rows including one with valid_until = yesterday, one active,
    // one perpetual (valid_until = null). Resolver should return only active + perpetual.
  });

  it('returns empty set when no active grants exist', async () => {
    // Mock DB returns [] — resolver returns { featureKeys: new Set(), nextExpiryMs: null }
  });

  it('sets nextExpiryMs to the earliest valid_until among returned rows', async () => {
    // Two grants: valid_until = 2h from now, valid_until = 4h from now.
    // nextExpiryMs should be the 2h timestamp.
  });

  it('sets nextExpiryMs to null when all grants are perpetual', async () => {
    // All returned rows have valid_until = null.
  });

  it('throws when the DB query fails (fail-closed)', async () => {
    // Mock DB throws. Resolver should propagate the error — callers apply fallback logic.
  });
});
```

**Test cases — cache (T010)**:

```typescript
// tests/entitlements/unit/feature-cache.test.ts

describe('FeatureEntitlementCache', () => {
  it('caps TTL to nextExpiryMs when nextExpiryMs < default TTL', () => {
    // nextExpiryMs = now + 30min; default TTL = 1h.
    // Entry should expire in ~30min, not ~1h.
  });

  it('uses default TTL when nextExpiryMs > default TTL', () => {
    // nextExpiryMs = now + 2h; default TTL = 1h.
    // Entry should expire in ~1h.
  });

  it('uses default TTL when nextExpiryMs is null (perpetual grants)', () => {});

  it('returns null for an expired entry', () => {
    // Set with ttl=0 or back-date the expiry; get() should return null.
  });

  it('explicit invalidate removes the entry before TTL', () => {
    // Set, then invalidate, then get() → null.
  });

  it('cleanup() removes expired entries', () => {
    // Set two entries, one with ttl=0 (already expired), one valid. Cleanup. Verify only valid remains.
  });
});
```

**Test cases — audit (T011)**:

```typescript
// tests/entitlements/unit/entitlement-audit.test.ts

describe('EntitlementAuditWriter', () => {
  it('logAllow writes decision=allow, reason=entitled', async () => {
    const mockInsert = vi.fn().mockReturnValue({ values: vi.fn().mockResolvedValue(undefined) });
    const writer = new EntitlementAuditWriter({ insert: mockInsert } as never);
    await writer.logAllow({ subjectType: 'user', subjectId: 'u1' }, {
      featureKey: 'com.joyus.addon.x', resolvedFrom: 'cache',
    });
    expect(mockInsert).toHaveBeenCalledOnce();
    // Verify the values call received decision='allow', reason='entitled'
  });

  it('logDeny writes decision=deny with the provided reason', async () => {});

  it('does NOT throw when the DB insert fails', async () => {
    // Mock insert to throw. logAllow/logDeny should return without throwing.
    const mockInsert = vi.fn().mockReturnValue({
      values: vi.fn().mockRejectedValue(new Error('DB down')),
    });
    const writer = new EntitlementAuditWriter({ insert: mockInsert } as never);
    await expect(
      writer.logAllow({ subjectType: 'user', subjectId: 'u1' }, {
        featureKey: 'com.joyus.addon.x', resolvedFrom: 'db',
      }),
    ).resolves.not.toThrow();
  });
});
```

**Test cases — gate (T012)**:

```typescript
// tests/entitlements/unit/feature-gate.test.ts

describe('FeatureGate', () => {
  describe('resolution order', () => {
    it('returns cache hit without calling resolver', async () => {});
    it('calls resolver on cache miss and caches the result', async () => {});
    it('falls through to DB fallback when resolver throws', async () => {});
    it('denies (and does not throw from assertEntitled) when all paths fail', async () => {
      // All paths fail → FeatureNotEntitledError thrown with reason=resolver_unavailable
    });
  });

  describe('union (FR-019)', () => {
    it('pre-WP12: effective set is just {user:U} when NullMembershipResolver returns []', async () => {
      // User has feature key X. NullMembershipResolver returns [].
      // isEntitled(userId, 'X') → true.
    });

    it('union: entitled via membership subject even when user grant absent', async () => {
      // User has no personal grant. Stubbed MembershipResolver returns [{ subjectType: 'tenant', subjectId: 't1' }].
      // Tenant t1 has grant for feature X.
      // isEntitled(userId, 'X') → true.
    });

    it('denies when neither user nor membership subjects have the feature', async () => {});
  });

  describe('explicit subject — no ambient tenantId inference', () => {
    it('takes userId as explicit param; does not read tenantId from context', async () => {
      // This test exists to pin the API contract. assertEntitled(userId, ...) — first arg is userId.
      // The test verifies that calling assertEntitled with userId='u1' resolves against
      // { subjectType: 'user', subjectId: 'u1' }, NOT against a tenantId.
    });
  });

  describe('GateToken minting', () => {
    it('assertEntitled returns a GateToken on allow', async () => {
      const token = await gate.assertEntitled(userId, featureKey);
      // Token is truthy and satisfies the GateToken type (opaque brand check)
      expect(token).toBeTruthy();
    });

    it('assertEntitled throws FeatureNotEntitledError on deny', async () => {
      await expect(gate.assertEntitled(userId, 'com.joyus.addon.not-granted'))
        .rejects.toThrow(FeatureNotEntitledError);
    });
  });

  describe('deny reasons', () => {
    it('logs not_entitled when no grant exists', async () => {});
    it('logs resolver_unavailable_fallback_deny when resolver throws and DB is also unavailable', async () => {});
  });
});
```

**Files**:
- `tests/entitlements/unit/feature-resolver.test.ts` (new, ~60 lines)
- `tests/entitlements/unit/feature-cache.test.ts` (new, ~50 lines)
- `tests/entitlements/unit/entitlement-audit.test.ts` (new, ~40 lines)
- `tests/entitlements/unit/feature-gate.test.ts` (new, ~100 lines)

**Validation**:
- [ ] All described test cases are implemented (not just `it.todo`)
- [ ] `npm test -- tests/entitlements/unit/` exits 0
- [ ] No test imports real DB connection or real HTTP resolver
- [ ] Resolver expiry filter is tested with explicit past/future/null dates
- [ ] Cache TTL capping is tested with numeric comparisons (not just "truthy")
- [ ] Audit swallow-on-failure is tested (mock insert that rejects → logAllow resolves)
- [ ] Union with empty membership is tested (pre-WP12 path)
- [ ] Gate deny via `assertEntitled` throws `FeatureNotEntitledError`, not a generic error

---

## Definition of Done

- [ ] `src/entitlements/feature/resolver.ts` — DB-leads, expiry-aware; `status='active' AND (valid_until IS NULL OR valid_until > now)` filter present; returns `nextExpiryMs`
- [ ] `src/entitlements/feature/membership.ts` — `MembershipResolver` interface + `NullMembershipResolver`
- [ ] `src/entitlements/feature/feature-cache.ts` — subject-keyed; TTL capped to `min(default, nextExpiryMs)`; explicit `invalidate(subject)`
- [ ] `src/entitlements/feature/audit.ts` — `logAllow`/`logDeny` only; append-only writes; swallows DB errors
- [ ] `src/entitlements/feature/gate.ts` — `isEntitled`/`assertEntitled`; union over `{user:U} ∪ membership`; resolution order cache→resolver→db-fallback→deny; sole `GateToken` mint point
- [ ] `src/entitlements/feature/errors.ts` — `FeatureNotEntitledError` with `UpgradePayload`; `toMcpToolError` helper
- [ ] `tests/entitlements/unit/*.test.ts` — resolver expiry/fail-closed, cache TTL capping, audit swallow, gate union + order + deny reasons
- [ ] `npm run typecheck` exits 0 with zero errors
- [ ] `npm test` exits 0 with no regressions on existing content entitlement tests
- [ ] `mintGateToken` is not importable by arbitrary modules (enforce via unexported function or module boundary)

## Risks

- **DB fallback expiry regression**: The single highest-risk copy-paste error in this WP is writing the DB fallback without the `valid_until` filter. The content fallback (`index.ts:75-109`) is the wrong template. Every reviewer must check the fallback query for the active+non-expired predicate.
- **GateToken mint escape**: If `mintGateToken` leaks (re-exported, or the `GateToken` type is constructible via a cast), WP03's structural enforcement is hollow. Keep the mint function module-private.
- **Cache TTL math**: `min(defaultExpiry, nextExpiryMs)` operates on Unix milliseconds from two different bases. Double-check that `Date.now() + DEFAULT_FEATURE_CACHE_TTL_MS` and `nextExpiryMs` (from the resolver) are both in the same units (ms). Off-by-1000x here produces a 1-second or 1000-second TTL.
- **Audit blocking the gate**: If `logAllow`/`logDeny` are awaited before returning the GateToken and the DB is slow, the gate adds latency to every gated call. Consider a fire-and-forget pattern (`void this.audit.logAllow(...)`) for latency-sensitive paths, with the understanding that audit completeness is best-effort.
- **Union subject order**: The loop short-circuits on the first satisfying subject. If the union iterates membership subjects before the user subject, the audit log may record a tenant grant as the satisfying subject even when the user had a personal grant. Iterate user subject first for predictable attribution.

## Reviewer Guidance

- **Expiry filter verification (T008, T012)**: Open `resolver.ts` and confirm the Drizzle `.where()` clause contains both `eq(featureEntitlements.status, 'active')` and the `or(isNull(...), gt(...))` on `validUntil`. If either is absent, the resolver is incorrect. The content fallback is the reference for what NOT to do.
- **GateToken mint point (T012)**: Confirm `mintGateToken` is called in exactly one place (`assertEntitled`) and is not exported from `gate.ts` or `errors.ts`. If it appears in any other call site, that is a FR-016 violation.
- **Union pre-WP12 (T009, T012, T014)**: Confirm `NullMembershipResolver.getMemberSubjects` returns `[]` and the gate test for pre-WP12 behavior uses it. The union `{user:U} ∪ []` must not accidentally include phantom subjects.
- **Audit swallow (T011)**: The audit write is wrapped in `try/catch` with no rethrow. Confirm the test for DB-down behavior verifies that `logAllow` resolves (not rejects) when the DB insert fails.
- **No ambient context inference (T012)**: `assertEntitled` signature is `(userId: string, featureKey: string, ...)` — the first argument is always the explicit authenticated user id. There must be no `this.context?.tenantId` or equivalent read inside the gate. A reviewer who sees any implicit context read should flag it as a security concern.
- **Content path regression**: Run `npm test -- tests/content/` after WP02 to verify the existing entitlement tests still pass. WP02 adds new files but should not touch `src/content/` — any modification there is unexpected and must be justified.
