import { describe, expect, it, vi } from 'vitest';

import { PipelineEngine } from '../../src/pipelines/engine.js';
import type { PipelineDefinition } from '../../src/pipelines/types.js';

describe('PipelineEngine', () => {
  it('retries a stage before succeeding', async () => {
    let attempts = 0;
    const engine = new PipelineEngine();
    const pipeline: PipelineDefinition = {
      id: 'retry-pipeline',
      name: 'Retry Pipeline',
      stages: [
        {
          id: 'analyze',
          maxRetries: 2,
          async handler() {
            attempts += 1;
            if (attempts < 2) {
              throw new Error('temporary');
            }
            return { output: { ok: true }, evidence: { attempts } };
          },
        },
      ],
    };

    const report = await engine.run(pipeline, {});
    expect(report.status).toBe('completed');
    expect(report.stages[0]?.attempts).toBe(2);
    expect(report.state.analyze).toEqual({ ok: true });
  });

  it('fails privileged stage when policy denies execution', async () => {
    const policyGate = vi.fn().mockResolvedValue({
      allow: false,
      reason: 'policy denied',
      evidenceRef: 'policy/decision/123',
    });

    const engine = new PipelineEngine(policyGate);
    const handler = vi.fn().mockResolvedValue({ output: { shouldNotRun: true } });
    const pipeline: PipelineDefinition = {
      id: 'policy-pipeline',
      name: 'Policy Pipeline',
      stages: [
        {
          id: 'act',
          privileged: true,
          handler,
        },
      ],
    };

    const report = await engine.run(pipeline, {}, { mode: 'apply' });
    expect(report.status).toBe('failed');
    expect(report.stages[0]?.error).toMatch(/policy denied/i);
    expect(handler).not.toHaveBeenCalled();
    expect(policyGate).toHaveBeenCalledOnce();
  });

  it('marks stage as failed on timeout', async () => {
    const engine = new PipelineEngine();
    const pipeline: PipelineDefinition = {
      id: 'timeout-pipeline',
      name: 'Timeout Pipeline',
      stages: [
        {
          id: 'enrich',
          timeoutMs: 5,
          async handler() {
            await new Promise((resolve) => setTimeout(resolve, 30));
            return { output: { ok: true } };
          },
        },
      ],
    };

    const report = await engine.run(pipeline, {});
    expect(report.status).toBe('failed');
    expect(report.stages[0]?.error).toMatch(/timeout/i);
  });

  it('cancels run when abort signal is triggered', async () => {
    const controller = new AbortController();
    const engine = new PipelineEngine();
    const pipeline: PipelineDefinition = {
      id: 'cancel-pipeline',
      name: 'Cancel Pipeline',
      stages: [
        {
          id: 'trigger',
          async handler() {
            controller.abort();
            return { output: { started: true } };
          },
        },
        {
          id: 'deliver',
          async handler() {
            return { output: { shouldNotRun: true } };
          },
        },
      ],
    };

    const report = await engine.run(pipeline, {}, { signal: controller.signal });
    expect(report.status).toBe('canceled');
    expect(report.stages[1]?.status).toBe('canceled');
  });
});
