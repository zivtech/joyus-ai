/**
 * Content Search — PostgreSQL Full-Text Search Provider
 *
 * Uses PostgreSQL's built-in tsvector/tsquery for full-text search.
 * The `search_vector` column on content.items is a generated column
 * updated automatically on INSERT/UPDATE. A GIN index on that column
 * makes queries fast at 500K+ items (< 2s, per SC-003).
 *
 * Uses `plainto_tsquery` for safe, injection-resistant query parsing
 * (no special syntax required from callers).
 */

import { sql } from 'drizzle-orm';

import type { ContentItem } from '../schema.js';
import { contentItems } from '../schema.js';
import type { SearchResult } from '../types.js';
import type { SearchOptions, SearchProvider } from './interface.js';
import type { DrizzleClient } from '../../db/types.js';

interface FtsRow {
  [key: string]: unknown;
  id: string;
  source_id: string;
  title: string;
  excerpt: string;
  score: number;
  metadata: Record<string, unknown>;
  is_stale: boolean;
}

export class PgFtsProvider implements SearchProvider {
  constructor(private db: DrizzleClient) {}

  async search(
    query: string,
    accessibleSourceIds: string[],
    options: SearchOptions,
  ): Promise<SearchResult[]> {
    // Guard: empty query or no accessible sources → return empty
    if (!query.trim() || accessibleSourceIds.length === 0) {
      return [];
    }

    // Apply optional single-source filter by intersecting
    const sourceIds =
      options.sourceId && accessibleSourceIds.includes(options.sourceId)
        ? [options.sourceId]
        : accessibleSourceIds;

    if (sourceIds.length === 0) {
      return [];
    }

    const rows = await this.db.execute<FtsRow>(sql`
      SELECT
        id,
        source_id,
        title,
        ts_headline(
          'english',
          coalesce(body, ''),
          plainto_tsquery('english', ${query}),
          'MaxWords=35, MinWords=15, StartSel=«, StopSel=»'
        ) AS excerpt,
        ts_rank(search_vector, plainto_tsquery('english', ${query})) AS score,
        metadata,
        is_stale
      FROM content.items
      WHERE source_id = ANY(${sourceIds})
        AND search_vector @@ plainto_tsquery('english', ${query})
      ORDER BY score DESC
      LIMIT ${options.limit}
      OFFSET ${options.offset}
    `);

    return rows.rows.map((row) => ({
      itemId: row.id,
      sourceId: row.source_id,
      title: row.title,
      excerpt: row.excerpt ?? '',
      score: Number(row.score),
      metadata: (row.metadata as Record<string, unknown>) ?? {},
      isStale: Boolean(row.is_stale),
    }));
  }

  /**
   * No-op: search_vector is a generated column in PostgreSQL.
   * It updates automatically on INSERT/UPDATE of the parent row.
   */
  async indexItem(_item: ContentItem): Promise<void> {
    // Intentional no-op for PostgreSQL FTS with generated column
  }

  async removeItem(itemId: string): Promise<void> {
    await this.db
      .delete(contentItems)
      .where(sql`${contentItems.id} = ${itemId}`);
  }
}
