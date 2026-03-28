---
work_package_id: WP07
title: MCP Content Tools
lane: done
dependencies: []
base_branch: 006-content-infrastructure-WP01
base_commit: ad3ac9985edbc8dfbdeb1616fb5329168797f97f
created_at: '2026-02-21T12:54:09.239744+00:00'
subtasks: [T031, T032, T033, T034, T035, T036, T037]
shell_pid: '58816'
review_status: approved
reviewed_by: Alex Urevick-Ackelsberg
history:
- date: '2026-02-21'
  action: created
  by: spec-kitty.tasks
---

# WP07: MCP Content Tools

## Objective

Implement all 13 MCP tools for content operations (source management, search, entitlements, generation, state dashboard, drift monitoring) and register them in the existing tool system.

## Implementation Command

```bash
spec-kitty implement WP07 --base WP06
```

## Context

- **Contracts**: `kitty-specs/006-content-infrastructure/contracts/content-tools.yaml` (authoritative tool definitions)
- **Existing pattern**: `src/tools/` — see `jira-tools.ts`, `github-tools.ts` for format. Each file exports a `ToolDefinition[]` array.
- **Executor pattern**: `src/tools/executor.ts` — routes by prefix (e.g., `content_` → content executor)
- **Tool index**: `src/tools/index.ts` — registers tools based on user connections

All content tools use the `content_` prefix. The executor delegates to a content-specific executor function.

---

## Subtask T031: Source Management Tools

**Purpose**: Implement tools for listing, viewing, syncing, and checking sync status of content sources.

**Steps**:
1. Create `joyus-ai-mcp-server/src/tools/content-tools.ts`
2. Define tool definitions (matching contracts/content-tools.yaml exactly):
   - `content_list_sources`: List all sources for tenant, optional status filter
   - `content_get_source`: Get source details by ID including sync history
   - `content_sync_source`: Trigger immediate sync, return syncRunId
   - `content_get_sync_status`: Check sync run progress
3. Follow existing pattern from `jira-tools.ts`:
   ```typescript
   export const contentSourceTools: ToolDefinition[] = [
     {
       name: 'content_list_sources',
       description: 'List all content sources...',
       inputSchema: { type: 'object', properties: { ... }, required: [] }
     },
     // ...
   ];
   ```

**Files**:
- `joyus-ai-mcp-server/src/tools/content-tools.ts` (new, start of file, ~80 lines)

**Validation**:
- [ ] Tool definitions match contracts/content-tools.yaml
- [ ] Input schemas have correct types and required fields

---

## Subtask T032: Search Tools

**Purpose**: Implement content search and item retrieval tools.

**Steps**:
1. Add to `content-tools.ts`:
   - `content_search`: Search across accessible sources with entitlement filtering
   - `content_get_item`: Retrieve specific item by ID (with entitlement check)
2. Input schemas per contracts/content-tools.yaml

**Files**:
- `joyus-ai-mcp-server/src/tools/content-tools.ts` (extend, ~40 lines)

**Validation**:
- [ ] Search tool includes query, sourceId, limit, offset params
- [ ] Get item tool includes itemId param

---

## Subtask T033: Entitlement Tools

**Purpose**: Implement entitlement resolution and product listing tools.

**Steps**:
1. Add to `content-tools.ts`:
   - `content_resolve_entitlements`: Resolve current user's entitlements (with forceRefresh option)
   - `content_list_products`: List products accessible to current user
2. Input schemas per contracts/content-tools.yaml

**Files**:
- `joyus-ai-mcp-server/src/tools/content-tools.ts` (extend, ~30 lines)

**Validation**:
- [ ] Resolve tool has forceRefresh boolean param
- [ ] List products tool has no required params

---

## Subtask T034: Generation Tool

**Purpose**: Implement the content-aware generation tool.

**Steps**:
1. Add to `content-tools.ts`:
   - `content_generate`: Generate AI response with content retrieval, voice profile, and citations
2. Input schema per contracts/content-tools.yaml: query (required), profileId (optional), sourceIds (optional array), maxSources (optional int)

**Files**:
- `joyus-ai-mcp-server/src/tools/content-tools.ts` (extend, ~25 lines)

**Validation**:
- [ ] Query is required, other params optional
- [ ] sourceIds is array of strings

---

## Subtask T035: Content State Dashboard Tool

**Purpose**: Implement the content state overview tool.

**Steps**:
1. Add to `content-tools.ts`:
   - `content_state_dashboard`: Summary of all sources with sync status, counts, staleness

**Files**:
- `joyus-ai-mcp-server/src/tools/content-tools.ts` (extend, ~15 lines)

**Validation**:
- [ ] No required input params

---

## Subtask T036: Drift Monitoring Tools

**Purpose**: Implement voice drift report and summary tools.

**Steps**:
1. Add to `content-tools.ts`:
   - `content_drift_report`: Get drift report for specific profile (profileId required, windowDays optional)
   - `content_drift_summary`: Overview of drift across all profiles

**Files**:
- `joyus-ai-mcp-server/src/tools/content-tools.ts` (extend, ~30 lines)

**Validation**:
- [ ] Drift report requires profileId
- [ ] Drift summary has no required params

---

## Subtask T037: Register Content Tools in Tool System

**Purpose**: Wire content tools into the existing tool index and executor.

**Steps**:
1. Create `joyus-ai-mcp-server/src/tools/executors/content-executor.ts`:
   ```typescript
   export async function executeContentTool(
     toolName: string,
     input: Record<string, unknown>,
     context: { userId: string; tenantId: string }
   ): Promise<unknown> {
     // Route to appropriate service based on tool name
     switch (toolName) {
       case 'content_list_sources': // → query sources table
       case 'content_get_source': // → get source + recent sync runs
       case 'content_sync_source': // → triggerSync()
       case 'content_get_sync_status': // → getSyncRunById()
       case 'content_search': // → searchService.search()
       case 'content_get_item': // → searchService.getItem()
       case 'content_resolve_entitlements': // → entitlementService.resolve()
       case 'content_list_products': // → productService.getProductsForUser()
       case 'content_generate': // → generationService.generate()
       case 'content_state_dashboard': // → aggregate source states
       case 'content_drift_report': // → query drift_reports
       case 'content_drift_summary': // → aggregate drift scores
     }
   }
   ```
2. Edit `src/tools/executor.ts`: Add `content_` prefix routing:
   ```typescript
   if (toolName.startsWith('content_')) {
     return executeContentTool(toolName, input, { userId, tenantId });
   }
   ```
3. Edit `src/tools/index.ts`: Import `contentTools` array and add to `getAllTools()`:
   ```typescript
   import { contentTools } from './content-tools.js';
   // In getAllTools():
   tools.push(...contentTools);  // Always available (no connection needed)
   ```

**Files**:
- `joyus-ai-mcp-server/src/tools/executors/content-executor.ts` (new, ~200 lines)
- `joyus-ai-mcp-server/src/tools/executor.ts` (modify, ~5 lines)
- `joyus-ai-mcp-server/src/tools/index.ts` (modify, ~5 lines)

**Validation**:
- [ ] All 13 content tools registered in tool index
- [ ] Content executor routes all tools correctly
- [ ] Existing tools unaffected
- [ ] `npm run typecheck` passes

---

## Definition of Done

- [ ] All 13 MCP tools defined with correct schemas matching contracts
- [ ] Content executor implements all tool handlers
- [ ] Tools registered in tool index (always available, no connection needed)
- [ ] Prefix routing in executor works for `content_` tools
- [ ] `npm run typecheck` passes

## Risks

- **Executor context**: Existing executor passes `userId` but content tools need `tenantId` too. May need to extend the executor context.
- **Tool availability**: Content tools should always be listed (unlike service-specific tools that need connections).

## Reviewer Guidance

- Verify tool definitions match contracts/content-tools.yaml exactly
- Check executor routing handles all 13 tools
- Confirm existing tool registration is unchanged
- Verify content tools appear in `getAllTools()` without requiring a connection

## Activity Log

- 2026-02-21T12:59:55Z – unknown – shell_pid=58816 – lane=done – 13 MCP content tools with executor
