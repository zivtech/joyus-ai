# State API Contract: Session & Context Management

**Feature**: 002-session-context-management
**Date**: 2026-02-16
**Revised**: 2026-02-16 (MCP-first architecture reframing)

---

## Overview

The State API is exposed through two interfaces:
1. **MCP Tools** (primary) — Claude calls these on behalf of the user. The user never interacts with joyus-ai directly.
2. **CLI** (deferred, admin/power users) — `joyus-ai <command>` for direct state inspection and debugging. Built after MCP tools are validated.

Both interfaces operate on the same underlying state store and snapshot format.

> **Architecture Note**: The MCP server is the primary interface. Users interact with Claude; Claude calls MCP tools. The CLI is a secondary admin tool for power users (Tier 2). See `plan.md` for full architecture.

---

## MCP Tools (Primary Interface)

### `get_context`

Get the current session context (latest snapshot enriched with live git state). This is the most-used tool — called at session start, after compaction, and whenever Claude needs to orient.

**Input**: `{}` (no parameters)

**Output**: Full Snapshot object as JSON, with `git` and `files` fields updated to reflect live state. If stored state has diverged from live state, a `_divergence` field is included.

```json
{
  "id": "clx1abc...",
  "version": "1.0.0",
  "timestamp": "2026-02-16T14:30:00Z",
  "event": "commit",
  "git": {
    "branch": "feature/a11y-652",
    "commitHash": "abc1234",
    "commitMessage": "Fix FilterPipeSeparators accessibility",
    "isDetached": false,
    "hasUncommittedChanges": true,
    "remoteBranch": "origin/feature/a11y-652",
    "aheadBehind": { "ahead": 3, "behind": 0 }
  },
  "files": {
    "staged": ["src/templates/navigation.html.twig"],
    "unstaged": ["src/css/accessible-nav.css"],
    "untracked": ["test-output.log"]
  },
  "tests": {
    "passed": 12,
    "failed": 2,
    "failing": ["FilterPipeSeparatorsTest::testMobileNav", "ThemeA11yTest::testAriaLabels"]
  },
  "decisions": [
    { "id": "d1", "question": "Should mobile nav use accordion or dropdown?", "context": "WCAG 2.1 AA requires...", "options": ["accordion", "dropdown"], "answer": null, "resolved": false, "timestamp": "2026-02-16T14:00:00Z", "resolvedAt": null }
  ],
  "canonical": [
    { "name": "tracking-spreadsheet", "path": "test-files/accessibility-audit-tracking.csv", "exists": true, "lastModified": "2026-02-16T12:30:00Z" }
  ],
  "_divergence": null
}
```

**When Claude calls it**: Session start, after "continue", after compaction, when user asks "what was I working on?"

**Performance**: <500ms response time.

---

### `save_state`

Capture a state snapshot now. Claude calls this after performing significant actions (commits, test runs, branch switches) so the companion service doesn't need to detect every event.

**Input**:
```json
{
  "event": "commit",
  "note": "Committed accessibility fix for FilterPipeSeparators",
  "decision": "Chose accordion pattern for mobile nav (WCAG 2.1 AA)"
}
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `event` | EventType | No | What triggered this snapshot (default: "manual") |
| `note` | string | No | Free-text note about what just happened |
| `decision` | string | No | Record a new pending decision |

**Output**:
```json
{
  "id": "clx1def...",
  "timestamp": "2026-02-16T14:35:22Z",
  "event": "commit",
  "summary": "Branch: feature/a11y-652 | Files: 3 modified | Tests: 12 pass, 2 fail"
}
```

**When Claude calls it**: After commits, test runs, branch switches, or any action the user might want to recover from. Also before ending a session if the companion service isn't running.

**Performance**: <100ms (non-blocking).

---

### `verify_action`

Pre-action guardrail check. Claude calls this before risky git operations to catch potential mistakes before they happen. This lays groundwork for Spec 2 (Workflow Enforcement) quality gates.

**Input**:
```json
{
  "action": "commit",
  "details": {
    "targetBranch": "main",
    "message": "Fix accessibility filters"
  }
}
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `action` | string | Yes | Action type: "commit", "push", "merge", "branch-delete" |
| `details` | object | No | Action-specific details for validation |

**Output**:
```json
{
  "allowed": false,
  "warnings": [
    {
      "severity": "high",
      "message": "About to commit to 'main' but last snapshot shows work on 'feature/a11y-652'. Did you mean to switch branches?",
      "suggestion": "Switch to feature/a11y-652 before committing"
    }
  ],
  "checks": [
    { "name": "branch-match", "passed": false, "detail": "Expected feature/a11y-652, got main" },
    { "name": "uncommitted-changes", "passed": true, "detail": "3 files staged" }
  ]
}
```

**Checks performed**:
- **branch-match**: Current branch matches expected branch from last snapshot
- **uncommitted-changes**: Verify files are staged before commit
- **canonical-conflict**: Warn if committing changes to a non-canonical copy of a declared document
- **force-push**: Warn before force-push operations

**When Claude calls it**: Before commits, pushes, merges, branch deletions, or other risky git operations.

**Behavior**: Advisory only — returns warnings but never blocks. Claude presents warnings to the user and asks for confirmation. The `allowed` field is a recommendation, not enforcement (enforcement comes in Spec 2).

---

### `check_canonical`

Check if a file path is canonical or if a canonical source exists. Also supports declaring new canonical sources.

**Input** (check mode):
```json
{
  "action": "check",
  "path": "test-files/accessibility-fixes-todo.md"
}
```

**Input** (declare mode):
```json
{
  "action": "declare",
  "name": "accessibility-todo",
  "path": "docs/accessibility-fixes-todo.md",
  "branch": "feature/a11y-652"
}
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `action` | string | Yes | "check" or "declare" |
| `path` | string | Yes | File path to check or declare as canonical |
| `name` | string | For declare | Human-readable name for the canonical document |
| `branch` | string | No | Branch-specific override (declare only) |

**Output** (check mode):
```json
{
  "isCanonical": false,
  "canonicalName": "accessibility-todo",
  "canonicalPath": "docs/accessibility-fixes-todo.md",
  "suggestion": "Use the canonical source at docs/accessibility-fixes-todo.md"
}
```

**Output** (declare mode):
```json
{
  "declared": true,
  "name": "accessibility-todo",
  "path": "docs/accessibility-fixes-todo.md",
  "branch": null
}
```

**When Claude calls it**: Before reading/writing files that might have duplicates. When user mentions a document by name. When user asks to declare a canonical source.

---

### `share_state`

Export current state with a note for a teammate, or load a teammate's shared state.

**Input** (export mode):
```json
{
  "action": "export",
  "note": "stuck on filter tests — 2 failures I can't figure out"
}
```

**Input** (import mode):
```json
{
  "action": "import",
  "path": ".joyus-ai/shared/incoming/2026-02-16T14-30-00-share.json"
}
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `action` | string | Yes | "export" or "import" |
| `note` | string | For export | What the sharer was working on |
| `path` | string | For import | Path to shared state file to load |

**Output** (export):
```json
{
  "sharedFile": ".joyus-ai/shared/outgoing/2026-02-16T14-30-00-share.json",
  "note": "stuck on filter tests — 2 failures I can't figure out"
}
```

**Output** (import):
```json
{
  "snapshot": { ... },
  "sharer": {
    "from": "Alex",
    "note": "stuck on filter tests — 2 failures I can't figure out",
    "sharedAt": "2026-02-16T14:30:00Z"
  }
}
```

**When Claude calls it**: When user asks for help and wants to share context. When user says "load Alex's context" or similar.

---

### `query_snapshots`

**Purpose**: Search and browse snapshot history for the current project. Enables mid-session queries like "what did my state look like yesterday?" or "show me snapshots from the feature branch."

**Priority**: P1 (Extended tools — WP07, T039)

**Input**:
```json
{
  "branch": "feature/login-flow",
  "eventType": "commit",
  "since": "2026-02-15T00:00:00Z",
  "until": "2026-02-16T23:59:59Z",
  "limit": 10
}
```

All parameters are optional. When omitted:
- `branch`: current branch (from git)
- `eventType`: all types
- `since`/`until`: no time constraint
- `limit`: 20 (max: 100)

**Output**:
```json
{
  "total": 47,
  "returned": 10,
  "snapshots": [
    {
      "id": "snap_abc123",
      "timestamp": "2026-02-16T10:30:00Z",
      "eventType": "commit",
      "branch": "feature/login-flow",
      "summary": "3 files modified, 2 tests passing, 1 decision pending",
      "tags": ["pre-refactor"]
    }
  ]
}
```

Returns summary objects, not full snapshot payloads. Use `get_context` with a snapshot ID to load the full state.

**Error cases**:
- `invalid_timestamp`: `since`/`until` cannot be parsed as ISO 8601
- `limit_exceeded`: `limit` > 100
- `no_results`: Zero snapshots match the query (not an error — returns `{ total: 0, returned: 0, snapshots: [] }`)

**When Claude calls it**: When user asks about past state ("what was I working on yesterday?"), when reviewing session history, or when debugging state drift.

**Performance target**: <500ms for queries returning ≤20 results.

---

## CLI Commands (Deferred — Admin/Power Users)

> **Note**: CLI commands are deferred. They will be built after the MCP server is validated. The CLI is an admin/debugging tool for Tier 2 power users, not the primary interface. See `plan.md` Deferred Items table.

The following CLI commands will be implemented as thin wrappers around the same core logic that MCP tools use:

### `joyus-ai snapshot`

Capture a state snapshot. Maps to `save_state` MCP tool.

```
joyus-ai snapshot [--event=<type>] [--decision="<text>"] [--quiet]
```

| Arg | Type | Default | Description |
|-----|------|---------|-------------|
| `--event` | EventType | "manual" | What triggered this snapshot |
| `--decision` | string | null | Record a pending decision |
| `--quiet` | boolean | false | Suppress output (for hooks) |

**Exit codes**: 0 = success, 1 = error (logged, never blocks)

**Output** (unless `--quiet`):
```
Snapshot captured: 2026-02-16T14:30:00 [commit]
  Branch: feature/a11y-652 | Files: 3 modified | Tests: 12 pass, 2 fail
```

---

### `joyus-ai restore`

Display the most recent snapshot. Maps to `get_context` MCP tool.

```
joyus-ai restore [--format=<text|json>] [--id=<snapshot-id>]
```

**Output** (text format):
```
=== Session Context (from 2026-02-16T14:30:00, event: commit) ===

Branch: feature/a11y-652 (3 ahead of origin)
Last commit: abc1234 "Fix FilterPipeSeparators accessibility"

Modified files (not committed):
  - src/templates/navigation.html.twig
  - src/css/accessible-nav.css

Tests (last run):
  12 passed, 2 failed
  Failing: FilterPipeSeparatorsTest::testMobileNav, ThemeA11yTest::testAriaLabels

Pending decisions:
  - [OPEN] Should mobile nav use accordion or dropdown? (context: WCAG 2.1 AA requires...)

Canonical documents:
  - tracking-spreadsheet: test-files/accessibility-audit-tracking.csv (modified 2h ago)

===
```

---

### `joyus-ai status`

Show live context with divergence detection. Maps to `get_context` MCP tool with live enrichment.

```
joyus-ai status [--format=<text|json>]
```

---

### `joyus-ai canonical`

Manage canonical document declarations. Maps to `check_canonical` MCP tool.

```
joyus-ai canonical add <name> <path> [--branch=<branch>]
joyus-ai canonical remove <name>
joyus-ai canonical list
joyus-ai canonical check <file-path>
```

---

### `joyus-ai share` / `joyus-ai load`

Share and load state. Maps to `share_state` MCP tool.

```
joyus-ai share [--note="<what I was doing>"] [--output=<path>]
joyus-ai load <path> [--format=<text|json>]
```

---

### `joyus-ai config`

Manage settings (admin only).

```
joyus-ai config get <key>
joyus-ai config set <key> <value>
joyus-ai config list
joyus-ai config init
```

---

## Error Handling

All MCP tools and CLI commands follow these rules:

- **Never block**: Errors in state capture must not block the developer's work. Log the error, return gracefully.
- **MCP error responses**: MCP tools return structured error responses, never crash the server. Errors go to stderr (stdout is reserved for MCP protocol).
- **Exit code 0 on degraded** (CLI): If git state can't be fully collected (e.g., not a git repo), capture what's available and continue.
- **Schema validation**: Invalid snapshots are logged and skipped during restore. The system falls back to the next valid snapshot.
- **Concurrent access**: File-level locking (lockfile in state directory) prevents concurrent writes. Reads are always safe (atomic writes guarantee consistency).

---

## EventType Enum

Valid event types for snapshots:

| Event | Triggered By |
|-------|-------------|
| `commit` | Git commit detected |
| `branch-switch` | Git branch change detected |
| `test-run` | Test execution completed |
| `session-start` | New session begins |
| `session-end` | Clean session exit |
| `manual` | Explicit save_state call with no event |
| `share` | State exported for teammate |
| `file-change` | Significant file modification (companion service) |
| `compaction` | Session context compacted |
| `canonical-update` | Canonical document modified |
