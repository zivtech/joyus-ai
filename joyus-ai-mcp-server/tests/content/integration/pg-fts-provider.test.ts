import { PgDialect } from 'drizzle-orm/pg-core';
import { describe, expect, it, vi } from 'vitest';

import { PgFtsProvider } from '../../../src/content/search/pg-fts-provider.js';

describe('PgFtsProvider', () => {
  it('preserves existing empty-input guards without querying the database', async () => {
    const db = {
      execute: vi.fn(),
    };
    const provider = new PgFtsProvider(db as never);

    await expect(
      provider.search('   ', ['source-a'], { limit: 5, offset: 0 }),
    ).resolves.toEqual([]);
    await expect(
      provider.search('multi tenant architecture', [], { limit: 5, offset: 0 }),
    ).resolves.toEqual([]);

    expect(db.execute).not.toHaveBeenCalled();
  });

  it('preserves existing database row mapping for search results', async () => {
    const db = {
      execute: vi.fn().mockResolvedValue({
        rows: [
          {
            id: 'item-1',
            source_id: 'source-a',
            title: 'Architecture Notes',
            excerpt: null,
            score: '0.75',
            metadata: null,
            is_stale: 0,
          },
          {
            id: 'item-2',
            source_id: 'source-b',
            title: 'Tenant Guide',
            excerpt: 'tenant architecture excerpt',
            score: 0.5,
            metadata: { section: 'guides' },
            is_stale: 1,
          },
        ],
      }),
    };
    const provider = new PgFtsProvider(db as never);

    await expect(
      provider.search('multi tenant architecture', ['source-a', 'source-b'], {
        limit: 5,
        offset: 0,
      }),
    ).resolves.toEqual([
      {
        itemId: 'item-1',
        sourceId: 'source-a',
        title: 'Architecture Notes',
        excerpt: '',
        score: 0.75,
        metadata: {},
        isStale: false,
      },
      {
        itemId: 'item-2',
        sourceId: 'source-b',
        title: 'Tenant Guide',
        excerpt: 'tenant architecture excerpt',
        score: 0.5,
        metadata: { section: 'guides' },
        isStale: true,
      },
    ]);
    expect(db.execute).toHaveBeenCalledOnce();
  });

  it('binds accessible source ids as scalar values in an IN list', async () => {
    const db = {
      execute: vi.fn().mockResolvedValue({ rows: [] }),
    };
    const provider = new PgFtsProvider(db as never);

    await provider.search('multi tenant architecture', ['source-a', 'source-b'], {
      limit: 5,
      offset: 0,
    });

    const query = db.execute.mock.calls[0]?.[0];
    const compiled = new PgDialect().sqlToQuery(query);

    expect(compiled.sql).toContain('source_id IN ($3, $4)');
    expect(compiled.sql).not.toContain('source_id = ANY');
    expect(compiled.params).toEqual([
      'multi tenant architecture',
      'multi tenant architecture',
      'source-a',
      'source-b',
      'multi tenant architecture',
      5,
      0,
    ]);
    expect(db.execute).toHaveBeenCalledOnce();
  });
});
