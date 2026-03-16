/**
 * Buffer Drain Worker — Unit Tests
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { BufferDrainWorker } from '../../../src/event-adapter/workers/buffer-drain.js';
import { TriggerForwarder } from '../../../src/event-adapter/services/trigger-forwarder.js';

// Mock DB that returns empty results by default
function makeMockDb() {
  return {
    select: vi.fn().mockReturnThis(),
    from: vi.fn().mockReturnThis(),
    where: vi.fn().mockReturnThis(),
    orderBy: vi.fn().mockReturnThis(),
    limit: vi.fn().mockReturnThis(),
    offset: vi.fn().mockReturnValue([]),
    update: vi.fn().mockReturnThis(),
    set: vi.fn().mockReturnThis(),
    returning: vi.fn().mockReturnValue([]),
    insert: vi.fn().mockReturnThis(),
    values: vi.fn().mockReturnThis(),
  } as unknown as Parameters<typeof BufferDrainWorker extends new (db: infer D, ...args: unknown[]) => unknown ? D : never>;
}

describe('BufferDrainWorker', () => {
  let worker: BufferDrainWorker;

  beforeEach(() => {
    const db = makeMockDb();
    const forwarder = new TriggerForwarder({ eventBusUrl: undefined });
    worker = new BufferDrainWorker(db, forwarder, {
      intervalMs: 50,
      batchSize: 5,
    });
  });

  it('starts and stops cleanly', async () => {
    expect(worker.isRunning).toBe(false);

    // Start — will tick once and schedule next
    const startPromise = worker.start();
    expect(worker.isRunning).toBe(true);

    // Let it tick
    await startPromise;

    // Stop
    worker.stop();
    expect(worker.isRunning).toBe(false);
  });

  it('does not start twice', async () => {
    await worker.start();
    await worker.start(); // Should be a no-op
    expect(worker.isRunning).toBe(true);
    worker.stop();
  });

  it('recovers from errors during tick', async () => {
    // Worker should not crash even if tick throws
    const db = makeMockDb();
    (db as unknown as Record<string, unknown>).select = vi.fn().mockImplementation(() => {
      throw new Error('DB connection lost');
    });

    const forwarder = new TriggerForwarder({ eventBusUrl: undefined });
    const errorWorker = new BufferDrainWorker(db, forwarder, { intervalMs: 10 });

    // Should not throw
    await errorWorker.start();
    expect(errorWorker.isRunning).toBe(true);
    errorWorker.stop();
  });
});
