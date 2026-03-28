---
work_package_id: WP01
title: Local Inngest Server Setup
lane: done
dependencies: []
subtasks: [T001, T002, T003, T004, T005]
phase: Phase A - Environment
assignee: ''
agent: claude-sonnet
shell_pid: '40083'
review_status: approved
reviewed_by: Alex Urevick-Ackelsberg
history:
- timestamp: '2026-03-19T05:00:00Z'
  lane: planned
  agent: system
  action: Prompt generated via /spec-kitty.tasks
---

# WP01: Local Inngest Server Setup

## Objective

Stand up Inngest server self-hosted alongside the existing Express MCP server. Verify the Inngest dev UI shows registered functions and the server connects to the existing Postgres instance.

## Implementation Command

```bash
spec-kitty implement WP01
```

## Subtasks

- [ ] T001: Add `inngest` npm package to `joyus-ai-mcp-server` (`npm install inngest`)
- [ ] T002: Create `docker-compose.inngest.yml` — Inngest server + Redis, pointing to existing Postgres
- [ ] T003: Create `src/inngest/client.ts` — configure Inngest client for self-hosted server URL
- [ ] T004: Register stub Inngest function in Express server via `serve()` adapter at `/api/inngest`
- [ ] T005: Confirm Inngest dev UI shows the registered stub function; document setup steps in `research/inngest-setup.md`

## Activity Log

- 2026-03-19T02:03:33Z – claude – shell_pid=57375 – lane=doing – Started implementation via workflow command
- 2026-03-19T02:22:18Z – claude – shell_pid=57375 – lane=for_review – Environment setup complete: docker-compose overlay, Inngest client (v3 EventSchemas API), stub function, serve() adapter at /api/inngest, research/inngest-setup.md. Typecheck passes.
- 2026-03-19T02:33:03Z – claude-sonnet – shell_pid=40083 – lane=doing – Started review via workflow command
- 2026-03-19T02:49:47Z – claude-sonnet – shell_pid=40083 – lane=done – Review passed: all 5 subtasks satisfied, typecheck clean, no hardcoded secrets. Fixed MEDIUM: docker-compose now uses ${VAR:-default} interpolation for Inngest keys.
