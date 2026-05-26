---
work_package_id: "WP03"
title: "Delivery Routing and Backends"
dependencies: ["WP02"]
planning_base_branch: "codex/gateway-event-bus-promotion-20260525"
merge_target_branch: "codex/gateway-event-bus-promotion-20260525"
branch_strategy: "Planning artifacts for this feature were generated on codex/gateway-event-bus-promotion-20260525. During /spec-kitty.implement this WP may branch from a dependency-specific base, but completed changes must merge back into codex/gateway-event-bus-promotion-20260525 unless the human explicitly redirects the landing branch."
requirement_refs: ["FR-004", "FR-006", "FR-007", "FR-008", "FR-009", "NFR-001", "NFR-005"]
subtasks: ["T013", "T014", "T015", "T016", "T017", "T018"]
phase: "Phase 3 - Delivery"
authoritative_surface: "joyus-ai-mcp-server/src/gateway-events/"
execution_mode: "code_change"
owned_files:
  - "joyus-ai-mcp-server/src/gateway-events/adapters/**"
  - "joyus-ai-mcp-server/src/gateway-events/delivery.service.ts"
---

# Work Package Prompt: WP03 - Delivery Routing and Backends

## Objective

Implement the shared delivery coordinator and backend adapter contract. Dashboard and webhook are concrete Phase 1 delivery paths; Slack, email, and channel use the same adapter boundary.

## Tasks

- T013 Define delivery adapter interface and routing coordinator.
- T014 Implement dashboard adapter.
- T015 Implement webhook adapter with signing hook and sanitized errors.
- T016 Add Slack/email adapter stubs behind the shared interface.
- T017 Implement channel adapter skip behavior.
- T018 Add delivery routing tests for multi-backend fanout.

## Constraints

- Delivery must be fire-and-forget from the source emitter perspective.
- Webhook errors must not leak secrets, signatures, headers, or raw payloads.
- Missing channel connection records `skipped_no_channel`, not `failed`.
- One backend failure must not prevent attempts for other matching backends.

## Validation

Run from `joyus-ai-mcp-server/`:

```bash
npm run typecheck
npm test -- gateway-events
```

## Activity Log

- 2026-05-25T23:55:28Z – unknown – Ready for review
- 2026-05-26T00:09:38Z – unknown – Review passed
- 2026-05-26T00:14:49Z – unknown – Merged to target branch | Done override: Implementation was manually squashed to target in commit 983f07b after Spec Kitty squash hit mission metadata conflict
