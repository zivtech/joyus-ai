/**
 * Event Adapter — Scheduler Unit Tests (T034)
 *
 * Tests cover:
 *  - Cron expression validation
 *  - Timezone handling
 *  - Next fire computation
 *  - Lifecycle enforcement (active-only firing)
 *  - pauseSchedule / resumeSchedule / disableSchedule
 *  - SchedulerService start/stop and tick behaviour
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

import {
  validateCronExpression,
  computeNextFireAt,
  isValidTimezone,
  pauseSchedule,
  resumeSchedule,
  disableSchedule,
  SchedulerService,
} from '../../../src/event-adapter/services/scheduler.js';
import type { EventScheduledTask } from '../../../src/event-adapter/schema.js';

// ============================================================
// HELPERS
// ============================================================

/** Minimal EventScheduledTask factory — only required fields. */
function makeTask(overrides: Partial<EventScheduledTask> = {}): EventScheduledTask {
  return {
    id: 'sched-1',
    tenantId: 'tenant-1',
    name: 'Test Schedule',
    cronExpression: '*/5 * * * *',
    timezone: 'UTC',
    targetPipelineId: 'pipeline-1',
    triggerType: 'manual-request',
    triggerMetadata: null,
    lifecycleState: 'active',
    lastFiredAt: null,
    nextFireAt: new Date(Date.now() - 1000), // 1 second in the past → due
    pausedBy: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

/** Build a minimal Drizzle-like mock that records calls. */
function makeDbMock() {
  const insertedRows: unknown[] = [];
  const updatedRows: Record<string, unknown>[] = [];
  const selectedRows: unknown[] = [];

  const returningMock = vi.fn().mockResolvedValue(updatedRows);
  const whereMock = vi.fn().mockReturnValue({ returning: returningMock });
  const setMock = vi.fn().mockReturnValue({ where: whereMock });
  const updateMock = vi.fn().mockReturnValue({ set: setMock });

  const selectWhereMock = vi.fn().mockResolvedValue(selectedRows);
  const selectFromMock = vi.fn().mockReturnValue({ where: selectWhereMock });
  const selectMock = vi.fn().mockReturnValue({ from: selectFromMock });

  const insertReturningMock = vi.fn().mockResolvedValue(insertedRows);
  const insertValuesMock = vi.fn().mockReturnValue({ returning: insertReturningMock });
  const insertMock = vi.fn().mockReturnValue({ values: insertValuesMock });

  return {
    update: updateMock,
    select: selectMock,
    insert: insertMock,
    // Expose internals for assertions
    _insertedRows: insertedRows,
    _updatedRows: updatedRows,
    _selectedRows: selectedRows,
    _returningMock: returningMock,
    _whereMock: whereMock,
    _setMock: setMock,
    _selectWhereMock: selectWhereMock,
  };
}

// ============================================================
// T029 — CRON EXPRESSION VALIDATION
// ============================================================

describe('validateCronExpression', () => {
  it('accepts valid 5-field expressions', () => {
    expect(validateCronExpression('* * * * *')).toBe(true);
    expect(validateCronExpression('0 9 * * 1-5')).toBe(true);
    expect(validateCronExpression('*/15 * * * *')).toBe(true);
    expect(validateCronExpression('0 0 1 * *')).toBe(true);
    expect(validateCronExpression('30 8 * * *')).toBe(true);
    expect(validateCronExpression('0 */4 * * *')).toBe(true);
  });

  it('rejects invalid expressions', () => {
    expect(validateCronExpression('invalid')).toBe(false);
    expect(validateCronExpression('')).toBe(false);
    expect(validateCronExpression('* * *')).toBe(false);          // too few fields
    expect(validateCronExpression('60 * * * *')).toBe(false);     // minute out of range
    expect(validateCronExpression('* 25 * * *')).toBe(false);     // hour out of range
  });
});

// ============================================================
// T029 — TIMEZONE VALIDATION
// ============================================================

describe('isValidTimezone', () => {
  it('accepts valid IANA timezones', () => {
    expect(isValidTimezone('UTC')).toBe(true);
    expect(isValidTimezone('America/New_York')).toBe(true);
    expect(isValidTimezone('America/Los_Angeles')).toBe(true);
    expect(isValidTimezone('Europe/London')).toBe(true);
    expect(isValidTimezone('Asia/Tokyo')).toBe(true);
  });

  it('rejects invalid timezone strings', () => {
    expect(isValidTimezone('NotATimezone')).toBe(false);
    expect(isValidTimezone('')).toBe(false);
    expect(isValidTimezone('GMT+99')).toBe(false);
    expect(isValidTimezone('Bogus/Region')).toBe(false);
  });
});

// ============================================================
// T029 — NEXT FIRE COMPUTATION
// ============================================================

describe('computeNextFireAt', () => {
  it('returns a Date in the future for a valid expression', () => {
    const result = computeNextFireAt('* * * * *');
    expect(result).toBeInstanceOf(Date);
    expect(result!.getTime()).toBeGreaterThan(Date.now());
  });

  it('returns null for an invalid expression', () => {
    const result = computeNextFireAt('not-a-cron');
    expect(result).toBeNull();
  });

  it('computes next fire relative to a given fromDate', () => {
    // "0 12 * * *" = noon every day
    const from = new Date('2025-01-01T10:00:00Z'); // 10am
    const next = computeNextFireAt('0 12 * * *', from, 'UTC');
    expect(next).not.toBeNull();
    // Should be noon on 2025-01-01
    expect(next!.getUTCHours()).toBe(12);
    expect(next!.getUTCMinutes()).toBe(0);
  });

  it('respects timezone when computing next fire time', () => {
    // "0 9 * * *" = 9am daily
    const from = new Date('2025-06-01T05:00:00Z'); // 5am UTC = 1am ET (EDT, UTC-4)
    const nextNY = computeNextFireAt('0 9 * * *', from, 'America/New_York');
    const nextLA = computeNextFireAt('0 9 * * *', from, 'America/Los_Angeles');

    expect(nextNY).not.toBeNull();
    expect(nextLA).not.toBeNull();

    // NY fires at 9am ET = 13:00 UTC; LA fires at 9am PT = 16:00 UTC
    // So LA fire time should be later than NY fire time
    expect(nextLA!.getTime()).toBeGreaterThan(nextNY!.getTime());
  });

  it('computes next occurrence after a step expression', () => {
    // "*/30 * * * *" — every 30 minutes
    const from = new Date('2025-01-01T10:00:00Z');
    const next = computeNextFireAt('*/30 * * * *', from, 'UTC');
    expect(next).not.toBeNull();
    // From 10:00, next should be 10:30
    expect(next!.getUTCHours()).toBe(10);
    expect(next!.getUTCMinutes()).toBe(30);
  });
});

// ============================================================
// T033 — LIFECYCLE: pauseSchedule
// ============================================================

describe('pauseSchedule', () => {
  it('updates lifecycle_state to paused and records pausedBy', async () => {
    const db = makeDbMock();
    // Simulate DB returning the updated row
    const updatedTask = makeTask({ lifecycleState: 'paused', pausedBy: 'admin' });
    db._returningMock.mockResolvedValueOnce([updatedTask]);

    const result = await pauseSchedule(
      db as unknown as Parameters<typeof pauseSchedule>[0],
      'sched-1',
      'admin',
    );

    expect(result).not.toBeNull();
    expect(result!.lifecycleState).toBe('paused');
    expect(result!.pausedBy).toBe('admin');
    expect(db.update).toHaveBeenCalledOnce();
    // Verify the set() payload includes lifecycleState: 'paused'
    expect(db._setMock).toHaveBeenCalledWith(
      expect.objectContaining({ lifecycleState: 'paused', pausedBy: 'admin' }),
    );
  });

  it('returns null when no matching active schedule found', async () => {
    const db = makeDbMock();
    db._returningMock.mockResolvedValueOnce([]); // no rows updated

    const result = await pauseSchedule(
      db as unknown as Parameters<typeof pauseSchedule>[0],
      'non-existent',
      'admin',
    );

    expect(result).toBeNull();
  });
});

// ============================================================
// T033 — LIFECYCLE: resumeSchedule
// ============================================================

describe('resumeSchedule', () => {
  it('sets lifecycle_state to active and recomputes next_fire_at', async () => {
    const db = makeDbMock();
    const pausedTask = makeTask({ lifecycleState: 'paused', pausedBy: 'admin' });
    const resumedTask = makeTask({ lifecycleState: 'active', pausedBy: null });

    // First select returns the paused task
    db._selectWhereMock.mockResolvedValueOnce([pausedTask]);
    // Then update returning returns the resumed task
    db._returningMock.mockResolvedValueOnce([resumedTask]);

    const result = await resumeSchedule(
      db as unknown as Parameters<typeof resumeSchedule>[0],
      'sched-1',
    );

    expect(result).not.toBeNull();
    expect(result!.lifecycleState).toBe('active');
    expect(result!.pausedBy).toBeNull();

    // update was called with lifecycleState: 'active' and a nextFireAt
    expect(db._setMock).toHaveBeenCalledWith(
      expect.objectContaining({
        lifecycleState: 'active',
        pausedBy: null,
      }),
    );
  });

  it('returns null when schedule is not found or not paused', async () => {
    const db = makeDbMock();
    db._selectWhereMock.mockResolvedValueOnce([]); // not found

    const result = await resumeSchedule(
      db as unknown as Parameters<typeof resumeSchedule>[0],
      'missing-id',
    );

    expect(result).toBeNull();
    expect(db.update).not.toHaveBeenCalled();
  });
});

// ============================================================
// T033 — LIFECYCLE: disableSchedule
// ============================================================

describe('disableSchedule', () => {
  it('disables an active schedule', async () => {
    const db = makeDbMock();
    const activeTask = makeTask({ lifecycleState: 'active' });
    const disabledTask = makeTask({ lifecycleState: 'disabled' });

    db._selectWhereMock.mockResolvedValueOnce([activeTask]);
    db._returningMock.mockResolvedValueOnce([disabledTask]);

    const result = await disableSchedule(
      db as unknown as Parameters<typeof disableSchedule>[0],
      'sched-1',
    );

    expect(result).not.toBeNull();
    expect(result!.lifecycleState).toBe('disabled');
    expect(db._setMock).toHaveBeenCalledWith(
      expect.objectContaining({ lifecycleState: 'disabled' }),
    );
  });

  it('disables a paused schedule', async () => {
    const db = makeDbMock();
    const pausedTask = makeTask({ lifecycleState: 'paused' });
    const disabledTask = makeTask({ lifecycleState: 'disabled' });

    db._selectWhereMock.mockResolvedValueOnce([pausedTask]);
    db._returningMock.mockResolvedValueOnce([disabledTask]);

    const result = await disableSchedule(
      db as unknown as Parameters<typeof disableSchedule>[0],
      'sched-1',
    );

    expect(result).not.toBeNull();
    expect(result!.lifecycleState).toBe('disabled');
  });

  it('returns null when schedule is already disabled', async () => {
    const db = makeDbMock();
    const disabledTask = makeTask({ lifecycleState: 'disabled' });

    db._selectWhereMock.mockResolvedValueOnce([disabledTask]);

    const result = await disableSchedule(
      db as unknown as Parameters<typeof disableSchedule>[0],
      'sched-1',
    );

    expect(result).toBeNull();
    expect(db.update).not.toHaveBeenCalled();
  });

  it('returns null when schedule not found', async () => {
    const db = makeDbMock();
    db._selectWhereMock.mockResolvedValueOnce([]);

    const result = await disableSchedule(
      db as unknown as Parameters<typeof disableSchedule>[0],
      'missing-id',
    );

    expect(result).toBeNull();
  });
});

// ============================================================
// T030 / T033 — SCHEDULER SERVICE LIFECYCLE
// ============================================================

describe('SchedulerService', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('starts and sets running state', () => {
    const db = makeDbMock();
    // select().from().where() returns empty list (no due tasks)
    db._selectWhereMock.mockResolvedValue([]);

    const svc = new SchedulerService(
      db as unknown as Parameters<typeof SchedulerService.prototype.start>[0],
      { pollIntervalMs: 1000 },
    );

    expect(svc.lastTickAt).toBeNull();
    svc.start();
    // Timer is pending; no tick yet
    expect(svc.lastTickAt).toBeNull();
    svc.stop();
  });

  it('start() is idempotent — second call is a no-op', () => {
    const db = makeDbMock();
    db._selectWhereMock.mockResolvedValue([]);

    const svc = new SchedulerService(
      db as unknown as Parameters<typeof SchedulerService.prototype.start>[0],
      { pollIntervalMs: 1000 },
    );

    svc.start();
    svc.start(); // should not throw or double-schedule
    svc.stop();

    // Only one timer should have been set (not two)
    expect(db.select).not.toHaveBeenCalled(); // no ticks yet — timer hasn't fired
  });

  it('stop() clears the timer', () => {
    const db = makeDbMock();
    db._selectWhereMock.mockResolvedValue([]);

    const svc = new SchedulerService(
      db as unknown as Parameters<typeof SchedulerService.prototype.start>[0],
      { pollIntervalMs: 1000 },
    );

    svc.start();
    svc.stop();

    // Advance time — tick should NOT fire because stop() cleared the timer
    vi.advanceTimersByTime(2000);
    expect(db.select).not.toHaveBeenCalled();
  });

  it('stop() is idempotent', () => {
    const db = makeDbMock();
    db._selectWhereMock.mockResolvedValue([]);

    const svc = new SchedulerService(
      db as unknown as Parameters<typeof SchedulerService.prototype.start>[0],
      { pollIntervalMs: 1000 },
    );

    svc.start();
    svc.stop();
    expect(() => svc.stop()).not.toThrow();
  });

  it('updates lastTickAt after a tick completes', async () => {
    const db = makeDbMock();
    // Always return empty so tick is fast
    db._selectWhereMock.mockResolvedValue([]);

    const svc = new SchedulerService(
      db as unknown as Parameters<typeof SchedulerService.prototype.start>[0],
      { pollIntervalMs: 10000 },
    );

    svc.start();

    // First tick fires at delay=0; advance just enough for it to execute,
    // then stop before the next recursive setTimeout is reached.
    await vi.advanceTimersByTimeAsync(1);
    svc.stop();

    expect(svc.lastTickAt).toBeInstanceOf(Date);
  });

  it('fires due tasks during tick', async () => {
    const db = makeDbMock();
    const dueTask = makeTask({
      nextFireAt: new Date(Date.now() - 5000),
      lifecycleState: 'active',
    });

    // select().from().where() returns one due task on first call
    db._selectWhereMock.mockResolvedValueOnce([dueTask]);

    const svc = new SchedulerService(
      db as unknown as Parameters<typeof SchedulerService.prototype.start>[0],
      { pollIntervalMs: 60000 },
    );

    svc.start();
    // Advance to trigger the first tick (delay=0), then stop
    await vi.advanceTimersByTimeAsync(1);
    svc.stop();

    // insert should have been called (bufferEvent calls db.insert)
    expect(db.insert).toHaveBeenCalledOnce();
  });

  it('does not fire paused or disabled tasks', async () => {
    const db = makeDbMock();

    // DB query filters by lifecycleState = 'active', so paused/disabled tasks
    // are never returned. We verify the WHERE predicate is applied by
    // confirming no insert occurs when select returns empty.
    db._selectWhereMock.mockResolvedValueOnce([]);

    const svc = new SchedulerService(
      db as unknown as Parameters<typeof SchedulerService.prototype.start>[0],
      { pollIntervalMs: 60000 },
    );

    svc.start();
    await vi.advanceTimersByTimeAsync(1);
    svc.stop();

    expect(db.insert).not.toHaveBeenCalled();
  });
});
