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

function createDbMock() {
  const generationLogs: Array<Record<string, unknown>> = [];
  const operationLogs: Array<Record<string, unknown>> = [];
  const sessionUpdates: Array<{ values: Record<string, unknown>; where: unknown }> = [];
  const updateSet = vi.fn();
  const updateWhere = vi.fn().mockImplementation(async (where: unknown) => {
    sessionUpdates.push({ values: updateSet.mock.calls[0][0], where });
  });
  updateSet.mockReturnValue({ where: updateWhere });

  const db = {
    select: vi.fn().mockReturnValue({
      from: vi.fn().mockImplementation((table: unknown) => ({
        where: vi.fn().mockReturnValue({
          limit: vi.fn().mockResolvedValue(table === contentItems ? [itemRow] : []),
        }),
      })),
    }),
    insert: vi.fn().mockImplementation((table: unknown) => ({
      values: vi.fn().mockImplementation(async (values: Record<string, unknown>) => {
        if (table === contentGenerationLogs) generationLogs.push(values);
        if (table === contentOperationLogs) operationLogs.push(values);
      }),
    })),
    update: vi.fn().mockImplementation((table: unknown) => {
      expect(table).toBe(contentMediationSessions);
      return { set: updateSet };
    }),
  };

  return {
    db: db as never,
    generationLogs,
    operationLogs,
    sessionUpdates,
    updateSet,
    updateWhere,
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

  it('records tokens without estimated cost for an unpriced model', async () => {
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
  });
});
