import { describe, expect, it, vi } from 'vitest';

import {
  ProfileIngestionQueue,
  ProfileQueueBackpressureError,
} from '../../../src/content/profiles/ingestion-queue.js';

describe('Profile ingestion queue', () => {
  it('applies backpressure when queue depth is saturated', async () => {
    let release: (() => void) | undefined;
    const handler = vi.fn(
      async () =>
        await new Promise<void>((resolve) => {
          release = resolve;
        }),
    );

    const queue = new ProfileIngestionQueue(handler, {
      maxQueueDepth: 1,
      concurrency: 1,
      maxRetries: 0,
    });

    queue.enqueue({
      tenantId: 'tenant-1',
      profileId: 'profile-1',
      payload: {},
    });

    expect(() =>
      queue.enqueue({
        tenantId: 'tenant-1',
        profileId: 'profile-2',
        payload: {},
      }),
    ).toThrow(ProfileQueueBackpressureError);

    release?.();
  });

  it('retries failed jobs and eventually completes', async () => {
    let attempts = 0;
    const handler = vi.fn(async () => {
      attempts += 1;
      if (attempts < 2) {
        throw new Error('transient failure');
      }
    });

    const queue = new ProfileIngestionQueue(handler, {
      maxQueueDepth: 5,
      concurrency: 1,
      maxRetries: 2,
      retryDelayMs: 1,
    });

    queue.enqueue({
      tenantId: 'tenant-1',
      profileId: 'profile-1',
      payload: {},
    });

    await new Promise((resolve) => setTimeout(resolve, 30));

    const metrics = queue.getMetrics();
    expect(metrics.completed).toBe(1);
    expect(metrics.retried).toBe(1);
    expect(metrics.failed).toBe(0);
    expect(handler).toHaveBeenCalledTimes(2);
  });
});
