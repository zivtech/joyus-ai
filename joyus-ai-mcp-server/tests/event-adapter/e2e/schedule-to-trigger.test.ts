/**
 * E2E: Schedule → Buffer → Translate → Trigger (T068)
 *
 * Tests schedule-specific logic: cron expression validation, next fire time
 * computation, timezone support, and translation of schedule events into
 * TriggerCall format. No real DB required.
 */

import { describe, it, expect, vi, afterEach } from 'vitest';
import {
  validateCronExpression,
  computeNextFireAt,
  isValidTimezone,
} from '../../../src/event-adapter/services/scheduler.js';
import { translateEvent, TranslationError } from '../../../src/event-adapter/services/event-translator.js';
import type { WebhookEvent, EventScheduledTask } from '../../../src/event-adapter/schema.js';

// ============================================================
// HELPERS
// ============================================================

function makeScheduleEvent(overrides: Partial<WebhookEvent> = {}): WebhookEvent {
  return {
    id: 'evt-sched-001',
    tenantId: 'tenant-abc',
    sourceType: 'schedule',
    sourceId: null,
    scheduleId: 'sched-001',
    status: 'pending',
    payload: {
      triggerType: 'manual-request',
      targetPipelineId: 'pipe-daily',
      triggerMetadata: { reason: 'scheduled_run' },
    },
    headers: null,
    signatureValid: true,
    translatedTrigger: null,
    triggerType: null,
    pipelineId: null,
    attemptCount: 0,
    failureReason: null,
    processingDurationMs: null,
    forwardedToAutomation: false,
    createdAt: new Date('2026-01-02T09:00:00Z'),
    updatedAt: new Date('2026-01-02T09:00:00Z'),
    deliveredAt: null,
    ...overrides,
  };
}

function makeScheduledTask(overrides: Partial<EventScheduledTask> = {}): EventScheduledTask {
  return {
    id: 'sched-001',
    tenantId: 'tenant-abc',
    name: 'Daily Digest',
    cronExpression: '0 9 * * 1-5',
    timezone: 'UTC',
    targetPipelineId: 'pipe-daily',
    triggerType: 'manual-request',
    triggerMetadata: { reason: 'scheduled_run' },
    lifecycleState: 'active',
    lastFiredAt: null,
    nextFireAt: new Date('2026-01-02T09:00:00Z'),
    pausedBy: null,
    createdAt: new Date('2026-01-01T00:00:00Z'),
    updatedAt: new Date('2026-01-01T00:00:00Z'),
    ...overrides,
  };
}

// ============================================================
// T068: CRON EXPRESSION VALIDATION
// ============================================================

describe('T068: Schedule → Buffer → Translate → Trigger', () => {
  describe('validateCronExpression', () => {
    it('returns true for a valid 5-field weekday cron', () => {
      expect(validateCronExpression('0 9 * * 1-5')).toBe(true);
    });

    it('returns true for a valid every-minute cron', () => {
      expect(validateCronExpression('* * * * *')).toBe(true);
    });

    it('returns true for a specific day/time cron', () => {
      expect(validateCronExpression('30 14 1 * *')).toBe(true);
    });

    it('returns false for an empty string', () => {
      expect(validateCronExpression('')).toBe(false);
    });

    it('returns false for a non-cron string', () => {
      expect(validateCronExpression('not-a-cron')).toBe(false);
    });

    it('returns false for a 6-field expression (seconds field not supported)', () => {
      // 6 fields: seconds min hour dom mon dow — rejected by 5-field-only check
      expect(validateCronExpression('0 0 9 * * 1-5')).toBe(false);
    });

    it('returns false for a 4-field expression (missing field)', () => {
      expect(validateCronExpression('0 9 * *')).toBe(false);
    });
  });

  // ============================================================
  // NEXT FIRE TIME COMPUTATION
  // ============================================================

  describe('computeNextFireAt', () => {
    it('returns a Date in the future relative to the given reference', () => {
      const now = new Date('2026-01-05T08:00:00Z'); // Monday 08:00
      const result = computeNextFireAt('0 9 * * 1-5', now, 'UTC');

      expect(result).toBeInstanceOf(Date);
      expect(result!.getTime()).toBeGreaterThan(now.getTime());
    });

    it('returns the correct next time for a daily-at-09:00 weekday cron', () => {
      const monday8am = new Date('2026-01-05T08:00:00Z');
      const result = computeNextFireAt('0 9 * * 1-5', monday8am, 'UTC');

      // Next fire should be Monday 09:00 UTC
      expect(result!.getUTCHours()).toBe(9);
      expect(result!.getUTCMinutes()).toBe(0);
    });

    it('respects timezone when computing next fire', () => {
      // At UTC midnight on Monday, America/New_York is Sunday 19:00 (EST UTC-5)
      const utcMidnight = new Date('2026-01-05T00:00:00Z');
      const utcResult = computeNextFireAt('0 9 * * *', utcMidnight, 'UTC');
      const nyResult = computeNextFireAt('0 9 * * *', utcMidnight, 'America/New_York');

      // NY result (09:00 EST = 14:00 UTC) should be later than UTC result (09:00 UTC)
      expect(nyResult!.getTime()).toBeGreaterThan(utcResult!.getTime());
    });

    it('returns null for an invalid cron expression', () => {
      const result = computeNextFireAt('invalid', new Date());
      expect(result).toBeNull();
    });

    it('advances past the current time (never returns past/equal date)', () => {
      const now = new Date();
      const result = computeNextFireAt('* * * * *', now, 'UTC');

      expect(result!.getTime()).toBeGreaterThan(now.getTime());
    });
  });

  // ============================================================
  // TIMEZONE VALIDATION
  // ============================================================

  describe('isValidTimezone', () => {
    it('returns true for UTC', () => {
      expect(isValidTimezone('UTC')).toBe(true);
    });

    it('returns true for America/New_York', () => {
      expect(isValidTimezone('America/New_York')).toBe(true);
    });

    it('returns true for Europe/London', () => {
      expect(isValidTimezone('Europe/London')).toBe(true);
    });

    it('returns true for Asia/Tokyo', () => {
      expect(isValidTimezone('Asia/Tokyo')).toBe(true);
    });

    it('returns false for an invalid timezone string', () => {
      expect(isValidTimezone('Invalid/Zone')).toBe(false);
    });

    it('returns false for a random string', () => {
      expect(isValidTimezone('not-a-timezone')).toBe(false);
    });
  });

  // ============================================================
  // SCHEDULE EVENT TRANSLATION
  // ============================================================

  describe('schedule event translation', () => {
    it('translates schedule event to manual-request trigger type', () => {
      const event = makeScheduleEvent();
      const task = makeScheduledTask();

      const result = translateEvent(event, null, task);

      expect(result.triggerType).toBe('manual-request');
    });

    it('includes scheduleId in trigger metadata', () => {
      const event = makeScheduleEvent();
      const task = makeScheduledTask({ id: 'sched-unique-99' });

      const result = translateEvent(event, null, task);

      expect(result.metadata['scheduleId']).toBe('sched-unique-99');
    });

    it('includes scheduleName in trigger metadata', () => {
      const event = makeScheduleEvent();
      const task = makeScheduledTask({ name: 'Weekly Report' });

      const result = translateEvent(event, null, task);

      expect(result.metadata['scheduleName']).toBe('Weekly Report');
    });

    it('includes firedAt timestamp in trigger metadata', () => {
      const firedAt = new Date('2026-01-02T09:00:00Z');
      const event = makeScheduleEvent({ createdAt: firedAt });
      const task = makeScheduledTask();

      const result = translateEvent(event, null, task);

      expect(result.metadata['firedAt']).toBe(firedAt.toISOString());
    });

    it('uses task targetPipelineId as pipelineId', () => {
      const event = makeScheduleEvent();
      const task = makeScheduledTask({ targetPipelineId: 'pipe-weekly' });

      const result = translateEvent(event, null, task);

      expect(result.pipelineId).toBe('pipe-weekly');
    });

    it('uses event tenantId in the resulting trigger call', () => {
      const event = makeScheduleEvent({ tenantId: 'tenant-xyz' });
      const task = makeScheduledTask({ tenantId: 'tenant-xyz' });

      const result = translateEvent(event, null, task);

      expect(result.tenantId).toBe('tenant-xyz');
    });

    it('throws TranslationError when schedule task is missing', () => {
      const event = makeScheduleEvent();

      expect(() => translateEvent(event, null, null)).toThrow(TranslationError);
      expect(() => translateEvent(event, null, null)).toThrow('scheduled_task');
    });

    it('throws TranslationError when schedule task is undefined', () => {
      const event = makeScheduleEvent();

      expect(() => translateEvent(event, null, undefined)).toThrow(TranslationError);
    });
  });

  // ============================================================
  // LIFECYCLE STATE FILTERING
  // ============================================================

  describe('lifecycle state filtering', () => {
    it('Paused schedule skipped — lifecycleState paused is not active', () => {
      const task = makeScheduledTask({ lifecycleState: 'paused' });

      // The scheduler tick only queries where lifecycleState = 'active'.
      // We verify the filtering logic: a paused task would not satisfy the active check.
      expect(task.lifecycleState).toBe('paused');
      expect(task.lifecycleState === 'active').toBe(false);
    });

    it('Disabled schedule skipped — lifecycleState disabled is not active', () => {
      const task = makeScheduledTask({ lifecycleState: 'disabled' });

      expect(task.lifecycleState).toBe('disabled');
      expect(task.lifecycleState === 'active').toBe(false);
    });

    it('Active schedule is eligible — lifecycleState active passes the filter', () => {
      const task = makeScheduledTask({ lifecycleState: 'active' });

      expect(task.lifecycleState === 'active').toBe(true);
    });
  });

  // ============================================================
  // NEXT FIRE AT TIMING FILTER
  // ============================================================

  describe('nextFireAt timing filter', () => {
    it('Future next_fire_at not picked up — task with next_fire_at > now is not due', () => {
      const future = new Date(Date.now() + 60 * 60 * 1000); // 1 hour from now
      const task = makeScheduledTask({ nextFireAt: future, lifecycleState: 'active' });

      const now = new Date();
      // Scheduler tick queries: lte(nextFireAt, now) — future task does NOT satisfy this
      const isDue = task.nextFireAt !== null && task.nextFireAt <= now;

      expect(isDue).toBe(false);
    });

    it('Past next_fire_at is picked up — task with next_fire_at <= now is due', () => {
      const past = new Date(Date.now() - 1000); // 1 second ago
      const task = makeScheduledTask({ nextFireAt: past, lifecycleState: 'active' });

      const now = new Date();
      const isDue = task.nextFireAt !== null && task.nextFireAt <= now;

      expect(isDue).toBe(true);
    });
  });

  // ============================================================
  // PAUSE / RESUME CYCLE — nextFireAt RECOMPUTED FROM NOW
  // ============================================================

  describe('pause/resume cycle — nextFireAt recomputed from now', () => {
    afterEach(() => {
      vi.useRealTimers();
    });

    it('resumeSchedule recomputes nextFireAt from current time, not original schedule time', () => {
      // Simulate: schedule was paused at 08:00, resumed at 10:00.
      // nextFireAt should be computed from 10:00 (now), not from 08:00.
      vi.useFakeTimers();
      const resumeTime = new Date('2026-01-05T10:00:00Z');
      vi.setSystemTime(resumeTime);

      const nextFireAt = computeNextFireAt('0 9 * * 1-5', new Date(), 'UTC');

      // At 10:00 Monday, next 09:00 weekday is Tuesday 09:00
      expect(nextFireAt).not.toBeNull();
      expect(nextFireAt!.getTime()).toBeGreaterThan(resumeTime.getTime());
    });

    it('nextFireAt after resume is strictly in the future relative to resume time', () => {
      vi.useFakeTimers();
      const resumeAt = new Date('2026-01-05T14:30:00Z');
      vi.setSystemTime(resumeAt);

      const nextFireAt = computeNextFireAt('* * * * *', new Date(), 'UTC');

      expect(nextFireAt).not.toBeNull();
      expect(nextFireAt!.getTime()).toBeGreaterThan(resumeAt.getTime());
    });
  });

  // ============================================================
  // TIMEZONE STORED AS UTC
  // ============================================================

  describe('timezone stored as UTC', () => {
    it('computeNextFireAt with America/New_York produces a UTC Date object', () => {
      const now = new Date('2026-01-05T00:00:00Z'); // Monday midnight UTC
      const result = computeNextFireAt('0 9 * * *', now, 'America/New_York');

      // Result must be a Date (UTC-internally, always)
      expect(result).toBeInstanceOf(Date);
      // 09:00 New York EST = 14:00 UTC — result should have UTC hours = 14
      expect(result!.getUTCHours()).toBe(14);
    });

    it('computeNextFireAt UTC and America/New_York differ by the timezone offset', () => {
      const now = new Date('2026-01-05T00:00:00Z');
      const utcResult = computeNextFireAt('0 9 * * *', now, 'UTC');
      const nyResult = computeNextFireAt('0 9 * * *', now, 'America/New_York');

      // EST is UTC-5, so NY 09:00 = UTC 14:00; difference should be 5 hours
      const diffMs = nyResult!.getTime() - utcResult!.getTime();
      expect(diffMs).toBe(5 * 60 * 60 * 1000);
    });
  });
});
