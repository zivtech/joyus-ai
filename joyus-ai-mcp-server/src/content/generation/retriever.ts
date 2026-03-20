/**
 * ContentRetriever — fetches relevant content items for generation.
 *
 * Delegates search to the real SearchService (entitlement-filtered FTS),
 * then hydrates full item bodies from the database for context assembly.
 */

import { drizzle } from 'drizzle-orm/node-postgres';
import { eq } from 'drizzle-orm';
import { contentItems } from '../schema.js';
import type { ResolvedEntitlements } from '../types.js';
import type { SearchService } from '../search/index.js';

type DrizzleClient = ReturnType<typeof drizzle>;

export interface RetrievalResult {
  items: RetrievedItem[];
  contextText: string;
  totalSearchResults: number;
}

export interface RetrievedItem {
  itemId: string;
  sourceId: string;
  title: string;
  body: string;
  metadata: Record<string, unknown>;
}

export class ContentRetriever {
  constructor(
    private searchService: SearchService,
    private db: DrizzleClient,
  ) {}

  async retrieve(
    query: string,
    entitlements: ResolvedEntitlements,
    options?: { sourceIds?: string[]; maxSources?: number },
  ): Promise<RetrievalResult> {
    // 1. Search via SearchService (handles entitlement → sourceId resolution internally)
    const maxSources = options?.maxSources ?? 5;
    const results = await this.searchService.search(query, entitlements, {
      limit: maxSources,
    });

    // 2. Fetch full content for each result
    const items: RetrievedItem[] = [];
    for (const result of results) {
      const rows = await this.db
        .select()
        .from(contentItems)
        .where(eq(contentItems.id, result.itemId))
        .limit(1);
      if (rows[0]) {
        const body = rows[0].body ?? '';
        // On-demand fetch if body is null (pass-through/hybrid) — for now use empty string
        items.push({
          itemId: rows[0].id,
          sourceId: rows[0].sourceId,
          title: rows[0].title,
          body,
          metadata: (rows[0].metadata as Record<string, unknown>) ?? {},
        });
      }
    }

    // 3. Format context text with numbered source labels
    const contextText = items
      .map((item, i) => `[Source ${i + 1}: "${item.title}"] ${item.body}`)
      .join('\n\n');

    return { items, contextText, totalSearchResults: results.length };
  }
}
