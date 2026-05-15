/**
 * Agent Loop Service — WP02 (T016, T017, T019, T021)
 *
 * Core orchestration loop: receive a user message, assemble context, invoke
 * Claude via the Anthropic SDK (native TypeScript — WP00 decision OQ-1), route
 * tool calls via the stub tool router (WP05 fills in real tool discovery),
 * deliver events via SseStream, and persist each conversation turn.
 *
 * Architecture decisions:
 * - ADOPT MASTRA (WP00): Mastra is not yet installed in joyus-ai-mcp-server.
 *   This service implements the same agent loop pattern using @anthropic-ai/sdk
 *   directly (already installed) with an `AgentClient` interface that matches
 *   Mastra's `agent.generate()` shape. When @mastra/core is added to
 *   package.json, the `AnthropicAgentClient` can be replaced with a thin
 *   Mastra wrapper — no changes to AgentLoopService required.
 * - Tool routing is STUBBED (WP05 implements real discovery).
 * - Event-streamed completion is via SseStream (SSE to HTTP clients) — see
 *   streaming.ts. This is not true provider token streaming.
 * - Turn persistence is via MemoryService — see memory.service.ts.
 * - Context window monitoring is T021 (inline, not a separate service).
 *
 * Termination guarantee (reviewer requirement):
 *   The loop ALWAYS terminates. MAX_TOOL_ITERATIONS (default: 10) is enforced.
 *   If the agent exceeds this, an error is thrown. This prevents infinite loops
 *   in case of buggy tool routing or adversarial model behavior.
 */

import Anthropic from '@anthropic-ai/sdk';
import { createId } from '@paralleldrive/cuid2';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';

import type { EventService } from './event.service.js';
import { MemoryService } from './memory.service.js';
import type { SafetyService } from './safety.service.js';
import { SafetyBlockedError } from './safety.service.js';
import { SessionService } from './session.service.js';
import type { SkillLoaderService } from './skill-loader.service.js';
import type { SseStream } from './streaming.js';
import { SessionNotFoundError } from './types.js';
import type { ToolCall, ToolResult } from './types.js';
import type { UsageService } from './usage.service.js';

// ============================================================
// CONFIGURATION
// ============================================================

/**
 * Maximum tool-use iterations per agent turn.
 * Prevents infinite loops if the agent keeps calling tools.
 */
const MAX_TOOL_ITERATIONS = 10;

/**
 * Token heuristic: 4 chars ≈ 1 token (T021 monitoring only, not billing).
 * Off by ±20% is acceptable for context window utilization monitoring.
 */
const CHARS_PER_TOKEN_ESTIMATE = 4;

/**
 * Context window size assumed for the default model (claude-3-5-sonnet).
 * Update if the model changes.
 */
const MAX_CONTEXT_TOKENS = 200_000;

/**
 * Emit a high-utilization event when context window usage exceeds this threshold.
 */
const HIGH_UTILIZATION_THRESHOLD = 0.8;

// ============================================================
// AGENT CLIENT INTERFACE (Mastra-compatible shape)
// ============================================================

/**
 * A single message in Claude's messages array format.
 *
 * Uses ContentBlockParam (the request-side block union) rather than
 * ContentBlock (the response-side union) so the agent loop can construct
 * tool_use + tool_result messages without satisfying response-only fields
 * like TextBlock.citations.
 */
export interface AgentMessage {
  role: 'user' | 'assistant';
  content: string | Anthropic.ContentBlockParam[];
}

/**
 * A registered tool available to the agent.
 */
export interface ToolRegistration {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
}

/**
 * Result returned by a tool execution.
 */
export interface ToolExecutionResult {
  result: string;
  isError?: boolean;
}

/**
 * Output from a single agent generation call.
 */
export interface AgentOutput {
  text: string;
  toolCalls: ToolCall[];
  inputTokens: number;
  outputTokens: number;
  /** Tokens served from the prompt cache (counted in inputTokens but billed at a lower rate). */
  cacheHits: number;
  /** Tokens written to the prompt cache in this invocation (billed at a higher rate). */
  cacheCreations: number;
  /** The model used for this invocation. */
  model: string;
  stopReason: 'end_turn' | 'tool_use' | 'max_tokens' | string;
}

/**
 * Minimal agent client interface.
 * Matches the shape of Mastra's agent.generate() for drop-in substitution.
 * WP05 will provide a real implementation with tool discovery.
 */
export interface AgentClient {
  generate(
    messages: AgentMessage[],
    options: {
      systemPrompt: string;
      tenantId: string;
      tools: ToolRegistration[];
      correlationId: string;
    },
  ): Promise<AgentOutput>;
}

// ============================================================
// TOOL ROUTER INTERFACE (stub — WP05 fills in real routing)
// ============================================================

/**
 * Tool router interface implemented by ToolRouterService (WP05).
 * The stub satisfies the interface with empty/mock returns.
 */
export interface ToolRouter {
  /** Discover ALL tools available to this tenant (may include circuit-broken tools). */
  discoverTools(tenantId: string): Promise<ToolRegistration[]>;

  /**
   * Get tools authorized for this tenant (filters out circuit-broken tools).
   * This is what the agent loop uses to build the tools array for Claude.
   * WP05 provides the real implementation; stub delegates to discoverTools().
   */
  getAuthorizedTools?(tenantId: string): Promise<ToolRegistration[]>;

  /** Execute a tool call. Returns a mock result until WP05. */
  executeToolCall(
    toolName: string,
    toolInput: Record<string, unknown>,
    tenantId: string,
  ): Promise<ToolExecutionResult>;
}

/**
 * Stub tool router — satisfies the interface, returns mock data.
 * WP05 replaces this with real MCP tool discovery and dispatch.
 */
export class StubToolRouter implements ToolRouter {
  async discoverTools(_tenantId: string): Promise<ToolRegistration[]> {
    // WP05 will return real tools from MCP server discovery
    return [];
  }

  async executeToolCall(
    toolName: string,
    _toolInput: Record<string, unknown>,
    _tenantId: string,
  ): Promise<ToolExecutionResult> {
    // WP05 will route to real MCP tool servers
    return {
      result: `Tool "${toolName}" is not yet connected. WP05 will implement real tool routing.`,
      isError: false,
    };
  }
}

// ============================================================
// ANTHROPIC SDK AGENT CLIENT (native TypeScript — WP00 OQ-1)
// ============================================================

/**
 * Agent client backed by @anthropic-ai/sdk (already installed).
 *
 * WP00 decision OQ-1: Native TypeScript is the correct integration path.
 * Zero IPC overhead, single deployment unit, @anthropic-ai/sdk already in
 * production use in joyus-ai-mcp-server.
 *
 * When @mastra/core is added to package.json, this class can be replaced with:
 *   import { Agent } from '@mastra/core/agent';
 *   const agent = new Agent({ name, instructions, model, tools });
 *   return agent.generate(messages, { requestContext }); // same shape
 */
export class AnthropicAgentClient implements AgentClient {
  private readonly client: Anthropic;
  private readonly model: string;

  constructor(options: {
    apiKey?: string;
    model?: string;
  } = {}) {
    this.client = new Anthropic({
      apiKey: options.apiKey ?? process.env.ANTHROPIC_API_KEY,
    });
    this.model = options.model ?? process.env.ORCHESTRATOR_MODEL ?? 'claude-3-5-sonnet-20241022';
  }

  async generate(
    messages: AgentMessage[],
    options: {
      systemPrompt: string;
      tenantId: string;
      tools: ToolRegistration[];
      correlationId: string;
    },
  ): Promise<AgentOutput> {
    const anthropicMessages = messages.map((m) => ({
      role: m.role,
      content: typeof m.content === 'string' ? m.content : m.content,
    }));

    const anthropicTools: Anthropic.Tool[] = options.tools.map((t) => ({
      name: t.name,
      description: t.description,
      input_schema: t.inputSchema as Anthropic.Tool.InputSchema,
    }));

    const response = await this.client.messages.create({
      model: this.model,
      max_tokens: 8096,
      system: options.systemPrompt,
      messages: anthropicMessages,
      ...(anthropicTools.length > 0 ? { tools: anthropicTools } : {}),
    });

    // Extract tool calls from the response
    const toolCalls: ToolCall[] = response.content
      .filter((block): block is Anthropic.ToolUseBlock => block.type === 'tool_use')
      .map((block) => ({
        id: block.id,
        type: 'tool_use' as const,
        name: block.name,
        input: block.input as Record<string, unknown>,
      }));

    // Extract text from the response
    const text = response.content
      .filter((block): block is Anthropic.TextBlock => block.type === 'text')
      .map((b) => b.text)
      .join('');

    // Extract cache token counts from the response (available when prompt caching is active).
    // The Anthropic SDK returns these as optional fields on the usage object.
    const usage = response.usage as {
      input_tokens: number;
      output_tokens: number;
      cache_read_input_tokens?: number;
      cache_creation_input_tokens?: number;
    };

    return {
      text,
      toolCalls,
      inputTokens: usage.input_tokens,
      outputTokens: usage.output_tokens,
      cacheHits: usage.cache_read_input_tokens ?? 0,
      cacheCreations: usage.cache_creation_input_tokens ?? 0,
      model: this.model,
      stopReason: response.stop_reason ?? 'end_turn',
    };
  }
}

// ============================================================
// AGENT LOOP RESULT
// ============================================================

export interface AgentLoopResult {
  responseText: string;
  turnSequence: number;
  correlationId: string;
  toolIterations: number;
  tokenUsage: {
    inputTokens: number;
    outputTokens: number;
  };
}

// ============================================================
// AGENT LOOP SERVICE
// ============================================================

export interface AgentLoopServiceDeps {
  db: NodePgDatabase<Record<string, unknown>>;
  agentClient?: AgentClient;
  toolRouter?: ToolRouter;
  /** WP05: Optional skill loader for constitution and skill injection. */
  skillLoader?: SkillLoaderService;
  /** WP07: Optional safety hook service. When absent, all requests pass through. */
  safetyService?: SafetyService;
  /** WP07: Optional usage tracking service. When absent, no usage events are emitted. */
  usageService?: UsageService;
  /** Optional typed event log for agent-loop observability events. */
  eventService?: EventService;
}

export class AgentLoopService {
  private readonly sessionService: SessionService;
  private readonly memoryService: MemoryService;
  private readonly agentClient: AgentClient;
  private readonly toolRouter: ToolRouter;
  private readonly skillLoader: SkillLoaderService | null;
  private readonly safetyService: SafetyService | null;
  private readonly usageService: UsageService | null;
  private readonly eventService: EventService | null;

  constructor(deps: AgentLoopServiceDeps) {
    this.sessionService = new SessionService(deps.db);
    this.memoryService = new MemoryService(deps.db);
    this.agentClient = deps.agentClient ?? new AnthropicAgentClient();
    this.toolRouter = deps.toolRouter ?? new StubToolRouter();
    this.skillLoader = deps.skillLoader ?? null;
    this.safetyService = deps.safetyService ?? null;
    this.usageService = deps.usageService ?? null;
    this.eventService = deps.eventService ?? null;
  }

  /**
   * Process a user message for a running session.
   *
   * Steps:
   * 1. Load session — verify it exists and is in 'running' status
   * 2. Load conversation history (sliding window)
   * 3. Assemble system prompt
   * 4. Discover available tools (stub returns [])
   * 5. Invoke agent
   * 6. Loop: if tool_use blocks, route each tool call, re-invoke
   * 7. Persist turns (user, assistant, tool results)
   * 8. Stream response via SseStream (if provided)
   * 9. Return the final result
   *
   * @param sessionId - The session to process the message in
   * @param tenantId - Tenant scope (must match session.tenantId)
   * @param userMessage - The user's message text
   * @param stream - Optional SSE stream for tool events and available response text
   */
  async processMessage(
    sessionId: string,
    tenantId: string,
    userMessage: string,
    stream?: SseStream,
  ): Promise<AgentLoopResult> {
    const correlationId = createId();

    // ----------------------------------------------------------------
    // Step 1: Load session and verify status
    // ----------------------------------------------------------------
    const session = await this.sessionService.getSession(tenantId, sessionId);
    if (!session) {
      throw new SessionNotFoundError(sessionId, tenantId);
    }
    if (session.status !== 'running') {
      throw new AgentLoopError(
        `Session ${sessionId} is not running (status: ${session.status})`,
        'SESSION_NOT_RUNNING',
      );
    }

    // ----------------------------------------------------------------
    // Step 2: Load conversation history
    // ----------------------------------------------------------------
    const turns = await this.memoryService.loadHistory(sessionId, tenantId);
    const historyMessages = this.memoryService.turnsToMessages(turns);

    // ----------------------------------------------------------------
    // Step 3: Assemble system prompt (WP05: real constitution + skills)
    // ----------------------------------------------------------------
    // Estimate history token cost for the skill-budget calculation.
    // Uses the same 4-chars-per-token heuristic as the context window monitor.
    const historyTokenEstimate = Math.ceil(
      historyMessages.reduce((sum, m) => {
        const content = typeof m.content === 'string' ? m.content : JSON.stringify(m.content);
        return sum + content.length;
      }, 0) / CHARS_PER_TOKEN_ESTIMATE,
    );

    let constitutionAndSkillsBlock = '';
    if (this.skillLoader) {
      const injectionResult = await this.skillLoader.assemblePromptPrefix(
        tenantId,
        historyTokenEstimate,
      );
      constitutionAndSkillsBlock = injectionResult.block;
    }

    const systemPrompt = assembleSystemPrompt({
      tenantId,
      sessionId,
      correlationId,
      constitutionAndSkillsBlock,
    });

    // ----------------------------------------------------------------
    // Step 4: Build initial messages array
    // (Built before the pre-generation safety hooks so the hooks can
    // inspect the full message list.)
    // ----------------------------------------------------------------
    const messages: AgentMessage[] = [
      ...historyMessages,
      { role: 'user', content: userMessage },
    ];

    // ----------------------------------------------------------------
    // WP07: Pre-generation safety hooks
    // ----------------------------------------------------------------
    let effectivePrompt = systemPrompt;
    if (this.safetyService) {
      const preResult = await this.safetyService.runPreHooks({
        tenantId,
        sessionId,
        systemPrompt,
        messages,
      });
      if (preResult.action === 'block') {
        throw new SafetyBlockedError('pre', preResult.reason);
      }
      effectivePrompt = preResult.effectiveSystemPrompt;
    }

    // ----------------------------------------------------------------
    // Step 5: Get authorized tools (WP05: real permission-filtered discovery)
    // ----------------------------------------------------------------
    const tools = this.toolRouter.getAuthorizedTools
      ? await this.toolRouter.getAuthorizedTools(tenantId)
      : await this.toolRouter.discoverTools(tenantId);

    // ----------------------------------------------------------------
    // T021: Context window monitoring
    // ----------------------------------------------------------------
    this.monitorContextWindow({ systemPrompt: effectivePrompt, messages, sessionId, tenantId, correlationId });

    // ----------------------------------------------------------------
    // Step 6: Persist the user turn BEFORE invoking the agent
    // ----------------------------------------------------------------
    const userTurn = await this.memoryService.saveTurn({
      sessionId,
      tenantId,
      role: 'user',
      content: userMessage,
    });

    // ----------------------------------------------------------------
    // Step 7: Agent loop
    // ----------------------------------------------------------------
    let loopMessages = [...messages];
    let iterationCount = 0;
    let totalInputTokens = 0;
    let totalOutputTokens = 0;
    let finalText = '';

    while (iterationCount < MAX_TOOL_ITERATIONS) {
      iterationCount++;

      // Invoke the agent
      const output = await this.agentClient.generate(loopMessages, {
        systemPrompt: effectivePrompt,
        tenantId,
        tools,
        correlationId,
      });

      totalInputTokens += output.inputTokens;
      totalOutputTokens += output.outputTokens;

      // WP07: Record usage after each invocation
      if (this.usageService) {
        void this.usageService.recordInvocation({
          sessionId,
          tenantId,
          model: output.model,
          turnSequence: iterationCount,
          inputTokens: output.inputTokens,
          outputTokens: output.outputTokens,
          cacheHits: output.cacheHits,
          cacheCreations: output.cacheCreations,
          lastUserMessageAt: new Date(),
        });
      }

      const isFinal = output.stopReason === 'end_turn' || output.toolCalls.length === 0;

      // Send any non-final text already returned by the buffered provider call.
      if (!isFinal && stream && !stream.isClosed && output.text) {
        stream.sendToken(output.text);
      }

      // If the agent returned a final text response with no tool calls, we're done
      if (isFinal) {
        finalText = output.text;

        // WP07: Post-generation safety hooks
        if (this.safetyService) {
          const postResult = await this.safetyService.runPostHooks({
            tenantId,
            sessionId,
            response: finalText,
            toolCalls: output.toolCalls,
          });
          if (postResult.action === 'block') {
            throw new SafetyBlockedError('post', postResult.reason);
          }
          if (postResult.action === 'modify') {
            finalText = postResult.effectiveResponse;
          }
        }

        // Send the final (possibly modified) text as an SSE text event.
        if (stream && !stream.isClosed && finalText) {
          stream.sendToken(finalText);
        }

        // Persist assistant turn
        const assistantTurn = await this.memoryService.saveTurn({
          sessionId,
          tenantId,
          role: 'assistant',
          content: finalText,
          toolCalls: output.toolCalls.length > 0
            ? output.toolCalls.map((tc) => tc as Record<string, unknown>)
            : undefined,
          tokenUsage: {
            inputTokens: totalInputTokens,
            outputTokens: totalOutputTokens,
          },
        });

        // Signal done on the stream
        if (stream && !stream.isClosed) {
          stream.done(sessionId, assistantTurn.sequence);
        }

        return {
          responseText: finalText,
          turnSequence: assistantTurn.sequence,
          correlationId,
          toolIterations: iterationCount - 1,
          tokenUsage: { inputTokens: totalInputTokens, outputTokens: totalOutputTokens },
        };
      }

      // Agent wants to call tools — route each call
      const toolResultBlocks: Anthropic.ToolResultBlockParam[] = [];

      for (const toolCall of output.toolCalls) {
        // Notify client that a tool is being called
        if (stream && !stream.isClosed) {
          stream.sendToolCall(toolCall.name, toolCall.id, toolCall.input);
        }

        // Route the tool call (stub returns a mock result)
        const toolResult = await this.toolRouter.executeToolCall(
          toolCall.name,
          toolCall.input,
          tenantId,
        );

        // Notify client of the tool result
        if (stream && !stream.isClosed) {
          stream.sendToolResult(
            toolCall.name,
            toolCall.id,
            toolResult.result,
            toolResult.isError,
          );
        }

        // Collect tool results for the next agent invocation
        toolResultBlocks.push({
          type: 'tool_result',
          tool_use_id: toolCall.id,
          content: toolResult.result,
          is_error: toolResult.isError,
        });

        // Persist tool turn
        await this.memoryService.saveTurn({
          sessionId,
          tenantId,
          role: 'tool',
          toolResults: [
            {
              type: 'tool_result',
              tool_use_id: toolCall.id,
              toolName: toolCall.name,
              content: toolResult.result,
              is_error: toolResult.isError ?? false,
            },
          ],
        });
      }

      // Persist assistant turn (with tool calls) before the next iteration
      await this.memoryService.saveTurn({
        sessionId,
        tenantId,
        role: 'assistant',
        content: output.text || undefined,
        toolCalls: output.toolCalls.map((tc) => tc as Record<string, unknown>),
        tokenUsage: {
          inputTokens: output.inputTokens,
          outputTokens: output.outputTokens,
        },
      });

      // Append the assistant turn (with tool_use blocks) and tool results
      // to the messages array for the next iteration.
      // Claude API requires the assistant message to include tool_use blocks.
      loopMessages = [
        ...loopMessages,
        {
          role: 'assistant',
          content: [
            ...(output.text ? [{ type: 'text' as const, text: output.text }] : []),
            ...output.toolCalls.map(
              (tc): Anthropic.ToolUseBlock => ({
                type: 'tool_use',
                id: tc.id,
                name: tc.name,
                input: tc.input,
              }),
            ),
          ],
        },
        {
          role: 'user',
          content: toolResultBlocks,
        },
      ];
    }

    // ----------------------------------------------------------------
    // Loop termination guard — should not be reached in normal operation
    // ----------------------------------------------------------------
    const errorMsg = `Agent loop exceeded MAX_TOOL_ITERATIONS (${MAX_TOOL_ITERATIONS}) for session ${sessionId}. This may indicate a tool routing loop or adversarial model behavior.`;
    console.error(`[AgentLoopService] ${errorMsg}`, { sessionId, tenantId, correlationId });

    if (stream && !stream.isClosed) {
      stream.error(errorMsg, 'MAX_ITERATIONS_EXCEEDED');
    }

    throw new AgentLoopError(errorMsg, 'MAX_ITERATIONS_EXCEEDED');
  }

  // ---------------------------------------------------------------------------
  // T021: Context window monitoring
  // ---------------------------------------------------------------------------

  private monitorContextWindow(params: {
    systemPrompt: string;
    messages: AgentMessage[];
    sessionId: string;
    tenantId: string;
    correlationId: string;
  }): void {
    const { systemPrompt, messages, sessionId, tenantId, correlationId } = params;

    // Rough token estimate: total chars / 4
    const totalChars =
      systemPrompt.length +
      messages.reduce((sum, m) => {
        const content = typeof m.content === 'string' ? m.content : JSON.stringify(m.content);
        return sum + content.length;
      }, 0);

    const estimatedTokens = Math.ceil(totalChars / CHARS_PER_TOKEN_ESTIMATE);
    const utilizationPct = estimatedTokens / MAX_CONTEXT_TOKENS;

    console.log('[AgentLoopService] Context window utilization', {
      sessionId,
      tenantId,
      correlationId,
      estimatedTokens,
      maxContextTokens: MAX_CONTEXT_TOKENS,
      utilizationPct: (utilizationPct * 100).toFixed(1) + '%',
    });

    if (utilizationPct >= HIGH_UTILIZATION_THRESHOLD) {
      // Emit typed observability event for future monitoring dashboards.
      // No action is taken — this is monitoring only (T021 spec).
      console.warn('[AgentLoopService] orchestrator.context_window.high_utilization', {
        sessionId,
        tenantId,
        correlationId,
        estimatedTokens,
        utilizationPct,
      });
      void this.emitContextWindowEvent({
        sessionId,
        tenantId,
        utilizationPct,
      });
    }
  }

  private async emitContextWindowEvent(params: {
    sessionId: string;
    tenantId: string;
    utilizationPct: number;
  }): Promise<void> {
    if (!this.eventService) return;

    try {
      await this.eventService.emitEvent(
        params.tenantId,
        'orchestrator.context_window.high_utilization',
        params,
        params.sessionId,
      );
    } catch (err) {
      console.error('[AgentLoopService] Failed to emit context window event:', err);
    }
  }
}

// ============================================================
// SYSTEM PROMPT ASSEMBLY
// ============================================================

interface SystemPromptParams {
  tenantId: string;
  sessionId: string;
  correlationId: string;
  /**
   * WP05: Pre-assembled constitution + skills block from SkillLoaderService.
   * When absent (e.g. in unit tests or before WP05 wiring), falls back to the
   * placeholder text so existing tests remain green.
   */
  constitutionAndSkillsBlock?: string;
}

/**
 * Assemble the system prompt for the agent.
 *
 * Sections (in order):
 * 1. Constitution + skill instructions (from SkillLoaderService — WP05)
 * 2. Tenant context — dynamic per-request metadata for observability
 *
 * Kept as a plain function (not a class method) for testability.
 * Signature is backward-compatible: constitutionAndSkillsBlock is optional.
 */
export function assembleSystemPrompt(params: SystemPromptParams): string {
  const { tenantId, sessionId, correlationId, constitutionAndSkillsBlock } = params;

  // If WP05 skill loader provided content, use it. Otherwise fall back to placeholder.
  const instructionsSection = constitutionAndSkillsBlock && constitutionAndSkillsBlock.trim()
    ? constitutionAndSkillsBlock.trim()
    : `You are a helpful AI assistant operating within the Joyus AI platform.
Follow the operator's instructions and use the available tools to help the user.
Be concise, accurate, and transparent about your reasoning.`;

  // Dynamic tenant context for observability and tool routing
  const tenantContextSection = `\
Session: ${sessionId}
Tenant: ${tenantId}
Correlation: ${correlationId}
`;

  return [instructionsSection, tenantContextSection].join('\n---\n');
}

// ============================================================
// ERRORS
// ============================================================

export class AgentLoopError extends Error {
  constructor(
    message: string,
    public readonly code: string,
  ) {
    super(message);
    this.name = 'AgentLoopError';
  }
}
