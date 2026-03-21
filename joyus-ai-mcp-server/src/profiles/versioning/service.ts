/**
 * Profile Versioning — Version Creation and Lifecycle Service
 *
 * T012: Version creation (createVersion, getActiveVersion, getVersion)
 * T013: Atomic rollback
 * T015: Retention policy enforcement
 *
 * Invariant: exactly ONE active version per (tenantId, profileIdentity) at
 * any given time. All state transitions happen inside a single DB transaction.
 */

import { and, eq, lt, max, sql } from 'drizzle-orm';
import { createId } from '@paralleldrive/cuid2';

import { db } from '../../db/client.js';
import { tenantProfiles, type TenantProfile, type NewTenantProfile } from '../schema.js';
import { requireTenantId, tenantWhere } from '../tenant-scope.js';
import { ProfileOperationLogger } from '../monitoring/logger.js';

// ============================================================
// TYPES
// ============================================================

export interface CreateVersionParams {
  profileIdentity: string;
  authorId: string;
  authorName: string;
  tier: TenantProfile['tier'];
  stylometricFeatures: Record<string, number>;
  markers: TenantProfile['markers'];
  fidelityScore?: number;
  parentProfileId?: string;
  corpusSnapshotId?: string;
  metadata?: Record<string, unknown>;
}

export interface RetentionResult {
  archived: number;
  deleted: number;
}

// ============================================================
// ERRORS
// ============================================================

export class ProfileNotFoundError extends Error {
  constructor(profileIdentity: string, version?: number) {
    const detail = version !== undefined
      ? `version ${version} of "${profileIdentity}"`
      : `"${profileIdentity}"`;
    super(`Profile not found: ${detail}`);
    this.name = 'ProfileNotFoundError';
  }
}

export class RollbackError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'RollbackError';
  }
}

// ============================================================
// SERVICE
// ============================================================

export class ProfileVersionService {
  private readonly logger: ProfileOperationLogger;

  constructor(logger?: ProfileOperationLogger) {
    this.logger = logger ?? new ProfileOperationLogger();
  }

  // ----------------------------------------------------------
  // T012: Version creation
  // ----------------------------------------------------------

  /**
   * Create a new immutable profile version inside a transaction.
   *
   * Steps:
   * 1. requireTenantId
   * 2. MAX(version) for (tenantId, profileIdentity) → next = max + 1
   * 3. If an active version exists → set to rolled_back
   * 4. Insert new row with status=active
   * 5. Log + return
   */
  async createVersion(
    tenantId: string,
    params: CreateVersionParams,
  ): Promise<TenantProfile> {
    requireTenantId(tenantId);

    const startMs = Date.now();

    const profile = await db.transaction(async (tx) => {
      // Step 2: determine next version number
      const [versionRow] = await tx
        .select({ maxVersion: max(tenantProfiles.version) })
        .from(tenantProfiles)
        .where(
          tenantWhere(
            tenantProfiles,
            tenantId,
            eq(tenantProfiles.profileIdentity, params.profileIdentity),
          ),
        );

      const nextVersion = (versionRow?.maxVersion ?? 0) + 1;

      // Step 3: deactivate any existing active version
      await tx
        .update(tenantProfiles)
        .set({ status: 'rolled_back', updatedAt: new Date() })
        .where(
          tenantWhere(
            tenantProfiles,
            tenantId,
            and(
              eq(tenantProfiles.profileIdentity, params.profileIdentity),
              eq(tenantProfiles.status, 'active'),
            ) as ReturnType<typeof eq>,
          ),
        );

      // Step 4: insert new active version
      const newProfile: NewTenantProfile = {
        id: createId(),
        tenantId,
        profileIdentity: params.profileIdentity,
        version: nextVersion,
        authorId: params.authorId,
        authorName: params.authorName,
        tier: params.tier,
        stylometricFeatures: params.stylometricFeatures,
        markers: params.markers,
        fidelityScore: params.fidelityScore ?? null,
        status: 'active',
        parentProfileId: params.parentProfileId ?? null,
        corpusSnapshotId: params.corpusSnapshotId ?? null,
        metadata: params.metadata ?? {},
      };

      const [created] = await tx
        .insert(tenantProfiles)
        .values(newProfile)
        .returning();

      return created;
    });

    // Step 5: log
    await this.logger.logOperation({
      tenantId,
      operation: 'generate',
      profileIdentity: params.profileIdentity,
      durationMs: Date.now() - startMs,
      success: true,
      metadata: { version: profile.version },
    });

    return profile;
  }

  /**
   * Fetch the single active version for a (tenantId, profileIdentity) pair.
   * Returns null when no active version exists.
   */
  async getActiveVersion(
    tenantId: string,
    profileIdentity: string,
  ): Promise<TenantProfile | null> {
    requireTenantId(tenantId);

    const [row] = await db
      .select()
      .from(tenantProfiles)
      .where(
        tenantWhere(
          tenantProfiles,
          tenantId,
          and(
            eq(tenantProfiles.profileIdentity, profileIdentity),
            eq(tenantProfiles.status, 'active'),
          ) as ReturnType<typeof eq>,
        ),
      )
      .limit(1);

    return row ?? null;
  }

  /**
   * Fetch an exact (tenantId, profileIdentity, version) row.
   * Returns null when not found.
   */
  async getVersion(
    tenantId: string,
    profileIdentity: string,
    version: number,
  ): Promise<TenantProfile | null> {
    requireTenantId(tenantId);

    const [row] = await db
      .select()
      .from(tenantProfiles)
      .where(
        tenantWhere(
          tenantProfiles,
          tenantId,
          and(
            eq(tenantProfiles.profileIdentity, profileIdentity),
            eq(tenantProfiles.version, version),
          ) as ReturnType<typeof eq>,
        ),
      )
      .limit(1);

    return row ?? null;
  }

  // ----------------------------------------------------------
  // T013: Atomic rollback
  // ----------------------------------------------------------

  /**
   * Roll back to a previous version in a single transaction.
   *
   * Eligibility: target must be `rolled_back` or `archived`.
   * Errors if target is already active, deleted, or not found.
   *
   * On success:
   *   - current active → rolled_back
   *   - target → active
   */
  async rollback(
    tenantId: string,
    profileIdentity: string,
    targetVersion: number,
  ): Promise<TenantProfile> {
    requireTenantId(tenantId);

    const startMs = Date.now();

    let fromVersion: number | undefined;

    const restored = await db.transaction(async (tx) => {
      // Fetch the target version
      const [target] = await tx
        .select()
        .from(tenantProfiles)
        .where(
          tenantWhere(
            tenantProfiles,
            tenantId,
            and(
              eq(tenantProfiles.profileIdentity, profileIdentity),
              eq(tenantProfiles.version, targetVersion),
            ) as ReturnType<typeof eq>,
          ),
        )
        .limit(1);

      if (!target) {
        throw new ProfileNotFoundError(profileIdentity, targetVersion);
      }

      if (target.status === 'active') {
        throw new RollbackError(
          `Version ${targetVersion} of "${profileIdentity}" is already active`,
        );
      }

      if (target.status === 'deleted') {
        throw new RollbackError(
          `Version ${targetVersion} of "${profileIdentity}" has been deleted and cannot be restored`,
        );
      }

      if (target.status !== 'rolled_back' && target.status !== 'archived') {
        throw new RollbackError(
          `Version ${targetVersion} of "${profileIdentity}" has status "${target.status}" and is not eligible for rollback`,
        );
      }

      // Find and deactivate the current active version
      const [currentActive] = await tx
        .select({ id: tenantProfiles.id, version: tenantProfiles.version })
        .from(tenantProfiles)
        .where(
          tenantWhere(
            tenantProfiles,
            tenantId,
            and(
              eq(tenantProfiles.profileIdentity, profileIdentity),
              eq(tenantProfiles.status, 'active'),
            ) as ReturnType<typeof eq>,
          ),
        )
        .limit(1);

      if (currentActive) {
        fromVersion = currentActive.version;
        await tx
          .update(tenantProfiles)
          .set({ status: 'rolled_back', updatedAt: new Date() })
          .where(
            tenantWhere(
              tenantProfiles,
              tenantId,
              eq(tenantProfiles.id, currentActive.id),
            ),
          );
      }

      // Promote target version to active
      const [updated] = await tx
        .update(tenantProfiles)
        .set({ status: 'active', updatedAt: new Date() })
        .where(
          tenantWhere(
            tenantProfiles,
            tenantId,
            eq(tenantProfiles.id, target.id),
          ),
        )
        .returning();

      return updated;
    });

    // Log the rollback
    await this.logger.logOperation({
      tenantId,
      operation: 'rollback',
      profileIdentity,
      durationMs: Date.now() - startMs,
      success: true,
      metadata: {
        fromVersion: fromVersion ?? null,
        toVersion: targetVersion,
      },
    });

    return restored;
  }

  // ----------------------------------------------------------
  // T015: Retention policy
  // ----------------------------------------------------------

  /**
   * Enforce the retention policy for a tenant.
   *
   * Phase 1: rolled_back versions older than `retentionDays` → archived
   *          (archivedAt set to now)
   * Phase 2: archived versions whose archivedAt is older than 30 days → deleted
   *
   * Active versions are NEVER touched regardless of age.
   *
   * Returns counts of rows changed in each phase.
   */
  async enforceRetention(
    tenantId: string,
    retentionDays = 90,
  ): Promise<RetentionResult> {
    requireTenantId(tenantId);

    const startMs = Date.now();
    const now = new Date();
    const retentionCutoff = new Date(now.getTime() - retentionDays * 24 * 60 * 60 * 1000);
    const graceCutoff = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);

    // Phase 1: rolled_back → archived (older than retentionDays)
    const phase1 = await db
      .update(tenantProfiles)
      .set({ status: 'archived', archivedAt: now, updatedAt: now })
      .where(
        tenantWhere(
          tenantProfiles,
          tenantId,
          and(
            eq(tenantProfiles.status, 'rolled_back'),
            lt(tenantProfiles.createdAt, retentionCutoff),
          ) as ReturnType<typeof eq>,
        ),
      )
      .returning({ id: tenantProfiles.id });

    // Phase 2: archived → deleted (archivedAt older than 30 days)
    // Only rows that have an archivedAt set (were previously archived or just archived)
    const phase2 = await db
      .update(tenantProfiles)
      .set({ status: 'deleted', updatedAt: now })
      .where(
        and(
          eq(tenantProfiles.tenantId, tenantId),
          eq(tenantProfiles.status, 'archived'),
          sql`${tenantProfiles.archivedAt} IS NOT NULL`,
          lt(tenantProfiles.archivedAt as Parameters<typeof lt>[0], graceCutoff),
        ) as ReturnType<typeof eq>,
      )
      .returning({ id: tenantProfiles.id });

    const result: RetentionResult = {
      archived: phase1.length,
      deleted: phase2.length,
    };

    await this.logger.logOperation({
      tenantId,
      operation: 'retention_apply',
      durationMs: Date.now() - startMs,
      success: true,
      metadata: { archived: result.archived, deleted: result.deleted },
    });

    return result;
  }
}
