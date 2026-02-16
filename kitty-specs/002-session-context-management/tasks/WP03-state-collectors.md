---
work_package_id: "WP03"
subtasks:
  - "T008"
  - "T009"
  - "T010"
  - "T011"
title: "State Collectors"
phase: "Phase 1 - Core Modules"
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

- Build four data collection modules that gather the raw data included in every snapshot
- Each collector is independent and produces a typed result matching the data model
- Collectors must handle errors gracefully (return partial data, never crash the snapshot process)
- **Done when**: Each collector independently gathers its data and returns a typed result; decision tracker carries forward across snapshots

## Context & Constraints

- **Data Model**: `kitty-specs/002-session-context-management/data-model.md`
- **Research**: `kitty-specs/002-session-context-management/research.md` (R8: append-only decision tracking)
- **Spec FR-001**: Persist state on significant events; collectors provide the data
- **Spec FR-006**: Survive dirty exits; collectors must be fast (<100ms total)
- **Spec FR-011**: Fall back gracefully; if git isn't available, return what you can
- **Depends on WP01**: Uses types from `core/types.ts`
- **Performance target**: All collectors combined must complete in <100ms (they run on every snapshot event)

**Implementation command**: `spec-kitty implement WP03 --base WP01`

## Subtasks & Detailed Guidance

### Subtask T008 -- Git state collector [P]

- **Purpose**: Collect the current git state (branch, commit, status, ahead/behind) for inclusion in every snapshot. This is the most critical collector -- wrong-branch awareness is the #1 pain point.
- **Steps**:
  1. Create `src/collectors/git.ts` with:
     ```typescript
     export async function collectGitState(projectRoot: string): Promise<GitState>;
     ```
  2. Implement by shelling out to `git` commands:
     - `git rev-parse --abbrev-ref HEAD` -- current branch name (or "HEAD" if detached)
     - `git rev-parse --short HEAD` -- short commit hash
     - `git log -1 --format=%s` -- commit message (first line)
     - `git rev-parse --is-inside-work-tree` -- verify we're in a git repo
     - `git status --porcelain` -- check for uncommitted changes (any output = true)
     - `git rev-parse --abbrev-ref @{upstream}` -- upstream tracking branch (may fail if no upstream)
     - `git rev-list --left-right --count HEAD...@{upstream}` -- ahead/behind counts
  3. Detect detached HEAD: `branch === "HEAD"` means detached
  4. Handle errors per-command:
     - No git repo: Return a GitState with empty/default values, `branch: "unknown"`, `isDetached: false`
     - No upstream: Set `remoteBranch: null`, `aheadBehind: { ahead: 0, behind: 0 }`
     - Individual command failure: Use defaults for that field, continue collecting others
  5. Use `child_process.execFile` (not `exec`) for security -- no shell injection risk
  6. Set a 5-second timeout per git command to prevent hangs

- **Files**:
  - `jawn-ai-state/src/collectors/git.ts` (new)

- **Parallel?**: Yes -- fully independent of T009, T010, T011.
- **Notes**: All git commands should run with `cwd: projectRoot` to support being called from any directory. The `--porcelain` flag on `git status` gives machine-parseable output. For `execFile`, wrap in a utility that returns a promise with timeout.

---

### Subtask T009 -- File state collector [P]

- **Purpose**: Collect the lists of staged, unstaged, and untracked files. This tells the restored session exactly what files were being worked on.
- **Steps**:
  1. Create `src/collectors/files.ts` with:
     ```typescript
     export async function collectFileState(projectRoot: string): Promise<FileState>;
     ```
  2. Parse `git status --porcelain` output:
     - Lines starting with `M ` (index) or `A ` (index): **staged** files
     - Lines starting with ` M` (worktree) or ` D` (worktree): **unstaged** files
     - Lines starting with `??`: **untracked** files
     - Lines with both index and worktree changes (e.g., `MM`): include in both staged and unstaged
  3. Return file paths relative to project root
  4. Handle empty output (clean working tree): return `{ staged: [], unstaged: [], untracked: [] }`
  5. Handle git not available: return empty FileState

- **Files**:
  - `jawn-ai-state/src/collectors/files.ts` (new)

- **Parallel?**: Yes -- fully independent.
- **Notes**: Consider sharing the `git status --porcelain` call with T008 to avoid running it twice. You can either: (a) have a shared utility that caches the output, or (b) accept the duplication since the command is fast (<50ms). Decision: option (b) is simpler and avoids coupling. Each collector should be self-contained.

---

### Subtask T010 -- Test results collector [P]

- **Purpose**: Parse test results from the last test run to include in snapshots. Tells the restored session which tests were passing/failing.
- **Steps**:
  1. Create `src/collectors/tests.ts` with:
     ```typescript
     export async function collectTestResults(
       stdout: string,
       command: string
     ): Promise<TestResults | null>;
     ```
  2. Implement parsers for common test runners (detect from output patterns):
     - **Vitest**: Look for `Tests  X passed | Y failed` pattern
     - **Jest**: Look for `Tests:  X passed, Y failed, Z total` pattern
     - **PHPUnit**: Look for `OK (X tests, Y assertions)` or `FAILURES! Tests: X, Assertions: Y, Failures: Z`
     - **pytest**: Look for `X passed, Y failed` or `X passed in Ys`
  3. For each parser, extract:
     - `runner`: detected runner name
     - `passed`, `failed`, `skipped` counts
     - `failingTests`: names of failing tests (max 20, with truncation note if more)
     - `duration`: total run time in seconds
     - `command`: the original command string
  4. Return `null` if the output doesn't match any known pattern (unknown test runner)
  5. Note: This collector is NOT called automatically from git hooks. It's called when the `--event=test-run` flag is passed to the snapshot command. The hook template (WP08) decides when test output is available.

- **Files**:
  - `jawn-ai-state/src/collectors/tests.ts` (new)

- **Parallel?**: Yes -- fully independent.
- **Notes**: Start with Vitest and Jest patterns (most likely for this TypeScript project). PHPUnit and pytest are stretch goals. The parser should be extensible -- use a registry pattern so new runners can be added without modifying existing code. Cap `failingTests` at 20 entries per the data model validation rules.

---

### Subtask T011 -- Decision tracker

- **Purpose**: Track pending and resolved decisions incrementally across snapshots. Decisions are the highest-value context for resumed sessions -- they capture the reasoning that's hardest to reconstruct.
- **Steps**:
  1. Create `src/collectors/decisions.ts` with:
     ```typescript
     export class DecisionTracker {
       constructor(existingDecisions?: Decision[]);
       addPending(question: string, context: string, options?: string[]): Decision;
       resolve(decisionId: string, answer: string): Decision;
       getAll(): Decision[];
       getPending(): Decision[];
       getResolved(): Decision[];
     }
     ```
  2. Implementation:
     - Constructor accepts existing decisions from the last snapshot (for carry-forward)
     - `addPending()`: Creates a new Decision with `resolved: false`, `answer: null`, generates a CUID2 `id`
     - `resolve()`: Finds decision by ID, sets `answer`, `resolved: true`, `resolvedAt` to current ISO timestamp
     - `getAll()`: Returns all decisions (pending + resolved) in chronological order
     - `getPending()`: Returns only unresolved decisions
     - `getResolved()`: Returns only resolved decisions
  3. Decisions are append-only within a session
  4. When creating a new snapshot, pass the current `DecisionTracker.getAll()` as the `decisions` field
  5. When restoring from a snapshot, initialize `new DecisionTracker(snapshot.decisions)` to carry forward

- **Files**:
  - `jawn-ai-state/src/collectors/decisions.ts` (new)

- **Parallel?**: Logically independent but shares types from WP01.
- **Notes**: The DecisionTracker is stateful (class-based) unlike the other collectors (pure functions). This is intentional -- decisions accumulate within a session. Use `@paralleldrive/cuid2` for ID generation (same as snapshot IDs). The `--decision` CLI flag (WP04) calls `addPending()`.

---

## Risks & Mitigations

| Risk | Mitigation |
|------|-----------|
| Git not installed or not a git repo | Return partial/default data, never crash |
| Git commands hang (network operations) | 5-second timeout per command |
| Unknown test runner output | Return null, don't guess |
| Decision ID collisions | CUID2 is collision-resistant by design |
| Collector performance too slow | Each collector should complete in <25ms; monitor with simple timing logs |

## Review Guidance

- Verify each collector handles errors without throwing (returns defaults/null/partial)
- Verify git collector uses `execFile` not `exec` (security)
- Verify test results parser caps `failingTests` at 20
- Verify DecisionTracker preserves chronological order
- Verify DecisionTracker validates that `resolve()` fails gracefully for non-existent IDs
- Verify all git commands use `cwd: projectRoot`

## Activity Log

- 2026-02-16T19:42:12Z -- system -- lane=planned -- Prompt created.
