/**
 * Tests for ContentRetriever — DI-friendly retrieval with entitlement filtering.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

import { ContentRetriever } from '../../src/content/generation/retriever.js';
import type { ResolvedEntitlements } from '../../src/content/types.js';

function createMockSearchService(results: any[] = []) {
  return {
    search: vi.fn().mockResolvedValue(results),
  };
}

function createMockDb(items: any[] = []) {
  return {
    select: vi.fn().mockReturnValue({
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockReturnValue({
          limit: vi.fn().mockImplementation(() =>
            Promise.resolve(items.length > 0 ? [items.shift()] : []),
          ),
        }),
      }),
    }),
  } as any;
}

const entitlements: ResolvedEntitlements = {
  productIds: ['prod-1'],
  sourceIds: ['src-1', 'src-2'],
  profileIds: ['prof-1'],
  resolvedFrom: 'test',
  resolvedAt: new Date(),
};

describe('ContentRetriever', () => {
  it('delegates entitlements and maxSources to search service', async () => {
    const search = createMockSearchService([]);
    const db = createMockDb();
    const retriever = new ContentRetriever(search, db);

    await retriever.retrieve('query', entitlements, { sourceIds: ['src-1', 'src-3'] });

    expect(search.search).toHaveBeenCalledWith(
      'query',
      entitlements,
      { limit: 5 },
    );
  });

  it('uses default maxSources when no options are provided', async () => {
    const search = createMockSearchService([]);
    const db = createMockDb();
    const retriever = new ContentRetriever(search, db);

    await retriever.retrieve('query', entitlements);

    expect(search.search).toHaveBeenCalledWith(
      'query',
      entitlements,
      { limit: 5 },
    );
  });

  it('hydrates items from DB and formats context text', async () => {
    const searchResults = [
      { itemId: 'item-1', score: 0.9 },
      { itemId: 'item-2', score: 0.8 },
    ];
    const dbItems = [
      { id: 'item-1', sourceId: 'src-1', title: 'First', body: 'Body one', metadata: {} },
      { id: 'item-2', sourceId: 'src-2', title: 'Second', body: 'Body two', metadata: {} },
    ];
    const search = createMockSearchService(searchResults);
    const db = createMockDb([...dbItems]);
    const retriever = new ContentRetriever(search, db);

    const result = await retriever.retrieve('query', entitlements);

    expect(result.items).toHaveLength(2);
    expect(result.contextText).toContain('[Source 1:');
    expect(result.contextText).toContain('[Source 2:');
    expect(result.totalSearchResults).toBe(2);
  });

  it('returns empty when no search results', async () => {
    const search = createMockSearchService([]);
    const db = createMockDb();
    const retriever = new ContentRetriever(search, db);

    const result = await retriever.retrieve('query', entitlements);

    expect(result.items).toHaveLength(0);
    expect(result.contextText).toBe('');
    expect(result.totalSearchResults).toBe(0);
  });
});
