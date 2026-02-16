---
work_package_id: WP05
title: Canonical Document Management
lane: planned
dependencies:
- WP01
subtasks:
- T018
- T019
- T020
- T021
phase: Phase 2 - CLI & Features
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

# Work Package Prompt: WP05 -- Canonical Document Management

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

- Implement CRUD operations for canonical document declarations
- Build CLI commands: `jawn-ai canonical add|remove|list|check`
- Support per-branch overrides for canonical paths
- Warn users when accessing a non-canonical copy of a declared document
- **Done when**: Can declare canonical sources, check files against them, get warnings for non-canonical access, and branch overrides work correctly

## Context & Constraints

- **Spec**: User Story 2 (Canonical Document Declaration), FR-004, FR-005
- **Data Model**: `CanonicalDeclaration` format in `data-model.md`
- **Research**: R6 -- `canonical.json` in project root `.jawn-ai/`, committed to git
- **Contracts**: `state-api.md` -- `jawn-ai canonical add|remove|list|check` signatures and output formats
- **Storage**: `.jawn-ai/canonical.json` in project root (committed to git -- team-shared)
- **Format**: `{ "documents": { "<name>": { "default": "<path>", "branches": { "<branch>": "<path>" } } } }`
- **Depends on**: WP01 (types), WP02 (store -- canonical status in snapshots)

**Implementation command**: `spec-kitty implement WP05 --base WP02`

## Subtasks & Detailed Guidance

### Subtask T018 -- Canonical declaration CRUD

- **Purpose**: Core logic for managing canonical document declarations. This is the data layer -- CLI commands (T019) call these functions.
- **Steps**:
  1. Create `src/state/canonical.ts` with:
     ```typescript
     export interface CanonicalDeclarations {
       documents: Record<string, {
         default: string;
         branches?: Record<string, string>;
       }>;
     }

     export async function loadCanonical(projectRoot: string): Promise<CanonicalDeclarations>;
     export async function saveCanonical(projectRoot: string, declarations: CanonicalDeclarations): Promise<void>;
     export function addDeclaration(declarations: CanonicalDeclarations, name: string, path: string): CanonicalDeclarations;
     export function removeDeclaration(declarations: CanonicalDeclarations, name: string): CanonicalDeclarations;
     export function listDeclarations(declarations: CanonicalDeclarations): Array<{ name: string; defaultPath: string; branchOverrides: string[] }>;
     export function checkPath(declarations: CanonicalDeclarations, filePath: string, currentBranch: string): CheckResult;
     ```
  2. `CheckResult` type:
     ```typescript
     export interface CheckResult {
       isCanonical: boolean;
       canonicalName: string | null;    // null if no declaration matches
       canonicalPath: string | null;    // resolved path (considering branch overrides)
       suggestion: string | null;       // human-readable suggestion
     }
     ```
  3. `loadCanonical()`: Read `.jawn-ai/canonical.json`. Return `{ documents: {} }` if missing.
  4. `saveCanonical()`: Write atomically (temp + rename) to `.jawn-ai/canonical.json`
  5. `addDeclaration()`: Add a new entry (or replace existing) under the given name
  6. `removeDeclaration()`: Remove by name. Warn if name doesn't exist.
  7. `listDeclarations()`: Return a flat list of all declarations with their branch overrides
  8. `checkPath()`: Given a file path, check if it matches any declaration:
     - First check branch overrides for the current branch
     - Then check default paths
     - If path matches a canonical declaration: `isCanonical: true`
     - If path matches a known document but isn't the canonical copy: `isCanonical: false` with redirect suggestion
     - If path doesn't match anything: `isCanonical: false`, `canonicalName: null` (no match)

- **Files**:
  - `jawn-ai-state/src/state/canonical.ts` (new)
  - `jawn-ai-state/src/index.ts` (update exports)

- **Parallel?**: No -- T019-T021 build on this.
- **Notes**: Path matching should be case-sensitive and normalized (no trailing slashes, resolve relative paths). The `checkPath` function needs to handle both exact matches and basename matches (e.g., "tracking.csv" should match "data/tracking.csv" if that's the canonical name).

---

### Subtask T019 -- `jawn-ai canonical` CLI commands

- **Purpose**: User-facing CLI commands that call the CRUD functions from T018.
- **Steps**:
  1. Create `src/cli/commands/canonical.ts` with commander subcommands:
     ```
     jawn-ai canonical add <name> <path>
     jawn-ai canonical remove <name>
     jawn-ai canonical list
     jawn-ai canonical check <file-path>
     ```
  2. `canonical add`:
     - Validate the path exists (warn if not, but still add)
     - Load declarations, add, save
     - Print confirmation: `Canonical source declared: "tracking-spreadsheet" -> path/to/file.csv`
  3. `canonical remove`:
     - Load declarations, remove, save
     - Print confirmation or warn if name not found
  4. `canonical list`:
     - Print table of all declarations:
       ```
       tracking-spreadsheet  NCLC-test-files/accessibility-audit-tracking.csv
         Branch override: feature/a11y-652 -> data/tracking.csv
       accessibility-todo    docs/accessibility-fixes-todo.md
       ```
  5. `canonical check`:
     - Get current branch from git
     - Call `checkPath()` with the file path and current branch
     - Print result:
       - If canonical: `"path/to/file.csv" IS the canonical source for "tracking-spreadsheet"`
       - If not canonical: warning format from `state-api.md`
       - If no match: `No canonical declaration matches "path/to/file.csv"`

- **Files**:
  - `jawn-ai-state/src/cli/commands/canonical.ts` (new)

- **Parallel?**: Yes -- can develop alongside T020 and T021 once T018 is done.

---

### Subtask T020 -- Branch override support

- **Purpose**: Allow canonical paths to differ per branch. When on a feature branch, the canonical copy might be at a different location than on main.
- **Steps**:
  1. Extend `canonical add` with optional `--branch` flag:
     ```
     jawn-ai canonical add <name> <path> --branch=<branch>
     ```
  2. When `--branch` is provided:
     - Store as a branch override: `declarations.documents[name].branches[branch] = path`
     - Don't modify the default path
  3. When `--override=<path>` is provided alongside `--branch`:
     - Same effect but with a more explicit flag name
  4. Update `checkPath()` to resolve branch overrides:
     - If current branch has an override for the named document, use that path
     - Otherwise, use the default path
  5. Update `canonical list` to show branch overrides (already planned in T019)

- **Files**:
  - `jawn-ai-state/src/state/canonical.ts` (update)
  - `jawn-ai-state/src/cli/commands/canonical.ts` (update)

- **Parallel?**: Yes -- can develop alongside T019 and T021.
- **Notes**: Branch names in overrides are exact matches (not globs). A branch override completely replaces the default path for that branch -- it doesn't augment it.

---

### Subtask T021 -- Non-canonical access warning logic

- **Purpose**: When the system detects that a non-canonical copy of a document is being accessed, warn the user and redirect to the canonical source.
- **Steps**:
  1. Create a utility function in `src/state/canonical.ts`:
     ```typescript
     export function generateWarning(checkResult: CheckResult): string | null;
     ```
  2. Warning format (from `state-api.md`):
     ```
     WARNING: "NCLC-test-files/accessibility-fixes-todo.md" is NOT the canonical source.
       Canonical: docs/accessibility-fixes-todo.md (declared as "accessibility-todo")
       Use: jawn-ai canonical check --redirect to get the canonical path.
     ```
  3. Integrate warning into snapshot's `CanonicalStatus` field:
     - When a snapshot is captured, check each modified file against canonical declarations
     - If a non-canonical copy was modified, include a warning in the snapshot's `canonical` array
  4. The warning is informational -- it does not block any operation
  5. Future MCP tools (WP07) will also use `checkPath()` for interactive warnings

- **Files**:
  - `jawn-ai-state/src/state/canonical.ts` (update)

- **Parallel?**: Yes -- can develop alongside T019 and T020.
- **Notes**: The warning is passive (informational, never blocking). It appears in `jawn-ai restore` and `jawn-ai status` output when relevant. The `canonical` field in snapshots uses the `CanonicalStatus` type from the data model, which includes `exists` and `lastModified` fields.

---

## Risks & Mitigations

| Risk | Mitigation |
|------|-----------|
| Canonical file merge conflicts | JSON with one entry per key minimizes conflicts. Document merge strategy. |
| Deleted canonical file not detected | `checkPath` should verify file exists and warn if missing |
| Path normalization differences across platforms | Normalize all paths: resolve, remove trailing slashes, use forward slashes |
| Too many false-positive warnings | Only warn when a specific non-canonical copy is accessed, not on every file |

## Review Guidance

- Verify `canonical.json` format matches the data model exactly
- Verify branch overrides take precedence over defaults
- Verify `checkPath` handles: exact match, no match, non-canonical copy detected
- Verify warning text matches `state-api.md` format
- Verify `canonical add` works when `.jawn-ai/canonical.json` doesn't exist yet
- Verify path normalization is consistent

## Activity Log

- 2026-02-16T19:42:12Z -- system -- lane=planned -- Prompt created.
