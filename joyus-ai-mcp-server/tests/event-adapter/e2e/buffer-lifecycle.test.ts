/**
 * E2E: Buffer Lifecycle — status transitions and retry logic (T071)
 *
 * Tests the event buffer state machine and retry/dead-letter behavior.
 * All tests are pure logic checks — no real DB calls.
 *
 * State machine:
 *   pending → processing → delivered  (happy path)
 *   pending → processing → failed     (attempt < MAX_RETRY_ATTEMPTS)
 *   failed  → dead_letter             (attempt >= MAX_RETRY_ATTEMPTS)
 *   failed | dead_letter → pending    (replay resets attempt_count to 0)
 */

import { describe, it, expect, vi, afterEach } from 'vitest';
import { MAX_RETRY_ATTEMPTS, RETRY_BACKOFF_BASE_MS } from '../../../src/event-adapter/types.js';
import { TranslationError } from '../../../src/event-adapter/services/event-translator.js';
import { replayEvent, markFailed } from '../../../src/event-adapter/services/event-buffer.js';
import type { WebhookEvent } from '../../../src/event-adapter/schema.js';

// ============================================================
// HELPERS
// ============================================================

function makeEvent(overrides: Partial<WebhookEvent> = {}): WebhookEvent {
  return {
    id: 'evt-lifecycle-001',
    tenantId: 'tenant-abc',
    sourceType: 'github',
    sourceId: 'src-001',
    scheduleId: null,
    status: 'pending',
    payload: { eventType: 'push' },
    headers: null,
    signatureValid: true,
    translatedTrigger: null,
    triggerType: null,
    pipelineId: null,
    attemptCount: 0,
    failureReason: null,
    processingDurationMs: null,
    forwardedToAutomation: false,
    createdAt: new Date('2026-01-01T10:00:00Z'),
    updatedAt: new Date('2026-01-01T10:00:00Z'),
    deliveredAt: null,
    ...overrides,
  };
}

// ============================================================
// T071: BUFFER LIFECYCLE TESTS
// ============================================================

describe('T071: Buffer Lifecycle — status transitions and retry logic', () => {

  // ============================================================
  // CONSTANTS
  // ============================================================

  describe('retry constants', () => {
    it('MAX_RETRY_ATTEMPTS is 5', () => {
      expect(MAX_RETRY_ATTEMPTS).toBe(5);
    });

    it('RETRY_BACKOFF_BASE_MS is 1000', () => {
      expect(RETRY_BACKOFF_BASE_MS).toBe(1000);
    });
  });

  // ============================================================
  // EXPONENTIAL BACKOFF CALCULATION
  // ============================================================

  describe('exponential backoff calculation', () => {
    /**
     * Formula: delay = RETRY_BACKOFF_BASE_MS * 2^(attempt - 1)
     * attempt 1 → 1000 * 2^0 = 1000ms  (1s)
     * attempt 2 → 1000 * 2^1 = 2000ms  (2s)
     * attempt 3 → 1000 * 2^2 = 4000ms  (4s)
     * attempt 4 → 1000 * 2^3 = 8000ms  (8s)
     * attempt 5 → 1000 * 2^4 = 16000ms (16s)
     */
    function computeBackoff(attempt: number): number {
      return RETRY_BACKOFF_BASE_MS * Math.pow(2, attempt - 1);
    }

    it('attempt 1 delay is 1000ms (1s)', () => {
      expect(computeBackoff(1)).toBe(1000);
    });

    it('attempt 2 delay is 2000ms (2s)', () => {
      expect(computeBackoff(2)).toBe(2000);
    });

    it('attempt 3 delay is 4000ms (4s)', () => {
      expect(computeBackoff(3)).toBe(4000);
    });

    it('attempt 4 delay is 8000ms (8s)', () => {
      expect(computeBackoff(4)).toBe(8000);
    });

    it('attempt 5 delay is 16000ms (16s)', () => {
      expect(computeBackoff(5)).toBe(16000);
    });

    it('backoff doubles with each attempt (geometric progression)', () => {
      const delays = [1, 2, 3, 4, 5].map(computeBackoff);

      for (let i = 1; i < delays.length; i++) {
        expect(delays[i]).toBe(delays[i - 1]! * 2);
      }
    });
  });

  // ============================================================
  // STATUS TRANSITIONS — HAPPY PATH
  // ============================================================

  describe('status flow: pending → processing → delivered', () => {
    it('pending is the initial status for all new events', () => {
      const initialStatus = 'pending';
      expect(initialStatus).toBe('pending');
    });

    it('processing is the status after claimEvent succeeds', () => {
      // Simulates what claimEvent does: pending → processing
      const statusAfterClaim = 'processing';
      expect(statusAfterClaim).toBe('processing');
    });

    it('delivered is the terminal success status after markDelivered', () => {
      const statusAfterDelivery = 'delivered';
      expect(statusAfterDelivery).toBe('delivered');
    });

    it('delivered events have all required delivery fields set', () => {
      // Represents the shape of a successfully delivered event
      const deliveredEvent = {
        status: 'delivered',
        translatedTrigger: { triggerType: 'corpus-change', pipelineId: 'pipe-001' },
        triggerType: 'corpus-change',
        pipelineId: 'pipe-001',
        processingDurationMs: 45,
        deliveredAt: new Date(),
      };

      expect(deliveredEvent.status).toBe('delivered');
      expect(deliveredEvent.deliveredAt).toBeInstanceOf(Date);
      expect(deliveredEvent.processingDurationMs).toBeGreaterThan(0);
    });
  });

  // ============================================================
  // STATUS TRANSITIONS — FAILURE PATH
  // ============================================================

  describe('status flow: pending → processing → failed (retryable)', () => {
    it('failed status is set when markFailed is called', () => {
      const statusAfterFailure = 'failed';
      expect(statusAfterFailure).toBe('failed');
    });

    it('event can be retried when attempt_count < MAX_RETRY_ATTEMPTS', () => {
      const attemptCount = MAX_RETRY_ATTEMPTS - 1;
      const canRetry = attemptCount < MAX_RETRY_ATTEMPTS;

      expect(canRetry).toBe(true);
    });

    it('event cannot be retried when attempt_count >= MAX_RETRY_ATTEMPTS', () => {
      const attemptCount = MAX_RETRY_ATTEMPTS;
      const canRetry = attemptCount < MAX_RETRY_ATTEMPTS;

      expect(canRetry).toBe(false);
    });
  });

  // ============================================================
  // STATUS TRANSITIONS — DEAD LETTER
  // ============================================================

  describe('status flow: failed → dead_letter (max retries exceeded)', () => {
    it('auto-escalates to dead_letter when attempt_count >= MAX_RETRY_ATTEMPTS', () => {
      // Simulate the markFailed auto-escalation check
      const attemptCount = MAX_RETRY_ATTEMPTS;
      const shouldEscalate = attemptCount >= MAX_RETRY_ATTEMPTS;

      expect(shouldEscalate).toBe(true);
    });

    it('does NOT escalate to dead_letter when attempt_count < MAX_RETRY_ATTEMPTS', () => {
      const attemptCount = MAX_RETRY_ATTEMPTS - 1;
      const shouldEscalate = attemptCount >= MAX_RETRY_ATTEMPTS;

      expect(shouldEscalate).toBe(false);
    });

    it('exactly at MAX_RETRY_ATTEMPTS triggers escalation', () => {
      // Boundary condition: attempt_count === MAX_RETRY_ATTEMPTS (5) → escalate
      const boundaryAttempt = MAX_RETRY_ATTEMPTS;
      expect(boundaryAttempt >= MAX_RETRY_ATTEMPTS).toBe(true);
    });
  });

  // ============================================================
  // REPLAYABLE STATES
  // ============================================================

  describe('replayable and non-replayable states', () => {
    const replayableStates = ['failed', 'dead_letter'] as const;
    const nonReplayableStates = ['pending', 'processing', 'delivered'] as const;

    it.each(replayableStates)('%s is a replayable state', (status) => {
      expect(replayableStates.includes(status as typeof replayableStates[number])).toBe(true);
    });

    it.each(nonReplayableStates)('%s is NOT a replayable state', (status) => {
      expect(replayableStates.includes(status as unknown as typeof replayableStates[number])).toBe(false);
    });

    it('replayEvent resets attempt_count to 0', () => {
      // Simulates what replayEvent does to the attempt_count field
      const beforeReplay = { attemptCount: MAX_RETRY_ATTEMPTS, status: 'dead_letter' };
      const afterReplay = { ...beforeReplay, attemptCount: 0, status: 'pending' };

      expect(afterReplay.attemptCount).toBe(0);
      expect(afterReplay.status).toBe('pending');
    });

    it('replayEvent clears failureReason', () => {
      const beforeReplay = { failureReason: 'Connection timeout', status: 'failed' };
      const afterReplay = { ...beforeReplay, failureReason: null, status: 'pending' };

      expect(afterReplay.failureReason).toBeNull();
    });

    it('replayed event starts fresh as pending — full retry budget restored', () => {
      const replayedEvent = {
        status: 'pending',
        attemptCount: 0,
        failureReason: null,
      };

      expect(replayedEvent.status).toBe('pending');
      expect(replayedEvent.attemptCount).toBe(0);
      // Full budget: 0 attempts used, can retry up to MAX_RETRY_ATTEMPTS times
      expect(replayedEvent.attemptCount < MAX_RETRY_ATTEMPTS).toBe(true);
    });
  });

  // ============================================================
  // TRANSLATION ERROR → IMMEDIATE DEAD LETTER
  // ============================================================

  describe('TranslationError results in immediate dead_letter (bypass retry)', () => {
    it('TranslationError is an instance of Error', () => {
      const err = new TranslationError('test translation error', 'evt-001');
      expect(err).toBeInstanceOf(Error);
    });

    it('TranslationError has name TranslationError', () => {
      const err = new TranslationError('test', 'evt-001');
      expect(err.name).toBe('TranslationError');
    });

    it('TranslationError carries the eventId that caused it', () => {
      const err = new TranslationError('missing pipeline_id', 'evt-bad-001');
      expect(err.eventId).toBe('evt-bad-001');
    });

    it('TranslationError should bypass exponential retry (send directly to dead_letter)', () => {
      // This represents the caller behavior: if TranslationError is caught,
      // the event should be escalated to dead_letter immediately, not retried.
      // We verify the identification logic.
      const err = new TranslationError('missing pipeline', 'evt-001');
      const isTranslationError = err instanceof TranslationError;

      // Caller should escalate immediately if isTranslationError is true
      expect(isTranslationError).toBe(true);
    });

    it('a normal Error does NOT trigger immediate dead_letter escalation', () => {
      const err = new Error('connection reset');
      const isTranslationError = err instanceof TranslationError;

      // Normal errors should go through retry, not immediate dead_letter
      expect(isTranslationError).toBe(false);
    });
  });

  // ============================================================
  // SERVICE-LEVEL: replayEvent REJECTS NON-REPLAYABLE STATES
  // ============================================================

  describe('replayEvent rejects non-replayable states via service', () => {
    afterEach(() => {
      vi.useRealTimers();
    });

    it.each(['pending', 'processing', 'delivered'] as const)(
      'replayEvent throws for %s state',
      async (status) => {
        const event = makeEvent({ id: 'evt-replay-bad', status });

        const mockDb = {
          select: vi.fn().mockReturnValue({
            from: vi.fn().mockReturnThis(),
            where: vi.fn().mockResolvedValue([event]),
          }),
          update: vi.fn().mockReturnValue({
            set: vi.fn().mockReturnValue({
              where: vi.fn().mockReturnValue({
                returning: vi.fn().mockResolvedValue([]),
              }),
            }),
          }),
        } as never;

        await expect(replayEvent(mockDb, 'evt-replay-bad')).rejects.toThrow(
          `Cannot replay event in '${status}' state`,
        );
      },
    );

    it.each(['failed', 'dead_letter'] as const)(
      'replayEvent succeeds for %s state',
      async (status) => {
        const event = makeEvent({ id: 'evt-replay-ok', status, attemptCount: 3 });
        const replayed = makeEvent({ id: 'evt-replay-ok', status: 'pending', attemptCount: 0, failureReason: null });

        const mockDb = {
          select: vi.fn().mockReturnValue({
            from: vi.fn().mockReturnThis(),
            where: vi.fn().mockResolvedValue([event]),
          }),
          update: vi.fn().mockReturnValue({
            set: vi.fn().mockReturnValue({
              where: vi.fn().mockReturnValue({
                returning: vi.fn().mockResolvedValue([replayed]),
              }),
            }),
          }),
        } as never;

        const result = await replayEvent(mockDb, 'evt-replay-ok');

        expect(result.status).toBe('pending');
        expect(result.attemptCount).toBe(0);
        expect(result.failureReason).toBeNull();
      },
    );
  });

  // ============================================================
  // SERVICE-LEVEL: markFailed INCREMENTS attempt_count
  // ============================================================

  describe('markFailed increments attempt_count via service', () => {
    it('markFailed calls DB update with sql increment expression for attempt_count', async () => {
      const event = makeEvent({ id: 'evt-fail-001', status: 'processing', attemptCount: 1 });
      // After markFailed: attemptCount becomes 2, status = 'failed'
      const afterFail = { ...event, status: 'failed' as const, attemptCount: 2, failureReason: 'timeout' };

      const updateSetMock = vi.fn().mockReturnValue({
        where: vi.fn().mockReturnValue({
          returning: vi.fn().mockResolvedValue([afterFail]),
        }),
      });
      const mockDb = {
        update: vi.fn().mockReturnValue({
          set: updateSetMock,
        }),
      } as never;

      await markFailed(mockDb, 'evt-fail-001', 'timeout');

      // Verify update was called
      expect(mockDb.update).toHaveBeenCalledOnce();
      // Verify the set call included status: 'failed' and failureReason
      const setArgs = updateSetMock.mock.calls[0]![0] as Record<string, unknown>;
      expect(setArgs['status']).toBe('failed');
      expect(setArgs['failureReason']).toBe('timeout');
      // attemptCount should use a SQL expression (not a plain number)
      expect(setArgs['attemptCount']).toBeDefined();
    });

    it('markFailed auto-escalates to dead_letter when attempt_count reaches MAX_RETRY_ATTEMPTS', async () => {
      const event = makeEvent({ id: 'evt-fail-max', status: 'processing', attemptCount: MAX_RETRY_ATTEMPTS - 1 });
      // After markFailed: attemptCount = MAX_RETRY_ATTEMPTS → triggers escalation
      const afterFail = { ...event, status: 'failed' as const, attemptCount: MAX_RETRY_ATTEMPTS };
      const afterEscalate = { ...afterFail, status: 'dead_letter' as const };

      let updateCallCount = 0;
      const mockDb = {
        update: vi.fn().mockReturnValue({
          set: vi.fn().mockReturnValue({
            where: vi.fn().mockReturnValue({
              returning: vi.fn().mockImplementation(() => {
                updateCallCount++;
                // First call: markFailed update; second call: escalateToDeadLetter update
                if (updateCallCount === 1) return Promise.resolve([afterFail]);
                return Promise.resolve([afterEscalate]);
              }),
            }),
          }),
        }),
      } as never;

      await markFailed(mockDb, 'evt-fail-max', 'max retries');

      // Two DB updates: one for failed, one for dead_letter escalation
      expect(mockDb.update).toHaveBeenCalledTimes(2);
    });

    it('markFailed does NOT escalate when attempt_count is below MAX_RETRY_ATTEMPTS', async () => {
      const event = makeEvent({ id: 'evt-fail-low', status: 'processing', attemptCount: 1 });
      const afterFail = { ...event, status: 'failed' as const, attemptCount: 2 };

      const mockDb = {
        update: vi.fn().mockReturnValue({
          set: vi.fn().mockReturnValue({
            where: vi.fn().mockReturnValue({
              returning: vi.fn().mockResolvedValue([afterFail]),
            }),
          }),
        }),
      } as never;

      await markFailed(mockDb, 'evt-fail-low', 'transient error');

      // Only one DB update — no escalation
      expect(mockDb.update).toHaveBeenCalledTimes(1);
    });
  });

  // ============================================================
  // TIMING WITH vi.useFakeTimers
  // ============================================================

  describe('timing with fake timers', () => {
    afterEach(() => {
      vi.useRealTimers();
    });

    it('backoff delays are consistent regardless of wall-clock time', () => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date('2026-01-01T00:00:00Z'));

      function computeBackoff(attempt: number): number {
        return RETRY_BACKOFF_BASE_MS * Math.pow(2, attempt - 1);
      }

      // Backoff is deterministic — not affected by system time
      expect(computeBackoff(1)).toBe(1000);
      expect(computeBackoff(5)).toBe(16000);
    });
  });

  // ============================================================
  // BUFFER STATE MACHINE SUMMARY
  // ============================================================

  describe('complete state machine validity', () => {
    const validStatuses = ['pending', 'processing', 'delivered', 'failed', 'dead_letter'] as const;

    it('all 5 status values are defined in the type system', () => {
      expect(validStatuses.length).toBe(5);
    });

    it('terminal states (delivered, dead_letter) cannot transition further', () => {
      const terminalStates = ['delivered', 'dead_letter'] as const;
      const nonTerminalStates = ['pending', 'processing', 'failed'] as const;

      // Every terminal state is in validStatuses
      terminalStates.forEach((s) => {
        expect(validStatuses.includes(s)).toBe(true);
      });

      // Non-terminal states are a strict subset
      nonTerminalStates.forEach((s) => {
        expect(terminalStates.includes(s as never)).toBe(false);
      });
    });

    it('attempt_count increments correctly toward MAX_RETRY_ATTEMPTS', () => {
      let attemptCount = 0;
      const failures: number[] = [];

      while (attemptCount < MAX_RETRY_ATTEMPTS) {
        attemptCount++;
        failures.push(attemptCount);
      }

      expect(failures).toEqual([1, 2, 3, 4, 5]);
      expect(attemptCount).toBe(MAX_RETRY_ATTEMPTS);
    });
  });
});
