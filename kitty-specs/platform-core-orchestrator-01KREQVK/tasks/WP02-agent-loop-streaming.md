---
work_package_id: WP02
title: Agent Loop & Streaming
dependencies:
- WP01
requirement_refs:
- FR-002
- FR-010
planning_base_branch: claude/platform-core-orchestrator
merge_target_branch: claude/platform-core-orchestrator
branch_strategy: Planning artifacts for this feature were generated on claude/platform-core-orchestrator. During /spec-kitty.implement this WP may branch from a dependency-specific base, but completed changes must merge back into claude/platform-core-orchestrator unless the human explicitly redirects the landing branch.
subtasks:
- T016
- T017
- T018
- T019
- T020
- T021
agent: "claude:opus:orchestrator:implementer"
shell_pid: "9199"
history:
- date: '2026-05-12'
  action: created
  agent: planner
authoritative_surface: joyus-ai-mcp-server/src/orchestrator/
execution_mode: code_change
owned_files:
- joyus-ai-mcp-server/src/orchestrator/agent-loop.service.ts
- joyus-ai-mcp-server/src/orchestrator/memory.service.ts
- joyus-ai-mcp-server/src/orchestrator/streaming.ts
tags: []
---

# WP02: Agent Loop & Streaming

## Objective

Implement the core agent loop: receive a user message, assemble context, invoke the Claude agent, route tool calls, stream the response back, and persist the conversation turn. After this WP, a user can send a message and get a streamed response with tool use.

## Context

- **WP00 decision:** Determines whether we use Mastra or a custom agent loop, and whether the Claude Agent SDK is invoked via subprocess or sidecar. Read the architecture decision document from WP00 before starting.
- **WP01 provides:** Session service, tenant middleware, Inngest session-run function, turns table
- **Tool routing is stubbed here** — WP05 implements real tool discovery and routing. This WP implements the dispatch interface that WP05 fills in.

## Subtasks

### T016: Implement Agent Loop Service

**Purpose:** The core orchestration loop that processes user messages.

**Steps:**
1. Create `src/orchestrator/agent-loop.service.ts`
2. Implement `processMessage(sessionId, tenantId, userMessage)`:
   a. Load session from session service (verify status is "running")
   b. Load conversation history (turns for this session, ordered by sequence)
   c. Assemble system prompt: Constitution placeholder + skill placeholder + tenant context
   d. Build messages array: system prompt + history + new user message
   e. Invoke the agent (Mastra or custom — see T017)
   f. If response contains tool_use blocks:
      - Route each tool call via tool router interface (stubbed — returns mock results)
      - Collect tool results
      - Re-invoke agent with tool results appended
      - Repeat until agent produces final text response
   g. Return the final response (or stream — see T018)
3. Define the tool router interface: `routeToolCall(tenantId, toolName, toolInput) → ToolResult`
4. Implement a stub tool router that returns `{ result: "Tool not yet connected" }` for any call

**Files:** `src/orchestrator/agent-loop.service.ts` (new, ~150 lines)

### T017: Integrate Claude Agent SDK

**Purpose:** Connect the agent loop to Claude via the chosen integration method.

**If WP00 chose subprocess:**
1. Create a Python script that wraps the Claude Agent SDK: accepts prompt via stdin, returns response via stdout (JSON lines)
2. From TypeScript, spawn subprocess, pipe messages, parse responses
3. Handle subprocess lifecycle: startup, health check, cleanup on session end

**If WP00 chose sidecar:**
1. Create a Python HTTP server wrapping the SDK (Flask/FastAPI)
2. From TypeScript, call the sidecar via HTTP
3. Manage sidecar lifecycle alongside the Node.js process

**If WP00 chose custom TypeScript loop (no Python):**
1. Use `@anthropic-ai/sdk` directly
2. Build messages array with system prompt, conversation history, tools
3. Call `client.messages.create()` with streaming enabled
4. Handle tool_use blocks in the response, loop until final text

**Files:** Depends on WP00 decision. Likely `src/orchestrator/agent-loop.service.ts` (extend) or new adapter file.

### T018: Implement SSE Response Streaming

**Purpose:** Stream agent responses token-by-token to the client.

**Steps:**
1. Create `src/orchestrator/streaming.ts`
2. Implement SSE response helper:
   - Set headers: `Content-Type: text/event-stream`, `Cache-Control: no-cache`, `Connection: keep-alive`
   - Send heartbeat comments every 15 seconds to keep connection alive
   - Event types: `token` (text chunk), `tool_call` (agent is calling a tool), `tool_result` (tool returned), `done` (response complete), `error`
3. Wire into agent loop: as Claude streams tokens, forward them as SSE events
4. Handle client disconnect: clean up resources, don't crash the agent loop
5. Handle backpressure: if client can't consume fast enough, buffer or drop non-critical events

**Event format:**
```
event: token
data: {"text": "Here is"}

event: token
data: {"text": " the answer"}

event: tool_call
data: {"toolName": "search", "input": {"query": "..."}}

event: tool_result
data: {"toolName": "search", "output": "..."}

event: done
data: {"sessionId": "...", "turnSequence": 5}
```

**Files:** `src/orchestrator/streaming.ts` (new, ~80 lines)

### T019: Implement Turn Persistence

**Purpose:** Save each conversation turn to the database.

**Steps:**
1. After the agent loop completes a full turn (user message → agent response, including any tool calls):
   - Save user message as a turn with role "user"
   - Save assistant response as a turn with role "assistant", including toolCalls if any
   - Save each tool result as a turn with role "tool"
2. Assign sequence numbers: auto-increment within the session (query max sequence, add 1)
3. Record token usage from the API response in the tokenUsage JSONB field
4. All turns include tenantId (denormalized from session) for query performance

**Files:** `src/orchestrator/agent-loop.service.ts` (extend with persistence calls)

### T020: Implement Sliding Window Conversation Memory

**Purpose:** Manage context window by keeping the most recent N turns.

**Steps:**
1. Create `src/orchestrator/memory.service.ts`
2. Implement `getConversationHistory(sessionId, tenantId, maxTurns?)`:
   - Query turns ordered by sequence DESC, limit to maxTurns (default: 50)
   - Reverse to chronological order
   - Return as messages array suitable for Claude API
3. Start with a simple approach: keep the last 50 turns
4. Do NOT implement summarization or RAG yet — that's Phase 2

**Files:** `src/orchestrator/memory.service.ts` (new, ~40 lines)

### T021: Add Context Window Monitoring

**Purpose:** Instrument context window usage so we know when to add smarter memory strategies.

**Steps:**
1. After assembling the prompt (system + history + user message), estimate total tokens:
   - Use a rough heuristic: `chars / 4` for token estimation (good enough for monitoring)
   - Or use `@anthropic-ai/sdk`'s token counting if available
2. Log: `{ sessionId, tenantId, estimatedTokens, maxContextTokens, utilizationPct }`
3. Emit a typed event when utilization exceeds 80%: `orchestrator.context_window.high_utilization`
4. This is monitoring only — no action taken. Data informs when to add summarization (future WP).

**Files:** `src/orchestrator/agent-loop.service.ts` (extend with monitoring)

## Definition of Done

- [ ] A user message sent to a running session produces a streamed response
- [ ] Multi-turn tool use works: agent calls a tool, gets result, calls another, responds
- [ ] Each turn (user, assistant, tool) is persisted to the turns table
- [ ] Conversation history from prior turns is included in the prompt
- [ ] SSE stream includes token, tool_call, tool_result, and done events
- [ ] Client disconnect doesn't crash the agent loop
- [ ] Context window utilization is logged per request

## Risks

| Risk | Mitigation |
|------|-----------|
| Python subprocess startup latency too high | WP00 already measured this; if unacceptable, use custom TS loop |
| Streaming backpressure causes memory issues | Start with simple buffering; add backpressure handling if needed |
| Token counting heuristic is too inaccurate | Heuristic is for monitoring only; off by 20% is fine |

## Reviewer Guidance

- **Agent loop termination:** Verify the loop ALWAYS terminates (no infinite tool_use cycles). Check for a maximum iteration count.
- **SSE format:** Verify events follow the format specified above. Missing `event:` or `data:` fields break client parsing.
- **Turn sequence:** Verify sequence numbers are monotonically increasing and unique per session.

## Activity Log

- 2026-05-12T20:50:16Z – claude:opus:orchestrator:implementer – shell_pid=9199 – Started implementation via action command
