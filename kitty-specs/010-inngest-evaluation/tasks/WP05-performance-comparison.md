---
work_package_id: "WP05"
title: "Performance Comparison"
lane: "doing"
dependencies: ["WP02", "WP03", "WP04"]
subtasks: ["T021", "T022", "T023", "T024", "T025"]
phase: "Phase C - Assessment"
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

# WP05: Performance Comparison

## Objective

Measure step execution latency for the Inngest-based pipeline vs the Feature 009 custom executor. Document findings with raw numbers and analysis.

## Implementation Command

```bash
spec-kitty implement WP05
```

## Subtasks

- [ ] T021: Benchmark custom executor — 50 sequential executions, record p50/p95/p99 step latency
- [ ] T022: Benchmark Inngest — same 50 sequential executions, same metrics
- [ ] T023: Measure cold-start time for both (first execution after server restart)
- [ ] T024: Document results in `research/performance-comparison.md`
- [ ] T025: Flag latency anomalies (Redis polling interval, self-hosted overhead)

## Activity Log

- 2026-03-19T11:49:13Z – unknown – lane=doing – Starting performance comparison implementation
