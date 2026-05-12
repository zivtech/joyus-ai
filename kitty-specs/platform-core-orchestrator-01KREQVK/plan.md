# Implementation Plan: Platform Core Orchestrator

**Branch**: `claude/platform-core-orchestrator` | **Date**: 2026-05-12 | **Spec**: [spec.md](spec.md)
**Input**: Feature specification from `kitty-specs/platform-core-orchestrator-01KREQVK/spec.md`
**Target repo**: `joyus-ai` → `joyus-ai-mcp-server/`

## Summary

Build the core orchestration layer for the Joyus AI platform as a new module within the existing MCP server codebase. The orchestrator manages agent session lifecycle, multi-agent coordination, durable execution via Inngest, event streaming, and multi-tenant isolation. Architecture is composition-based: Inngest (already adopted) handles durable execution, a custom TypeScript agent semantics layer (or Mastra, if the spike passes) handles session/coordination/API, and the Claude Agent SDK handles agent loops.

## Technical Context

**Language/Version**: TypeScript 5.3+, Node.js ≥20.0.0
**Primary Dependencies**: Express 4.x, Drizzle ORM 0.45+, Inngest SDK (Apache-2.0), @modelcontextprotocol/sdk 1.x, Zod (schema validation + OpenAPI generation)
**Storage**: PostgreSQL (existing instance, extend schema)
**Testing**: Vitest 1.x (unit + integration)
**Target Platform**: Linux server (Docker), macOS development
**Performance Goals**: <200ms orchestrator overhead per request (NFR-001); ≥100 concurrent sessions per instance (NFR-003)
**Constraints**: Multi-tenant from day one (C-006); Inngest for all durable execution (C-002); thin orchestration principle (C-003)
**Conditional dependency**: Mastra v1.32 — adopted only if WP00 spike passes all four thresholds

## Charter Check

*No charter file found. Skipped. Constitution principles verified in spec.*

## Project Structure

### Documentation (this feature)

```
kitty-specs/platform-core-orchestrator-01KREQVK/
├── spec.md              # Feature specification
├── plan.md              # This file
├── research.md          # Phase 0 research output
├── data-model.md        # Phase 1 data model
├── quickstart.md        # Phase 1 developer quickstart
├── contracts/
│   └── api.yaml         # OpenAPI 3.1 contract
├── checklists/
│   └── requirements.md  # Spec quality checklist
└── tasks.md             # Phase 2 output (created by /spec-kitty.tasks)
```

### Source Code (joyus-ai-mcp-server)

```
joyus-ai-mcp-server/src/
├── orchestrator/                  # NEW — all orchestrator code
│   ├── index.ts                   # Module entry, Express router mount
│   ├── types.ts                   # Shared types, Zod schemas, event registry
│   ├── session.service.ts         # Session lifecycle (FR-001)
│   ├── agent-loop.service.ts      # Agent loop execution (FR-002)
│   ├── coordination.service.ts    # Work units & groups (FR-003)
│   ├── event.service.ts           # Event system + SSE streaming (FR-004)
│   ├── tool-router.service.ts     # Tool discovery & routing (FR-008)
│   ├── skill-loader.service.ts    # Skill resolution & injection (FR-009)
│   ├── memory.service.ts          # Conversation memory (FR-010)
│   ├── safety.service.ts          # Pre/post-generation hooks (FR-011)
│   ├── usage.service.ts           # Token accounting events (FR-012)
│   ├── notification.service.ts    # Event routing to gateway (FR-013)
│   └── middleware/
│       └── tenant.ts              # Tenant scoping middleware (FR-006)
├── db/
│   └── schema.ts                  # EXTEND with orchestrator tables
├── inngest/
│   └── functions/
│       └── orchestrator/          # NEW — Inngest function definitions
│           ├── session-run.ts     # Session as durable function
│           └── coordination.ts    # Work unit lifecycle
├── auth/                          # EXISTING — tenant context extraction
├── tools/                         # EXISTING — tool executors
└── pipelines/                     # EXISTING — pattern reference

joyus-ai-mcp-server/spike/        # NEW — WP00 spike code (temporary)
└── orchestrator/
    ├── mastra-inngest.test.ts     # Mastra + Inngest composition test
    ├── tenant-isolation.test.ts   # Tenant scoping test
    └── sdk-boundary.test.ts       # Python↔TS boundary test
```

**Structure Decision**: The orchestrator is a new module within the existing MCP server, not a separate service. This leverages existing Inngest, DB, and auth infrastructure without adding deployment complexity.

## Work Packages

### WP00 — Architecture Spike: Mastra + SDK Boundary (2 days)

**Priority**: P0 (blocks all other WPs)
**Dependencies**: None
**FRs covered**: Decision gate for FR-001 through FR-007
**Deliverables**:
- Mastra + Inngest composition test (Q1 from decision gate)
- MCP client compatibility test (Q2)
- Tenant isolation test (Q3)
- Token overhead measurement (Q4)
- Python↔TypeScript boundary evaluation (OQ-1)
- Architecture decision document

**Decision output**: "Adopt Mastra" or "Build custom" — determines implementation approach for WP01-WP06.

### WP01 — Session & Tenant Foundation (5-7 days)

**Priority**: P1 (foundation — blocks WP02-WP06)
**Dependencies**: WP00
**FRs covered**: FR-001 (Session Lifecycle), FR-005 (Durable Execution), FR-006 (Multi-Tenant Isolation)
**Scope**:
- Drizzle schema: sessions, turns, events tables (from data-model.md)
- Session service: create, get, update status, list (tenant-scoped)
- Tenant scoping middleware: extract tenantId from JWT, enforce on all queries
- Inngest function: session-run (session lifecycle as durable function)
- Crash recovery: checkpoint-resume via Inngest step boundaries
- Per-tenant concurrency controls via Inngest concurrency config

### WP02 — Agent Loop & Streaming (5-8 days)

**Priority**: P1
**Dependencies**: WP01
**FRs covered**: FR-002 (Agent Loop), FR-010 (Conversation Memory)
**Scope**:
- Agent loop service: message → context assembly → invoke → tool routing → stream response
- Claude Agent SDK integration (subprocess or sidecar, per WP00 decision)
- SSE response streaming
- Turn persistence (save each turn to DB)
- Conversation memory: sliding window strategy (start simple)
- Context window monitoring (instrument utilization, no summarization yet)

### WP03 — Event System (3-5 days)

**Priority**: P1
**Dependencies**: WP01
**FRs covered**: FR-004 (Event System), FR-013 (Notification Routing)
**Scope**:
- Event service: typed event registry, emit, query
- Drizzle schema: events table (append-only)
- SSE streaming endpoint for external consumers (filtered by session/tenant/type)
- Event replay from sequence offset
- Notification routing: forward eligible events to gateway event bus (Spec 014)

**Can run in parallel with WP02.**

### WP04 — Multi-Agent Coordination (4-6 days)

**Priority**: P2
**Dependencies**: WP01, WP03
**FRs covered**: FR-003 (Multi-Agent Coordination)
**Scope**:
- Drizzle schema: work_units, coordination_groups tables
- Work unit service: create, update, query, dependency tracking
- Coordination group service: create, completion policy evaluation
- Inter-agent messaging via Inngest events (signals pattern)
- Inngest function: coordination lifecycle

### WP05 — Tool Routing & Skill Application (5-7 days)

**Priority**: P1
**Dependencies**: WP02
**FRs covered**: FR-008 (Tool Routing), FR-009 (Skill Application)
**Scope**:
- Tool router service: discover tools from MCP Gateway (or direct MCP servers as stub)
- Tool dispatch: route tool_use calls, marshal results
- Permission filtering: present only tenant-authorized tools
- Tool failure handling: structured error results to agent
- Skill loader service: resolve tenant/role/task skills from Spec 013 (or filesystem stub)
- Skill injection: compose into system prompt with token budget awareness
- Constitution injection: load and prepend Constitution rules

### WP06 — Typed HTTP API (4-6 days)

**Priority**: P1
**Dependencies**: WP01, WP02, WP03
**FRs covered**: FR-007 (Typed HTTP API)
**Scope**:
- Express router: all endpoints from contracts/api.yaml
- Zod schemas for request/response validation
- OpenAPI generation from Zod schemas (typed-wire principle)
- CI validation: schema drift detection
- Cursor-based pagination for list endpoints

### WP07 — Safety & Cost Integration (3-4 days)

**Priority**: P2
**Dependencies**: WP02
**FRs covered**: FR-011 (Safety Integration), FR-012 (Cost & Usage Integration)
**Scope**:
- Safety service: pre/post-generation hook interface
- Constitution injection (if not already in WP05)
- Hook audit logging
- Usage service: token accounting event emission
- Per-session cost accumulation (queryable)
- Idle gap detection: flag sessions consuming tokens without user interaction

## Dependency Graph

```
WP00 (spike — 2 days, blocks everything)
  │
  ▼
WP01 (sessions + tenancy + durability — 5-7 days, foundation)
  │
  ├──▶ WP02 (agent loop + memory — 5-8 days)
  │      │
  │      ├──▶ WP05 (tools + skills — 5-7 days)
  │      │
  │      ├──▶ WP07 (safety + cost — 3-4 days)
  │      │
  │      └──▶ WP06 (API — 4-6 days, also needs WP03)
  │
  ├──▶ WP03 (events — 3-5 days, parallel with WP02)
  │      │
  │      └──▶ WP04 (coordination — 4-6 days, also needs WP01)
  │
  └──────────▶ WP04 (also depends on WP01)
```

**Parallel lanes after WP01:**
- Lane A: WP02 → WP05 → WP07
- Lane B: WP03 → WP04
- WP06 joins after WP02 + WP03 complete

**Total estimated duration**: 31-45 days sequential; 20-28 days with parallelism.

## Risks

| Risk | Likelihood | Impact | Mitigation |
|------|-----------|--------|------------|
| Mastra spike fails — custom build required | Medium | Medium | Custom build uses borrowed patterns (Gas City, Temporal, Julep) — not starting from zero |
| Claude Agent SDK Python boundary adds unacceptable latency | Medium | High | WP00 evaluates; fallback to custom TypeScript agent loop using raw Claude API |
| Skills System (Spec 013) not ready | High | Medium | Stub with filesystem-based skill loading; real integration is a swap |
| MCP Gateway (Spec 014) not ready | High | Medium | Route directly to MCP servers; gateway integration is a routing change |
| Sliding window memory degrades on long conversations | Medium | Low | Instrumented from day one; summarization tier added when data shows need |
| Inngest step boundaries don't align with agent loop checkpoints | Low | High | WP00 spike specifically tests multi-step agent loops across Inngest boundaries |

## Complexity Tracking

No charter violations identified. Architecture follows Constitution principles (multi-tenant from day one, sandbox by default, monitor everything, mediated AI access, thin orchestration).

---

**Branch contract (repeated):**
- Current branch: `claude/platform-core-orchestrator`
- Planning/base branch: `claude/platform-core-orchestrator`
- Merge target: `claude/platform-core-orchestrator` (reaches `main` via PR)

---

*Plan created: 2026-05-12*
*For: Joyus AI Platform — Core Orchestrator*
*Next: `/spec-kitty.tasks` to generate work packages*
