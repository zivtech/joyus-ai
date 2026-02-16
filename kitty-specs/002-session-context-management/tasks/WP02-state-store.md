---
work_package_id: "WP02"
subtasks:
  - "T005"
  - "T006"
  - "T007"
title: "State Store & Retention"
phase: "Phase 0 - Foundation"
lane: "planned"
assignee: ""
agent: ""
shell_pid: ""
review_status: ""
reviewed_by: ""
dependencies: ["WP01"]
history:
  - timestamp: "2026-02-16T19:42:12Z"
    lane: "planned"
    agent: "system"
    shell_pid: ""
    action: "Prompt generated via /spec-kitty.tasks"
---

# Work Package Prompt: WP02 -- State Store & Retention

## IMPORTANT: Review Feedback Status

**Read this first if you are implementing this task!**

- **Has review feedback?**: Check the `review_status` field above. If it says `has_feedback`, scroll to the **Review Feedback** section immediately.
- **You must address all feedback** before your work is complete.
- **Mark as acknowledged**: When you understand the feedback and begin addressing it, update `review_status: acknowledged` in the frontmatter.

---

## Review Feedback

> **Populated by `/spec-kitty.review`**

*[This section is empty initially.]*

---

## Markdown Formatting
Wrap HTML/XML tags in backticks: `` `<div>` ``, `` `<script>` ``
Use language identifiers in code blocks: ````python`, ````bash`

---

## Objectives & Success Criteria

- Implement the on-disk state store with atomic writes (temp file + rename)
- Support reading the latest snapshot, listing all snapshots, and querying by criteria
- Enforce retention policy (7-day window + 50MB cap, oldest-first pruning)
- Detect when stored state diverges from the live git state
- **Done when**: Can write a snapshot, read it back, list snapshots, prune old ones, and detect divergence from live git state

## Context & Constraints

- **Data Model**: `kitty-specs/002-session-context-management/data-model.md`
- **Research**: `kitty-specs/002-session-context-management/research.md` (R2: atomic writes, R3: project hash)
- **Contracts**: `kitty-specs/002-session-context-management/contracts/state-api.md`
- **Storage path**: `~/.jawn-ai/projects/<hash>/snapshots/<timestamp>.json`
- **Atomic writes**: Write to `.tmp` suffix in same directory, then `fs.rename()` (POSIX-atomic) -- Research R2
- **Retention**: 7-day default + 50MB safety cap. Snapshots are 2-10KB each. Retention runs inline after each write.
- **Concurrent access**: Use a lockfile in the state directory to prevent concurrent writes. Reads are always safe (atomic writes guarantee consistency).
- **Depends on WP01**: Uses types from `core/types.ts`, schemas from `core/schema.ts`, and `getStateDir`/`ensureStateDir` from `core/config.ts`

**Implementation command**: `spec-kitty implement WP02 --base WP01`

## Subtasks & Detailed Guidance

### Subtask T005 -- Implement state store (atomic write, read, list)

- **Purpose**: The state store is the persistence layer that all commands and tools write to and read from. Reliability is critical -- corrupted state defeats the entire feature.
- **Steps**:
  1. Create `src/state/store.ts` with the following interface:
     ```typescript
     export interface StateStore {
       write(snapshot: Snapshot): Promise<void>;
       readLatest(): Promise<Snapshot | null>;
       readById(id: string): Promise<Snapshot | null>;
       list(options?: { since?: Date; until?: Date; event?: EventType; branch?: string; limit?: number }): Promise<SnapshotSummary[]>;
     }
     ```
  2. Implement `SnapshotSummary` type (lightweight): `{ id, timestamp, event, branch, commitMessage }`
  3. Implement `write()`:
     - Generate filename from timestamp: `YYYY-MM-DDTHH-MM-SS.json` (replace colons with hyphens for filesystem safety)
     - Serialize snapshot to JSON with 2-space indentation
     - Validate against `SnapshotSchema` before writing (reject invalid snapshots)
     - Check file size does not exceed 1MB safety limit
     - Write to `<snapshots-dir>/<timestamp>.tmp`
     - `fs.rename()` the `.tmp` file to the final `.json` filename
     - Acquire lockfile before write, release after rename
  4. Implement `readLatest()`:
     - List all `.json` files in snapshots directory
     - Sort by filename (timestamps sort lexicographically)
     - Read and validate the newest file
     - If validation fails, try the next newest (skip corrupt snapshots per FR-011)
     - Return `null` if no valid snapshots exist
  5. Implement `readById()`:
     - Scan filenames for matching ID (each snapshot has an `id` field)
     - Read and validate the matching file
  6. Implement `list()`:
     - Read all snapshot files (stat for timestamps, parse only metadata fields)
     - Filter by `since`, `until`, `event`, `branch` criteria
     - Sort by timestamp descending
     - Apply `limit` (default 10)
     - Return `SnapshotSummary[]` (not full snapshots -- for performance)
  7. Use a simple lockfile mechanism: create `<state-dir>/snapshot.lock` with PID. Check for stale locks (PID no longer running). Timeout after 5 seconds.

- **Files**:
  - `jawn-ai-state/src/state/store.ts` (new)
  - `jawn-ai-state/src/index.ts` (update exports)

- **Parallel?**: No -- T006 and T007 depend on the store interface.
- **Notes**: Never throw on read errors -- return `null` or empty arrays. Log warnings for corrupt/unreadable files. Use `cuid2` for snapshot IDs (add `@paralleldrive/cuid2` to dependencies).

---

### Subtask T006 -- Implement retention policy

- **Purpose**: Prevent unbounded disk growth. Snapshots are cheap (2-10KB) but accumulate over weeks of active work.
- **Steps**:
  1. Create `src/state/retention.ts` with:
     ```typescript
     export async function enforceRetention(
       snapshotsDir: string,
       config: { retentionDays: number; retentionMaxBytes: number }
     ): Promise<{ pruned: number; freedBytes: number }>;
     ```
  2. Implementation:
     - List all `.json` files in `snapshotsDir` with `fs.stat()` for size and mtime
     - Calculate total size
     - **Time-based pruning**: Delete files older than `retentionDays` (7 default)
     - **Size-based pruning**: If total size still exceeds `retentionMaxBytes` (50MB default), delete oldest files until under the cap
     - Always keep at least the 1 most recent snapshot (never prune everything)
     - Return count of pruned files and freed bytes for logging
  3. Integrate with the store's `write()` method: call `enforceRetention()` after each successful write
  4. Handle filesystem errors gracefully (log and continue if a file can't be deleted)

- **Files**:
  - `jawn-ai-state/src/state/retention.ts` (new)

- **Parallel?**: Yes -- can develop alongside T007 once T005 establishes the store.
- **Notes**: Retention runs inline (not as a separate process). It's fast because it only does `stat()` + `unlink()`. The 50MB cap is a safety net -- typical usage is 5-10MB for a week of active work.

---

### Subtask T007 -- Implement divergence detection

- **Purpose**: Detect when the stored state no longer matches the live project state (e.g., user switched branches in a separate terminal). Supports FR-012.
- **Steps**:
  1. Create `src/state/divergence.ts` with:
     ```typescript
     export interface DivergenceReport {
       isDiverged: boolean;
       fields: DivergenceField[];
     }

     export interface DivergenceField {
       field: string;         // e.g., "branch", "commitHash", "hasUncommittedChanges"
       stored: string;        // value from snapshot
       actual: string;        // value from live git
     }

     export async function detectDivergence(
       snapshot: Snapshot,
       liveGitState: GitState
     ): Promise<DivergenceReport>;
     ```
  2. Compare the following fields between `snapshot.git` and `liveGitState`:
     - `branch` (most critical -- wrong-branch work is the #1 pain point)
     - `commitHash` (indicates new commits since snapshot)
     - `hasUncommittedChanges` (indicates new or discarded changes)
     - `isDetached` (detached HEAD state changed)
  3. Return a `DivergenceReport` with specific field-level diffs
  4. The caller (restore/status commands) decides how to present divergence to the user

- **Files**:
  - `jawn-ai-state/src/state/divergence.ts` (new)
  - `jawn-ai-state/src/index.ts` (update exports)

- **Parallel?**: Yes -- can develop alongside T006. Depends on T005 for Snapshot type but not for the store itself.
- **Notes**: This module does NOT collect live git state -- it receives it as a parameter. The git collector (WP03 T008) provides the live state. This keeps divergence detection pure and easy to test.

---

## Risks & Mitigations

| Risk | Mitigation |
|------|-----------|
| Concurrent writes from multiple hooks | Lockfile with PID tracking and stale lock detection |
| Partial writes on crash | Atomic write pattern: temp file + rename |
| Snapshot directory doesn't exist | `ensureStateDir()` from config module creates it |
| Corrupt snapshot blocks restore | `readLatest()` skips corrupt files, tries next |
| Retention deletes actively-used snapshot | Always keep at least 1 most recent snapshot |

## Review Guidance

- Verify atomic write pattern: write to `.tmp`, then `fs.rename()` -- never write directly to final filename
- Verify lockfile handles stale locks (check if PID is still running)
- Verify retention never deletes the most recent snapshot
- Verify `readLatest()` gracefully handles corrupt files (skip, try next)
- Verify `list()` doesn't read full snapshot content (performance -- use stat/metadata only)
- Verify all filesystem operations handle errors without throwing

## Activity Log

- 2026-02-16T19:42:12Z -- system -- lane=planned -- Prompt created.
