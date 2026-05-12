---
work_package_id: WP00
title: 'Architecture Spike: Mastra + SDK Boundary'
dependencies: []
requirement_refs:
- FR-001
- FR-002
- FR-003
- FR-004
- FR-005
- FR-006
- FR-007
planning_base_branch: claude/platform-core-orchestrator
merge_target_branch: claude/platform-core-orchestrator
branch_strategy: Planning artifacts for this feature were generated on claude/platform-core-orchestrator. During /spec-kitty.implement this WP may branch from a dependency-specific base, but completed changes must merge back into claude/platform-core-orchestrator unless the human explicitly redirects the landing branch.
base_branch: kitty/mission-platform-core-orchestrator-01KREQVK
base_commit: 1fae1edb5e24411a14af3c7808445c4ce05c3484
created_at: '2026-05-12T19:48:51.834862+00:00'
subtasks:
- T001
- T002
- T003
- T004
- T005
- T006
- T007
- T008
shell_pid: "78596"
agent: "claude:opus:orchestrator:implementer"
history:
- date: '2026-05-12'
  action: created
  agent: planner
authoritative_surface: joyus-ai-mcp-server/spike/orchestrator/
execution_mode: code_change
owned_files:
- joyus-ai-mcp-server/spike/orchestrator/**
- kitty-specs/platform-core-orchestrator-01KREQVK/research/architecture-decision.md
tags: []
---

# WP00: Architecture Spike — Mastra + SDK Boundary

## Objective

Evaluate whether Mastra can serve as the agent semantics layer and determine the optimal Python↔TypeScript boundary for the Claude Agent SDK. This spike gates all subsequent implementation — its output determines whether WP01-WP07 build on Mastra or a custom TypeScript layer.

**Duration:** 2 days maximum. If any experiment is inconclusive after 2 days, record "inconclusive" and move on.

## Context

- **Spec decision gate:** 4 pass/fail questions (Q1-Q4) defined in spec.md §2
- **Evaluation doc:** `planning/agent-orchestration-evaluation-2026-05.md` — contains full tool analysis and thresholds
- **Existing Inngest:** `joyus-ai-mcp-server/src/inngest/` — client, adapter, registry already exist
- **Existing MCP tools:** `joyus-ai-mcp-server/src/tools/executors/` — tool implementations to test against

## Subtasks

### T001: Set Up Spike Directory

**Purpose:** Create isolated spike environment that doesn't pollute the main codebase.

**Steps:**
1. Create `joyus-ai-mcp-server/spike/orchestrator/` directory
2. Add `package.json` with Mastra, Inngest SDK, and Vitest dependencies
3. Add `tsconfig.json` extending the parent config
4. Add `.gitignore` for node_modules
5. Verify `pnpm install` succeeds

**Files:** `spike/orchestrator/package.json`, `spike/orchestrator/tsconfig.json`
**Validation:** `pnpm install` completes, TypeScript compiles

### T002: Test Mastra + Inngest Composition (Q1)

**Purpose:** Determine if a Mastra agent can run inside an Inngest `step.run()` call.

**Steps:**
1. Create a minimal Mastra agent with one tool (a simple echo tool)
2. Create an Inngest function that invokes the agent inside `step.run()`
3. Test single-shot: agent receives prompt, calls tool, returns result
4. Verify the Inngest function completes successfully with the agent's output

**PASS criteria:** Agent invoked as durable step with checkpoint-resume across retries.
**FAIL criteria:** Requires workarounds that bypass Inngest step isolation (e.g., manual state serialization).

**Files:** `spike/orchestrator/mastra-inngest.test.ts`

### T003: Test Multi-Step Agent Loop Across Inngest Boundaries (Q1 Deep)

**Purpose:** Test the hard case — an agent that calls multiple tools in sequence, with each tool call as a separate Inngest step.

**Steps:**
1. Create a Mastra agent with 2 tools (search + summarize)
2. Create an Inngest function where each tool call is a separate `step.run()`
3. Agent calls search → gets result → calls summarize → returns final answer
4. Simulate a crash after the first tool call; verify Inngest replays correctly
5. Verify the agent's conversation state (tool results from step 1) is available in step 2

**PASS criteria:** Agent maintains conversation state across Inngest step boundaries; replay after crash skips completed steps.
**FAIL criteria:** Conversation state is lost between steps; agent re-executes completed tool calls.

**Files:** `spike/orchestrator/multi-step-inngest.test.ts`

### T004: Test Mastra MCP Client (Q2)

**Purpose:** Verify Mastra's MCP client connects to the existing MCP server tools without patching.

**Steps:**
1. Start the MCP server locally (or mock it)
2. Configure a Mastra agent with MCP client pointing to the local server
3. Agent calls an existing MCP tool (pick the simplest one available)
4. Verify the tool call succeeds and returns the expected result

**PASS criteria:** Connects without forking or patching Mastra internals.
**FAIL criteria:** Requires monkey-patching transport or custom protocol adapter.

**Files:** `spike/orchestrator/mcp-client.test.ts`

### T005: Test Tenant Isolation (Q3)

**Purpose:** Verify tenantId can be injected into Mastra agent/tool context without global state pollution.

**Steps:**
1. Create two agent instances with different tenantId values in their context
2. Run both agents concurrently (same process)
3. Each agent calls a tool that reads tenantId from its context
4. Verify agent A's tool sees tenant A's ID, agent B's tool sees tenant B's ID
5. Verify no global state leaks between agents (check for shared singletons)

**PASS criteria:** tenantId injectable via agent/tool context at construction time; no global state pollution between tenants within a single process.
**FAIL criteria:** Tenant isolation requires process-per-tenant or framework modification.

**Files:** `spike/orchestrator/tenant-isolation.test.ts`

### T006: Measure Token Overhead (Q4)

**Purpose:** Quantify how much extra token usage Mastra adds compared to raw Claude API calls.

**Steps:**
1. Implement the same task twice: once with Mastra agent, once with raw Anthropic SDK
2. Task: "Given this text, extract the key entities" (simple tool-use task)
3. Run each 5 times, collect token counts (input + output) from API responses
4. Calculate: `overhead = (mastra_tokens - raw_tokens) / raw_tokens * 100`
5. Check if Mastra injects extra system prompt content that inflates input tokens

**PASS criteria:** ≤15% token overhead vs raw Claude API calls.
**FAIL criteria:** >25% overhead OR unpredictable overhead varying with conversation length.

**Files:** `spike/orchestrator/token-overhead.test.ts`

### T007: Evaluate Python↔TypeScript SDK Boundary (OQ-1)

**Purpose:** Determine the best way to invoke the Claude Agent SDK from TypeScript.

**Steps:**
1. **Subprocess test:** Spawn `python -c "from anthropic_agent import ..."` from Node.js, measure startup time over 10 invocations
2. **Sidecar test:** Start a long-running Python HTTP server wrapping the SDK, measure request latency over 10 calls
3. **Custom loop baseline:** Implement a minimal agent loop in TypeScript using raw `@anthropic-ai/sdk`, measure equivalent operations
4. Compare: startup latency, per-request latency, memory usage, operational complexity
5. Recommendation: which approach for WP02?

**Decision matrix:**
- If subprocess startup <500ms: use subprocess (simplest)
- If subprocess >500ms but sidecar <100ms per request: use sidecar
- If both unacceptable: build custom TypeScript agent loop

**Files:** `spike/orchestrator/sdk-boundary.test.ts`

### T008: Write Architecture Decision Document

**Purpose:** Record spike results and make the binding decision for WP01-WP07.

**Steps:**
1. Compile Q1-Q4 pass/fail results
2. Record OQ-1 (SDK boundary) recommendation with latency numbers
3. Apply decision rule from spec: adopt Mastra if Q1-Q3 all pass; build custom if any fail
4. Document any surprises or risks discovered during the spike
5. Save to `kitty-specs/platform-core-orchestrator-01KREQVK/research/architecture-decision.md`

**Files:** `research/architecture-decision.md`
**Validation:** Document clearly states "Adopt Mastra" or "Build custom" with evidence.

## Definition of Done

- [ ] All 4 decision gate questions (Q1-Q4) have pass/fail results with evidence
- [ ] Python↔TypeScript boundary has a recommendation with latency numbers
- [ ] Architecture decision document written with binding recommendation
- [ ] Spike code is self-contained in `spike/orchestrator/` — no pollution of main codebase
- [ ] No spike code depends on uncommitted changes to the main codebase

## Risks

| Risk | Mitigation |
|------|-----------|
| Mastra API changes between spike and implementation | Pin exact Mastra version in spike; note API surface in decision doc |
| Inngest dev server not available locally | Use Inngest's in-memory mode for testing |
| Claude API rate limits during overhead measurement | Run measurements sequentially with delays; 5 samples is sufficient |

## Reviewer Guidance

- **Primary check:** Are the pass/fail thresholds from the spec applied correctly? Don't accept "partial pass."
- **Latency numbers:** Are they measured, not estimated? Reject hand-waved performance claims.
- **Decision document:** Does it clearly state "Adopt Mastra" or "Build custom"? Reject ambiguous conclusions.

## Activity Log

- 2026-05-12T19:48:52Z – claude:opus:orchestrator:implementer – shell_pid=29545 – Assigned agent via action command
- 2026-05-12T20:08:35Z – claude:opus:orchestrator:implementer – shell_pid=29545 – Ready for review: spike complete with architecture decision
- 2026-05-12T20:10:00Z – claude:opus:orchestrator:reviewer – shell_pid=57850 – Started review via action command
- 2026-05-12T20:13:13Z – claude:opus:orchestrator:reviewer – shell_pid=57850 – Moved to planned
- 2026-05-12T20:13:50Z – claude:opus:orchestrator:implementer – shell_pid=78596 – Started implementation via action command
- 2026-05-12T20:24:21Z – claude:opus:orchestrator:implementer – shell_pid=78596 – Cycle 2: addressed all 4 review issues — Q2 resolved via @mastra/mcp upgrade to 1.7.0, OQ-1 Option A measured (p50~27ms), Q4/Q1-checkpoint honestly documented as INCONCLUSIVE
