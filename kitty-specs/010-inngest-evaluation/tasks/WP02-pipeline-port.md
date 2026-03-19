---
work_package_id: WP02
title: Port One Pipeline to Inngest Functions
lane: "doing"
dependencies: [WP01]
base_branch: 010-inngest-evaluation-WP01
base_commit: 24da977f19a333868beb140919ac67f6e5d97c46
created_at: '2026-03-19T02:25:10.000486+00:00'
subtasks: [T006, T007, T008, T009, T010]
phase: Phase B - Core Validation
assignee: ''
agent: "claude-sonnet"
shell_pid: "81954"
review_status: ''
reviewed_by: ''
history:
- timestamp: '2026-03-19T05:00:00Z'
  lane: planned
  agent: system
  action: Prompt generated via /spec-kitty.tasks
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

## Activity Log

- 2026-03-19T02:34:16Z – unknown – shell_pid=2176 – lane=for_review – Adapter + corpus-update pipeline implemented: InngestStepHandlerAdapter wraps PipelineStepHandler.execute(), createCorpusUpdatePipeline factory with stub fallback, 12 unit tests passing, typecheck clean.
- 2026-03-19T02:50:21Z – claude-sonnet – shell_pid=81954 – lane=doing – Started review via workflow command
