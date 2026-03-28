---
work_package_id: WP04
title: Batch Ingestion Pipeline
lane: planned
dependencies: [WP03]
subtasks: [T018, T019, T020, T021, T022]
history:
- date: '2026-03-14'
  action: created
  agent: claude-opus
---

# WP04: Batch Ingestion Pipeline

**Implementation command**: `spec-kitty implement WP04 --base WP03`
**Target repo**: `joyus-ai`
**Dependencies**: WP03 (Profile Versioning)
**Priority**: P1 | T019 (processor) is independent and can be written in parallel with T018

## Objective

Build the batch ingestion pipeline for processing large document corpora (up to 1000 documents) for profile creation or retraining. The pipeline uses a PostgreSQL-backed job queue (no external message broker), per-document processing with the ProfileEngineClient, progress tracking, cancellation support, and completion events that trigger version creation.

## Context

Batch ingestion is the primary mechanism for profile training. When a tenant uploads writing samples or the drift-triggered retraining flow fires (WP06), it creates a batch ingestion job. The job:

1. Records all document IDs in `batch_job_documents`
2. Processes documents concurrently (5 at a time by default)
3. Calls `ProfileEngineClient.extractFeatures()` for each document
4. Aggregates features and calls `ProfileEngineClient.trainProfile()` on the batch
5. Creates a new profile version via `ProfileVersionManager.createVersion()`
6. Updates job status and emits a completion event

The job queue is polled, not event-driven. A background interval calls `processNextJob()` every 5 seconds. This is intentionally simple — no Redis, no RabbitMQ, just a PostgreSQL table with status transitions.

**Document ownership validation**: Before processing any document, the batch pipeline must verify that the document's content source belongs to the same tenant as the profile. This prevents a tenant from training a profile on another tenant's documents by passing forged content item IDs.

---

## Subtasks

### T018: Implement batch ingestion job queue (`src/profiles/ingestion/batch.ts`)

**Purpose**: Create and manage batch ingestion jobs using the `batch_jobs` and `batch_job_documents` tables as a queue.

**Steps**:
1. Create `src/profiles/ingestion/batch.ts`
2. Implement `BatchIngestionManager` class
3. Implement `createJob`, `getJob`, `cancelJob`, `processNextJob`, `start`, `stop`

```typescript
// src/profiles/ingestion/batch.ts
import { eq, and, sql } from 'drizzle-orm';
import { createId } from '@paralleldrive/cuid2';
import { profiles, profileBatchJobs, profileBatchJobDocuments } from '../schema.js';
import { ProfileVersionManager } from '../versioning/manager.js';
import { DocumentProcessor } from './processor.js';
import type { BatchIngestionProgress, FeatureVector } from '../types.js';
import { BATCH_CONCURRENCY } from '../types.js';
import type { DrizzleClient } from '../../content/types.js';

export class BatchIngestionManager {
  private intervalId: ReturnType<typeof setInterval> | null = null;

  constructor(
    private readonly db: DrizzleClient,
    private readonly versionManager: ProfileVersionManager,
    private readonly documentProcessor: DocumentProcessor,
  ) {}

  /**
   * Create a new batch ingestion job.
   * Validates document count and inserts job + document records.
   */
  async createJob(params: {
    tenantId: string;
    profileId: string;
    documentIds: string[];
  }): Promise<typeof profileBatchJobs.$inferSelect> {
    const [job] = await this.db
      .insert(profileBatchJobs)
      .values({
        id: createId(),
        tenantId: params.tenantId,
        profileId: params.profileId,
        status: 'pending',
        totalDocuments: params.documentIds.length,
      })
      .returning();

    // Insert document records
    if (params.documentIds.length > 0) {
      await this.db.insert(profileBatchJobDocuments).values(
        params.documentIds.map((docId) => ({
          id: createId(),
          jobId: job.id,
          contentItemId: docId,
          status: 'pending' as const,
        })),
      );
    }

    return job;
  }

  /**
   * Get job details with progress information.
   */
  async getJobProgress(jobId: string): Promise<BatchIngestionProgress | null> {
    const rows = await this.db
      .select()
      .from(profileBatchJobs)
      .where(eq(profileBatchJobs.id, jobId))
      .limit(1);
    const job = rows[0];
    if (!job) return null;

    return {
      jobId: job.id,
      profileId: job.profileId,
      status: job.status,
      totalDocuments: job.totalDocuments,
      processedDocuments: job.processedDocuments,
      failedDocuments: job.failedDocuments,
      percentComplete: job.totalDocuments > 0
        ? Math.round((job.processedDocuments / job.totalDocuments) * 100)
        : 0,
    };
  }

  /**
   * Cancel a pending or running job.
   */
  async cancelJob(jobId: string): Promise<void> {
    await this.db
      .update(profileBatchJobs)
      .set({ status: 'cancelled', cancelledAt: new Date() })
      .where(
        and(
          eq(profileBatchJobs.id, jobId),
          sql`${profileBatchJobs.status} IN ('pending', 'running')`,
        ),
      );
  }

  /**
   * Poll for the next pending job and process it.
   * Uses UPDATE ... RETURNING with a status check to claim the job atomically.
   */
  async processNextJob(): Promise<void> {
    // Atomically claim the next pending job
    const claimed = await this.db
      .update(profileBatchJobs)
      .set({ status: 'running', startedAt: new Date() })
      .where(eq(profileBatchJobs.status, 'pending'))
      .returning();
    // Only process the first claimed job
    const job = claimed[0];
    if (!job) return;

    try {
      await this.executeJob(job);
    } catch (err) {
      await this.db
        .update(profileBatchJobs)
        .set({
          status: 'failed',
          errorMessage: err instanceof Error ? err.message : String(err),
          completedAt: new Date(),
        })
        .where(eq(profileBatchJobs.id, job.id));
    }
  }

  // ... executeJob implementation processes documents, creates version
  // ... start/stop for background polling
}
```

**Files**:
- `src/profiles/ingestion/batch.ts` (new, ~180 lines)

**Validation**:
- [ ] `createJob` inserts job record + document records atomically
- [ ] `cancelJob` only cancels `pending` or `running` jobs (not completed/failed)
- [ ] `processNextJob` atomically claims a job (no double-processing)
- [ ] `tsc --noEmit` passes

**Edge Cases**:
- Empty `documentIds` array: create the job but mark as `completed` immediately with `totalDocuments: 0`.
- Job claiming race: if two workers call `processNextJob` simultaneously, only one gets the `RETURNING` row. The other gets empty result and returns.

---

### T019: Implement single-document processor (`src/profiles/ingestion/processor.ts`)

**Purpose**: Wrap the ProfileEngineClient for per-document feature extraction, including document ownership validation.

**Steps**:
1. Create `src/profiles/ingestion/processor.ts`
2. Implement `DocumentProcessor` class
3. Validate document belongs to the correct tenant before extraction

```typescript
// src/profiles/ingestion/processor.ts
import { eq } from 'drizzle-orm';
import { contentItems, contentSources } from '../../content/schema.js';
import type { ProfileEngineClient } from '../engine/interface.js';
import type { FeatureVector } from '../types.js';
import type { DrizzleClient } from '../../content/types.js';

export class DocumentProcessor {
  constructor(
    private readonly db: DrizzleClient,
    private readonly engineClient: ProfileEngineClient,
  ) {}

  /**
   * Extract features from a single document.
   * Validates that the document belongs to the specified tenant.
   *
   * Returns null if the document is not found or belongs to another tenant.
   */
  async processDocument(
    contentItemId: string,
    tenantId: string,
  ): Promise<{ text: string; features: FeatureVector } | null> {
    // Fetch the document and verify tenant ownership via source
    const [item] = await this.db
      .select({
        id: contentItems.id,
        body: contentItems.body,
        sourceTenantId: contentSources.tenantId,
      })
      .from(contentItems)
      .innerJoin(contentSources, eq(contentItems.sourceId, contentSources.id))
      .where(eq(contentItems.id, contentItemId))
      .limit(1);

    if (!item) return null;
    if (item.sourceTenantId !== tenantId) return null;  // Cross-tenant document
    if (!item.body) return null;  // No text content

    const features = await this.engineClient.extractFeatures([item.body]);
    return { text: item.body, features };
  }
}
```

**Files**:
- `src/profiles/ingestion/processor.ts` (new, ~50 lines)

**Validation**:
- [ ] Document not found -> returns null (not throw)
- [ ] Document belongs to different tenant -> returns null (no error, no feature extraction)
- [ ] Document with no body -> returns null
- [ ] Valid document -> calls `engineClient.extractFeatures` and returns features
- [ ] `tsc --noEmit` passes

---

### T020: Implement progress tracking and cancellation

**Purpose**: Update job progress after each document is processed and check for cancellation between documents.

**Steps**:
1. Add `executeJob` method to `BatchIngestionManager` (in `batch.ts`)
2. Process documents in batches of `BATCH_CONCURRENCY` (5)
3. Update `processedDocuments` / `failedDocuments` after each batch
4. Check cancellation flag between batches

**Files**:
- `src/profiles/ingestion/batch.ts` (modified — add `executeJob` method)

**Validation**:
- [ ] Progress updates are written to DB after each batch of documents
- [ ] Cancellation check between batches — if job status changed to `cancelled`, stop processing
- [ ] Failed documents increment `failedDocuments` counter (not `processedDocuments`)
- [ ] `processedDocuments + failedDocuments <= totalDocuments` at all times

---

### T021: Implement completion event emission with accuracy metrics

**Purpose**: When a batch job completes, aggregate extracted features, train the profile via the engine client, create a new version, and emit a completion event.

**Steps**:
1. Add completion logic to `executeJob` in `batch.ts`
2. Call `ProfileEngineClient.trainProfile()` with all extracted texts
3. Call `ProfileVersionManager.createVersion()` with the trained features
4. Update job with `resultVersionNumber` and `resultAccuracyScore`
5. Emit `profile.training.completed` event (console.log for now; event bus integration in future)

**Files**:
- `src/profiles/ingestion/batch.ts` (modified — add completion logic to `executeJob`)

**Validation**:
- [ ] Successful job creates a new profile version
- [ ] Job record updated with `resultVersionNumber` and `resultAccuracyScore`
- [ ] Job with all documents failed -> job status `failed`, no version created
- [ ] Partial success (some docs failed) -> version created with successful docs only, `failedDocuments` count accurate

---

### T022: Create ingestion module barrel and unit tests

**Purpose**: Barrel export and unit tests.

**Steps**:
1. Create `src/profiles/ingestion/index.ts` barrel export
2. Create `tests/profiles/ingestion/batch.test.ts`

**Test cases**:
- `createJob` with 5 documents -> job created with 5 document records
- `processNextJob` claims and processes a pending job
- `cancelJob` on running job -> status changes to `cancelled`
- `cancelJob` on completed job -> no change
- Progress tracking: processedDocuments increments correctly
- Document ownership validation: cross-tenant doc returns null
- Completion creates new version with correct accuracy

**Files**:
- `src/profiles/ingestion/index.ts` (new)
- `tests/profiles/ingestion/batch.test.ts` (new, ~120 lines)

**Validation**:
- [ ] All unit tests pass
- [ ] `npm run typecheck` exits 0
- [ ] `npm test` exits 0 with no regressions

---

## Definition of Done

- [ ] `src/profiles/ingestion/batch.ts` — `BatchIngestionManager` with createJob, getJobProgress, cancelJob, processNextJob
- [ ] `src/profiles/ingestion/processor.ts` — `DocumentProcessor` with tenant ownership validation
- [ ] `src/profiles/ingestion/index.ts` — barrel export
- [ ] Unit tests (7+ cases) covering job lifecycle, cancellation, progress, and document validation
- [ ] Cross-tenant document access is prevented (document processor returns null for wrong-tenant docs)
- [ ] `npm run typecheck` exits 0
- [ ] `npm test` exits 0 with no regressions

## Risks

- **Job claiming race**: The `UPDATE ... WHERE status = 'pending' RETURNING` pattern works for single-worker polling. If the platform scales to multiple workers, add a `claimed_by` column and `claimed_at` timestamp with a lease timeout.
- **Large batch memory**: 1000 documents with extracted features could use significant memory. Process in sliding windows: extract features for a batch, aggregate incrementally, discard individual features. The profile engine's `trainProfile()` needs all texts, not individual feature vectors.
- **Document fetch N+1**: The processor fetches one document at a time with a tenant ownership join. For large batches, batch the document fetches (fetch 50 at a time) and validate tenant ownership in bulk.

## Reviewer Guidance

- Verify document ownership validation joins through `contentItems -> contentSources` to check `tenantId`. The `contentItems` table does NOT have `tenantId` directly — it inherits it from its source.
- Check that `cancelJob` uses a WHERE clause that only matches `pending` or `running` status. A completed or failed job should not be cancellable.
- Confirm the job processor checks cancellation status between document batches (not between individual documents — that would be too frequent).
- Verify that partial success (some docs fail) still creates a version with the successful documents' features.
