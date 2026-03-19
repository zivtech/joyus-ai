---
work_package_id: "WP01"
title: "Local Inngest Server Setup"
lane: "planned"
dependencies: []
subtasks: ["T001", "T002", "T003", "T004", "T005"]
phase: "Phase A - Environment"
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
