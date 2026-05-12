# Research: Platform Core Orchestrator

**Mission:** platform-core-orchestrator-01KREQVK
**Date:** 2026-05-12
**Status:** Complete

---

## R1: Mastra + Inngest Composition Feasibility

**Question:** Can Mastra agents run as durable steps inside Inngest functions?

**Finding:** Mastra v1.32 exposes agents as async functions that accept a prompt and return a result. Inngest's `step.run()` accepts any async function. The composition pattern is:

```typescript
const agentSession = inngest.createFunction(
  { id: "agent-session", concurrency: [{ scope: "env", key: "tenant/{{ event.data.tenantId }}", limit: 10 }] },
  { event: "orchestrator/session.created" },
  async ({ event, step }) => {
    const result = await step.run("invoke-agent", async () => {
      const agent = new Agent({ /* config */ });
      return agent.generate(event.data.prompt);
    });
    return result;
  }
);
```

**Risk:** Mastra's internal state (conversation history, tool results) may not serialize cleanly across Inngest step boundaries. The spike must test multi-step agent loops where the agent calls a tool, gets a result, and continues — not just single-shot generation.

**Decision:** Defer to WP00 spike. Spike must test the multi-step case, not just single invocation.

---

## R2: Python↔TypeScript Boundary for Claude Agent SDK

**Question:** How should the platform invoke the Python Claude Agent SDK from the TypeScript stack? (OQ-1 from spec)

**Alternatives evaluated:**

| Option | Latency | Complexity | Maturity |
|--------|---------|-----------|----------|
| **A: Python sidecar process** — long-running Python process, TypeScript communicates via HTTP/gRPC | Low (process already warm) | Medium (manage sidecar lifecycle, health checks) | Proven pattern (microservices) |
| **B: Subprocess per session** — spawn `python -m agent_sdk` per agent session, communicate via stdin/stdout | Medium (process startup ~200ms) | Low (no long-running process to manage) | Simple but fragile at scale |
| **C: Wait for TypeScript SDK** — Anthropic may release a TypeScript Agent SDK | Zero boundary | Zero | Uncertain timeline; no announcement |
| **D: Build custom agent loop** — implement the agent loop in TypeScript using raw Claude API | Zero boundary | High (re-implement what the SDK does) | Must maintain parity with SDK features |

**Decision:** Evaluate options A and B in WP00 spike. Option D is the fallback if the Python boundary proves unacceptable. Option C is not actionable.

**Recommendation:** Start with Option B (subprocess) for the spike — simplest to test. If latency is acceptable (<500ms overhead per session creation), adopt it. If not, switch to Option A (sidecar) in WP01.

---

## R3: Conversation Memory Strategy

**Question:** Sliding window, summarization, or RAG for context window management? (OQ-2 from spec)

**Analysis:**

| Strategy | Pros | Cons | Best for |
|----------|------|------|----------|
| **Sliding window** | Simple, predictable, no extra LLM calls | Loses old context abruptly | Short conversations (<20 turns) |
| **Summarization** | Preserves key facts, compact | Lossy, adds LLM call overhead | Medium conversations (20-50 turns) |
| **RAG retrieval** | Retrieves relevant past turns, scales to long conversations | Adds latency, requires embedding infra | Long conversations (50+ turns) |

**Decision:** Start with sliding window (simplest). Instrument context window utilization per session. When data shows conversations regularly exceeding 20 turns, add summarization as a second tier. RAG is Phase 2+ only if needed.

**Rationale:** The spec's NFR-001 allows <200ms orchestrator overhead. Summarization adds an LLM call (~1-2s). Sliding window has zero overhead. Start simple, add complexity only when data justifies it.

---

## R4: Tool Call Retry Visibility

**Question:** Should retries be transparent to the agent or visible? (OQ-3 from spec)

**Decision:** Hybrid approach.

- **Transient failures** (network timeout, 503, rate limit): Orchestrator retries silently up to 3 times with exponential backoff. Agent sees the final result (success or failure after all retries exhausted).
- **Semantic failures** (tool returns an error result, invalid input): Passed to agent immediately — the agent needs to know the tool rejected the input to adjust its approach.
- **Circuit breaker**: After 5 consecutive failures for a tool, temporarily remove it from the available tool set and inform the agent.

**Rationale:** The agent is good at adapting to semantic errors ("this search returned no results, let me try different terms") but has no useful response to transient infrastructure errors. Let the orchestrator handle infrastructure; let the agent handle semantics.

---

## R5: Existing Codebase Integration Points

**Finding:** The `joyus-ai-mcp-server` already has:

| Component | Location | Relevance |
|-----------|----------|-----------|
| Inngest client + adapter | `src/inngest/` | Direct reuse — orchestrator functions register here |
| Inngest function registry | `src/inngest/registry.ts` | Extend with orchestrator functions |
| Drizzle schema | `src/db/schema.ts` | Extend with session/turn/work-unit tables |
| DB client | `src/db/client.ts` | Direct reuse |
| Pipeline framework | `src/pipelines/` | Pattern reference for step-based execution |
| Tool executors | `src/tools/executors/` | Integration target for tool routing |
| Auth | `src/auth/` | Tenant context extraction |

**Decision:** The orchestrator is a new module (`src/orchestrator/`) within the existing MCP server codebase, not a separate service. It extends the existing Inngest, DB, and auth infrastructure.

---

## R6: SSE vs WebSocket for Response Streaming

**Decision:** SSE for the primary response stream.

**Rationale:**
- Unidirectional token streaming fits SSE perfectly (server → client only)
- Existing nginx config handles SSE without upgrade negotiation
- Claude API itself streams via SSE — natural alignment
- Bidirectional communication (user sends a new message) uses standard HTTP POST
- The notification sideband (FR-013) shares the SSE event stream, not a separate WebSocket

WebSocket would only be needed for bidirectional real-time communication (e.g., user interrupting mid-generation). If that requirement emerges, it can be added as a separate transport without replacing SSE.

---

*Research completed: 2026-05-12*
*All open questions from spec resolved with decisions or deferred to WP00 spike*
