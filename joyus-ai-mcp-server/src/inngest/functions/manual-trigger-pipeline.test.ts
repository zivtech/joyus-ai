/**
 * Unit tests for createManualTriggerPipeline factory.
 */
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { describe, expect, it, vi } from 'vitest';

import type { PipelineStepHandler, StepResult } from '../../pipelines/types.js';
import type { InngestStep } from '../adapter.js';

import { createManualTriggerPipeline } from './manual-trigger-pipeline.js';

function makeStep(): InngestStep {
  return {
    run: vi.fn((_name: string, fn: () => Promise<unknown>) => fn()),
  } as unknown as InngestStep;
}

function makeChainable(results: unknown[]) {
  const arr = [...results];
  return Object.assign(arr, {
    where: vi.fn().mockImplementation(() => makeChainable(results)),
    limit: vi.fn().mockImplementation(() => makeChainable(results)),
    orderBy: vi.fn().mockImplementation(() => makeChainable(results)),
  });
}

function makeDb(selectResults: unknown[][]) {
  let selectCallIndex = 0;

  return {
    insert: vi.fn().mockImplementation(() => ({
      values: vi.fn().mockResolvedValue(undefined),
    })),
    update: vi.fn().mockImplementation(() => ({
      set: vi.fn().mockReturnValue({
        where: vi.fn().mockResolvedValue(undefined),
      }),
    })),
    select: vi.fn().mockImplementation(() => {
      const callIndex = selectCallIndex++;
      const results = selectResults[callIndex] ?? [];
      return {
        from: vi.fn().mockImplementation(() => makeChainable(results)),
      };
    }),
  };
}

describe('createManualTriggerPipeline', () => {
  it('loads the requested pipeline by pipelineId and executes its stored steps/config', async () => {
    const calls: Array<{ stepType: string; config: Record<string, unknown> }> = [];
    const makeHandler = (stepType: string, result: StepResult): PipelineStepHandler => ({
      stepType: stepType as PipelineStepHandler['stepType'],
      execute: vi.fn().mockImplementation((config) => {
        calls.push({ stepType, config });
        return Promise.resolve(result);
      }),
    });

    const registry = {
      getHandler: vi.fn((stepType: string) => {
        const handlers: Record<string, PipelineStepHandler> = {
          source_query: makeHandler('source_query', {
            success: true,
            outputData: { sourceIds: ['source-1'] },
          }),
          notification: makeHandler('notification', {
            success: true,
            outputData: { sent: true },
          }),
        };
        return handlers[stepType];
      }),
    };

    const pipeline = {
      id: 'pipe-1',
      tenantId: 'tenant-1',
      status: 'active',
      reviewGateTimeoutHours: 48,
    };
    const steps = [
      {
        id: 'step-1',
        pipelineId: 'pipe-1',
        position: 0,
        name: 'stored-source-query',
        stepType: 'source_query',
        config: { query: 'stored query' },
      },
      {
        id: 'step-2',
        pipelineId: 'pipe-1',
        position: 1,
        name: 'stored-notification',
        stepType: 'notification',
        config: { channel: 'email', message: 'stored message' },
      },
    ];
    const db = makeDb([[pipeline], steps]);

    const fn = createManualTriggerPipeline(registry, {
      db: db as unknown as NodePgDatabase,
    }) as unknown as {
      fn: (args: {
        event: { data: { tenantId: string; pipelineId: string; payload: Record<string, unknown> } };
        step: InngestStep;
      }) => Promise<{ status: string; steps: Array<{ stepType: string }> }>;
    };

    const result = await fn.fn({
      event: {
        data: {
          tenantId: 'tenant-1',
          pipelineId: 'pipe-1',
          payload: { query: 'payload query should not replace stored config' },
        },
      },
      step: makeStep(),
    });

    expect(result.status).toBe('completed');
    expect(result.steps.map((stepResult) => stepResult.stepType)).toEqual([
      'source_query',
      'notification',
    ]);
    expect(calls).toEqual([
      { stepType: 'source_query', config: { query: 'stored query', type: 'source_query' } },
      {
        stepType: 'notification',
        config: { channel: 'email', message: 'stored message', type: 'notification' },
      },
    ]);
    expect(registry.getHandler).toHaveBeenCalledWith('source_query');
    expect(registry.getHandler).toHaveBeenCalledWith('notification');
  });
});
