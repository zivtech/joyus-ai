---
work_package_id: "WP05"
title: "Decision Ingestion and Handler Registry"
dependencies: ["WP02"]
planning_base_branch: "codex/gateway-event-bus-promotion-20260525"
merge_target_branch: "codex/gateway-event-bus-promotion-20260525"
branch_strategy: "Planning artifacts for this feature were generated on codex/gateway-event-bus-promotion-20260525. During /spec-kitty.implement this WP may branch from a dependency-specific base, but completed changes must merge back into codex/gateway-event-bus-promotion-20260525 unless the human explicitly redirects the landing branch."
requirement_refs: ["FR-010", "FR-011", "FR-012", "FR-013", "NFR-003", "NFR-004", "NFR-007"]
subtasks: ["T024", "T025", "T026", "T027", "T028", "T029"]
phase: "Phase 5 - Decisions"
authoritative_surface: "joyus-ai-mcp-server/src/gateway-events/"
execution_mode: "code_change"
owned_files:
  - "joyus-ai-mcp-server/src/gateway-events/decision.service.ts"
  - "joyus-ai-mcp-server/src/gateway-events/handler-registry.ts"
  - "joyus-ai-mcp-server/src/gateway-events/routes/decisions.ts"
---

# Work Package Prompt: WP05 - Decision Ingestion and Handler Registry

## Objective

Implement decision ingestion and route accepted decisions to domain handlers. The gateway records receipt, idempotency, route attempt, and route status; domain handlers own lifecycle state.

## Tasks

- T024 Implement decision ingestion service with idempotency.
- T025 Implement handler registry and handler result types.
- T026 Implement decision route and validation.
- T027 Add pipeline review decision handler adapter.
- T028 Add monitoring acknowledgment/dismissal handler adapter.
- T029 Add decision tests for duplicate, rejected, failed, and routed cases.

## Constraints

- Reject decisions for events that are not decision-capable.
- Reject tenant mismatches between decision and event.
- Duplicate decision idempotency keys must not invoke handlers twice.
- Handler errors must be sanitized before persistence.

## Validation

Run from `joyus-ai-mcp-server/`:

```bash
npm run typecheck
npm test -- gateway-events
```
