/**
 * Tests for sync/engine.ts — DI-friendly SyncEngine class.
 * Mocks db and ConnectorRegistry at the boundary.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../../src/content/sync/state.js', () => ({
  createSyncRun: vi.fn().mockResolvedValue('run-1'),
  updateSyncRun: vi.fn().mockResolvedValue(undefined),
  completeSyncRun: vi.fn().mockResolvedValue(undefined),
  failSyncRun: vi.fn().mockResolvedValue(undefined),
  getSyncRunById: vi.fn().mockResolvedValue({ id: 'run-1', status: 'running' }),
}));

import { SyncEngine } from '../../../src/content/sync/engine.js';
import { createSyncRun, completeSyncRun, failSyncRun, updateSyncRun } from '../../../src/content/sync/state.js';

function createMockDb(sourceRow?: any) {
  const selectResult = sourceRow ? [sourceRow] : [];
  const db: any = {
    select: vi.fn().mockReturnValue({
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockReturnValue({
          limit: vi.fn().mockResolvedValue(selectResult),
        }),
      }),
    }),
    update: vi.fn().mockReturnValue({
      set: vi.fn().mockReturnValue({
        where: vi.fn().mockResolvedValue(undefined),
      }),
    }),
    insert: vi.fn().mockReturnValue({
      values: vi.fn().mockReturnValue({
        onConflictDoUpdate: vi.fn().mockResolvedValue(undefined),
        returning: vi.fn().mockResolvedValue([]),
      }),
    }),
    delete: vi.fn().mockReturnValue({
      where: vi.fn().mockResolvedValue(undefined),
    }),
    execute: vi.fn().mockResolvedValue({ rowCount: 0 }),
  };
  return db;
}

function createMockRegistry(connector?: any) {
  return {
    getOrThrow: vi.fn().mockImplementation((type: string) => {
      if (connector) return connector;
      throw new Error(`No connector for type: ${type}`);
    }),
    get: vi.fn(),
    register: vi.fn(),
    list: vi.fn().mockReturnValue([]),
  } as any;
}

const activeSource = {
  id: 'source-1',
  tenantId: 'tenant-1',
  type: 'test-connector',
  name: 'Test Source',
  status: 'active',
  syncStrategy: 'mirror' as const,
  connectionConfig: { url: 'https://example.com' },
  config: {},
};

describe('SyncEngine', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('syncSource', () => {
    it('throws when source not found', async () => {
      const db = createMockDb(undefined);
      const engine = new SyncEngine(db, createMockRegistry());

      await expect(engine.syncSource('missing', 'manual')).rejects.toThrow(
        'Source not found: missing',
      );
    });

    it('throws when source is already syncing', async () => {
      const syncingSource = { ...activeSource, status: 'syncing' };
      const db = createMockDb(syncingSource);
      const engine = new SyncEngine(db, createMockRegistry());

      await expect(engine.syncSource('source-1', 'manual')).rejects.toThrow(
        'already syncing',
      );
    });

    it('creates a sync run and marks source as syncing', async () => {
      const connector = {
        indexBatch: vi.fn().mockResolvedValue({ items: [], nextCursor: null }),
      };
      const db = createMockDb(activeSource);
      const registry = createMockRegistry(connector);
      const engine = new SyncEngine(db, registry);

      const runId = await engine.syncSource('source-1', 'manual');

      expect(runId).toBe('run-1');
      expect(createSyncRun).toHaveBeenCalledWith(db, 'source-1', 'manual');
      expect(updateSyncRun).toHaveBeenCalled();
      expect(db.update).toHaveBeenCalled();
    });

    it('completes sync run on success', async () => {
      const connector = {
        indexBatch: vi.fn().mockResolvedValue({ items: [], nextCursor: null }),
      };
      const db = createMockDb(activeSource);
      const engine = new SyncEngine(db, createMockRegistry(connector));

      await engine.syncSource('source-1', 'manual');

      expect(completeSyncRun).toHaveBeenCalledWith(
        db,
        'run-1',
        expect.objectContaining({
          itemsDiscovered: expect.any(Number),
        }),
      );
    });

    it('marks sync run as failed on connector error', async () => {
      const registry = createMockRegistry();
      registry.getOrThrow.mockImplementation(() => {
        throw new Error('No connector registered');
      });
      const db = createMockDb(activeSource);
      const engine = new SyncEngine(db, registry);

      await expect(engine.syncSource('source-1', 'manual')).rejects.toThrow();
      expect(failSyncRun).toHaveBeenCalledWith(db, 'run-1', 'No connector registered');
    });
  });
});
