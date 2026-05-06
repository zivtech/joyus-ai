import { describe, expect, it, vi } from 'vitest';

import { PgFtsProvider } from '../../../src/content/search/pg-fts-provider.js';

describe('PgFtsProvider', () => {
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
    const chunks = query?.queryChunks ?? [];
    const sqlText = chunks
      .map((chunk: unknown) => {
        if (typeof chunk === 'string') return chunk;
        if (Array.isArray(chunk)) return chunk.join('');
        if (chunk && typeof chunk === 'object' && 'value' in chunk) {
          const value = (chunk as { value: unknown }).value;
          return Array.isArray(value) ? value.join('') : String(value);
        }
        return '';
      })
      .join('');

    expect(sqlText).toContain('source_id IN (');
    expect(sqlText).not.toContain('source_id = ANY');
    expect(db.execute).toHaveBeenCalledOnce();
  });
});
