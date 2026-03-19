---
work_package_id: "WP04"
title: "Per-Tenant Concurrency and Cron Scheduling"
lane: "planned"
dependencies: ["WP02"]
subtasks: ["T016", "T017", "T018", "T019", "T020"]
phase: "Phase B - Core Validation"
assignee: ""
agent: ""
shell_pid: ""
review_status: ""
reviewed_by: ""
history:
  - timestamp: "2026-03-19T05:00:00Z"
    lane: "planned"
    agent: "system"
    action: "Prompt generated via /spec-kitty.tasks"
---

# WP04: Per-Tenant Concurrency and Cron Scheduling

## Objective

Validate per-tenant concurrency isolation using Inngest concurrency keys. Implement and validate a cron-triggered pipeline with overlap detection.

## Implementation Command

```bash
spec-kitty implement WP04
```

## Subtasks

- [ ] T016: Add `concurrency: { key: 'event.data.tenantId', limit: 1 }` to the ported pipeline function
- [ ] T017: Test cross-tenant isolation — trigger two tenants simultaneously, confirm no queue contamination
- [ ] T018: Implement a `schedule_tick` pipeline as an Inngest cron function
- [ ] T019: Confirm overlap detection — concurrent cron runs blocked by concurrency key
- [ ] T020: Confirm timezone support for schedule configurations
