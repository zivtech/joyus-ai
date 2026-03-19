---
work_package_id: "WP02"
title: "Port One Pipeline to Inngest Functions"
lane: "planned"
dependencies: ["WP01"]
subtasks: ["T006", "T007", "T008", "T009", "T010"]
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

# WP02: Port One Pipeline to Inngest Functions

## Objective

Port the corpus-update-to-profiles pipeline (corpus_change trigger → profile-generation step → fidelity-check step) to Inngest durable functions, reusing existing step handlers via adapter wrappers.

## Implementation Command

```bash
spec-kitty implement WP02
```

## Subtasks

- [ ] T006: Define `InngestStepHandlerAdapter` — wraps existing `PipelineStepHandler` interface for use with `inngest.step.run()`
- [ ] T007: Create `src/inngest/functions/corpus-update-pipeline.ts` — Inngest function implementing the two-step pipeline
- [ ] T008: Wire `pipeline/corpus.changed` event → Inngest function trigger
- [ ] T009: Run end-to-end execution, confirm step traces appear in Inngest UI
- [ ] T010: Write unit tests for adapter and function structure
