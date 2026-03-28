---
work_package_id: WP06
title: Engine Interface & Drift-Triggered Retraining
lane: planned
dependencies: [WP03]
subtasks: [T027, T028, T029, T030, T031]
history:
- date: '2026-03-14'
  action: created
  agent: claude-opus
---

# WP06: Engine Interface & Drift-Triggered Retraining

**Implementation command**: `spec-kitty implement WP06 --base WP03`
**Target repo**: `joyus-ai`
**Dependencies**: WP03 (Profile Versioning)
**Priority**: P1 | T027-T028 (engine) and T029-T030 (retraining) are independent tracks

## Objective

Define the `ProfileEngineClient` interface that abstracts communication with the Python profile engine, implement the `NullProfileEngineClient` stub for development and testing, build the drift event listener that watches for `profile.drift.exceeded` signals from Spec 005's drift monitoring, and implement the retraining worker that uses PostgreSQL advisory locks to safely create new profile versions on drift.

## Context

The Python profile engine (`joyus-profile-engine`) is a standalone library at `_private/joyus-profile-engine/`. It handles:
- 129-feature stylometric extraction
- Profile training from document corpora
- Similarity comparison between feature vectors

This WP defines the TypeScript interface that the platform uses to communicate with the engine. The actual transport mechanism (subprocess, HTTP, or direct FFI) is not decided yet — the interface abstracts it.

**Drift-triggered retraining flow**:
1. Spec 005's `DriftMonitor` evaluates generation logs and computes drift scores
2. When `overallDriftScore > threshold` for a profile, the drift monitor writes a `contentDriftReports` entry
3. The profile module's drift listener polls for new high-drift reports (or listens for events if Spec 009's event bus is available)
4. The listener enqueues a retraining job for the affected profile
5. The retraining worker acquires a PostgreSQL advisory lock on the profile ID
6. The worker fetches recent documents for the profile's tenant, trains a new version, and releases the lock

**Advisory lock pattern**: `pg_advisory_xact_lock(hashCode)` is used within a transaction. The lock is automatically released when the transaction commits or rolls back. Two concurrent retraining attempts for the same profile: one acquires the lock, the other blocks until the first completes. The second then checks if a newer version was already created and skips if so.

---

## Subtasks

### T027: Implement ProfileEngineClient interface (`src/profiles/engine/interface.ts`)

**Purpose**: Define the contract for communicating with the Python profile engine. All profile training and feature extraction flows through this interface.

**Steps**:
1. Create `src/profiles/engine/interface.ts`
2. Define `ProfileEngineClient` interface with `extractFeatures`, `trainProfile`, `computeSimilarity`
3. Define supporting types

```typescript
// src/profiles/engine/interface.ts
import type { FeatureVector, TrainedProfile } from '../types.js';

/**
 * Interface for communicating with the Python profile engine.
 *
 * Implementations:
 * - NullProfileEngineClient: returns synthetic data for dev/test (shipped in this WP)
 * - SubprocessProfileEngineClient: calls Python engine via subprocess (future)
 * - HttpProfileEngineClient: calls Python engine via HTTP API (future)
 */
export interface ProfileEngineClient {
  /**
   * Extract stylometric features from one or more documents.
   * Each document is a string of text content.
   *
   * Returns a single aggregated feature vector representing the collective
   * style of all provided documents.
   */
  extractFeatures(documents: string[]): Promise<FeatureVector>;

  /**
   * Train a profile from a document corpus.
   * Returns the trained profile with feature vector, accuracy score, and metadata.
   *
   * This is a potentially long-running operation (seconds to minutes for large corpora).
   */
  trainProfile(documents: string[]): Promise<TrainedProfile>;

  /**
   * Compute similarity between two feature vectors.
   * Returns a value between 0.0 (completely different) and 1.0 (identical).
   */
  computeSimilarity(vectorA: FeatureVector, vectorB: FeatureVector): Promise<number>;

  /**
   * Check if the engine is available and responding.
   * Returns true if the engine can accept requests.
   */
  isAvailable(): Promise<boolean>;
}
```

**Files**:
- `src/profiles/engine/interface.ts` (new, ~40 lines)

**Validation**:
- [ ] Interface defines all 4 methods: `extractFeatures`, `trainProfile`, `computeSimilarity`, `isAvailable`
- [ ] `extractFeatures` accepts `string[]` and returns `FeatureVector`
- [ ] `trainProfile` returns `TrainedProfile` (includes accuracy score and duration)
- [ ] `tsc --noEmit` passes

---

### T028: Implement NullProfileEngineClient stub (`src/profiles/engine/null-client.ts`)

**Purpose**: A development/testing stub that returns synthetic feature vectors without calling the real Python engine. Allows the entire profile module to be developed, tested, and shipped before the engine integration is complete.

**Steps**:
1. Create `src/profiles/engine/null-client.ts`
2. Implement `NullProfileEngineClient` that generates deterministic synthetic feature vectors
3. Synthetic vectors should be reproducible (same input documents -> same output) for test stability

```typescript
// src/profiles/engine/null-client.ts
import type { ProfileEngineClient } from './interface.js';
import type { FeatureVector, TrainedProfile } from '../types.js';
import { FEATURE_VECTOR_DIMENSION } from '../types.js';
import { cosineSimilarity } from '../versioning/diff.js';

/**
 * Stub implementation that returns synthetic feature vectors.
 * Used for development, testing, and environments where the Python engine
 * is not available.
 *
 * WARNING: This client produces SYNTHETIC data that does not represent
 * real stylometric features. Do not use in production.
 */
export class NullProfileEngineClient implements ProfileEngineClient {
  async extractFeatures(documents: string[]): Promise<FeatureVector> {
    console.warn('[NullProfileEngineClient] Returning synthetic feature vector.');

    // Generate a deterministic synthetic vector based on document content
    const features = new Array(FEATURE_VECTOR_DIMENSION).fill(0).map((_, i) => {
      // Use a simple hash of the concatenated document text for determinism
      const text = documents.join(' ');
      const charSum = text.split('').reduce((sum, ch) => sum + ch.charCodeAt(0), 0);
      return Math.sin(charSum * (i + 1) * 0.001) * 0.5 + 0.5;  // [0, 1] range
    });

    const featureNames = new Array(FEATURE_VECTOR_DIMENSION).fill(0).map((_, i) =>
      `synthetic_feature_${i.toString().padStart(3, '0')}`,
    );

    return {
      features,
      featureNames,
      extractionMetadata: {
        engineVersion: 'null-client-1.0',
        documentCount: documents.length,
        totalCharacters: documents.reduce((sum, d) => sum + d.length, 0),
        isSynthetic: true,
      },
    };
  }

  async trainProfile(documents: string[]): Promise<TrainedProfile> {
    console.warn('[NullProfileEngineClient] Returning synthetic trained profile.');

    const startTime = Date.now();
    const featureVector = await this.extractFeatures(documents);
    const durationMs = Date.now() - startTime;

    return {
      featureVector,
      accuracyScore: 0.85 + Math.random() * 0.14,  // 0.85-0.99 range for realistic stub
      trainingDurationMs: durationMs + 100,  // Add fake training time
      corpusSize: documents.length,
    };
  }

  async computeSimilarity(vectorA: FeatureVector, vectorB: FeatureVector): Promise<number> {
    return cosineSimilarity(vectorA.features, vectorB.features);
  }

  async isAvailable(): Promise<boolean> {
    return true;  // Always available
  }
}
```

**Files**:
- `src/profiles/engine/null-client.ts` (new, ~60 lines)

**Validation**:
- [ ] Same input documents produce the same synthetic feature vector (deterministic)
- [ ] Feature vector has exactly `FEATURE_VECTOR_DIMENSION` (129) features
- [ ] `trainProfile` returns accuracy between 0.85 and 0.99
- [ ] `computeSimilarity` delegates to `cosineSimilarity` from the diff module
- [ ] `isAvailable` always returns `true`
- [ ] `tsc --noEmit` passes

**Edge Cases**:
- Empty documents array: `extractFeatures([])` should return a zero vector (all features 0) with metadata indicating 0 documents.
- Very large documents: the synthetic hash is based on character sum, which may overflow for extremely large texts. This is acceptable for a stub — it produces different but still deterministic output.

---

### T029: Implement drift event listener (`src/profiles/retraining/listener.ts`)

**Purpose**: Watch for high-drift signals from Spec 005's drift monitoring and trigger retraining for affected profiles.

**Steps**:
1. Create `src/profiles/retraining/listener.ts`
2. Implement `DriftRetrainingListener` class
3. Poll `contentDriftReports` for reports with `overallDriftScore > threshold` that haven't triggered retraining yet
4. Check `profileDriftConfigs` for auto-retrain settings and frequency limits

```typescript
// src/profiles/retraining/listener.ts
import { and, eq, gte, desc, isNull } from 'drizzle-orm';
import { contentDriftReports } from '../../content/schema.js';
import { profiles, profileDriftConfigs, profileBatchJobs } from '../schema.js';
import { DEFAULT_DRIFT_THRESHOLD } from '../types.js';
import type { DrizzleClient } from '../../content/types.js';

export class DriftRetrainingListener {
  private intervalId: ReturnType<typeof setInterval> | null = null;

  constructor(
    private readonly db: DrizzleClient,
    private readonly onDriftDetected: (params: {
      profileId: string;
      tenantId: string;
      driftScore: number;
      reportId: string;
    }) => Promise<void>,
  ) {}

  /**
   * Check for new high-drift reports and trigger retraining.
   */
  async checkForDriftEvents(): Promise<void> {
    // Find profiles with high drift that haven't been retrained recently
    const recentReports = await this.db
      .select({
        reportId: contentDriftReports.id,
        tenantId: contentDriftReports.tenantId,
        profileId: contentDriftReports.profileId,
        driftScore: contentDriftReports.overallDriftScore,
        reportCreatedAt: contentDriftReports.createdAt,
      })
      .from(contentDriftReports)
      .where(
        gte(contentDriftReports.overallDriftScore, DEFAULT_DRIFT_THRESHOLD),
      )
      .orderBy(desc(contentDriftReports.createdAt))
      .limit(50);

    for (const report of recentReports) {
      // Check drift config for this profile
      const [config] = await this.db
        .select()
        .from(profileDriftConfigs)
        .where(eq(profileDriftConfigs.profileId, report.profileId))
        .limit(1);

      // Skip if auto-retrain is disabled
      if (config && !config.autoRetrain) continue;

      // Check threshold (per-profile config overrides default)
      const threshold = config?.driftThreshold ?? DEFAULT_DRIFT_THRESHOLD;
      if (report.driftScore < threshold) continue;

      // Check frequency limit — don't retrain more often than maxRetrainFrequencyHours
      if (config?.lastDriftEventAt) {
        const hoursSinceLastEvent =
          (Date.now() - config.lastDriftEventAt.getTime()) / (1000 * 60 * 60);
        const maxFrequency = config.maxRetrainFrequencyHours ?? 24;
        if (hoursSinceLastEvent < maxFrequency) continue;
      }

      // Check if there's already a pending/running batch job for this profile
      const [existingJob] = await this.db
        .select()
        .from(profileBatchJobs)
        .where(
          and(
            eq(profileBatchJobs.profileId, report.profileId),
            eq(profileBatchJobs.status, 'pending'),
          ),
        )
        .limit(1);
      if (existingJob) continue;

      // Trigger retraining
      await this.onDriftDetected({
        profileId: report.profileId,
        tenantId: report.tenantId,
        driftScore: report.driftScore,
        reportId: report.reportId,
      });

      // Update last drift event timestamp
      if (config) {
        await this.db
          .update(profileDriftConfigs)
          .set({ lastDriftEventAt: new Date(), updatedAt: new Date() })
          .where(eq(profileDriftConfigs.id, config.id));
      }
    }
  }

  /**
   * Start polling for drift events.
   */
  start(intervalMinutes = 5): void {
    if (this.intervalId) return;
    this.intervalId = setInterval(() => {
      this.checkForDriftEvents().catch((err) => {
        console.error('[drift-retrain-listener] Check failed:', err);
      });
    }, intervalMinutes * 60 * 1000);
    console.log(`[drift-retrain-listener] Started (interval: ${intervalMinutes}m)`);
  }

  stop(): void {
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
      console.log('[drift-retrain-listener] Stopped');
    }
  }
}
```

**Files**:
- `src/profiles/retraining/listener.ts` (new, ~100 lines)

**Validation**:
- [ ] Only triggers retraining if `overallDriftScore >= threshold`
- [ ] Respects per-profile `autoRetrain` setting (skips if false)
- [ ] Respects `maxRetrainFrequencyHours` (skips if too recent)
- [ ] Skips profiles with existing pending batch jobs (no double-enqueue)
- [ ] Updates `lastDriftEventAt` after triggering retraining
- [ ] `tsc --noEmit` passes

**Edge Cases**:
- No `profileDriftConfigs` entry for a profile: use default threshold (0.7), default frequency (24h), and auto-retrain = true.
- Multiple drift reports for the same profile in one check cycle: the frequency limit prevents multiple retraining triggers.
- Content drift reports from archived profiles: the listener should check `profiles.status !== 'archived'` before triggering.

---

### T030: Implement retraining worker with advisory locks (`src/profiles/retraining/worker.ts`)

**Purpose**: Execute the actual retraining: acquire an advisory lock on the profile, fetch recent documents, train a new version via the profile engine, and create the version record.

**Steps**:
1. Create `src/profiles/retraining/worker.ts`
2. Implement `RetrainingWorker` class
3. Use `pg_advisory_xact_lock` within a transaction to prevent concurrent retraining

```typescript
// src/profiles/retraining/worker.ts
import { eq, and, desc, sql } from 'drizzle-orm';
import { profiles } from '../schema.js';
import { contentItems, contentSources } from '../../content/schema.js';
import { ProfileVersionManager } from '../versioning/manager.js';
import { BatchIngestionManager } from '../ingestion/batch.js';
import type { ProfileEngineClient } from '../engine/interface.js';
import type { DrizzleClient } from '../../content/types.js';

export class RetrainingWorker {
  constructor(
    private readonly db: DrizzleClient,
    private readonly versionManager: ProfileVersionManager,
    private readonly batchManager: BatchIngestionManager,
    private readonly engineClient: ProfileEngineClient,
  ) {}

  /**
   * Retrain a profile by creating a batch ingestion job with the latest documents.
   *
   * Uses pg_advisory_xact_lock to prevent concurrent retraining of the same profile.
   * If another retraining is in progress, this call blocks until it completes,
   * then checks if a newer version was already created and skips if so.
   */
  async retrain(params: {
    profileId: string;
    tenantId: string;
    triggeredBy: 'drift' | 'manual';
    driftReportId?: string;
  }): Promise<{ skipped: boolean; reason?: string; jobId?: string }> {
    // Use a hash of the profileId as the advisory lock key
    const lockKey = this.hashProfileId(params.profileId);

    return this.db.transaction(async (tx) => {
      // Acquire advisory lock — blocks if another retraining is in progress
      await tx.execute(sql`SELECT pg_advisory_xact_lock(${lockKey})`);

      // Check if the profile still needs retraining
      const [profile] = await tx
        .select()
        .from(profiles)
        .where(eq(profiles.id, params.profileId))
        .limit(1);

      if (!profile) {
        return { skipped: true, reason: 'profile_not_found' };
      }

      if (profile.status === 'archived') {
        return { skipped: true, reason: 'profile_archived' };
      }

      // Fetch recent documents for this tenant's content sources
      const recentDocs = await tx
        .select({ id: contentItems.id })
        .from(contentItems)
        .innerJoin(contentSources, eq(contentItems.sourceId, contentSources.id))
        .where(eq(contentSources.tenantId, params.tenantId))
        .orderBy(desc(contentItems.updatedAt))
        .limit(100);

      if (recentDocs.length === 0) {
        return { skipped: true, reason: 'no_documents_available' };
      }

      // Create batch ingestion job (outside the advisory lock transaction
      // since batch processing is long-running)
      const documentIds = recentDocs.map((d) => d.id);

      // We create the job here but it will be processed by the BatchIngestionManager's
      // background poll loop. The advisory lock is released when this transaction commits.
      const job = await this.batchManager.createJob({
        tenantId: params.tenantId,
        profileId: params.profileId,
        documentIds,
      });

      return { skipped: false, jobId: job.id };
    });
  }

  /**
   * Convert a CUID string to a stable integer for use as advisory lock key.
   * Uses a simple hash that produces a 32-bit integer.
   */
  private hashProfileId(profileId: string): number {
    let hash = 0;
    for (let i = 0; i < profileId.length; i++) {
      const char = profileId.charCodeAt(i);
      hash = ((hash << 5) - hash) + char;
      hash |= 0;  // Convert to 32-bit integer
    }
    return Math.abs(hash);
  }
}
```

**Files**:
- `src/profiles/retraining/worker.ts` (new, ~80 lines)

**Validation**:
- [ ] Advisory lock prevents concurrent retraining of the same profile
- [ ] Archived profiles are skipped
- [ ] Profiles with no available documents are skipped
- [ ] Creates a batch ingestion job with recent document IDs
- [ ] `hashProfileId` produces a consistent 32-bit integer from a CUID
- [ ] `tsc --noEmit` passes

**Edge Cases**:
- Advisory lock hash collisions: two different profile IDs could hash to the same 32-bit integer. This is practically negligible (1 in ~4 billion) but would cause unnecessary serialization. Acceptable for this use case.
- Transaction timeout: if the advisory lock blocks for too long (another retraining is very slow), the transaction may time out. Set a reasonable statement timeout (60 seconds) in the transaction options.

---

### T031: Create engine and retraining module barrels and unit tests

**Purpose**: Barrel exports for both modules and unit tests.

**Steps**:
1. Create `src/profiles/engine/index.ts` barrel export
2. Create `src/profiles/retraining/index.ts` barrel export
3. Create `tests/profiles/retraining/listener.test.ts`
4. Create `tests/profiles/engine/null-client.test.ts`

**Test cases for null-client.test.ts**:
- `extractFeatures` returns vector with 129 features
- Same documents produce same vector (deterministic)
- `trainProfile` returns accuracy in valid range
- `computeSimilarity` of identical vectors returns ~1.0
- `isAvailable` returns true

**Test cases for listener.test.ts**:
- High drift report triggers retraining callback
- Drift below threshold -> no trigger
- `autoRetrain: false` -> no trigger
- Frequency limit respected -> no trigger if too recent
- Existing pending job -> no trigger (no double-enqueue)

**Files**:
- `src/profiles/engine/index.ts` (new)
- `src/profiles/retraining/index.ts` (new)
- `tests/profiles/engine/null-client.test.ts` (new, ~60 lines)
- `tests/profiles/retraining/listener.test.ts` (new, ~80 lines)

**Validation**:
- [ ] All unit tests pass
- [ ] `npm run typecheck` exits 0
- [ ] `npm test` exits 0 with no regressions

---

## Definition of Done

- [ ] `src/profiles/engine/interface.ts` — `ProfileEngineClient` interface (4 methods)
- [ ] `src/profiles/engine/null-client.ts` — `NullProfileEngineClient` with synthetic vectors
- [ ] `src/profiles/engine/index.ts` — barrel export
- [ ] `src/profiles/retraining/listener.ts` — `DriftRetrainingListener` with polling and frequency limits
- [ ] `src/profiles/retraining/worker.ts` — `RetrainingWorker` with advisory locks
- [ ] `src/profiles/retraining/index.ts` — barrel export
- [ ] Unit tests for null client (5+ cases) and listener (5+ cases)
- [ ] `npm run typecheck` exits 0
- [ ] `npm test` exits 0 with no regressions

## Risks

- **Advisory lock key collision**: Two CUIDs hashing to the same 32-bit integer. Extremely unlikely but theoretically possible. If this becomes a concern, use `pg_advisory_xact_lock(bigint)` with a 64-bit hash.
- **Drift report staleness**: The listener polls `contentDriftReports` which may contain old reports. Add a time filter to only consider reports from the last 24 hours.
- **Engine unavailability**: If the Python engine is not available, `NullProfileEngineClient` produces synthetic results. The system continues to function but profile quality is fake. Add a startup warning when `NullProfileEngineClient` is in use in non-test environments.
- **Circular dependency**: `RetrainingWorker` depends on `BatchIngestionManager` (WP04) which depends on `ProfileVersionManager` (WP03). Ensure these are wired via constructor injection, not module-level imports that could create cycles.

## Reviewer Guidance

- Verify `ProfileEngineClient` is an interface (not an abstract class). All implementations use composition, not inheritance.
- Check that `NullProfileEngineClient.extractFeatures` is deterministic — same input produces same output. Random elements (like in `trainProfile.accuracyScore`) must be acceptable for their use case (accuracy is informational, not functional).
- Confirm the drift listener checks `autoRetrain` and `maxRetrainFrequencyHours` BEFORE triggering retraining. These are tenant-configurable safety limits.
- Verify `pg_advisory_xact_lock` is used (transaction-scoped), NOT `pg_advisory_lock` (session-scoped). Session-scoped locks persist beyond the transaction and can cause deadlocks.
