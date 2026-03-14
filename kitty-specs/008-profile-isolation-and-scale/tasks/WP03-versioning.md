---
work_package_id: "WP03"
title: "Profile Versioning"
lane: "planned"
dependencies: ["WP01"]
subtasks: ["T013", "T014", "T015", "T016", "T017"]
history:
  - date: "2026-03-14"
    action: "created"
    agent: "claude-opus"
---

# WP03: Profile Versioning

**Implementation command**: `spec-kitty implement WP03 --base WP01`
**Target repo**: `joyus-ai`
**Dependencies**: WP01 (Profile Schema & Tenant Scoping)
**Priority**: P1 | T015 (diff) and T016 (staleness) are independent and can be written in parallel

## Objective

Implement the profile versioning system: version creation on training/retraining, version pinning for stable generation, feature vector diff engine for comparing versions, and staleness detection computed on query.

## Context

Profiles evolve as authors evolve. Each time a profile is trained or retrained, a new version is created with an incremented version number. The `profiles.currentVersionNumber` pointer tracks the latest completed version. Previous versions are retained and queryable — they are never deleted (only the profile itself can be archived).

**Version numbering**: Simple monotonic integers (1, 2, 3, ...), not semantic versioning. The "semantic" label in the spec overview refers to the concept that versions are meaningful snapshots, not that they follow semver syntax. Integer versioning is simpler and avoids major/minor/patch ambiguity for ML model outputs.

**Version pinning**: A version pin is a record that says "for this profile, use version N for generation." Pins are per-profile (not per-pipeline or per-session) — a single profile has at most one active pin. When pinned, generation uses the pinned version; when unpinned, generation uses `currentVersionNumber`.

The `ProfileVersionManager` is the central class for this WP. It is consumed by:
- WP04 (batch ingestion) — calls `createVersion` on training completion
- WP06 (retraining) — calls `createVersion` on drift-triggered retraining
- WP07 (API routes) — calls `getVersions`, `getVersion`, `pinVersion`, `getDiff`

---

## Subtasks

### T013: Implement version creation logic (`src/profiles/versioning/manager.ts`)

**Purpose**: Create new profile versions with monotonically increasing version numbers, update the profile's `currentVersionNumber` pointer, and handle concurrent version creation safely.

**Steps**:
1. Create `src/profiles/versioning/manager.ts`
2. Implement `ProfileVersionManager` class
3. Implement `createVersion` method with row-level lock for version number generation

```typescript
// src/profiles/versioning/manager.ts
import { eq, and, desc, sql } from 'drizzle-orm';
import { createId } from '@paralleldrive/cuid2';
import { profiles, profileVersions } from '../schema.js';
import type { FeatureVector } from '../types.js';
import type { DrizzleClient } from '../../content/types.js';

export class ProfileVersionManager {
  constructor(private readonly db: DrizzleClient) {}

  /**
   * Create a new version for a profile. Atomically increments the version number
   * and updates the profile's currentVersionNumber pointer.
   *
   * Uses SELECT ... FOR UPDATE on the profile row to prevent concurrent version
   * number collisions.
   */
  async createVersion(params: {
    profileId: string;
    featureVector: FeatureVector;
    trainingCorpusSize: number;
    trainingCorpusIds: string[];
    accuracyScore?: number;
    trainingDurationMs?: number;
  }): Promise<typeof profileVersions.$inferSelect> {
    // Run in a transaction to ensure atomicity
    return this.db.transaction(async (tx) => {
      // Lock the profile row to prevent concurrent version creation
      const [profile] = await tx
        .select()
        .from(profiles)
        .where(eq(profiles.id, params.profileId))
        .for('update');

      if (!profile) {
        throw new Error(`Profile not found: ${params.profileId}`);
      }

      const nextVersion = (profile.currentVersionNumber ?? 0) + 1;

      // Insert the new version
      const [version] = await tx
        .insert(profileVersions)
        .values({
          id: createId(),
          profileId: params.profileId,
          versionNumber: nextVersion,
          featureVector: params.featureVector,
          trainingCorpusSize: params.trainingCorpusSize,
          trainingCorpusIds: params.trainingCorpusIds,
          accuracyScore: params.accuracyScore ?? null,
          trainingDurationMs: params.trainingDurationMs ?? null,
        })
        .returning();

      // Update the profile's currentVersionNumber and lastRetrainedAt
      await tx
        .update(profiles)
        .set({
          currentVersionNumber: nextVersion,
          lastRetrainedAt: new Date(),
          status: 'active',
          updatedAt: new Date(),
        })
        .where(eq(profiles.id, params.profileId));

      return version;
    });
  }

  /**
   * Get all versions for a profile, ordered by version number descending.
   */
  async getVersions(profileId: string): Promise<Array<typeof profileVersions.$inferSelect>> {
    return this.db
      .select()
      .from(profileVersions)
      .where(eq(profileVersions.profileId, profileId))
      .orderBy(desc(profileVersions.versionNumber));
  }

  /**
   * Get a specific version by profile ID and version number.
   */
  async getVersion(profileId: string, versionNumber: number): Promise<typeof profileVersions.$inferSelect | null> {
    const rows = await this.db
      .select()
      .from(profileVersions)
      .where(
        and(
          eq(profileVersions.profileId, profileId),
          eq(profileVersions.versionNumber, versionNumber),
        ),
      )
      .limit(1);
    return rows[0] ?? null;
  }

  /**
   * Get the current (latest) version for a profile, respecting any active pin.
   * If pinned, returns the pinned version. Otherwise returns currentVersionNumber.
   */
  async getCurrentVersion(
    profileId: string,
    tenantId: string,
  ): Promise<typeof profileVersions.$inferSelect | null> {
    // Check for an active pin first
    const pin = await this.getActivePin(profileId, tenantId);
    const versionNumber = pin
      ? pin.versionNumber
      : (await this.db.select().from(profiles).where(eq(profiles.id, profileId)).limit(1))[0]?.currentVersionNumber;

    if (!versionNumber) return null;
    return this.getVersion(profileId, versionNumber);
  }
}
```

**Files**:
- `src/profiles/versioning/manager.ts` (new, ~100 lines)

**Validation**:
- [ ] `createVersion` increments version number atomically (no gaps, no duplicates under concurrency)
- [ ] `createVersion` updates `profiles.currentVersionNumber` and `lastRetrainedAt`
- [ ] `createVersion` sets `profiles.status` to `'active'` (profile is no longer `pending_training`)
- [ ] `getVersions` returns versions ordered by `versionNumber` descending
- [ ] `tsc --noEmit` passes

**Edge Cases**:
- First version: `currentVersionNumber` is null, so `nextVersion = 0 + 1 = 1`.
- `SELECT ... FOR UPDATE` locks the profile row within the transaction. If two concurrent transactions attempt to create a version, one will wait for the other to commit.

---

### T014: Implement version pinning and currentVersion updates

**Purpose**: Allow tenants to pin a specific profile version for stable generation. At most one pin per profile per tenant.

**Steps**:
1. Add pin management methods to `ProfileVersionManager`
2. Implement `pinVersion`, `unpinVersion`, and `getActivePin`

```typescript
// Add to src/profiles/versioning/manager.ts

  /**
   * Pin a specific version for a profile. Replaces any existing pin.
   * Validates that the version exists before pinning.
   */
  async pinVersion(params: {
    tenantId: string;
    profileId: string;
    versionNumber: number;
    pinnedBy: string;
    reason?: string;
  }): Promise<typeof profileVersionPins.$inferSelect> {
    // Verify the version exists
    const version = await this.getVersion(params.profileId, params.versionNumber);
    if (!version) {
      throw new Error(`Version ${params.versionNumber} not found for profile ${params.profileId}`);
    }

    // Remove any existing pin for this profile+tenant
    await this.db
      .delete(profileVersionPins)
      .where(
        and(
          eq(profileVersionPins.profileId, params.profileId),
          eq(profileVersionPins.tenantId, params.tenantId),
        ),
      );

    // Create the new pin
    const [pin] = await this.db
      .insert(profileVersionPins)
      .values({
        id: createId(),
        tenantId: params.tenantId,
        profileId: params.profileId,
        versionNumber: params.versionNumber,
        pinnedBy: params.pinnedBy,
        reason: params.reason ?? null,
      })
      .returning();

    return pin;
  }

  /**
   * Remove the active pin for a profile, reverting to currentVersionNumber.
   */
  async unpinVersion(tenantId: string, profileId: string): Promise<void> {
    await this.db
      .delete(profileVersionPins)
      .where(
        and(
          eq(profileVersionPins.profileId, profileId),
          eq(profileVersionPins.tenantId, tenantId),
        ),
      );
  }

  /**
   * Get the active pin for a profile, if any.
   */
  async getActivePin(
    profileId: string,
    tenantId: string,
  ): Promise<typeof profileVersionPins.$inferSelect | null> {
    const rows = await this.db
      .select()
      .from(profileVersionPins)
      .where(
        and(
          eq(profileVersionPins.profileId, profileId),
          eq(profileVersionPins.tenantId, tenantId),
        ),
      )
      .limit(1);
    return rows[0] ?? null;
  }
```

**Files**:
- `src/profiles/versioning/manager.ts` (modified)

**Validation**:
- [ ] `pinVersion` replaces existing pin (delete-then-insert, not upsert)
- [ ] `pinVersion` validates that the version exists before pinning
- [ ] `unpinVersion` removes the pin, reverting to `currentVersionNumber`
- [ ] `getActivePin` returns null if no pin exists
- [ ] `getCurrentVersion` respects pin: if pinned, returns pinned version

---

### T015: Implement feature vector diff engine (`src/profiles/versioning/diff.ts`)

**Purpose**: Compare two versions of the same profile and produce a structured diff showing which stylometric features changed, by how much, and the overall similarity between versions.

**Steps**:
1. Create `src/profiles/versioning/diff.ts`
2. Implement `computeProfileDiff` function
3. Implement cosine similarity helper

```typescript
// src/profiles/versioning/diff.ts
import type { FeatureVector, ProfileDiff, FeatureDiff } from '../types.js';
import { SIGNIFICANT_CHANGE_THRESHOLD_PERCENT } from '../types.js';

/**
 * Compute cosine similarity between two equal-length numeric vectors.
 * Returns a value between 0.0 (orthogonal) and 1.0 (identical direction).
 */
export function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length) {
    throw new Error(`Vector length mismatch: ${a.length} vs ${b.length}`);
  }
  let dotProduct = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < a.length; i++) {
    dotProduct += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  const denominator = Math.sqrt(normA) * Math.sqrt(normB);
  if (denominator === 0) return 0;
  return dotProduct / denominator;
}

/**
 * Compare two profile versions and produce a structured diff.
 *
 * Both versions must belong to the same profile (caller responsibility).
 * The feature vectors must have the same dimension and feature name ordering.
 */
export function computeProfileDiff(
  profileId: string,
  versionA: { versionNumber: number; featureVector: FeatureVector },
  versionB: { versionNumber: number; featureVector: FeatureVector },
): ProfileDiff {
  const featA = versionA.featureVector;
  const featB = versionB.featureVector;

  if (featA.features.length !== featB.features.length) {
    throw new Error(
      `Feature vector dimension mismatch: ${featA.features.length} vs ${featB.features.length}`,
    );
  }

  const allChanges: FeatureDiff[] = [];
  for (let i = 0; i < featA.features.length; i++) {
    const oldValue = featA.features[i];
    const newValue = featB.features[i];
    const delta = newValue - oldValue;
    const percentChange = oldValue !== 0
      ? (delta / Math.abs(oldValue)) * 100
      : (newValue !== 0 ? Infinity : 0);

    allChanges.push({
      featureName: featA.featureNames[i] ?? `feature_${i}`,
      oldValue,
      newValue,
      delta,
      percentChange,
    });
  }

  const significantChanges = allChanges.filter(
    (c) => Math.abs(c.percentChange) > SIGNIFICANT_CHANGE_THRESHOLD_PERCENT && isFinite(c.percentChange),
  );

  const overallSimilarity = cosineSimilarity(featA.features, featB.features);

  return {
    profileId,
    versionA: versionA.versionNumber,
    versionB: versionB.versionNumber,
    totalFeatures: featA.features.length,
    changedFeatures: allChanges.filter((c) => c.delta !== 0).length,
    significantChanges,
    allChanges,
    overallSimilarity,
  };
}
```

**Files**:
- `src/profiles/versioning/diff.ts` (new, ~70 lines)

**Validation**:
- [ ] Identical feature vectors -> `overallSimilarity: 1.0`, `changedFeatures: 0`
- [ ] Completely different vectors -> `overallSimilarity` near 0.0
- [ ] Feature with `oldValue: 0` and `newValue: 5` -> `percentChange: Infinity` (filtered from `significantChanges` by `isFinite`)
- [ ] `significantChanges` only includes features with > 5% change (default threshold)
- [ ] `tsc --noEmit` passes

**Edge Cases**:
- Zero vectors (all features are 0): cosine similarity returns 0, not NaN.
- Mismatched feature dimensions: throws immediately rather than producing incorrect diff.

---

### T016: Implement staleness detection (`src/profiles/versioning/staleness.ts`)

**Purpose**: Determine if a profile is stale based on its `lastRetrainedAt` timestamp and `stalenessThresholdDays` setting. Staleness is computed on query (not stored in the database).

**Steps**:
1. Create `src/profiles/versioning/staleness.ts`
2. Implement `computeStaleness` function

```typescript
// src/profiles/versioning/staleness.ts
import type { Profile } from '../types.js';
import { DEFAULT_STALENESS_THRESHOLD_DAYS } from '../types.js';

export interface StalenessInfo {
  isStale: boolean;
  daysSinceRetrain: number | null;   // null if never retrained
  thresholdDays: number;
}

/**
 * Compute whether a profile is stale based on its lastRetrainedAt
 * and stalenessThresholdDays settings.
 *
 * A profile is stale if:
 * - It has never been retrained (lastRetrainedAt is null), OR
 * - The time since lastRetrainedAt exceeds stalenessThresholdDays
 */
export function computeStaleness(
  profile: Pick<Profile, 'lastRetrainedAt' | 'stalenessThresholdDays'>,
  now: Date = new Date(),
): StalenessInfo {
  const thresholdDays = profile.stalenessThresholdDays ?? DEFAULT_STALENESS_THRESHOLD_DAYS;

  if (!profile.lastRetrainedAt) {
    return { isStale: true, daysSinceRetrain: null, thresholdDays };
  }

  const msSinceRetrain = now.getTime() - profile.lastRetrainedAt.getTime();
  const daysSinceRetrain = Math.floor(msSinceRetrain / (1000 * 60 * 60 * 24));

  return {
    isStale: daysSinceRetrain > thresholdDays,
    daysSinceRetrain,
    thresholdDays,
  };
}
```

**Files**:
- `src/profiles/versioning/staleness.ts` (new, ~35 lines)

**Validation**:
- [ ] Never-retrained profile -> `isStale: true`, `daysSinceRetrain: null`
- [ ] Retrained 5 days ago, threshold 30 -> `isStale: false`, `daysSinceRetrain: 5`
- [ ] Retrained 45 days ago, threshold 30 -> `isStale: true`, `daysSinceRetrain: 45`
- [ ] `now` parameter allows testing without clock manipulation
- [ ] `tsc --noEmit` passes

---

### T017: Create versioning module barrel and unit tests

**Purpose**: Barrel export and comprehensive unit tests.

**Steps**:
1. Create `src/profiles/versioning/index.ts` barrel export
2. Create `tests/profiles/versioning/manager.test.ts`
3. Create `tests/profiles/versioning/diff.test.ts`
4. Create `tests/profiles/versioning/staleness.test.ts`

**Test cases for manager.test.ts**:
- `createVersion` on profile with no versions -> version 1, currentVersionNumber updated to 1
- `createVersion` on profile with version 2 -> version 3, currentVersionNumber updated to 3
- `createVersion` sets profile status to `'active'` and updates `lastRetrainedAt`
- `pinVersion` replaces existing pin
- `pinVersion` with non-existent version number -> throws error
- `unpinVersion` removes the pin
- `getCurrentVersion` respects pin over currentVersionNumber

**Test cases for diff.test.ts**:
- Identical vectors -> similarity 1.0, zero changes
- Opposite vectors -> similarity near 0
- Known delta and percentChange values verified
- Dimension mismatch -> throws

**Test cases for staleness.test.ts**:
- Never retrained -> stale
- Recent retrain -> not stale
- Old retrain -> stale
- Custom threshold respected

**Files**:
- `src/profiles/versioning/index.ts` (new)
- `tests/profiles/versioning/manager.test.ts` (new, ~100 lines)
- `tests/profiles/versioning/diff.test.ts` (new, ~80 lines)
- `tests/profiles/versioning/staleness.test.ts` (new, ~50 lines)

**Validation**:
- [ ] All unit tests pass
- [ ] `npm run typecheck` exits 0
- [ ] `npm test` exits 0 with no regressions

---

## Definition of Done

- [ ] `src/profiles/versioning/manager.ts` — `ProfileVersionManager` with createVersion, getVersions, getVersion, getCurrentVersion, pinVersion, unpinVersion
- [ ] `src/profiles/versioning/diff.ts` — `computeProfileDiff`, `cosineSimilarity`
- [ ] `src/profiles/versioning/staleness.ts` — `computeStaleness`
- [ ] `src/profiles/versioning/index.ts` — barrel export
- [ ] Unit tests for manager (7+ cases), diff (4+ cases), staleness (4+ cases)
- [ ] Version numbers are monotonically increasing with no gaps under concurrency
- [ ] `npm run typecheck` exits 0
- [ ] `npm test` exits 0 with no regressions

## Risks

- **SELECT FOR UPDATE**: Drizzle ORM's `.for('update')` method may not be available in all versions. Verify the Drizzle version in `package.json` supports it. If not, use a raw SQL query: `db.execute(sql\`SELECT * FROM profiles.profiles WHERE id = ${profileId} FOR UPDATE\`)`.
- **Transaction isolation level**: The default PostgreSQL isolation level (Read Committed) is sufficient for the version number lock pattern. Do not change it to Serializable — that would cause unnecessary serialization failures.
- **Large version history**: Profiles retrained daily for a year would have 365 versions. The `getVersions` query should support pagination for the API layer (WP07). For now, return all versions — pagination is a route-level concern.

## Reviewer Guidance

- Verify `createVersion` runs inside a transaction with `FOR UPDATE` on the profile row.
- Check that `pinVersion` deletes the existing pin before inserting a new one (not upsert, which would need a unique constraint the schema may not have).
- Confirm `computeProfileDiff` handles zero vectors without NaN (denominator check in cosine similarity).
- Verify `computeStaleness` accepts a `now` parameter for testability — never depends on `Date.now()` directly in the computation.
