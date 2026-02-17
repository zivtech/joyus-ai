# Implementation Plan: Session & Context Management

**Branch**: `002-session-context-management` | **Date**: 2026-02-16 | **Revised**: 2026-02-16 | **Spec**: [spec.md](./spec.md)
**Input**: Feature specification from `kitty-specs/002-session-context-management/spec.md`

## Summary

Build the session state management layer for jawn-ai — an invisible mediator that enables AI coding agents to maintain awareness of active work across sessions, compactions, and crashes. The user never interacts with jawn-ai directly; Claude is the UI. The system captures structured snapshots on significant events, provides MCP tools that Claude calls to stay oriented, and manages canonical document routing — all invisible to the end user.

**Deployment model**: MCP server + companion service. The user's maximum setup effort is adding the MCP server to Claude Desktop/Code and running the companion app.

**What changed (2026-02-16 revision):**
- Architecture reframed from CLI+hooks to MCP-first + companion service
- Target user reframed from developers to non-technical staff (Claude is the UI)
- Spec 3 (Observability) eliminated — covered by Claude Enterprise
- Adapter pattern deferred (YAGNI — build Claude Code path only)
- CLI deprioritized (admin tool, built after MCP server)
- See `research/existing-projects-landscape.md` sections 9-10 for full analysis

## Technical Context

**Language/Version**: TypeScript 5.3+ / Node.js 20+
**Primary Dependencies**: `@modelcontextprotocol/sdk` (MCP server), `zod` (schema validation)
**Secondary Dependencies** (deferred): `commander` (CLI, built after MCP server)
**Storage**: JSON files on local filesystem (per-developer, gitignored). `~/.jawn-ai/projects/<project-hash>/` for state, `.jawn-ai/config.json` in project root for canonical declarations and settings.
**Testing**: Vitest (matches existing `jawn-ai-mcp-server` setup)
**Target Platform**: macOS (primary), Linux, Windows via WSL2
**Project Type**: Two components — MCP server (primary) + companion service (background state capture)
**Performance Goals**: Snapshot capture <100ms (non-blocking); MCP tool response <500ms; state restore <500ms at session start
**Constraints**: Must work offline (no network required). Must not interfere with existing Claude Code hooks. Snapshot files 2-10KB each. User never runs CLI commands — Claude calls MCP tools.
**Scale/Scope**: Single developer per state store. 50-100 snapshots per week of active work. <5MB typical storage.

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| Principle | Status | Notes |
|-----------|--------|-------|
| Multi-Tenant from Day One | PASS | State is per-developer, per-project. Multi-tenant isolation is inherent — each developer's state is private by default. Share action is explicit. |
| Skills as Guardrails | N/A | Skills enforcement is Spec 2. This spec provides the state infrastructure that skills enforcement will build on. |
| Sandbox by Default | PASS | Per-developer storage is sandboxed. Sharing requires explicit action with a note. No data leaks between developers by default. |
| Monitor Everything | PASS | Claude Enterprise handles observability (OpenTelemetry, audit logs, Compliance API). State files are structured and queryable via MCP tools. |
| Feedback Loops | PASS | State snapshots capture decisions and reasoning, enabling feedback loop analysis. |
| Spec-Driven Development | PASS | Using spec-kitty. |
| Technology Choices | PASS | TypeScript/Node.js matches existing MCP server. File-based storage aligns with "file-based + version control" principle. JSON is auditable and git-friendly. |
| Cost Awareness | PASS | Event-driven snapshots are efficient (no continuous writes). MCP server is lightweight. No API calls or token usage for state management. Enterprise handles cost tracking. |
| Checkpoint/Recovery | PASS | This IS the checkpoint/recovery system. Every snapshot is a recovery point. |

**No violations. Gate passed.**

## Project Structure

### Documentation (this feature)

```
kitty-specs/002-session-context-management/
├── plan.md              # This file
├── research.md          # Phase 0 output
├── data-model.md        # Phase 1 output
├── quickstart.md        # Phase 1 output
├── contracts/           # Phase 1 output
│   └── mcp-tools.md     # MCP tool API contract (primary interface)
└── tasks.md             # Phase 2 output (NOT created by /spec-kitty.plan)
```

### Source Code (repository root)

```
jawn-ai-state/
├── package.json
├── tsconfig.json
├── src/
│   ├── index.ts                 # Package entry point & exports
│   ├── core/
│   │   ├── types.ts             # Snapshot, CanonicalDeclaration, Config types
│   │   ├── snapshot.ts          # Snapshot creation, serialization, validation
│   │   ├── schema.ts            # Zod schemas for snapshot format validation
│   │   └── config.ts            # Configuration loading, defaults, merging
│   ├── state/
│   │   ├── store.ts             # Read/write snapshots to disk (atomic writes)
│   │   ├── canonical.ts         # Canonical document declaration CRUD
│   │   ├── divergence.ts        # Detect state vs actual project divergence
│   │   └── share.ts             # Share state with teammate (export/import)
│   ├── collectors/
│   │   ├── git.ts               # Collect git state (branch, status, diff summary)
│   │   ├── tests.ts             # Collect test results (parse output)
│   │   ├── files.ts             # Collect modified files list
│   │   └── decisions.ts         # Track pending decisions incrementally
│   ├── mcp/                     # PRIMARY INTERFACE — what Claude calls
│   │   ├── server.ts            # Local MCP server setup
│   │   └── tools/
│   │       ├── get-context.ts   # Get current session context (branch, files, tests, decisions)
│   │       ├── save-state.ts    # Capture a state snapshot now
│   │       ├── check-canonical.ts # Check/declare canonical doc sources
│   │       ├── verify-action.ts # Pre-action guardrail (branch check, etc.)
│   │       └── share-state.ts   # Share/load state with teammate + note
│   └── service/                 # COMPANION SERVICE — background state capture
│       ├── daemon.ts            # Service entry point (runs alongside MCP server)
│       ├── watcher.ts           # Filesystem/git event monitoring
│       └── event-handler.ts     # Routes events to snapshot capture
├── tests/
│   ├── unit/
│   │   ├── snapshot.test.ts
│   │   ├── store.test.ts
│   │   ├── canonical.test.ts
│   │   ├── divergence.test.ts
│   │   └── collectors.test.ts
│   ├── integration/
│   │   ├── mcp-tools.test.ts    # MCP tool integration tests (primary)
│   │   └── service.test.ts      # Companion service integration tests
│   └── contract/
│       └── snapshot-schema.test.ts
└── bin/
    ├── jawn-ai-mcp              # MCP server entry point
    └── jawn-ai-service          # Companion service entry point
```

**What was removed from the original plan:**
- `cli/` directory — CLI is deferred. Admin CLI will be added later as a secondary interface.
- `adapters/` directory — Adapter pattern deferred (YAGNI). Only Claude Code path for now.
- `hooks/` directory — Hook generation deferred. Companion service handles event capture; hooks are optional for power users.
- `retention.ts` — Deferred. Snapshots are 2-10KB; storage isn't a problem yet.

**What was added:**
- `service/` directory — Companion service for background state capture and event monitoring.
- `mcp/tools/save-state.ts` — Claude can explicitly trigger state capture (not just hooks).
- `mcp/tools/verify-action.ts` — Pre-action guardrail (lays groundwork for Spec 2 quality gates).

**Structure Decision**: New `jawn-ai-state/` package at repo root, alongside existing `jawn-ai-mcp-server/`. They share the same TypeScript/Vitest toolchain but are independent packages. The session state system runs locally (MCP server + companion service); the existing MCP server runs remotely. Future integration (e.g., syncing shared state to the remote server) is deferred.

## Architecture

### MCP-First Runtime

```
┌──────────────────────────────────────────────────────────────┐
│                      Developer Machine                        │
│                                                               │
│  ┌──────────────────┐    ┌─────────────────────────────────┐ │
│  │ Claude Desktop    │    │  jawn-ai-state                  │ │
│  │ or Claude Code    │    │                                 │ │
│  │                   │    │  ┌─────────────┐  ┌──────────┐ │ │
│  │  User talks to    │◄──▶│  │ MCP Server  │  │Companion │ │ │
│  │  Claude. Claude   │MCP │  │ (tools for  │  │ Service  │ │ │
│  │  calls MCP tools. │    │  │  Claude to  │  │(bg state │ │ │
│  │                   │    │  │  call)      │  │ capture) │ │ │
│  └──────────────────┘    │  └──────┬──────┘  └────┬─────┘ │ │
│                           │         │              │        │ │
│                           │         ▼              ▼        │ │
│                           │  ┌──────────────────────────┐   │ │
│                           │  │     State Store           │   │ │
│                           │  │     ~/.jawn-ai/           │   │ │
│                           │  │     projects/<hash>/      │   │ │
│                           │  │     ├── snapshots/        │   │ │
│                           │  │     ├── shared/           │   │ │
│                           │  │     └── config.json       │   │ │
│                           │  └──────────────────────────┘   │ │
│                           └─────────────────────────────────┘ │
│                                                               │
│  ┌─────────────────────────────────────────────────────────┐  │
│  │ Optional (Tier 2 power users only):                      │  │
│  │ Claude Code hooks → call companion service endpoints     │  │
│  │ Admin CLI → direct state inspection and configuration    │  │
│  └─────────────────────────────────────────────────────────┘  │
└──────────────────────────────────────────────────────────────┘
```

**Key difference from original plan**: The MCP server is the primary interface, not the CLI. The user never runs commands. Claude calls `get_context`, `save_state`, `check_canonical`, `verify_action`, and `share_state` as MCP tools. The companion service runs in the background capturing state on events.

### Event Flow

**Primary path (all users):**
1. **Companion service watches** for significant events (git commits, branch switches, test runs, file changes)
2. **Service captures snapshot** atomically to `~/.jawn-ai/projects/<hash>/snapshots/<timestamp>.json`
3. **Claude starts new session** → calls `get_context` MCP tool → receives structured state
4. **Claude presents summary** to user in natural language ("You were working on branch X, 3 files modified, 2 tests failing")
5. **User says "continue"** → Claude has full context, resumes work
6. **During session**, Claude can call `save_state` after significant actions, `check_canonical` before file operations, `verify_action` before risky git operations

**Optional path (Tier 2 power users):**
1. **Claude Code hooks** fire on events → notify companion service (tighter integration)
2. **Admin CLI** available for direct state inspection, config management, debugging

### MCP Tools (Primary Interface)

| Tool | Purpose | When Claude Calls It |
|------|---------|---------------------|
| `get_context` | Return current working state (last snapshot + live git status) | Session start, after "continue", after compaction |
| `save_state` | Capture a state snapshot with optional event type and notes | After significant actions (commit, test run, branch switch) |
| `check_canonical` | Verify a file path against canonical declarations; declare new canonical sources | Before reading/writing files that might have duplicates |
| `verify_action` | Pre-action check (branch verification, etc.) | Before commits, pushes, or other risky git operations |
| `share_state` | Export current state with a note for a teammate, or load a teammate's shared state | When user asks for help or loads shared context |

### Storage Layout

```
~/.jawn-ai/
├── global-config.json           # User-wide defaults
└── projects/
    └── <project-hash>/          # SHA256 of project root path
        ├── config.json          # Project-specific overrides
        ├── canonical.json       # Canonical document declarations
        ├── snapshots/
        │   ├── 2026-02-16T14-30-00.json
        │   ├── 2026-02-16T14-35-22.json
        │   └── ...
        └── shared/
            ├── incoming/        # Shared states received from teammates
            └── outgoing/        # Shared states exported for teammates

.jawn-ai/                        # In project root (gitignored)
├── config.json                  # Project config (committed or gitignored per preference)
└── canonical.json               # Canonical declarations (committed — shared across team)
```

**Key decision**: `canonical.json` lives in the project root `.jawn-ai/` directory and IS committed to git (canonical declarations are team-shared). Snapshot state lives in `~/.jawn-ai/` (per-developer, never committed).

### Companion Service (Background State Capture)

The companion service is a locally-running daemon that handles event-driven state capture — the things the MCP request/response protocol can't do (long-running processes, filesystem watchers, proactive snapshot capture).

**Entry point**: `bin/jawn-ai-service` → `src/service/daemon.ts`

**Responsibilities**:
1. **Filesystem watching** (`src/service/watcher.ts`): Monitor the project directory for significant events using `fs.watch` or `chokidar`. Detect git operations (new commits, branch switches) by watching `.git/HEAD`, `.git/refs/`, and the git index. Detect test runs by watching for test output files or process events.
2. **Event routing** (`src/service/event-handler.ts`): Classify detected events into `EventType` values and route to snapshot capture. Debounce rapid events (e.g., multiple file saves within 1 second = one snapshot, not ten).
3. **Snapshot capture**: Call the same core snapshot logic (collectors + store) that MCP tools use. Write snapshots atomically. Never block — if capture fails, log and continue.
4. **Health/status endpoint**: Expose a simple local IPC mechanism (unix socket or HTTP on localhost) so the MCP server can check if the companion service is running and request immediate snapshot capture.

**Lifecycle**:
- Started by the user running `npx jawn-ai-service` (or via a system service manager)
- Runs in the foreground by default (background via `&` or system service)
- Graceful shutdown on SIGTERM/SIGINT
- Writes a PID file to `~/.jawn-ai/projects/<hash>/service.pid` for the MCP server to detect
- If the companion service is NOT running, the MCP server still works — Claude can still call `save_state` explicitly, and `get_context` still returns live git state. The service adds automatic event capture, not core functionality.

**Event detection strategy**:

| Event | Detection Method | Debounce |
|-------|-----------------|----------|
| Git commit | Watch `.git/refs/heads/<branch>` for changes | 500ms |
| Branch switch | Watch `.git/HEAD` for changes | 500ms |
| Test run | Watch for known test output patterns (jest, vitest, phpunit, pytest) | 2s |
| File change | Watch project files (respecting `.gitignore`) | 5s |
| Session events | Receive notification from MCP server via IPC | None |

**MCP server ↔ Companion service communication**:
- The MCP server checks for the companion service PID file on startup
- If running, the MCP server can send IPC messages to request immediate snapshot capture
- If not running, the MCP server operates independently (degraded but functional)
- The companion service does NOT depend on the MCP server — it captures snapshots regardless

**Performance constraints**: Event detection must be non-blocking. Snapshot capture must complete in <100ms. File watching must not consume >1% CPU during idle periods.

## Deferred Items

Items from the original plan that are explicitly deferred after the architecture reframing:

| Item | Why Deferred | When to Build |
|------|-------------|---------------|
| **CLI commands** | Users don't run CLI. MCP server is primary interface. | After MCP server is validated. Admin/debugging tool for Tier 2. |
| **Adapter pattern** (Codex, Web UI adapters) | YAGNI. Only Claude Code path needed now. | When there's a second platform to support. |
| **Hook generation** (shell script templates) | Companion service handles event capture. Hooks are optional. | If hook integration proves more reliable than filesystem watching. |
| **Retention policies** (7-day, 50MB cap) | Snapshots are 2-10KB. Thousands before this matters. | When storage is actually a problem. |
| **Historical snapshot queries** | Critical path is save/restore last state. | After core save/restore is validated. |
| **Multi-backend routing** | Only supporting Claude for now. | Use LiteLLM when Codex/Gemini support is needed. |
| **Audit logging** | Claude Enterprise covers this. | Don't build — use Enterprise APIs if custom views needed. |

## Complexity Tracking

No constitution violations to justify.

## Parallel Work Analysis

### Dependency Graph

```
Foundation (core types + store + collectors)
    │
    ├──▶ Wave 1: MCP Server + Tools (PRIMARY — get_context, save_state, check_canonical, verify_action, share_state)
    │
    ├──▶ Wave 1: Companion Service (event watching, snapshot capture)
    │       (parallel with MCP server — they share core but are independent)
    │
    └──▶ Wave 2: Integration Tests + Admin CLI (after Wave 1 validated)
```

### Work Distribution

- **Sequential work**: Core types, snapshot schema, state store, collectors must be built first — everything depends on them
- **Parallel streams**: Once core is done, MCP tools and companion service can be built independently (they both read/write the same state store)
- **Integration**: End-to-end testing (Claude → MCP tool → state store → companion service) depends on both Wave 1 streams being ready
- **Deferred**: CLI, adapters, hooks, retention — built after core is validated

### Build Priority & Phasing

**Phase 1 — Foundation** (sequential, everything depends on this):
1. Package setup, types, Zod schemas, configuration loading
2. State store (atomic read/write snapshots to disk)
3. Collectors (git state, file state, test results, decisions)
4. Canonical document CRUD (declarations, path checking, warnings)
5. State sharing (export/import with sharer note)

**Phase 2 — Primary Interface** (parallel streams, after Phase 1):
6. **MCP Server + all 5 tools** (get_context, save_state, check_canonical, verify_action, share_state) — this is the primary interface users interact with through Claude
7. **Companion Service** (daemon, filesystem watcher, event handler) — background state capture, runs alongside MCP server

**Phase 3 — Integration & Hardening** (after Phase 2):
8. End-to-end integration tests (MCP tools + companion service + state store)
9. Concurrent session handling (file locking, stale lock detection)
10. Error handling audit and graceful degradation

**Deferred** (build after Phase 3 is validated):
- Admin CLI (power user tool, thin wrapper around core logic)
- Adapters (multi-platform support)
- Hook generation (shell script templates for Claude Code)
- Retention policies (snapshot pruning)
- Historical snapshot queries
