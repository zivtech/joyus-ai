import { describe, it, expect, vi, beforeEach } from 'vitest';
import { UsageService } from '../../src/orchestrator/usage.service.js';
import type { ModelInvocationUsage } from '../../src/orchestrator/usage.service.js';

const makeUsage = (overrides?: Partial<ModelInvocationUsage>): ModelInvocationUsage => ({
  sessionId: 'session-1',
  tenantId: 'tenant-1',
  model: 'claude-sonnet-4-20250514',
  turnSequence: 1,
  inputTokens: 1000,
  outputTokens: 500,
  cacheHits: 200,
  cacheCreations: 0,
  lastUserMessageAt: new Date(),
  ...overrides,
});

function makeEventService() {
  return {
    emitEvent: vi.fn().mockResolvedValue(undefined),
  } as any;
}

function makeDb(events: any[] = []) {
  const result = Object.assign(Promise.resolve(events), {
    limit: vi.fn().mockResolvedValue(events),
  });
  return {
    select: vi.fn().mockReturnValue({
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockReturnValue(result),
      }),
    }),
  } as any;
}

describe('UsageService', () => {
  describe('recordInvocation', () => {
    it('emits usage.model_invocation event', async () => {
      const eventService = makeEventService();
      const service = new UsageService({ eventService, db: makeDb() });

      await service.recordInvocation(makeUsage());

      expect(eventService.emitEvent).toHaveBeenCalledWith(
        'tenant-1',
        'usage.model_invocation',
        expect.objectContaining({
          sessionId: 'session-1',
          inputTokens: 1000,
          outputTokens: 500,
          cacheHits: 200,
          model: 'claude-sonnet-4-20250514',
        }),
        'session-1',
      );
    });

    it('continues when event emission fails', async () => {
      const eventService = {
        emitEvent: vi.fn().mockRejectedValue(new Error('DB down')),
      } as any;
      const service = new UsageService({ eventService, db: makeDb() });

      await expect(service.recordInvocation(makeUsage())).resolves.not.toThrow();
    });
  });

  describe('idle gap detection', () => {
    it('emits idle gap event when threshold exceeded', async () => {
      const eventService = makeEventService();
      const service = new UsageService({
        eventService,
        db: makeDb(),
        idleThresholdMinutes: 5,
      });

      const usage = makeUsage({
        lastUserMessageAt: new Date(Date.now() - 10 * 60_000),
      });

      await service.recordInvocation(usage);

      expect(eventService.emitEvent).toHaveBeenCalledWith(
        'tenant-1',
        'usage.idle_gap_detected',
        expect.objectContaining({
          sessionId: 'session-1',
          idleMinutes: expect.any(Number),
        }),
        'session-1',
      );
    });

    it('does not emit when within threshold', async () => {
      const eventService = makeEventService();
      const service = new UsageService({
        eventService,
        db: makeDb(),
        idleThresholdMinutes: 5,
      });

      const usage = makeUsage({
        lastUserMessageAt: new Date(),
      });

      await service.recordInvocation(usage);

      const calls = eventService.emitEvent.mock.calls;
      const idleCalls = calls.filter((c: any) => c[1] === 'usage.idle_gap_detected');
      expect(idleCalls).toHaveLength(0);
    });

    it('does not emit when zero tokens', async () => {
      const eventService = makeEventService();
      const service = new UsageService({
        eventService,
        db: makeDb(),
        idleThresholdMinutes: 5,
      });

      const usage = makeUsage({
        inputTokens: 0,
        outputTokens: 0,
        lastUserMessageAt: new Date(Date.now() - 10 * 60_000),
      });

      await service.recordInvocation(usage);

      const calls = eventService.emitEvent.mock.calls;
      const idleCalls = calls.filter((c: any) => c[1] === 'usage.idle_gap_detected');
      expect(idleCalls).toHaveLength(0);
    });
  });

  describe('getSessionUsage', () => {
    it('returns zero totals when no events', async () => {
      const service = new UsageService({
        eventService: makeEventService(),
        db: makeDb([]),
      });

      const usage = await service.getSessionUsage('tenant-1', 'session-1');

      expect(usage.totalInputTokens).toBe(0);
      expect(usage.totalOutputTokens).toBe(0);
      expect(usage.invocationCount).toBe(0);
      expect(usage.estimatedCostUsd).toBe(0);
    });

    it('accumulates tokens across multiple events', async () => {
      const events = [
        { payload: { inputTokens: 1000, outputTokens: 500, cacheHits: 0, cacheCreations: 0, model: 'claude-sonnet-4-20250514' } },
        { payload: { inputTokens: 2000, outputTokens: 1000, cacheHits: 100, cacheCreations: 50, model: 'claude-sonnet-4-20250514' } },
      ];
      const service = new UsageService({
        eventService: makeEventService(),
        db: makeDb(events),
      });

      const usage = await service.getSessionUsage('tenant-1', 'session-1');

      expect(usage.totalInputTokens).toBe(3000);
      expect(usage.totalOutputTokens).toBe(1500);
      expect(usage.totalCacheHits).toBe(100);
      expect(usage.invocationCount).toBe(2);
      expect(usage.estimatedCostUsd).toBeGreaterThan(0);
    });
  });
});
