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

function makeMemoizedStep(cache = new Map<string, unknown>()): InngestStep {
  return {
    run: vi.fn(async (name: string, fn: () => Promise<unknown>) => {
      if (cache.has(name)) {
        return cache.get(name);
      }

      const result = await fn();
      cache.set(name, result);
      return result;
    }),
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
  const insertedRows: Record<string, unknown>[] = [];
  const updates: Record<string, unknown>[] = [];
  let selectCallIndex = 0;

  return {
    insertedRows,
    updates,
    insert: vi.fn().mockImplementation(() => ({
      values: vi.fn().mockImplementation((rows) => {
        const rowList = Array.isArray(rows) ? rows : [rows];
        insertedRows.push(...rowList);
        return Promise.resolve(undefined);
      }),
    })),
    update: vi.fn().mockImplementation(() => ({
      set: vi.fn().mockImplementation((update: Record<string, unknown>) => ({
        where: vi.fn().mockImplementation(() => {
          updates.push(update);
          return Promise.resolve(undefined);
        }),
      })),
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
  it('loads the requested pipeline and applies safe manual payload overrides', async () => {
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
          payload: {
            query: 'manual smoke test override',
            sourceIds: ['source-override'],
            maxResults: 5,
            type: 'notification',
            channel: 'slack',
            recipients: ['unsafe@example.com'],
            message: 'runtime notification',
          },
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
      {
        stepType: 'source_query',
        config: {
          query: 'manual smoke test override',
          sourceIds: ['source-override'],
          maxResults: 5,
          type: 'source_query',
        },
      },
      {
        stepType: 'notification',
        config: {
          channel: 'email',
          message: 'runtime notification',
          type: 'notification',
        },
      },
    ]);
    expect(registry.getHandler).toHaveBeenCalledWith('source_query');
    expect(registry.getHandler).toHaveBeenCalledWith('notification');
  });

  it('keeps execution ids stable across Inngest replay finalization', async () => {
    const registry = {
      getHandler: vi.fn((): PipelineStepHandler => ({
        stepType: 'source_query',
        execute: vi.fn().mockResolvedValue({
          success: false,
          error: {
            message: 'Content infrastructure client not configured',
            type: 'configuration',
            isTransient: false,
            retryable: false,
          },
        } satisfies StepResult),
      })),
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
    ];
    const db = makeDb([[pipeline], steps]);

    const fn = createManualTriggerPipeline(registry, {
      db: db as unknown as NodePgDatabase,
    }) as unknown as {
      fn: (args: {
        event: { data: { tenantId: string; pipelineId: string; payload: Record<string, unknown> } };
        step: InngestStep;
      }) => Promise<{ executionId: string; status: string }>;
    };
    const event = {
      data: {
        tenantId: 'tenant-1',
        pipelineId: 'pipe-1',
        payload: {},
      },
    };
    const replayCache = new Map<string, unknown>();

    const firstResult = await fn.fn({ event, step: makeMemoizedStep(replayCache) });
    const replayedResult = await fn.fn({ event, step: makeMemoizedStep(replayCache) });
    const executionInsert = db.insertedRows.find(
      (row) => row['pipelineId'] === 'pipe-1' && row['triggerEventId'],
    );

    expect(firstResult.status).toBe('paused_on_failure');
    expect(replayedResult.status).toBe('paused_on_failure');
    expect(replayedResult.executionId).toBe(firstResult.executionId);
    expect(executionInsert?.['id']).toBe(firstResult.executionId);
    expect(db.updates).toContainEqual(
      expect.objectContaining({ status: 'paused_on_failure' }),
    );
  });
});
