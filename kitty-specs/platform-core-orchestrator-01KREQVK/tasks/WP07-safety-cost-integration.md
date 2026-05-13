---
work_package_id: WP07
title: Safety & Cost Integration
dependencies:
- WP02
requirement_refs:
- FR-011
- FR-012
planning_base_branch: claude/platform-core-orchestrator
merge_target_branch: claude/platform-core-orchestrator
branch_strategy: Planning artifacts for this feature were generated on claude/platform-core-orchestrator. During /spec-kitty.implement this WP may branch from a dependency-specific base, but completed changes must merge back into claude/platform-core-orchestrator unless the human explicitly redirects the landing branch.
subtasks:
- T048
- T049
- T050
- T051
- T052
agent: "claude:opus:orchestrator:reviewer"
shell_pid: "33318"
history:
- date: '2026-05-12'
  action: created
  agent: planner
authoritative_surface: joyus-ai-mcp-server/src/orchestrator/
execution_mode: code_change
owned_files:
- joyus-ai-mcp-server/src/orchestrator/safety.service.ts
- joyus-ai-mcp-server/src/orchestrator/usage.service.ts
tags: []
---

# WP07: Safety & Cost Integration

## Objective

Add pre/post-generation safety hooks and token usage tracking to the agent loop. After this WP, the orchestrator provides hook points for Spec 014's safety system, emits token usage events for Spec 011's cost tracking, and detects idle sessions consuming resources.

## Context

- **WP02 provides:** Agent loop service where hooks are injected
- **FR-011 (Safety):** Orchestrator provides hook points; Spec 014 owns implementations
- **FR-012 (Cost):** Orchestrator emits usage data; Spec 011 owns aggregation
- **Research decision:** Hybrid retry — transient errors retried silently, semantic errors passed to agent (already in WP05)

## Subtasks

### T048: Implement Safety Hook Interface

**Purpose:** Define the hook interface that Spec 014 will implement.

**Steps:**
1. Create `src/orchestrator/safety.service.ts`
2. Define hook interfaces:
   ```typescript
   interface PreGenerationHook {
     execute(context: {
       tenantId: string;
       sessionId: string;
       systemPrompt: string;
       messages: Message[];
     }): Promise<{ action: 'allow' | 'modify' | 'block'; modifiedPrompt?: string; reason?: string }>;
   }

   interface PostGenerationHook {
     execute(context: {
       tenantId: string;
       sessionId: string;
       response: string;
       toolCalls?: ToolCall[];
     }): Promise<{ action: 'allow' | 'modify' | 'block'; modifiedResponse?: string; reason?: string }>;
   }
   ```
3. Implement `SafetyService`:
   - `registerPreHook(hook: PreGenerationHook)` — register a pre-generation hook
   - `registerPostHook(hook: PostGenerationHook)` — register a post-generation hook
   - `runPreHooks(context)` — run all pre-generation hooks in order; stop on first "block"
   - `runPostHooks(context)` — run all post-generation hooks in order; stop on first "block"
4. Wire into agent loop (WP02):
   - Before Claude invocation: `runPreHooks()`. If blocked, return block reason to user.
   - After Claude response: `runPostHooks()`. If blocked, suppress response and return block reason.
   - If modified: use the modified prompt/response instead of the original.
5. **Stub implementation:** Register a no-op hook that always returns "allow". Real hooks come from Spec 014.

**Files:** `src/orchestrator/safety.service.ts` (new, ~80 lines)

### T049: Implement Hook Audit Logging

**Purpose:** Record every safety hook invocation and its outcome for compliance review.

**Steps:**
1. After each hook execution, emit a typed event via the event service:
   - `safety.pre_hook.executed` — `{ sessionId, tenantId, hookName, action, reason? }`
   - `safety.post_hook.executed` — `{ sessionId, tenantId, hookName, action, reason? }`
2. Register these event types in the event registry (WP03)
3. For "block" and "modify" actions: include the reason in the event payload
4. For "allow" actions: emit event but with minimal payload (don't log the full prompt/response — that's in the turns table)
5. These audit events are always emitted, even for the no-op stub hook

**Files:** `src/orchestrator/safety.service.ts` (extend, ~30 lines)

### T050: Implement Token Accounting Events

**Purpose:** Emit usage data on every model invocation.

**Steps:**
1. Create `src/orchestrator/usage.service.ts`
2. After each Claude API call in the agent loop, extract usage data from the API response:
   - `inputTokens`, `outputTokens`, `cacheCreationInputTokens`, `cacheReadInputTokens`
3. Emit typed event: `usage.model_invocation`:
   ```typescript
   {
     sessionId, tenantId,
     inputTokens, outputTokens,
     cacheHits: cacheReadInputTokens,
     cacheCreations: cacheCreationInputTokens,
     model: "claude-sonnet-4-20250514",
     turnSequence: number
   }
   ```
4. Register event type in event registry
5. Wire into agent loop: after each `client.messages.create()` call, emit usage event

**Files:** `src/orchestrator/usage.service.ts` (new, ~40 lines)

### T051: Implement Per-Session Cost Accumulation

**Purpose:** Track cumulative token usage per session, queryable via API.

**Steps:**
1. Add to usage service:
   - `getSessionUsage(tenantId, sessionId)` → `{ totalInputTokens, totalOutputTokens, totalCacheHits, estimatedCost }`
2. Implementation options:
   - **Option A (simple):** Query the events table: `SELECT SUM(payload->>'inputTokens') FROM events WHERE sessionId = ? AND type = 'usage.model_invocation'`
   - **Option B (materialized):** Add `tokenUsageSummary` JSONB column to sessions table, update on each invocation
3. Start with Option A (no schema changes needed). Switch to Option B if query performance becomes an issue.
4. Estimated cost calculation: use approximate pricing per model (hardcoded constants, updated manually)
5. Expose via session GET endpoint (add `usage` field to session response)

**Files:** `src/orchestrator/usage.service.ts` (extend, ~30 lines)

### T052: Implement Idle Gap Detection

**Purpose:** Flag sessions consuming tokens without user interaction.

**Steps:**
1. After each model invocation, check:
   - Time since last user message in this session
   - If >5 minutes (configurable) and the session has consumed tokens: this is an idle gap
2. Emit typed event: `usage.idle_gap_detected`:
   ```typescript
   {
     sessionId, tenantId,
     idleMinutes: number,
     tokensSinceLastInteraction: number
   }
   ```
3. This is a flag only — no automatic action. The cost tracking system (Spec 011) decides what to do.
4. Common causes: runaway tool call loops, stuck agent, agent processing a very long task
5. Register event type in event registry

**Files:** `src/orchestrator/usage.service.ts` (extend, ~25 lines)

## Definition of Done

- [ ] Pre-generation hooks can block or modify the prompt before Claude invocation
- [ ] Post-generation hooks can block or modify the response before delivery to user
- [ ] All hook invocations are logged as typed events with outcomes
- [ ] Every model invocation emits a usage event with token counts
- [ ] Per-session cumulative usage is queryable
- [ ] Idle sessions are flagged when consuming tokens without user interaction
- [ ] Stub hooks (no-op) are registered by default

## Risks

| Risk | Mitigation |
|------|-----------|
| Hook execution adds latency to every request | Hooks should be fast (<10ms). Log slow hooks. No-op stub adds ~0ms. |
| Token usage from API response format changes | Extract using the standard Anthropic SDK response type; adapts to format changes |

## Reviewer Guidance

- **Hook ordering:** Verify pre-hooks run BEFORE model invocation and post-hooks run AFTER. A block in pre-hook must prevent the API call entirely.
- **Audit completeness:** Every hook execution must produce an audit event. No silent execution.
- **Cost calculation:** Verify pricing constants are clearly marked as approximate and easy to update.
- **Idle detection threshold:** 5 minutes is the default but should be configurable. Check that it is.

## Activity Log

- 2026-05-13T00:23:22Z – claude:opus:orchestrator:implementer – shell_pid=55736 – Started implementation via action command
- 2026-05-13T12:57:23Z – claude:opus:orchestrator:implementer – shell_pid=55736 – Safety hooks, usage tracking, idle detection — FINAL WP
- 2026-05-13T12:57:27Z – claude:opus:orchestrator:reviewer – shell_pid=33318 – Started review via action command
