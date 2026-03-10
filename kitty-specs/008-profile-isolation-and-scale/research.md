# Research: Profile Isolation and Scale
*Phase 0 output for Feature 008*

## R1: Drizzle ORM Multi-Tenant Patterns (Tenant-Scoped Queries)

**Decision**: Implement a `TenantScope` utility module that provides tenant-scoped query helpers. Every service method accepts `tenantId` as a required parameter injected from the authenticated session context. The helpers wrap Drizzle's query builder to add mandatory `WHERE tenant_id = ?` filtering. No ORM-level middleware or custom query executor — explicit helpers that make the scoping visible in code.

**Rationale**:
- The Leash pattern (ADR-0002) requires that tenant_id is never accepted from user input — it must come from the authenticated session. This is already the pattern used in `src/content/validation.ts`, which explicitly excludes `tenantId` from Zod input schemas.
- Drizzle ORM does not provide built-in multi-tenant query scoping (unlike Prisma's `clientExtensions` or Sequelize's `defaultScope`). The cleanest approach is explicit helpers rather than hidden middleware.
- Explicit helpers make tenant scoping visible at every call site — a developer cannot accidentally write an unscoped query without consciously bypassing the helper. This is a feature, not a limitation.
- The same pattern is used by Stripe (explicit `customer_id` on every API call) and by Auth0's multi-tenant data access layer.

**Alternatives considered**:
- **Drizzle query wrapper class**: A custom `TenantDb` class that wraps the Drizzle client and injects `tenant_id` into every query. Rejected because it hides the scoping behind a wrapper, making it harder to audit. Also adds a non-standard abstraction layer over Drizzle.
- **PostgreSQL Row-Level Security (RLS)**: RLS policies enforced at the database level (`SET app.current_tenant_id`). Strong isolation guarantee but adds operational complexity: every connection must set the session variable, RLS policies must be maintained alongside migrations, and debugging query failures becomes harder. Considered for a future hardening phase if regulatory requirements demand it.
- **Middleware-based injection**: Express middleware that attaches `tenantId` to the request context, then service methods read from context. Viable but implicit — the service method signature doesn't show that it depends on tenant context. Explicit parameter passing is more testable.

**Implementation shape**:
```typescript
// tenant-scope.ts
import { eq, and, type SQL } from 'drizzle-orm';

/** Build a tenant-scoped WHERE condition. Composable with other conditions. */
export function tenantWhere<T extends { tenantId: unknown }>(
  table: T,
  tenantId: string,
  ...conditions: SQL[]
): SQL {
  return and(eq(table.tenantId, tenantId), ...conditions)!;
}

/**
 * Validate that a tenantId is present and non-empty.
 * Throws if missing — fail-closed per §2.3 Sandbox by Default.
 */
export function requireTenantId(tenantId: string | undefined | null): string {
  if (!tenantId) {
    throw new Error('tenant_id is required — cannot execute unscoped query');
  }
  return tenantId;
}
```

**Future hardening**: If a tenant requires hard isolation (e.g., HIPAA workload), the path is PostgreSQL RLS as an additive layer on top of application-level scoping. The application-level scoping remains as defense-in-depth; RLS adds database-level enforcement. This is a deployment configuration change, not an application architecture change.

## R2: Profile Versioning Strategies

**Decision**: Immutable append-only rows. Each profile generation creates a new row with a monotonically increasing `version` integer (scoped per tenant + profile identity). The `status` field tracks which version is active. Rollback changes the `status` of the current active version to `rolled_back` and the target version to `active` — no rows are deleted or mutated beyond status changes.

**Rationale**:
- Immutable rows are the simplest model that satisfies FR-003 (immutable version identifiers) and FR-004 (rollback to any previous version). No mutation means no race conditions on concurrent reads during rollback.
- The 129-feature vector is ~2-4 KB of JSON per profile version. At 30 authors × 10 versions × 50 tenants = 15,000 rows ≈ 60 MB. Storage cost is negligible.
- Atomic rollback (FR-004) is a single UPDATE statement: set old active to `rolled_back`, set target to `active`. This can be wrapped in a transaction for atomicity. Consumers that query `WHERE status = 'active'` immediately see the new active version.
- Version retention (FR-009, 90 days minimum) is enforced by a background job that transitions `archived` versions to `deleted` after the retention window. Soft-delete first (recoverable for 30 days), then hard-delete.

**Alternatives considered**:
- **Copy-on-write**: Store only the diff from the previous version. Reconstruct the full profile by replaying diffs from version 1. Saves storage but adds read complexity and latency — every profile read requires walking the version chain. Not worth the complexity at this scale.
- **Mutable row with history table**: A single "current" row in the main table, with old versions archived to a history table. Simpler reads (no WHERE status filter) but more complex writes (must copy to history before updating). Also makes rollback harder — must copy back from history.
- **Event sourcing**: Store profile generation events, derive current state by replaying. Powerful for audit but extreme overkill for a versioning requirement. Adds event store infrastructure, projection logic, and eventual consistency concerns.

**Version number strategy**: Monotonically increasing integer per `(tenant_id, profile_identity)` pair. The identity is the combination of `author_id` (nullable for org/dept profiles) and `tier` — so an org profile and an individual profile for the same author have independent version sequences. This avoids gaps and makes version ordering unambiguous.

**Rollback implementation**:
```sql
-- Atomic rollback within a transaction
BEGIN;
  UPDATE profiles.tenant_profiles
    SET status = 'rolled_back', updated_at = NOW()
    WHERE tenant_id = $1 AND status = 'active'
      AND profile_identity = $2;

  UPDATE profiles.tenant_profiles
    SET status = 'active', updated_at = NOW()
    WHERE tenant_id = $1 AND id = $3;  -- target version ID
COMMIT;
```

## R3: Composite Profile Inheritance Resolution

**Decision**: Nearest-ancestor-wins with explicit override tracking. When resolving a profile at any tier, walk the inheritance chain from the requested profile upward to the root (org). For each of the 129 stylometric features, use the value from the nearest ancestor that defines it. Track which tier provided each feature in the resolved profile for auditability.

**Rationale**:
- The spec (FR-005) requires "deterministically computable" resolved profiles. Nearest-ancestor-wins is deterministic — given the same hierarchy and the same profile versions, the result is always identical.
- The 129-feature vector from Spec 005 is a flat structure (not nested). Each feature is independently overridable. This makes per-feature merging straightforward — no recursive deep-merge of nested objects.
- Override tracking (which tier provided each feature) is essential for debugging fidelity issues. If an individual profile's sentence cadence feature is being overridden by the department profile, the user needs to know.
- NFR-005 requires <=5% fidelity degradation after inheritance resolution. Nearest-ancestor-wins is the least lossy merge strategy because it preserves the most specific data available — individual features are only diluted if no individual-level value exists.

**Alternatives considered**:
- **Weighted average**: Merge feature vectors with weights (e.g., individual=0.7, department=0.2, org=0.1). More nuanced but introduces tuning parameters and makes the result non-deterministic across configurations. Also harder to explain to users — "why did my formality score change from 7.2 to 6.8?" is harder to answer with weighted averages.
- **Union with conflict resolution rules**: Allow conflicting values and apply per-feature resolution rules (e.g., "for vocabulary, take the union; for formality, take the maximum"). Powerful but requires defining rules for each of 129 features — a maintenance burden that scales with the feature set.
- **Strict override only (no inheritance)**: Each tier is independent; inheritance must be explicitly configured per feature. Maximum control but maximum configuration burden. Not practical for 129 features.

**Merge algorithm**:
```typescript
interface ResolvedFeature {
  value: number;
  sourceTier: 'org' | 'department' | 'individual';
  sourceProfileId: string;
  sourceVersion: number;
}

function resolveProfile(chain: ProfileVersion[]): Map<string, ResolvedFeature> {
  // chain is ordered: [individual, department, org] (most specific first)
  const resolved = new Map<string, ResolvedFeature>();

  // Walk from org (least specific) to individual (most specific)
  // Later entries override earlier ones = nearest-ancestor-wins
  for (const profile of chain.reverse()) {
    for (const [featureKey, value] of Object.entries(profile.features)) {
      if (value !== null && value !== undefined) {
        resolved.set(featureKey, {
          value,
          sourceTier: profile.tier,
          sourceProfileId: profile.id,
          sourceVersion: profile.version,
        });
      }
    }
  }
  return resolved;
}
```

**Markers and non-numeric features**: The 129-feature vector is numeric (stylometric features). Markers (`markers.json` from Spec 005) are a separate structure — string-based content markers. For markers, the merge strategy is union with tier annotation: markers from all tiers are collected, and if the same marker appears at multiple tiers, the most specific tier's version wins (for threshold, frequency, and context).

## R4: Document Format Parsing Libraries

**Decision**: Use `pdf-parse` for PDF extraction and `mammoth` for DOCX extraction. TXT, HTML, and Markdown are handled by a lightweight passthrough parser (strip HTML tags for HTML, pass through for TXT/Markdown). All parsers implement a common `DocumentParser` interface and are registered in a parser registry keyed by file extension / MIME type.

**Rationale**:
- **pdf-parse** (npm: `pdf-parse`, 1.4M weekly downloads): Pure JavaScript, no native dependencies, MIT license. Extracts text from PDF using Mozilla's pdf.js under the hood. Handles multi-page documents, returns text with page breaks. Limitations: poor table extraction, no layout preservation — but we need raw text for stylometric analysis, not layout.
- **mammoth** (npm: `mammoth`, 450K weekly downloads): Pure JavaScript, no native dependencies, BSD license. Converts DOCX to plain text (or HTML). Handles styles, lists, tables as text. Specifically designed for content extraction, not round-trip editing.
- Both libraries are pure JavaScript (no native bindings), which simplifies Docker builds and CI. Both have stable APIs and active maintenance.

**Alternatives considered**:
- **pdf.js directly** (`pdfjs-dist`): Lower-level than pdf-parse. Requires manual page iteration and text extraction. More control but more code. pdf-parse wraps pdf.js and provides the simpler API we need.
- **Apache Tika** (Java): Industry-standard multi-format parser. Superior extraction quality, especially for complex PDFs and tables. But requires a JVM runtime — unacceptable for a Node.js single-package deployment. Could be considered later as an optional external service for enterprise deployments.
- **docx** (npm: `docx`): For creating DOCX files, not reading them. Wrong tool.
- **officeparser** (npm: `officeparser`): Handles DOCX, PPTX, XLSX, PDF, ODT in one library. Fewer downloads (40K/week), less mature. The Swiss-army-knife approach trades quality for breadth.
- **Textract** (AWS service): Cloud-based extraction with superior accuracy for scanned PDFs and handwriting. But adds an AWS dependency, per-page pricing, and network latency. Overkill for born-digital documents. Could be added as an optional parser for scanned document support.

**Parser interface**:
```typescript
interface DocumentParser {
  /** MIME types this parser handles */
  supportedTypes: string[];
  /** File extensions this parser handles (without dot) */
  supportedExtensions: string[];
  /** Extract plain text content from a document buffer */
  parse(buffer: Buffer, filename: string): Promise<ParseResult>;
}

interface ParseResult {
  text: string;           // Extracted plain text
  metadata: {
    title?: string;
    author?: string;
    pageCount?: number;
    wordCount: number;
  };
  warnings: string[];     // Non-fatal extraction issues
}
```

**Normalization**: All parser output goes through a normalization step before storage:
1. Normalize Unicode (NFC form)
2. Collapse multiple whitespace characters to single space
3. Normalize line endings to `\n`
4. Trim leading/trailing whitespace
5. Compute content hash (SHA-256) on the normalized text — this is the hash used for deduplication (FR-007)

## R5: Cache Invalidation for Hierarchical Data

**Decision**: Ancestor-triggered recursive invalidation. When any profile in the hierarchy is updated (new version created, rollback, or status change), invalidate the cached resolved profiles for that profile and all of its descendants. Invalidation walks the `ProfileInheritance` table to find descendants, then deletes their cache entries. No time-based expiry — cache entries are valid until explicitly invalidated.

**Rationale**:
- FR-008 requires that stale cache entries are never served after invalidation. Time-based TTL cannot guarantee this — an ancestor profile could be updated at any time, and a TTL of N seconds means up to N seconds of stale data.
- The hierarchy is shallow (3 tiers per spec) and narrow (<=30 authors per tenant initially). The descendant query is a recursive CTE on `ProfileInheritance` that returns at most tens of rows — not a performance concern.
- Explicit invalidation is simpler to reason about than cache coherence protocols. The invariant is: "a cache entry exists if and only if no ancestor has been modified since the entry was created."

**Alternatives considered**:
- **TTL-based expiry**: Simple but violates FR-008. A 5-minute TTL means up to 5 minutes of stale data after an ancestor update.
- **Version-based cache keys**: Include the version numbers of all ancestors in the cache key. Cache miss on any ancestor version change. Elegant but requires knowing all ancestor versions at read time, which requires walking the hierarchy — defeating the purpose of caching.
- **Pub/sub invalidation**: Publish profile-change events; cache subscribes and invalidates. Adds infrastructure (event bus) and eventual consistency. Overkill for the current scale.
- **Write-through cache**: On profile update, immediately recompute and store the resolved profiles for all descendants. Ensures cache is always warm but makes writes slower (must recompute potentially many resolved profiles). Could be added as an optimization for large tenants (Phase 6, task 6.3 "cache warming").

**Invalidation algorithm**:
```typescript
async function invalidateDescendants(
  db: DrizzleClient,
  tenantId: string,
  updatedProfileId: string,
): Promise<number> {
  // 1. Find all descendants via recursive CTE
  const descendants = await db.execute(sql`
    WITH RECURSIVE descendants AS (
      SELECT child_profile_id FROM profiles.profile_inheritance
      WHERE parent_profile_id = ${updatedProfileId}
        AND tenant_id = ${tenantId}
      UNION ALL
      SELECT pi.child_profile_id
      FROM profiles.profile_inheritance pi
      JOIN descendants d ON pi.parent_profile_id = d.child_profile_id
      WHERE pi.tenant_id = ${tenantId}
    )
    SELECT child_profile_id FROM descendants
  `);

  // 2. Delete cache entries for the updated profile + all descendants
  const idsToInvalidate = [
    updatedProfileId,
    ...descendants.rows.map((r: any) => r.child_profile_id),
  ];

  const result = await db.delete(profileCache)
    .where(
      and(
        eq(profileCache.tenantId, tenantId),
        inArray(profileCache.profileId, idsToInvalidate),
      )
    );

  return result.rowCount ?? 0;
}
```

**Cache storage**: The `ProfileCache` table in the `profiles` schema stores the fully-resolved profile (merged feature vector + merged markers + override source map). This is a database-level cache, not an in-memory cache — it survives server restarts and is shared across instances. For sub-50ms reads at p95, the cache table has an index on `(tenant_id, profile_id)` and the resolved data is stored as JSONB for single-row retrieval.

**Write-through warming (Phase 6, task 6.3)**: For tenants with large hierarchies (>20 profiles), precompute resolved profiles immediately after any profile update. This is an optimization — the cache works correctly without it (cache miss triggers on-demand recomputation), but it improves first-read latency for large tenants.
