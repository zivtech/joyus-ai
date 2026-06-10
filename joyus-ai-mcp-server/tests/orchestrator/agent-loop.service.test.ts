/**
 * Unit tests for AgentLoopService (WP02 — T016, T017, T019, T021)
 *
 * All external dependencies are mocked:
 * - DB is a fully mocked Drizzle-shape object
 * - AgentClient is mocked to control responses without hitting the Claude API
 * - ToolRouter is mocked (StubToolRouter by default)
 * - SseStream is mocked to capture streamed events
 *
 * Tests verify:
 *   - processMessage loads session and rejects non-running sessions
 *   - processMessage returns text on single-turn (no tool calls)
 *   - processMessage handles tool_use → route → re-invoke loop
 *   - Loop terminates at MAX_TOOL_ITERATIONS
 *   - Turns are persisted (user, assistant, tool)
 *   - SSE events are emitted in correct order
 *   - Context window monitoring logs (T021)
 *   - assembleSystemPrompt returns a non-empty string
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

import {
  AgentLoopService,
  AgentLoopError,
  StubToolRouter,
  assembleSystemPrompt,
  AnthropicAgentClient,
} from '../../src/orchestrator/agent-loop.service.js';
import type {
  AgentClient,
  AgentOutput,
  ToolRouter,
} from '../../src/orchestrator/agent-loop.service.js';

// ---------------------------------------------------------------------------
// Mock DB builder — replicates the Drizzle chain pattern from session.service.test.ts
// ---------------------------------------------------------------------------

function buildMockSession(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: 'session-abc',
    tenantId: 'tenant-1',
    userId: 'user-1',
    status: 'running',
    metadata: {},
    inngestRunId: null,
    createdAt: new Date('2026-01-01'),
    updatedAt: new Date('2026-01-01'),
    completedAt: null,
    ...overrides,
  };
}

function buildMockTurn(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: 'turn-1',
    sessionId: 'session-abc',
    tenantId: 'tenant-1',
    sequence: 0,
    role: 'user',
    content: 'Hello',
    toolCalls: null,
    toolResults: null,
    tokenUsage: null,
    createdAt: new Date('2026-01-01'),
    ...overrides,
  };
}

/**
 * Build a mock DB that covers:
 * - getSession (select + from + where + limit) => [session]
 * - loadHistory (select + from + where + orderBy + limit) => []
 * - nextSequence (select + from + where) => [{ maxSeq: null }]
 * - saveTurn (insert + values + returning) => [turn]
 * - countTurns (select + from + where) => [{ total: 0 }]
 *
 * The mock uses a single chained builder with the union of needed methods.
 */
function makeMockDb(
  session: unknown = null,
  turns: unknown[] = [],
  savedTurn: unknown = null,
): { db: unknown; selectFn: ReturnType<typeof vi.fn>; insertFn: ReturnType<typeof vi.fn> } {
  const limit = vi.fn();
  const returning = vi.fn();
  const orderBy = vi.fn();
  const where = vi.fn();
  const from = vi.fn();
  const values = vi.fn();
  const set = vi.fn();

  // Configure behaviors
  limit.mockImplementation((_n: number) => Promise.resolve(session ? [session] : []));
  orderBy.mockReturnValue({ limit });
  // where: for getSession → { limit }; for loadHistory/nextSequence → { orderBy, limit }
  where.mockReturnValue({ limit, orderBy, returning: vi.fn().mockResolvedValue([]) });
  from.mockReturnValue({ where, orderBy });

  // For loadHistory we need orderBy → limit → [turns]
  const turnsLimit = vi.fn().mockResolvedValue(turns);
  const turnsOrderBy = vi.fn().mockReturnValue({ limit: turnsLimit });

  // For nextSequence: select().from().where() returns [{maxSeq: null}] directly (awaitable)
  const seqResult = vi.fn().mockResolvedValue([{ maxSeq: null }]);

  // Override: the select mock needs to be smarter based on call order
  let selectCallCount = 0;
  const selectFn = vi.fn().mockImplementation(() => {
    selectCallCount++;
    if (selectCallCount === 1) {
      // First call: getSession
      return {
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockReturnValue({
            limit: vi.fn().mockResolvedValue(session ? [session] : []),
          }),
        }),
      };
    } else if (selectCallCount === 2) {
      // Second call: loadHistory
      return {
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockReturnValue({
            orderBy: vi.fn().mockReturnValue({
              limit: vi.fn().mockResolvedValue(turns),
            }),
          }),
        }),
      };
    } else {
      // Subsequent calls: nextSequence (called multiple times for each saveTurn)
      return {
        from: vi.fn().mockReturnValue({
          where: seqResult,
        }),
      };
    }
  });

  // Insert chain
  const insertFn = vi.fn().mockReturnValue({
    values: vi.fn().mockReturnValue({
      returning: vi.fn().mockResolvedValue([savedTurn ?? buildMockTurn()]),
    }),
  });

  return {
    db: { select: selectFn, insert: insertFn, update: vi.fn(), delete: vi.fn() },
    selectFn,
    insertFn,
  };
}

// ---------------------------------------------------------------------------
// Mock AgentClient
// ---------------------------------------------------------------------------

function makeAgentClient(
  response: Partial<AgentOutput> = {},
): AgentClient {
  const defaultResponse: AgentOutput = {
    text: 'Here is your answer.',
    toolCalls: [],
    inputTokens: 50,
    outputTokens: 25,
    stopReason: 'end_turn',
    ...response,
  };

  return {
    generate: vi.fn().mockResolvedValue(defaultResponse),
  };
}

// ---------------------------------------------------------------------------
// Mock SseStream
// ---------------------------------------------------------------------------

function makeMockStream() {
  return {
    isClosed: false,
    sendToken: vi.fn(),
    sendToolCall: vi.fn(),
    sendToolResult: vi.fn(),
    done: vi.fn(),
    error: vi.fn(),
  };
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const SESSION_ID = 'session-abc';
const TENANT_ID = 'tenant-1';
const USER_MSG = 'What is the weather?';

// ---------------------------------------------------------------------------
// Tests: Session validation
// ---------------------------------------------------------------------------

describe('AgentLoopService.processMessage — session validation', () => {
  it('throws SessionNotFoundError when session does not exist', async () => {
    const { db } = makeMockDb(null); // null session → getSession returns null
    const agentClient = makeAgentClient();
    const service = new AgentLoopService({ db: db as never, agentClient });

    await expect(
      service.processMessage(SESSION_ID, TENANT_ID, USER_MSG),
    ).rejects.toThrow('Session not found');
  });

  it('throws AgentLoopError when session is not running', async () => {
    const pendingSession = buildMockSession({ status: 'pending' });
    const { db } = makeMockDb(pendingSession);
    const agentClient = makeAgentClient();
    const service = new AgentLoopService({ db: db as never, agentClient });

    await expect(
      service.processMessage(SESSION_ID, TENANT_ID, USER_MSG),
    ).rejects.toThrow(AgentLoopError);
  });

  it('accepts a session in running status', async () => {
    const runningSession = buildMockSession({ status: 'running' });
    const { db } = makeMockDb(runningSession);
    const agentClient = makeAgentClient({ text: 'Answer', toolCalls: [], stopReason: 'end_turn' });
    const service = new AgentLoopService({ db: db as never, agentClient });

    const result = await service.processMessage(SESSION_ID, TENANT_ID, USER_MSG);
    expect(result.responseText).toBe('Answer');
  });
});

// ---------------------------------------------------------------------------
// Tests: Single-turn (no tools)
// ---------------------------------------------------------------------------

describe('AgentLoopService.processMessage — single turn, no tools', () => {
  it('returns the agent text on a clean end_turn response', async () => {
    const session = buildMockSession();
    const { db } = makeMockDb(session);
    const agentClient = makeAgentClient({
      text: 'The weather is sunny.',
      toolCalls: [],
      stopReason: 'end_turn',
      inputTokens: 100,
      outputTokens: 40,
    });
    const service = new AgentLoopService({ db: db as never, agentClient });

    const result = await service.processMessage(SESSION_ID, TENANT_ID, USER_MSG);

    expect(result.responseText).toBe('The weather is sunny.');
    expect(result.toolIterations).toBe(0);
    expect(result.tokenUsage.inputTokens).toBe(100);
    expect(result.tokenUsage.outputTokens).toBe(40);
    expect(result.correlationId).toBeTruthy();
  });

  it('streams token event when SseStream is provided', async () => {
    const session = buildMockSession();
    const { db } = makeMockDb(session);
    const agentClient = makeAgentClient({ text: 'Hello!', toolCalls: [], stopReason: 'end_turn' });
    const service = new AgentLoopService({ db: db as never, agentClient });
    const stream = makeMockStream();

    await service.processMessage(SESSION_ID, TENANT_ID, USER_MSG, stream as never);

    expect(stream.sendToken).toHaveBeenCalledWith('Hello!');
    expect(stream.done).toHaveBeenCalledOnce();
  });

  it('persists user turn and assistant turn', async () => {
    const session = buildMockSession();
    const { db, insertFn } = makeMockDb(session);
    const agentClient = makeAgentClient({ text: 'Done.', toolCalls: [], stopReason: 'end_turn' });
    const service = new AgentLoopService({ db: db as never, agentClient });

    await service.processMessage(SESSION_ID, TENANT_ID, USER_MSG);

    // Should insert: user turn + assistant turn = 2 inserts
    expect(insertFn).toHaveBeenCalledTimes(2);
  });

  it('emits a typed context-window event when utilization is high', async () => {
    const session = buildMockSession();
    const { db } = makeMockDb(session);
    const agentClient = makeAgentClient({
      text: 'Short answer.',
      toolCalls: [],
      stopReason: 'end_turn',
    });
    const eventService = { emitEvent: vi.fn().mockResolvedValue(undefined) };
    const service = new AgentLoopService({
      db: db as never,
      agentClient,
      eventService: eventService as never,
    });

    await service.processMessage(SESSION_ID, TENANT_ID, 'x'.repeat(700_000));

    await vi.waitFor(() => {
      expect(eventService.emitEvent).toHaveBeenCalledWith(
        TENANT_ID,
        'orchestrator.context_window.high_utilization',
        expect.objectContaining({
          sessionId: SESSION_ID,
          tenantId: TENANT_ID,
          utilizationPct: expect.any(Number),
        }),
        SESSION_ID,
      );
    });
  });
});

// ---------------------------------------------------------------------------
// Tests: Tool use loop
// ---------------------------------------------------------------------------

describe('AgentLoopService.processMessage — tool use loop', () => {
  it('routes a tool call and re-invokes the agent', async () => {
    const session = buildMockSession();
    const { db } = makeMockDb(session);

    // First call: tool_use, second call: end_turn with text
    const toolCallResponse: AgentOutput = {
      text: '',
      toolCalls: [{ id: 'tc-1', type: 'tool_use', name: 'search', input: { q: 'weather' } }],
      inputTokens: 50,
      outputTokens: 10,
      stopReason: 'tool_use',
    };
    const finalResponse: AgentOutput = {
      text: 'The weather is sunny.',
      toolCalls: [],
      inputTokens: 80,
      outputTokens: 30,
      stopReason: 'end_turn',
    };

    const generateFn = vi.fn()
      .mockResolvedValueOnce(toolCallResponse)
      .mockResolvedValueOnce(finalResponse);
    const agentClient = { generate: generateFn };

    const toolRouter: ToolRouter = {
      discoverTools: vi.fn().mockResolvedValue([]),
      executeToolCall: vi.fn().mockResolvedValue({ result: 'Sunny in NYC', isError: false }),
    };

    const service = new AgentLoopService({ db: db as never, agentClient, toolRouter });

    const result = await service.processMessage(SESSION_ID, TENANT_ID, USER_MSG);

    expect(result.responseText).toBe('The weather is sunny.');
    expect(result.toolIterations).toBe(1);
    expect(generateFn).toHaveBeenCalledTimes(2);
    expect(toolRouter.executeToolCall).toHaveBeenCalledWith('search', { q: 'weather' }, TENANT_ID, 'user-1');
  });

  it('emits tool_call and tool_result events on the stream', async () => {
    const session = buildMockSession();
    const { db } = makeMockDb(session);

    const generateFn = vi.fn()
      .mockResolvedValueOnce({
        text: '',
        toolCalls: [{ id: 'tc-1', type: 'tool_use', name: 'lookup', input: { id: '42' } }],
        inputTokens: 50,
        outputTokens: 10,
        stopReason: 'tool_use',
      })
      .mockResolvedValueOnce({
        text: 'Result found.',
        toolCalls: [],
        inputTokens: 80,
        outputTokens: 20,
        stopReason: 'end_turn',
      });
    const agentClient = { generate: generateFn };
    const toolRouter: ToolRouter = {
      discoverTools: vi.fn().mockResolvedValue([]),
      executeToolCall: vi.fn().mockResolvedValue({ result: 'data for id 42', isError: false }),
    };

    const service = new AgentLoopService({ db: db as never, agentClient, toolRouter });
    const stream = makeMockStream();

    await service.processMessage(SESSION_ID, TENANT_ID, USER_MSG, stream as never);

    expect(stream.sendToolCall).toHaveBeenCalledWith('lookup', 'tc-1', { id: '42' });
    expect(stream.sendToolResult).toHaveBeenCalledWith('lookup', 'tc-1', 'data for id 42', false);
    expect(stream.sendToken).toHaveBeenCalledWith('Result found.');
    expect(stream.done).toHaveBeenCalledOnce();
  });

  it('terminates at MAX_TOOL_ITERATIONS and throws AgentLoopError', async () => {
    const session = buildMockSession();
    const { db } = makeMockDb(session);

    // Always returns tool_use — should trigger the iteration guard
    const generateFn = vi.fn().mockResolvedValue({
      text: '',
      toolCalls: [{ id: 'tc-inf', type: 'tool_use', name: 'loop-tool', input: {} }],
      inputTokens: 10,
      outputTokens: 5,
      stopReason: 'tool_use',
    });
    const agentClient = { generate: generateFn };
    const toolRouter: ToolRouter = {
      discoverTools: vi.fn().mockResolvedValue([]),
      executeToolCall: vi.fn().mockResolvedValue({ result: 'ok', isError: false }),
    };

    const service = new AgentLoopService({ db: db as never, agentClient, toolRouter });
    const stream = makeMockStream();

    await expect(
      service.processMessage(SESSION_ID, TENANT_ID, USER_MSG, stream as never),
    ).rejects.toThrow(AgentLoopError);

    // Verify stream received an error event
    expect(stream.error).toHaveBeenCalledOnce();
    // generateFn should have been called exactly MAX_TOOL_ITERATIONS times (10)
    expect(generateFn).toHaveBeenCalledTimes(10);
  });
});

// ---------------------------------------------------------------------------
// Tests: StubToolRouter
// ---------------------------------------------------------------------------

describe('StubToolRouter', () => {
  it('returns empty tools array', async () => {
    const router = new StubToolRouter();
    const tools = await router.discoverTools('tenant-1');
    expect(tools).toEqual([]);
  });

  it('returns a mock result for any tool call', async () => {
    const router = new StubToolRouter();
    const result = await router.executeToolCall('search', { q: 'test' }, 'tenant-1');
    expect(result.result).toContain('search');
    expect(result.isError).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Tests: assembleSystemPrompt
// ---------------------------------------------------------------------------

describe('assembleSystemPrompt', () => {
  it('returns a non-empty string', () => {
    const prompt = assembleSystemPrompt({
      tenantId: 'tenant-1',
      sessionId: 'session-1',
      correlationId: 'corr-1',
    });
    expect(typeof prompt).toBe('string');
    expect(prompt.length).toBeGreaterThan(10);
  });

  it('includes the session and tenant IDs for observability', () => {
    const prompt = assembleSystemPrompt({
      tenantId: 'tenant-xyz',
      sessionId: 'session-abc',
      correlationId: 'corr-123',
    });
    expect(prompt).toContain('session-abc');
    expect(prompt).toContain('tenant-xyz');
    expect(prompt).toContain('corr-123');
  });
});

// ---------------------------------------------------------------------------
// Tests: AnthropicAgentClient — constructor
// ---------------------------------------------------------------------------

describe('AnthropicAgentClient', () => {
  beforeEach(() => {
    vi.unstubAllEnvs();
  });

  it('can be instantiated without a real API key (unit test boundary)', () => {
    // This just tests that the class can be constructed.
    // generate() would fail without a real API key — that is expected.
    expect(() => new AnthropicAgentClient({ apiKey: 'test-key' })).not.toThrow();
  });

  it('uses JOYUS_ANTHROPIC_MODEL when ORCHESTRATOR_MODEL is not set', () => {
    vi.stubEnv('JOYUS_ANTHROPIC_MODEL', 'claude-sonnet-4-6');

    const client = new AnthropicAgentClient({ apiKey: 'test-key' });

    expect((client as unknown as { model: string }).model).toBe('claude-sonnet-4-6');
  });

  it('lets ORCHESTRATOR_MODEL override the shared Anthropic model env var', () => {
    vi.stubEnv('JOYUS_ANTHROPIC_MODEL', 'claude-sonnet-4-6');
    vi.stubEnv('ORCHESTRATOR_MODEL', 'claude-opus-4-7');

    const client = new AnthropicAgentClient({ apiKey: 'test-key' });

    expect((client as unknown as { model: string }).model).toBe('claude-opus-4-7');
  });
});
