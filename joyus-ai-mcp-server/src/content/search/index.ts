/**
 * Content Search — Service & Formatting
 *
 * SearchService wraps a SearchProvider with entitlement filtering:
 * only sources the caller is entitled to are queried. Results are
 * enriched with source attribution and staleness indicators.
 *
 * T020: Entitlement-filtered search service
 * T021: Search result formatting with source attribution
 */

import { eq, inArray } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/node-postgres';

import { contentItems, contentProductSources, contentSources } from '../schema.js';
import type { ContentItem, ContentSource } from '../schema.js';
import type { ResolvedEntitlements, SearchResult } from '../types.js';
import type { SearchOptions, SearchProvider } from './interface.js';
import { PgFtsProvider } from './pg-fts-provider.js';

export type { SearchOptions, SearchProvider } from './interface.js';
export { PgFtsProvider } from './pg-fts-provider.js';

type DrizzleClient = ReturnType<typeof drizzle>;

// ============================================================
// FORMATTED RESULT (T021)
// ============================================================

export interface FormattedSearchResult extends SearchResult {
  /** Human-readable name of the content source */
  sourceName: string;
  /** Machine-readable type of the content source */
  sourceType: string;
  /** Non-null when the content may be outdated */
  stalenessWarning: string | null;
}

/**
 * Enrich raw SearchResults with source attribution and staleness indicators.
 * Unknown sources are handled gracefully (name = 'Unknown', type = 'unknown').
 */
export function formatSearchResults(
  results: SearchResult[],
  sources: Map<string, ContentSource>,
): FormattedSearchResult[] {
  return results.map((r) => ({
    ...r,
    sourceName: sources.get(r.sourceId)?.name ?? 'Unknown',
    sourceType: sources.get(r.sourceId)?.type ?? 'unknown',
    stalenessWarning: r.isStale ? 'Content may be outdated' : null,
  }));
}

// ============================================================
// SEARCH SERVICE (T020)
// ============================================================

const DEFAULT_OPTIONS: SearchOptions = {
  limit: 20,
  offset: 0,
};

export class SearchService {
  constructor(
    private provider: SearchProvider,
    private db: DrizzleClient,
  ) {}

  /**
   * Search content items the caller is entitled to access.
   *
   * 1. Resolve accessible sourceIds from entitlements via product_sources join.
   * 2. Optionally intersect with a single requested sourceId.
   * 3. If no accessible sources remain, return empty (silent deny).
   * 4. Delegate to provider, then enrich results with source metadata.
   */
  async search(
    query: string,
    entitlements: ResolvedEntitlements,
    options?: Partial<SearchOptions>,
  ): Promise<FormattedSearchResult[]> {
    const mergedOptions: SearchOptions = { ...DEFAULT_OPTIONS, ...options };

    // 1. Resolve accessible sourceIds from entitled productIds
    const accessibleSourceIds = await this.resolveAccessibleSourceIds(
      entitlements,
      mergedOptions.sourceId,
    );

    if (accessibleSourceIds.length === 0) {
      return [];
    }

    // 2. Delegate to provider (provider handles empty-query guard)
    const results = await this.provider.search(query, accessibleSourceIds, mergedOptions);

    if (results.length === 0) {
      return [];
    }

    // 3. Fetch source metadata for attribution (only sources present in results)
    const resultSourceIds = [...new Set(results.map((r) => r.sourceId))];
    const sourceRows = await this.db
      .select()
      .from(contentSources)
      .where(inArray(contentSources.id, resultSourceIds));

    const sourcesMap = new Map<string, ContentSource>(
      sourceRows.map((s) => [s.id, s]),
    );

    // 4. Enrich with source attribution and staleness indicators (T021)
    return formatSearchResults(results, sourcesMap);
  }

  /**
   * Fetch a single content item by ID, with entitlement check.
   * Returns null if the item does not exist or the caller is not entitled.
   * Does not throw — access denial is silent to avoid information leakage.
   */
  async getItem(
    itemId: string,
    entitlements: ResolvedEntitlements,
  ): Promise<ContentItem | null> {
    // Fetch the item
    const rows = await this.db
      .select()
      .from(contentItems)
      .where(eq(contentItems.id, itemId))
      .limit(1);

    if (rows.length === 0) {
      return null;
    }

    const item = rows[0];

    // Check entitlement: item's source must be in accessible sources
    const accessibleSourceIds = await this.resolveAccessibleSourceIds(entitlements);
    if (!accessibleSourceIds.includes(item.sourceId)) {
      return null; // Silent deny
    }

    return item;
  }

  // ----------------------------------------------------------
  // Private helpers
  // ----------------------------------------------------------

  /**
   * Resolve accessible source IDs from the caller's entitlements.
   * Joins product_sources for each entitled productId.
   * If `filterSourceId` is provided, returns only that source if accessible.
   */
  private async resolveAccessibleSourceIds(
    entitlements: ResolvedEntitlements,
    filterSourceId?: string,
  ): Promise<string[]> {
    if (entitlements.productIds.length === 0) {
      return [];
    }

    const rows = await this.db
      .select({ sourceId: contentProductSources.sourceId })
      .from(contentProductSources)
      .where(inArray(contentProductSources.productId, entitlements.productIds));

    let sourceIds = [...new Set(rows.map((r) => r.sourceId))];

    if (filterSourceId) {
      sourceIds = sourceIds.filter((id) => id === filterSourceId);
    }

    return sourceIds;
  }
}

// ============================================================
// FACTORY
// ============================================================

/**
 * Create a SearchService backed by PostgreSQL full-text search.
 */
export function createSearchService(db: DrizzleClient): SearchService {
  const provider = new PgFtsProvider(db);
  return new SearchService(provider, db);
}
