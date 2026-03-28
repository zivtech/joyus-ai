---
work_package_id: WP05
title: Profile Caching & Latency
lane: planned
dependencies: [WP01]
subtasks: [T023, T024, T025, T026]
history:
- date: '2026-03-14'
  action: created
  agent: claude-opus
---

# WP05: Profile Caching & Latency

**Implementation command**: `spec-kitty implement WP05 --base WP01`
**Target repo**: `joyus-ai`
**Dependencies**: WP01 (Profile Schema & Tenant Scoping)
**Priority**: P2 | Can run in parallel with WP06

## Objective

Build the in-memory LRU cache for profile feature vectors with configurable TTL, stampede protection (mutex on cache miss), and invalidation hooks that integrate with the versioning system (WP03). The cache reduces profile lookup latency from ~50ms (DB fetch) to < 5ms (memory hit) for the content generation hot path.

## Context

Profile feature vectors are approximately 2KB each (129 float64 features + metadata). The cache stores the full `FeatureVector` object keyed by `tenantId:profileId:versionNumber`. With a default max size of 1000 entries, the cache uses approximately 2-4MB of memory — negligible for a server process.

The cache is consumed by:
- Content generation (Spec 006) — looks up the profile's feature vector to apply voice styling
- Fidelity checking (Spec 005) — compares generated content against the profile's features
- Pipeline step handlers (Spec 009) — profile-generation and fidelity-check steps

**Stampede protection**: When a cache miss occurs and multiple concurrent requests need the same profile version, only one request should fetch from the database. The others should wait for the first fetch to complete and then read from cache. This is implemented with a per-key mutex (Promise-based lock).

**Invalidation**: When a profile is retrained (new version created via `ProfileVersionManager.createVersion`), all cached entries for that profile are invalidated. The invalidation is synchronous (not eventual) — the cache is an in-process Map, not a distributed cache.

---

## Subtasks

### T023: Implement LRU cache with TTL (`src/profiles/cache/lru.ts`)

**Purpose**: A generic LRU cache with per-entry TTL that can be used for profile feature vectors.

**Steps**:
1. Create `src/profiles/cache/lru.ts`
2. Implement `LRUCache<K, V>` class with `get`, `set`, `delete`, `has`, `clear`, `size`
3. Implement LRU eviction when max size is reached
4. Implement TTL expiration on `get` (lazy expiration, not background timer)

```typescript
// src/profiles/cache/lru.ts

interface CacheEntry<V> {
  value: V;
  expiresAt: number;  // Date.now() + ttlMs
}

export interface LRUCacheOptions {
  maxSize: number;
  ttlMs: number;
}

export class LRUCache<K, V> {
  private readonly cache = new Map<K, CacheEntry<V>>();
  private readonly maxSize: number;
  private readonly ttlMs: number;

  constructor(options: LRUCacheOptions) {
    this.maxSize = options.maxSize;
    this.ttlMs = options.ttlMs;
  }

  /**
   * Get a value from the cache.
   * Returns undefined if not found or expired.
   * Moves accessed entry to the "most recently used" position.
   */
  get(key: K): V | undefined {
    const entry = this.cache.get(key);
    if (!entry) return undefined;

    // Check TTL expiration
    if (Date.now() > entry.expiresAt) {
      this.cache.delete(key);
      return undefined;
    }

    // Move to most-recently-used position (Map insertion order)
    this.cache.delete(key);
    this.cache.set(key, entry);

    return entry.value;
  }

  /**
   * Set a value in the cache.
   * Evicts the least-recently-used entry if at max capacity.
   */
  set(key: K, value: V): void {
    // If key already exists, delete it first to update insertion order
    if (this.cache.has(key)) {
      this.cache.delete(key);
    }

    // Evict LRU entry if at capacity
    if (this.cache.size >= this.maxSize) {
      // Map.keys().next() returns the oldest (least recently used) entry
      const oldestKey = this.cache.keys().next().value;
      if (oldestKey !== undefined) {
        this.cache.delete(oldestKey);
      }
    }

    this.cache.set(key, {
      value,
      expiresAt: Date.now() + this.ttlMs,
    });
  }

  /**
   * Delete a specific key.
   */
  delete(key: K): boolean {
    return this.cache.delete(key);
  }

  /**
   * Delete all entries matching a predicate on the key.
   * Used for profile-level invalidation (delete all versions of a profile).
   */
  deleteMatching(predicate: (key: K) => boolean): number {
    let deleted = 0;
    for (const key of Array.from(this.cache.keys())) {
      if (predicate(key)) {
        this.cache.delete(key);
        deleted++;
      }
    }
    return deleted;
  }

  has(key: K): boolean {
    return this.get(key) !== undefined;  // Respects TTL
  }

  clear(): void {
    this.cache.clear();
  }

  get size(): number {
    return this.cache.size;
  }
}
```

**Files**:
- `src/profiles/cache/lru.ts` (new, ~80 lines)

**Validation**:
- [ ] `get` on expired entry returns `undefined` and removes the entry
- [ ] `set` evicts LRU entry when at max capacity
- [ ] `get` moves accessed entry to MRU position (prevents eviction)
- [ ] `deleteMatching` removes all entries matching the predicate
- [ ] `size` returns current cache size (not including expired entries lazily)
- [ ] `tsc --noEmit` passes

**Edge Cases**:
- Concurrent `get`/`set` operations: JavaScript is single-threaded, so Map operations are atomic. No additional synchronization needed for the cache itself.
- Expired entries are only removed on `get` (lazy expiration). The cache may temporarily hold expired entries that count toward `size`. This is acceptable — they are evicted on next access or by LRU eviction.

---

### T024: Implement cache stampede protection (mutex on miss)

**Purpose**: When multiple concurrent requests need the same uncached profile version, only one should fetch from the database. Others wait for the first fetch to complete.

**Steps**:
1. Create a `ProfileCacheService` class that wraps `LRUCache` with stampede protection
2. Implement `getOrFetch` method that uses a per-key Promise lock

```typescript
// src/profiles/cache/service.ts (or add to lru.ts)
import { LRUCache, type LRUCacheOptions } from './lru.js';
import type { FeatureVector, ProfileCacheKey } from '../types.js';
import { DEFAULT_CACHE_TTL_MS, DEFAULT_CACHE_MAX_SIZE } from '../types.js';

export class ProfileCacheService {
  private readonly cache: LRUCache<string, FeatureVector>;
  private readonly pending = new Map<string, Promise<FeatureVector | null>>();

  constructor(options?: Partial<LRUCacheOptions>) {
    this.cache = new LRUCache<string, FeatureVector>({
      maxSize: options?.maxSize ?? DEFAULT_CACHE_MAX_SIZE,
      ttlMs: options?.ttlMs ?? DEFAULT_CACHE_TTL_MS,
    });
  }

  private buildKey(key: ProfileCacheKey): string {
    return `${key.tenantId}:${key.profileId}:${key.versionNumber}`;
  }

  /**
   * Get a feature vector from cache, or fetch it using the provided function.
   * If another request is already fetching the same key, wait for that request
   * instead of issuing a duplicate fetch.
   */
  async getOrFetch(
    key: ProfileCacheKey,
    fetchFn: () => Promise<FeatureVector | null>,
  ): Promise<FeatureVector | null> {
    const cacheKey = this.buildKey(key);

    // Check cache first
    const cached = this.cache.get(cacheKey);
    if (cached) return cached;

    // Check if another request is already fetching this key
    const pendingFetch = this.pending.get(cacheKey);
    if (pendingFetch) return pendingFetch;

    // No cache hit, no pending fetch — initiate the fetch
    const fetchPromise = fetchFn()
      .then((result) => {
        if (result) {
          this.cache.set(cacheKey, result);
        }
        return result;
      })
      .finally(() => {
        this.pending.delete(cacheKey);
      });

    this.pending.set(cacheKey, fetchPromise);
    return fetchPromise;
  }

  /**
   * Invalidate all cached versions of a profile.
   * Called when a profile is retrained (new version created).
   */
  invalidateProfile(tenantId: string, profileId: string): number {
    const prefix = `${tenantId}:${profileId}:`;
    return this.cache.deleteMatching((key) => key.startsWith(prefix));
  }

  /**
   * Invalidate a specific version.
   */
  invalidateVersion(key: ProfileCacheKey): boolean {
    return this.cache.delete(this.buildKey(key));
  }

  clear(): void {
    this.cache.clear();
    this.pending.clear();
  }

  get size(): number {
    return this.cache.size;
  }
}
```

**Files**:
- `src/profiles/cache/service.ts` (new, ~70 lines)

**Validation**:
- [ ] Two concurrent `getOrFetch` calls for the same key result in only one `fetchFn` invocation
- [ ] The second caller gets the same result as the first
- [ ] Failed fetch does not leave a stale pending entry (`.finally` cleanup)
- [ ] Successful fetch populates the cache for subsequent `getOrFetch` calls
- [ ] `tsc --noEmit` passes

**Edge Cases**:
- `fetchFn` throws: the error propagates to all waiting callers, and the pending entry is cleaned up. Next request will retry the fetch.
- `fetchFn` returns null: null is NOT cached (the key might become available later). But the pending entry is still cleaned up.

---

### T025: Implement cache invalidation on retrain/version-change

**Purpose**: Wire cache invalidation into the version manager so that retraining automatically clears stale cached entries.

**Steps**:
1. Add a cache reference to `ProfileVersionManager` (optional dependency — cache may not be initialized)
2. Call `cache.invalidateProfile()` after `createVersion` succeeds
3. Ensure invalidation is synchronous (in-process Map, not async)

```typescript
// Modify src/profiles/versioning/manager.ts

export class ProfileVersionManager {
  constructor(
    private readonly db: DrizzleClient,
    private readonly cache?: ProfileCacheService,  // Optional — may not be available
  ) {}

  async createVersion(params: { ... }): Promise<...> {
    const version = await this.db.transaction(async (tx) => {
      // ... existing transaction logic ...
    });

    // Invalidate cache after successful version creation
    if (this.cache) {
      this.cache.invalidateProfile(
        // Need tenantId — fetch from profile or pass as param
        params.tenantId,  // Add tenantId to createVersion params
        params.profileId,
      );
    }

    return version;
  }
}
```

**Files**:
- `src/profiles/versioning/manager.ts` (modified — add optional cache parameter)

**Validation**:
- [ ] After `createVersion`, all cached versions of that profile are invalidated
- [ ] Cache invalidation does not throw if cache is not provided (optional dependency)
- [ ] Cache invalidation happens AFTER the transaction commits (not inside the transaction)
- [ ] `tsc --noEmit` passes

---

### T026: Create cache module barrel and unit tests

**Purpose**: Barrel export and comprehensive unit tests.

**Steps**:
1. Create `src/profiles/cache/index.ts` barrel export
2. Create `tests/profiles/cache/lru.test.ts` — LRU cache unit tests
3. Create `tests/profiles/cache/service.test.ts` — ProfileCacheService unit tests

**Test cases for lru.test.ts**:
- Set and get a value -> returns the value
- Get expired value -> returns undefined
- Set beyond max size -> evicts LRU entry
- Get moves entry to MRU position (not evicted on next set)
- deleteMatching removes correct entries
- clear removes all entries

**Test cases for service.test.ts**:
- getOrFetch cache hit -> fetchFn NOT called
- getOrFetch cache miss -> fetchFn called, result cached
- Two concurrent getOrFetch for same key -> fetchFn called only once
- invalidateProfile clears all versions of the profile
- fetchFn returns null -> NOT cached, next call re-fetches
- fetchFn throws -> error propagates, pending cleaned up

**Files**:
- `src/profiles/cache/index.ts` (new)
- `tests/profiles/cache/lru.test.ts` (new, ~80 lines)
- `tests/profiles/cache/service.test.ts` (new, ~80 lines)

**Validation**:
- [ ] All unit tests pass
- [ ] `npm run typecheck` exits 0
- [ ] `npm test` exits 0 with no regressions

---

## Definition of Done

- [ ] `src/profiles/cache/lru.ts` — `LRUCache` with TTL, eviction, deleteMatching
- [ ] `src/profiles/cache/service.ts` — `ProfileCacheService` with getOrFetch, stampede protection, invalidation
- [ ] `src/profiles/cache/index.ts` — barrel export
- [ ] `src/profiles/versioning/manager.ts` — modified to accept optional cache and invalidate on createVersion
- [ ] Unit tests for LRU (6+ cases) and service (6+ cases)
- [ ] Cache hit latency < 5ms (verified in integration tests WP08)
- [ ] `npm run typecheck` exits 0
- [ ] `npm test` exits 0 with no regressions

## Risks

- **Memory estimation**: 1000 entries * ~4KB (FeatureVector + Map overhead) = ~4MB. This is conservative. Monitor actual memory usage in staging. The `maxSize` constant is configurable.
- **Lazy expiration accumulation**: Expired entries are only cleaned up on `get`. If many entries expire without being accessed, they remain in memory until evicted by LRU pressure. For most workloads this is fine. If memory monitoring shows bloat, add a periodic sweep (every 5 minutes, iterate and remove expired entries).
- **Cache invalidation completeness**: The `invalidateProfile` method uses prefix matching on the string key. If the key format changes, invalidation may miss entries. The key format (`tenantId:profileId:versionNumber`) is defined in one place (`buildKey`) to prevent this.

## Reviewer Guidance

- Verify the LRU implementation uses JavaScript `Map` insertion order (guaranteed by the spec) for O(1) LRU tracking. Do NOT use a doubly-linked list — Map already provides the ordering.
- Check that stampede protection uses a `Map<string, Promise>` pattern, not a mutex library. The Promise-based approach is simpler and naturally works with async/await.
- Confirm cache invalidation happens AFTER the database transaction commits. Invalidating inside the transaction could leave the cache empty if the transaction rolls back.
- Verify null results from `fetchFn` are NOT cached. A transient database error returning null should not prevent future successful fetches.
