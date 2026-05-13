/**
 * T006 — Q4: Token overhead ≤15% vs raw API?
 *
 * SCOPE LIMIT — Q4: INCONCLUSIVE (no API key in spike environment)
 *
 * The spec (T006 step 3) requires: "Run each 5 times, collect token counts
 * (input + output) from API responses." This requires calling the real Claude
 * API and reading `usage.inputTokens` / `usage.outputTokens` from responses.
 *
 * ANTHROPIC_API_KEY is not set in this spike environment. Real API calls
 * cannot be made. The character-approximation approach used in Cycle 1 was
 * rejected because it substitutes a parametric model for empirical measurement.
 *
 * WHAT THIS FILE NOW CONTAINS:
 *   1. Structural tests: Mastra payload capture mechanism — confirms the
 *      capture mechanism works and documents what Mastra sends to the model.
 *      These tests have real value as regression tests for payload format.
 *
 *   2. Character-approximation tests: Retained as structural documentation
 *      of Mastra's message format overhead, clearly labeled as approximation.
 *
 *   3. The decision doc records Q4 as INCONCLUSIVE with a note on what
 *      staging validation is needed before WP01 ships token budget logic.
 *
 * WHY INCONCLUSIVE DOES NOT BLOCK ADOPT MASTRA:
 *   Q4 is informational for the token budget. The adoption decision rule
 *   is "Q1-Q3 all pass." Q4 was added to detect whether Mastra's message
 *   wrapping imposes unexpected overhead. Structural analysis (Cycle 1)
 *   shows Mastra adds ~50-75 fixed tokens. At production payloads (≥500-token
 *   system prompt, ≥5 tools), this is ≤10.7%. At toy payloads, it exceeds
 *   15%. Confirm with real API usage data in staging before WP05 (token
 *   budget awareness) is implemented.
 *
 * REQUIRED FOLLOW-UP (pre-WP05):
 *   Run T006 with a real ANTHROPIC_API_KEY against the staging environment.
 *   Compare usage.inputTokens across 5 runs of Mastra vs 5 runs of raw SDK
 *   with identical prompts. Update this doc with actual numbers.
 */

import { describe, it, expect } from 'vitest';
import { Agent } from '@mastra/core/agent';
import { createTool } from '@mastra/core/tools';
import { z } from 'zod';

// ---------------------------------------------------------------------------
// Environment check
// ---------------------------------------------------------------------------

const HAS_API_KEY = Boolean(process.env.ANTHROPIC_API_KEY);

// ---------------------------------------------------------------------------
// Token counting utility (approximation: 1 token ≈ 4 characters)
// NOTE: This is a structural approximation only, not an API measurement.
// ---------------------------------------------------------------------------

function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

function estimateObjectTokens(obj: unknown): number {
  return estimateTokens(JSON.stringify(obj));
}

// ---------------------------------------------------------------------------
// Payload capture — intercept what Mastra sends to the model
// ---------------------------------------------------------------------------

interface CapturedPayload {
  system?: string;
  messages: unknown[];
  tools?: unknown[];
}

function makeCaptureModel(): { captured: CapturedPayload | null; model: unknown } {
  const state = { captured: null as CapturedPayload | null };

  /**
   * AI SDK v5 / Mastra v1.32.1 model spec:
   * - specificationVersion: 'v2'
   * - doGenerate receives: { tools, toolChoice, prompt, providerOptions, ... }
   * - doGenerate must return: { content: [...], finishReason, usage, rawCall }
   * - 'system' is embedded in prompt messages (role: 'system'), NOT a top-level param
   */
  const model = {
    specificationVersion: 'v2' as const,
    provider: 'mock',
    modelId: 'mock-capture',
    doGenerate: async (params: {
      prompt: Array<{ role: string; content: unknown }>;
      tools?: unknown[];
      [key: string]: unknown;
    }) => {
      const systemMessage = params.prompt?.find((m) => m.role === 'system');
      const userMessages = params.prompt?.filter((m) => m.role !== 'system') ?? [];
      state.captured = {
        system: typeof systemMessage?.content === 'string'
          ? systemMessage.content
          : JSON.stringify(systemMessage?.content ?? ''),
        messages: userMessages,
        tools: params.tools,
      };
      return {
        content: [{ type: 'text', text: 'captured response' }],
        finishReason: 'stop' as const,
        usage: { inputTokens: 0, outputTokens: 0 },
        rawCall: { rawPrompt: null, rawSettings: {} },
      };
    },
  };

  return { captured: state.captured, model, get capturedRef() { return state; } };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('Q4 — Token overhead: scope and environment check', () => {
  it('documents Q4 result as INCONCLUSIVE — no ANTHROPIC_API_KEY in spike environment', () => {
    /**
     * Q4 RESULT: INCONCLUSIVE
     *
     * Real measurement requires: ANTHROPIC_API_KEY set, real API calls,
     * reading usage.inputTokens and usage.outputTokens from responses.
     *
     * This environment has no API key. The character-approximation tests below
     * document Mastra's payload structure but cannot produce real token counts.
     *
     * Action required: run T006 with real API key before WP05 ships token
     * budget logic. Expected outcome at production payload sizes: ≤15% overhead.
     */
    console.log(`[Q4] ANTHROPIC_API_KEY present: ${HAS_API_KEY}`);
    console.log('[Q4] Q4 RESULT: INCONCLUSIVE — no API key in spike environment');
    console.log('[Q4] Structural analysis (character approximation) follows.');
    console.log('[Q4] Pre-WP05 action: run with real API key against staging.');

    // This test always passes — it documents the scope limit
    expect(true).toBe(true);
  });
});

describe('Q4 — Token overhead measurement: structural payload analysis (approximation only)', () => {
  it('captures the payload Mastra sends to the underlying model', async () => {
    const capture = makeCaptureModel();
    const capturedRef = (capture as unknown as { capturedRef: { captured: CapturedPayload | null } }).capturedRef;

    const echoTool = createTool({
      id: 'echo',
      description: 'Echoes the input',
      inputSchema: z.object({ message: z.string() }),
      execute: async (i) => ({ result: i.message }),
    });

    const agent = new Agent({
      name: 'overhead-agent',
      instructions: 'You are a helpful assistant.',
      model: capture.model as never,
      tools: { echoTool },
    });

    await agent.generate('hello world');

    expect(capturedRef.captured).not.toBeNull();
  });

  it('estimates Mastra payload size vs raw SDK for minimal agent (character approximation)', async () => {
    const capture = makeCaptureModel();
    const capturedRef = (capture as unknown as { capturedRef: { captured: CapturedPayload | null } }).capturedRef;

    const simpleTool = createTool({
      id: 'get-time',
      description: 'Returns the current time',
      inputSchema: z.object({}),
      execute: async () => ({ time: new Date().toISOString() }),
    });

    const SYSTEM_INSTRUCTIONS = 'You are a helpful assistant. Answer user questions concisely.';

    const agent = new Agent({
      name: 'perf-test-agent',
      instructions: SYSTEM_INSTRUCTIONS,
      model: capture.model as never,
      tools: { simpleTool },
    });

    const USER_MESSAGE = 'What time is it?';
    await agent.generate(USER_MESSAGE);

    // Estimate Mastra payload tokens (character approximation — NOT real API tokens)
    const mastraPayload = capturedRef.captured;
    const mastraSystemTokens = estimateTokens(mastraPayload?.system ?? '');
    const mastraMessageTokens = estimateObjectTokens(mastraPayload?.messages ?? []);
    const mastraToolTokens = estimateObjectTokens(mastraPayload?.tools ?? []);
    const mastraTotalTokens = mastraSystemTokens + mastraMessageTokens + mastraToolTokens;

    // Estimate raw SDK equivalent (no framework overhead)
    const rawSystemTokens = estimateTokens(SYSTEM_INSTRUCTIONS);
    const rawMessageTokens = estimateTokens(USER_MESSAGE);
    const rawToolTokens = estimateObjectTokens([
      {
        name: 'get-time',
        description: 'Returns the current time',
        input_schema: { type: 'object', properties: {} },
      },
    ]);
    const rawTotalTokens = rawSystemTokens + rawMessageTokens + rawToolTokens;

    const overheadPercent =
      rawTotalTokens > 0
        ? ((mastraTotalTokens - rawTotalTokens) / rawTotalTokens) * 100
        : 0;

    // Log findings
    console.log('[Q4 APPROX] Mastra payload breakdown (character approximation, NOT real API tokens):');
    console.log(`  system: ~${mastraSystemTokens} estimated tokens`);
    console.log(`  messages: ~${mastraMessageTokens} estimated tokens`);
    console.log(`  tools: ~${mastraToolTokens} estimated tokens`);
    console.log(`  total: ~${mastraTotalTokens} estimated tokens`);
    console.log('[Q4 APPROX] Raw SDK equivalent:');
    console.log(`  system: ~${rawSystemTokens} estimated tokens`);
    console.log(`  messages: ~${rawMessageTokens} estimated tokens`);
    console.log(`  tools: ~${rawToolTokens} estimated tokens`);
    console.log(`  total: ~${rawTotalTokens} estimated tokens`);
    console.log(`[Q4 APPROX] Estimated overhead: ${overheadPercent.toFixed(1)}% (character approximation only)`);
    console.log('[Q4] NOTE: These are character-approximations, NOT real API token counts.');
    console.log('[Q4] Q4 verdict requires real API measurement — INCONCLUSIVE in this environment.');

    // The payload was captured (proves the mechanism works)
    expect(mastraTotalTokens).toBeGreaterThan(0);
    expect(rawTotalTokens).toBeGreaterThan(0);
  });

  it('documents the fixed overhead size and production-scale behavior', () => {
    /**
     * STRUCTURAL ANALYSIS (character approximation):
     *
     * Mastra's framework overhead is approximately FIXED at ~50-75 tokens
     * (message format wrapper, prompt array structure). This means:
     *
     *   - Toy payloads (minimal agent, 1 tool): overhead >100% (fixed cost dominates)
     *   - 5 tools, 500-token system: ~10-11% overhead
     *   - 10 tools, 500-token system: ~7% overhead
     *
     * This analysis is based on character-length approximation (4 chars/token).
     * Actual tokenization varies by ±10-15%. The structural pattern is sound;
     * real numbers require API measurement.
     *
     * Action: Confirm with real API usage.inputTokens in staging before
     * implementing token budget logic in WP05.
     */
    expect(true).toBe(true); // structural analysis documented above
  });
});

/**
 * Q4 VERDICT: INCONCLUSIVE
 *
 * No ANTHROPIC_API_KEY available in spike environment. Real token counts
 * (usage.inputTokens, usage.outputTokens from API responses) could not be
 * collected per spec requirement T006.
 *
 * Structural analysis (character approximation) suggests overhead is:
 *   - >100% at toy/minimal payload sizes (not representative of production)
 *   - ~10-11% at production scale (≥5 tools, ≥500-token system prompt)
 *
 * The adoption decision is NOT blocked by this inconclusive result because:
 *   1. Q4 is not part of the Q1-Q3 adoption gate
 *   2. Structural analysis aligns with the expected overhead direction
 *   3. Token budget logic is not implemented until WP05 (not WP00)
 *
 * Pre-WP05 action: Run T006 with ANTHROPIC_API_KEY set, 5 API calls each
 * for Mastra and raw SDK, compare usage.inputTokens averages, update this doc.
 */
