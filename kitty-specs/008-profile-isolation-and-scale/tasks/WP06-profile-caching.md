---
work_package_id: WP06
title: Resolved Profile Caching
lane: planned
dependencies: [WP04]
subtasks: [T029, T030, T031]
phase: Phase 6 - Resolved Profile Caching
assignee: ''
agent: ''
shell_pid: ''
review_status: ''
reviewed_by: ''
history:
- timestamp: '2026-03-10T00:00:00Z'
  lane: planned
  agent: system
  action: Prompt generated via /spec-kitty.tasks
---

# WP06: Resolved Profile Caching

## Objective

Build a database-backed cache for resolved (inheritance-merged) profiles with inheritance-aware invalidation that guarantees stale entries are never served, and a cache warming system that precomputes resolved profiles for large tenants after profile changes.

## Implementation Command

```bash
spec-kitty implement WP06 --base WP04
```

## Context

- **Spec**: `kitty-specs/008-profile-isolation-and-scale/spec.md` — FR-008 (cache invalidation on upstream change, no stale entries), NFR-003 (<50ms p95 for cached lookups), SC-004
- **Plan**: `kitty-specs/008-profile-isolation-and-scale/plan.md` — Phase 6 deliverables
- **Research**: `kitty-specs/008-profile-isolation-and-scale/research.md` — R5 (ancestor-triggered recursive invalidation via recursive CTE, no time-based expiry)
- **Data Model**: `kitty-specs/008-profile-isolation-and-scale/data-model.md` — `profile_cache` table with `(tenantId, profileIdentity)` UNIQUE
- **Foundation**: WP01 schema (profile_cache table), WP04 inheritance resolver and hierarchy service
- **Key design**: Database-level cache (not in-memory). Survives server restarts. Shared across instances. Uses `INSERT ... ON CONFLICT UPDATE` (upsert) for writes. One entry per `(tenantId, profileIdentity)`.
- **Invalidation strategy**: Explicit invalidation only — no TTL. Cache entry is valid until an ancestor profile changes.
- **Performance target**: Cached lookups <50ms p95 (SC-004). The `(tenantId, profileIdentity)` UNIQUE index enables single-row retrieval.

---

## Subtask T029: Create Cache Service

**Purpose**: Implement the cache read/write service for resolved profiles using the `profile_cache` database table.

**Steps**:
1. Create `joyus-ai-mcp-server/src/profiles/cache/service.ts`
2. Import schema, types, tenant-scope helpers, and the InheritanceResolver from WP04
3. Implement `ProfileCacheService` class:
   - `constructor(db: DrizzleClient, resolver: InheritanceResolver, logger: ProfileOperationLogger)`
   - `async get(tenantId: string, profileIdentity: string): Promise<ResolvedProfile | null>`:
     1. `requireTenantId(tenantId)`
     2. Query `profile_cache` with `tenantWhere(tenantId)` and `profileIdentity` match
     3. If found: deserialize the cached data (resolvedFeatures, resolvedMarkers, overrideSources) and return as `ResolvedProfile`
     4. If not found: return null (cache miss)
   - `async getOrResolve(tenantId: string, profileIdentity: string): Promise<ResolvedProfile>`:
     1. Try `get(tenantId, profileIdentity)`
     2. If cache hit: record metric, return cached result
     3. If cache miss: record metric, call `resolver.resolve(tenantId, profileIdentity)`, store in cache, return result
     - This is the primary consumer-facing method — transparent caching
   - `async set(tenantId: string, profileIdentity: string, resolved: ResolvedProfile, ancestorVersions: Record<string, number>): Promise<void>`:
     1. Upsert into `profile_cache` using `INSERT ... ON CONFLICT (tenantId, profileIdentity) DO UPDATE`
     2. Store: resolvedFeatures, resolvedMarkers, overrideSources, ancestorVersions, resolvedAt = NOW()
   - `async delete(tenantId: string, profileIdentity: string): Promise<boolean>`:
     1. Delete the cache entry for this profile identity (tenant-scoped)
     2. Return true if deleted, false if not found
   - `async deleteAll(tenantId: string): Promise<number>`:
     1. Delete all cache entries for a tenant
     2. Return count of deleted entries
     3. Used for tenant deletion cleanup and as a safety fallback
   - `async getCacheStats(tenantId: string): Promise<CacheStats>`:
     - Return: total entries, oldest entry date, newest entry date
4. The `ancestorVersions` field stores a snapshot of which ancestor versions were current when the cache was built. This is for debugging — the actual invalidation is event-driven (T030), not version-comparison-driven.

**Files**:
- `joyus-ai-mcp-server/src/profiles/cache/service.ts` (new, ~120 lines)

**Validation**:
- [ ] `npm run typecheck` passes
- [ ] Cache get returns null on miss
- [ ] Cache getOrResolve resolves and caches on miss, returns cached on hit
- [ ] Upsert overwrites existing entry for same (tenantId, profileIdentity)
- [ ] Delete removes entry and returns correct boolean
- [ ] All queries use tenant scoping

---

## Subtask T030: Implement Inheritance-Aware Invalidation

**Purpose**: Implement cache invalidation that uses a recursive CTE to find and invalidate all descendant cache entries when any profile in the hierarchy is updated.

**Steps**:
1. Create `joyus-ai-mcp-server/src/profiles/cache/invalidation.ts`
2. Import schema, tenant-scope, hierarchy service from WP04, cache service from T029
3. Implement `CacheInvalidationService` class:
   - `constructor(db: DrizzleClient, hierarchyService: ProfileHierarchyService, cacheService: ProfileCacheService, logger: ProfileOperationLogger)`
   - `async invalidateForProfile(tenantId: string, changedProfileIdentity: string): Promise<{ invalidated: number; identities: string[] }>`:
     1. `requireTenantId(tenantId)`
     2. Find all descendants via recursive CTE on `profile_inheritance`:
        ```sql
        WITH RECURSIVE descendants AS (
          SELECT child_profile_identity FROM profiles.profile_inheritance
          WHERE parent_profile_identity = $changedProfileIdentity
            AND tenant_id = $tenantId
          UNION ALL
          SELECT pi.child_profile_identity
          FROM profiles.profile_inheritance pi
          JOIN descendants d ON pi.parent_profile_identity = d.child_profile_identity
          WHERE pi.tenant_id = $tenantId
        )
        SELECT child_profile_identity FROM descendants
        ```
     3. Collect IDs to invalidate: the changed profile itself + all descendants
     4. Delete cache entries for all collected identities:
        ```sql
        DELETE FROM profiles.profile_cache
        WHERE tenant_id = $tenantId
          AND profile_identity IN ($identities)
        ```
     5. Log the invalidation with count and identities
     6. Return count and list of invalidated identities
   - `async invalidateAll(tenantId: string): Promise<number>`:
     - Safety valve: invalidate ALL cache entries for a tenant
     - Used when hierarchy depth exceeds MAX_HIERARCHY_DEPTH or as a fallback
     - Log as a warning (this should be rare)
4. Safety check: if the recursive CTE returns more than 1000 descendants (sanity limit), log a warning and fall back to `invalidateAll`. This should never happen in practice (spec says 3 tiers, <=30 authors).
5. Hook into cascade propagation (WP04 T021): when `propagateChange` is called, also call `invalidateForProfile`. This is the integration point between WP04 and WP06.
6. Write unit tests in `tests/profiles/cache/invalidation.test.ts`:
   - Org profile change invalidates org, dept, and individual cache entries
   - Dept profile change invalidates dept and individual (not org)
   - Individual profile change invalidates only individual
   - Profile with no descendants: only its own cache entry is invalidated
   - Safety fallback: deep hierarchy triggers `invalidateAll` with warning

**Files**:
- `joyus-ai-mcp-server/src/profiles/cache/invalidation.ts` (new, ~100 lines)
- `joyus-ai-mcp-server/tests/profiles/cache/invalidation.test.ts` (new, ~100 lines)

**Validation**:
- [ ] `npm run typecheck` passes
- [ ] Invalidation tests pass
- [ ] Recursive CTE correctly finds all descendants
- [ ] Changed profile's own cache entry is also invalidated
- [ ] Safety fallback triggers on excessive depth
- [ ] Stale cache entries are never served after invalidation (FR-008)

---

## Subtask T031: Implement Cache Warming

**Purpose**: Precompute resolved profiles for large tenants immediately after profile changes, so the next read is a cache hit rather than an on-demand resolution.

**Steps**:
1. Extend `service.ts` or create a new function in `invalidation.ts`:
   - `async warmCache(tenantId: string, profileIdentities?: string[]): Promise<{ warmed: number; failed: number; durationMs: number }>`:
     1. `requireTenantId(tenantId)`
     2. If `profileIdentities` is provided, warm those specific profiles
     3. If not provided, warm all profiles for the tenant:
        - Query distinct `profileIdentity` values from `tenant_profiles` where `status = 'active'`
     4. For each profile identity:
        a. Resolve the profile via `resolver.resolve(tenantId, identity)`
        b. Store in cache via `cacheService.set(...)`
        c. On failure: log warning, increment failed count, continue to next
     5. Record total duration
     6. Log operation with warmed/failed counts and duration
     7. Return result
2. Integration: call `warmCache` after `invalidateForProfile` when the tenant has more than a configurable threshold of profiles (e.g., >20). This is an optimization — not required for correctness.
3. The warming threshold is configurable: `CACHE_WARM_THRESHOLD = 20` (warm after invalidation if tenant has >=20 active profiles). Below this threshold, on-demand resolution is fast enough.
4. Write unit tests in `tests/profiles/cache/warming.test.ts`:
   - Warm specific profiles: all are cached after warming
   - Warm all profiles for a tenant: every active profile has a cache entry
   - Failed resolution during warming: logged but does not block other profiles
   - Warming duration is recorded

**Files**:
- `joyus-ai-mcp-server/src/profiles/cache/service.ts` (extend, ~60 lines) or `invalidation.ts` (extend)
- `joyus-ai-mcp-server/tests/profiles/cache/warming.test.ts` (new, ~70 lines)

**Validation**:
- [ ] `npm run typecheck` passes
- [ ] Warming tests pass
- [ ] All specified profiles are cached after warming
- [ ] Failed resolution does not block other profiles
- [ ] Duration is tracked for performance monitoring

---

## Definition of Done

- [ ] Cache service stores and retrieves resolved profiles from `profile_cache` table
- [ ] `getOrResolve` provides transparent caching: cache hit returns immediately, cache miss resolves and caches
- [ ] Upsert semantics: cache writes overwrite existing entries
- [ ] Inheritance-aware invalidation uses recursive CTE to find and invalidate all descendants (FR-008)
- [ ] Changed profile's own cache entry is also invalidated
- [ ] Stale cache entries are never served after invalidation (FR-008)
- [ ] Cache warming precomputes resolved profiles for large tenants
- [ ] Safety fallback: excessive hierarchy depth triggers full tenant cache invalidation with warning
- [ ] Cached profile lookups return in <50ms at p95 (NFR-003) — validated in WP08
- [ ] All operations are tenant-scoped and logged
- [ ] `npm run typecheck` passes with zero errors
- [ ] All unit tests pass: `npx vitest run tests/profiles/cache/`

## Risks

- **Recursive CTE performance**: For very deep or wide hierarchies, the recursive CTE could be slow. Mitigation: spec limits to 3 tiers and <=30 authors. Safety limit of 1000 descendants. Index on `(tenantId, parentProfileIdentity)` is defined in schema.
- **Cache warming latency**: Warming many profiles synchronously after invalidation adds latency to the profile update operation. Mitigation: warming threshold limits when it runs. Future optimization: make warming async.
- **Cache coherence during concurrent operations**: Two operations could invalidate and warm the same profile simultaneously. Mitigation: upsert semantics mean the last write wins. Both operations produce correct data.

## Reviewer Guidance

- Verify recursive CTE includes `tenant_id` filtering in both the base case and recursive step
- Verify the changed profile's own cache entry is invalidated (not just descendants)
- Confirm safety fallback for excessive depth/breadth
- Check that `getOrResolve` records cache hit/miss metrics
- Verify upsert uses `ON CONFLICT (tenantId, profileIdentity) DO UPDATE`
- Confirm warming failure for one profile does not block others
- Verify all database queries use tenant scoping
