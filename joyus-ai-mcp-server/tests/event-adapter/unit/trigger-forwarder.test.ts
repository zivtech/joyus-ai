/**
 * Trigger Forwarder — Unit Tests
 *
 * Verifies the mapping from TriggerCall → Inngest event name + data, plus
 * the success/error envelope returned to BufferDrainWorker.
 */

import { describe, it, expect, vi } from 'vitest';
import { TriggerForwarder, type TriggerCall } from '../../../src/event-adapter/services/trigger-forwarder.js';

const baseTriggerCall: TriggerCall = {
  tenantId: 'tenant-1',
  pipelineId: 'pipeline-1',
  triggerType: 'corpus-change',
  metadata: { branch: 'main' },
  sourceEventId: 'evt-1',
};

function makeInngest(send: ReturnType<typeof vi.fn>) {
  return { send };
}

describe('TriggerForwarder', () => {
  it('maps corpus-change with corpusId metadata to pipeline/corpus.changed', async () => {
    const send = vi.fn().mockResolvedValue({ ids: ['inn-1'] });
    const forwarder = new TriggerForwarder({ inngest: makeInngest(send) });

    const result = await forwarder.forwardTrigger({
      ...baseTriggerCall,
      triggerType: 'corpus-change',
      metadata: { corpusId: 'corpus-42', changeType: 'updated' },
    });

    expect(result.success).toBe(true);
    expect(result.runId).toBe('inn-1');
    expect(send).toHaveBeenCalledWith({
      name: 'pipeline/corpus.changed',
      data: {
        tenantId: 'tenant-1',
        corpusId: 'corpus-42',
        changeType: 'updated',
      },
    });
  });

  it('defaults changeType to "updated" when not provided', async () => {
    const send = vi.fn().mockResolvedValue({ ids: ['inn-2'] });
    const forwarder = new TriggerForwarder({ inngest: makeInngest(send) });

    await forwarder.forwardTrigger({
      ...baseTriggerCall,
      triggerType: 'corpus-change',
      metadata: { corpusId: 'corpus-7' },
    });

    expect(send).toHaveBeenCalledWith({
      name: 'pipeline/corpus.changed',
      data: { tenantId: 'tenant-1', corpusId: 'corpus-7', changeType: 'updated' },
    });
  });

  it('falls back to pipeline/manual.triggered when corpus-change has no corpusId', async () => {
    const send = vi.fn().mockResolvedValue({ ids: ['inn-3'] });
    const forwarder = new TriggerForwarder({ inngest: makeInngest(send) });

    await forwarder.forwardTrigger({
      ...baseTriggerCall,
      triggerType: 'corpus-change',
      metadata: { branch: 'main' },
    });

    expect(send).toHaveBeenCalledWith({
      name: 'pipeline/manual.triggered',
      data: {
        tenantId: 'tenant-1',
        pipelineId: 'pipeline-1',
        payload: { branch: 'main' },
      },
    });
  });

  it('routes schedule events (scheduleId metadata) to pipeline/schedule.tick', async () => {
    const send = vi.fn().mockResolvedValue({ ids: ['inn-4'] });
    const forwarder = new TriggerForwarder({ inngest: makeInngest(send) });

    await forwarder.forwardTrigger({
      ...baseTriggerCall,
      triggerType: 'manual-request',
      metadata: {
        scheduleId: 'sched-1',
        scheduledAt: '2026-05-08T09:00:00Z',
        firedAt: '2026-05-08T09:00:01Z',
      },
    });

    expect(send).toHaveBeenCalledWith({
      name: 'pipeline/schedule.tick',
      data: {
        tenantId: 'tenant-1',
        pipelineId: 'pipeline-1',
        scheduledAt: '2026-05-08T09:00:00Z',
      },
    });
  });

  it('falls back to firedAt when scheduledAt is absent', async () => {
    const send = vi.fn().mockResolvedValue({ ids: ['inn-5'] });
    const forwarder = new TriggerForwarder({ inngest: makeInngest(send) });

    await forwarder.forwardTrigger({
      ...baseTriggerCall,
      triggerType: 'manual-request',
      metadata: { scheduleId: 'sched-1', firedAt: '2026-05-08T10:00:00Z' },
    });

    expect(send).toHaveBeenCalledWith({
      name: 'pipeline/schedule.tick',
      data: {
        tenantId: 'tenant-1',
        pipelineId: 'pipeline-1',
        scheduledAt: '2026-05-08T10:00:00Z',
      },
    });
  });

  it('routes everything else to pipeline/manual.triggered', async () => {
    const send = vi.fn().mockResolvedValue({ ids: ['inn-6'] });
    const forwarder = new TriggerForwarder({ inngest: makeInngest(send) });

    await forwarder.forwardTrigger({
      ...baseTriggerCall,
      triggerType: 'manual-request',
      metadata: { source: 'manual', user: 'admin' },
    });

    expect(send).toHaveBeenCalledWith({
      name: 'pipeline/manual.triggered',
      data: {
        tenantId: 'tenant-1',
        pipelineId: 'pipeline-1',
        payload: { source: 'manual', user: 'admin' },
      },
    });
  });

  it('returns success with no runId when Inngest response has no ids', async () => {
    const send = vi.fn().mockResolvedValue({});
    const forwarder = new TriggerForwarder({ inngest: makeInngest(send) });

    const result = await forwarder.forwardTrigger(baseTriggerCall);

    expect(result.success).toBe(true);
    expect(result.runId).toBeUndefined();
  });

  it('extracts runId from array-shaped Inngest response', async () => {
    const send = vi.fn().mockResolvedValue([{ ids: ['inn-array-1'] }]);
    const forwarder = new TriggerForwarder({ inngest: makeInngest(send) });

    const result = await forwarder.forwardTrigger(baseTriggerCall);

    expect(result.success).toBe(true);
    expect(result.runId).toBe('inn-array-1');
  });

  it('returns failure (not throws) when Inngest send rejects', async () => {
    const send = vi.fn().mockRejectedValue(new Error('Inngest unreachable'));
    const forwarder = new TriggerForwarder({ inngest: makeInngest(send) });

    const result = await forwarder.forwardTrigger(baseTriggerCall);

    expect(result.success).toBe(false);
    expect(result.error).toContain('Inngest unreachable');
  });
});
