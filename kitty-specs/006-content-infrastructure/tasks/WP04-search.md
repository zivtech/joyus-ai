---
work_package_id: WP04
title: Search Abstraction & PostgreSQL FTS
lane: "done"
dependencies: []
base_branch: 006-content-infrastructure-WP01
base_commit: ad3ac9985edbc8dfbdeb1616fb5329168797f97f
created_at: '2026-02-21T12:32:25.142825+00:00'
subtasks: [T018, T019, T020, T021]
shell_pid: "22633"
reviewed_by: "Alex Urevick-Ackelsberg"
review_status: "approved"
history:
- date: '2026-02-21'
  action: created
  by: spec-kitty.tasks
---

# WP04: Search Abstraction & PostgreSQL FTS

## Objective

Build the search layer: a `SearchProvider` interface with PostgreSQL full-text search as the default implementation, wrapped in an entitlement-filtered search service that returns attributed, ranked results.

## Implementation Command

```bash
spec-kitty implement WP04 --base WP01
```

## Context

- **Spec**: `kitty-specs/006-content-infrastructure/spec.md` (FR-008 through FR-010, SC-003)
- **Research**: `kitty-specs/006-content-infrastructure/research.md` (§R1: PostgreSQL FTS)
- **Contracts**: `kitty-specs/006-content-infrastructure/contracts/internal-services.yaml` (SearchProvider)
- **Data Model**: `kitty-specs/006-content-infrastructure/data-model.md` (ContentItem.searchVector)

Search must be <2s (SC-003). PostgreSQL FTS with GIN indexes achieves this at 500K items. The `SearchProvider` interface allows swapping to a dedicated engine later.

---

## Subtask T018: Define SearchProvider Interface

**Purpose**: Abstract interface for search implementations.

**Steps**:
1. Create `joyus-ai-mcp-server/src/content/search/interface.ts`
2. Define:
   ```typescript
   export interface SearchProvider {
     search(query: string, accessibleSourceIds: string[], options: SearchOptions): Promise<SearchResult[]>;
     indexItem(item: ContentItem): Promise<void>;
     removeItem(itemId: string): Promise<void>;
   }

   export interface SearchOptions {
     limit: number;
     offset: number;
     sourceId?: string;
   }
   ```
3. Import `SearchResult` from `../types.js`

**Files**:
- `joyus-ai-mcp-server/src/content/search/interface.ts` (new, ~25 lines)

**Validation**:
- [ ] Interface is clean and implementation-agnostic

---

## Subtask T019: Implement PostgreSQL FTS Provider

**Purpose**: Default search provider using PostgreSQL's built-in full-text search.

**Steps**:
1. Create `joyus-ai-mcp-server/src/content/search/pg-fts-provider.ts`
2. Implement `SearchProvider`:
   ```typescript
   export class PgFtsProvider implements SearchProvider {
     constructor(private db: DrizzleClient) {}

     async search(query: string, accessibleSourceIds: string[], options: SearchOptions): Promise<SearchResult[]> {
       // Build tsquery from user input
       // Use plainto_tsquery('english', query) for safe parsing
       // Query content.items WHERE sourceId IN (accessibleSourceIds)
       //   AND searchVector @@ tsquery
       // ORDER BY ts_rank(searchVector, tsquery) DESC
       // LIMIT options.limit OFFSET options.offset
     }

     async indexItem(item: ContentItem): Promise<void> {
       // searchVector is a generated column — indexing happens on INSERT/UPDATE
       // This method is a no-op for PG FTS (the column auto-updates)
     }

     async removeItem(itemId: string): Promise<void> {
       // Delete from content.items
     }
   }
   ```
3. Use Drizzle's `sql` tagged template for FTS operations:
   ```typescript
   import { sql } from 'drizzle-orm';

   const results = await db.execute(sql`
     SELECT id, source_id, title,
       ts_headline('english', coalesce(body, ''), plainto_tsquery('english', ${query})) as excerpt,
       ts_rank(search_vector, plainto_tsquery('english', ${query})) as score,
       metadata, is_stale
     FROM content.items
     WHERE source_id = ANY(${accessibleSourceIds})
       AND search_vector @@ plainto_tsquery('english', ${query})
     ORDER BY score DESC
     LIMIT ${options.limit} OFFSET ${options.offset}
   `);
   ```
4. Handle edge cases: empty query → return empty, no accessible sources → return empty

**Files**:
- `joyus-ai-mcp-server/src/content/search/pg-fts-provider.ts` (new, ~100 lines)

**Validation**:
- [ ] Returns ranked results with relevance scores
- [ ] Filters by accessible source IDs
- [ ] Uses `plainto_tsquery` for safe query parsing (no SQL injection)
- [ ] Returns excerpts with `ts_headline`
- [ ] Empty queries return empty results (no error)

---

## Subtask T020: Create Entitlement-Filtered Search Service

**Purpose**: Search service that resolves accessible sources from entitlements before querying.

**Steps**:
1. Create `joyus-ai-mcp-server/src/content/search/index.ts`
2. Implement:
   ```typescript
   export class SearchService {
     constructor(
       private provider: SearchProvider,
       private db: DrizzleClient
     ) {}

     async search(
       query: string,
       entitlements: ResolvedEntitlements,
       options?: Partial<SearchOptions>
     ): Promise<SearchResult[]> {
       // 1. Get sourceIds from entitlements.productIds via product_sources join
       // 2. If options.sourceId provided, intersect with accessible sources
       // 3. If no accessible sources, return empty
       // 4. Delegate to provider.search(query, accessibleSourceIds, mergedOptions)
     }

     async getItem(
       itemId: string,
       entitlements: ResolvedEntitlements
     ): Promise<ContentItem | null> {
       // 1. Fetch item by ID
       // 2. Check item's source is in entitled sources
       // 3. If not entitled, return null (don't throw — just deny access silently)
       // 4. If body is null (pass-through/hybrid), fetch on demand
     }
   }
   ```
3. Export factory function that creates SearchService with PgFtsProvider

**Files**:
- `joyus-ai-mcp-server/src/content/search/index.ts` (new, ~80 lines)

**Validation**:
- [ ] Only returns results from entitled sources
- [ ] Non-entitled item access returns null (no error leak)
- [ ] Options merge correctly (defaults + overrides)
- [ ] On-demand content fetch works for pass-through items

---

## Subtask T021: Search Result Formatting

**Purpose**: Format raw search results with source attribution, metadata, and staleness indicators.

**Steps**:
1. Add to `search/index.ts` or a new `search/formatter.ts`:
   ```typescript
   export function formatSearchResults(
     results: SearchResult[],
     sources: Map<string, ContentSource>
   ): FormattedSearchResult[] {
     return results.map(r => ({
       ...r,
       sourceName: sources.get(r.sourceId)?.name ?? 'Unknown',
       sourceType: sources.get(r.sourceId)?.type ?? 'unknown',
       stalenessWarning: r.isStale ? 'Content may be outdated' : null,
     }));
   }
   ```
2. Define `FormattedSearchResult` extending `SearchResult` with source attribution fields
3. Integrate into `SearchService.search()` — enrich results before returning

**Files**:
- `joyus-ai-mcp-server/src/content/search/index.ts` (extend, ~40 lines)

**Validation**:
- [ ] Results include source name and type
- [ ] Stale items carry a warning
- [ ] Unknown sources handled gracefully

---

## Definition of Done

- [ ] `SearchProvider` interface defined
- [ ] PostgreSQL FTS provider implements interface with tsvector/tsquery
- [ ] Search service filters by entitlements before querying
- [ ] Results include source attribution and staleness indicators
- [ ] `npm run typecheck` passes

## Risks

- **Drizzle + raw SQL**: FTS queries require raw SQL via `sql` template. Must ensure parameterized queries (no SQL injection).
- **tsvector generated column**: May need manual migration SQL if Drizzle can't generate it. Covered in WP01 schema notes.

## Reviewer Guidance

- Verify `plainto_tsquery` is used (not `to_tsquery` which requires special syntax)
- Check that source ID filtering happens at the SQL level (not post-query)
- Confirm entitlement check prevents access to non-entitled content
- Verify no SQL injection vectors in query construction

## Activity Log

- 2026-02-21T12:39:46Z – unknown – shell_pid=22633 – lane=done – Search: interface, PgFtsProvider
