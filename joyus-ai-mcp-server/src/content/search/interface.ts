/**
 * Content Search — Provider Interface
 *
 * Abstract interface for search implementations. Allows swapping the
 * underlying search engine (PostgreSQL FTS, Elasticsearch, etc.) without
 * changing the service layer.
 */

import type { ContentItem } from '../schema.js';
import type { SearchResult } from '../types.js';

export interface SearchOptions {
  limit: number;
  offset: number;
  sourceId?: string;
}

export interface SearchProvider {
  /**
   * Search for content items matching the query within accessible sources.
   *
   * @param query - User-supplied search query (plain text)
   * @param accessibleSourceIds - Source IDs the caller is entitled to access
   * @param options - Pagination and filtering options
   */
  search(
    query: string,
    accessibleSourceIds: string[],
    options: SearchOptions,
  ): Promise<SearchResult[]>;

  /**
   * Index a content item for search. For providers backed by generated
   * columns (e.g. PostgreSQL tsvector), this may be a no-op.
   */
  indexItem(item: ContentItem): Promise<void>;

  /**
   * Remove a content item from the search index.
   */
  removeItem(itemId: string): Promise<void>;
}
