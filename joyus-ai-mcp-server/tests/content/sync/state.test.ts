/**
 * Tests for sync/state.ts — DI-friendly sync run CRUD and staleness detection.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

import {
  createSyncRun,
  updateSyncRun,
  completeSyncRun,
  failSyncRun,
  getLatestSyncRun,
  getSyncRunById,
} from '../../../src/content/sync/state.js';

function createMockDb() {
  const db: any = {
    insert: vi.fn().mockReturnValue({
      values: vi.fn().mockResolvedValue(undefined),
    }),
    update: vi.fn().mockReturnValue({
      set: vi.fn().mockReturnValue({
        where: vi.fn().mockResolvedValue(undefined),
      }),
    }),
    select: vi.fn().mockReturnValue({
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockReturnValue({
          orderBy: vi.fn().mockReturnValue({
            limit: vi.fn().mockResolvedValue([]),
          }),
          limit: vi.fn().mockResolvedValue([]),
        }),
      }),
    }),
    execute: vi.fn().mockResolvedValue({ rowCount: 0 }),
  };
  return db;
}

describe('createSyncRun', () => {
  it('inserts a pending sync run and returns an id', async () => {
    const db = createMockDb();
    const id = await createSyncRun(db, 'source-1', 'manual');

    expect(id).toBeDefined();
    expect(typeof id).toBe('string');
    expect(db.insert).toHaveBeenCalledOnce();
  });
});

describe('updateSyncRun', () => {
  it('applies partial updates to a sync run', async () => {
    const db = createMockDb();
    await updateSyncRun(db, 'run-1', { status: 'running' });

    expect(db.update).toHaveBeenCalledOnce();
  });
});

describe('completeSyncRun', () => {
  it('marks run as completed with stats', async () => {
    const db = createMockDb();
    await completeSyncRun(db, 'run-1', {
      itemsDiscovered: 10,
      itemsCreated: 5,
      itemsUpdated: 3,
      itemsRemoved: 2,
    });

    expect(db.update).toHaveBeenCalledOnce();
  });
});

describe('failSyncRun', () => {
  it('marks run as failed with error message', async () => {
    const db = createMockDb();
    await failSyncRun(db, 'run-1', 'Connection timeout');

    expect(db.update).toHaveBeenCalledOnce();
  });
});

describe('getLatestSyncRun', () => {
  it('returns the most recent sync run for a source', async () => {
    const mockRun = { id: 'run-1', sourceId: 'source-1', status: 'completed' };
    const db = createMockDb();
    db.select.mockReturnValue({
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockReturnValue({
          orderBy: vi.fn().mockReturnValue({
            limit: vi.fn().mockResolvedValue([mockRun]),
          }),
        }),
      }),
    });

    const result = await getLatestSyncRun(db, 'source-1');
    expect(result).toEqual(mockRun);
  });

  it('returns undefined when no runs exist', async () => {
    const db = createMockDb();
    const result = await getLatestSyncRun(db, 'source-1');
    expect(result).toBeUndefined();
  });
});

describe('getSyncRunById', () => {
  it('returns a sync run by id', async () => {
    const mockRun = { id: 'run-1', status: 'completed' };
    const db = createMockDb();
    db.select.mockReturnValue({
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockReturnValue({
          limit: vi.fn().mockResolvedValue([mockRun]),
        }),
      }),
    });

    const result = await getSyncRunById(db, 'run-1');
    expect(result).toEqual(mockRun);
  });

  it('returns undefined when not found', async () => {
    const db = createMockDb();
    const result = await getSyncRunById(db, 'missing');
    expect(result).toBeUndefined();
  });
});
