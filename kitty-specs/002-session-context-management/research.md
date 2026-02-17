# Research: Session & Context Management

**Feature**: 002-session-context-management
**Date**: 2026-02-16

---

## R1: Snapshot File Format

**Decision**: JSON with Zod schema validation

**Rationale**: JSON is native to Node.js/TypeScript (zero-cost parsing), human-readable for power users (Story 5), and easy to validate with Zod schemas. YAML adds a parsing dependency for negligible readability gain. TOML is less common in the Node.js ecosystem.

**Alternatives considered**:
- YAML: Slightly more readable for humans but requires `js-yaml` dependency. No structural advantage for machine parsing.
- MessagePack/CBOR: Smaller on disk but not human-readable. Snapshots are 2-10KB — size savings are negligible.
- SQLite: Overkill for per-developer local state. Adds binary dependency. Not human-inspectable.

---

## R2: Atomic File Writes

**Decision**: Write to temp file, then `fs.rename()` (atomic on POSIX)

**Rationale**: Snapshots must survive dirty exits (FR-006). If the process is killed mid-write, a partial JSON file would corrupt the state. Writing to a temp file in the same directory and then renaming is atomic on POSIX systems (macOS, Linux). On Windows/WSL2, `fs.rename()` within the same volume is also atomic.

**Alternatives considered**:
- Direct `fs.writeFile()`: Non-atomic — partial writes on crash corrupt the file.
- Write-ahead log: Overkill for small files. Adds complexity.
- `fs.writeFileSync()` with `fsync`: Ensures durability but not atomicity.

---

## R3: Project Identification

**Decision**: SHA256 hash of the absolute project root path

**Rationale**: Need a stable, filesystem-safe identifier for the `~/.joyus-ai/projects/<id>/` directory. SHA256 of the absolute path is deterministic, collision-resistant, and works across sessions. A truncated hash (first 16 chars) is sufficient.

**Alternatives considered**:
- Git remote URL: Not all projects have remotes. Local-only repos would fail.
- Project name from package.json: Not unique across projects. May not exist.
- Full path as directory name: Filesystem-unsafe (slashes, length limits).

---

## R4: Claude Code Hook Integration

**Decision**: Generate shell scripts that call the `joyus-ai` CLI binary

**Rationale**: Claude Code hooks are shell commands defined in `.claude/settings.json`. The hooks call `joyus-ai snapshot --event=<event-type>` which is a fast, standalone CLI invocation. No dependency on the MCP server running. The hook generator creates the shell scripts from templates and installs them into the Claude Code settings.

**Hook mapping**:
- `SessionStart` → `joyus-ai restore` (display prior state)
- `PostToolUse` (git commit, git checkout, test commands) → `joyus-ai snapshot --event=<type>`
- `Stop` / session end → `joyus-ai snapshot --event=session-end`

**Alternatives considered**:
- Inline shell logic: Fragile, hard to maintain, can't share logic with MCP server.
- Node.js script as hook: Slower startup (~200ms for Node.js cold start) vs <50ms for a compiled CLI binary or pre-warmed process.
- Daemon with IPC: Over-engineered for event-driven snapshots.

---

## R5: MCP Server Architecture (Local)

**Decision**: Standalone local MCP server using `@modelcontextprotocol/sdk`, separate from the remote `joyus-ai-mcp-server`

**Rationale**: The remote MCP server handles cloud tool execution (Jira, Slack, GitHub). The local state server handles per-developer session state. Different concerns, different deployment targets, different lifecycles. They share the TypeScript/Vitest toolchain and can share type packages.

**Tools exposed**:
- `get_context` — return current session state (last snapshot + live git status)
- `query_snapshots` — search historical snapshots by date, event type, branch
- `check_canonical` — verify a file path against canonical declarations
- `share_state` — export current state with a note for a teammate

**Alternatives considered**:
- Extend remote MCP server: Conflates local and remote concerns. State capture needs to work offline.
- REST API instead of MCP: MCP is the native protocol for Claude Code. REST adds unnecessary translation.
- No MCP server (CLI only): Loses interactive query capability. Claude can't ask "what branch was I on?" without MCP tools.

---

## R6: Canonical Declaration Storage

**Decision**: `canonical.json` in project root `.joyus-ai/` directory, committed to git

**Rationale**: Canonical declarations are team-shared ("the tracking CSV lives at X"). They belong in the repo so all developers see the same declarations. The `.joyus-ai/canonical.json` file is small, rarely changes, and merge-friendly (JSON with one entry per line).

**Branch overrides**: Stored as additional keys in the same file. When on a branch with an override, the override takes precedence. Format: `{ "tracking-csv": { "default": "path/to/file.csv", "branches": { "feature/x": "other/path.csv" } } }`

**Alternatives considered**:
- Per-developer only: Defeats the purpose — canonical means team-agreed.
- In CLAUDE.md: Mixes concerns. CLAUDE.md is for agent instructions, not structured data.
- Separate file per declaration: Over-fragmented for typically <10 declarations.

---

## R7: Share State Mechanism

**Decision**: File-based export/import for v1, with API-based sync as future adapter

**Rationale**: For v1, sharing state is: developer A runs `joyus-ai share --note "stuck on filter tests"` which writes a snapshot + note to a sharable location (e.g., project's `.joyus-ai/shared/` directory or a file they can send). Developer B runs `joyus-ai load <path-or-id>`. This is simple, works offline, and requires no infrastructure.

Future: The remote MCP server adapter enables share-via-API (push state to server, teammate pulls from server). This is the Codex/web pathway.

**Alternatives considered**:
- Only via remote server: Requires server to be running and network access. Blocks offline use.
- Git-based sharing (commit shared state): Pollutes git history with ephemeral state.
- Clipboard/pipe: Unreliable for structured data.

---

## R8: Incremental Decision Tracking

**Decision**: Append-only decision log as part of the snapshot

**Rationale**: Pending decisions need to be tracked as they're made (not assembled at exit time — Q3 clarification). Each snapshot includes the current decision log. When a decision is made during a session, the collector appends it. When a decision is resolved, it's marked resolved. The full log carries forward in every snapshot.

**Format**: Array of `{ id, question, context, answer?, resolved: boolean, timestamp }` in the snapshot JSON.

**Alternatives considered**:
- Separate decisions file: Adds another file to manage. Harder to keep in sync with snapshots.
- Only capture at session end: Loses decisions on dirty exit — the exact problem we're solving.
