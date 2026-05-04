/**
 * Tests for scheduler/notifications.ts — module-singleton DB pattern.
 * Mocks axios and ../db/client.js at the module boundary.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('axios', () => ({
  default: { post: vi.fn().mockResolvedValue({ data: { ok: true } }) },
}));

vi.mock('../../src/db/client.js', () => ({
  db: {
    select: vi.fn().mockReturnValue({
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockReturnValue({
          limit: vi.fn().mockResolvedValue([]),
        }),
      }),
    }),
    update: vi.fn().mockReturnValue({
      set: vi.fn().mockReturnValue({
        where: vi.fn().mockResolvedValue(undefined),
      }),
    }),
  },
  connections: { userId: 'userId', service: 'service' },
  taskRuns: { id: 'id' },
}));

vi.mock('../../src/db/encryption.js', () => ({
  decryptToken: vi.fn().mockReturnValue('decrypted-token'),
}));

import { sendNotification } from '../../src/scheduler/notifications.js';
import axios from 'axios';

beforeEach(() => {
  vi.clearAllMocks();
});

describe('sendNotification', () => {
  it('does nothing when no notification channels configured', async () => {
    const task = {
      userId: 'user-1',
      name: 'Test Task',
      notifySlack: null,
      notifyEmail: null,
    };

    await sendNotification(task, 'run-1', 'success', { data: 'test' });

    expect(axios.post).not.toHaveBeenCalled();
  });

  it('sends Slack notification when notifySlack is set', async () => {
    const { db } = await import('../../src/db/client.js');
    vi.mocked(db.select).mockReturnValue({
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockReturnValue({
          limit: vi.fn().mockResolvedValue([
            {
              userId: 'user-1',
              service: 'SLACK',
              accessToken: 'enc-token',
              metadata: { teamId: 'T123' },
            },
          ]),
        }),
      }),
    } as any);

    const task = {
      userId: 'user-1',
      name: 'Test Task',
      notifySlack: '#general',
      notifyEmail: null,
    };

    await sendNotification(task, 'run-1', 'success', { data: 'test' });

    expect(axios.post).toHaveBeenCalled();
  });

  it('handles notification errors gracefully', async () => {
    vi.mocked(axios.post).mockRejectedValueOnce(new Error('Network error'));

    const { db } = await import('../../src/db/client.js');
    vi.mocked(db.select).mockReturnValue({
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockReturnValue({
          limit: vi.fn().mockResolvedValue([
            {
              userId: 'user-1',
              service: 'SLACK',
              accessToken: 'enc-token',
              metadata: {},
            },
          ]),
        }),
      }),
    } as any);

    const task = {
      userId: 'user-1',
      name: 'Failing Task',
      notifySlack: '#alerts',
      notifyEmail: null,
    };

    await expect(
      sendNotification(task, 'run-1', 'error', null, 'Task failed'),
    ).resolves.not.toThrow();
  });
});
