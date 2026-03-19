---
work_package_id: WP03
title: Review Gate via step.waitForEvent()
lane: "doing"
dependencies: [WP02]
base_branch: 010-inngest-evaluation-WP02
base_commit: 9f52f333b3830e35879a6decccc40e5d7702105d
created_at: '2026-03-19T10:44:56.108021+00:00'
subtasks: [T011, T012, T013, T014, T015]
phase: Phase B - Core Validation
assignee: ''
agent: "claude-sonnet"
shell_pid: "81942"
review_status: ''
reviewed_by: ''
history:
- timestamp: '2026-03-19T05:00:00Z'
  lane: planned
  agent: system
  action: Prompt generated via /spec-kitty.tasks
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

## Activity Log

- 2026-03-19T10:57:29Z – unknown – shell_pid=30219 – lane=for_review – Review gate implemented: step.waitForEvent with approve/reject/timeout paths, DecisionRecorder sends Inngest event, 15 tests passing.
- 2026-03-19T10:58:50Z – claude-sonnet – shell_pid=81942 – lane=doing – Started review via workflow command
