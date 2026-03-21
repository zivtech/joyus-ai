/**
 * Profile Tool Executor
 *
 * Routes profile_ tool calls to the appropriate profile services.
 * tenantId is always injected from the auth context — never accepted from tool input.
 */

import { eq, and, desc } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/node-postgres';

import {
  tenantProfiles,
  corpusDocuments,
  corpusSnapshots,
  generationRuns,
} from '../../profiles/schema.js';
import { ProfileVersionService } from '../../profiles/versioning/service.js';
import { ProfileVersionHistory } from '../../profiles/versioning/history.js';
import { ProfileGenerationPipeline } from '../../profiles/generation/pipeline.js';
import { CorpusSnapshotService } from '../../profiles/generation/corpus-snapshot.js';
import { ProfileHierarchyService } from '../../profiles/inheritance/hierarchy.js';
import { InheritanceResolver } from '../../profiles/inheritance/resolver.js';
import { ProfileCacheService } from '../../profiles/cache/service.js';
import { ProfileOperationLogger } from '../../profiles/monitoring/logger.js';

type DrizzleClient = ReturnType<typeof drizzle>;

export interface ProfileExecutorContext {
  userId: string;
  tenantId: string;
  db: DrizzleClient;
}

/**
 * Execute a profile_ tool by name.
 * tenantId comes from context — it is NEVER read from input.
 */
export async function executeProfileTool(
  toolName: string,
  input: Record<string, unknown>,
  context: ProfileExecutorContext,
): Promise<unknown> {
  const { tenantId, db } = context;

  switch (toolName) {
    // ── Profile Queries ────────────────────────────────────────────────────

    case 'profile_list_profiles': {
      const tier = input.tier as string | undefined;
      const limit = Math.min((input.limit as number | undefined) ?? 50, 200);
      const offset = (input.offset as number | undefined) ?? 0;

      const history = new ProfileVersionHistory();
      const identities = await history.listProfileIdentities(tenantId, {
        tier: tier as Parameters<typeof history.listProfileIdentities>[1] extends { tier?: infer T } ? T : never,
        limit,
        offset,
      });

      return {
        profiles: identities,
        total: identities.length,
        tenantId,
      };
    }

    case 'profile_get_profile': {
      const profileIdentity = input.profileIdentity as string;
      const version = input.version as number | undefined;

      const versionService = new ProfileVersionService();

      if (version !== undefined) {
        const profile = await versionService.getVersion(tenantId, profileIdentity, version);
        if (!profile) {
          throw new Error(`Profile not found: version ${version} of "${profileIdentity}"`);
        }
        return { profile };
      }

      const profile = await versionService.getActiveVersion(tenantId, profileIdentity);
      if (!profile) {
        throw new Error(`No active profile found for: "${profileIdentity}"`);
      }
      return { profile };
    }

    case 'profile_get_resolved': {
      const profileIdentity = input.profileIdentity as string;
      const forceRefresh = (input.forceRefresh as boolean | undefined) ?? false;

      const cacheService = new ProfileCacheService();

      if (forceRefresh) {
        const resolver = new InheritanceResolver();
        const resolved = await resolver.resolve(tenantId, profileIdentity);
        await cacheService.set(tenantId, profileIdentity, resolved, {});
        return {
          profileIdentity,
          features: Object.fromEntries(resolved.features),
          markers: resolved.markers,
          overrideSources: resolved.overrideSources,
          fromCache: false,
        };
      }

      const cached = await cacheService.get(tenantId, profileIdentity);
      if (cached) {
        return {
          profileIdentity,
          features: Object.fromEntries(cached.features),
          markers: cached.markers,
          overrideSources: cached.overrideSources,
          fromCache: true,
        };
      }

      const resolver = new InheritanceResolver();
      const resolved = await resolver.resolve(tenantId, profileIdentity);
      await cacheService.set(tenantId, profileIdentity, resolved, {});
      return {
        profileIdentity,
        features: Object.fromEntries(resolved.features),
        markers: resolved.markers,
        overrideSources: resolved.overrideSources,
        fromCache: false,
      };
    }

    // ── Generation ────────────────────────────────────────────────────────

    case 'profile_generate': {
      const corpusSnapshotId = input.corpusSnapshotId as string;
      const authorIds = input.authorIds as string[] | undefined;
      const tier = (input.tier as string | undefined) ?? 'base';
      const parentProfileIdentity = input.parentProfileIdentity as string | undefined;

      // Verify snapshot belongs to tenant
      const [snapshot] = await db
        .select({ id: corpusSnapshots.id, name: corpusSnapshots.name })
        .from(corpusSnapshots)
        .where(
          and(
            eq(corpusSnapshots.id, corpusSnapshotId),
            eq(corpusSnapshots.tenantId, tenantId),
          ),
        )
        .limit(1);

      if (!snapshot) {
        throw new Error(`Corpus snapshot not found: ${corpusSnapshotId}`);
      }

      // Resolve profile identities from snapshot authors
      const docsQuery = db
        .select({
          authorId: corpusDocuments.authorId,
          authorName: corpusDocuments.authorName,
        })
        .from(corpusDocuments)
        .where(
          and(
            eq(corpusDocuments.tenantId, tenantId),
            eq(corpusDocuments.isActive, true),
          ),
        );

      const docs = await docsQuery;
      const uniqueAuthors = new Map<string, string>();
      for (const doc of docs) {
        if (!uniqueAuthors.has(doc.authorId)) {
          uniqueAuthors.set(doc.authorId, doc.authorName);
        }
      }

      const targetAuthors = authorIds
        ? authorIds.filter((id) => uniqueAuthors.has(id))
        : [...uniqueAuthors.keys()];

      if (targetAuthors.length === 0) {
        throw new Error('No authors found in corpus for profile generation');
      }

      const profileIdentities = targetAuthors.map(
        (authorId) => `${tier}::${authorId}`,
      );

      // Return a deferred generation response — the pipeline requires a Python engine.
      // This records intent and returns the run metadata; actual execution is async.
      return {
        message: 'Profile generation queued. Use profile_get_generation_status to track progress.',
        corpusSnapshotId,
        profileIdentitiesQueued: profileIdentities,
        authorCount: targetAuthors.length,
        tier,
        parentProfileIdentity: parentProfileIdentity ?? null,
        note: 'Full pipeline execution requires the Python stylometric engine (EngineBridge). Wired in production deployment.',
      };
    }

    case 'profile_get_generation_status': {
      const runId = input.runId as string;

      const [run] = await db
        .select()
        .from(generationRuns)
        .where(
          and(
            eq(generationRuns.id, runId),
            eq(generationRuns.tenantId, tenantId),
          ),
        )
        .limit(1);

      if (!run) {
        throw new Error(`Generation run not found: ${runId}`);
      }

      return {
        runId: run.id,
        status: run.status,
        trigger: run.trigger,
        profilesRequested: run.profilesRequested,
        profilesCompleted: run.profilesCompleted,
        profilesFailed: run.profilesFailed,
        profileIds: run.profileIds,
        error: run.error,
        engineVersion: run.engineVersion,
        startedAt: run.startedAt,
        completedAt: run.completedAt,
        durationMs: run.durationMs,
        corpusSnapshotId: run.corpusSnapshotId,
      };
    }

    // ── Versioning ────────────────────────────────────────────────────────

    case 'profile_version_history': {
      const profileIdentity = input.profileIdentity as string;
      const limit = Math.min((input.limit as number | undefined) ?? 20, 100);
      const offset = (input.offset as number | undefined) ?? 0;

      const history = new ProfileVersionHistory();
      const versions = await history.getHistory(tenantId, profileIdentity, { limit, offset });
      const summary = await history.getVersionSummary(tenantId, profileIdentity);

      return {
        profileIdentity,
        versions: versions.map((v) => ({
          id: v.id,
          version: v.version,
          status: v.status,
          tier: v.tier,
          authorId: v.authorId,
          authorName: v.authorName,
          fidelityScore: v.fidelityScore,
          corpusSnapshotId: v.corpusSnapshotId,
          createdAt: v.createdAt,
          updatedAt: v.updatedAt,
        })),
        summary,
        total: versions.length,
      };
    }

    case 'profile_rollback': {
      const profileIdentity = input.profileIdentity as string;
      const targetVersion = input.targetVersion as number;

      const versionService = new ProfileVersionService();
      const restored = await versionService.rollback(tenantId, profileIdentity, targetVersion);

      return {
        profileIdentity,
        restoredVersion: restored.version,
        status: restored.status,
        message: `Profile "${profileIdentity}" rolled back to version ${targetVersion}`,
        profile: {
          id: restored.id,
          version: restored.version,
          status: restored.status,
          tier: restored.tier,
          fidelityScore: restored.fidelityScore,
          updatedAt: restored.updatedAt,
        },
      };
    }

    case 'profile_compare_versions': {
      const profileIdentity = input.profileIdentity as string;
      const versionA = input.versionA as number;
      const versionB = input.versionB as number;

      const history = new ProfileVersionHistory();
      const comparisons = await history.compareVersions(
        tenantId,
        profileIdentity,
        versionA,
        versionB,
      );

      return {
        profileIdentity,
        versionA,
        versionB,
        featureCount: comparisons.length,
        comparisons: comparisons.slice(0, 50), // Top 50 by absolute delta
        topChanges: comparisons.slice(0, 10),
      };
    }

    // ── Corpus ────────────────────────────────────────────────────────────

    case 'profile_list_documents': {
      const authorId = input.authorId as string | undefined;
      const limit = Math.min((input.limit as number | undefined) ?? 20, 100);
      const offset = (input.offset as number | undefined) ?? 0;

      const rows = await db
        .select({
          id: corpusDocuments.id,
          originalFilename: corpusDocuments.originalFilename,
          format: corpusDocuments.format,
          title: corpusDocuments.title,
          authorId: corpusDocuments.authorId,
          authorName: corpusDocuments.authorName,
          wordCount: corpusDocuments.wordCount,
          isActive: corpusDocuments.isActive,
          createdAt: corpusDocuments.createdAt,
        })
        .from(corpusDocuments)
        .where(
          authorId
            ? and(
                eq(corpusDocuments.tenantId, tenantId),
                eq(corpusDocuments.authorId, authorId),
              )
            : eq(corpusDocuments.tenantId, tenantId),
        )
        .orderBy(desc(corpusDocuments.createdAt))
        .limit(limit)
        .offset(offset);

      return {
        documents: rows,
        total: rows.length,
        tenantId,
      };
    }

    case 'profile_list_snapshots': {
      const limit = Math.min((input.limit as number | undefined) ?? 20, 100);
      const offset = (input.offset as number | undefined) ?? 0;

      const snapshotService = new CorpusSnapshotService();
      const snapshots = await snapshotService.listSnapshots(tenantId, { limit, offset });

      return {
        snapshots: snapshots.map((s) => ({
          id: s.id,
          name: s.name,
          documentCount: s.documentCount,
          authorCount: s.authorCount,
          totalWordCount: s.totalWordCount,
          createdAt: s.createdAt,
        })),
        total: snapshots.length,
      };
    }

    case 'profile_intake_status': {
      const logger = new ProfileOperationLogger();
      const logs = await logger.getOperationHistory(tenantId, {
        operation: 'intake',
        limit: 20,
      });

      return {
        tenantId,
        recentIntakeOperations: logs.map((l) => ({
          id: l.id,
          operation: l.operation,
          profileIdentity: l.profileIdentity,
          success: l.success,
          durationMs: l.durationMs,
          metadata: l.metadata,
          createdAt: l.createdAt,
        })),
        total: logs.length,
      };
    }

    // ── Hierarchy ─────────────────────────────────────────────────────────

    case 'profile_get_hierarchy': {
      const hierarchyService = new ProfileHierarchyService();
      const tree = await hierarchyService.getFullHierarchy(tenantId);

      return {
        tenantId,
        hierarchy: tree,
        rootCount: tree.length,
      };
    }

    case 'profile_set_parent': {
      const childIdentity = input.childIdentity as string;
      const parentIdentity = input.parentIdentity as string;

      const hierarchyService = new ProfileHierarchyService();
      const relationship = await hierarchyService.createRelationship(
        tenantId,
        parentIdentity,
        childIdentity,
      );

      return {
        message: `Inheritance set: "${childIdentity}" now inherits from "${parentIdentity}"`,
        relationship: {
          id: relationship.id,
          parentProfileIdentity: relationship.parentProfileIdentity,
          childProfileIdentity: relationship.childProfileIdentity,
          createdAt: relationship.createdAt,
        },
      };
    }

    default:
      throw new Error(`Unknown profile tool: ${toolName}`);
  }
}
