/**
 * Tests for scheduler/index.ts — module-singleton DB pattern.
 * Mocks node-cron and ../db/client.js at the module boundary.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('node-cron', () => ({
  default: {
    validate: vi.fn((expr: string) => !expr.includes('INVALID')),
    schedule: vi.fn(() => ({ stop: vi.fn() })),
  },
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
    insert: vi.fn().mockReturnValue({
      values: vi.fn().mockReturnValue({
        returning: vi.fn().mockResolvedValue([{ id: 'run-1' }]),
      }),
    }),
    update: vi.fn().mockReturnValue({
      set: vi.fn().mockReturnValue({
        where: vi.fn().mockResolvedValue(undefined),
      }),
    }),
  },
  scheduledTasks: { id: 'id', enabled: 'enabled', schedule: 'schedule', userId: 'userId' },
  taskRuns: { id: 'id' },
  users: { id: 'id' },
  connections: { userId: 'userId', service: 'service' },
}));

vi.mock('../../src/scheduler/notifications.js', () => ({
  sendNotification: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../../src/scheduler/task-executor.js', () => ({
  executeScheduledTask: vi.fn().mockResolvedValue({ type: 'test_result' }),
}));

import cron from 'node-cron';
import {
  scheduleTask,
  unscheduleTask,
  getSchedulerStatus,
} from '../../src/scheduler/index.js';

beforeEach(() => {
  vi.clearAllMocks();
});

describe('scheduleTask', () => {
  it('validates cron expression and schedules job', () => {
    const task = {
      id: 'task-1',
      name: 'Test Task',
      schedule: '0 9 * * 1-5',
      timezone: 'America/New_York',
      enabled: true,
    } as any;

    scheduleTask(task);

    expect(cron.validate).toHaveBeenCalledWith('0 9 * * 1-5');
    expect(cron.schedule).toHaveBeenCalledOnce();
  });

  it('throws on invalid cron expression', () => {
    const task = {
      id: 'task-2',
      name: 'Bad Task',
      schedule: 'INVALID',
      timezone: 'UTC',
    } as any;

    expect(() => scheduleTask(task)).toThrow('Invalid cron expression');
  });

  it('stops existing job before rescheduling', () => {
    const stopFn = vi.fn();
    vi.mocked(cron.schedule).mockReturnValue({ stop: stopFn } as any);

    const task = {
      id: 'task-3',
      name: 'Task',
      schedule: '0 9 * * *',
      timezone: 'UTC',
    } as any;

    scheduleTask(task);
    scheduleTask(task);

    expect(stopFn).toHaveBeenCalledOnce();
  });
});

describe('unscheduleTask', () => {
  it('stops and removes scheduled job', () => {
    const stopFn = vi.fn();
    vi.mocked(cron.schedule).mockReturnValue({ stop: stopFn } as any);

    const task = {
      id: 'task-4',
      name: 'Task',
      schedule: '0 9 * * *',
      timezone: 'UTC',
    } as any;

    scheduleTask(task);
    unscheduleTask('task-4');

    expect(stopFn).toHaveBeenCalledOnce();
  });

  it('is a no-op for unknown task id', () => {
    expect(() => unscheduleTask('nonexistent')).not.toThrow();
  });
});

describe('getSchedulerStatus', () => {
  it('returns active task count and ids', () => {
    const task = {
      id: 'task-5',
      name: 'Task',
      schedule: '0 9 * * *',
      timezone: 'UTC',
    } as any;

    scheduleTask(task);
    const status = getSchedulerStatus();

    expect(status.activeTaskCount).toBeGreaterThanOrEqual(1);
    expect(status.taskIds).toContain('task-5');
  });
});
