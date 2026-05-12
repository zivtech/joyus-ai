---
work_package_id: WP05
title: Tool Routing & Skill Application
dependencies:
- WP02
requirement_refs:
- FR-008
- FR-009
planning_base_branch: claude/platform-core-orchestrator
merge_target_branch: claude/platform-core-orchestrator
branch_strategy: Planning artifacts for this feature were generated on claude/platform-core-orchestrator. During /spec-kitty.implement this WP may branch from a dependency-specific base, but completed changes must merge back into claude/platform-core-orchestrator unless the human explicitly redirects the landing branch.
subtasks:
- T034
- T035
- T036
- T037
- T038
- T039
- T040
agent: "claude:opus:orchestrator:reviewer"
shell_pid: "86829"
history:
- date: '2026-05-12'
  action: created
  agent: planner
authoritative_surface: joyus-ai-mcp-server/src/orchestrator/
execution_mode: code_change
owned_files:
- joyus-ai-mcp-server/src/orchestrator/tool-router.service.ts
- joyus-ai-mcp-server/src/orchestrator/skill-loader.service.ts
tags: []
---

# WP05: Tool Routing & Skill Application

## Objective

Replace the stub tool router from WP02 with real tool discovery, routing, and permission filtering. Add skill loading and injection into the system prompt. After this WP, agents see only the tools their tenant is authorized for, tool calls reach the correct backend, and skills are loaded and injected into the prompt with token budget awareness.

## Context

- **WP02 provides:** Agent loop with stub tool router interface
- **Existing tools:** `src/tools/executors/` — existing MCP tool implementations
- **Spec 013 (Skills):** Draft — use filesystem-based skill loading as stub
- **Spec 014 (Gateway):** Draft — route directly to MCP servers initially
- **Research decision:** Tool call retries: transient failures retried silently; semantic failures passed to agent

## Subtasks

### T034: Implement Tool Router Service

**Purpose:** Discover available tools and present them to the agent.

**Steps:**
1. Create `src/orchestrator/tool-router.service.ts`
2. Implement `discoverTools(tenantId)` → ToolRegistration[]:
   - **Phase 1 (now):** Query existing MCP server tools directly from `src/tools/` registry
   - **Phase 2 (when Spec 014 is ready):** Query the MCP Gateway for tenant-scoped tools
   - Return tool definitions in Claude's tool format: `{ name, description, input_schema }`
3. Register discovered tools in the tool_registrations table (from data-model.md):
   - Cache tool definitions per tenant
   - Refresh on a configurable interval (5 minutes default)
4. If the tool_registrations table doesn't exist yet, fall back to in-memory registry

**Files:** `src/orchestrator/tool-router.service.ts` (new, ~80 lines)

### T035: Implement Tool Dispatch

**Purpose:** Route tool_use calls from the agent to the correct backend.

**Steps:**
1. Implement `dispatchToolCall(tenantId, toolName, toolInput)` → ToolResult:
   - Look up tool in the registry by name (tenant-scoped)
   - If tool not found: return `{ error: "Tool not available" }`
   - Route to the correct executor:
     - MCP tools: call via MCP protocol (existing `src/tools/executors/` infrastructure)
     - Platform tools: call directly (content infrastructure, profile engine)
   - Marshal the result into the format Claude expects: `{ type: "tool_result", tool_use_id, content }`
2. Apply per-tool timeout (configurable, default 30 seconds)
3. If tool call exceeds timeout: return structured error to the agent
4. Emit events via event service: `tool.called` on dispatch, `tool.completed` or `tool.failed` on result

**Files:** `src/orchestrator/tool-router.service.ts` (extend, ~60 lines)

### T036: Implement Tool Permission Filtering

**Purpose:** Agents only see tools their tenant is authorized to use.

**Steps:**
1. Implement `getAuthorizedTools(tenantId)` → ToolRegistration[]:
   - Filter tool registry by tenant permissions
   - For now: all tools are authorized for all tenants (no permission model yet)
   - Design the interface so permission filtering can be added without changing callers
2. Wire into agent loop: the tools array passed to Claude uses `getAuthorizedTools()`, not raw discovery
3. When permission model is added (future): filter based on tenant configuration

**Files:** `src/orchestrator/tool-router.service.ts` (extend, ~20 lines)

### T037: Implement Tool Failure Handling

**Purpose:** Handle transient and semantic tool failures differently.

**Steps:**
1. **Transient failures** (network timeout, 503, rate limit):
   - Retry silently up to 3 times with exponential backoff (200ms, 800ms, 3200ms)
   - Agent sees the final result after all retries exhausted
   - Log each retry attempt
2. **Semantic failures** (tool returns an error result, invalid input):
   - Pass to agent immediately — the agent needs to adapt
   - No retry — the same input will produce the same error
3. **Circuit breaker:**
   - Track consecutive failures per tool per tenant
   - After 5 consecutive failures: temporarily disable the tool (5-minute cooldown)
   - On disable: remove from authorized tools list, emit `tool.circuit_breaker.opened` event
   - On cooldown expiry: re-enable, emit `tool.circuit_breaker.closed` event
   - In-memory tracking only (reset on process restart is acceptable)

**Classify failures:**
- HTTP 408/429/500/502/503/504 → transient
- HTTP 400/401/403/404/422 → semantic
- Network error / timeout → transient
- Tool returns `{ error: ... }` in response body → semantic

**Files:** `src/orchestrator/tool-router.service.ts` (extend, ~60 lines)

### T038: Implement Skill Loader Service

**Purpose:** Load skills from the Skills System (or filesystem stub).

**Steps:**
1. Create `src/orchestrator/skill-loader.service.ts`
2. Implement `loadSkills(tenantId, userId, taskContext?)` → Skill[]:
   - **Stub implementation** (until Spec 013 is ready):
     - Look for skill files in `skills/{tenantId}/` directory
     - Each `.md` file is a skill with the file name as the skill name
     - Parse YAML frontmatter for metadata (priority, scope)
   - **Interface for Spec 013** (for future swap):
     - `SkillResolver.resolve(tenantId, userId, taskContext) → Skill[]`
3. Return skills in priority order: tenant-level → role-level → task-level
4. Each skill has: `{ name, content, priority, scope }`

**Files:** `src/orchestrator/skill-loader.service.ts` (new, ~60 lines)

### T039: Implement Skill Injection with Token Budget

**Purpose:** Compose loaded skills into the system prompt without exceeding the context window.

**Steps:**
1. Implement `injectSkills(skills: Skill[], tokenBudget: number)` → string:
   - Sort skills by priority (highest first)
   - Accumulate skill content until token budget is reached
   - If a skill would exceed the budget: skip it entirely (don't truncate mid-skill)
   - Log which skills were included and which were excluded
2. Token budget calculation:
   - Total context window: 200K tokens (Claude 3.5)
   - Reserved for conversation history: calculated from memory service
   - Reserved for user message + response: 8K tokens
   - Skill budget = total - history - reserved
3. Wire into agent loop: `assembleSystemPrompt()` calls `injectSkills()` with the remaining budget

**Files:** `src/orchestrator/skill-loader.service.ts` (extend, ~40 lines)

### T040: Implement Constitution Injection

**Purpose:** Load the platform Constitution and prepend it to every system prompt.

**Steps:**
1. Load Constitution from `constitution.md` file (or database if configured)
2. Constitution content goes FIRST in the system prompt, before skills
3. Constitution is NOT subject to token budget — it always fits (typically <2K tokens)
4. If Constitution file is missing: log a warning but don't fail (degrade gracefully)

**Files:** `src/orchestrator/skill-loader.service.ts` (extend, ~20 lines)

## Definition of Done

- [ ] Agent sees only tools authorized for the current tenant
- [ ] Tool_use calls reach the correct backend and results are marshaled back
- [ ] Transient tool failures are retried silently (up to 3 times)
- [ ] Semantic tool failures are passed to the agent immediately
- [ ] Circuit breaker disables tools after 5 consecutive failures
- [ ] Skills are loaded and injected into the system prompt in priority order
- [ ] Token budget prevents skill injection from exceeding context window
- [ ] Constitution is always included first in the system prompt

## Risks

| Risk | Mitigation |
|------|-----------|
| Spec 013 interface changes when it ships | Skill loader uses an interface; swap implementation without changing callers |
| Filesystem skill stub is too simplistic | Sufficient for development; real integration is a service swap |
| Circuit breaker state lost on restart | Acceptable for v1; tools re-enabled on restart is conservative and safe |

## Reviewer Guidance

- **Retry classification:** Verify HTTP status codes are correctly classified as transient vs semantic.
- **Token budget math:** Verify the budget calculation doesn't allow overflow. Check edge case: zero remaining budget.
- **Skill priority:** Verify higher-priority skills are kept when budget is tight, not lower-priority ones.
- **Constitution always present:** Verify Constitution injection cannot be bypassed even if skill loading fails.

## Activity Log

- 2026-05-12T21:41:31Z – claude:opus:orchestrator:implementer – shell_pid=22415 – Started implementation via action command
- 2026-05-12T21:52:13Z – claude:opus:orchestrator:implementer – shell_pid=22415 – Tool routing, skill loading, Constitution injection — 44 tests
- 2026-05-12T21:52:15Z – claude:opus:orchestrator:reviewer – shell_pid=86829 – Started review via action command
