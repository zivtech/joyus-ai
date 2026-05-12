# Work Packages: Platform Core Orchestrator

**Mission:** platform-core-orchestrator-01KREQVK
**Date:** 2026-05-12
**Total:** 8 work packages, 52 subtasks
**Target repo:** `joyus-ai` → `joyus-ai-mcp-server/`

## Dependency Graph

```
Layer 0: WP00 (spike — blocks all)
Layer 1: WP01 (session + tenant foundation)
Layer 2: WP02, WP03 (parallel — agent loop, events)
Layer 3: WP04, WP05, WP06, WP07 (after WP02/WP03)
```

```
WP00 (spike)
  │
  ▼
WP01 (sessions + tenancy + durability)
  │
  ├──▶ WP02 (agent loop + memory)
  │      ├──▶ WP05 (tools + skills)
  │      ├──▶ WP07 (safety + cost)
  │      └──▶ WP06 (API, also needs WP03)
  │
  ├──▶ WP03 (events)
  │      └──▶ WP04 (coordination, also needs WP01)
  │
  └─────────▶ WP04
```

## Subtask Index

| ID | Description | WP | Parallel |
|----|-------------|-----|---------|
| T001 | Set up spike project directory | WP00 | | [D] |
| T002 | Test Mastra + Inngest step.run() composition | WP00 | [D] |
| T003 | Test multi-step agent loop across Inngest boundaries | WP00 | [D] |
| T004 | Test Mastra MCP client with existing tools | WP00 | [D] |
| T005 | Test tenant isolation in agent/tool context | WP00 | [D] |
| T006 | Measure token overhead: Mastra vs raw Claude API | WP00 | [D] |
| T007 | Evaluate Python↔TypeScript SDK boundary | WP00 | [D] |
| T008 | Write architecture decision document | WP00 | | [D] |
| T009 | Add orchestrator tables to Drizzle schema | WP01 | |
| T010 | Create database migration for orchestrator tables | WP01 | |
| T011 | Implement session service | WP01 | |
| T012 | Implement tenant scoping middleware | WP01 | [P] |
| T013 | Create Inngest session-run function | WP01 | |
| T014 | Implement crash recovery via Inngest checkpoints | WP01 | |
| T015 | Add per-tenant concurrency controls | WP01 | |
| T016 | Implement agent loop service | WP02 | |
| T017 | Integrate Claude Agent SDK | WP02 | |
| T018 | Implement SSE response streaming | WP02 | [P] |
| T019 | Implement turn persistence | WP02 | |
| T020 | Implement sliding window conversation memory | WP02 | |
| T021 | Add context window utilization monitoring | WP02 | |
| T022 | Add events table to Drizzle schema | WP03 | |
| T023 | Create database migration for events table | WP03 | |
| T024 | Implement typed event registry | WP03 | |
| T025 | Implement event emission service | WP03 | |
| T026 | Implement SSE streaming for external consumers | WP03 | |
| T027 | Implement notification routing to gateway | WP03 | |
| T028 | Add coordination tables to Drizzle schema | WP04 | |
| T029 | Create database migration for coordination tables | WP04 | |
| T030 | Implement work unit service | WP04 | |
| T031 | Implement coordination group service | WP04 | |
| T032 | Implement inter-agent messaging via Inngest events | WP04 | |
| T033 | Create Inngest coordination lifecycle function | WP04 | |
| T034 | Implement tool router service | WP05 | |
| T035 | Implement tool dispatch and result marshaling | WP05 | |
| T036 | Implement tool permission filtering | WP05 | |
| T037 | Implement tool failure handling and retry | WP05 | |
| T038 | Implement skill loader service | WP05 | [P] |
| T039 | Implement skill injection with token budget | WP05 | [P] |
| T040 | Implement Constitution injection | WP05 | [P] |
| T041 | Create Express router for orchestrator | WP06 | |
| T042 | Implement session API endpoints | WP06 | |
| T043 | Implement message endpoint with SSE | WP06 | |
| T044 | Implement event subscription endpoints | WP06 | |
| T045 | Implement coordination API endpoints | WP06 | |
| T046 | Add Zod schemas and OpenAPI generation | WP06 | |
| T047 | Add CI schema drift detection | WP06 | |
| T048 | Implement safety hook interface | WP07 | |
| T049 | Implement hook audit logging | WP07 | |
| T050 | Implement token accounting events | WP07 | |
| T051 | Implement per-session cost accumulation | WP07 | |
| T052 | Implement idle gap detection | WP07 | |

---

## WP00 — Architecture Spike: Mastra + SDK Boundary

**Priority:** P0 (blocks everything)
**Dependencies:** None
**FRs:** Decision gate for FR-001 through FR-007
**Estimated prompt:** ~400 lines
**Prompt:** [WP00-architecture-spike.md](tasks/WP00-architecture-spike.md)

- [x] T001 Set up spike project directory in joyus-ai-mcp-server/spike/orchestrator (WP00)
- [x] T002 Test Mastra agent invocation inside Inngest step.run() — single-shot and multi-step (WP00)
- [x] T003 Test multi-step agent loop across Inngest step boundaries with tool use (WP00)
- [x] T004 Test Mastra MCP client connecting to existing MCP server tools (WP00)
- [x] T005 Test tenant isolation: tenantId in agent/tool context without global state (WP00)
- [x] T006 Measure token overhead: Mastra agent loop vs raw Claude API calls (WP00)
- [x] T007 Evaluate Python↔TypeScript boundary: subprocess vs sidecar latency (WP00)
- [x] T008 Write architecture decision document with pass/fail results and recommendation (WP00)

**Parallel opportunities:** T002-T007 are independent experiments; can run in parallel.
**Risks:** Mastra may not compose cleanly with Inngest; fallback is custom TypeScript layer.

---

## WP01 — Session & Tenant Foundation

**Priority:** P1 (foundation — blocks WP02-WP07)
**Dependencies:** WP00
**FRs:** FR-001, FR-005, FR-006
**Estimated prompt:** ~350 lines
**Prompt:** [WP01-session-tenant-foundation.md](tasks/WP01-session-tenant-foundation.md)

- [ ] T009 Add sessions and turns tables to Drizzle schema (WP01)
- [ ] T010 Create database migration for orchestrator tables (WP01)
- [ ] T011 Implement session service: create, get, updateStatus, list (tenant-scoped) (WP01)
- [ ] T012 Implement tenant scoping middleware: extract tenantId from JWT, enforce on queries (WP01)
- [ ] T013 Create Inngest session-run function: session lifecycle as durable function (WP01)
- [ ] T014 Implement crash recovery: checkpoint-resume via Inngest step boundaries (WP01)
- [ ] T015 Add per-tenant concurrency controls via Inngest concurrency config (WP01)

**Parallel opportunities:** T012 (middleware) is independent of T009-T011 (schema + service).
**Risks:** Inngest checkpoint granularity may not align with desired session recovery points.

---

## WP02 — Agent Loop & Streaming

**Priority:** P1
**Dependencies:** WP01
**FRs:** FR-002, FR-010
**Estimated prompt:** ~350 lines
**Prompt:** [WP02-agent-loop-streaming.md](tasks/WP02-agent-loop-streaming.md)

- [ ] T016 Implement agent loop service: message → context assembly → invoke → tool routing → stream (WP02)
- [ ] T017 Integrate Claude Agent SDK (subprocess or sidecar per WP00 decision) (WP02)
- [ ] T018 Implement SSE response streaming to client (WP02)
- [ ] T019 Implement turn persistence: save each turn to DB after completion (WP02)
- [ ] T020 Implement sliding window conversation memory (WP02)
- [ ] T021 Add context window utilization monitoring (instrument, don't act) (WP02)

**Parallel opportunities:** T018 (SSE streaming) can be developed independently as transport layer.
**Risks:** Python↔TypeScript boundary latency; fallback to custom agent loop with raw Claude API.

---

## WP03 — Event System & Notification Routing

**Priority:** P1
**Dependencies:** WP01
**FRs:** FR-004, FR-013
**Estimated prompt:** ~300 lines
**Prompt:** [WP03-event-system.md](tasks/WP03-event-system.md)

- [ ] T022 Add events table to Drizzle schema (append-only, sequence-indexed) (WP03)
- [ ] T023 Create database migration for events table (WP03)
- [ ] T024 Implement typed event registry: register event types with JSON schemas (WP03)
- [ ] T025 Implement event emission service: emit, query by filters, replay from offset (WP03)
- [ ] T026 Implement SSE streaming endpoint for external consumers (filtered by session/tenant/type) (WP03)
- [ ] T027 Implement notification routing: forward eligible events to gateway event bus (WP03)

**Parallel opportunities:** T026 (SSE endpoint) and T027 (routing) are independent of T024-T025.
**Can run in parallel with WP02.**

---

## WP04 — Multi-Agent Coordination

**Priority:** P2
**Dependencies:** WP01, WP03
**FRs:** FR-003
**Estimated prompt:** ~300 lines
**Prompt:** [WP04-multi-agent-coordination.md](tasks/WP04-multi-agent-coordination.md)

- [ ] T028 Add work_units and coordination_groups tables to Drizzle schema (WP04)
- [ ] T029 Create database migration for coordination tables (WP04)
- [ ] T030 Implement work unit service: create, update, query, dependency enforcement (WP04)
- [ ] T031 Implement coordination group service: create, completion policy evaluation (WP04)
- [ ] T032 Implement inter-agent messaging via Inngest events (signals pattern) (WP04)
- [ ] T033 Create Inngest coordination lifecycle function (WP04)

**Parallel opportunities:** T030-T031 (services) and T032-T033 (Inngest) are independent tracks.
**Risks:** Dependency cycle detection adds complexity; keep simple (topological sort).

---

## WP05 — Tool Routing & Skill Application

**Priority:** P1
**Dependencies:** WP02
**FRs:** FR-008, FR-009
**Estimated prompt:** ~400 lines
**Prompt:** [WP05-tool-routing-skills.md](tasks/WP05-tool-routing-skills.md)

- [ ] T034 Implement tool router service: discover tools from MCP Gateway or direct MCP servers (WP05)
- [ ] T035 Implement tool dispatch: route tool_use calls to correct backend, marshal results (WP05)
- [ ] T036 Implement tool permission filtering: present only tenant-authorized tools (WP05)
- [ ] T037 Implement tool failure handling: structured errors, transient retry, circuit breaker (WP05)
- [ ] T038 Implement skill loader service: resolve tenant/role/task skills from Spec 013 or filesystem stub (WP05)
- [ ] T039 Implement skill injection: compose into system prompt with token budget awareness (WP05)
- [ ] T040 Implement Constitution injection: load and prepend Constitution rules (WP05)

**Parallel opportunities:** T034-T037 (tool routing) and T038-T040 (skill loading) are independent tracks.
**Risks:** Spec 013 and Spec 014 not ready — must work with filesystem stubs initially.

---

## WP06 — Typed HTTP API

**Priority:** P1
**Dependencies:** WP02, WP03
**FRs:** FR-007
**Estimated prompt:** ~380 lines
**Prompt:** [WP06-typed-http-api.md](tasks/WP06-typed-http-api.md)

- [ ] T041 Create Express router and mount orchestrator endpoints (WP06)
- [ ] T042 Implement session API endpoints: create, get, update, list with pagination (WP06)
- [ ] T043 Implement message endpoint: POST with SSE response stream (WP06)
- [ ] T044 Implement event subscription endpoints: session-level and tenant-level SSE (WP06)
- [ ] T045 Implement work unit and coordination group CRUD endpoints (WP06)
- [ ] T046 Add Zod schemas for all request/response types and generate OpenAPI (WP06)
- [ ] T047 Add CI schema drift detection: validate OpenAPI matches Zod schemas in build (WP06)

**Parallel opportunities:** T042-T045 (endpoint groups) are independent.
**Risks:** OpenAPI generation from Zod requires choosing a library (zod-to-openapi or similar).

---

## WP07 — Safety & Cost Integration

**Priority:** P2
**Dependencies:** WP02
**FRs:** FR-011, FR-012
**Estimated prompt:** ~260 lines
**Prompt:** [WP07-safety-cost-integration.md](tasks/WP07-safety-cost-integration.md)

- [ ] T048 Implement safety service: pre/post-generation hook interface (WP07)
- [ ] T049 Implement hook audit logging: record invocations and outcomes (WP07)
- [ ] T050 Implement token accounting: emit usage events on every model invocation (WP07)
- [ ] T051 Implement per-session cost accumulation: queryable via session API (WP07)
- [ ] T052 Implement idle gap detection: flag sessions consuming tokens without interaction (WP07)

**Parallel opportunities:** T048-T049 (safety) and T050-T052 (cost) are independent tracks.
**Can run in parallel with WP05.**

---

*Tasks created: 2026-05-12*
*For: Joyus AI Platform — Core Orchestrator*
*Next: `/spec-kitty.implement` or `/spec-kitty-implement-review` for execution*
