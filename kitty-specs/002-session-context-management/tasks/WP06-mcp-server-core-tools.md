---
work_package_id: WP06
title: MCP Server + Core Tools
lane: "doing"
dependencies:
- WP01
base_branch: 002-session-context-management-WP05
base_commit: 8ee9a39e3adb6c27899eda52dc3cdab59581c89e
created_at: '2026-02-18T23:05:17.059480+00:00'
subtasks:
- T020
- T021
- T022
- T023
- T024
phase: Phase 2 - Primary Interface
assignee: ''
agent: ''
shell_pid: "15858"
review_status: ''
reviewed_by: ''
history:
- timestamp: '2026-02-17T03:14:10Z'
  lane: planned
  agent: system
  shell_pid: ''
  action: Prompt generated via /spec-kitty.tasks (MCP-first architecture)
---

# Work Package Prompt: WP06 -- MCP Server + Core Tools

## IMPORTANT: Review Feedback Status

**Read this first if you are implementing this task!**

- **Has review feedback?**: Check the `review_status` field above. If it says `has_feedback`, scroll to the **Review Feedback** section immediately.
- **You must address all feedback** before your work is complete.
- **Mark as acknowledged**: When you understand the feedback and begin addressing it, update `review_status: acknowledged` in the frontmatter.

---

## Review Feedback

> **Populated by `/spec-kitty.review`**

*[This section is empty initially.]*

---

## Markdown Formatting
Wrap HTML/XML tags in backticks: `` `<div>` ``, `` `<script>` ``
Use language identifiers in code blocks: ````python`, ````bash`

---

## Objectives & Success Criteria

- Build the MCP server — the **primary interface** that Claude calls on behalf of users
- Implement three core tools: `get_context`, `save_state`, `verify_action`
- Server runs via stdio transport for Claude Desktop/Code integration
- **Done when**: MCP server starts cleanly, all three tools respond correctly, can be added to Claude Desktop config and called by Claude

## Context & Constraints

- **Architecture**: MCP server is the PRIMARY interface. Users never interact with joyus-ai directly. Claude calls these tools.
- **Contracts**: `contracts/state-api.md` — tool signatures, inputs, outputs (authoritative)
- **Plan**: `plan.md` — MCP Tools table, Architecture section
- **Quickstart**: `quickstart.md` — user-facing flow to validate against
- **SDK**: `@modelcontextprotocol/sdk` — Server, StdioServerTransport, tool registration
- **Performance**: `get_context` <500ms, `save_state` <100ms
- **Logging**: ALL logging to stderr. stdout is reserved for MCP protocol.
- **Error handling**: Tools return MCP error responses, never crash the server.
- **Depends on**: WP01 (types, schemas), WP02 (state store), WP03 (collectors)

**Implementation command**: `spec-kitty implement WP06 --base WP03`

(Note: WP06 depends on WP01+WP02+WP03. Use `--base WP03` since WP02 and WP03 both depend on WP01.)

## Subtasks & Detailed Guidance

### Subtask T020 -- MCP server setup

- **Purpose**: Initialize the MCP server framework and register all tools. This is the backbone that Claude connects to.
- **Steps**:
  1. Create `src/mcp/server.ts`:
     ```typescript
     import { Server } from '@modelcontextprotocol/sdk/server/index.js';
     import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';

     export async function createMcpServer(projectRoot: string): Promise<Server>;
     export async function startMcpServer(projectRoot: string): Promise<void>;
     ```
  2. `createMcpServer()`:
     - Create a `Server` instance with name `"joyus-ai-state"` and version `"0.1.0"`
     - Set capabilities: `{ tools: {} }`
     - Register the `tools/list` handler to return all tool definitions
     - Register the `tools/call` handler to route tool calls to implementations
     - Return the server instance
  3. `startMcpServer()`:
     - Create the server
     - Connect via `StdioServerTransport`
     - Server runs until the transport is closed
  4. Tool registration pattern:
     ```typescript
     server.setRequestHandler(ListToolsRequestSchema, async () => ({
       tools: [
         getContextToolDef,
         saveStateToolDef,
         verifyActionToolDef,
         // Extended tools added in WP07
       ]
     }));

     server.setRequestHandler(CallToolRequestSchema, async (request) => {
       const { name, arguments: args } = request.params;
       switch (name) {
         case 'get_context': return handleGetContext(args, projectRoot);
         case 'save_state': return handleSaveState(args, projectRoot);
         case 'verify_action': return handleVerifyAction(args, projectRoot);
         default: throw new McpError(ErrorCode.MethodNotFound, `Unknown tool: ${name}`);
       }
     });
     ```
  5. Global error handling: catch all errors in tool handlers, return MCP error responses

- **Files**:
  - `joyus-ai-state/src/mcp/server.ts` (new)

- **Parallel?**: No -- T021-T023 are registered as tools in this server.
- **Notes**: Use stderr for all logging (`console.error`, not `console.log`). stdout is the MCP protocol channel.

---

### Subtask T021 -- `get_context` MCP tool

- **Purpose**: Return the current session context — latest snapshot enriched with live git/file state. This is the most-used tool — Claude calls it at session start to know "where am I?"
- **Steps**:
  1. Create `src/mcp/tools/get-context.ts`:
     ```typescript
     export const getContextToolDef = {
       name: 'get_context',
       description: 'Get the current session context (latest snapshot enriched with live git state). Call this at session start or when you need to understand the current working state.',
       inputSchema: {
         type: 'object' as const,
         properties: {},
       },
     };

     export async function handleGetContext(
       args: Record<string, unknown>,
       projectRoot: string
     ): Promise<CallToolResult>;
     ```
  2. Implementation:
     - Initialize state store for the project
     - Load the latest snapshot from the state store
     - Run `collectGitState(projectRoot)` and `collectFileState(projectRoot)` for live data
     - If a snapshot exists:
       - Run `detectDivergence(snapshot, liveGit, liveFiles)` to compare stored vs live
       - Merge: use snapshot data as base, override `git` and `files` fields with live data
       - If diverged, add a `_divergence` field with the divergence report
     - If no snapshot exists:
       - Return a fresh collection: live git + files, null for decisions/task/tests/canonical
     - Return as JSON text content
  3. Response format:
     ```typescript
     return {
       content: [{
         type: 'text',
         text: JSON.stringify(enrichedSnapshot, null, 2),
       }],
     };
     ```
  4. Must be <500ms response time

- **Files**:
  - `joyus-ai-state/src/mcp/tools/get-context.ts` (new)

- **Parallel?**: Yes -- fully independent of T022, T023.
- **Notes**: The `_divergence` field is extra metadata not in the core Snapshot type — it's a response enhancement. If the companion service is running, the snapshot will be recent. If not, the live collectors provide current data regardless.

---

### Subtask T022 -- `save_state` MCP tool

- **Purpose**: Capture a state snapshot now. Claude calls this after performing significant actions so the state is preserved for recovery.
- **Steps**:
  1. Create `src/mcp/tools/save-state.ts`:
     ```typescript
     export const saveStateToolDef = {
       name: 'save_state',
       description: 'Capture a state snapshot now. Call this after significant actions (commits, test runs, branch switches) to preserve the current state.',
       inputSchema: {
         type: 'object' as const,
         properties: {
           event: {
             type: 'string',
             description: 'What triggered this snapshot (commit, branch-switch, test-run, manual)',
             enum: ['commit', 'branch-switch', 'test-run', 'session-start', 'session-end', 'manual', 'file-change', 'compaction'],
           },
           note: {
             type: 'string',
             description: 'Free-text note about what just happened',
           },
           decision: {
             type: 'string',
             description: 'Record a new pending decision',
           },
         },
       },
     };

     export async function handleSaveState(
       args: Record<string, unknown>,
       projectRoot: string
     ): Promise<CallToolResult>;
     ```
  2. Implementation:
     - Parse and validate input args
     - Run all collectors in parallel: `collectGitState`, `collectFileState`
     - Load previous decisions from last snapshot (if exists) for carry-forward
     - If `args.decision` provided, add as new pending decision
     - Load canonical declarations and get canonical statuses
     - Assemble the full Snapshot object:
       - Generate `id` with CUID2
       - Set `version: "1.0.0"`
       - Set `timestamp` to current ISO 8601
       - Set `event` from args (default: "manual")
       - Populate all fields from collector results
     - Validate with `SnapshotSchema`
     - Write via `StateStore.write()`
     - Return confirmation with snapshot summary
  3. Must be <100ms (non-blocking)

- **Files**:
  - `joyus-ai-state/src/mcp/tools/save-state.ts` (new)

- **Parallel?**: Yes -- fully independent of T021, T023.

---

### Subtask T023 -- `verify_action` MCP tool

- **Purpose**: Pre-action guardrail. Claude calls this before risky git operations to catch potential mistakes. Advisory only — returns warnings, never blocks.
- **Steps**:
  1. Create `src/mcp/tools/verify-action.ts`:
     ```typescript
     export const verifyActionToolDef = {
       name: 'verify_action',
       description: 'Pre-action guardrail check. Call this before commits, pushes, merges, or branch deletions to catch potential mistakes.',
       inputSchema: {
         type: 'object' as const,
         properties: {
           action: {
             type: 'string',
             description: 'Action type: commit, push, merge, branch-delete',
           },
           details: {
             type: 'object',
             description: 'Action-specific details (e.g., targetBranch, message)',
           },
         },
         required: ['action'],
       },
     };

     export async function handleVerifyAction(
       args: Record<string, unknown>,
       projectRoot: string
     ): Promise<CallToolResult>;
     ```
  2. Checks to perform:
     - **branch-match**: Load last snapshot, compare its branch with current branch. If different, warn: "About to {action} on '{current}' but last work was on '{expected}'"
     - **uncommitted-changes**: For commit action, check if files are staged
     - **canonical-conflict**: For commit action, check if any staged files are non-canonical copies of declared documents
     - **force-push**: If action is push and details suggest force, warn about risk
  3. Response format (from `contracts/state-api.md`):
     ```json
     {
       "allowed": true,
       "warnings": [],
       "checks": [
         { "name": "branch-match", "passed": true, "detail": "On expected branch feature/a11y-652" }
       ]
     }
     ```
  4. `allowed` is a recommendation, not enforcement. Claude presents warnings and asks user for confirmation.

- **Files**:
  - `joyus-ai-state/src/mcp/tools/verify-action.ts` (new)

- **Parallel?**: Yes -- fully independent of T021, T022.
- **Notes**: This tool lays groundwork for Spec 2 (Workflow Enforcement) quality gates. For now it's advisory only. When Spec 2 is implemented, the same checks can become enforceable.

---

### Subtask T024 -- MCP server entry point

- **Purpose**: Create the executable entry point that Claude Desktop/Code launches when connecting to the MCP server.
- **Steps**:
  1. Update `bin/joyus-ai-mcp`:
     ```javascript
     #!/usr/bin/env node
     import { startMcpServer } from '../dist/mcp/server.js';

     const projectRoot = process.cwd();
     startMcpServer(projectRoot).catch((error) => {
       console.error('Failed to start MCP server:', error);
       process.exit(1);
     });
     ```
  2. Make executable: `chmod +x bin/joyus-ai-mcp`
  3. Verify it can be launched and responds to MCP protocol
  4. Document Claude Desktop config:
     ```json
     {
       "mcpServers": {
         "joyus-ai-state": {
           "command": "npx",
           "args": ["joyus-ai-mcp"]
         }
       }
     }
     ```

- **Files**:
  - `joyus-ai-state/bin/joyus-ai-mcp` (update from stub)

- **Parallel?**: No -- depends on T020 server setup.

---

## Risks & Mitigations

| Risk | Mitigation |
|------|-----------|
| MCP SDK version incompatibility | Pin exact version in package.json. Test with Claude Desktop. |
| Server crashes on bad tool input | Validate all inputs. Return MCP error responses, never crash. |
| stdout/stderr conflict | MCP uses stdout for protocol. All logging to stderr. |
| get_context too slow | Run collectors in parallel. Cache results for 1-second window. |
| verify_action blocks workflow | Advisory only — never blocks. `allowed` is a recommendation. |

## Review Guidance

- Verify MCP server starts cleanly via stdio transport
- Verify all tool input/output schemas match `contracts/state-api.md` exactly
- Verify `get_context` correctly enriches stored state with live git/file data
- Verify `get_context` returns live-only data when no snapshots exist
- Verify `save_state` creates a valid, parseable snapshot file
- Verify `verify_action` catches branch mismatch and returns clear warnings
- Verify all errors return MCP error responses (not crashes)
- Verify no logging to stdout (only stderr)
- Test with Claude Desktop configuration

## Activity Log

- 2026-02-17T03:14:10Z -- system -- lane=planned -- Prompt created.
