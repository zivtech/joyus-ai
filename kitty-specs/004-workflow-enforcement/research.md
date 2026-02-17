# Research: Workflow Enforcement

**Feature**: 004-workflow-enforcement
**Date**: 2026-02-17
**Status**: Complete

## Research Areas

### 1. Gate Execution Model

**Decision**: Sequential fail-fast execution

**Rationale**: Fail-fast minimizes wasted time — if linting fails, there's no value in running a 60-second test suite. The user gets feedback on the first problem immediately and can fix it before re-running. Sequential execution also simplifies the implementation (no parallel process management, no result aggregation races).

**Alternatives considered**:
- Parallel execution: Faster wall-clock time for passing runs, but wastes resources when early gates fail. Adds complexity for result aggregation and partial-failure states.
- Sequential run-all: Shows all problems at once, but forces the user to wait for all gates even when the first failure is trivial.
- Parallel with streaming: Most complex. Better UX for power users but adds significant implementation complexity for marginal benefit in an MCP-first model where Claude mediates results.

### 2. Audit Storage Strategy

**Decision**: JSONL for raw writes + SQLite for indexed queries

**Rationale**: JSONL append-only writes are crash-safe (no transaction needed — a partial line is detectable and discardable). SQLite provides structured queries (FR-024: by time, action type, skill, ticket ID) without requiring a server process. The separation means writes never block on index updates.

**Alternatives considered**:
- SQLite only: Simpler single-store, but write transactions add latency and crash risk (partial writes corrupt the database without WAL mode, and WAL adds complexity).
- JSONL only: Simple writes, but every query requires full file scan. Unusable at scale (thousands of entries over weeks).
- Embedded key-value stores (LevelDB, LMDB): Overkill for this use case. Adds native dependencies that complicate cross-platform builds.

**Implementation notes**:
- Use `better-sqlite3` (synchronous C++ bindings, no native compilation issues on macOS/Linux/WSL2)
- SQLite index rebuild: on MCP server startup + incremental on every N writes (configurable, default: 50)
- JSONL file rotation: new file per day (`audit-YYYY-MM-DD.jsonl`) for easier manual cleanup
- Storage monitor: warn at configurable threshold (suggest default: 100MB)

### 3. Skill Representation & Loading

**Decision**: Layered — plain-language context injection + validation MCP tools

**Rationale**: Plain-language constraints in Claude's context are sufficient for most generation guidance (Claude follows "use Drupal's database abstraction layer" reliably). Validation tools as a second pass catch what slipped through and provide auditable verification. This maps to the existing skill format in `zivtech-claude-skills/` (markdown files with rules and anti-patterns).

**Alternatives considered**:
- Structured tool metadata only: Too rigid for the variety of skill constraints (brand voice, coding standards, security rules).
- System prompt only: No verification — relies entirely on Claude's compliance, which isn't auditable.
- Fine-tuning/RAG: Out of scope and overkill for constraint enforcement.

**Implementation notes**:
- Skills are loaded from the local filesystem (git-cloned skill repo)
- Skill cache: copy of last-loaded skills stored in `~/.joyus-ai/projects/<hash>/skill-cache/`
- Cache freshness: check git repo on skill load; if fetch fails, use cache + warn
- Skill injection: MCP tool responses include `skill_context` field with plain-language constraints
- Validation tools: generated dynamically based on loaded skills' anti-pattern lists
- Precedence resolution: deterministic — sort by precedence level, log resolution for debugging (SC-010)

### 4. Trigger Mechanism Architecture

**Decision**: Hybrid — MCP tool interception + context injection + companion service events

**Rationale**: Different enforcement types need different trigger mechanisms based on reliability requirements:
- Quality gates and git checks MUST be deterministic → MCP tool interception (Claude can't bypass)
- Skill loading must enrich generation context → context injection (pre-generation)
- Session-start advisories are informational → companion service events (async, non-blocking)

**Alternatives considered**:
- Pure companion service: Unreliable for blocking enforcement — event detection has latency and can miss rapid operations.
- Pure Claude instructions: Unauditable and bypassable — Claude might not follow instructions perfectly.
- Git hooks only: Can't enforce skill loading or provide conversational feedback. Works for gates but not for the full enforcement scope.

**Implementation notes**:
- MCP tool interception: enforcement tools (run_gates, verify_branch) are called by Claude before the actual git operation. Claude's instructions (via CLAUDE.md or skill context) tell it to call these tools. The companion service can also prompt Claude to call them via event notifications.
- Context injection: when Claude calls any MCP tool, the response includes active skill constraints based on the current file context. This is passive — no separate tool call needed.
- Companion events: session-start triggers hygiene checks; file-change triggers skill reload; branch-switch triggers config reload. These are advisory (logged, surfaced to Claude) not blocking.

### 5. Configuration Strategy

**Decision**: Extend 002's configuration system

**Rationale**: A single configuration system reduces developer cognitive load. 002 already defines `~/.joyus-ai/projects/<hash>/config.json` (per-developer) and `.joyus-ai/config.json` (per-project). Adding enforcement sections to these files is cleaner than introducing new config files.

**Implementation notes**:
- Project config (`.joyus-ai/config.json`) adds sections: `gates`, `skillMappings`, `branchRules`, `enforcementPolicy`
- Developer config (`~/.joyus-ai/projects/<hash>/config.json`) adds sections: `tier`, `gateOverrides`, `skillOverrides`
- Inheritance: project config provides defaults; developer config overrides where enforcement policy permits
- Validation: Zod schemas validate config on load; invalid config falls back to safe defaults (FR-029)
- Config format: JSON (matches 002's existing format)

### 6. Kill Switch Design

**Decision**: Session-scoped MCP tool toggle, audit-logged

**Rationale**: Emergency disable must be immediate (single tool call) and reversible (session-scoped — new session restores enforcement). Audit logging ensures accountability.

**Implementation notes**:
- Kill switch state stored in memory (session-scoped, not persisted)
- All enforcement engines check kill switch before executing
- Audit entry records: activation time, deactivation time (or session end), user, reason
- Kill switch does NOT disable audit logging itself — the kill switch action is always recorded
- Re-enable via same MCP tool or new session

### 7. Gate Timeout Handling

**Decision**: 60-second default, configurable per gate

**Rationale**: 60 seconds accommodates most lint and unit test runs. Full integration test suites that exceed 60s should be explicitly configured with higher timeouts. The default prevents indefinite hangs from broken tools.

**Implementation notes**:
- Timeout implemented via `AbortController` + `setTimeout` on the spawned process
- On timeout: kill the process, record `timeout` status in audit, notify Claude
- Claude presents timeout to user per tier: Tier 1 gets explanation + suggestion to increase timeout; Tier 2 gets concise notification + option to re-run or skip; Tier 3 gets "still checking, this is taking longer than expected"
