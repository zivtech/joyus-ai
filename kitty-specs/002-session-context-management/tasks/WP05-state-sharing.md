---
work_package_id: WP05
title: State Sharing
lane: planned
dependencies:
- WP01
subtasks:
- T017
- T018
- T019
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

# Work Package Prompt: WP05 -- State Sharing

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

- Enable developers to export their session state with a note for a teammate
- Enable teammates to load shared state and see full context plus the sharer's note
- Manage shared state directories (incoming/outgoing)
- **Done when**: Developer A exports state with a note; Developer B loads it and sees full context including the note

## Context & Constraints

- **Spec**: User Story 6 (Share State for Troubleshooting), FR-015
- **Data Model**: `SharerNote` type in `data-model.md`
- **Contracts**: `contracts/state-api.md` — `share_state` MCP tool uses this module
- **Shared state location**: `~/.joyus-ai/projects/<hash>/shared/outgoing/<timestamp>-share.json`
- **File transfer**: v1 is manual (file copy, chat, email). Future: API-based via remote MCP server.
- **Depends on**: WP01 (types, schemas), WP02 (state store for reading latest snapshot)

**Implementation command**: `spec-kitty implement WP05 --base WP02`

## Subtasks & Detailed Guidance

### Subtask T017 -- Share state export

- **Purpose**: Package the latest snapshot with a sharer note into a self-contained file that a teammate can load.
- **Steps**:
  1. Create `src/state/share.ts`:
     ```typescript
     export interface ShareOptions {
       projectRoot: string;
       note: string;
       outputPath?: string;
     }

     export async function exportSharedState(options: ShareOptions): Promise<{
       sharedFile: string;
       note: string;
     }>;
     ```
  2. Implementation:
     - Load the latest snapshot from the state store
     - If no snapshot exists, throw an error (caller should capture a fresh snapshot first)
     - Create a `SharerNote`:
       - `from`: `os.userInfo().username` or fallback to `git config user.name`
       - `note`: from options
       - `sharedAt`: current ISO 8601 timestamp
     - Clone the snapshot (deep copy) and set `sharer` field
     - Change the event type to `"share"`
     - Generate a new ID (CUID2) for the shared snapshot
     - Determine output path:
       - Default: `~/.joyus-ai/projects/<hash>/shared/outgoing/<timestamp>-share.json`
       - Custom: from `options.outputPath`
     - Ensure output directory exists
     - Write atomically (temp + rename)
     - Return the file path and note text
  3. The shared file is a valid Snapshot that passes `SnapshotSchema` validation

- **Files**:
  - `joyus-ai-state/src/state/share.ts` (new)
  - `joyus-ai-state/src/index.ts` (update exports)

- **Parallel?**: Yes -- can develop alongside T018.
- **Notes**: The shared file must be self-contained. The recipient doesn't need access to the sharer's state store.

---

### Subtask T018 -- Load shared state import

- **Purpose**: Load a shared state file from a teammate, validate it, and extract the sharer's note for display.
- **Steps**:
  1. Add to `src/state/share.ts`:
     ```typescript
     export interface LoadResult {
       snapshot: Snapshot;
       sharerNote: SharerNote | null;
     }

     export async function loadSharedState(filePath: string): Promise<LoadResult>;
     ```
  2. Implementation:
     - Read the file at the given path
     - Parse JSON (handle parse errors gracefully)
     - Validate with `SnapshotSchema.safeParse()`
     - If validation fails: throw with clear error message about what's wrong
     - Extract the `sharer` field (may be null if it's a regular snapshot, not a shared one)
     - Return the snapshot and sharer note
  3. Optionally copy the loaded file to `~/.joyus-ai/projects/<hash>/shared/incoming/` for record-keeping
  4. Accept any valid snapshot file — not just files from the shared/ directory

- **Files**:
  - `joyus-ai-state/src/state/share.ts` (update)

- **Parallel?**: Yes -- can develop alongside T017.
- **Notes**: If the file lacks a `sharer` field, return it as a regular snapshot with `sharerNote: null`. This allows loading any snapshot file, not just shared ones.

---

### Subtask T019 -- Shared state directory management

- **Purpose**: Utility functions for managing shared state directories — ensuring they exist, file naming conventions, and cleanup.
- **Steps**:
  1. Add to `src/state/share.ts`:
     ```typescript
     export function getSharedOutgoingDir(stateDir: string): string;
     export function getSharedIncomingDir(stateDir: string): string;
     export async function ensureSharedDirs(stateDir: string): Promise<void>;
     export function generateShareFilename(): string;
     ```
  2. `getSharedOutgoingDir()`: Returns `<stateDir>/shared/outgoing/`
  3. `getSharedIncomingDir()`: Returns `<stateDir>/shared/incoming/`
  4. `ensureSharedDirs()`: Create both directories if they don't exist (`mkdir -p`)
  5. `generateShareFilename()`: Returns `<ISO-timestamp>-share.json` with filesystem-safe characters

- **Files**:
  - `joyus-ai-state/src/state/share.ts` (update)

- **Parallel?**: Yes -- utility functions used by T017 and T018.

---

## Risks & Mitigations

| Risk | Mitigation |
|------|-----------|
| File transfer is manual and error-prone | v1 limitation; document clearly. Future API sync via adapter. |
| Shared file contains sensitive data | Shared files contain git metadata and file lists, not file contents. Document this. |
| Recipient on different project | Shared state includes `project.name` — caller should warn if it doesn't match. |
| Corrupted shared file | Schema validation catches invalid files with clear error messages. |

## Review Guidance

- Verify shared file is a valid Snapshot that passes `SnapshotSchema` validation
- Verify `sharer` field is populated with OS username or git user name
- Verify `load` handles both shared snapshots (with sharer note) and regular snapshots (without)
- Verify file paths are handled correctly (absolute, relative, tilde expansion)
- Verify atomic writes prevent corruption
- Verify shared directories are created on demand

## Activity Log

- 2026-02-17T03:14:10Z -- system -- lane=planned -- Prompt created.
