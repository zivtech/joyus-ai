---
work_package_id: "WP06"
title: "Producer Integration and Acceptance Tests"
dependencies: ["WP03", "WP04", "WP05"]
planning_base_branch: "codex/gateway-event-bus-promotion-20260525"
merge_target_branch: "codex/gateway-event-bus-promotion-20260525"
branch_strategy: "Planning artifacts for this feature were generated on codex/gateway-event-bus-promotion-20260525. During /spec-kitty.implement this WP may branch from a dependency-specific base, but completed changes must merge back into codex/gateway-event-bus-promotion-20260525 unless the human explicitly redirects the landing branch."
requirement_refs: ["C-001", "C-002", "C-003", "C-004", "C-005"]
subtasks: ["T030", "T031", "T032", "T033", "T034", "T035", "T036"]
phase: "Phase 6 - Integration"
authoritative_surface: "joyus-ai-mcp-server/"
execution_mode: "code_change"
owned_files:
  - "joyus-ai-mcp-server/src/gateway-events/index.ts"
  - "joyus-ai-mcp-server/src/index.ts"
  - "joyus-ai-mcp-server/src/orchestrator/notification.service.ts"
  - "joyus-ai-mcp-server/src/pipelines/review/**"
  - "joyus-ai-mcp-server/src/content/monitoring/**"
  - "joyus-ai-mcp-server/docs/manual-testing/gateway-event-bus-manual-test.md"
---

# Work Package Prompt: WP06 - Producer Integration and Acceptance Tests

## Objective

Wire the gateway into the server and first producer surfaces. This package should prove the gateway is usable end-to-end without requiring channel delivery.

## Tasks

- T030 Mount gateway routes in the Express server.
- T031 Replace orchestrator notification stub wiring with real gateway forwarding.
- T032 Add pipeline review event emitter integration.
- T033 Add monitoring alert event emitter integration.
- T034 Add manual testing guide using generic fixtures.
- T035 Run typecheck and targeted test suites.
- T036 Parse OpenAPI contract and update quickstart with actual commands.

## Constraints

- Preserve non-channel operation as the baseline acceptance path.
- Keep producer payloads sanitized and generic.
- Do not make Slack, email, or channel provider configuration mandatory for acceptance.
- Do not move domain lifecycle state into gateway services.

## Validation

Run from `joyus-ai-mcp-server/`:

```bash
npm run typecheck
npm test -- gateway-events
```

Run from the repository root:

```bash
ruby -e "require 'yaml'; YAML.load_file('kitty-specs/gateway-event-bus-multichannel-01KSGP2X/contracts/gateway-event-bus.openapi.yaml')"
git diff --check
```

## Activity Log

- 2026-05-26T00:07:56Z – unknown – Ready for review
- 2026-05-26T00:10:39Z – unknown – Review passed
