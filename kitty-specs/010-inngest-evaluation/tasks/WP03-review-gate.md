---
work_package_id: "WP03"
title: "Review Gate via step.waitForEvent()"
lane: "planned"
dependencies: ["WP02"]
subtasks: ["T011", "T012", "T013", "T014", "T015"]
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

# WP03: Review Gate via step.waitForEvent()

## Objective

Implement the review gate pause/resume pattern using Inngest's `step.waitForEvent()`. Validate approve, reject, and timeout paths using the existing DecisionRecorder.

## Implementation Command

```bash
spec-kitty implement WP03
```

## Subtasks

- [ ] T011: Implement review gate step in the ported pipeline using `step.waitForEvent('pipeline/review.decided', { timeout: '7d' })`
- [ ] T012: Update `DecisionRecorder` to send `pipeline/review.decided` Inngest event after recording a decision
- [ ] T013: Test approve path — execution resumes with approved artifacts
- [ ] T014: Test reject path — execution receives rejection feedback and records failure
- [ ] T015: Test timeout path — execution escalates correctly after simulated timeout
