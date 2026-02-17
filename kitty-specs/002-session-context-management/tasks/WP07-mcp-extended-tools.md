---
work_package_id: WP07
title: MCP Extended Tools
lane: planned
dependencies:
- WP04
subtasks:
- T025
- T026
- T027
- T028
phase: Phase 2 - Primary Interface
assignee: ''
agent: ''
shell_pid: ''
review_status: ''
reviewed_by: ''
history:
- timestamp: '2026-02-17T03:14:10Z'
  lane: planned
  agent: system
  shell_pid: ''
  action: Prompt generated via /spec-kitty.tasks (MCP-first architecture)
---

# Work Package Prompt: WP07 -- MCP Extended Tools

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

- Add the remaining two MCP tools: `check_canonical` and `share_state`
- Establish consistent input validation and error response handling across all 5 tools
- Document Claude Desktop/Code MCP configuration and verification steps
- **Done when**: All 5 MCP tools work end-to-end, consistent error handling, Claude Desktop config documented and tested

## Context & Constraints

- **Contracts**: `contracts/state-api.md` — `check_canonical` and `share_state` tool definitions (authoritative)
- **Plan**: `plan.md` — MCP Tools table
- **Quickstart**: `quickstart.md` — setup and verification flow
- **WP04**: Canonical module provides `checkPath`, `addDeclaration`, `loadCanonical`, `saveCanonical`
- **WP05**: Sharing module provides `exportSharedState`, `loadSharedState`
- **WP06**: MCP server provides tool registration and routing
- **Error pattern**: Validate input with Zod → call core module → catch errors → return MCP error response
- **Depends on**: WP04 (canonical), WP05 (sharing), WP06 (MCP server)

**Implementation command**: `spec-kitty implement WP07 --base WP06`

(Note: WP07 depends on WP04+WP05+WP06. Use `--base WP06` as it's the latest in the dependency chain.)

## Subtasks & Detailed Guidance

### Subtask T025 -- `check_canonical` MCP tool

- **Purpose**: Allow Claude to check file paths against canonical declarations and declare new canonical sources, all on behalf of the user.
- **Steps**:
  1. Create `src/mcp/tools/check-canonical.ts`:
     ```typescript
     export const checkCanonicalToolDef = {
       name: 'check_canonical',
       description: 'Check if a file path is the canonical source, or declare a new canonical source. Use before reading/writing files that might have duplicates.',
       inputSchema: {
         type: 'object' as const,
         properties: {
           action: {
             type: 'string',
             enum: ['check', 'declare'],
             description: 'Mode: check a path or declare a new canonical source',
           },
           path: {
             type: 'string',
             description: 'File path to check or declare as canonical',
           },
           name: {
             type: 'string',
             description: 'Human-readable name for the document (required for declare mode)',
           },
           branch: {
             type: 'string',
             description: 'Branch-specific override (declare mode only)',
           },
         },
         required: ['action', 'path'],
       },
     };

     export async function handleCheckCanonical(
       args: Record<string, unknown>,
       projectRoot: string
     ): Promise<CallToolResult>;
     ```
  2. **Check mode** (`action: "check"`):
     - Load canonical declarations
     - Get current branch from git collector
     - Call `checkPath(declarations, path, branch)`
     - Return the `CheckResult` as JSON (matching `contracts/state-api.md`)
  3. **Declare mode** (`action: "declare"`):
     - Require `name` parameter (return error if missing)
     - Load canonical declarations
     - Call `addDeclaration(declarations, name, path, branch?)`
     - Save canonical declarations
     - Return confirmation: `{ declared: true, name, path, branch }`
  4. Register in the MCP server's tool list and call handler (update `src/mcp/server.ts`)

- **Files**:
  - `jawn-ai-state/src/mcp/tools/check-canonical.ts` (new)
  - `jawn-ai-state/src/mcp/server.ts` (update — register tool)

- **Parallel?**: Yes -- independent of T026.

---

### Subtask T026 -- `share_state` MCP tool

- **Purpose**: Allow Claude to share context with teammates or load shared context, all on behalf of the user.
- **Steps**:
  1. Create `src/mcp/tools/share-state.ts`:
     ```typescript
     export const shareStateToolDef = {
       name: 'share_state',
       description: 'Export current state with a note for a teammate, or load a teammates shared state.',
       inputSchema: {
         type: 'object' as const,
         properties: {
           action: {
             type: 'string',
             enum: ['export', 'import'],
             description: 'Mode: export current state or import shared state',
           },
           note: {
             type: 'string',
             description: 'What you were working on (required for export)',
           },
           path: {
             type: 'string',
             description: 'Path to shared state file (required for import)',
           },
         },
         required: ['action'],
       },
     };

     export async function handleShareState(
       args: Record<string, unknown>,
       projectRoot: string
     ): Promise<CallToolResult>;
     ```
  2. **Export mode** (`action: "export"`):
     - Require `note` parameter (return error if missing)
     - Call `exportSharedState({ projectRoot, note })`
     - Return `{ sharedFile, note }` as JSON
  3. **Import mode** (`action: "import"`):
     - Require `path` parameter (return error if missing)
     - Call `loadSharedState(path)`
     - Return the full snapshot and sharer note as JSON
  4. Register in MCP server

- **Files**:
  - `jawn-ai-state/src/mcp/tools/share-state.ts` (new)
  - `jawn-ai-state/src/mcp/server.ts` (update — register tool)

- **Parallel?**: Yes -- independent of T025.

---

### Subtask T027 -- Tool input validation and error response handling

- **Purpose**: Establish a consistent pattern for input validation and error responses across all 5 MCP tools. Refactor any inconsistencies from WP06 tools.
- **Steps**:
  1. Create `src/mcp/tools/utils.ts`:
     ```typescript
     import { z } from 'zod';

     export function validateInput<T>(schema: z.ZodSchema<T>, args: unknown): T;
     export function createErrorResponse(message: string): CallToolResult;
     export function createSuccessResponse(data: unknown): CallToolResult;
     ```
  2. `validateInput()`: Parse args with Zod schema. On failure, throw with clear validation error message listing which fields are invalid.
  3. `createErrorResponse()`: Returns `{ content: [{ type: 'text', text: JSON.stringify({ error: message }) }], isError: true }`
  4. `createSuccessResponse()`: Returns `{ content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] }`
  5. Create Zod schemas for each tool's input:
     ```typescript
     export const GetContextInputSchema = z.object({});
     export const SaveStateInputSchema = z.object({
       event: EventTypeSchema.optional(),
       note: z.string().optional(),
       decision: z.string().optional(),
     });
     export const VerifyActionInputSchema = z.object({
       action: z.enum(['commit', 'push', 'merge', 'branch-delete']),
       details: z.record(z.unknown()).optional(),
     });
     export const CheckCanonicalInputSchema = z.discriminatedUnion('action', [
       z.object({ action: z.literal('check'), path: z.string() }),
       z.object({ action: z.literal('declare'), path: z.string(), name: z.string(), branch: z.string().optional() }),
     ]);
     export const ShareStateInputSchema = z.discriminatedUnion('action', [
       z.object({ action: z.literal('export'), note: z.string() }),
       z.object({ action: z.literal('import'), path: z.string() }),
     ]);
     ```
  6. Update all 5 tool handlers to use `validateInput` and consistent response helpers
  7. Wrap every handler in try/catch that returns `createErrorResponse` on any unexpected error

- **Files**:
  - `jawn-ai-state/src/mcp/tools/utils.ts` (new)
  - `jawn-ai-state/src/mcp/tools/get-context.ts` (update)
  - `jawn-ai-state/src/mcp/tools/save-state.ts` (update)
  - `jawn-ai-state/src/mcp/tools/verify-action.ts` (update)
  - `jawn-ai-state/src/mcp/tools/check-canonical.ts` (update)
  - `jawn-ai-state/src/mcp/tools/share-state.ts` (update)

- **Parallel?**: Yes -- can be done alongside T025/T026 or as a refactor after.

---

### Subtask T028 -- Claude Desktop/Code MCP configuration

- **Purpose**: Document and verify the MCP server configuration for Claude Desktop and Claude Code so users can connect.
- **Steps**:
  1. Verify the MCP server works with the documented config:
     ```json
     {
       "mcpServers": {
         "jawn-ai-state": {
           "command": "npx",
           "args": ["jawn-ai-mcp"]
         }
       }
     }
     ```
  2. Test alternative configurations:
     - Direct path: `{ "command": "/path/to/jawn-ai-state/bin/jawn-ai-mcp" }`
     - With explicit project root: `{ "command": "npx", "args": ["jawn-ai-mcp"], "env": { "PROJECT_ROOT": "/path/to/project" } }`
  3. Verify the server responds to `tools/list` with all 5 tools
  4. Verify each tool can be called and returns valid responses
  5. Update `bin/jawn-ai-mcp` to support `PROJECT_ROOT` env variable as override for `process.cwd()`
  6. Ensure `quickstart.md` setup instructions match the actual configuration

- **Files**:
  - `jawn-ai-state/bin/jawn-ai-mcp` (update — PROJECT_ROOT support)

- **Parallel?**: Yes -- independent of T025-T027.

---

## Risks & Mitigations

| Risk | Mitigation |
|------|-----------|
| Discriminated union validation too strict | Use `.passthrough()` on Zod schemas to allow extra fields |
| Tool registration order matters | Register all tools before connecting transport |
| Claude Desktop config path varies by OS | Document paths for macOS, Linux, Windows/WSL2 |
| Error responses not helpful | Include field names and expected types in validation errors |

## Review Guidance

- Verify all 5 MCP tools are registered and respond to `tools/list`
- Verify `check_canonical` check mode returns correct `CheckResult` format
- Verify `check_canonical` declare mode persists to `canonical.json`
- Verify `share_state` export creates valid shared file with sharer note
- Verify `share_state` import handles both shared and regular snapshots
- Verify all tools use consistent input validation (Zod schemas)
- Verify all tools use consistent error response format
- Verify Claude Desktop config works end-to-end
- Test with real Claude session

## Activity Log

- 2026-02-17T03:14:10Z -- system -- lane=planned -- Prompt created.
