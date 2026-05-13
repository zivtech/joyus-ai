# Platform Core Orchestrator — Feature Specification

**Feature:** platform-core-orchestrator
**Date:** May 12, 2026
**Status:** Draft
**Supersedes:** `joyus-ai/kitty-specs/012-platform-core-orchestrator/` (March 2026 draft)
**Depends on:** 002-session-context-management, 005-content-intelligence, 006-content-infrastructure, 009-automated-pipelines, 011-cost-tracking, 013-skills-system, 014-mcp-gateway
**Implementation target:** `joyus-ai` repository
**Tool evaluation:** `planning/agent-orchestration-evaluation-2026-05.md`

---

## 1. Problem Statement

The Joyus AI platform has built foundational capabilities — MCP tools for external services, skills as encoded organizational knowledge, content intelligence (profile engine, attribution, fidelity monitoring), content infrastructure (storage, retrieval, transformation), and session management. However, **no central orchestrator** ties these components into a coherent agent experience.

Without an orchestrator:
- Users cannot send a message and have the platform intelligently route it through tools, apply skills, maintain context, and return a response
- Agent sessions have no lifecycle management — no way to create, track, suspend, resume, or stop agent work
- Multiple agents cannot coordinate on complex tasks
- There is no crash recovery or durable execution — a failed agent session is lost
- Multi-tenant isolation is not enforced at the orchestration layer
- External systems cannot drive agent work programmatically

The orchestrator is the platform's most critical unresolved architectural question. Zero production code exists.

---

## 2. Solution Overview

Build a composition-based orchestration layer that combines:

1. **Durable execution backbone** — reliable function execution with retry, crash recovery, and multi-tenant concurrency controls (Inngest, already adopted)
2. **Agent semantics layer** — session lifecycle, work unit tracking, typed API, event system (custom-built in TypeScript; see Decision Gate below for Mastra substitution)
3. **Agent loops** — individual agent sessions powered by the Claude Agent SDK

The orchestrator follows the **"thick domain, thin orchestration"** principle: the profile engine and content intelligence are the platform's moat, not the coordination layer. The orchestrator is infrastructure — it dispatches, tracks, and recovers agent work, but domain knowledge lives in skills and profiles.

### Architecture (Baseline)

```
┌─────────────────────────────────────────────┐
│           Joyus Platform                    │
│                                             │
│  ┌──────────────────────────────────────┐   │
│  │     Agent Semantics Layer            │   │
│  │  (Custom TypeScript)                 │   │
│  │                                      │   │
│  │  Sessions, Work Units, Events,       │   │
│  │  Tenant Scoping, Typed HTTP API      │   │
│  └──────────────┬───────────────────────┘   │
│                 │                            │
│  ┌──────────────▼───────────────────────┐   │
│  │     Durable Execution (Inngest)      │   │
│  │                                      │   │
│  │  Steps, Retry, Concurrency,          │   │
│  │  Multi-tenant flow control           │   │
│  └──────────────┬───────────────────────┘   │
│                 │                            │
│  ┌──────────────▼───────────────────────┐   │
│  │     Agent Loops (Claude Agent SDK)   │   │
│  │                                      │   │
│  │  Tool use, conversation,             │   │
│  │  skill-guided reasoning              │   │
│  └──────────────────────────────────────┘   │
└─────────────────────────────────────────────┘
```

### Decision Gate: Mastra Spike

Before implementation begins, run a 2-day time-boxed spike to evaluate whether Mastra (TypeScript agent framework, 24K stars) can serve as the agent semantics layer instead of building custom.

**Pass/fail thresholds (defined before the spike):**

| # | Question | PASS | FAIL |
|---|----------|------|------|
| Q1 | Can Mastra agents run inside Inngest functions? | Agent invoked as durable step with checkpoint-resume across retries | Requires workarounds that bypass Inngest step isolation |
| Q2 | Does Mastra's MCP client work with existing MCP server tools? | Connects without forking/patching Mastra internals | Requires monkey-patching transport or custom protocol adapter |
| Q3 | Can tenant isolation be added without fighting the framework? | tenantId injectable via agent/tool context; no global state pollution | Requires process-per-tenant or framework modification |
| Q4 | What is the token cost overhead? | ≤15% vs. raw Claude API calls | >25% OR unpredictable overhead varying with conversation length |

**Decision rule:** Adopt Mastra if Q1–Q3 all pass. Build custom if any of Q1–Q3 fail. If only Q4 fails, evaluate whether developer velocity gains justify the overhead.

**If Mastra is adopted:** The agent semantics layer in FR-001 through FR-004 and FR-007 is implemented using Mastra's agent, workflow, and HTTP server primitives instead of custom code. All other FRs remain unchanged.

See `planning/agent-orchestration-evaluation-2026-05.md` for the full tool evaluation rationale, including patterns borrowed from Gas City, Temporal, and Julep.

---

## 3. Functional Requirements

### FR-001: Agent Session Lifecycle | Status: Draft

The orchestrator manages the full lifecycle of agent sessions.

- **Create**: Dispatch a new agent session bound to a user, tenant, and conversation context
- **Track**: Monitor session status (pending, running, suspended, completed, failed) with real-time visibility
- **Suspend/Resume**: Pause an active session and resume it later with full context restored
- **Stop**: Terminate a session gracefully, persisting final state
- **Kill**: Force-terminate a session that is unresponsive

Each session is a durable execution unit — it survives process crashes, restarts, and infrastructure failures (see FR-005).

**Acceptance criteria:**
- A session can be created, tracked through all status transitions, and stopped
- A suspended session resumes with its full conversation and tool state intact
- Session status is queryable by session ID, user, or tenant

### FR-002: Agent Loop Execution | Status: Draft

The orchestrator implements the core agent loop for each session:

1. **Receive** user message (text, with optional attachments or context)
2. **Resolve context** — load session state, conversation history, applicable skills (FR-009)
3. **Assemble prompt** — system prompt (Constitution + skills + tenant context) + conversation history + user message
4. **Invoke agent** — send assembled prompt to the agent loop, receive response
5. **Process response** — if tool calls are present, route them (FR-008) and loop; if text, deliver to user
6. **Persist** — save the conversation turn (user message, assistant response, tool results) to session history
7. **Stream** — responses stream to the user as they are generated, not batched until completion

The loop continues until the agent produces a final text response with no pending tool calls.

**Acceptance criteria:**
- A user message triggers the full loop and produces a streamed response
- Multi-turn tool use works (agent calls a tool, gets the result, calls another tool, then responds)
- Each turn is persisted and recoverable

### FR-003: Multi-Agent Coordination | Status: Draft

The orchestrator supports coordinating multiple agents on complex tasks.

- **Work units**: Individual pieces of work tracked with status, dependencies, assignees, labels, and metadata (inspired by Gas City's bead model)
- **Grouping**: Work units can be grouped into logical sets with completion tracking (e.g., "all research tasks for this analysis")
- **Dependencies**: Work units can declare dependencies on other work units; the orchestrator enforces execution order
- **Inter-agent messaging**: Agents can send typed messages to other agents within a coordination group without sharing mutable state (inspired by Temporal's signals pattern)

**Acceptance criteria:**
- Multiple work units with declared dependencies execute in correct order
- A work unit group reports completion only when all members complete
- One agent can signal another agent and the recipient receives the message

### FR-004: Event System | Status: Draft

The orchestrator emits typed events for all state changes and supports external subscription.

- **Typed event registry**: Every event has a schema; new event types are registered explicitly, not ad hoc
- **State change events**: Session lifecycle transitions, work unit status changes, tool call results, errors
- **SSE streaming**: External consumers can subscribe to event streams filtered by session, tenant, or event type
- **External subscription**: Webhooks or event bus integration for systems that cannot maintain SSE connections

**Acceptance criteria:**
- Every session lifecycle transition emits a typed event
- An external consumer can subscribe via SSE and receive filtered events in real time
- Events are durable — missed events can be replayed from a known offset

### FR-005: Durable Execution | Status: Draft

All orchestrator work survives failures.

- **Crash recovery**: If the orchestrator process crashes mid-session, the session resumes from its last checkpoint automatically
- **Retry with backoff**: Failed steps retry with configurable exponential backoff and jitter
- **Idempotency**: Retried steps produce the same result as the original execution (idempotency keys on all side-effecting operations)
- **Checkpoint-resume**: Long-running agent sessions checkpoint progress at step boundaries; resume skips completed steps

**Acceptance criteria:**
- A session in progress survives an orchestrator process restart and resumes without data loss
- A failed tool call retries up to the configured limit with exponential backoff
- Replaying a step that already succeeded produces no duplicate side effects

### FR-006: Multi-Tenant Isolation | Status: Draft

Every orchestrator operation is scoped to a tenant.

- **Tenant context**: `tenantId` is present on every session, work unit, event, and database query — enforced at the middleware layer, never derived from request body
- **Data isolation**: No tenant can access another tenant's sessions, conversation history, or events
- **Resource isolation**: Per-tenant concurrency limits, rate limiting, and priority controls prevent one tenant from starving others
- **Namespace separation**: Each tenant operates in a logically isolated namespace with independent session IDs, event streams, and quotas (inspired by Temporal's namespace model)

**Acceptance criteria:**
- A query from Tenant A never returns data belonging to Tenant B
- Per-tenant concurrency limits are enforced (tenant exceeding limit gets queued, not rejected)
- Tenant resource usage is independently measurable

### FR-007: Typed HTTP API | Status: Draft

The orchestrator exposes a typed HTTP API for programmatic control by external systems.

- **Session management**: Create, query, suspend, resume, stop sessions via API
- **Message submission**: Send messages to sessions, receive streamed responses
- **Work unit management**: Create, update, query work units and groups
- **Event subscription**: Subscribe to event streams via API
- **Schema-first**: Every endpoint has a typed schema; OpenAPI documentation is auto-generated from the schema (typed-wire principle from Gas City)
- **CI validation**: API schema correctness is validated in CI — schema drift is a build failure

**Acceptance criteria:**
- All session lifecycle operations are available via HTTP API
- OpenAPI documentation is generated from type definitions, not hand-maintained
- A schema change that breaks the OpenAPI contract fails the CI build

### FR-008: Tool Routing | Status: Draft

The orchestrator discovers and routes tool calls to the correct backend.

- **MCP tool discovery**: Query the MCP Gateway (Spec 014) for available tools scoped to the current tenant
- **Tool dispatch**: Route tool_use calls from the agent loop to the correct MCP server via the gateway
- **Platform tool integration**: Route calls to platform-native services (content infrastructure, profile engine, session management) directly
- **Permission filtering**: Present only tenant-authorized tools to the agent — no tool a tenant hasn't been granted appears in the tool list
- **Failure handling**: Tool timeouts and errors are passed back to the agent as structured error results (not silent failures)

**Acceptance criteria:**
- The agent sees only tools authorized for the current tenant
- A tool_use call reaches the correct backend and the result is marshaled back into the conversation
- A tool timeout produces a structured error visible to the agent

### FR-009: Skill Application | Status: Draft

The orchestrator loads and injects relevant skills as system-level context.

- **Tenant skills**: Organization-level skills that apply to all users in a tenant
- **Role/department skills**: Skills scoped to the user's role or department
- **Task skills**: Skills that activate based on the type of work (e.g., content generation, regulatory analysis, customer support)
- **Skill composition**: Multiple skills are layered according to the composition model defined in Spec 013
- **Token budget awareness**: Skill injection respects the context window budget — skills are prioritized and truncated if necessary

The orchestrator delegates skill resolution to the Skills System (Spec 013) and receives assembled prompt content.

**Acceptance criteria:**
- The correct tenant, role, and task skills are loaded for a given session
- Skill content appears in the system prompt delivered to the agent
- When total skill content exceeds the token budget, lower-priority skills are excluded (not truncated mid-content)

### FR-010: Conversation Memory | Status: Draft

The orchestrator maintains conversation context across turns within a session.

- **Turn history**: Full message history (user messages, assistant responses, tool call results) persisted per session
- **Context window management**: When conversation history exceeds the context window, the orchestrator applies a management strategy (sliding window, summarization, or retrieval — strategy to be determined during implementation spike)
- **Session persistence**: Conversation state survives orchestrator restarts
- **Multi-turn tool use**: Tool results from prior turns remain available in context

**Acceptance criteria:**
- A 20+ turn conversation maintains coherent context
- Conversation history persists across orchestrator restarts
- Context window management activates before the window is exhausted (not after truncation errors)

### FR-011: Safety Integration | Status: Draft

The orchestrator provides integration points for the safety system (Spec 014).

- **Pre-generation hooks**: Before the agent loop invokes the model, the orchestrator calls safety hooks that can modify, block, or annotate the prompt
- **Post-generation hooks**: After the agent produces a response, the orchestrator calls safety hooks that can modify, block, or flag the output
- **Constitution injection**: Constitution rules are included in every system prompt as baseline guardrails
- **Audit logging**: Safety hook invocations and their outcomes (pass, modify, block) are logged for review

The orchestrator provides the hook points; Spec 014 owns the hook implementations.

**Acceptance criteria:**
- A pre-generation hook can block a prompt and prevent model invocation
- A post-generation hook can modify or suppress a response before it reaches the user
- All safety hook invocations are logged with outcome

### FR-012: Cost & Usage Integration | Status: Draft

The orchestrator emits usage data for the cost tracking system (Spec 011).

- **Token accounting**: Every model invocation emits token counts (input, output, cache hits) as structured events
- **Session cost accumulation**: Total token usage is tracked per session and queryable
- **Idle gap detection**: Sessions that consume tokens without user interaction (runaway loops, stuck tool calls) are flagged
- **Cache efficiency**: Cache hit rates per session are tracked to inform cost optimization

The orchestrator emits usage events; Spec 011 owns aggregation, alerting, and reporting.

**Acceptance criteria:**
- Every model invocation emits a usage event with input/output token counts
- Per-session cumulative cost is queryable via API
- An idle session consuming tokens for more than a configurable threshold triggers a flag event

### FR-013: Notification Routing | Status: Draft

A subset of FR-004 events are forwarded to tenant-configured external backends for asynchronous notification. This is not a separate event system — it is a routing layer on top of the event system defined in FR-004.

- **Routable event classes**: Pipeline completion, pipeline failure, review pending, and long-running tool progress events are eligible for external notification routing
- **Tenant configuration**: Each tenant configures which event classes are routed and to which backends (Slack, email, webhook)
- **Separation from response stream**: The primary response stream (FR-002 step 7) handles token-by-token delivery. Notification routing handles asynchronous platform events. These are distinct data flows sharing a single event emission path (FR-004).
- **No delivery ownership**: The orchestrator routes eligible events to the gateway event bus (Spec 014); the gateway handles delivery to external backends

**Acceptance criteria:**
- A pipeline completion event emitted via FR-004 is routed to a tenant-configured webhook
- Notification routing does not interfere with or delay the primary response stream or internal SSE consumers
- Events are routed through the gateway, not delivered directly by the orchestrator

---

## 4. Non-Functional Requirements

| ID | Requirement | Target | Measurement |
|----|-------------|--------|-------------|
| NFR-001 | Orchestrator overhead | < 200ms added by the orchestrator (prompt assembly, tool routing, tenant resolution) before model invocation; model latency tracked separately | Instrumented timing in request trace |
| NFR-002 | Tool routing overhead | < 100ms added by the routing layer per tool call | Instrumented timing in request trace |
| NFR-003 | Concurrent sessions | ≥ 100 active sessions per instance; horizontal scaling via additional instances | Load test with simulated sessions |
| NFR-004 | Availability | 99.9% uptime for the orchestrator API | Uptime monitoring over 30-day window |
| NFR-005 | Request tracing | Every request traced end-to-end with correlation IDs linking session, agent loop, tool calls, and events | Trace completeness audit |
| NFR-006 | Conversation persistence | Session state durable across orchestrator restarts with zero data loss | Chaos test: kill process mid-session, verify resume |

---

## 5. Constraints

| ID | Constraint | Rationale |
|----|-----------|-----------|
| C-001 | TypeScript/Node/Express stack | Platform standard; all existing services use this stack |
| C-002 | Inngest as durable execution backbone | Already adopted (Spec 011 migration complete); provides retry, multi-tenant concurrency, event-driven triggers |
| C-003 | "Thick domain, thin orchestration" | Constitution principle — the profile engine and content intelligence are the moat, not the coordination layer. The orchestrator is infrastructure. |
| C-004 | Implementation in `joyus-ai` repository | Platform feature, not ops/deployment infrastructure |
| C-005 | Claude Agent SDK for agent loops | Powers individual agent sessions; creates a Python↔TypeScript boundary that requires a design decision (sidecar, subprocess, or wait for TypeScript SDK) |
| C-006 | tenantId never from request body | Multi-tenant security — tenant context derived from JWT/session, never from client-supplied payload |

---

## 6. User Scenarios & Testing

### Scenario 1: Single-Turn Agent Interaction

**Actor:** Platform user (via client application)
**Flow:**
1. User sends a message to the platform
2. Orchestrator creates or resumes a session for the user
3. Orchestrator loads applicable skills and tenant context
4. Agent processes the message, calls one tool, and streams a response
5. User receives the streamed response
6. Conversation turn is persisted

**Acceptance test:** End-to-end test from API message submission to streamed response with one tool call.

### Scenario 2: Multi-Turn Research Task

**Actor:** Platform user conducting multi-step research
**Flow:**
1. User asks the agent to research a topic
2. Agent calls multiple tools across several turns (search, retrieve documents, analyze)
3. Each turn's context builds on prior turns
4. After 10+ turns, the agent synthesizes findings and delivers a summary
5. User asks a follow-up question referencing earlier findings — agent retains context

**Acceptance test:** 15-turn conversation where turn 15 references information from turn 3; agent responds correctly.

### Scenario 3: Crash Recovery

**Actor:** System (automated recovery)
**Flow:**
1. User is mid-conversation (5 turns complete, agent processing turn 6)
2. Orchestrator process crashes
3. Orchestrator restarts
4. Session automatically resumes from the last checkpoint
5. User's pending message is reprocessed; response is delivered
6. User experiences a delay but no data loss

**Acceptance test:** Kill orchestrator process during tool call execution; verify session resumes and completes.

### Scenario 4: Multi-Tenant Isolation

**Actor:** Two users from different tenants
**Flow:**
1. User A (Tenant 1) creates a session and has a 5-turn conversation
2. User B (Tenant 2) creates a session simultaneously
3. Neither user can see the other's sessions, history, or events
4. Tenant 1 hits its concurrency limit; new sessions are queued
5. Tenant 2's sessions are unaffected by Tenant 1's queue

**Acceptance test:** Concurrent sessions across tenants; verify zero cross-tenant data leakage via API queries and event streams.

### Scenario 5: External System Driving Agent Work

**Actor:** External system (CI pipeline, webhook handler)
**Flow:**
1. External system creates a session via HTTP API with a task description
2. External system subscribes to the session's event stream via SSE
3. Agent processes the task, calling tools as needed
4. External system receives progress events in real time
5. Agent completes; external system receives the completion event with results

**Acceptance test:** Programmatic session creation, SSE subscription, and result retrieval via API — no UI required.

---

## 7. Key Entities

| Entity | Description | Scoping |
|--------|-------------|---------|
| **Session** | A conversation between a user/system and an agent, with full lifecycle (created → running → suspended → completed/failed) | Tenant + User |
| **Turn** | A single exchange within a session: user message + assistant response + tool results | Session |
| **Work Unit** | An individual piece of agent work with status, dependencies, assignee, labels, metadata | Session or Coordination Group |
| **Coordination Group** | A logical grouping of work units with dependency tracking and completion semantics | Tenant |
| **Event** | A typed, schema-registered record of a state change (session transition, tool result, error, usage) | Tenant |
| **Tool Registration** | A discovered tool with its schema, permissions, and routing information | Tenant |

---

## 8. Success Criteria

| Metric | Target | Verification |
|--------|--------|-------------|
| Orchestrator overhead | < 200ms per request (excludes model latency) | Instrumented request traces |
| Conversation continuity | Context maintained across 20+ turns in a session | Integration test |
| Crash recovery | Sessions resume within 30 seconds of orchestrator restart | Chaos test |
| Tenant isolation | Zero cross-tenant data leakage under concurrent load | Security test suite |
| Tool routing accuracy | 100% of tool_use calls reach the correct backend | Integration test |
| Skill application correctness | Correct skills loaded for tenant/role/task context | Unit + integration tests |
| API completeness | All session lifecycle operations available and documented via OpenAPI | API contract test |
| Durable execution | No data loss across 100 simulated crash-recovery cycles | Stress test |

---

## 9. Dependencies

| Dependency | Spec | Status | Blocking? |
|------------|------|--------|-----------|
| Session & Context Management | 002 | Implemented | No — can stub initially |
| Content Intelligence (profile engine) | 005 | Implemented | No — tool integration |
| Content Infrastructure | 006 | Implemented | No — tool integration |
| Automated Pipelines Framework | 009 | In progress | No — event patterns shared but independent |
| Cost Tracking | 011 | In progress (Inngest migration) | No — orchestrator emits events; 011 consumes |
| Skills System | 013 | Draft | Partial — skill loading is core; can stub with filesystem skills initially |
| MCP Gateway | 014 | Draft | Partial — tool routing goes through gateway; can route directly to MCP servers initially |
| Claude Agent SDK | External | Available | No — but Python↔TypeScript boundary needs design decision |
| Inngest | External | Adopted | No — already integrated |

---

## 10. Assumptions

| # | Assumption | Impact if wrong |
|---|-----------|----------------|
| A1 | Inngest's durable step execution model is sufficient for agent session checkpoint-resume (no need for Temporal-grade journaled replay) | Would need to adopt Temporal or build custom replay, adding significant infrastructure complexity |
| A2 | The Claude Agent SDK's Python↔TypeScript boundary can be managed via sidecar or subprocess without unacceptable latency | Would need to wait for a TypeScript Agent SDK or build a custom agent loop |
| A3 | Specs 013 (Skills) and 014 (Gateway) will progress enough to provide real implementations during orchestrator development; filesystem stubs are sufficient in the interim | Orchestrator development proceeds but integration testing is delayed |
| A4 | SSE is sufficient for the primary response stream (WebSocket not required for unidirectional token streaming) | Would need WebSocket transport, adding upgrade negotiation complexity |
| A5 | Single-process multi-tenant isolation (via tenant-scoped queries and concurrency controls) is sufficient; process-per-tenant isolation is not required | Would significantly increase infrastructure cost and operational complexity |

---

## 11. Open Questions

| # | Question | Impact | Resolution path |
|---|----------|--------|----------------|
| OQ-1 | Python↔TypeScript boundary for Claude Agent SDK: sidecar process, subprocess/CLI invocation per session, or wait for TypeScript SDK? | Affects deployment model, latency, and operational complexity | Design decision in WP01 spike |
| OQ-2 | Conversation memory strategy: sliding window, summarization, or RAG-based retrieval? | Affects context quality for long conversations | Evaluate in WP01 spike; instrument and compare |
| OQ-3 | Should tool call retries be transparent to the agent (orchestrator retries silently) or visible (agent sees failure and decides)? | Affects error recovery UX and agent behavior | Design decision during implementation |

---

## Adoption Plan

This feature introduces a new platform subsystem; rollout proceeds work-package by work-package behind feature flags:

- WP00 architecture spike merges first and gates downstream packages on its decision outputs.
- WP01–WP07 are merged sequentially; each package ships with feature-flagged routes that default off until the package's tests pass in staging.
- Existing MCP server traffic is unaffected — orchestrator endpoints are mounted under a separate route namespace and only enabled per-tenant via the runtime config.
- Cutover to orchestrator-backed sessions for production tenants is gated on: (a) all WP tests green for two consecutive weeks, (b) observability dashboards live (sessions/sec, p95 turn latency, durable-run failure rate), and (c) platform team sign-off recorded in the feature changelog.

## ROI Metrics

- **Session throughput**: sustained sessions/sec/tenant at target SLO (measured via orchestrator session metrics).
- **Durable-run recovery**: zero data-loss incidents from process crashes during agent turns in the first 30 days post-cutover.
- **Tool routing overhead**: p95 tool-dispatch latency below the budget defined in WP05.
- **Test suite stability**: orchestrator test suite runs in CI without flakes for two consecutive weeks before cutover.
- **Owner**: Platform Engineering.
- **Review cadence**: weekly during rollout, monthly thereafter.

## Security + MCP Governance

- **Tenant isolation**: every session is scoped by `tenantId`; queries and event subscriptions are filtered at the service layer (FR-006). Cross-tenant access is rejected at the route handler.
- **Secrets**: orchestrator does not introduce new long-lived secrets. Inngest signing keys and Anthropic API keys remain environment-variable-only and continue to be excluded from the repository via existing gitleaks rules.
- **MCP tool routing**: skill-loaded tools execute through the orchestrator's tool router, which enforces per-skill allowlists and records every tool call in the event stream for audit (FR-008, FR-009).
- **Safety integration**: agent loops invoke the safety service before each tool dispatch and after each model response (FR-011). Safety rejections are surfaced as durable events for review.
- **Approval gates**: enabling the orchestrator for a production tenant requires platform team lead sign-off recorded in the feature changelog.
- **Audit trail**: every session run, coordination event, and tool call is recorded in the events schema and retained per the platform retention policy.

---

*Spec created: May 12, 2026*
*Supersedes: March 2026 draft (joyus-ai/kitty-specs/012-platform-core-orchestrator/)*
*Tool evaluation: planning/agent-orchestration-evaluation-2026-05.md*
*For: Joyus AI Platform — Core Orchestrator*
