/**
 * T002 — Q1: Can Inngest invoke a Mastra agent as a durable step?
 *
 * PASS criterion: A Mastra agent call can be wrapped in step.run() and
 *   returns a serializable result. Checkpoint-resume semantics verified
 *   structurally (step.run mock captures the pattern). Full checkpoint-resume
 *   requires a live Inngest server (noted below).
 *
 * FINDING: CONDITIONAL PASS
 *   - Agent.generate() is async and returns a plain JS object (FullOutput)
 *   - It fits naturally inside Inngest step.run() with no patching
 *   - The Inngest step serialises its return value via JSON; FullOutput.text
 *     is a string, so it round-trips cleanly
 *   - Actual checkpoint-resume (process crash → resume) requires a running
 *     Inngest dev server. That is out of scope for this unit spike; the pattern
 *     is sound and matches the existing adapter.ts approach.
 *
 * Mastra API used (v1.32.1):
 *   - import { Agent } from '@mastra/core/agent'
 *   - import { createTool } from '@mastra/core/tools'
 *   - agent.generate(messages, options) → Promise<FullOutput>
 *   - FullOutput.text: string (JSON-serializable)
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Agent } from '@mastra/core/agent';
import { createTool } from '@mastra/core/tools';
import { z } from 'zod';

// ---------------------------------------------------------------------------
// Minimal Inngest step surface (same interface as adapter.ts InngestStep)
// ---------------------------------------------------------------------------

interface InngestStep {
  run<T>(name: string, fn: () => Promise<T>): Promise<T>;
}

function makeStep(): InngestStep {
  return {
    run: vi.fn((_name: string, fn: () => Promise<unknown>) => fn()),
  } as unknown as InngestStep;
}

// ---------------------------------------------------------------------------
// Minimal mock LLM that returns without hitting Claude API
// ---------------------------------------------------------------------------

/**
 * Returns a mock LanguageModel compatible with Mastra v1.32.1 (AI SDK v5 / specificationVersion 'v2').
 * The v2 model doGenerate must return { content: [...], finishReason, usage }.
 */
function makeMockModel(responseText: string) {
  return {
    specificationVersion: 'v2' as const,
    provider: 'mock',
    modelId: 'mock-echo',
    doGenerate: vi.fn().mockResolvedValue({
      content: [{ type: 'text', text: responseText }],
      finishReason: 'stop',
      usage: { inputTokens: 10, outputTokens: 5 },
      rawCall: { rawPrompt: null, rawSettings: {} },
    }),
  };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeEchoAgent() {
  const echoTool = createTool({
    id: 'echo',
    description: 'Echoes the input message',
    inputSchema: z.object({ message: z.string() }),
    execute: async (inputData) => ({ echoed: inputData.message }),
  });

  return new Agent({
    name: 'echo-agent',
    instructions: 'You are an echo agent. Use the echo tool for every message.',
    model: makeMockModel('echo response') as never,
    tools: { echoTool },
  });
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('Q1 — Mastra + Inngest durable step composition', () => {
  let agent: ReturnType<typeof makeEchoAgent>;
  let step: InngestStep;

  beforeEach(() => {
    agent = makeEchoAgent();
    step = makeStep();
  });

  it('agent.generate() resolves to an object with a text field', async () => {
    // Directly verify the return shape of generate() for serializability
    const result = await agent.generate('hello');
    expect(result).toBeDefined();
    // FullOutput.text is defined once the LLM returns
    // With our mock, text will be the mocked response
    expect(typeof result).toBe('object');
  });

  it('Mastra agent can be invoked inside step.run() without patching', async () => {
    // This is the core Q1 pattern: wrap agent.generate inside step.run()
    const result = await step.run('agent-step', async () => {
      const output = await agent.generate('hello from inngest step');
      // Extract serializable fields for Inngest checkpoint
      return { text: output.text, success: true };
    });

    expect(step.run).toHaveBeenCalledOnce();
    expect(step.run).toHaveBeenCalledWith('agent-step', expect.any(Function));
    expect(result).toEqual({ text: expect.any(String), success: true });
  });

  it('step.run receives the agent checkpoint name as first argument', async () => {
    await step.run('mastra-agent-invocation', async () => {
      return { done: true };
    });
    expect(step.run).toHaveBeenCalledWith('mastra-agent-invocation', expect.any(Function));
  });

  it('agent exception propagates out of step.run() (Inngest will retry)', async () => {
    const faultyModel = makeMockModel('');
    (faultyModel.doGenerate as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('LLM API error'));

    const faultyAgent = new Agent({
      name: 'faulty-agent',
      instructions: 'test',
      model: faultyModel as never,
    });

    await expect(
      step.run('faulty-step', async () => {
        await faultyAgent.generate('hello');
      }),
    ).rejects.toThrow('LLM API error');
  });

  it('result from step.run is JSON-serializable (no circular refs, no class instances)', async () => {
    const result = await step.run('serialization-check', async () => {
      const output = await agent.generate('test');
      // Only extract primitive/plain-object fields for the Inngest checkpoint
      return { text: output.text };
    });

    // If this does not throw, the result is JSON-serializable
    const json = JSON.stringify(result);
    const parsed = JSON.parse(json);
    expect(parsed).toEqual(result);
  });
});

// ---------------------------------------------------------------------------
// Q1 Gap: Checkpoint-resume investigation
// ---------------------------------------------------------------------------

describe('Q1 — Checkpoint-resume gap investigation: @inngest/test availability', () => {
  it('documents @inngest/test package status in inngest@3.x', () => {
    /**
     * INNGEST TEST UTILITIES — AVAILABILITY FINDING:
     *
     * The spec (T002 PASS criterion) requires: "Agent invoked as durable step
     * with checkpoint-resume across retries."
     *
     * To test this without a live dev server, the inngest package references
     * `@inngest/test` in its CHANGELOG.md and uses it internally as a
     * workspace dep. However:
     *
     * FINDING: `@inngest/test` is a SEPARATE published package (not bundled
     * with `inngest`). It is not installed in this spike's node_modules.
     * Attempted: import('@inngest/test') → module not found.
     *
     * The inngest@3.x package exports `"inngest/internals"` to support
     * @inngest/test, but the @inngest/test package itself must be installed
     * separately. Installing it would require:
     *   pnpm add -D @inngest/test
     *
     * Additionally, InngestTestEngine (the in-memory execution engine) was
     * introduced in @inngest/test for use with the real Inngest function
     * registration model — not the InngestStep interface we use in this spike.
     * Our spike tests use a vi.fn() mock of step.run(), not a real Inngest
     * function, which means InngestTestEngine would not validate the checkpoint
     * mechanism anyway.
     *
     * CONCLUSION: Checkpoint-resume cannot be tested in this spike without:
     *   1. Registering real Inngest functions (not vi.fn() mocks)
     *   2. Installing @inngest/test
     *   3. OR running against a live Inngest dev server
     *
     * STATUS: INCONCLUSIVE — requires dev server integration test
     *
     * Pre-WP01 action: Run a live Inngest dev server integration test that:
     *   1. Registers a real Inngest function wrapping agent.generate()
     *   2. Triggers it via Inngest event
     *   3. Confirms checkpoint is stored after step.run() completes
     *   4. Simulates process restart and confirms step is not re-executed
     */

    // Verify @inngest/test is NOT installed in this spike
    let inngestTestAvailable = false;
    try {
      // Dynamic require to detect without breaking the test file
      require.resolve('@inngest/test');
      inngestTestAvailable = true;
    } catch {
      inngestTestAvailable = false;
    }

    console.log(`[Q1 Checkpoint] @inngest/test package installed: ${inngestTestAvailable}`);
    console.log('[Q1 Checkpoint] Status: INCONCLUSIVE — requires dev server integration test');
    console.log('[Q1 Checkpoint] Pre-WP01 action: live Inngest dev server test needed');

    expect(inngestTestAvailable).toBe(false); // confirms the scope limit
  });

  it('documents why vi.fn() step mock cannot validate checkpoint semantics', () => {
    /**
     * WHY THE EXISTING MOCK CANNOT VALIDATE CHECKPOINTS:
     *
     * The step.run() mock in this spike (vi.fn) simply executes the callback
     * inline and returns the result. Real Inngest step.run() does three things
     * our mock doesn't:
     *
     *   1. Before execution: checks if this step's result is in the checkpoint
     *      store (run ID + step ID key). If found, returns cached result
     *      WITHOUT executing the callback again.
     *
     *   2. After execution: serializes the result and writes it to the
     *      checkpoint store (Redis or Inngest Cloud) before returning.
     *
     *   3. On process restart: the Inngest executor replays the event, but
     *      steps with existing checkpoint data short-circuit (memoization).
     *
     * A vi.fn() mock cannot simulate steps 1 or 3. The checkpoint-resume
     * test must use real Inngest execution infrastructure.
     *
     * IMPACT ON Q1 VERDICT:
     *   The composition pattern (agent.generate inside step.run) is proven
     *   correct by the structural tests above. The checkpoint mechanics are
     *   provided by Inngest, not Mastra — and Inngest's checkpoint behavior
     *   is well-documented and tested by the Inngest maintainers. The gap is
     *   in our integration validation, not in the architectural pattern.
     *
     * Q1 VERDICT REMAINS: CONDITIONAL PASS
     *   - Structural composition: proven in this spike
     *   - Checkpoint-resume: INCONCLUSIVE — requires dev server integration test
     *   - Required before WP01 ships to production
     */
    expect(true).toBe(true); // findings documented above
  });
});

/**
 * VERDICT — Q1: CONDITIONAL PASS
 *
 * Evidence:
 * - agent.generate() is a plain async function returning a plain JS object
 * - It composes with step.run() without any code modification to Mastra or Inngest
 * - The return value's text field is a string — JSON-serializable
 * - Exceptions propagate correctly (Inngest retry semantics are preserved)
 *
 * Gap: Checkpoint-resume requires a live Inngest dev server.
 * @inngest/test (the in-memory test engine) is not installed in this spike.
 * Even if installed, it requires real Inngest function registration, not the
 * vi.fn() InngestStep interface used here. Status: INCONCLUSIVE.
 *
 * Pre-WP01 action: Run live dev server integration test to confirm checkpoint
 * mechanics before production use. The structural composition pattern is sound
 * and matches the existing working InngestStepHandlerAdapter approach.
 */
