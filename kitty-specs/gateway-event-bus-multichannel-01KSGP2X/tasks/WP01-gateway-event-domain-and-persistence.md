---
work_package_id: WP01
title: Gateway Event Domain and Persistence
dependencies: []
requirement_refs: [FR-001, FR-013, NFR-003, NFR-004, NFR-005]
planning_base_branch: codex/gateway-event-bus-promotion-20260525
merge_target_branch: codex/gateway-event-bus-promotion-20260525
branch_strategy: Planning artifacts for this feature were generated on codex/gateway-event-bus-promotion-20260525. During /spec-kitty.implement this WP may branch from a dependency-specific base, but completed changes must merge back into codex/gateway-event-bus-promotion-20260525 unless the human explicitly redirects the landing branch.
base_branch: kitty/mission-gateway-event-bus-multichannel-01KSGP2X
base_commit: 2d4b34fa420cfbf9b5c88c7544880908a951e20f
created_at: '2026-05-25T23:38:34.367115+00:00'
subtasks: [T001, T002, T003, T004, T005]
phase: Phase 1 - Foundation
shell_pid: "50834"
authoritative_surface: joyus-ai-mcp-server/
execution_mode: code_change
owned_files:
- joyus-ai-mcp-server/src/gateway-events/types.ts
- joyus-ai-mcp-server/src/gateway-events/schemas.ts
- joyus-ai-mcp-server/src/db/schema/gateway-events.ts
- joyus-ai-mcp-server/drizzle/migrations/**
- joyus-ai-mcp-server/src/gateway-events/**/*.test.ts
agent: "codex"
---

# Work Package Prompt: WP01 - Gateway Event Domain and Persistence

## Objective

Create the gateway event bus domain model and persistence foundation. Use local codebase conventions: TypeScript, Zod, Drizzle, text IDs, tenant-scoped indexes, and explicit test coverage.

## Tasks

- T001 Create gateway event TypeScript domain types for platform events, delivery endpoints, subscriptions, delivery attempts, decisions, channel connections, and handler results.
- T002 Create Zod schemas for all API-facing inputs and persisted state transitions.
- T003 Add Drizzle schema for gateway event tables in `joyus-ai-mcp-server/src/db/schema/gateway-events.ts`.
- T004 Generate and review the Drizzle migration.
- T005 Add schema/type unit tests including tenant mismatch and secret-redaction fixtures.

## Constraints

- Do not store plaintext secrets in delivery attempt, audit, or exported fields.
- Every persisted entity must include `tenantId`.
- Follow the existing text ID convention, even where the abstract data model says UUID.
- Keep event bus records distinct from orchestrator event rows.

## Validation

Run from `joyus-ai-mcp-server/`:

```bash
npm run typecheck
npm test -- gateway-events
```

## Activity Log

- 2026-05-25T23:38:34Z – codex – shell_pid=50834 – Assigned agent via action command
- 2026-05-25T23:45:25Z – codex – shell_pid=50834 – Ready for review
