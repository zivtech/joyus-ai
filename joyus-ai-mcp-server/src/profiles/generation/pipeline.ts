/**
 * Profile Generation — Pipeline Orchestrator
 *
 * Main generation pipeline:
 *   validate → snapshot → advisory-lock → engine → store → log
 *
 * T009: Core orchestration (validate, run, version, store)
 * T010: Concurrent execution guard via pg_try_advisory_xact_lock
 */

import { createId } from '@paralleldrive/cuid2';
import { eq, max, sql } from 'drizzle-orm';

import { db } from '../../db/client.js';
import { ProfileOperationLogger } from '../monitoring/logger.js';
import { ProfileMetrics } from '../monitoring/metrics.js';
import {
  generationRuns,
  tenantProfiles,
  corpusDocuments,
  type CorpusDocument,
  type GenerationRun,
  type TenantProfile,
} from '../schema.js';
import { requireTenantId, tenantWhere } from '../tenant-scope.js';
import type { PipelineResult, ProfileTier } from '../types.js';

import type { CorpusSnapshotService, MaterializedCorpusSnapshot } from './corpus-snapshot.js';
import { EngineNotConfiguredError, type EngineBridge, type EngineOptions } from './engine-bridge.js';

// ============================================================
// TYPES
// ============================================================

export interface PipelineInput {
  /** Fallback corpus path passed to the engine when no snapshot ID is provided. */
  corpusPath: string;
  /** Profile identities to generate, in `{tier}::{name}` format. */
  profileIdentities: string[];
  /** Optional corpus snapshot ID to associate with the run. */
  corpusSnapshotId?: string;
  /** What triggered this run (e.g. 'manual', 'scheduled', 'intake'). */
  trigger: string;
  /** Engine version override. */
  engineVersion?: string;
  /** Force regeneration even when an active profile already exists. */
  forceRegenerate?: boolean;
}

export interface AuthorGenerationMeta {
  profileIdentity: string;
  authorId: string;
  authorName: string;
  tier: ProfileTier;
  lowConfidence: boolean;
}

// ============================================================
// ERRORS
// ============================================================

export class PipelineAlreadyRunningError extends Error {
  constructor(tenantId: string) {
    super(`A profile generation pipeline is already running for this tenant`);
    this.name = 'PipelineAlreadyRunningError';
    // Do not include tenantId in the message (user-facing safety)
    void tenantId;
  }
}

export class EmptyCorpusError extends Error {
  constructor() {
    super('Cannot generate profiles: corpus contains no active documents');
    this.name = 'EmptyCorpusError';
  }
}

// ============================================================
// ADVISORY LOCK HELPERS
// ============================================================

/**
 * Derive a 32-bit integer lock key from a tenantId string.
 * Uses a simple djb2-style hash to spread lock keys uniformly.
 */
function tenantLockKey(tenantId: string): number {
  let hash = 5381;
  for (let i = 0; i < tenantId.length; i++) {
    hash = ((hash << 5) + hash) ^ tenantId.charCodeAt(i);
    hash = hash >>> 0; // keep it 32-bit unsigned
  }
  // pg_try_advisory_xact_lock takes a bigint; we use a fixed class prefix
  return hash;
}

// ============================================================
// PIPELINE ORCHESTRATOR
// ============================================================

export class ProfileGenerationPipeline {
  private readonly logger: ProfileOperationLogger;
  private readonly metrics: ProfileMetrics;

  constructor(
    private readonly engine: EngineBridge,
    private readonly snapshotService: CorpusSnapshotService,
    logger?: ProfileOperationLogger,
    metrics?: ProfileMetrics,
  ) {
    this.logger = logger ?? new ProfileOperationLogger();
    this.metrics = metrics ?? new ProfileMetrics();
  }

  // ----------------------------------------------------------
  // PUBLIC API
  // ----------------------------------------------------------

  /**
   * Run the full profile generation pipeline for a tenant.
   *
   * Steps:
   * 1. requireTenantId
   * 2. Insert generation_runs record (status: pending)
   * 3. Validate corpus (has docs, has authors)
   * 4. Acquire advisory lock (reject if already running)
   * 5. Update run to 'running'
   * 6. For each author: invoke engine, determine next version, insert profile
   * 7. Update run to 'completed' or 'failed'
   * 8. Log to operation_logs
   * 9. Return PipelineResult
   */
  async generate(tenantId: string, input: PipelineInput): Promise<PipelineResult> {
    requireTenantId(tenantId);

    const startMs = Date.now();

    // Step 2: create run record in pending state
    const [run] = await db
      .insert(generationRuns)
      .values({
        id: createId(),
        tenantId,
        corpusSnapshotId: input.corpusSnapshotId ?? null,
        status: 'pending',
        trigger: input.trigger,
        profilesRequested: input.profileIdentities.length,
        profilesCompleted: 0,
        profilesFailed: 0,
        profileIds: [],
      })
      .returning();

    const runId = run.id;

    try {
      // Step 3: validate corpus
      await this.validateCorpus(tenantId, input.corpusSnapshotId);

      // Step 4 + 5: acquire advisory lock inside a transaction, then run generation
      const result = await this.runWithAdvisoryLock(tenantId, async () => {
        // Update run to 'running'
        await db
          .update(generationRuns)
          .set({ status: 'running' })
          .where(tenantWhere(generationRuns, tenantId, eq(generationRuns.id, runId)));

        // Step 6: generate profiles
        const materialized = input.corpusSnapshotId
          ? await this.snapshotService.materializeSnapshot(tenantId, input.corpusSnapshotId)
          : null;

        try {
          return this.generateProfiles(tenantId, runId, {
            ...input,
            corpusPath: materialized?.corpusPath ?? input.corpusPath,
          });
        } finally {
          await this.cleanupMaterializedSnapshot(materialized);
        }
      });

      const durationMs = Date.now() - startMs;
      const status = result.failedCount > 0 ? 'failed' : 'completed';
      const error =
        result.failedCount > 0
          ? `Profile generation failed for ${result.failedCount} of ${input.profileIdentities.length} requested profile(s)`
          : null;

      // Step 7: update run to terminal status
      await db
        .update(generationRuns)
        .set({
          status,
          profilesCompleted: result.profileIds.length,
          profilesFailed: result.failedCount,
          profileIds: result.profileIds,
          error,
          completedAt: new Date(),
          durationMs,
          engineVersion: result.engineVersion ?? null,
        })
        .where(tenantWhere(generationRuns, tenantId, eq(generationRuns.id, runId)));

      // Step 8: log + metrics
      await this.logger.logOperation({
        tenantId,
        operation: 'generate',
        durationMs,
        success: status === 'completed',
        metadata: {
          runId,
          profilesCompleted: result.profileIds.length,
          profilesFailed: result.failedCount,
        },
      });

      this.metrics.recordGeneration(tenantId, durationMs, status === 'completed');

      // Step 9: return result
      return {
        runId,
        status,
        profileIds: result.profileIds,
        durationMs,
        error: error ?? undefined,
      };
    } catch (err) {
      const durationMs = Date.now() - startMs;
      const errorMessage = err instanceof Error ? err.message : String(err);
      const profilesFailed =
        err instanceof EngineNotConfiguredError ? input.profileIdentities.length : 0;

      // Update run to failed (don't include tenant details in error)
      await db
        .update(generationRuns)
        .set({
          status: 'failed',
          profilesCompleted: 0,
          profilesFailed,
          profileIds: [],
          error: errorMessage,
          completedAt: new Date(),
          durationMs,
        })
        .where(tenantWhere(generationRuns, tenantId, eq(generationRuns.id, runId)));

      await this.logger.logOperation({
        tenantId,
        operation: 'generate',
        durationMs,
        success: false,
        metadata: { runId, error: errorMessage, profilesFailed },
      });

      this.metrics.recordGeneration(tenantId, durationMs, false);

      if (err instanceof PipelineAlreadyRunningError) {
        return {
          runId,
          status: 'failed',
          profileIds: [],
          durationMs,
          error: 'A pipeline is already running for this tenant',
        };
      }

      return {
        runId,
        status: 'failed',
        profileIds: [],
        durationMs,
        error: errorMessage,
      };
    }
  }

  /**
   * Fetch the current status of a generation run (tenant-scoped).
   */
  async getRunStatus(tenantId: string, runId: string): Promise<GenerationRun | null> {
    requireTenantId(tenantId);

    const [row] = await db
      .select()
      .from(generationRuns)
      .where(tenantWhere(generationRuns, tenantId, eq(generationRuns.id, runId)))
      .limit(1);

    return row ?? null;
  }

  // ----------------------------------------------------------
  // PRIVATE HELPERS
  // ----------------------------------------------------------

  /**
   * Acquire a PostgreSQL advisory transaction lock scoped to the tenant.
   * Same tenant: second call within the same transaction gets lock=false → throw.
   * Different tenants: independent locks, both proceed.
   * Lock is released automatically on transaction commit or rollback.
   */
  private async runWithAdvisoryLock<T>(
    tenantId: string,
    fn: () => Promise<T>,
  ): Promise<T> {
    const lockKey = tenantLockKey(tenantId);

    return db.transaction(async (tx) => {
      // pg_try_advisory_xact_lock returns boolean
      const lockResult = await tx.execute(
        sql`SELECT pg_try_advisory_xact_lock(${lockKey}::bigint) AS acquired`,
      );

      const rows = lockResult.rows as Array<{ acquired: boolean }>;
      const acquired = rows[0]?.acquired ?? false;

      if (!acquired) {
        throw new PipelineAlreadyRunningError(tenantId);
      }

      return fn();
    });
  }

  /**
   * Core generation loop: for each requested profile identity,
   * invoke the engine, determine the next version number, and insert.
   */
  private async generateProfiles(
    tenantId: string,
    runId: string,
    input: PipelineInput,
  ): Promise<{ profileIds: string[]; failedCount: number; engineVersion?: string }> {
    const profileIds: string[] = [];
    let failedCount = 0;
    let engineVersion: string | undefined;

    // Collect author metadata from each profile identity.
    const authorMetas = await this.resolveAuthorMetas(
      tenantId,
      input.profileIdentities,
      input.corpusSnapshotId,
    );

    const engineOptions: EngineOptions = {};
    if (input.engineVersion) {
      engineOptions.engineVersion = input.engineVersion;
    }

    for (const meta of authorMetas) {
      try {
        const engineResult = await this.engine.generateProfile(
          input.corpusPath,
          meta.authorId,
          engineOptions,
        );

        engineVersion = engineResult.engineVersion;

        // Determine next version: MAX(version)+1 for this tenant+identity
        const [versionRow] = await db
          .select({ maxVersion: max(tenantProfiles.version) })
          .from(tenantProfiles)
          .where(
            tenantWhere(
              tenantProfiles,
              tenantId,
              eq(tenantProfiles.profileIdentity, meta.profileIdentity),
            ),
          );

        const nextVersion = (versionRow?.maxVersion ?? 0) + 1;

        await db
          .update(tenantProfiles)
          .set({ status: 'rolled_back', updatedAt: new Date() })
          .where(
            tenantWhere(
              tenantProfiles,
              tenantId,
              eq(tenantProfiles.profileIdentity, meta.profileIdentity),
              eq(tenantProfiles.status, 'active'),
            ),
          );

        const profileMetadata: Record<string, unknown> = {
          generationRunId: runId,
        };
        if (meta.lowConfidence) {
          profileMetadata['lowConfidence'] = true;
        }

        const [profile] = await db
          .insert(tenantProfiles)
          .values({
            id: createId(),
            tenantId,
            profileIdentity: meta.profileIdentity,
            version: nextVersion,
            authorId: meta.authorId,
            authorName: meta.authorName,
            tier: meta.tier,
            corpusSnapshotId: input.corpusSnapshotId ?? null,
            stylometricFeatures: engineResult.stylometricFeatures,
            markers: engineResult.markers as TenantProfile['markers'],
            fidelityScore: engineResult.fidelityScore ?? null,
            status: 'active',
            metadata: profileMetadata,
          })
          .returning();

        profileIds.push(profile.id);
      } catch (err) {
        if (err instanceof EngineNotConfiguredError) {
          throw err;
        }
        failedCount += 1;
      }
    }

    return { profileIds, failedCount, engineVersion };
  }

  /**
   * Derive author metadata from profile identity strings.
   * Identity format: `{tier}::{name}` e.g. `individual::author-001`
   *
   * Looks up any existing corpus documents for the author name to populate
   * authorId / authorName. Falls back to name-derived values if not found.
   * Marks lowConfidence when only one document is available for the author.
   */
  private async resolveAuthorMetas(
    tenantId: string,
    profileIdentities: string[],
    corpusSnapshotId?: string,
  ): Promise<AuthorGenerationMeta[]> {
    const metas: AuthorGenerationMeta[] = [];
    const docs = await this.fetchGenerationDocuments(tenantId, corpusSnapshotId);

    for (const identity of profileIdentities) {
      const [tierPart, namePart] = identity.split('::');
      const tier = (tierPart ?? 'base') as ProfileTier;
      const name = namePart ?? identity;

      // Filter to documents whose authorId or authorName matches the identity name
      const matching = docs.filter(
        (d) => d.authorId === name || d.authorName === name || d.authorId.includes(name),
      );

      const authorId = matching[0]?.authorId ?? name;
      const authorName = matching[0]?.authorName ?? name;
      const lowConfidence = matching.length <= 1;

      metas.push({ profileIdentity: identity, authorId, authorName, tier, lowConfidence });
    }

    return metas;
  }

  /** Validate that the selected generation corpus has at least one document. */
  private async validateCorpus(tenantId: string, corpusSnapshotId?: string): Promise<void> {
    const docs = await this.fetchGenerationDocuments(tenantId, corpusSnapshotId, 1);

    if (docs.length === 0) {
      throw new EmptyCorpusError();
    }
  }

  private async fetchGenerationDocuments(
    tenantId: string,
    corpusSnapshotId?: string,
    limit?: number,
  ): Promise<CorpusDocument[]> {
    if (corpusSnapshotId) {
      const docs = await this.snapshotService.getSnapshotDocuments(tenantId, corpusSnapshotId);
      return limit === undefined ? docs : docs.slice(0, limit);
    }

    const query = db
      .select()
      .from(corpusDocuments)
      .where(tenantWhere(corpusDocuments, tenantId, eq(corpusDocuments.isActive, true)));

    if (limit !== undefined) {
      return query.limit(limit);
    }

    return query;
  }

  private async cleanupMaterializedSnapshot(
    materialized: MaterializedCorpusSnapshot | null,
  ): Promise<void> {
    if (!materialized) {
      return;
    }

    try {
      await materialized.cleanup();
    } catch {
      // Best-effort cleanup; the generation result should reflect engine behavior.
    }
  }
}
