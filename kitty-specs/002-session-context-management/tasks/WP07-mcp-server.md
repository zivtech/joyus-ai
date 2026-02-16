---
work_package_id: WP07
title: Local MCP Server
lane: planned
dependencies:
- WP01
subtasks:
- T025
- T026
- T027
- T028
- T029
phase: Phase 3 - Extended Features
assignee: ''
agent: ''
shell_pid: ''
review_status: ''
reviewed_by: ''
history:
- timestamp: '2026-02-16T19:42:12Z'
  lane: planned
  agent: system
  shell_pid: ''
  action: Prompt generated via /spec-kitty.tasks
---

# Work Package Prompt: WP07 -- Local MCP Server

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

- Build a standalone local MCP server using `@modelcontextprotocol/sdk`
- Expose four MCP tools: `get_context`, `query_snapshots`, `check_canonical`, `share_state`
- Server runs as `jawn-ai mcp start` with stdio transport
- **Done when**: MCP server starts, all four tools respond correctly, and it can be added to Claude Desktop config

## Context & Constraints

- **Research**: R5 -- Standalone local MCP server, separate from the remote `jawn-ai-mcp-server`
- **Contracts**: `state-api.md` -- MCP tool signatures, inputs, outputs
- **Spec FR-008**: Support querying prior state on demand (MCP tools enable this)
- **Architecture**: The MCP server is optional. The CLI (WP04) works without it. The MCP server adds interactive query capability for AI agents.
- **Transport**: stdio (for Claude Desktop integration). Future: HTTP transport for web UI adapter.
- **Depends on**: WP01 (types), WP02 (store), WP03 (collectors), WP05 (canonical)

**Implementation command**: `spec-kitty implement WP07 --base WP05`

(Note: WP07 depends on WP01+WP02+WP03+WP05. Use `--base WP05` since it's the last dependency to complete.)

## Subtasks & Detailed Guidance

### Subtask T025 -- Local MCP server setup

- **Purpose**: Initialize the MCP server framework with `@modelcontextprotocol/sdk` and register all tools.
- **Steps**:
  1. Create `src/mcp/server.ts` with:
     ```typescript
     import { Server } from '@modelcontextprotocol/sdk/server/index.js';
     import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';

     export async function startMcpServer(projectRoot: string): Promise<void>;
     ```
  2. Server initialization:
     - Create a `Server` instance with name `"jawn-ai-state"` and version `"0.1.0"`
     - Set capabilities: `{ tools: {} }`
     - Register all four tools (T026-T029) as handlers
     - Connect via `StdioServerTransport`
  3. Add `jawn-ai mcp start` CLI command to launch the server:
     - Determine project root
     - Call `startMcpServer(projectRoot)`
     - Server runs until killed (stdio transport keeps it alive)
  4. Add to Claude Desktop config format documentation:
     ```json
     {
       "mcpServers": {
         "jawn-ai-state": {
           "command": "jawn-ai",
           "args": ["mcp", "start"]
         }
       }
     }
     ```

- **Files**:
  - `jawn-ai-state/src/mcp/server.ts` (new)
  - `jawn-ai-state/src/cli/commands/mcp.ts` (new -- CLI command to start server)

- **Parallel?**: No -- must complete before T026-T029 can be registered.
- **Notes**: The server must handle errors gracefully. If a tool call fails, return an error response (not crash). Log errors to stderr (not stdout -- stdio transport uses stdout for MCP protocol).

---

### Subtask T026 -- `get_context` MCP tool [P]

- **Purpose**: Return the current session context -- latest snapshot enriched with live git state. This is the primary tool AI agents use to understand "where am I?"
- **Steps**:
  1. Create `src/mcp/tools/get-context.ts`:
     ```typescript
     export const getContextTool = {
       name: 'get_context',
       description: 'Get the current session context (latest snapshot enriched with live git state)',
       inputSchema: { type: 'object', properties: {} },
       handler: async (params: {}, projectRoot: string) => { ... }
     };
     ```
  2. Implementation:
     - Load the latest snapshot from the state store
     - Run `collectGitState()` and `collectFileState()` for live data
     - Run divergence detection to compare stored vs live
     - Merge: use snapshot data as base, override `git` and `files` fields with live data
     - If diverged, add a `_divergence` field with the divergence report
     - Return the enriched snapshot as JSON
  3. If no snapshot exists, return a fresh collection of live state (git + files) with null for decisions/task/tests

- **Files**:
  - `jawn-ai-state/src/mcp/tools/get-context.ts` (new)

- **Parallel?**: Yes -- fully independent of T027, T028, T029.
- **Notes**: This tool is the most-used MCP tool. It must be fast (<500ms). The `_divergence` field is extra metadata not in the core Snapshot type -- it's a response enhancement.

---

### Subtask T027 -- `query_snapshots` MCP tool [P]

- **Purpose**: Search historical snapshots by date range, event type, or branch. Enables questions like "what was I doing yesterday?" or "show me snapshots from the feature branch."
- **Steps**:
  1. Create `src/mcp/tools/query-state.ts`:
     ```typescript
     export const querySnapshotsTool = {
       name: 'query_snapshots',
       description: 'Search historical snapshots by date, event type, or branch',
       inputSchema: {
         type: 'object',
         properties: {
           since: { type: 'string', description: 'ISO 8601 start date' },
           until: { type: 'string', description: 'ISO 8601 end date' },
           event: { type: 'string', description: 'Filter by event type' },
           branch: { type: 'string', description: 'Filter by branch name' },
           limit: { type: 'number', description: 'Max results (default 10)' }
         }
       },
       handler: async (params, projectRoot: string) => { ... }
     };
     ```
  2. Implementation:
     - Parse and validate input parameters
     - Call `StateStore.list()` with the filter criteria
     - Return array of `SnapshotSummary` objects (id, timestamp, event, branch, commitMessage)
  3. Handle invalid dates gracefully (return empty results, not error)

- **Files**:
  - `jawn-ai-state/src/mcp/tools/query-state.ts` (new)

- **Parallel?**: Yes -- fully independent.
- **Notes**: Return summaries, not full snapshots (performance). The AI agent can request a specific snapshot by ID using `get_context` with an ID parameter if needed.

---

### Subtask T028 -- `check_canonical` MCP tool [P]

- **Purpose**: Check if a file path is the canonical source or if a canonical source exists elsewhere. Enables the AI agent to validate document references.
- **Steps**:
  1. Create `src/mcp/tools/check-canonical.ts`:
     ```typescript
     export const checkCanonicalTool = {
       name: 'check_canonical',
       description: 'Check if a file path is canonical or if a canonical source exists',
       inputSchema: {
         type: 'object',
         properties: {
           path: { type: 'string', description: 'File path to check' }
         },
         required: ['path']
       },
       handler: async (params: { path: string }, projectRoot: string) => { ... }
     };
     ```
  2. Implementation:
     - Load canonical declarations
     - Get current branch from git collector
     - Call `checkPath()` with the file path and current branch
     - Return the `CheckResult` object as JSON (matching the contract in `state-api.md`)

- **Files**:
  - `jawn-ai-state/src/mcp/tools/check-canonical.ts` (new)

- **Parallel?**: Yes -- fully independent.
- **Notes**: Uses the canonical module from WP05. The MCP tool is a thin wrapper around `checkPath()`.

---

### Subtask T029 -- `share_state` MCP tool [P]

- **Purpose**: Allow an AI agent to trigger state sharing on behalf of the user.
- **Steps**:
  1. Create `src/mcp/tools/share-state.ts`:
     ```typescript
     export const shareStateTool = {
       name: 'share_state',
       description: 'Export current state with a note for a teammate',
       inputSchema: {
         type: 'object',
         properties: {
           note: { type: 'string', description: 'What you were working on' }
         },
         required: ['note']
       },
       handler: async (params: { note: string }, projectRoot: string) => { ... }
     };
     ```
  2. Implementation:
     - Call `exportSharedState()` from the share module (WP06)
     - Return `{ sharedFile, note }` as JSON

- **Files**:
  - `jawn-ai-state/src/mcp/tools/share-state.ts` (new)

- **Parallel?**: Yes -- fully independent. Note: this tool uses the share module from WP06, which may not be complete yet. The tool can be written to call the share API -- if WP06 isn't done, it will error gracefully.
- **Notes**: The `note` parameter is required in the MCP tool (unlike CLI where it can be prompted). The AI agent should always provide context.

---

## Risks & Mitigations

| Risk | Mitigation |
|------|-----------|
| MCP SDK version incompatibility | Pin exact version in package.json. Test with Claude Desktop. |
| Server crashes on bad tool input | Validate all inputs. Return error responses, never crash. |
| Server lifecycle management | Document start/stop. Consider adding to Claude Desktop config for auto-start. |
| Stdout/stderr conflict | MCP uses stdout for protocol. All logging must go to stderr. |

## Review Guidance

- Verify MCP server starts cleanly and responds to tool calls
- Verify all tool input/output schemas match `state-api.md` contract
- Verify `get_context` correctly enriches stored state with live git data
- Verify `query_snapshots` handles all filter combinations
- Verify all errors return MCP error responses (not crashes)
- Verify no logging to stdout (only stderr)
- Test with Claude Desktop configuration

## Activity Log

- 2026-02-16T19:42:12Z -- system -- lane=planned -- Prompt created.
