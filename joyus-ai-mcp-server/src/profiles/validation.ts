/**
 * Profile Isolation and Scale — Zod Validation Schemas
 *
 * Input validation for profile operations (MCP tool inputs, API request bodies).
 *
 * TENANT SCOPING: tenantId is NOT included in these input schemas because it
 * is always resolved from the authenticated session context, never from
 * user-supplied input. This prevents tenant spoofing per ADR-0002 (Leash pattern).
 * All service methods that write or query data must accept tenantId as a separate
 * parameter injected from the auth layer.
 */

import { z } from 'zod';

// ============================================================
// PROFILE GENERATION
// ============================================================

/**
 * Trigger a generation run for one or more profile identities against
 * a named corpus snapshot.
 */
export const GenerateProfilesInput = z.object({
  /** Corpus snapshot ID to generate profiles from. */
  corpusSnapshotId: z.string().min(1),
  /** Profile identity strings to generate (must already exist as drafts or be created). */
  profileIdentities: z.array(z.string().min(1)).min(1).max(50),
  /** Force regeneration even if an active profile already exists. */
  forceRegenerate: z.boolean().default(false),
  /** Engine version override. Defaults to the current deployed version. */
  engineVersion: z.string().optional(),
});
export type GenerateProfilesInput = z.infer<typeof GenerateProfilesInput>;

// ============================================================
// VERSION MANAGEMENT
// ============================================================

/**
 * Roll back a profile identity to a specific previous version.
 */
export const RollbackInput = z.object({
  /** Profile identity to roll back. */
  profileIdentity: z.string().min(1),
  /** Target version number to restore as the new active version. */
  targetVersion: z.number().int().positive(),
});
export type RollbackInput = z.infer<typeof RollbackInput>;

/**
 * Retrieve the version history for a profile identity.
 */
export const VersionHistoryInput = z.object({
  profileIdentity: z.string().min(1),
  limit: z.number().int().min(1).max(100).default(20),
  offset: z.number().int().min(0).default(0),
});
export type VersionHistoryInput = z.infer<typeof VersionHistoryInput>;

/**
 * Compare two versions of the same profile identity.
 */
export const VersionCompareInput = z.object({
  profileIdentity: z.string().min(1),
  versionA: z.number().int().positive(),
  versionB: z.number().int().positive(),
});
export type VersionCompareInput = z.infer<typeof VersionCompareInput>;

// ============================================================
// HIERARCHY MANAGEMENT
// ============================================================

/**
 * Establish a parent-child relationship between two profile identities.
 */
export const CreateHierarchyInput = z.object({
  parentProfileIdentity: z.string().min(1),
  childProfileIdentity: z.string().min(1),
});
export type CreateHierarchyInput = z.infer<typeof CreateHierarchyInput>;

/**
 * Resolve the merged feature set for a profile identity by walking
 * its inheritance hierarchy.
 */
export const ResolveProfileInput = z.object({
  profileIdentity: z.string().min(1),
  /** If true, bypass the cache and recompute from source profiles. */
  bypassCache: z.boolean().default(false),
});
export type ResolveProfileInput = z.infer<typeof ResolveProfileInput>;

// ============================================================
// CORPUS / DOCUMENT INTAKE
// ============================================================

/**
 * Ingest one or more documents into the corpus for a given author identity.
 */
export const IntakeDocumentsInput = z.object({
  /** Author identity these documents belong to. */
  authorId: z.string().min(1),
  /** Human-readable author name. */
  authorName: z.string().min(1).max(500),
  /** List of documents to ingest. */
  documents: z.array(z.object({
    originalFilename: z.string().min(1).max(500),
    format: z.enum(['pdf', 'docx', 'txt', 'html', 'md']),
    /** Base64-encoded document content. */
    contentBase64: z.string().min(1),
    title: z.string().max(1000).optional(),
    /** Data sensitivity tier (1 = public, 2 = internal, 3 = confidential). */
    dataTier: z.number().int().min(1).max(3).default(1),
    metadata: z.record(z.string(), z.unknown()).optional(),
  })).min(1).max(100),
  /** Name for the resulting corpus snapshot. */
  snapshotName: z.string().min(1).max(500),
});
export type IntakeDocumentsInput = z.infer<typeof IntakeDocumentsInput>;

// ============================================================
// RETENTION POLICY
// ============================================================

/**
 * Apply a retention policy to archived profiles for a given identity.
 * Profiles older than retentionDays will be permanently deleted.
 */
export const RetentionPolicyInput = z.object({
  profileIdentity: z.string().min(1),
  /** Number of days to retain archived profile versions. */
  retentionDays: z.number().int().min(1).max(3650).default(90),
  /** If true, perform a dry run and return what would be deleted without deleting. */
  dryRun: z.boolean().default(false),
});
export type RetentionPolicyInput = z.infer<typeof RetentionPolicyInput>;

// ============================================================
// CACHE MANAGEMENT
// ============================================================

/**
 * Pre-warm the resolved profile cache for one or more profile identities.
 */
export const CacheWarmInput = z.object({
  profileIdentities: z.array(z.string().min(1)).min(1).max(200),
});
export type CacheWarmInput = z.infer<typeof CacheWarmInput>;
