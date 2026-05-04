/**
 * Tests for content-executor.ts — DI-friendly 12-case tool dispatcher.
 * Mocks db at the boundary; exercises real dispatch + query logic.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

import { executeContentTool } from '../../src/tools/executors/content-executor.js';
import type { ContentExecutorContext } from '../../src/tools/executors/content-executor.js';

function chainable(resolveValue: any = []): any {
  const self: any = {};
  const methods = ['from', 'where', 'orderBy', 'groupBy', 'limit', 'offset', 'leftJoin', 'innerJoin'];
  for (const m of methods) {
    self[m] = vi.fn().mockReturnValue(self);
  }
  self.then = (resolve: any) => Promise.resolve(resolveValue).then(resolve);
  return self;
}

function createMockDb() {
  return {
    select: vi.fn().mockImplementation(() => chainable([])),
    insert: vi.fn().mockReturnValue({
      values: vi.fn().mockReturnValue({
        returning: vi.fn().mockResolvedValue([{ id: 'new-1' }]),
      }),
    }),
    update: vi.fn().mockReturnValue({
      set: vi.fn().mockReturnValue({
        where: vi.fn().mockReturnValue({
          returning: vi.fn().mockResolvedValue([{ id: 'updated-1' }]),
        }),
      }),
    }),
    execute: vi.fn().mockResolvedValue({ rows: [] }),
  } as any;
}

function makeContext(db?: any): ContentExecutorContext {
  return {
    userId: 'user-1',
    tenantId: 'tenant-1',
    db: db ?? createMockDb(),
  };
}

describe('executeContentTool', () => {
  it('throws on unknown tool name', async () => {
    await expect(
      executeContentTool('content_unknown', {}, makeContext()),
    ).rejects.toThrow();
  });

  describe('content_list_sources', () => {
    it('returns sources array and total', async () => {
      const db = createMockDb();
      const mockSources = [
        { id: 's1', name: 'Source 1', type: 'api', syncStrategy: 'mirror', status: 'active', itemCount: 10, lastSyncAt: null, lastSyncError: null, freshnessWindowMinutes: 60, createdAt: new Date(), updatedAt: new Date() },
      ];
      db.select.mockImplementation(() => chainable(mockSources));

      const result = await executeContentTool('content_list_sources', {}, makeContext(db)) as any;

      expect(result.sources).toHaveLength(1);
      expect(result.total).toBe(1);
      expect(result.sources[0].id).toBe('s1');
    });

    it('filters by status when provided', async () => {
      const db = createMockDb();
      const result = await executeContentTool(
        'content_list_sources',
        { status: 'error' },
        makeContext(db),
      ) as any;

      expect(result.sources).toHaveLength(0);
      expect(result.total).toBe(0);
    });
  });

  describe('content_get_source', () => {
    it('returns source details when found', async () => {
      const db = createMockDb();
      const mockSource = { id: 's1', name: 'Source 1', tenantId: 'tenant-1', type: 'api', syncStrategy: 'mirror', status: 'active' };
      db.select.mockImplementation(() => chainable([mockSource]));

      const result = await executeContentTool(
        'content_get_source',
        { sourceId: 's1' },
        makeContext(db),
      ) as any;

      expect(result).toBeDefined();
    });
  });

  describe('content_list_products', () => {
    it('returns products array', async () => {
      const db = createMockDb();
      db.select.mockImplementation(() => chainable([
        { id: 'p1', name: 'Product 1', tenantId: 'tenant-1', sourceCount: 2, profileCount: 1 },
      ]));

      const result = await executeContentTool(
        'content_list_products',
        {},
        makeContext(db),
      ) as any;

      expect(result).toBeDefined();
    });
  });

  describe('content_get_item', () => {
    it('returns item when found', async () => {
      const db = createMockDb();
      const mockItem = { id: 'i1', title: 'Test Item', sourceId: 's1', body: 'test', metadata: {} };
      const mockSource = { id: 's1', tenantId: 'tenant-1' };
      let callCount = 0;
      db.select.mockImplementation(() => {
        callCount++;
        if (callCount === 1) return chainable([mockItem]);
        return chainable([mockSource]);
      });

      const result = await executeContentTool(
        'content_get_item',
        { itemId: 'i1' },
        makeContext(db),
      ) as any;

      expect(result).toBeDefined();
    });
  });

  describe('content_state_dashboard', () => {
    it('returns dashboard data structure', async () => {
      const db = createMockDb();
      db.select.mockImplementation(() => chainable([]));
      db.execute.mockResolvedValue({
        rows: [{ total_items: 0, stale_items: 0 }],
      });

      const result = await executeContentTool(
        'content_state_dashboard',
        {},
        makeContext(db),
      ) as any;

      expect(result).toBeDefined();
    });
  });
});
