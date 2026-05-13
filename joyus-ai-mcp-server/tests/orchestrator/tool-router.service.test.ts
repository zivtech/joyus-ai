/**
 * Unit tests for ToolRouterService (WP05 — T034, T035, T036, T037)
 *
 * All external dependencies are mocked:
 * - tools/executor.ts is mocked to avoid DB + OAuth dependencies
 * - tools/index.ts is partially mocked (tool definitions are static, no DB)
 * - EventService is mocked to verify event emission
 *
 * Tests cover:
 * - T034: Tool discovery returns all platform tools; cache hit/miss
 * - T035: Tool dispatch success — returns string result
 * - T036: Authorized tools = discovery minus circuit-broken tools
 * - T037: Transient failure retries (3x); semantic failure no retry
 * - T037: Circuit breaker opens after 5 consecutive failures
 * - T037: Circuit breaker closes after cooldown expires
 * - T037: Timeout treated as transient failure
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// ============================================================
// Mocks
// ============================================================

// Mock the tool executor — avoids real DB/OAuth calls
vi.mock('../../src/tools/executor.js', () => ({
  executeTool: vi.fn(),
}));

// Mock the tool index to return a minimal stable set for tests
vi.mock('../../src/tools/index.js', () => ({
  contentTools: [
    {
      name: 'content_list_sources',
      description: 'List content sources',
      inputSchema: { type: 'object', properties: {} },
    },
  ],
  githubTools: [
    {
      name: 'github_list_repos',
      description: 'List GitHub repos',
      inputSchema: { type: 'object', properties: {} },
    },
  ],
  googleTools: [],
  jiraTools: [],
  opsTools: [],
  pipelineTools: [],
  profileTools: [],
  slackTools: [],
}));

import { ToolRouterService } from '../../src/orchestrator/tool-router.service.js';
import { executeTool } from '../../src/tools/executor.js';

const mockExecuteTool = vi.mocked(executeTool);

// ============================================================
// Helpers
// ============================================================

function makeEventService() {
  return {
    emitEvent: vi.fn().mockResolvedValue({ sequence: 1 }),
  };
}

const TENANT_ID = 'tenant-abc';

// ============================================================
// T034: Tool Discovery
// ============================================================

describe('ToolRouterService.discoverTools — T034', () => {
  it('returns all platform tools from the registry', async () => {
    const router = new ToolRouterService();
    const tools = await router.discoverTools(TENANT_ID);

    expect(tools.length).toBeGreaterThan(0);
    expect(tools.every((t) => t.name && t.description && t.inputSchema)).toBe(true);
  });

  it('includes tools from all registered tool sets', async () => {
    const router = new ToolRouterService();
    const tools = await router.discoverTools(TENANT_ID);
    const names = tools.map((t) => t.name);

    expect(names).toContain('content_list_sources');
    expect(names).toContain('github_list_repos');
  });

  it('caches tool list per tenant (second call does not re-compute)', async () => {
    const router = new ToolRouterService();

    const first = await router.discoverTools(TENANT_ID);
    const second = await router.discoverTools(TENANT_ID);

    // Same array reference (cached)
    expect(first).toBe(second);
  });

  it('returns fresh list after cache is invalidated', async () => {
    const router = new ToolRouterService();

    const first = await router.discoverTools(TENANT_ID);
    router.invalidateCache(TENANT_ID);
    const second = await router.discoverTools(TENANT_ID);

    // Different array reference after invalidation
    expect(first).not.toBe(second);
    // But same content
    expect(second.length).toBe(first.length);
  });
});

// ============================================================
// T036: Permission Filtering
// ============================================================

describe('ToolRouterService.getAuthorizedTools — T036', () => {
  it('returns all tools when no circuit breakers are open', async () => {
    const router = new ToolRouterService();
    const all = await router.discoverTools(TENANT_ID);
    const authorized = await router.getAuthorizedTools(TENANT_ID);

    expect(authorized.length).toBe(all.length);
  });

  it('excludes tools with an open circuit breaker', async () => {
    const router = new ToolRouterService();
    // Use semantic failure (no retry) to quickly trip the circuit breaker
    mockExecuteTool.mockRejectedValue(new Error('Request failed with status code 404'));

    // Trip the circuit breaker for content_list_sources
    for (let i = 0; i < 5; i++) {
      await router.executeToolCall('content_list_sources', {}, TENANT_ID);
    }

    const authorized = await router.getAuthorizedTools(TENANT_ID);
    const names = authorized.map((t) => t.name);

    expect(names).not.toContain('content_list_sources');
    // Other tools are still authorized
    expect(names).toContain('github_list_repos');
  });
});

// ============================================================
// T035: Tool Dispatch
// ============================================================

describe('ToolRouterService.executeToolCall — T035', () => {
  beforeEach(() => {
    mockExecuteTool.mockReset();
  });

  it('dispatches to executeTool and returns string result', async () => {
    mockExecuteTool.mockResolvedValue('source list: []');
    const router = new ToolRouterService();

    const result = await router.executeToolCall('content_list_sources', {}, TENANT_ID);

    expect(result.isError).toBe(false);
    expect(result.result).toBe('source list: []');
    expect(mockExecuteTool).toHaveBeenCalledWith(TENANT_ID, 'content_list_sources', {});
  });

  it('JSON-stringifies non-string tool results', async () => {
    mockExecuteTool.mockResolvedValue({ items: ['a', 'b'] });
    const router = new ToolRouterService();

    const result = await router.executeToolCall('content_list_sources', {}, TENANT_ID);

    expect(result.result).toBe('{"items":["a","b"]}');
    expect(result.isError).toBe(false);
  });

  it('emits tool.called and tool.completed events on success', async () => {
    mockExecuteTool.mockResolvedValue('ok');
    const eventService = makeEventService();
    const router = new ToolRouterService({ eventService: eventService as never });

    await router.executeToolCall('content_list_sources', { x: 1 }, TENANT_ID);

    // Allow async fire-and-forget to settle
    await new Promise((r) => setTimeout(r, 10));

    const calls = eventService.emitEvent.mock.calls.map(([, type]) => type);
    expect(calls).toContain('tool.called');
    expect(calls).toContain('tool.completed');
  });

  it('emits tool.failed event on error', async () => {
    mockExecuteTool.mockRejectedValue(new Error('Network error'));
    const eventService = makeEventService();
    const router = new ToolRouterService({ eventService: eventService as never });

    await router.executeToolCall('content_list_sources', {}, TENANT_ID);

    await new Promise((r) => setTimeout(r, 10));

    const calls = eventService.emitEvent.mock.calls.map(([, type]) => type);
    expect(calls).toContain('tool.failed');
  });

  it('returns error result when circuit breaker is open', async () => {
    const router = new ToolRouterService();
    // Use semantic failure (no retry) to quickly trip the circuit breaker
    mockExecuteTool.mockRejectedValue(new Error('Request failed with status code 404'));

    // Trip the circuit breaker
    for (let i = 0; i < 5; i++) {
      await router.executeToolCall('content_list_sources', {}, TENANT_ID);
    }

    // Now the circuit should be open — no real dispatch
    mockExecuteTool.mockReset();
    const result = await router.executeToolCall('content_list_sources', {}, TENANT_ID);

    expect(result.isError).toBe(true);
    expect(result.result).toContain('circuit breaker open');
    expect(mockExecuteTool).not.toHaveBeenCalled();
  });
});

// ============================================================
// T037: Retry Logic
// ============================================================

describe('ToolRouterService — T037 transient retries', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    mockExecuteTool.mockReset();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('retries transient failures (network error) up to 3 times', async () => {
    // Fail 3 times (transient), succeed on 4th
    mockExecuteTool
      .mockRejectedValueOnce(new Error('ECONNREFUSED'))
      .mockRejectedValueOnce(new Error('ETIMEDOUT'))
      .mockRejectedValueOnce(new Error('ECONNRESET'))
      .mockResolvedValueOnce('success');

    const router = new ToolRouterService();

    // Run with fake timers — tick through retry delays automatically
    const resultPromise = router.executeToolCall('content_list_sources', {}, TENANT_ID);
    await vi.runAllTimersAsync();
    const result = await resultPromise;

    expect(result.isError).toBe(false);
    expect(result.result).toBe('success');
    expect(mockExecuteTool).toHaveBeenCalledTimes(4);
  });

  it('returns error after all 4 attempts fail (transient)', async () => {
    mockExecuteTool.mockRejectedValue(new Error('ECONNREFUSED'));

    const router = new ToolRouterService();

    const resultPromise = router.executeToolCall('content_list_sources', {}, TENANT_ID);
    await vi.runAllTimersAsync();
    const result = await resultPromise;

    expect(result.isError).toBe(true);
    expect(result.result).toContain('failed after');
    // Initial attempt + 3 retries = 4 calls
    expect(mockExecuteTool).toHaveBeenCalledTimes(4);
  });

  it('does NOT retry semantic failures (400-class errors)', async () => {
    const semanticError = new Error('Request failed with status code 404');
    mockExecuteTool.mockRejectedValue(semanticError);

    const router = new ToolRouterService();

    const resultPromise = router.executeToolCall('content_list_sources', {}, TENANT_ID);
    await vi.runAllTimersAsync();
    const result = await resultPromise;

    expect(result.isError).toBe(true);
    expect(result.result).toContain('returned an error');
    // No retry — exactly one call
    expect(mockExecuteTool).toHaveBeenCalledTimes(1);
  });

  it('treats 503 as transient and retries', async () => {
    const err503 = new Error('Request failed with status code 503');
    mockExecuteTool
      .mockRejectedValueOnce(err503)
      .mockResolvedValueOnce('recovered');

    const router = new ToolRouterService();

    const resultPromise = router.executeToolCall('content_list_sources', {}, TENANT_ID);
    await vi.runAllTimersAsync();
    const result = await resultPromise;

    expect(result.isError).toBe(false);
    expect(result.result).toBe('recovered');
    expect(mockExecuteTool).toHaveBeenCalledTimes(2);
  });

  it('treats 401 as semantic and does NOT retry', async () => {
    const err401 = new Error('Request failed with status code 401');
    mockExecuteTool.mockRejectedValue(err401);

    const router = new ToolRouterService();

    const resultPromise = router.executeToolCall('content_list_sources', {}, TENANT_ID);
    await vi.runAllTimersAsync();
    const result = await resultPromise;

    expect(result.isError).toBe(true);
    expect(mockExecuteTool).toHaveBeenCalledTimes(1);
  });
});

// ============================================================
// T037: Circuit Breaker
// ============================================================

describe('ToolRouterService — T037 circuit breaker', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    mockExecuteTool.mockReset();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('opens circuit breaker after 5 consecutive failures', async () => {
    // Use real timers — semantic failures don't have retry delays
    vi.useRealTimers();

    // Semantic failures increment the counter without retries
    mockExecuteTool.mockRejectedValue(new Error('Request failed with status code 404'));

    const router = new ToolRouterService();

    for (let i = 0; i < 5; i++) {
      await router.executeToolCall('content_list_sources', {}, TENANT_ID);
    }

    const state = router.getCircuitBreakerState(TENANT_ID, 'content_list_sources');
    expect(state?.openedAt).not.toBeNull();
    expect(state?.consecutiveFailures).toBe(5);
  });

  it('emits tool.circuit_breaker.opened event when circuit opens', async () => {
    // Use real timers for this test — semantic failures don't need retry delays
    vi.useRealTimers();

    mockExecuteTool.mockRejectedValue(new Error('Request failed with status code 404'));
    const eventService = makeEventService();
    const router = new ToolRouterService({ eventService: eventService as never });

    for (let i = 0; i < 5; i++) {
      await router.executeToolCall('content_list_sources', {}, TENANT_ID);
    }

    // Allow async event emission to settle
    await new Promise((r) => setTimeout(r, 20));

    const types = eventService.emitEvent.mock.calls.map(([, type]) => type);
    expect(types).toContain('tool.circuit_breaker.opened');
  });

  it('auto-closes circuit breaker after cooldown (5 minutes)', async () => {
    mockExecuteTool.mockRejectedValue(new Error('Request failed with status code 404'));
    const router = new ToolRouterService();

    // Open the circuit
    for (let i = 0; i < 5; i++) {
      const p = router.executeToolCall('content_list_sources', {}, TENANT_ID);
      await vi.runAllTimersAsync();
      await p;
    }

    // Advance clock past the 5-minute cooldown
    vi.advanceTimersByTime(5 * 60 * 1000 + 1);

    // Circuit should now be closed — isCircuitOpen check happens inside getAuthorizedTools
    const authorized = await router.getAuthorizedTools(TENANT_ID);
    const names = authorized.map((t) => t.name);

    expect(names).toContain('content_list_sources');

    const state = router.getCircuitBreakerState(TENANT_ID, 'content_list_sources');
    expect(state?.openedAt).toBeNull();
  });
});
