---
work_package_id: "WP04"
title: "Retry Dead Letter and Audit"
dependencies: ["WP03"]
planning_base_branch: "codex/gateway-event-bus-promotion-20260525"
merge_target_branch: "codex/gateway-event-bus-promotion-20260525"
branch_strategy: "Planning artifacts for this feature were generated on codex/gateway-event-bus-promotion-20260525. During /spec-kitty.implement this WP may branch from a dependency-specific base, but completed changes must merge back into codex/gateway-event-bus-promotion-20260525 unless the human explicitly redirects the landing branch."
requirement_refs: ["FR-005", "FR-013", "NFR-002", "NFR-004", "NFR-005", "NFR-007"]
subtasks: ["T019", "T020", "T021", "T022", "T023"]
phase: "Phase 4 - Reliability"
authoritative_surface: "joyus-ai-mcp-server/src/gateway-events/"
execution_mode: "code_change"
owned_files:
  - "joyus-ai-mcp-server/src/gateway-events/retry.worker.ts"
  - "joyus-ai-mcp-server/src/gateway-events/dead-letter.service.ts"
  - "joyus-ai-mcp-server/src/gateway-events/audit.service.ts"
---

# Work Package Prompt: WP04 - Retry Dead Letter and Audit

## Objective

Make delivery failure behavior bounded, inspectable, and auditable. Persist retry state before any scheduler sophistication so the implementation can later move to Inngest without changing the contract.

## Tasks

- T019 Implement retry scheduling state transitions.
- T020 Implement dead-letter transition and query helpers.
- T021 Implement audit service for events, deliveries, and decisions.
- T022 Add worker loop for due retry attempts.
- T023 Add tests for retry, dead-letter, redaction, and `skipped_no_channel` metrics.

## Constraints

- Default maximum attempts is 3.
- Terminal states are `sent`, `dead_letter`, and `skipped_no_channel`.
- Redaction must happen before writing error summaries.
- Audit query paths must require tenant scope.

## Validation

Run from `joyus-ai-mcp-server/`:

```bash
npm run typecheck
npm test -- gateway-events
```
