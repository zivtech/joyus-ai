---
work_package_id: WP04
title: Canonical Document Management
lane: "doing"
dependencies:
- WP01
base_branch: 002-session-context-management-WP03
base_commit: e4c1468c6705d26544d258d9d90d092d41960c01
created_at: '2026-02-18T22:59:09.744208+00:00'
subtasks:
- T013
- T014
- T015
- T016
phase: Phase 1 - Foundation
assignee: ''
agent: ''
shell_pid: "94429"
review_status: ''
reviewed_by: ''
history:
- timestamp: '2026-02-17T03:14:10Z'
  lane: planned
  agent: system
  shell_pid: ''
  action: Prompt generated via /spec-kitty.tasks (MCP-first architecture)
---

# Work Package Prompt: WP04 -- Canonical Document Management

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
- Support per-branch overrides for canonical paths
- Check file paths against canonical declarations and generate warnings
- Integrate canonical status into snapshots
- **Done when**: Can declare canonical sources, check files against them, get warnings for non-canonical access, branch overrides resolve correctly, snapshots include canonical status

## Context & Constraints

- **Spec**: User Story 2 (Canonical Document Declaration), FR-004, FR-005
- **Data Model**: `CanonicalDeclaration` format in `data-model.md`, `CanonicalStatus` entity
- **Contracts**: `contracts/state-api.md` — `check_canonical` tool uses this module
- **Storage**: `.joyus-ai/canonical.json` in project root (committed to git — team-shared)
- **Format**: `{ "documents": { "<name>": { "default": "<path>", "branches": { "<branch>": "<path>" } } } }`
- **Depends on**: WP01 (types), WP02 (store — atomic write pattern)

**Implementation command**: `spec-kitty implement WP04 --base WP02`

## Subtasks & Detailed Guidance

### Subtask T013 -- Canonical declaration CRUD

- **Purpose**: Core logic for managing canonical document declarations. MCP tools (WP07) and future CLI call these functions.
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
     export function addDeclaration(declarations: CanonicalDeclarations, name: string, path: string, branch?: string): CanonicalDeclarations;
     export function removeDeclaration(declarations: CanonicalDeclarations, name: string): CanonicalDeclarations;
     export function listDeclarations(declarations: CanonicalDeclarations): Array<{ name: string; defaultPath: string; branchOverrides: string[] }>;
     ```
  2. `loadCanonical()`: Read `.joyus-ai/canonical.json`. Return `{ documents: {} }` if missing or corrupted.
  3. `saveCanonical()`: Write atomically (temp + rename) to `.joyus-ai/canonical.json`
  4. `addDeclaration()`: If `branch` provided, add as branch override. Otherwise set/replace default path.
  5. `removeDeclaration()`: Remove by name. Return unchanged if name doesn't exist.
  6. `listDeclarations()`: Return flat list of all declarations with their branch overrides.
  7. Export from `src/index.ts`

- **Files**:
  - `joyus-ai-state/src/state/canonical.ts` (new)
  - `joyus-ai-state/src/index.ts` (update exports)

- **Parallel?**: No -- T014-T016 build on this.

---

### Subtask T014 -- checkPath logic with branch override resolution

- **Purpose**: Given a file path and current branch, determine if the path is the canonical source, a non-canonical copy, or unrelated. Branch overrides take precedence over defaults.
- **Steps**:
  1. Add to `src/state/canonical.ts`:
     ```typescript
     export interface CheckResult {
       isCanonical: boolean;
       canonicalName: string | null;
       canonicalPath: string | null;
       suggestion: string | null;
     }

     export function checkPath(
       declarations: CanonicalDeclarations,
       filePath: string,
       currentBranch: string
     ): CheckResult;
     ```
  2. Resolution logic:
     - Normalize `filePath` (resolve relative, remove trailing slashes, forward slashes)
     - For each declaration:
       a. Check if current branch has an override → use that path
       b. Otherwise use default path
       c. Compare normalized paths
     - If path matches the resolved canonical path: `{ isCanonical: true, canonicalName, canonicalPath, suggestion: null }`
     - If path matches by basename but not full path (e.g., same filename, different directory): `{ isCanonical: false, canonicalName, canonicalPath, suggestion: "Use canonical source at ..." }`
     - If no match: `{ isCanonical: false, canonicalName: null, canonicalPath: null, suggestion: null }`
  3. Path matching is case-sensitive
  4. Handle both exact match and basename-only match

- **Files**:
  - `joyus-ai-state/src/state/canonical.ts` (update)

- **Parallel?**: No -- depends on T013 data structures.

---

### Subtask T015 -- Non-canonical access warning generation

- **Purpose**: Generate human-readable warning text when a non-canonical copy is accessed. Used by both MCP tools and future CLI output.
- **Steps**:
  1. Add to `src/state/canonical.ts`:
     ```typescript
     export function generateWarning(checkResult: CheckResult): string | null;
     ```
  2. Warning format (from `contracts/state-api.md`):
     ```
     WARNING: "<accessed-path>" is NOT the canonical source.
       Canonical: <canonical-path> (declared as "<canonical-name>")
       Suggestion: Use the canonical source at <canonical-path>
     ```
  3. Return `null` if `isCanonical` is true or `canonicalName` is null (no match)
  4. Warning is informational — it does not block any operation

- **Files**:
  - `joyus-ai-state/src/state/canonical.ts` (update)

- **Parallel?**: Yes -- can develop alongside T016 once T014 is done.

---

### Subtask T016 -- Canonical status integration in snapshots

- **Purpose**: When a snapshot is captured, check each modified file against canonical declarations and include status in the snapshot's `canonical` array.
- **Steps**:
  1. Create a utility in `src/state/canonical.ts`:
     ```typescript
     export async function getCanonicalStatuses(
       projectRoot: string,
       declarations: CanonicalDeclarations,
       currentBranch: string
     ): Promise<CanonicalStatus[]>;
     ```
  2. Implementation:
     - For each declared canonical document:
       - Resolve the path for the current branch (override or default)
       - Check if the file exists at that path (`fs.access`)
       - If exists, get last modified time (`fs.stat`)
       - Build `CanonicalStatus` object: `{ name, canonicalPath, exists, lastModified, branchOverride }`
     - Return array of statuses
  3. This function is called during snapshot assembly (by `save_state` MCP tool or companion service)

- **Files**:
  - `joyus-ai-state/src/state/canonical.ts` (update)

- **Parallel?**: Yes -- independent of T015.

---

## Risks & Mitigations

| Risk | Mitigation |
|------|-----------|
| Canonical file merge conflicts in git | JSON with one entry per key minimizes conflicts. Document merge strategy. |
| Deleted canonical file not detected | `getCanonicalStatuses` checks file existence and sets `exists: false` |
| Path normalization differences across platforms | Normalize all paths: resolve, remove trailing slashes, use forward slashes |
| Too many false-positive warnings | Only warn when a specific non-canonical copy is accessed (basename match), not on every file |

## Review Guidance

- Verify `canonical.json` format matches the data model exactly
- Verify branch overrides take precedence over defaults in `checkPath`
- Verify `checkPath` handles: exact canonical match, basename-only match, no match
- Verify warning text matches `contracts/state-api.md` format
- Verify `loadCanonical` works when `.joyus-ai/canonical.json` doesn't exist yet
- Verify path normalization is consistent (trailing slashes, relative vs absolute)
- Verify `getCanonicalStatuses` correctly reports missing files

## Activity Log

- 2026-02-17T03:14:10Z -- system -- lane=planned -- Prompt created.
