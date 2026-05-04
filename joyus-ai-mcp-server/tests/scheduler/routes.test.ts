/**
 * Tests for scheduler/routes.ts — Express route handlers for task CRUD.
 * Uses mock req/res/next pattern throughout.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ============================================================
// Module mocks — hoisted before imports
// ============================================================

vi.mock('node-cron', () => ({
  default: {
    validate: vi.fn((expr: string) => !expr.includes('INVALID')),
    schedule: vi.fn(() => ({ stop: vi.fn() })),
  },
}));

vi.mock('../../src/db/client.js', () => ({
  db: {
    select: vi.fn(),
    insert: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
  },
  scheduledTasks: {
    id: 'id',
    userId: 'userId',
    name: 'name',
    enabled: 'enabled',
    createdAt: 'createdAt',
    schedule: 'schedule',
    taskType: 'taskType',
    timezone: 'timezone',
    description: 'description',
    config: 'config',
    notifySlack: 'notifySlack',
    notifyEmail: 'notifyEmail',
    lastRunAt: 'lastRunAt',
    nextRunAt: 'nextRunAt',
  },
  taskRuns: {
    id: 'id',
    taskId: 'taskId',
    startedAt: 'startedAt',
    status: 'status',
    duration: 'duration',
  },
}));

vi.mock('../../src/auth/middleware.js', () => ({
  requireSession: vi.fn((req: any, res: any, next: any) => next()),
  requireSessionOrRedirect: vi.fn((req: any, res: any, next: any) => next()),
}));

vi.mock('../../src/scheduler/notifications.js', () => ({
  sendTestNotification: vi.fn().mockResolvedValue({ success: true, message: 'Test sent' }),
}));

vi.mock('../../src/scheduler/index.js', () => ({
  scheduleTask: vi.fn(),
  unscheduleTask: vi.fn(),
  runTask: vi.fn().mockResolvedValue(undefined),
  reloadTask: vi.fn().mockResolvedValue(undefined),
  getSchedulerStatus: vi.fn().mockReturnValue({ activeTaskCount: 3, taskIds: ['t1', 't2', 't3'] }),
}));

// ============================================================
// Imports after mocks
// ============================================================

import { db } from '../../src/db/client.js';
import { scheduleTask, unscheduleTask, runTask, reloadTask, getSchedulerStatus } from '../../src/scheduler/index.js';
import { sendTestNotification } from '../../src/scheduler/notifications.js';
import { taskRouter } from '../../src/scheduler/routes.js';

// ============================================================
// Helpers
// ============================================================

function chainable(resolveValue: any = []): any {
  const self: any = {};
  const methods = ['from', 'where', 'orderBy', 'groupBy', 'limit', 'offset', 'leftJoin', 'innerJoin'];
  for (const m of methods) { self[m] = vi.fn().mockReturnValue(self); }
  self.then = (resolve: any) => Promise.resolve(resolveValue).then(resolve);
  return self;
}

function makeRes() {
  const res: any = {};
  res.status = vi.fn().mockReturnValue(res);
  res.send = vi.fn().mockReturnValue(res);
  res.json = vi.fn().mockReturnValue(res);
  res.redirect = vi.fn().mockReturnValue(res);
  return res;
}

function makeReq(overrides: Partial<any> = {}): any {
  return {
    session: { userId: 'user-1' },
    params: {},
    body: {},
    query: {},
    ...overrides,
  };
}

// Sample task fixture
const sampleTask = {
  id: 'task-1',
  userId: 'user-1',
  name: 'Daily Standup',
  description: 'Generates standup summary',
  taskType: 'JIRA_STANDUP_SUMMARY',
  schedule: '0 9 * * 1-5',
  timezone: 'America/New_York',
  config: { project: 'PROJ' },
  enabled: true,
  notifySlack: '#general',
  notifyEmail: null,
  lastRunAt: new Date('2024-01-01T09:00:00Z'),
  nextRunAt: new Date('2024-01-02T09:00:00Z'),
  createdAt: new Date('2024-01-01T00:00:00Z'),
  updatedAt: new Date('2024-01-01T00:00:00Z'),
};

// ============================================================
// Route handler extraction helper
// The taskRouter is an Express Router; we need to invoke handlers directly.
// We find route handlers by iterating the router's stack.
// ============================================================

function findRouteHandler(method: string, path: string): Function[] {
  const stack = (taskRouter as any).stack as any[];
  for (const layer of stack) {
    if (!layer.route) continue;
    if (
      layer.route.path === path &&
      layer.route.methods[method.toLowerCase()]
    ) {
      // Return all handler functions (skipping middleware)
      return layer.route.stack.map((l: any) => l.handle);
    }
  }
  return [];
}

async function invokeRoute(method: string, path: string, req: any, res: any) {
  const handlers = findRouteHandler(method, path);
  expect(handlers.length).toBeGreaterThan(0);
  const next = vi.fn();
  for (const handler of handlers) {
    await handler(req, res, next);
    // If next was called with an error or res.redirect/send was called, stop
    if (res.redirect.mock.calls.length || res.send.mock.calls.length || res.json.mock.calls.length || res.status.mock.calls.length) {
      break;
    }
  }
}

beforeEach(() => {
  vi.clearAllMocks();
});

// ============================================================
// GET / — task list page
// ============================================================

describe('GET / — task list', () => {
  it('renders HTML page with scheduler status', async () => {
    // tasks query
    vi.mocked(db.select)
      .mockReturnValueOnce(chainable([sampleTask]))  // tasks
      .mockReturnValueOnce(chainable([]));            // task runs

    const req = makeReq();
    const res = makeRes();
    await invokeRoute('get', '/', req, res);

    expect(res.send).toHaveBeenCalledOnce();
    const html = res.send.mock.calls[0][0] as string;
    expect(html).toContain('Scheduled Tasks');
    expect(html).toContain('3 active tasks');
    expect(html).toContain('Daily Standup');
  });

  it('shows empty state when no tasks exist', async () => {
    vi.mocked(db.select).mockReturnValueOnce(chainable([]));

    const req = makeReq();
    const res = makeRes();
    await invokeRoute('get', '/', req, res);

    expect(res.send).toHaveBeenCalledOnce();
    const html = res.send.mock.calls[0][0] as string;
    expect(html).toContain('No scheduled tasks yet');
  });
});

// ============================================================
// POST /create
// ============================================================

describe('POST /create', () => {
  it('creates task and redirects to /tasks', async () => {
    vi.mocked(db.insert).mockReturnValue({
      values: vi.fn().mockReturnValue({
        returning: vi.fn().mockResolvedValue([sampleTask]),
      }),
    } as any);

    const req = makeReq({
      body: {
        name: 'Daily Standup',
        description: 'Standup summary',
        taskType: 'JIRA_STANDUP_SUMMARY',
        schedule: '0 9 * * 1-5',
        timezone: 'America/New_York',
        config: '{"project":"PROJ"}',
        notifySlack: '#general',
        notifyEmail: '',
      },
    });
    const res = makeRes();
    await invokeRoute('post', '/create', req, res);

    expect(db.insert).toHaveBeenCalledOnce();
    expect(vi.mocked(scheduleTask)).toHaveBeenCalledWith(sampleTask);
    expect(res.redirect).toHaveBeenCalledWith('/tasks');
  });

  it('returns 400 for invalid cron expression', async () => {
    const req = makeReq({
      body: {
        name: 'Bad Task',
        taskType: 'JIRA_STANDUP_SUMMARY',
        schedule: 'INVALID_CRON',
        config: '{}',
      },
    });
    const res = makeRes();
    await invokeRoute('post', '/create', req, res);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.send).toHaveBeenCalledWith('Invalid cron expression');
    expect(db.insert).not.toHaveBeenCalled();
  });

  it('returns 400 for invalid JSON config', async () => {
    const req = makeReq({
      body: {
        name: 'Task',
        taskType: 'JIRA_STANDUP_SUMMARY',
        schedule: '0 9 * * *',
        config: '{not-valid-json}',
      },
    });
    const res = makeRes();
    await invokeRoute('post', '/create', req, res);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.send).toHaveBeenCalledWith('Invalid JSON in configuration');
  });

  it('uses default timezone when not provided', async () => {
    vi.mocked(db.insert).mockReturnValue({
      values: vi.fn().mockReturnValue({
        returning: vi.fn().mockResolvedValue([sampleTask]),
      }),
    } as any);

    const req = makeReq({
      body: {
        name: 'Task',
        taskType: 'JIRA_STANDUP_SUMMARY',
        schedule: '0 9 * * *',
        config: '{}',
        timezone: '',
      },
    });
    const res = makeRes();
    await invokeRoute('post', '/create', req, res);

    const insertValues = (vi.mocked(db.insert).mock.results[0].value.values as any).mock.calls[0][0];
    expect(insertValues.timezone).toBe('America/New_York');
  });

  it('handles scheduleTask error gracefully (still redirects)', async () => {
    vi.mocked(db.insert).mockReturnValue({
      values: vi.fn().mockReturnValue({
        returning: vi.fn().mockResolvedValue([sampleTask]),
      }),
    } as any);
    vi.mocked(scheduleTask).mockImplementationOnce(() => {
      throw new Error('Schedule error');
    });

    const req = makeReq({
      body: {
        name: 'Task',
        taskType: 'JIRA_STANDUP_SUMMARY',
        schedule: '0 9 * * *',
        config: '{}',
      },
    });
    const res = makeRes();
    await invokeRoute('post', '/create', req, res);

    expect(res.redirect).toHaveBeenCalledWith('/tasks');
  });
});

// ============================================================
// POST /:id/toggle
// ============================================================

describe('POST /:id/toggle', () => {
  it('toggles task enabled state and reloads', async () => {
    vi.mocked(db.select).mockReturnValue(chainable([sampleTask]));
    vi.mocked(db.update).mockReturnValue({
      set: vi.fn().mockReturnValue({
        where: vi.fn().mockResolvedValue(undefined),
      }),
    } as any);

    const req = makeReq({ params: { id: 'task-1' } });
    const res = makeRes();
    await invokeRoute('post', '/:id/toggle', req, res);

    expect(db.update).toHaveBeenCalledOnce();
    expect(vi.mocked(reloadTask)).toHaveBeenCalledWith('task-1');
    expect(res.redirect).toHaveBeenCalledWith('/tasks');
  });

  it('returns 404 when task not found', async () => {
    vi.mocked(db.select).mockReturnValue(chainable([]));

    const req = makeReq({ params: { id: 'nonexistent' } });
    const res = makeRes();
    await invokeRoute('post', '/:id/toggle', req, res);

    expect(res.status).toHaveBeenCalledWith(404);
    expect(res.send).toHaveBeenCalledWith('Task not found');
  });
});

// ============================================================
// POST /:id/run
// ============================================================

describe('POST /:id/run', () => {
  it('starts task run and returns success json', async () => {
    vi.mocked(db.select).mockReturnValue(chainable([sampleTask]));

    const req = makeReq({ params: { id: 'task-1' } });
    const res = makeRes();
    await invokeRoute('post', '/:id/run', req, res);

    expect(vi.mocked(runTask)).toHaveBeenCalledWith('task-1');
    expect(res.json).toHaveBeenCalledWith({ success: true, message: 'Task started' });
  });

  it('returns 404 when task not found', async () => {
    vi.mocked(db.select).mockReturnValue(chainable([]));

    const req = makeReq({ params: { id: 'nonexistent' } });
    const res = makeRes();
    await invokeRoute('post', '/:id/run', req, res);

    expect(res.status).toHaveBeenCalledWith(404);
    expect(res.send).toHaveBeenCalledWith('Task not found');
  });
});

// ============================================================
// POST /:id/delete
// ============================================================

describe('POST /:id/delete', () => {
  it('unschedules and deletes task, then redirects', async () => {
    vi.mocked(db.select).mockReturnValue(chainable([sampleTask]));
    vi.mocked(db.delete).mockReturnValue({
      where: vi.fn().mockResolvedValue(undefined),
    } as any);

    const req = makeReq({ params: { id: 'task-1' } });
    const res = makeRes();
    await invokeRoute('post', '/:id/delete', req, res);

    expect(vi.mocked(unscheduleTask)).toHaveBeenCalledWith('task-1');
    expect(db.delete).toHaveBeenCalledOnce();
    expect(res.redirect).toHaveBeenCalledWith('/tasks');
  });

  it('returns 404 when task not found', async () => {
    vi.mocked(db.select).mockReturnValue(chainable([]));

    const req = makeReq({ params: { id: 'nonexistent' } });
    const res = makeRes();
    await invokeRoute('post', '/:id/delete', req, res);

    expect(res.status).toHaveBeenCalledWith(404);
    expect(res.send).toHaveBeenCalledWith('Task not found');
  });
});

// ============================================================
// GET /:id/edit
// ============================================================

describe('GET /:id/edit', () => {
  it('renders edit page for existing task', async () => {
    vi.mocked(db.select).mockReturnValue(chainable([sampleTask]));

    const req = makeReq({ params: { id: 'task-1' } });
    const res = makeRes();
    await invokeRoute('get', '/:id/edit', req, res);

    expect(res.send).toHaveBeenCalledOnce();
    const html = res.send.mock.calls[0][0] as string;
    expect(html).toContain('Edit Task');
    expect(html).toContain('Daily Standup');
  });

  it('returns 404 when task not found', async () => {
    vi.mocked(db.select).mockReturnValue(chainable([]));

    const req = makeReq({ params: { id: 'nonexistent' } });
    const res = makeRes();
    await invokeRoute('get', '/:id/edit', req, res);

    expect(res.status).toHaveBeenCalledWith(404);
    expect(res.send).toHaveBeenCalledWith('Task not found');
  });
});

// ============================================================
// POST /:id/update
// ============================================================

describe('POST /:id/update', () => {
  it('updates task and reloads schedule, then redirects', async () => {
    vi.mocked(db.select).mockReturnValue(chainable([sampleTask]));
    vi.mocked(db.update).mockReturnValue({
      set: vi.fn().mockReturnValue({
        where: vi.fn().mockResolvedValue(undefined),
      }),
    } as any);

    const req = makeReq({
      params: { id: 'task-1' },
      body: {
        name: 'Updated Task',
        description: 'New description',
        schedule: '0 10 * * *',
        timezone: 'UTC',
        config: '{"project":"NEW"}',
        notifySlack: '#dev',
        notifyEmail: '',
      },
    });
    const res = makeRes();
    await invokeRoute('post', '/:id/update', req, res);

    expect(db.update).toHaveBeenCalledOnce();
    expect(vi.mocked(reloadTask)).toHaveBeenCalledWith('task-1');
    expect(res.redirect).toHaveBeenCalledWith('/tasks');
  });

  it('returns 404 when task not found', async () => {
    vi.mocked(db.select).mockReturnValue(chainable([]));

    const req = makeReq({
      params: { id: 'nonexistent' },
      body: { schedule: '0 9 * * *', config: '{}' },
    });
    const res = makeRes();
    await invokeRoute('post', '/:id/update', req, res);

    expect(res.status).toHaveBeenCalledWith(404);
    expect(res.send).toHaveBeenCalledWith('Task not found');
  });

  it('returns 400 for invalid cron expression', async () => {
    vi.mocked(db.select).mockReturnValue(chainable([sampleTask]));

    const req = makeReq({
      params: { id: 'task-1' },
      body: { schedule: 'INVALID_CRON', config: '{}' },
    });
    const res = makeRes();
    await invokeRoute('post', '/:id/update', req, res);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.send).toHaveBeenCalledWith('Invalid cron expression');
  });

  it('returns 400 for invalid JSON config in update', async () => {
    vi.mocked(db.select).mockReturnValue(chainable([sampleTask]));

    const req = makeReq({
      params: { id: 'task-1' },
      body: { schedule: '0 9 * * *', config: '{bad json}' },
    });
    const res = makeRes();
    await invokeRoute('post', '/:id/update', req, res);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.send).toHaveBeenCalledWith('Invalid JSON in configuration');
  });
});

// ============================================================
// GET /api/status
// ============================================================

describe('GET /api/status', () => {
  it('returns scheduler status as JSON', async () => {
    const req = makeReq();
    const res = makeRes();
    await invokeRoute('get', '/api/status', req, res);

    expect(vi.mocked(getSchedulerStatus)).toHaveBeenCalledOnce();
    expect(res.json).toHaveBeenCalledWith({ activeTaskCount: 3, taskIds: ['t1', 't2', 't3'] });
  });
});

// ============================================================
// POST /api/test-notification
// ============================================================

describe('POST /api/test-notification', () => {
  it('sends test notification and returns result', async () => {
    const req = makeReq({
      body: { channel: 'slack', destination: '#alerts' },
    });
    const res = makeRes();
    await invokeRoute('post', '/api/test-notification', req, res);

    expect(vi.mocked(sendTestNotification)).toHaveBeenCalledWith('user-1', 'slack', '#alerts');
    expect(res.json).toHaveBeenCalledWith({ success: true, message: 'Test sent' });
  });
});
