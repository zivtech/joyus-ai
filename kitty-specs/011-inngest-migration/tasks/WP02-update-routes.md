# WP02 — Update Routes to inngest.send()

Replace `eventBus.publish()` dispatch in `pipelines/routes.ts` with `inngest.send()`.
Remove `EventBus` dependency from `PipelineRouterDeps`.

## Subtasks

- T005: Remove `EventBus` import and `eventBus` field from `PipelineRouterDeps`
- T006: Import `inngest` client in `routes.ts`
- T007: Replace `eventBus.publish()` call with `inngest.send()` in manual trigger handler
- T008: Update route tests

## Status

Complete — merged to main.
