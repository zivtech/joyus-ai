/**
 * Profile Isolation and Scale — TypeScript Types and Constants
 *
 * String literal union types (mirroring DB enums), domain interfaces,
 * and shared constants for the profiles module.
 */

// ============================================================
// STRING LITERAL UNIONS (mirror DB enums)
// ============================================================

/** Tier in the profile hierarchy. Mirrors `profiles.profile_tier` enum. */
export type ProfileTier = 'base' | 'domain' | 'specialized' | 'contextual';

/** Lifecycle status of a profile version. Mirrors `profiles.profile_status` enum. */
export type ProfileStatus = 'active' | 'archived' | 'draft' | 'superseded' | 'rolled_back' | 'deleted';

/** Execution status of a generation run. Mirrors `profiles.generation_run_status` enum. */
export type GenerationRunStatus = 'pending' | 'running' | 'completed' | 'failed' | 'cancelled';

/** Supported document formats for corpus ingestion. Mirrors `profiles.document_format` enum. */
export type DocumentFormat = 'pdf' | 'docx' | 'txt' | 'html' | 'md';

/** Audit operation types recorded in operation_logs. */
export type ProfileOperationType =
  | 'generate'
  | 'rollback'
  | 'resolve'
  | 'intake'
  | 'cache_warm'
  | 'cache_invalidate'
  | 'hierarchy_create'
  | 'hierarchy_delete'
  | 'retention_apply';

// ============================================================
// DOMAIN INTERFACES
// ============================================================

/**
 * Raw stylometric feature vector.
 * Keys are feature names (e.g. "avg_sentence_length", "type_token_ratio");
 * values are normalised floats. Exactly FEATURE_COUNT entries per profile.
 */
export interface StylometricFeatures {
  [featureName: string]: number;
}

/** A single stylometric marker derived from corpus analysis. */
export interface ProfileMarker {
  /** Descriptive label (e.g. "formal register", "passive voice preference"). */
  name: string;
  /** Activation threshold for this marker (0–1). */
  threshold: number;
  /** Observed frequency in the training corpus (0–1). */
  frequency: number;
  /** Representative context phrase illustrating the marker. */
  context: string;
}

/** Markers collection stored on a profile. */
export type ProfileMarkers = ProfileMarker[];

/**
 * A single feature value in a resolved (merged) profile, annotated with
 * its inheritance source so callers can explain provenance.
 */
export interface ResolvedFeature {
  /** The effective feature value after hierarchy resolution. */
  value: number;
  /** Tier of the profile that contributed this value. */
  sourceTier: ProfileTier;
  /** Identity string of the profile that contributed this value. */
  sourceProfileId: string;
  /** Version number of the contributing profile. */
  sourceVersion: number;
}

/**
 * A fully-resolved profile: merged features + markers from the hierarchy,
 * with full provenance information for each override.
 */
export interface ResolvedProfile {
  /** Feature map: feature name → resolved value with provenance. */
  features: Map<string, ResolvedFeature>;
  /** Merged markers from the hierarchy. */
  markers: ProfileMarkers;
  /** Map of feature name → identity of the profile that last overrode it. */
  overrideSources: Record<string, string>;
}

/** Result from parsing a corpus document. */
export interface ParseResult {
  /** Extracted plain text. */
  text: string;
  /** Structured metadata extracted from the document. */
  metadata: {
    title?: string;
    author?: string;
    pageCount?: number;
    wordCount?: number;
  };
  /** Non-fatal issues encountered during parsing (e.g. unsupported encoding). */
  warnings: string[];
}

/** Summary result returned from a completed generation pipeline run. */
export interface PipelineResult {
  /** ID of the GenerationRun record. */
  runId: string;
  /** Terminal status of the run. */
  status: GenerationRunStatus;
  /** IDs of profiles produced by the run. */
  profileIds: string[];
  /** Wall-clock duration of the run in milliseconds. */
  durationMs: number;
  /** Error message if status is 'failed'. */
  error?: string;
}

/** Comparison between two versions of the same profile feature. */
export interface VersionComparison {
  /** Feature key being compared. */
  featureKey: string;
  /** Value in the older version. */
  oldValue: number;
  /** Value in the newer version. */
  newValue: number;
  /** Absolute difference (newValue - oldValue). */
  delta: number;
  /** Relative change as a percentage ((delta / oldValue) * 100). NaN if oldValue is 0. */
  percentChange: number;
}

// ============================================================
// CONSTANTS
// ============================================================

/** Supported document format extensions (with leading dot). */
export const SUPPORTED_EXTENSIONS: readonly string[] = [
  '.pdf', '.docx', '.txt', '.html', '.htm', '.md',
] as const;

/** Supported MIME types for corpus document ingestion. */
export const SUPPORTED_MIME_TYPES: readonly string[] = [
  'application/pdf',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'text/plain',
  'text/html',
  'text/markdown',
] as const;

/** Supported document format enum values. */
export const SUPPORTED_FORMATS: readonly DocumentFormat[] = [
  'pdf', 'docx', 'txt', 'html', 'md',
] as const;

/** Default retention period in days for archived profiles. */
export const DEFAULT_RETENTION_DAYS = 90;

/** Grace period in days during which soft-deleted profiles can be recovered. */
export const SOFT_DELETE_RECOVERY_DAYS = 30;

/** Maximum depth of the profile inheritance hierarchy. */
export const MAX_HIERARCHY_DEPTH = 10;

/** Maximum number of generation runs allowed to execute concurrently per tenant. */
export const MAX_CONCURRENT_PIPELINES = 5;

/** Number of stylometric features in the standard feature vector. */
export const FEATURE_COUNT = 129;
