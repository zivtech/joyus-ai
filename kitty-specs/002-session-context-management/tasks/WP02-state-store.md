---
work_package_id: WP02
title: State Store
lane: planned
dependencies:
- WP01
subtasks:
- T005
- T006
- T007
- T008
phase: Phase 1 - Foundation
assignee: ''
agent: ''
shell_pid: ''
review_status: ''
reviewed_by: ''
history:
- timestamp: '2026-02-17T03:14:10Z'
  lane: planned
  agent: system
  shell_pid: ''
  action: Prompt generated via /spec-kitty.tasks (MCP-first architecture)
---

# Work Package Prompt: WP02 -- State Store

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

- Implement atomic read/write of snapshot JSON files to disk
- Create snapshot listing with date, event, and branch filters
- Initialize per-project state directory structure
- Detect divergence between stored state and live project state
- **Done when**: Can write a snapshot atomically, read it back, list/filter snapshots, detect branch divergence

## Context & Constraints

- **Plan**: Storage at `~/.joyus-ai/projects/<project-hash>/snapshots/`
- **Data Model**: `data-model.md` — Snapshot entity, ProjectContext.hash
- **Spec FR-006**: Survive dirty exits (atomic writes ensure this)
- **Spec FR-009**: Handle concurrent sessions (locking deferred to WP09, atomic writes prevent corruption)
- **Spec FR-011**: Fall back gracefully on corrupted/missing state
- **Performance**: Snapshot write <100ms (non-blocking)
- **Depends on**: WP01 (types, schemas, config)

**Implementation command**: `spec-kitty implement WP02 --base WP01`

## Subtasks & Detailed Guidance

### Subtask T005 -- Atomic snapshot write

- **Purpose**: Write snapshot files atomically so crashes mid-write never produce corrupted files. This is the foundation of crash safety (FR-006).
- **Steps**:
  1. Create `src/state/store.ts`:
     ```typescript
     export class StateStore {
       constructor(private stateDir: string) {}

       async write(snapshot: Snapshot): Promise<string>;
       async readLatest(): Promise<Snapshot | null>;
       async readById(id: string): Promise<Snapshot | null>;
       async list(filter?: SnapshotFilter): Promise<SnapshotSummary[]>;
     }
     ```
  2. `write()` implementation:
     - Validate snapshot with `SnapshotSchema.parse()` — reject invalid data before writing
     - Generate filename: `<ISO-timestamp>.json` (replace colons with dashes for filesystem safety)
     - If filename already exists (rapid snapshots), append `-<cuid2-suffix>`
     - Write to a temp file: `<filename>.tmp` in the snapshots directory
     - Use `fs.writeFile()` with `JSON.stringify(snapshot, null, 2)` for readability
     - Rename temp file to final filename with `fs.rename()` (atomic on same filesystem)
     - Return the snapshot ID
  3. Ensure the snapshots directory exists before writing (create if missing)
  4. Never throw on write failure — log error, return gracefully

- **Files**:
  - `joyus-ai-state/src/state/store.ts` (new)

- **Parallel?**: No -- T006 depends on the write pattern being established.

---

### Subtask T006 -- Snapshot read and listing

- **Purpose**: Read snapshots back from disk — latest, by ID, or filtered list. This is used by `get_context` (latest), `save_state` (carry-forward decisions), and future query features.
- **Steps**:
  1. Add to `src/state/store.ts`:
     ```typescript
     export interface SnapshotFilter {
       since?: string;     // ISO 8601
       until?: string;     // ISO 8601
       event?: EventType;
       branch?: string;
       limit?: number;     // default: 10
     }

     export interface SnapshotSummary {
       id: string;
       timestamp: string;
       event: EventType;
       branch: string;
       commitMessage: string;
     }
     ```
  2. `readLatest()`:
     - List all `.json` files in snapshots directory (not `.tmp` files)
     - Sort by filename descending (timestamps are sortable)
     - Read and parse the first valid file
     - If the first file is corrupted (invalid JSON or schema), log warning and try next
     - Return null if no valid snapshots exist
  3. `readById()`:
     - Scan filenames or read all and match by `id` field
     - Return null if not found
  4. `list()`:
     - Read all snapshot files (or use filename timestamps for pre-filtering)
     - Apply filters: since/until (timestamp range), event type, branch name
     - Return `SnapshotSummary` objects (not full snapshots — performance)
     - Apply limit (default 10)
     - Sort by timestamp descending (newest first)
  5. Handle corrupted files: skip with warning, never crash

- **Files**:
  - `joyus-ai-state/src/state/store.ts` (update)

- **Parallel?**: No -- depends on T005 write pattern.
- **Notes**: For the listing, consider reading only the first few lines of each file (id, timestamp, event, branch) rather than parsing the entire snapshot. But for v1, full parse is fine given small file sizes (2-10KB).

---

### Subtask T007 -- State directory initialization

- **Purpose**: Create the per-project state directory structure when a project is first set up. Also used to create shared state directories.
- **Steps**:
  1. Create a utility function in `src/state/store.ts` or separate `src/state/init.ts`:
     ```typescript
     export async function initStateDirectory(projectRoot: string): Promise<string>;
     export function getProjectHash(projectRoot: string): string;
     export function getStateDir(projectRoot: string): string;
     ```
  2. `getProjectHash()`: SHA256 of the absolute, normalized project root path. Take first 16 hex chars.
  3. `getStateDir()`: Returns `~/.joyus-ai/projects/<hash>/`
  4. `initStateDirectory()`:
     - Compute project hash
     - Create directory tree:
       ```
       ~/.joyus-ai/
       └── projects/
           └── <hash>/
               ├── snapshots/
               ├── shared/
               │   ├── incoming/
               │   └── outgoing/
               └── config.json    (empty defaults if not exists)
       ```
     - Also create `.joyus-ai/` in project root if it doesn't exist:
       ```
       .joyus-ai/
       ├── config.json      (empty defaults if not exists)
       └── canonical.json   (empty { "documents": {} } if not exists)
       ```
     - Use `fs.mkdir` with `{ recursive: true }` for safe creation
     - Return the state directory path
  5. Export from `src/index.ts`

- **Files**:
  - `joyus-ai-state/src/state/store.ts` or `src/state/init.ts` (new/update)
  - `joyus-ai-state/src/index.ts` (update exports)

- **Parallel?**: Yes -- independent of T005/T006.

---

### Subtask T008 -- Divergence detection

- **Purpose**: Detect when the stored snapshot no longer matches the live project state. Used by `get_context` to warn Claude that the state has changed since the last snapshot.
- **Steps**:
  1. Create `src/state/divergence.ts`:
     ```typescript
     export interface DivergenceReport {
       diverged: boolean;
       changes: DivergenceChange[];
     }

     export interface DivergenceChange {
       field: string;           // 'branch', 'commitHash', 'files'
       stored: string;          // value from snapshot
       live: string;            // current value
       severity: 'info' | 'warning' | 'critical';
     }

     export async function detectDivergence(
       snapshot: Snapshot,
       liveGit: GitState,
       liveFiles: FileState
     ): Promise<DivergenceReport>;
     ```
  2. Compare fields:
     - Branch changed: **critical** (might commit to wrong branch)
     - Commit hash changed: **warning** (someone committed outside the session)
     - Modified files changed: **info** (files were edited outside the session)
  3. Return `{ diverged: false, changes: [] }` if no divergence
  4. Export from `src/index.ts`

- **Files**:
  - `joyus-ai-state/src/state/divergence.ts` (new)
  - `joyus-ai-state/src/index.ts` (update exports)

- **Parallel?**: No -- depends on T005/T006 for reading stored snapshot, and on WP03 collectors for live state. But the function itself can be written against the types.
- **Notes**: Divergence detection is called by `get_context` MCP tool (WP06). The function is pure — it takes a snapshot and live state as inputs, not fetching them itself.

---

## Risks & Mitigations

| Risk | Mitigation |
|------|-----------|
| Atomic rename fails on cross-filesystem | Temp file in same directory as target. `fs.rename` is atomic on same FS. |
| Rapid snapshots produce filename collisions | Append CUID2 suffix when timestamp collides. |
| Large snapshots directory slows listing | Snapshots are 2-10KB. Thousands before perf matters. Defer optimization. |
| Corrupted snapshot blocks restore | Skip corrupted files, try next valid one. Log warning. |

## Review Guidance

- Verify atomic write pattern: if process is killed mid-write, no corrupted `.json` files exist (only `.tmp` stubs)
- Verify `readLatest()` skips corrupted files and returns the next valid snapshot
- Verify `list()` filters work: date range, event type, branch, limit
- Verify directory initialization creates all expected directories
- Verify `getProjectHash()` is deterministic for the same path
- Verify all functions handle missing directories gracefully (create on demand)

## Activity Log

- 2026-02-17T03:14:10Z -- system -- lane=planned -- Prompt created.
