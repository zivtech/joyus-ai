---
work_package_id: WP03
title: State Collectors
lane: planned
dependencies:
- WP01
- WP02
subtasks:
- T009
- T010
- T011
- T012
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

# Work Package Prompt: WP03 -- State Collectors

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

- Build collectors that gather live project state from git, filesystem, test output, and decision history
- Each collector returns structured data matching the corresponding type from WP01
- Collectors never throw — they return partial/default data on error
- **Done when**: Git collector returns GitState from a real repo, file collector returns FileState, test collector parses common runner output, decision tracker carries forward decisions

## Context & Constraints

- **Data Model**: `data-model.md` — GitState, FileState, TestResults, Decision types
- **Spec FR-001**: Persist state on significant events (collectors provide the data)
- **Plan**: Files under `src/collectors/` — git.ts, files.ts, tests.ts, decisions.ts
- **Performance**: All collectors combined must complete in <100ms for snapshot capture
- **Error handling**: Collectors NEVER throw. Return default/empty data on error. Log warnings.
- **Depends on**: WP01 (types). T012 also needs WP02 (read last snapshot for decision carry-forward).

**Implementation command**: `spec-kitty implement WP03 --base WP01`

(Note: WP03 depends on WP01. T012 also depends on WP02 for reading last snapshot, but can be written against the interface.)

## Subtasks & Detailed Guidance

### Subtask T009 -- Git state collector

- **Purpose**: Collect current git state by shelling out to `git` commands. This is the most important collector — branch awareness prevents wrong-branch commits.
- **Steps**:
  1. Create `src/collectors/git.ts`:
     ```typescript
     export async function collectGitState(projectRoot: string): Promise<GitState>;
     ```
  2. Implementation (shell out to git commands):
     - `git rev-parse --abbrev-ref HEAD` → branch name (returns "HEAD" if detached)
     - `git rev-parse --short HEAD` → commit hash
     - `git log -1 --format=%s` → commit message (first line)
     - `git rev-parse --is-inside-work-tree` → detect if it's a git repo
     - `git rev-list --left-right --count HEAD...@{upstream} 2>/dev/null` → ahead/behind (may fail if no upstream)
     - `git rev-parse --verify --quiet @{upstream}` → remote branch name
     - `git status --porcelain` → check if any changes exist (hasUncommittedChanges)
  3. Use `child_process.execFile` (not `exec`) for safety — no shell injection
  4. Set `cwd` to `projectRoot` for all git commands
  5. Set reasonable timeout (5 seconds per command)
  6. If git is not installed or not a git repo, return a default empty GitState:
     ```typescript
     const DEFAULT_GIT_STATE: GitState = {
       branch: 'unknown',
       commitHash: '',
       commitMessage: '',
       isDetached: false,
       hasUncommittedChanges: false,
       remoteBranch: null,
       aheadBehind: { ahead: 0, behind: 0 },
     };
     ```
  7. Export from `src/index.ts`

- **Files**:
  - `jawn-ai-state/src/collectors/git.ts` (new)

- **Parallel?**: Yes -- fully independent of T010, T011.
- **Notes**: `execFile` is preferred over `exec` because it doesn't spawn a shell. All arguments are passed as an array, preventing injection. If the upstream doesn't exist (local-only branch), ahead/behind should be `{ ahead: 0, behind: 0 }` and remoteBranch should be `null`.

---

### Subtask T010 -- File state collector

- **Purpose**: Collect the list of staged, unstaged, and untracked files using `git status`.
- **Steps**:
  1. Create `src/collectors/files.ts`:
     ```typescript
     export async function collectFileState(projectRoot: string): Promise<FileState>;
     ```
  2. Parse `git status --porcelain=v1` output:
     - First column = index status, second column = work tree status
     - `M_` (staged modified), `A_` (staged added), `D_` (staged deleted) → `staged[]`
     - `_M` (unstaged modified), `_D` (unstaged deleted) → `unstaged[]`
     - `??` (untracked) → `untracked[]`
     - `MM` (staged + further modified) → appears in both `staged[]` and `unstaged[]`
  3. Handle edge cases:
     - Renamed files: `R_` format includes `old -> new`
     - Binary files: same format, just different content
     - Submodules: may appear with special markers
  4. Return empty arrays if not a git repo or on error

- **Files**:
  - `jawn-ai-state/src/collectors/files.ts` (new)

- **Parallel?**: Yes -- fully independent.

---

### Subtask T011 -- Test results collector

- **Purpose**: Parse test output from common runners (vitest, jest, phpunit, pytest) to extract pass/fail counts and failing test names.
- **Steps**:
  1. Create `src/collectors/tests.ts`:
     ```typescript
     export function parseTestResults(output: string, runner?: string): TestResults | null;
     ```
  2. Auto-detect runner from output patterns if not specified:
     - Vitest/Jest: `Tests:  X passed, Y failed` or `Test Suites:` patterns
     - PHPUnit: `OK (X tests, Y assertions)` or `FAILURES! Tests: X, Assertions: Y, Failures: Z`
     - Pytest: `X passed, Y failed` or `===` delimiter patterns
  3. Extract:
     - `passed`: count of passing tests
     - `failed`: count of failing tests
     - `skipped`: count of skipped tests
     - `failingTests`: names of failing tests (max 20, truncate with note)
     - `duration`: total runtime if available
     - `command`: the command that was run (passed as parameter)
  4. Return `null` if output doesn't match any known runner pattern
  5. Be permissive in parsing — extract what you can, ignore what you can't

- **Files**:
  - `jawn-ai-state/src/collectors/tests.ts` (new)

- **Parallel?**: Yes -- fully independent.
- **Notes**: This collector is different from git/file collectors — it receives output text as input rather than running commands. The companion service or MCP tool passes test output to this function.

---

### Subtask T012 -- Decision tracking

- **Purpose**: Manage the list of pending decisions across snapshots. Decisions carry forward from the last snapshot and can be added to or resolved.
- **Steps**:
  1. Create `src/collectors/decisions.ts`:
     ```typescript
     export function carryForwardDecisions(
       previousDecisions: Decision[],
       newDecision?: string,
       resolvedId?: string,
       resolvedAnswer?: string
     ): Decision[];
     ```
  2. Implementation:
     - Start with `previousDecisions` (from last snapshot)
     - If `newDecision` provided: create a new Decision with unique ID (CUID2), `resolved: false`
     - If `resolvedId` provided: find matching decision, set `resolved: true`, `answer: resolvedAnswer`, `resolvedAt: now`
     - Return the full list (pending + resolved)
  3. Decisions persist across snapshots — pending decisions carry forward until resolved
  4. Resolved decisions stay in the list for context (but could be pruned after N snapshots — deferred)

- **Files**:
  - `jawn-ai-state/src/collectors/decisions.ts` (new)
  - `jawn-ai-state/src/index.ts` (update exports)

- **Parallel?**: No -- logically depends on being able to read the last snapshot (WP02). But the function itself can be written against the types without the store.

---

## Risks & Mitigations

| Risk | Mitigation |
|------|-----------|
| Git not installed | Return default empty state. Log warning. |
| Git command timeout (large repo) | 5-second timeout per command. Return partial state on timeout. |
| Test output format changes | Parsers are best-effort. Return null if no pattern matches. |
| Non-standard git status output | Use `--porcelain=v1` for stable output format. |

## Review Guidance

- Verify git collector works in a real git repo with commits, branches, upstream
- Verify git collector returns defaults when git is not available
- Verify file collector correctly categorizes staged/unstaged/untracked
- Verify test parser handles vitest, jest, phpunit, and pytest output samples
- Verify decision carry-forward preserves pending decisions across calls
- Verify NO collector ever throws an exception

## Activity Log

- 2026-02-17T03:14:10Z -- system -- lane=planned -- Prompt created.
