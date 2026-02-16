---
work_package_id: WP06
title: State Sharing
lane: planned
dependencies:
- WP01
subtasks:
- T022
- T023
- T024
phase: Phase 3 - Extended Features
assignee: ''
agent: ''
shell_pid: ''
review_status: ''
reviewed_by: ''
history:
- timestamp: '2026-02-16T19:42:12Z'
  lane: planned
  agent: system
  shell_pid: ''
  action: Prompt generated via /spec-kitty.tasks
---

# Work Package Prompt: WP06 -- State Sharing

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
- Build `jawn-ai share` and `jawn-ai load` CLI commands
- **Done when**: Developer A shares state with a note; Developer B loads it and sees full context including the note prominently displayed

## Context & Constraints

- **Spec**: User Story 6 (Share State for Troubleshooting), FR-015
- **Data Model**: `SharerNote` type in `data-model.md`
- **Research**: R7 -- file-based export/import for v1; API-based sync as future adapter
- **Contracts**: `state-api.md` -- `jawn-ai share` and `jawn-ai load` command signatures
- **Shared state location**: `.jawn-ai/shared/outgoing/<timestamp>-share.json` (writable by sharer, readable by teammate)
- **File transfer**: v1 is manual (file copy, chat, email). Future: API-based via remote MCP server adapter.
- **Depends on**: WP01 (types), WP02 (store), WP04 (CLI framework, formatters)

**Implementation command**: `spec-kitty implement WP06 --base WP04`

## Subtasks & Detailed Guidance

### Subtask T022 -- Share state export

- **Purpose**: Allow a developer to package their current state (latest snapshot + a personal note) into a shareable file.
- **Steps**:
  1. Create `src/state/share.ts` with:
     ```typescript
     export interface ShareOptions {
       projectRoot: string;
       note?: string;
       outputPath?: string;
     }

     export async function exportSharedState(options: ShareOptions): Promise<{
       sharedFile: string;
       note: string;
     }>;
     ```
  2. Implementation:
     - Load the latest snapshot from the state store
     - If no snapshot exists, take a fresh snapshot first (call the snapshot collector flow)
     - Create a `SharerNote`:
       - `from`: Current OS username (`os.userInfo().username`) or git user name (`git config user.name`)
       - `note`: From options, or prompt if running interactively
       - `sharedAt`: Current ISO 8601 timestamp
     - Clone the snapshot and add the `sharer` field
     - Change the event type to `"share"`
     - Determine output path:
       - Default: `.jawn-ai/shared/outgoing/<timestamp>-share.json`
       - Custom: from `--output` flag
     - Ensure output directory exists
     - Write atomically (temp + rename)
     - Return the file path and note text
  3. The shared file is a valid Snapshot JSON with the `sharer` field populated

- **Files**:
  - `jawn-ai-state/src/state/share.ts` (new)
  - `jawn-ai-state/src/index.ts` (update exports)

- **Parallel?**: Yes -- can develop alongside T023 (they're export vs import).
- **Notes**: The shared file should be self-contained. The recipient doesn't need access to the sharer's state store -- everything is in the single file. The `sharer.from` field helps the recipient know who shared it.

---

### Subtask T023 -- Load shared state import

- **Purpose**: Allow a developer to load a shared state file from a teammate and see the full context with the sharer's note prominently displayed.
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
     - Validate with `SnapshotSchema`
     - If validation fails: return a clear error message about what's wrong
     - Extract the `sharer` field (may be null if it's a regular snapshot, not a shared one)
     - Return the snapshot and sharer note
  3. The caller (CLI command) handles display formatting
  4. Optionally copy the loaded file to `.jawn-ai/shared/incoming/` for record-keeping

- **Files**:
  - `jawn-ai-state/src/state/share.ts` (update)

- **Parallel?**: Yes -- can develop alongside T022.
- **Notes**: The loader should accept any valid snapshot file, not just files from the `shared/` directory. A user might receive the file via chat, email, or a shared drive. If the file lacks a `sharer` field, display it as a regular restore (no note).

---

### Subtask T024 -- `jawn-ai share` and `jawn-ai load` CLI commands

- **Purpose**: User-facing CLI commands that call the share/load functions.
- **Steps**:
  1. Create `src/cli/commands/share.ts`:
     ```
     jawn-ai share [--note="<what I was doing>"] [--output=<path>]
     ```
     - Call `exportSharedState()` with options from flags
     - If `--note` not provided, prompt the user (readline) with: "What were you working on? (brief note for your teammate)"
     - Print confirmation matching the `state-api.md` format:
       ```
       State shared: .jawn-ai/shared/outgoing/2026-02-16T14-30-00-share.json
       Note: "stuck on filter tests -- 2 failures I can't figure out"
       Send this file to your teammate, or they can run:
         jawn-ai load .jawn-ai/shared/outgoing/2026-02-16T14-30-00-share.json
       ```
  2. Create `src/cli/commands/load.ts`:
     ```
     jawn-ai load <path> [--format=<text|json>]
     ```
     - Call `loadSharedState()` with the file path
     - If `--format=json`: print raw JSON
     - If `--format=text` (default): use `formatSharedState()` from formatters (WP04 T017)
     - The output prominently shows the sharer note before the context:
       ```
       === Shared Context from Alex (shared 2026-02-16T14:30:00) ===
       Note: "stuck on filter tests -- 2 failures I can't figure out"

       Branch: feature/a11y-652 (3 ahead of origin)
       ...
       ```

- **Files**:
  - `jawn-ai-state/src/cli/commands/share.ts` (new)
  - `jawn-ai-state/src/cli/commands/load.ts` (new)

- **Parallel?**: No -- depends on T022 and T023 being complete.
- **Notes**: The `share` command should work even without a note (note is optional but encouraged). If running non-interactively (piped stdin), skip the prompt and use an empty note.

---

## Risks & Mitigations

| Risk | Mitigation |
|------|-----------|
| File transfer is manual and error-prone | v1 limitation; document clearly. Future API sync via adapter. |
| Shared file contains sensitive data | Shared files contain git state and file lists, not file contents. Document this. |
| Recipient on different project | Shared state includes `project.name` -- warn if it doesn't match recipient's project. |
| Large shared files | Snapshot size is capped at 1MB by schema validation |

## Review Guidance

- Verify shared file is a valid Snapshot that passes `SnapshotSchema` validation
- Verify `sharer` field is populated with OS username/git name
- Verify `load` handles both shared snapshots (with note) and regular snapshots (without note)
- Verify `share` prompts for note when not provided via flag
- Verify output format matches `state-api.md` contract
- Verify file paths are handled correctly (absolute, relative, tilde expansion)

## Activity Log

- 2026-02-16T19:42:12Z -- system -- lane=planned -- Prompt created.
