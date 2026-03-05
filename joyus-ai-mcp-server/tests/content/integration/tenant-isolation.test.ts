import { describe, expect, it, vi } from 'vitest';

import { ContentRetriever } from '../../../src/content/generation/retriever.js';
import { isSessionAccessible } from '../../../src/content/mediation/router.js';
import type { ResolvedEntitlements, SearchResult } from '../../../src/content/types.js';

function makeEntitlements(sourceIds: string[]): ResolvedEntitlements {
  return {
    productIds: ['prod-1'],
    sourceIds,
    profileIds: [],
    resolvedFrom: 'test',
    resolvedAt: new Date(),
  };
}

function makeSearchResult(overrides: Partial<SearchResult> = {}): SearchResult {
  return {
    itemId: 'item-1',
    sourceId: 'source-allowed',
    title: 'Allowed Content',
    excerpt: 'excerpt',
    score: 1,
    metadata: {},
    isStale: false,
    ...overrides,
  };
}

function makeDb(rowsQueue: Array<{ id: string; sourceId: string; title: string; body: string; metadata: Record<string, unknown> }>) {
  const limit = vi.fn(async () => {
    const row = rowsQueue.shift();
    return row ? [row] : [];
  });
  const where = vi.fn(() => ({ limit }));
  const from = vi.fn(() => ({ where }));
  const select = vi.fn(() => ({ from }));

  return {
    db: { select } as never,
    limit,
  };
}

describe('Tenant isolation', () => {
  it('passes only entitled source IDs to search when sourceIds are requested', async () => {
    const search = vi.fn().mockResolvedValue([
      makeSearchResult({ itemId: 'item-allow', sourceId: 'source-allowed' }),
    ]);
    const searchService = { search };

    const { db } = makeDb([
      {
        id: 'item-allow',
        sourceId: 'source-allowed',
        title: 'Allowed Content',
        body: 'Allowed body',
        metadata: {},
      },
    ]);

    const retriever = new ContentRetriever(searchService, db);
    const entitlements = makeEntitlements(['source-allowed']);

    const result = await retriever.retrieve('query', entitlements, {
      sourceIds: ['source-allowed', 'source-denied'],
      maxSources: 5,
    });

    expect(search).toHaveBeenCalledWith('query', ['source-allowed'], { limit: 5 });
    expect(result.items).toHaveLength(1);
    expect(result.items[0]?.sourceId).toBe('source-allowed');
  });

  it('drops provider results that are outside the entitlement scope', async () => {
    const search = vi.fn().mockResolvedValue([
      makeSearchResult({ itemId: 'item-allow', sourceId: 'source-allowed' }),
      makeSearchResult({ itemId: 'item-denied', sourceId: 'source-denied' }),
    ]);
    const searchService = { search };

    const { db, limit } = makeDb([
      {
        id: 'item-allow',
        sourceId: 'source-allowed',
        title: 'Allowed Content',
        body: 'Allowed body',
        metadata: {},
      },
      {
        id: 'item-denied',
        sourceId: 'source-denied',
        title: 'Denied Content',
        body: 'Denied body',
        metadata: {},
      },
    ]);

    const retriever = new ContentRetriever(searchService, db);
    const entitlements = makeEntitlements(['source-allowed']);

    const result = await retriever.retrieve('query', entitlements, {
      sourceIds: ['source-allowed'],
      maxSources: 5,
    });

    expect(search).toHaveBeenCalledWith('query', ['source-allowed'], { limit: 5 });
    expect(limit).toHaveBeenCalledTimes(1);
    expect(result.items).toHaveLength(1);
    expect(result.items[0]?.itemId).toBe('item-allow');
    expect(result.totalSearchResults).toBe(1);
  });

  it('returns no items when entitlement scope is empty', async () => {
    const search = vi.fn().mockResolvedValue([]);
    const searchService = { search };
    const { db, limit } = makeDb([]);

    const retriever = new ContentRetriever(searchService, db);
    const entitlements = makeEntitlements([]);

    const result = await retriever.retrieve('query', entitlements, {
      sourceIds: ['source-denied'],
      maxSources: 3,
    });

    expect(search).toHaveBeenCalledWith('query', [], { limit: 3 });
    expect(limit).not.toHaveBeenCalled();
    expect(result.items).toHaveLength(0);
    expect(result.totalSearchResults).toBe(0);
  });

  it('denies mediation session access when tenant does not match', () => {
    const session = {
      id: 'session-1',
      tenantId: 'tenant-allowed',
      userId: 'user-1',
      endedAt: null,
    };

    expect(isSessionAccessible(session as never, 'user-1', 'tenant-other')).toBe(false);
    expect(isSessionAccessible(session as never, 'user-1', 'tenant-allowed')).toBe(true);
  });

  it('denies mediation session access when session is closed', () => {
    const session = {
      id: 'session-1',
      tenantId: 'tenant-allowed',
      userId: 'user-1',
      endedAt: new Date(),
    };

    expect(isSessionAccessible(session as never, 'user-1', 'tenant-allowed')).toBe(false);
  });
});
