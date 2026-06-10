---
work_package_id: WP04
title: Bearer Routes and Tool Execution
status: planned
depends_on: [WP02, WP03]
---

# WP04: Bearer Routes and Tool Execution

## Goal

Replace bearer-token route and MCP tool tenant derivation with shared tenant context.

## Scope

- Port `joyus-ai-mcp-server/src/pipelines/routes.ts`.
- Port `joyus-ai-mcp-server/src/orchestrator/middleware/tenant.ts`.
- Port event adapter management routes under `joyus-ai-mcp-server/src/event-adapter/routes/`.
- Pass resolved tenant context into `joyus-ai-mcp-server/src/tools/executor.ts`.
- Preserve route-specific non-disclosure behavior for cross-tenant resources.

## Tests

- Pipeline routes use primary membership by default.
- Orchestrator routes receive `req.tenantId` from shared resolver.
- Event adapter management routes use shared resolver instead of local helper functions.
- Content, profile, and pipeline tools receive resolver tenant context.
- Direct `userId === tenantId` assignments are removed or limited to compatibility tests.

## Done When

- Bearer-token surfaces no longer implement their own tenant resolver.
- Targeted route and tool tests pass.
- Acceptance grep shows no production direct fallback assignments remain.
