import { describe, expect, it, vi } from 'vitest';

import {
  contentGenerationLogs,
  contentItems,
  contentMediationSessions,
  contentOperationLogs,
} from '../../schema.js';
import { GenerationService } from '../index.js';

const itemRow = {
  id: 'item-1',
  sourceId: 'source-1',
  title: 'Reference',
  body: 'Reference body.',
  metadata: {},
};

const searchService = {
  search: vi.fn().mockResolvedValue([
    {
      itemId: itemRow.id,
      sourceId: itemRow.sourceId,
      title: itemRow.title,
      excerpt: 'Reference body.',
      score: 1,
      metadata: {},
      isStale: false,
    },
  ]),
};

const entitlements = {
  productIds: ['product-1'],
  sourceIds: ['source-1'],
  profileIds: [],
  resolvedFrom: 'test',
  resolvedAt: new Date('2026-05-25T12:00:00.000Z'),
};

function collectSqlValues(value: unknown, output: unknown[] = []): unknown[] {
  if (value === null || typeof value !== 'object') return output;

  const record = value as Record<string, unknown>;
  const primitive = record.value;
  if (
    typeof primitive === 'string' ||
    typeof primitive === 'number' ||
    typeof primitive === 'boolean'
  ) {
    output.push(primitive);
  }

  if (Array.isArray(record.queryChunks)) {
    for (const entry of record.queryChunks) {
      collectSqlValues(entry, output);
    }
  }

  return output;
}

interface DbMockOptions {
  /** When set, the Nth operation_logs insert (1-based) rejects to simulate a mid-write failure. */
  failOperationInsertOnCall?: number;
}

function createDbMock(options: DbMockOptions = {}) {
  const generationLogs: Array<Record<string, unknown>> = [];
  const operationLogs: Array<Record<string, unknown>> = [];
  const sessionUpdates: Array<{ values: Record<string, unknown>; where: unknown }> = [];
  const updateSet = vi.fn();
  const updateWhere = vi.fn().mockImplementation(async (where: unknown) => {
    sessionUpdates.push({ values: updateSet.mock.calls[0][0], where });
  });
  updateSet.mockReturnValue({ where: updateWhere });

  let operationInsertCalls = 0;

  // Writes route through the transaction handle; the top-level insert/update are
  // intentionally NOT provided so any non-transactional cost write fails loudly.
  const txInsert = vi.fn().mockImplementation((table: unknown) => ({
    values: vi.fn().mockImplementation(async (values: Record<string, unknown>) => {
      if (table === contentGenerationLogs) generationLogs.push(values);
      if (table === contentOperationLogs) {
        operationInsertCalls += 1;
        if (options.failOperationInsertOnCall === operationInsertCalls) {
          throw new Error('simulated operation_logs insert failure');
        }
        operationLogs.push(values);
      }
    }),
  }));
  const txUpdate = vi.fn().mockImplementation((table: unknown) => {
    expect(table).toBe(contentMediationSessions);
    return { set: updateSet };
  });

  const transaction = vi
    .fn()
    .mockImplementation(async (cb: (tx: unknown) => Promise<unknown>) =>
      cb({ insert: txInsert, update: txUpdate })
    );

  const db = {
    select: vi.fn().mockReturnValue({
      from: vi.fn().mockImplementation((table: unknown) => ({
        where: vi.fn().mockReturnValue({
          limit: vi.fn().mockResolvedValue(table === contentItems ? [itemRow] : []),
        }),
      })),
    }),
    transaction,
  };

  return {
    db: db as never,
    generationLogs,
    operationLogs,
    sessionUpdates,
    updateSet,
    updateWhere,
    transaction,
  };
}

describe('GenerationService token cost persistence', () => {
  it('writes session-scoped generation metadata and increments session totals', async () => {
    const mockDb = createDbMock();
    const provider = {
      generate: vi.fn().mockResolvedValue({
        text: 'Answer [Source 1]',
        model: 'claude-sonnet-4-6',
        usage: {
          inputTokens: 1_000,
          outputTokens: 500,
          cacheWriteTokens: 100,
          cacheReadTokens: 50,
        },
      }),
    };
    const service = new GenerationService(searchService as never, provider, mockDb.db);

    await service.generate('question', 'user-1', 'tenant-1', entitlements, {
      sessionId: 'session-1',
    });

    expect(mockDb.generationLogs[0]).toMatchObject({ sessionId: 'session-1' });
    expect(mockDb.operationLogs[0]).toMatchObject({
      tenantId: 'tenant-1',
      userId: 'user-1',
      sessionId: 'session-1',
      operation: 'generate',
      success: true,
      metadata: expect.objectContaining({
        inputTokens: 1_000,
        outputTokens: 500,
        cacheWriteTokens: 100,
        cacheReadTokens: 50,
        estimatedCostUsd: 0.01089,
        model: 'claude-sonnet-4-6',
        pricingAvailable: true,
      }),
    });
    expect(mockDb.updateSet).toHaveBeenCalledWith(
      expect.objectContaining({
        totalInputTokens: expect.any(Object),
        totalOutputTokens: expect.any(Object),
        totalCacheWriteTokens: expect.any(Object),
        totalCacheReadTokens: expect.any(Object),
        totalEstimatedCostUsd: expect.any(Object),
      })
    );
    expect(collectSqlValues(mockDb.updateWhere.mock.calls[0][0])).toEqual(
      expect.arrayContaining(['session-1', 'tenant-1'])
    );
  });

  it('omits token metadata and leaves accumulators untouched when usage is missing', async () => {
    const mockDb = createDbMock();
    const provider = {
      generate: vi
        .fn()
        .mockResolvedValue({ text: 'Answer [Source 1]', model: 'claude-sonnet-4-6' }),
    };
    const service = new GenerationService(searchService as never, provider, mockDb.db);

    await service.generate('question', 'user-1', 'tenant-1', entitlements, {
      sessionId: 'session-1',
    });

    expect(mockDb.operationLogs[0]?.metadata).toMatchObject({
      citationCount: 1,
      sourcesUsed: 1,
      profileId: null,
    });
    expect(mockDb.operationLogs[0]?.metadata).not.toHaveProperty('inputTokens');
    expect(mockDb.operationLogs[0]?.metadata).not.toHaveProperty('estimatedCostUsd');
    expect(mockDb.updateSet).not.toHaveBeenCalled();
  });

  it('records tokens without estimated cost for an unpriced model and warns', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const mockDb = createDbMock();
    const provider = {
      generate: vi.fn().mockResolvedValue({
        text: 'Answer [Source 1]',
        model: 'model-without-price',
        usage: {
          inputTokens: 100,
          outputTokens: 50,
          cacheWriteTokens: 0,
          cacheReadTokens: 0,
        },
      }),
    };
    const service = new GenerationService(searchService as never, provider, mockDb.db);

    await service.generate('question', 'user-1', 'tenant-1', entitlements, {
      sessionId: 'session-1',
    });

    expect(mockDb.operationLogs[0]?.metadata).toMatchObject({
      inputTokens: 100,
      outputTokens: 50,
      model: 'model-without-price',
      pricingAvailable: false,
    });
    expect(mockDb.operationLogs[0]?.metadata).not.toHaveProperty('estimatedCostUsd');
    expect(mockDb.updateSet).toHaveBeenCalledOnce();
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('No pricing'));
    warnSpy.mockRestore();
  });

  it('prices claude-opus-4-7 and records its estimated cost', async () => {
    const mockDb = createDbMock();
    const provider = {
      generate: vi.fn().mockResolvedValue({
        text: 'Answer [Source 1]',
        model: 'claude-opus-4-7',
        usage: {
          inputTokens: 1_000,
          outputTokens: 500,
          cacheWriteTokens: 0,
          cacheReadTokens: 0,
        },
      }),
    };
    const service = new GenerationService(searchService as never, provider, mockDb.db);

    await service.generate('question', 'user-1', 'tenant-1', entitlements, {
      sessionId: 'session-1',
    });

    // opus tier: 1000 * 5.0 + 500 * 25.0 = 17_500 microUSD = 0.0175 USD
    expect(mockDb.operationLogs[0]?.metadata).toMatchObject({
      model: 'claude-opus-4-7',
      pricingAvailable: true,
      estimatedCostUsd: 0.0175,
    });
    expect(mockDb.updateSet).toHaveBeenCalledOnce();
  });

  it('commits all cost-accounting writes inside a single transaction', async () => {
    const mockDb = createDbMock();
    const provider = {
      generate: vi.fn().mockResolvedValue({
        text: 'Answer [Source 1]',
        model: 'claude-sonnet-4-6',
        usage: { inputTokens: 1_000, outputTokens: 500, cacheWriteTokens: 0, cacheReadTokens: 0 },
      }),
    };
    const service = new GenerationService(searchService as never, provider, mockDb.db);

    await service.generate('question', 'user-1', 'tenant-1', entitlements, {
      sessionId: 'session-1',
    });

    expect(mockDb.transaction).toHaveBeenCalledOnce();
    expect(mockDb.generationLogs).toHaveLength(1);
    expect(mockDb.operationLogs).toHaveLength(1);
    expect(mockDb.updateSet).toHaveBeenCalledOnce();
  });

  it('rolls back the session accumulator when a mid-transaction write fails', async () => {
    // Fail the operation_logs insert (the 1st such call) after the generation_logs
    // insert has run; a real transaction would discard both and never reach the
    // session UPDATE, leaving the accumulator untouched.
    const mockDb = createDbMock({ failOperationInsertOnCall: 1 });
    const provider = {
      generate: vi.fn().mockResolvedValue({
        text: 'Answer [Source 1]',
        model: 'claude-sonnet-4-6',
        usage: { inputTokens: 1_000, outputTokens: 500, cacheWriteTokens: 0, cacheReadTokens: 0 },
      }),
    };
    const service = new GenerationService(searchService as never, provider, mockDb.db);

    await expect(
      service.generate('question', 'user-1', 'tenant-1', entitlements, { sessionId: 'session-1' })
    ).rejects.toThrow('simulated operation_logs insert failure');

    expect(mockDb.transaction).toHaveBeenCalledOnce();
    expect(mockDb.updateSet).not.toHaveBeenCalled();
    expect(mockDb.sessionUpdates).toHaveLength(0);
  });
});
