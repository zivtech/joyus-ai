/**
 * Trigger Forwarder — Unit Tests
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { TriggerForwarder, type TriggerCall } from '../../../src/event-adapter/services/trigger-forwarder.js';

const baseTriggerCall: TriggerCall = {
  tenantId: 'tenant-1',
  pipelineId: 'pipeline-1',
  triggerType: 'corpus-change',
  metadata: { branch: 'main' },
  sourceEventId: 'evt-1',
};

describe('TriggerForwarder', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('returns failure when event bus URL is not configured', async () => {
    const forwarder = new TriggerForwarder({ eventBusUrl: undefined });
    const result = await forwarder.forwardTrigger(baseTriggerCall);

    expect(result.success).toBe(false);
    expect(result.error).toContain('not configured');
  });

  it('returns success with runId on successful POST', async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ run_id: 'run-123' }),
    });
    vi.stubGlobal('fetch', mockFetch);

    const forwarder = new TriggerForwarder({
      eventBusUrl: 'http://localhost:3000/trigger',
      serviceToken: 'test-token',
    });

    const result = await forwarder.forwardTrigger(baseTriggerCall);

    expect(result.success).toBe(true);
    expect(result.runId).toBe('run-123');

    // Verify fetch was called with correct args
    expect(mockFetch).toHaveBeenCalledWith(
      'http://localhost:3000/trigger',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({
          'Content-Type': 'application/json',
          'Authorization': 'Bearer test-token',
        }),
      }),
    );

    // Verify body contents
    const callArgs = mockFetch.mock.calls[0];
    const body = JSON.parse(callArgs[1].body);
    expect(body.tenant_id).toBe('tenant-1');
    expect(body.pipeline_id).toBe('pipeline-1');
    expect(body.trigger_type).toBe('corpus-change');
  });

  it('returns failure on HTTP 500 without throwing', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: false,
      status: 500,
      text: () => Promise.resolve('Internal Server Error'),
    }));

    const forwarder = new TriggerForwarder({
      eventBusUrl: 'http://localhost:3000/trigger',
    });

    const result = await forwarder.forwardTrigger(baseTriggerCall);

    expect(result.success).toBe(false);
    expect(result.error).toContain('HTTP 500');
  });

  it('returns failure on network error without throwing', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('ECONNREFUSED')));

    const forwarder = new TriggerForwarder({
      eventBusUrl: 'http://localhost:3000/trigger',
    });

    const result = await forwarder.forwardTrigger(baseTriggerCall);

    expect(result.success).toBe(false);
    expect(result.error).toContain('ECONNREFUSED');
  });

  it('returns failure on timeout', async () => {
    vi.stubGlobal('fetch', vi.fn().mockImplementation(() => {
      const err = new Error('AbortError');
      err.name = 'AbortError';
      return Promise.reject(err);
    }));

    const forwarder = new TriggerForwarder({
      eventBusUrl: 'http://localhost:3000/trigger',
      timeoutMs: 100,
    });

    const result = await forwarder.forwardTrigger(baseTriggerCall);

    expect(result.success).toBe(false);
    expect(result.error).toContain('Timeout');
  });

  it('does not include Authorization header when no token configured', async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({}),
    });
    vi.stubGlobal('fetch', mockFetch);

    const forwarder = new TriggerForwarder({
      eventBusUrl: 'http://localhost:3000/trigger',
      serviceToken: undefined,
    });

    await forwarder.forwardTrigger(baseTriggerCall);

    const headers = mockFetch.mock.calls[0][1].headers;
    expect(headers).not.toHaveProperty('Authorization');
  });

  it('handles pipeline_run_id field in response', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ pipeline_run_id: 'prun-456' }),
    }));

    const forwarder = new TriggerForwarder({
      eventBusUrl: 'http://localhost:3000/trigger',
    });

    const result = await forwarder.forwardTrigger(baseTriggerCall);

    expect(result.success).toBe(true);
    expect(result.runId).toBe('prun-456');
  });
});
