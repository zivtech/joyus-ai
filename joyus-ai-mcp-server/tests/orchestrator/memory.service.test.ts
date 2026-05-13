/**
 * Unit tests for MemoryService (WP02 — T020)
 *
 * All DB calls are mocked — no real database required.
 * Verifies:
 *   - loadHistory returns turns in chronological order
 *   - turnsToMessages filters and formats correctly
 *   - nextSequence computes correctly from max
 *   - saveTurn inserts with correct fields
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { MemoryService } from '../../src/orchestrator/memory.service.js';

// ---------------------------------------------------------------------------
// Mock DB factory
// ---------------------------------------------------------------------------

function buildMockTurn(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: 'turn-cuid-1',
    sessionId: 'session-1',
    tenantId: 'tenant-1',
    sequence: 0,
    role: 'user',
    content: 'Hello',
    toolCalls: null,
    toolResults: null,
    tokenUsage: null,
    createdAt: new Date('2026-01-01T00:00:00Z'),
    ...overrides,
  };
}

/**
 * Build a mock DB for MemoryService.
 * Supports chained query builders for select/insert.
 */
function makeMemoryDb(selectRows: unknown[] = [], insertRows: unknown[] = []) {
  // Insert chain: insert().values().returning() => rows
  const returning = vi.fn().mockResolvedValue(insertRows);
  const values = vi.fn().mockReturnValue({ returning });
  const insert = vi.fn().mockReturnValue({ values });

  // Select chain: select().from().where().orderBy().limit() => rows
  const limit = vi.fn().mockResolvedValue(selectRows);
  const orderBy = vi.fn().mockReturnValue({ limit });
  const where = vi.fn().mockReturnValue({ orderBy });
  const from = vi.fn().mockReturnValue({ where });
  const select = vi.fn().mockReturnValue({ from });

  return { select, insert };
}

const SESSION_ID = 'session-abc';
const TENANT_ID = 'tenant-xyz';

// ---------------------------------------------------------------------------
// loadHistory
// ---------------------------------------------------------------------------

describe('MemoryService.loadHistory', () => {
  it('returns turns in reversed (chronological) order', async () => {
    // DB returns DESC order (most recent first), service must reverse to ASC
    const descTurns = [
      buildMockTurn({ sequence: 2, content: 'Third' }),
      buildMockTurn({ sequence: 1, content: 'Second' }),
      buildMockTurn({ sequence: 0, content: 'First' }),
    ];

    const db = makeMemoryDb(descTurns) as never;
    const service = new MemoryService(db);
    const history = await service.loadHistory(SESSION_ID, TENANT_ID);

    expect(history).toHaveLength(3);
    expect(history[0].content).toBe('First');
    expect(history[2].content).toBe('Third');
  });

  it('returns empty array when no turns exist', async () => {
    const db = makeMemoryDb([]) as never;
    const service = new MemoryService(db);
    const history = await service.loadHistory(SESSION_ID, TENANT_ID);
    expect(history).toHaveLength(0);
  });

  it('passes the limit to the DB query', async () => {
    const db = makeMemoryDb([]) as never;
    const service = new MemoryService(db);
    await service.loadHistory(SESSION_ID, TENANT_ID, 5);

    // The limit() should have been called with 5
    const limit = (db as never as { select: ReturnType<typeof vi.fn> }).select.mock.results[0]
      .value.from.mock.results[0].value.where.mock.results[0].value.orderBy.mock.results[0].value
      .limit;
    expect(limit).toHaveBeenCalledWith(5);
  });
});

// ---------------------------------------------------------------------------
// turnsToMessages
// ---------------------------------------------------------------------------

describe('MemoryService.turnsToMessages', () => {
  it('converts user and assistant turns to messages', () => {
    const service = new MemoryService({} as never);
    const turns = [
      buildMockTurn({ role: 'user', content: 'Hello' }),
      buildMockTurn({ role: 'assistant', content: 'Hi there!' }),
    ];

    const messages = service.turnsToMessages(turns);
    expect(messages).toHaveLength(2);
    expect(messages[0]).toEqual({ role: 'user', content: 'Hello' });
    expect(messages[1]).toEqual({ role: 'assistant', content: 'Hi there!' });
  });

  it('filters out tool turns', () => {
    const service = new MemoryService({} as never);
    const turns = [
      buildMockTurn({ role: 'user', content: 'What is 2+2?' }),
      buildMockTurn({ role: 'tool', content: null, toolResults: [{ result: '4' }] }),
      buildMockTurn({ role: 'assistant', content: 'The answer is 4.' }),
    ];

    const messages = service.turnsToMessages(turns);
    // Tool turn is excluded; only user and assistant
    expect(messages).toHaveLength(2);
    expect(messages.map((m) => m.role)).toEqual(['user', 'assistant']);
  });

  it('filters out turns with null content', () => {
    const service = new MemoryService({} as never);
    const turns = [
      buildMockTurn({ role: 'assistant', content: null }), // assistant with only tool_calls
      buildMockTurn({ role: 'user', content: 'Hello' }),
    ];

    const messages = service.turnsToMessages(turns);
    expect(messages).toHaveLength(1);
    expect(messages[0].role).toBe('user');
  });

  it('returns empty array for empty turns', () => {
    const service = new MemoryService({} as never);
    expect(service.turnsToMessages([])).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// nextSequence
// ---------------------------------------------------------------------------

describe('MemoryService.nextSequence', () => {
  it('returns 0 when no turns exist (null max)', async () => {
    // DB returns null for MAX(sequence) when table is empty
    // nextSequence does: db.select({maxSeq}).from(table).where(cond)
    // The where() call returns a Promise directly (no further chaining needed)
    const where = vi.fn().mockResolvedValue([{ maxSeq: null }]);
    const from = vi.fn().mockReturnValue({ where });
    const select = vi.fn().mockReturnValue({ from });
    const db = { select } as never;

    const service = new MemoryService(db);
    const seq = await service.nextSequence(SESSION_ID, TENANT_ID);
    expect(seq).toBe(0);
  });

  it('returns max + 1 when turns exist', async () => {
    const where = vi.fn().mockResolvedValue([{ maxSeq: 4 }]);
    const from = vi.fn().mockReturnValue({ where });
    const select = vi.fn().mockReturnValue({ from });
    const db = { select } as never;

    const service = new MemoryService(db);
    const seq = await service.nextSequence(SESSION_ID, TENANT_ID);
    expect(seq).toBe(5);
  });
});

// ---------------------------------------------------------------------------
// saveTurn
// ---------------------------------------------------------------------------

describe('MemoryService.saveTurn', () => {
  it('inserts a user turn and returns it', async () => {
    const savedTurn = buildMockTurn({ role: 'user', content: 'Hello' });

    // nextSequence does: db.select({maxSeq}).from(table).where(cond)
    // where() must return a Promise (no further chaining needed for nextSequence)
    const maxWhere = vi.fn().mockResolvedValue([{ maxSeq: 2 }]);
    const maxFrom = vi.fn().mockReturnValue({ where: maxWhere });
    const select = vi.fn().mockReturnValue({ from: maxFrom });

    // Insert chain
    const returning = vi.fn().mockResolvedValue([savedTurn]);
    const values = vi.fn().mockReturnValue({ returning });
    const insert = vi.fn().mockReturnValue({ values });

    const db = { select, insert } as never;
    const service = new MemoryService(db);

    const result = await service.saveTurn({
      sessionId: SESSION_ID,
      tenantId: TENANT_ID,
      role: 'user',
      content: 'Hello',
    });

    expect(result).toEqual(savedTurn);
    expect(insert).toHaveBeenCalledOnce();

    // Verify inserted row has sequence = 3 (max was 2, so 2+1=3)
    const insertedValues = values.mock.calls[0][0];
    expect(insertedValues.sequence).toBe(3);
    expect(insertedValues.role).toBe('user');
    expect(insertedValues.content).toBe('Hello');
    expect(insertedValues.tenantId).toBe(TENANT_ID);
    expect(insertedValues.sessionId).toBe(SESSION_ID);
  });

  it('inserts an assistant turn with toolCalls', async () => {
    const toolCalls = [{ id: 'tc1', type: 'tool_use', name: 'search', input: { q: 'test' } }];
    const savedTurn = buildMockTurn({ role: 'assistant', content: 'Here is what I found:', toolCalls });

    const maxWhere = vi.fn().mockResolvedValue([{ maxSeq: 0 }]);
    const maxFrom = vi.fn().mockReturnValue({ where: maxWhere });
    const select = vi.fn().mockReturnValue({ from: maxFrom });

    const returning = vi.fn().mockResolvedValue([savedTurn]);
    const values = vi.fn().mockReturnValue({ returning });
    const insert = vi.fn().mockReturnValue({ values });

    const db = { select, insert } as never;
    const service = new MemoryService(db);

    await service.saveTurn({
      sessionId: SESSION_ID,
      tenantId: TENANT_ID,
      role: 'assistant',
      content: 'Here is what I found:',
      toolCalls,
      tokenUsage: { inputTokens: 100, outputTokens: 50 },
    });

    const insertedValues = values.mock.calls[0][0];
    expect(insertedValues.toolCalls).toEqual(toolCalls);
    expect(insertedValues.tokenUsage).toEqual({ inputTokens: 100, outputTokens: 50 });
  });

  it('assigns null for optional fields when not provided', async () => {
    const savedTurn = buildMockTurn({ role: 'user', content: 'Hi', toolCalls: null });

    const maxWhere = vi.fn().mockResolvedValue([{ maxSeq: null }]);
    const maxFrom = vi.fn().mockReturnValue({ where: maxWhere });
    const select = vi.fn().mockReturnValue({ from: maxFrom });

    const returning = vi.fn().mockResolvedValue([savedTurn]);
    const values = vi.fn().mockReturnValue({ returning });
    const insert = vi.fn().mockReturnValue({ values });

    const db = { select, insert } as never;
    const service = new MemoryService(db);

    await service.saveTurn({
      sessionId: SESSION_ID,
      tenantId: TENANT_ID,
      role: 'user',
      content: 'Hi',
    });

    const insertedValues = values.mock.calls[0][0];
    expect(insertedValues.toolCalls).toBeNull();
    expect(insertedValues.toolResults).toBeNull();
    expect(insertedValues.tokenUsage).toBeNull();
  });
});
