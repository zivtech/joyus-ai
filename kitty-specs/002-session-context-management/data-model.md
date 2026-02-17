# Data Model: Session & Context Management

**Feature**: 002-session-context-management
**Date**: 2026-02-16

---

## Entities

### Snapshot

The core entity. Every snapshot is a complete, self-contained record of working context at a point in time. Any snapshot can serve as a handoff document.

| Field | Type | Description |
|-------|------|-------------|
| `id` | string | Unique ID (CUID2) |
| `version` | string | Schema version (semver, e.g., "1.0.0") |
| `timestamp` | string (ISO 8601) | When the snapshot was captured |
| `event` | EventType | What triggered this snapshot |
| `project` | ProjectContext | Project identification |
| `git` | GitState | Current git state |
| `files` | FileState | Modified/staged/untracked files |
| `task` | TaskContext \| null | Active task/ticket info |
| `tests` | TestResults \| null | Last test run results |
| `decisions` | Decision[] | Pending and resolved decisions |
| `canonical` | CanonicalStatus[] | Status of declared canonical documents |
| `sharer` | SharerNote \| null | Note from sharer (only present on shared snapshots) |

### EventType (enum)

```
commit | branch-switch | test-run | canonical-update |
session-start | session-end | manual | file-change | compaction | share
```

### ProjectContext

| Field | Type | Description |
|-------|------|-------------|
| `rootPath` | string | Absolute path to project root |
| `hash` | string | SHA256 hash of rootPath (first 16 chars) |
| `name` | string | Project name (from package.json, CLAUDE.md, or directory name) |

### GitState

| Field | Type | Description |
|-------|------|-------------|
| `branch` | string | Current branch name |
| `commitHash` | string | HEAD commit hash (short) |
| `commitMessage` | string | HEAD commit message (first line) |
| `isDetached` | boolean | Whether HEAD is detached |
| `hasUncommittedChanges` | boolean | Any staged or unstaged changes |
| `remoteBranch` | string \| null | Upstream tracking branch |
| `aheadBehind` | { ahead: number, behind: number } | Commits ahead/behind remote |

### FileState

| Field | Type | Description |
|-------|------|-------------|
| `staged` | string[] | Files staged for commit |
| `unstaged` | string[] | Modified but not staged |
| `untracked` | string[] | New files not yet tracked |

### TaskContext

| Field | Type | Description |
|-------|------|-------------|
| `id` | string | Ticket/task ID (e.g., "NCLCRS-323") |
| `title` | string | Task title/summary |
| `source` | string | Where the task comes from ("jira", "github", "spec-kitty", "manual") |
| `url` | string \| null | Link to task in external system |

### TestResults

| Field | Type | Description |
|-------|------|-------------|
| `runner` | string | Test runner name ("vitest", "phpunit", "pytest", etc.) |
| `passed` | number | Count of passing tests |
| `failed` | number | Count of failing tests |
| `skipped` | number | Count of skipped tests |
| `failingTests` | string[] | Names of failing tests (max 20) |
| `duration` | number | Total run time in seconds |
| `command` | string | The command that was run |

### Decision

| Field | Type | Description |
|-------|------|-------------|
| `id` | string | Unique ID (CUID2) |
| `question` | string | What was being decided |
| `context` | string | Why this decision matters / what prompted it |
| `options` | string[] | Alternatives considered (if known) |
| `answer` | string \| null | The chosen answer (null if pending) |
| `resolved` | boolean | Whether the decision has been made |
| `timestamp` | string (ISO 8601) | When the decision was recorded |
| `resolvedAt` | string (ISO 8601) \| null | When the decision was resolved |

### CanonicalStatus

| Field | Type | Description |
|-------|------|-------------|
| `name` | string | Human-readable document name ("tracking spreadsheet") |
| `canonicalPath` | string | Declared canonical file path |
| `exists` | boolean | Whether the file exists at that path |
| `lastModified` | string (ISO 8601) \| null | Last modification time of canonical file |
| `branchOverride` | string \| null | Override path for current branch (if set) |

### SharerNote

| Field | Type | Description |
|-------|------|-------------|
| `from` | string | Developer name or identifier |
| `note` | string | What they were trying to do |
| `sharedAt` | string (ISO 8601) | When the state was shared |

---

## Configuration Entities

### GlobalConfig (`~/.joyus-ai/global-config.json`)

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `retentionDays` | number | 7 | Days to retain snapshots |
| `retentionMaxBytes` | number | 52428800 | Max total snapshot storage (50MB) |
| `autoRestore` | boolean | true | Show state summary on session start |
| `verbosity` | "minimal" \| "normal" \| "verbose" | "normal" | How much detail in restore output |

### ProjectConfig (`.joyus-ai/config.json` in project root)

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `eventTriggers` | EventTriggerConfig | (see below) | Which events trigger snapshots |
| `customTriggers` | string[] | [] | Additional trigger patterns |
| `periodicIntervalMinutes` | number | 15 | Minutes between periodic snapshots during active work |

### EventTriggerConfig

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `commit` | boolean | true | Snapshot on git commit |
| `branchSwitch` | boolean | true | Snapshot on branch switch |
| `testRun` | boolean | true | Snapshot after test execution |
| `canonicalUpdate` | boolean | true | Snapshot when canonical doc modified |
| `sessionEnd` | boolean | true | Snapshot on clean session end |

### CanonicalDeclaration (`.joyus-ai/canonical.json` in project root)

```json
{
  "documents": {
    "tracking-spreadsheet": {
      "default": "NCLC-test-files/accessibility-audit-tracking.csv",
      "branches": {
        "feature/a11y-652": "data/tracking.csv"
      }
    },
    "accessibility-todo": {
      "default": "docs/accessibility-fixes-todo.md"
    }
  }
}
```

---

## State Transitions

### Snapshot Lifecycle

```
[Event occurs] → collect() → validate(schema) → write(atomic) → prune(retention)
                                                         ↓
                                                  [Next session]
                                                         ↓
                                                  restore(latest) → display(formatted)
```

### Decision Lifecycle

```
[Decision identified] → append(pending) → [included in next snapshot]
                                                    ↓
                            [Decision resolved] → mark(resolved, answer)
                                                    ↓
                                            [included in next snapshot]
```

### Share Lifecycle

```
[Developer A] → share(snapshot + note) → write(shared/outgoing/)
                                                    ↓
                    [Transfer: file copy, chat, or future API]
                                                    ↓
[Developer B] → load(shared state) → display(state + note) → [resume work]
```

---

## Relationships

```
Snapshot 1──* Decision          (snapshot contains 0+ decisions)
Snapshot 1──* CanonicalStatus   (snapshot contains 0+ canonical statuses)
Snapshot 1──1 GitState          (snapshot always has git state)
Snapshot 1──1 FileState         (snapshot always has file state)
Snapshot 1──? TaskContext        (snapshot optionally has active task)
Snapshot 1──? TestResults        (snapshot optionally has test results)
Snapshot 1──? SharerNote         (only on shared snapshots)

ProjectConfig 1──1 EventTriggerConfig
ProjectConfig 1──* CanonicalDeclaration
```

---

## Validation Rules

- `Snapshot.version` must match a supported schema version (for forward compatibility)
- `Snapshot.timestamp` must be valid ISO 8601
- `GitState.branch` must be non-empty (or `isDetached: true`)
- `Decision.answer` must be non-null when `resolved: true`
- `CanonicalDeclaration.default` path must be relative to project root
- `TestResults.failingTests` capped at 20 entries (truncate with count note)
- Snapshot file size must not exceed 1MB (safety limit — typical is 2-10KB)
