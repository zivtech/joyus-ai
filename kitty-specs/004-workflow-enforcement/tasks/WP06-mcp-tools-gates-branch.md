---
work_package_id: WP06
title: MCP Tools -- Gates, Branch & Status
lane: "done"
dependencies:
- WP03
- WP05
base_branch: 004-workflow-enforcement-WP06-merge-base
base_commit: 0a0a7874eacaee8259976cf86da33da562576c37
created_at: '2026-02-18T18:00:15.827864+00:00'
subtasks:
- T033
- T034
- T035
- T036
- T037
phase: Phase 3 - MCP Tools & Events
assignee: ''
agent: "claude-opus"
shell_pid: "57078"
review_status: "approved"
reviewed_by: "Alex Urevick-Ackelsberg"
history:
- timestamp: '2026-02-17T15:00:00Z'
  lane: planned
  agent: system
  shell_pid: ''
  action: Prompt generated via /spec-kitty.tasks
---

# Work Package Prompt: WP06 -- MCP Tools -- Gates, Branch & Status

## IMPORTANT: Review Feedback Status

- **Has review feedback?**: Check `review_status` above.
- **Mark as acknowledged**: Update `review_status: acknowledged` when addressing feedback.

---

## Review Feedback

*[This section is empty initially.]*

---

## Objectives & Success Criteria

- Expose gate execution, branch verification, hygiene checks, enforcement status, and kill switch as MCP tools
- Each tool validates input, calls the underlying engine, formats the response per contract, and creates audit entries
- **Done when**: All 5 MCP tools register on the server, accept valid input, return correctly shaped responses, and create audit entries

## Context & Constraints

- **Contracts**: `kitty-specs/004-workflow-enforcement/contracts/mcp-tools.md` (authoritative for input/output schemas)
- **MCP SDK**: `@modelcontextprotocol/sdk` -- use `server.tool()` registration pattern from 002
- **002 Reference**: `kitty-specs/002-session-context-management/tasks/WP06-mcp-server-core-tools.md` for tool registration patterns
- **Engines**: Gate runner (WP03), git guardrails (WP05), kill switch (WP01), config (WP01)

**Implementation command**: `spec-kitty implement WP06 --base WP05`

## Subtasks & Detailed Guidance

### Subtask T033 -- Implement `run_gates` MCP tool

- **Purpose**: MCP tool Claude calls to execute quality gates before push/commit.
- **Steps**:
  1. Create `joyus-ai-state/src/mcp/tools/run-gates.ts`
  2. Register tool with MCP server:
     ```typescript
     server.tool('run_gates', RunGatesInputSchema, async (params) => { ... })
     ```
  3. Input: `{ trigger: 'pre-commit' | 'pre-push', dryRun?: boolean }`
  4. Logic:
     - Load merged enforcement config
     - Check kill switch -- if disabled, return early with `overallResult: 'disabled'`
     - If `dryRun`: list gates that would run without executing
     - Otherwise: call `runGates()` from gate engine (WP03)
     - Format response per `contracts/mcp-tools.md` run_gates output schema
  5. Return gate results, overall result, failed gate ID, audit entry IDs
- **Files**: `joyus-ai-state/src/mcp/tools/run-gates.ts` (new, ~60 lines)
- **Parallel?**: Yes

### Subtask T034 -- Implement `verify_branch` MCP tool

- **Purpose**: MCP tool Claude calls before commits to check branch correctness.
- **Steps**:
  1. Create `joyus-ai-state/src/mcp/tools/verify-branch.ts`
  2. Register with MCP server
  3. Input: `{ operation: 'commit' | 'push' | 'merge' }`
  4. Logic:
     - Get current branch via `getCurrentBranch()`
     - Get expected branch from 002's state snapshot (task context)
     - Call `verifyBranch()` from git engine
     - Also call `checkBranchNaming()` if naming convention configured
     - Create audit entry
     - Format response per contract
  5. Return: currentBranch, expectedBranch, match, enforcement level, naming validity
- **Files**: `joyus-ai-state/src/mcp/tools/verify-branch.ts` (new, ~50 lines)
- **Parallel?**: Yes

### Subtask T035 -- Implement `check_hygiene` MCP tool

- **Purpose**: MCP tool for branch hygiene checks (stale branches, branch count).
- **Steps**:
  1. Create `joyus-ai-state/src/mcp/tools/check-hygiene.ts`
  2. Register with MCP server
  3. Input: (none required)
  4. Logic:
     - Load branch rules from config
     - Call `detectStaleBranches()` and `checkBranchCount()`
     - Format response per contract
  5. Return: stale branches list, active count, limit, over-limit flag
- **Files**: `joyus-ai-state/src/mcp/tools/check-hygiene.ts` (new, ~40 lines)
- **Parallel?**: Yes

### Subtask T036 -- Implement `enforcement_status` MCP tool

- **Purpose**: MCP tool that returns current enforcement state for Claude to report to user.
- **Steps**:
  1. Create `joyus-ai-state/src/mcp/tools/enforcement-status.ts`
  2. Register with MCP server
  3. Input: (none required)
  4. Logic:
     - Check kill switch state
     - Load merged config: count gates, skill mappings, check branch rules
     - Check companion service status (PID file exists?)
     - Check audit storage usage
     - Aggregate into status response
  5. Return: enforcementActive, userTier, gate count, skill count, storage usage, companion status
- **Files**: `joyus-ai-state/src/mcp/tools/enforcement-status.ts` (new, ~50 lines)
- **Parallel?**: Yes

### Subtask T037 -- Implement `kill_switch` MCP tool

- **Purpose**: MCP tool Claude calls to enable/disable enforcement for the session.
- **Steps**:
  1. Create `joyus-ai-state/src/mcp/tools/kill-switch.ts`
  2. Register with MCP server
  3. Input: `{ action: 'disable' | 'enable', reason?: string }`
  4. Logic:
     - Call `disableEnforcement(reason)` or `enableEnforcement()` from kill switch module
     - Create audit entry with `actionType: 'kill-switch-on'` or `'kill-switch-off'`
     - Audit logging ALWAYS works even when enforcement is disabled
     - Return new enforcement state
  5. Return: enforcementActive, auditEntryId, message
- **Files**: `joyus-ai-state/src/mcp/tools/kill-switch.ts` (new, ~40 lines)
- **Parallel?**: Yes

## Risks & Mitigations

- **MCP SDK version**: pin to same version as 002 to avoid compatibility issues
- **Tool registration ordering**: ensure enforcement tools don't conflict with 002's existing tools (use unique tool names)

## Review Guidance

- Verify each tool validates input with Zod before processing
- Verify output matches the contract schemas exactly
- Verify kill switch tool creates audit entries even when enforcement is disabled
- Verify dry run mode doesn't execute gate commands
- Verify tools handle missing config gracefully (return defaults, not errors)

## Activity Log

- 2026-02-17T15:00:00Z -- system -- lane=planned -- Prompt created.
- 2026-02-18T18:13:12Z – unknown – shell_pid=36767 – lane=for_review – Ready for review: 5 MCP tools (run_gates, verify_branch, check_hygiene, enforcement_status, kill_switch) with 24 passing tests
- 2026-02-18T18:15:40Z – claude-opus – shell_pid=57078 – lane=doing – Started review via workflow command
- 2026-02-18T18:17:44Z – claude-opus – shell_pid=57078 – lane=done – Review passed: All 5 MCP tools match contracts, Zod validation on all inputs, audit entries created correctly, kill switch audit works unconditionally, dry-run mode verified, graceful config fallback confirmed. 24 tests passing.
