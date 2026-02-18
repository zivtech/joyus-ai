# Work Packages: Session & Context Management

**Inputs**: Design documents from `/kitty-specs/002-session-context-management/`
**Prerequisites**: plan.md (required), spec.md (user stories), data-model.md, contracts/state-api.md, quickstart.md
**Revised**: 2026-02-16 (MCP-first architecture reframing)

**Tests**: Only included in WP09 (Integration & Hardening).

**Organization**: Fine-grained subtasks (`Txxx`) roll up into work packages (`WPxx`). Each work package is independently deliverable. MCP server is the primary interface; CLI is deferred; companion service is Phase 2.

**Prompt Files**: Each work package references a matching prompt file in `tasks/`.

## Subtask Format: `[Txxx] [P?] Description`
- **[P]** indicates the subtask can proceed in parallel (different files/components).
- Include precise file paths or modules.

## Path Conventions
- Source: `joyus-ai-state/src/`
- Tests: `joyus-ai-state/tests/`
- Binaries: `joyus-ai-state/bin/`

---

## Work Package WP01: Package Setup & Core Types (Priority: P0)

**Goal**: Establish the `joyus-ai-state` package with all shared types, Zod validation schemas, and configuration loading.
**Independent Test**: Package compiles, types are importable, schemas validate sample data, config loading works with defaults.
**Prompt**: `tasks/WP01-package-setup-core-types.md`

### Included Subtasks
- [x] T001 Create package scaffolding (package.json, tsconfig.json, vitest config, directory structure)
- [x] T002 Define core TypeScript types from data-model.md (Snapshot, EventType, GitState, FileState, etc.)
- [x] T003 Create Zod schemas for snapshot format validation
- [x] T004 Implement configuration loading (GlobalConfig, ProjectConfig, merging, defaults)

### Implementation Notes
- Package name: `joyus-ai-state`. TypeScript 5.3+, Node.js 20+.
- All types derive from `data-model.md`. Zod schemas mirror the types exactly.
- Config merging: project config overrides global config. Missing keys use defaults.
- Dependencies: `@modelcontextprotocol/sdk`, `zod`, `@paralleldrive/cuid2`

### Parallel Opportunities
- T002 and T004 can proceed in parallel once T001 scaffolding is done.

### Dependencies
- None (starting package).

### Risks & Mitigations
- Schema drift from data model → generate types from Zod schemas (single source of truth).

---

## Work Package WP02: State Store (Priority: P0)

**Goal**: Implement the persistent state store — atomic read/write of snapshots to disk, directory management, and divergence detection.
**Independent Test**: Can write a snapshot, read it back, list snapshots with filters, and detect when stored state diverges from live state.
**Prompt**: `tasks/WP02-state-store.md`

### Included Subtasks
- [x] T005 Implement atomic snapshot write (temp file + rename pattern)
- [x] T006 Implement snapshot read (latest, by ID, list with date/event/branch filters)
- [x] T007 State directory initialization (create `~/.joyus-ai/projects/<hash>/` structure)
- [x] T008 Implement divergence detection (stored snapshot vs live project state)

### Implementation Notes
- Atomic writes prevent corruption: write to `.tmp` file, then `rename()`.
- Project hash: SHA256 of absolute project root path, first 16 chars.
- Divergence detection compares: branch, modified files list, commit hash.
- Snapshot filenames: `<ISO-timestamp>.json` (sortable, unique).

### Parallel Opportunities
- T007 (directory init) can proceed in parallel with T005/T006.

### Dependencies
- Depends on WP01 (types, schemas, config).

### Risks & Mitigations
- Filename collisions on rapid snapshots → append CUID2 suffix if timestamp matches.

---

## Work Package WP03: State Collectors (Priority: P0)

**Goal**: Build the collectors that gather live project state from git, filesystem, test output, and decision history.
**Independent Test**: Each collector returns structured data matching the corresponding type from WP01. Git collector works in a real git repo. File collector returns staged/unstaged/untracked.
**Prompt**: `tasks/WP03-state-collectors.md`

### Included Subtasks
- [x] T009 Git state collector (branch, commit hash/message, ahead/behind, detached HEAD)
- [x] T010 [P] File state collector (staged, unstaged, untracked from `git status --porcelain`)
- [x] T011 [P] Test results collector (parse output from vitest, jest, phpunit, pytest)
- [x] T012 Decision tracking (carry-forward pending decisions from last snapshot, add new, resolve)

### Implementation Notes
- Git collector shells out to `git` commands (not libgit2 — simpler, no native deps).
- File collector uses `git status --porcelain=v1` for reliable parsing.
- Test results collector is event-driven: only parses when event=test-run.
- Decision tracking loads decisions from last snapshot, merges with any new decisions.

### Parallel Opportunities
- T009, T010, T011 are fully independent (different data sources). T012 depends on T006 (reading last snapshot).

### Dependencies
- Depends on WP01 (types). T012 also depends on WP02 (reading last snapshot for decision carry-forward).

### Risks & Mitigations
- Git not installed → return default empty GitState, log warning.
- Test output parsing fails → return null TestResults, never throw.

---

## Work Package WP04: Canonical Document Management (Priority: P0)

**Goal**: Implement CRUD for canonical document declarations with branch override support, path checking, and warning generation.
**Independent Test**: Can declare canonical sources, check file paths against them, get warnings for non-canonical access, and branch overrides resolve correctly.
**Prompt**: `tasks/WP04-canonical-documents.md`

### Included Subtasks
- [x] T013 Canonical declaration CRUD (load, save, add, remove, list)
- [x] T014 checkPath logic with branch override resolution
- [x] T015 Non-canonical access warning generation
- [x] T016 [P] Canonical status integration in snapshots (check modified files against declarations)

### Implementation Notes
- Storage: `.joyus-ai/canonical.json` in project root (committed to git — team-shared).
- Atomic writes (temp + rename) same pattern as state store.
- checkPath priority: branch override > default path.
- Warning format matches contracts/state-api.md.

### Parallel Opportunities
- T016 (snapshot integration) can proceed in parallel with T015 (warning logic).

### Dependencies
- Depends on WP01 (types), WP02 (store for atomic write pattern).

### Risks & Mitigations
- Path normalization differences → normalize all paths (resolve, remove trailing slashes, forward slashes).

---

## Work Package WP05: State Sharing (Priority: P1)

**Goal**: Enable developers to export their session state with a note for a teammate, and import shared state from teammates.
**Independent Test**: Developer A exports state with note to outgoing/; Developer B imports and sees full context plus the note.
**Prompt**: `tasks/WP05-state-sharing.md`

### Included Subtasks
- [ ] T017 Share state export (package latest snapshot + sharer note, write to shared/outgoing/)
- [ ] T018 [P] Load shared state import (read file, validate schema, extract sharer note)
- [ ] T019 [P] Shared state directory management (ensure incoming/outgoing dirs exist, naming convention)

### Implementation Notes
- Shared file is a valid Snapshot with the `sharer` field populated.
- SharerNote.from: OS username or git user name.
- Event type set to "share" on export.
- File naming: `<timestamp>-share.json` in outgoing directory.
- Import accepts any file path (not just shared/ directory).

### Parallel Opportunities
- T017 (export) and T018 (import) are independent. T019 is a utility used by both.

### Dependencies
- Depends on WP01 (types, schemas), WP02 (state store for reading latest snapshot).

### Risks & Mitigations
- Shared file contains sensitive paths → document that only metadata is shared, not file contents.

---

## Work Package WP06: MCP Server + Core Tools (Priority: P0) 🎯 MVP

**Goal**: Build the MCP server (primary interface) with the three core tools: `get_context`, `save_state`, and `verify_action`. This is what Claude calls.
**Independent Test**: MCP server starts via stdio, all three tools respond correctly, can be added to Claude Desktop config.
**Prompt**: `tasks/WP06-mcp-server-core-tools.md`

### Included Subtasks
- [ ] T020 MCP server setup (Server instance, stdio transport, tool registration, error handling)
- [ ] T021 [P] `get_context` tool (load latest snapshot, run live collectors, merge, add divergence field)
- [ ] T022 [P] `save_state` tool (accept event/note/decision params, run collectors, create and write snapshot)
- [ ] T023 [P] `verify_action` tool (branch-match, uncommitted-changes, canonical-conflict, force-push checks)
- [ ] T024 MCP server entry point (`bin/joyus-ai-mcp`, project root detection, stdio launch)

### Implementation Notes
- Uses `@modelcontextprotocol/sdk` Server + StdioServerTransport.
- Server name: `joyus-ai-state`, version: `0.1.0`.
- All logging to stderr (stdout reserved for MCP protocol).
- Tool contracts match `contracts/state-api.md` exactly.
- get_context is the most-used tool — must be <500ms.
- save_state must be <100ms (non-blocking).
- verify_action is advisory only (returns warnings, never blocks).

### Parallel Opportunities
- T021, T022, T023 are fully independent tool implementations. T020 (server setup) and T024 (entry point) are sequential bookends.

### Dependencies
- Depends on WP01 (types), WP02 (state store), WP03 (collectors).

### Risks & Mitigations
- MCP SDK version incompatibility → pin exact version in package.json.
- Server crashes on bad input → validate all inputs, return MCP error responses, never crash.
- stdout/stderr conflict → all logging to stderr only.

---

## Work Package WP07: MCP Extended Tools (Priority: P1)

**Goal**: Add the remaining MCP tools (`check_canonical`, `share_state`, `query_snapshots`), consistent error handling across all tools, and Claude Desktop configuration documentation.
**Independent Test**: All 6 MCP tools work end-to-end. Claude Desktop config correctly connects to the server.
**Prompt**: `tasks/WP07-mcp-extended-tools.md`

### Included Subtasks
- [ ] T025 `check_canonical` tool (check mode + declare mode, wraps canonical module from WP04)
- [ ] T026 [P] `share_state` tool (export + import modes, wraps sharing module from WP05)
- [ ] T027 [P] Tool input validation and error response handling (consistent pattern across all 6 tools)
- [ ] T028 Claude Desktop/Code MCP configuration (setup instructions, verification steps)
- [ ] T039 [P] `query_snapshots` tool (list/filter snapshots by date range, event type, or branch; return summaries, not full payloads; wraps T006 store read)

### Implementation Notes
- check_canonical has two modes: "check" (is this path canonical?) and "declare" (declare a new canonical source).
- share_state has two modes: "export" (package + note) and "import" (load shared state).
- query_snapshots is a thin wrapper over T006 store read with filters — returns snapshot summaries (timestamp, event type, branch, note) not full payloads. Fulfills FR-008 (query prior state on demand).
- Error handling pattern: validate input with Zod → call core module → catch errors → return MCP error response.
- Configuration: `npx joyus-ai-mcp` command for Claude Desktop `mcpServers` config.

### Parallel Opportunities
- T025 and T026 are independent (different underlying modules). T027 is a cross-cutting refactor.

### Dependencies
- Depends on WP04 (canonical module), WP05 (sharing module), WP06 (MCP server).

### Risks & Mitigations
- Mode parameter confusion → use Zod discriminated union for input validation.

---

## Work Package WP08: Companion Service (Priority: P1)

**Goal**: Build the background companion service that watches for significant events and captures state snapshots automatically.
**Independent Test**: Service starts, watches a git repo, detects a commit, captures a snapshot. Service stops gracefully on SIGTERM.
**Prompt**: `tasks/WP08-companion-service.md`

### Included Subtasks
- [ ] T029 Service daemon (entry point, lifecycle, PID file, SIGTERM/SIGINT handling)
- [ ] T030 Filesystem watcher (watch `.git/HEAD`, `.git/refs/`, project files; debouncing)
- [ ] T031 [P] Event handler (classify detected events → EventType, route to snapshot capture)
- [ ] T032 [P] MCP ↔ Service IPC (localhost HTTP or unix socket, health check, capture request)
- [ ] T033 Service entry point (`bin/joyus-ai-service`, CLI flags, foreground mode)
- [ ] T040 [P] Custom event trigger support — load user-defined triggers from config (glob pattern + label, e.g., {"pattern": "**/Dockerfile", "event": "docker-build"}); watcher evaluates custom triggers alongside built-in events; fires standard snapshot capture

### Implementation Notes
- Uses `fs.watch` or `chokidar` for filesystem monitoring.
- Debouncing: git events 500ms, test runs 2s, file changes 5s.
- PID file: `~/.joyus-ai/projects/<hash>/service.pid` — MCP server checks this.
- IPC: simple localhost HTTP server on a random port (port written to service.port file).
- Service is optional — MCP server works without it (degraded but functional).
- CPU usage target: <1% during idle periods.

### Parallel Opportunities
- T030 (watcher) and T032 (IPC) are independent. T031 depends on T030 events.

### Dependencies
- Depends on WP01 (types), WP02 (state store), WP03 (collectors).

### Risks & Mitigations
- File watcher CPU usage → debounce aggressively, ignore `.git/objects/`, use gitignore patterns.
- Port conflicts → use random port, write to file, retry on EADDRINUSE.

---

## Work Package WP09: Integration & Hardening (Priority: P2)

**Goal**: Verify the full system works end-to-end, handle concurrent sessions, harden error handling, and add logging infrastructure.
**Independent Test**: E2E tests pass; concurrent sessions don't corrupt state; errors are logged but never block the user.
**Prompt**: `tasks/WP09-integration-hardening.md`

### Included Subtasks
- [ ] T034 MCP tools integration tests (full get_context → save_state → verify_action → check_canonical → share_state cycle)
- [ ] T035 [P] Companion service integration tests (event detection → snapshot capture cycle)
- [ ] T036 Concurrent session handling (file locking with lockfile, stale lock detection, 5s timeout)
- [ ] T037 [P] Error handling audit (corrupted snapshots, missing git, disk full, permission denied)
- [ ] T038 [P] Logging utility (stderr logger with warn/debug/error levels, verbose mode)

### Implementation Notes
- Integration tests use temp directories with fresh git repos.
- Set HOME env var to temp location to avoid polluting real `~/.joyus-ai/`.
- Lock pattern: `O_CREAT | O_EXCL` for atomic creation, check PID for stale locks.
- Golden rule: errors NEVER block the developer's work (FR-011).
- All logging to stderr (stdout reserved for MCP protocol).

### Parallel Opportunities
- T034 and T035 are independent test suites. T037 and T038 are independent utilities.

### Dependencies
- Depends on ALL Phase 2 packages (WP06, WP07, WP08).

### Risks & Mitigations
- Flaky filesystem timing in tests → use proper async/await, isolated temp dirs.
- Platform differences → primary target macOS, document known Linux/WSL2 differences.

---

## Dependency & Execution Summary

```
Phase 1 — Foundation (sequential with parallel opportunities):

  WP01 (Package Setup)
    ├──▶ WP02 (State Store)      ─┬──▶ WP04 (Canonical Docs)
    └──▶ WP03 (State Collectors)  └──▶ WP05 (State Sharing)

Phase 2 — Primary Interface (parallel streams):

  WP02 + WP03 ──▶ WP06 (MCP Server + Core Tools) ──▶ WP07 (MCP Extended Tools)
  WP02 + WP03 ──▶ WP08 (Companion Service)           ↑ (also needs WP04 + WP05)

Phase 3 — Integration & Hardening:

  WP06 + WP07 + WP08 ──▶ WP09 (Integration & Hardening)
```

- **Parallelization**: WP02 ∥ WP03 after WP01. WP04 ∥ WP05 after WP02. WP06 ∥ WP08 after WP02+WP03. WP07 waits for WP04+WP05+WP06.
- **MVP Scope**: WP01 → WP02 → WP03 → WP06 (foundation + MCP server with core tools). This gives Claude `get_context`, `save_state`, and `verify_action` — enough for session restoration and basic guardrails.
- **Full Scope**: All 9 WPs (40 subtasks) deliver the complete MCP-first session & context management system with companion service.

---

## Subtask Index (Reference)

| Subtask ID | Summary | Work Package | Priority | Parallel? |
|------------|---------|--------------|----------|-----------|
| T001 | Package scaffolding | WP01 | P0 | No |
| T002 | Core TypeScript types | WP01 | P0 | Yes |
| T003 | Zod validation schemas | WP01 | P0 | No |
| T004 | Configuration loading | WP01 | P0 | Yes |
| T005 | Atomic snapshot write | WP02 | P0 | No |
| T006 | Snapshot read/list/query | WP02 | P0 | No |
| T007 | State directory initialization | WP02 | P0 | Yes |
| T008 | Divergence detection | WP02 | P0 | No |
| T009 | Git state collector | WP03 | P0 | Yes |
| T010 | File state collector | WP03 | P0 | Yes |
| T011 | Test results collector | WP03 | P0 | Yes |
| T012 | Decision tracking | WP03 | P0 | No |
| T013 | Canonical CRUD | WP04 | P0 | No |
| T014 | checkPath with branch overrides | WP04 | P0 | No |
| T015 | Non-canonical warnings | WP04 | P0 | No |
| T016 | Canonical status in snapshots | WP04 | P0 | Yes |
| T017 | Share state export | WP05 | P1 | No |
| T018 | Load shared state import | WP05 | P1 | Yes |
| T019 | Shared directory management | WP05 | P1 | Yes |
| T020 | MCP server setup | WP06 | P0 | No |
| T021 | get_context tool | WP06 | P0 | Yes |
| T022 | save_state tool | WP06 | P0 | Yes |
| T023 | verify_action tool | WP06 | P0 | Yes |
| T024 | MCP server entry point | WP06 | P0 | No |
| T025 | check_canonical tool | WP07 | P1 | No |
| T026 | share_state tool | WP07 | P1 | Yes |
| T027 | Tool validation/error handling | WP07 | P1 | Yes |
| T028 | Claude Desktop configuration | WP07 | P1 | Yes |
| T029 | Service daemon | WP08 | P1 | No |
| T030 | Filesystem watcher | WP08 | P1 | No |
| T031 | Event handler | WP08 | P1 | Yes |
| T032 | MCP ↔ Service IPC | WP08 | P1 | Yes |
| T033 | Service entry point | WP08 | P1 | No |
| T034 | MCP tools integration tests | WP09 | P2 | No |
| T035 | Companion service integration tests | WP09 | P2 | Yes |
| T036 | Concurrent session handling | WP09 | P2 | No |
| T037 | Error handling audit | WP09 | P2 | Yes |
| T038 | Logging utility | WP09 | P2 | Yes |
| T039 | `query_snapshots` MCP tool | WP07 | P1 | Yes |
| T040 | Custom event trigger support | WP08 | P1 | Yes |
