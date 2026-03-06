import { describe, expect, it, vi } from 'vitest';

import { PipelineEngine } from '../../src/pipelines/engine.js';
import { PipelineQueueBackpressureError, PipelineRunner } from '../../src/pipelines/runner.js';
import type { PipelineDefinition } from '../../src/pipelines/types.js';

describe('PipelineRunner', () => {
  it('rejects enqueue when queue is saturated', async () => {
    const engine = new PipelineEngine();
    const runner = new PipelineRunner(engine, { concurrency: 1, maxQueueDepth: 1 });

    const pipeline: PipelineDefinition = {
      id: 'queue-saturation',
      name: 'Queue Saturation',
      stages: [
        {
          id: 'trigger',
          async handler() {
            await new Promise((resolve) => setTimeout(resolve, 25));
            return { output: { ok: true } };
          },
        },
      ],
    };

    const p1 = runner.enqueue(pipeline, {});
    expect(() => runner.enqueue(pipeline, {})).toThrow(PipelineQueueBackpressureError);
    await p1;
  });

  it('tracks run outcomes in metrics', async () => {
    const policyGate = vi.fn().mockResolvedValue({ allow: false, reason: 'nope' });
    const engine = new PipelineEngine(policyGate);
    const runner = new PipelineRunner(engine, { concurrency: 1, maxQueueDepth: 5 });

    const failingPipeline: PipelineDefinition = {
      id: 'failing',
      name: 'Failing',
      stages: [
        {
          id: 'act',
          privileged: true,
          async handler() {
            return { output: { shouldNotRun: true } };
          },
        },
      ],
    };

    await runner.enqueue(failingPipeline, {});
    const metrics = runner.getMetrics();
    expect(metrics.failed).toBe(1);
    expect(metrics.completed).toBe(0);
  });
});
