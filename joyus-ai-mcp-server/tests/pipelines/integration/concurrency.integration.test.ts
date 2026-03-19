/**
 * Integration tests — per-tenant concurrency configuration (T017)
 *
 * Verifies that all pipeline functions declare the correct concurrency settings.
 * Inngest enforces these at runtime; these tests verify the static config
 * is correct before deployment.
 *
 * Key rules:
 * - Event-triggered pipelines: key='event.data.tenantId', limit=1
 * - Schedule-tick pipeline:   key='"schedule-tick-global"', limit=1
 *   (static string because cron events carry no tenantId)
 */
import { describe, it, expect } from 'vitest';
import { createCorpusUpdatePipeline } from '../../../src/inngest/functions/corpus-update-pipeline.js';
import { createContentAuditPipeline } from '../../../src/inngest/functions/content-audit-pipeline.js';
import { createRegulatoryChangeMonitorPipeline } from '../../../src/inngest/functions/regulatory-change-monitor-pipeline.js';
import { createScheduleTickPipeline } from '../../../src/inngest/functions/schedule-tick-pipeline.js';
import type { StepHandlerRegistry } from '../../../src/pipelines/types.js';

// ============================================================
// HELPERS
// ============================================================

const emptyRegistry: StepHandlerRegistry = { getHandler: () => undefined };

type FnWithOpts = {
  opts?: { concurrency?: { key: string; limit: number } };
};

// ============================================================
// TESTS
// ============================================================

describe('per-tenant concurrency configuration', () => {
  it('corpus-update-pipeline uses event.data.tenantId key with limit 1', () => {
    const fn = createCorpusUpdatePipeline(emptyRegistry) as unknown as FnWithOpts;
    expect(fn.opts?.concurrency?.key).toBe('event.data.tenantId');
    expect(fn.opts?.concurrency?.limit).toBe(1);
  });

  it('content-audit-pipeline uses event.data.tenantId key with limit 1', () => {
    const fn = createContentAuditPipeline(emptyRegistry) as unknown as FnWithOpts;
    expect(fn.opts?.concurrency?.key).toBe('event.data.tenantId');
    expect(fn.opts?.concurrency?.limit).toBe(1);
  });

  it('regulatory-change-monitor-pipeline uses event.data.tenantId key with limit 1', () => {
    const fn = createRegulatoryChangeMonitorPipeline(emptyRegistry) as unknown as FnWithOpts;
    expect(fn.opts?.concurrency?.key).toBe('event.data.tenantId');
    expect(fn.opts?.concurrency?.limit).toBe(1);
  });

  it('schedule-tick-pipeline uses static "schedule-tick-global" key (with inner quotes)', () => {
    const fn = createScheduleTickPipeline() as unknown as FnWithOpts;
    // Must include the inner quotes: '"schedule-tick-global"' is a CEL string literal
    // A bare 'schedule-tick-global' would be a CEL variable name — incorrect.
    expect(fn.opts?.concurrency?.key).toBe('"schedule-tick-global"');
    expect(fn.opts?.concurrency?.limit).toBe(1);
  });

  it('event-triggered pipelines produce unique executionIds per invocation', async () => {
    const makeStep = () => ({
      run: (_name: string, fn: () => Promise<unknown>) => fn(),
      waitForEvent: () => Promise.resolve(null),
    });
    const event = { data: { tenantId: 'tenant-1', corpusId: 'c1', changeType: 'updated' } };

    type FnWrapper = { fn: (args: { event: unknown; step: unknown }) => Promise<{ executionId: string }> };
    const fn = createCorpusUpdatePipeline(emptyRegistry) as unknown as FnWrapper;

    const [r1, r2] = await Promise.all([
      fn.fn({ event, step: makeStep() }),
      fn.fn({ event: { data: { ...event.data, tenantId: 'tenant-2' } }, step: makeStep() }),
    ]);

    expect(r1.executionId).toBeTruthy();
    expect(r2.executionId).toBeTruthy();
    expect(r1.executionId).not.toBe(r2.executionId);
  });
});
