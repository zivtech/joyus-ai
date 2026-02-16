# Work Packages: Session & Context Management

**Inputs**: Design documents from `kitty-specs/002-session-context-management/`
**Prerequisites**: plan.md, spec.md, research.md, data-model.md, contracts/state-api.md, quickstart.md

**Organization**: 38 subtasks rolled into 9 work packages. Each WP targets 3-6 subtasks (200-400 line prompts).

---

## Work Package WP01: Package Foundation & Core Types (Priority: P0)

**Goal**: Initialize the `jawn-ai-state` TypeScript package with project structure, core type definitions, Zod schemas, and configuration system.
**Independent Test**: Package compiles, schemas validate sample snapshots, config loads defaults.
**Prompt**: `tasks/WP01-package-foundation.md`
**Estimated size**: ~350 lines

### Included Subtasks
- [ ] T001 Initialize jawn-ai-state package (package.json, tsconfig, project structure)
- [ ] T002 Define core TypeScript types (Snapshot, GitState, FileState, Decision, etc.)
- [ ] T003 Create Zod schemas for snapshot validation
- [ ] T004 Implement config loading (global + project, defaults, merging)

### Implementation Notes
- Create `jawn-ai-state/` at repo root alongside existing `jawn-ai-mcp-server/`
- Match toolchain: TypeScript 5.3+, Vitest, ESLint, Prettier
- Types derived from `data-model.md` entities
- Config follows two-tier model: `~/.jawn-ai/global-config.json` + `.jawn-ai/config.json`

### Parallel Opportunities
- T002 and T004 can be developed in parallel once T001 scaffolds the package.

### Dependencies
- None (foundation package).

### Risks & Mitigations
- Schema evolution: Include `version` field in snapshot schema from day 1 for forward compatibility.

---

## Work Package WP02: State Store & Retention (Priority: P0)

**Goal**: Implement the on-disk state store with atomic writes, snapshot reading/listing, retention policy enforcement, and state divergence detection.
**Independent Test**: Can write a snapshot, read it back, list snapshots, prune old ones, and detect when git state diverges from stored state.
**Prompt**: `tasks/WP02-state-store.md`
**Estimated size**: ~350 lines

### Included Subtasks
- [ ] T005 Implement state store (atomic write via temp+rename, read, list snapshots)
- [ ] T006 Implement retention policy (7-day window + 50MB cap, oldest-first pruning)
- [ ] T007 Implement divergence detection (compare stored state vs live git state)

### Implementation Notes
- Snapshots stored at `~/.jawn-ai/projects/<hash>/snapshots/<timestamp>.json`
- Project hash: SHA256 of absolute root path, first 16 chars
- Atomic writes: write to `.tmp` file, then `fs.rename()` (POSIX atomic)
- Retention runs inline after each write (fast — just stat + unlink)

### Parallel Opportunities
- T006 and T007 can develop in parallel once T005 establishes the store interface.

### Dependencies
- Depends on WP01 (core types and schemas).

### Risks & Mitigations
- File system permissions: Ensure `~/.jawn-ai/` is created with proper permissions (700).
- Concurrent writes: Use lockfile to prevent race conditions.

---

## Work Package WP03: State Collectors (Priority: P0)

**Goal**: Build the data collection modules that gather git state, file state, test results, and track decisions incrementally.
**Independent Test**: Each collector can independently gather its data and return a typed result matching the snapshot schema.
**Prompt**: `tasks/WP03-state-collectors.md`
**Estimated size**: ~400 lines

### Included Subtasks
- [ ] T008 [P] Git state collector (branch, commit, status, ahead/behind remote)
- [ ] T009 [P] File state collector (staged, unstaged, untracked files)
- [ ] T010 [P] Test results collector (parse stdout from common test runners)
- [ ] T011 Decision tracker (append pending, resolve, carry forward across snapshots)

### Implementation Notes
- Git/file collectors shell out to `git` commands and parse output
- Test results collector parses stdout patterns for Vitest, PHPUnit, pytest, Jest
- Decision tracker is append-only within a session; carried forward from last snapshot on restore

### Parallel Opportunities
- T008, T009, T010 are fully parallel (independent data sources, different files).
- T011 is independent but shares types from WP01.

### Dependencies
- Depends on WP01 (core types).

### Risks & Mitigations
- Git not installed: Collector should return partial result, not crash.
- Test output format varies: Start with Vitest/Jest pattern; extensible for others.

---

## Work Package WP04: CLI Foundation & Core Commands (Priority: P1)

**Goal**: Build the `jawn-ai` CLI binary with core commands: `snapshot`, `restore`, `status`, `config`, and human-readable formatters.
**Independent Test**: Running `jawn-ai snapshot` captures state; `jawn-ai restore` displays it; `jawn-ai config init` sets up a project.
**Prompt**: `tasks/WP04-cli-core-commands.md`
**Estimated size**: ~500 lines

### Included Subtasks
- [ ] T012 CLI entry point and commander setup with `bin/jawn-ai`
- [ ] T013 `jawn-ai snapshot` command (collect all state, write snapshot)
- [ ] T014 `jawn-ai restore` command (load latest snapshot, display formatted summary)
- [ ] T015 `jawn-ai status` command (live git state + last snapshot's decisions/task)
- [ ] T016 `jawn-ai config` command (get, set, list, init subcommands)
- [ ] T017 Human-readable formatters (text output for restore and status)

### Implementation Notes
- Use `commander` for CLI framework
- `snapshot` orchestrates collectors → assembles Snapshot → writes via store
- `restore` reads latest snapshot → formats → prints
- `config init` creates `.jawn-ai/` in project root and `~/.jawn-ai/projects/<hash>/`
- Formatters produce the output format shown in `contracts/state-api.md`

### Parallel Opportunities
- T014, T015, T016 can develop in parallel once T012 and T013 establish the CLI framework.

### Dependencies
- Depends on WP01 (types), WP02 (store), WP03 (collectors).

### Risks & Mitigations
- Node.js cold start time: Keep CLI lightweight. Consider `tsx` for dev, compiled JS for prod.
- `npm link` path issues: Test on macOS, document in quickstart.

---

## Work Package WP05: Canonical Document Management (Priority: P1)

**Goal**: Implement canonical document declaration CRUD, CLI commands, branch override support, and non-canonical access warnings.
**Independent Test**: Can declare a canonical source, check files against it, get warnings for non-canonical access, and use branch overrides.
**Prompt**: `tasks/WP05-canonical-documents.md`
**Estimated size**: ~350 lines

### Included Subtasks
- [ ] T018 Canonical declaration CRUD (add, remove, list, check against `.jawn-ai/canonical.json`)
- [ ] T019 `jawn-ai canonical` CLI commands (add, remove, list, check)
- [ ] T020 Branch override support for canonical declarations
- [ ] T021 Warning/redirect logic when non-canonical copy is accessed

### Implementation Notes
- `canonical.json` lives in project root `.jawn-ai/` — committed to git (team-shared)
- Format: `{ "documents": { "<name>": { "default": "<path>", "branches": { "<branch>": "<path>" } } } }`
- `check` command compares a file path against all declarations
- Warning output matches format in `contracts/state-api.md`

### Parallel Opportunities
- T018 and T020 can develop together (CRUD + branch override logic).
- T019 and T021 can develop together (CLI + warning presentation).

### Dependencies
- Depends on WP01 (types), WP02 (store for canonical status in snapshots).

### Risks & Mitigations
- Canonical file merge conflicts: JSON format with one entry per key minimizes conflicts. Document merge strategy.

---

## Work Package WP06: State Sharing (Priority: P2)

**Goal**: Enable developers to share their session state with teammates, including a sharer note, and load shared state from others.
**Independent Test**: Developer A shares state with a note; Developer B loads it and sees full context plus the note.
**Prompt**: `tasks/WP06-state-sharing.md`
**Estimated size**: ~300 lines

### Included Subtasks
- [ ] T022 Share state export (assemble snapshot + SharerNote → write to outgoing file)
- [ ] T023 Load shared state import (read file → validate → display with sharer note)
- [ ] T024 `jawn-ai share` and `jawn-ai load` CLI commands

### Implementation Notes
- Share writes to `.jawn-ai/shared/outgoing/<timestamp>-share.json`
- Load reads any valid snapshot file (from path argument)
- Sharer note is prompted if not provided via `--note` flag
- Shared state display prominently shows the note before the context summary

### Parallel Opportunities
- T022 and T023 are independent (export vs import logic).

### Dependencies
- Depends on WP01 (types), WP02 (store), WP04 (CLI framework).

### Risks & Mitigations
- File transfer mechanism: v1 is manual (file copy, chat). Document clearly in help output.

---

## Work Package WP07: Local MCP Server (Priority: P2)

**Goal**: Build a local MCP server exposing state query tools for interactive AI agent use.
**Independent Test**: MCP server starts, responds to `get_context`, `query_snapshots`, `check_canonical`, and `share_state` tool calls.
**Prompt**: `tasks/WP07-mcp-server.md`
**Estimated size**: ~400 lines

### Included Subtasks
- [ ] T025 Local MCP server setup using `@modelcontextprotocol/sdk`
- [ ] T026 [P] `get_context` MCP tool (latest snapshot + live git enrichment)
- [ ] T027 [P] `query_snapshots` MCP tool (search by date, event, branch)
- [ ] T028 [P] `check_canonical` MCP tool (check file against declarations)
- [ ] T029 [P] `share_state` MCP tool (export with note)

### Implementation Notes
- Server runs as `jawn-ai mcp start` (separate process, stdio transport for Claude Desktop)
- Tools follow the contract in `contracts/state-api.md`
- `get_context` enriches the latest snapshot with live `git status` (via collectors from WP03)
- Server is optional — CLI works without it

### Parallel Opportunities
- T026, T027, T028, T029 are fully parallel (independent tool implementations, different files).

### Dependencies
- Depends on WP01 (types), WP02 (store), WP03 (collectors), WP05 (canonical).

### Risks & Mitigations
- MCP SDK version compatibility: Pin version, test with Claude Desktop.
- Server lifecycle: Document start/stop, consider auto-start via Claude Desktop config.

---

## Work Package WP08: Adapters & Hook Generation (Priority: P1)

**Goal**: Build the adapter interface, Claude Code adapter (hook script generation), hook templates, install command, and generic adapter stub for future platforms.
**Independent Test**: `jawn-ai hooks install` generates correct hook scripts in `.claude/settings.json`; hooks call `jawn-ai snapshot` on events.
**Prompt**: `tasks/WP08-adapters-hooks.md`
**Estimated size**: ~400 lines

### Included Subtasks
- [ ] T030 Adapter interface definition (base type for platform adapters)
- [ ] T031 Claude Code adapter (maps Claude Code events → jawn-ai CLI calls)
- [ ] T032 Hook templates (session-start.sh, post-tool-use.sh, session-end.sh)
- [ ] T033 `jawn-ai hooks install` command (generates hooks, updates Claude Code settings)
- [ ] T034 [P] Generic adapter stub (API-based, for future Codex/web integration)

### Implementation Notes
- Claude Code hooks are shell scripts defined in `.claude/settings.json`
- Hook templates use mustache-style variables for project path, CLI binary path
- `hooks install` reads existing settings, merges jawn-ai hooks without clobbering user hooks
- Generic adapter is a stub/interface — implementation deferred to Codex/web phase

### Parallel Opportunities
- T034 (generic adapter) is independent of T031-T033 (Claude Code adapter).

### Dependencies
- Depends on WP01 (types), WP04 (CLI must exist for hooks to call).

### Risks & Mitigations
- Clobbering existing hooks: Merge strategy must preserve user's existing hooks.
- Hook path resolution: Use absolute path to `jawn-ai` binary to avoid PATH issues.

---

## Work Package WP09: Integration & Hardening (Priority: P2)

**Goal**: End-to-end integration testing, concurrent session handling, error handling, and graceful degradation across all components.
**Independent Test**: Full snapshot → restore cycle works end-to-end; concurrent sessions don't corrupt state; errors are logged but never block the user.
**Prompt**: `tasks/WP09-integration-hardening.md`
**Estimated size**: ~350 lines

### Included Subtasks
- [ ] T035 End-to-end integration test (snapshot → restore cycle in a test git repo)
- [ ] T036 Hook integration test (simulate Claude Code events → verify snapshots captured)
- [ ] T037 Concurrent session handling (file locking, session partitioning)
- [ ] T038 Error handling and graceful degradation (corrupted files, missing git, partial state)

### Implementation Notes
- Integration tests use a temp directory with an initialized git repo
- Hook tests simulate by calling CLI directly with `--event` flags
- Concurrent handling: lockfile in state directory, with timeout and stale lock detection
- Error handling: every public function wraps in try/catch, logs errors, returns partial results

### Parallel Opportunities
- T035, T036 can develop in parallel (different test scenarios).
- T037, T038 can develop in parallel (different hardening concerns).

### Dependencies
- Depends on WP01-WP08 (all components must exist for integration testing).

### Risks & Mitigations
- Flaky tests from filesystem timing: Use proper async/await, avoid race conditions in tests.
- Platform differences (macOS vs Linux vs WSL2): Test on macOS primarily, document known differences.

---

## Dependency & Execution Summary

```
WP01 (Foundation) ─────────────────────────────────────────┐
  │                                                          │
  ├──▶ WP02 (State Store) ──┐                               │
  │                          ├──▶ WP04 (CLI) ──┐            │
  ├──▶ WP03 (Collectors) ───┘                  ├──▶ WP08 (Adapters/Hooks)
  │                                             │            │
  ├──▶ WP05 (Canonical) ──────────────────────┐│            │
  │                                            ││            │
  └──────────────────────────────────────┐     ││            │
                                          ├──▶ WP07 (MCP)   │
                                          │                  │
  WP04 ──▶ WP06 (Sharing)                │                  │
                                          │                  │
  WP01-WP08 ──────────────────────────────┴──▶ WP09 (Integration)
```

**Parallel execution waves**:
- **Wave 0**: WP01 (foundation, must complete first)
- **Wave 1**: WP02 + WP03 (parallel — store and collectors)
- **Wave 2**: WP04 + WP05 (parallel after Wave 1 — CLI and canonical)
- **Wave 3**: WP06 + WP07 + WP08 (parallel after Wave 2 — sharing, MCP, hooks)
- **Wave 4**: WP09 (integration, after all others)

**MVP Scope**: WP01 → WP02 → WP03 → WP04 → WP08 (foundation through working CLI with hooks). This gives a developer a working `jawn-ai snapshot` + `jawn-ai restore` cycle with Claude Code hooks. WP05-WP07 add canonical documents, sharing, and MCP — valuable but not required for MVP.

---

## Subtask Index (Reference)

| Subtask | Summary | WP | Priority | Parallel? |
|---------|---------|-----|----------|-----------|
| T001 | Initialize package structure | WP01 | P0 | No |
| T002 | Define core TypeScript types | WP01 | P0 | Yes |
| T003 | Create Zod schemas | WP01 | P0 | No |
| T004 | Implement config loading | WP01 | P0 | Yes |
| T005 | State store (atomic write/read/list) | WP02 | P0 | No |
| T006 | Retention policy (7d + 50MB) | WP02 | P0 | Yes |
| T007 | Divergence detection | WP02 | P0 | Yes |
| T008 | Git state collector | WP03 | P0 | Yes |
| T009 | File state collector | WP03 | P0 | Yes |
| T010 | Test results collector | WP03 | P0 | Yes |
| T011 | Decision tracker | WP03 | P0 | No |
| T012 | CLI entry point + commander | WP04 | P1 | No |
| T013 | `snapshot` command | WP04 | P1 | No |
| T014 | `restore` command | WP04 | P1 | Yes |
| T015 | `status` command | WP04 | P1 | Yes |
| T016 | `config` command | WP04 | P1 | Yes |
| T017 | Human-readable formatters | WP04 | P1 | No |
| T018 | Canonical declaration CRUD | WP05 | P1 | No |
| T019 | `canonical` CLI commands | WP05 | P1 | Yes |
| T020 | Branch override support | WP05 | P1 | Yes |
| T021 | Non-canonical access warning | WP05 | P1 | Yes |
| T022 | Share state export | WP06 | P2 | Yes |
| T023 | Load shared state import | WP06 | P2 | Yes |
| T024 | `share` and `load` CLI commands | WP06 | P2 | No |
| T025 | Local MCP server setup | WP07 | P2 | No |
| T026 | `get_context` MCP tool | WP07 | P2 | Yes |
| T027 | `query_snapshots` MCP tool | WP07 | P2 | Yes |
| T028 | `check_canonical` MCP tool | WP07 | P2 | Yes |
| T029 | `share_state` MCP tool | WP07 | P2 | Yes |
| T030 | Adapter interface definition | WP08 | P1 | No |
| T031 | Claude Code adapter | WP08 | P1 | No |
| T032 | Hook templates | WP08 | P1 | No |
| T033 | `hooks install` command | WP08 | P1 | No |
| T034 | Generic adapter stub | WP08 | P1 | Yes |
| T035 | E2E integration test | WP09 | P2 | Yes |
| T036 | Hook integration test | WP09 | P2 | Yes |
| T037 | Concurrent session handling | WP09 | P2 | Yes |
| T038 | Error handling & graceful degradation | WP09 | P2 | Yes |
