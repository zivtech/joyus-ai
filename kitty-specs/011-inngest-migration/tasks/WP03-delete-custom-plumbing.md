# WP03 — Delete Custom Execution Plumbing

Delete `engine/`, `event-bus/`, `triggers/`, `init.ts`. Fix all resulting import errors.
Verify TypeScript compilation passes.

## Subtasks

- T009: Delete all four module groups
- T010: Relocate shared types from deleted modules to `pipelines/types.ts`
- T011: Find and fix all import references to deleted modules
- T012: Run `npx tsc --noEmit` — must pass with zero errors
- T013: Verify test suite passes

## Status

Complete — in PR #33, awaiting review.
