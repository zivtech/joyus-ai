---
work_package_id: WP04
title: Per-Tenant Concurrency and Cron Scheduling
lane: done
dependencies: [WP02]
base_branch: 010-inngest-evaluation-WP02
base_commit: 9f52f333b3830e35879a6decccc40e5d7702105d
created_at: '2026-03-19T10:45:28.064951+00:00'
subtasks: [T016, T017, T018, T019, T020]
phase: Phase B - Core Validation
assignee: ''
agent: claude-sonnet
shell_pid: '19309'
review_status: approved
reviewed_by: Alex Urevick-Ackelsberg
history:
- timestamp: '2026-03-19T05:00:00Z'
  lane: planned
  agent: system
  action: Prompt generated via /spec-kitty.tasks
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

## Activity Log

- 2026-03-19T10:57:55Z – unknown – shell_pid=32008 – lane=for_review – Per-tenant concurrency (key=tenantId, limit=1) on corpus pipeline, schedule-tick cron function with IANA timezone support, 18 tests passing.
- 2026-03-19T10:58:57Z – claude-sonnet – shell_pid=82810 – lane=doing – Started review via workflow command
- 2026-03-19T11:45:30Z – claude-sonnet – shell_pid=82810 – lane=for_review – Fixed: cron concurrency key now static (schedule-tick-global), T017/T019/T020 tests assert actual config. 18 tests passing, typecheck clean.
- 2026-03-19T11:45:45Z – claude-sonnet – shell_pid=19309 – lane=doing – Started review via workflow command
- 2026-03-19T11:52:21Z – claude-sonnet – shell_pid=19309 – lane=done – Review passed: static concurrency key, meaningful T017/T019/T020 tests, 18/18 passing.
