/**
 * Shared vocabulary for the organization skill catalog (data-model.md).
 * Process-memory only: no persistence, no new database table.
 */

import { createHash } from 'node:crypto';

export type SkillScope = 'tenant' | 'role' | 'task';

/** One entry from the validated schema-1 index, cross-checked against its document frontmatter. */
export interface SkillMetadata {
  readonly name: string;
  readonly description: string;
  readonly priority: number;
  readonly scope: SkillScope;
  /** Canonical `skills/<name>/SKILL.md` path; internal, never returned to a client. */
  readonly path: string;
  /** Original UTF-8 byte count; internal validation field. */
  readonly bytes: number;
}

/** A validated skill plus its retained original document bytes (exact, unmodified). */
export interface ValidatedSkill extends SkillMetadata {
  readonly document: string;
}

export type SourceProvider = 'github';

/** Operator-controlled source identity; never accepted from tool input. */
export interface SourceIdentity {
  readonly provider: SourceProvider;
  readonly owner: string;
  readonly repository: string;
  readonly ref: string;
}

/** Tenant policy entry from the access-policy.md schema (schemaVersion 1). */
export interface PolicyTenantEntry {
  readonly epoch: string;
  readonly enabled: boolean;
  readonly approved: boolean;
  readonly source: SourceIdentity & { readonly credentialAlias: string };
}

export interface PolicyDocument {
  readonly schemaVersion: 1;
  readonly tenants: Readonly<Record<string, PolicyTenantEntry>>;
}

/** Outcome of a policy read: fail-closed on any structural or transport problem. */
export type PolicyReadResult =
  | { readonly ok: true; readonly policy: PolicyDocument }
  | { readonly ok: false; readonly reason: string };

/** The sole production/test port for live tenant policy (access-policy.md). Never cached as an entitlement. */
export interface CatalogAccessPolicyReader {
  readPolicy(signal: AbortSignal): Promise<PolicyReadResult>;
}

export type RefreshTrigger = 'startup' | 'timer' | 'manual';

export type RefreshCategory =
  | 'validation'
  | 'limit'
  | 'timeout'
  | 'upstream_rate_limit'
  | 'upstream_failure'
  | 'source_authorization'
  | 'policy'
  | 'superseded'
  | 'shutdown';

export type RefreshAttemptState = 'in_progress' | 'activated' | 'rejected' | 'unavailable';

/** Bounded candidate validation record (refresh.md); sanitized, no bodies/secrets. */
export interface RefreshAttempt {
  readonly operationId: string;
  readonly sourceKey: string;
  readonly epoch: string;
  readonly sequence: number;
  readonly trigger: RefreshTrigger;
  state: RefreshAttemptState;
  category?: RefreshCategory;
  readonly startedAt: string;
  completedAt?: string;
  revision?: string;
}

export type Freshness = 'fresh' | 'stale' | 'unavailable';

/**
 * A validated, immutable index+documents generation from one resolved source revision.
 * Keyed by logical source (tenant policy binding + source/ref) and cached generation identity
 * (source, approved ref, resolved revision).
 */
export interface Generation {
  readonly logicalSourceKey: string;
  readonly source: SourceIdentity;
  readonly epoch: string;
  /** Full verified source configuration digest; absent legacy entries are ineligible. */
  readonly sourceBindingRevision?: string;
  readonly revision: string;
  /** Monotonic-clock timestamp (ms) of the last successful source verification. */
  readonly verifiedAtMonotonicMs: number;
  /** UTC ISO timestamp of the last successful source verification, for reporting only. */
  readonly verifiedAtIso: string;
  /** Sorted by descending priority then ascending name (deterministic lexical order). */
  readonly skills: readonly SkillMetadata[];
  readonly documents: ReadonlyMap<string, string>;
  readonly totalDocumentBytes: number;
}

/** Opaque cursor payload (org-skills.md); WP02's cursor.ts encodes/decodes this shape. */
export interface CursorPayload {
  readonly version: 1;
  readonly tenantId: string;
  readonly sourceFingerprint: string;
  readonly epoch: string;
  /** Full verified source configuration digest; absent legacy entries are ineligible. */
  readonly sourceBindingRevision?: string;
  readonly revision: string;
  readonly offset: number;
}

/** A typed, sanitized rejection — never a raw thrown HTTP/parse error. */
export interface CategorizedFailure {
  readonly category: RefreshCategory;
  readonly message: string;
}

export type Result<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly failure: CategorizedFailure };

export function ok<T>(value: T): Result<T> {
  return { ok: true, value };
}

export function fail<T>(category: RefreshCategory, message: string): Result<T> {
  return { ok: false, failure: { category, message } };
}

/** Narrow, read-only query surface WP02 consumes; never bypasses live policy/membership checks. */
export interface CatalogGenerationQuery {
  /** Returns a validated generation only for its complete verified current source binding. */
  getActiveGeneration(logicalSourceKey: string, currentBinding: string): Generation | undefined;
  computeFreshness(generation: Generation): Freshness;
}

/**
 * Deterministic logical-source key: tenant policy binding plus source/ref (data-model.md).
 * WP01's service.ts and WP02's access module must derive this identically so two tenants
 * sharing the same repository/ref retain independent source slots and binding eligibility.
 */
export function computeLogicalSourceKey(tenantId: string, _source?: SourceIdentity): string {
  return `${tenantId}::skills`;
}

/** Canonical JSON uses recursive UTF-16 key order, with no whitespace. */
export function canonicalSourceJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalSourceJson).join(',')}]`;
  if (value !== null && typeof value === 'object') {
    return `{${Object.keys(value)
      .sort()
      .map(
        key =>
          `${JSON.stringify(key)}:${canonicalSourceJson((value as Record<string, unknown>)[key])}`
      )
      .join(',')}}`;
  }
  return JSON.stringify(value);
}

export function sourceBindingRevision(source: PolicyTenantEntry['source']): string {
  return createHash('sha256').update(canonicalSourceJson(source), 'utf8').digest('hex');
}

/**
 * Read-facing runtime surface WP02 consumes (in addition to `CatalogGenerationQuery`).
 * pin/release bound how long a retired-but-still-referenced generation's bytes remain
 * counted against the memory budget while a bounded read is in progress.
 */
export interface CatalogServiceRuntime extends CatalogGenerationQuery {
  pinGeneration(generation: Generation): void;
  releaseGeneration(generation: Generation): void;
}
