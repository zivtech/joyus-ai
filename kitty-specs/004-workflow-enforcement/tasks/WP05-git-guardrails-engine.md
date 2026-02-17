---
work_package_id: WP05
title: Git Guardrails Engine
lane: planned
dependencies:
- WP01
- WP02
subtasks:
- T026
- T027
- T028
- T029
- T030
- T031
- T032
phase: Phase 2 - Enforcement Engines
assignee: ''
agent: ''
shell_pid: ''
review_status: ''
reviewed_by: ''
history:
- timestamp: '2026-02-17T15:00:00Z'
  lane: planned
  agent: system
  shell_pid: ''
  action: Prompt generated via /spec-kitty.tasks
---

# Work Package Prompt: WP05 -- Git Guardrails Engine

## IMPORTANT: Review Feedback Status

- **Has review feedback?**: Check `review_status` above.
- **Mark as acknowledged**: Update `review_status: acknowledged` when addressing feedback.

---

## Review Feedback

*[This section is empty initially.]*

---

## Objectives & Success Criteria

- Implement branch verification (current vs expected from task context)
- Implement branch naming convention enforcement
- Detect stale branches and high branch counts
- Warn on force-push and uncommitted changes before branch switch
- Integrate all git guardrail actions with audit trail
- **Done when**: Branch mismatch is detected, naming violations are flagged, stale branches are listed, force-push triggers warning, uncommitted changes are detected, all actions audited

## Context & Constraints

- **Spec**: FR-014 through FR-019 (git sanity), User Story 3 (branch verification), User Story 5 (git hygiene)
- **Data Model**: BranchRule entity
- **Plan**: `jawn-ai-state/src/enforcement/git/` directory
- **002 dependency**: State snapshot provides `expectedBranch` from task context

**Implementation command**: `spec-kitty implement WP05 --base WP02`

## Subtasks & Detailed Guidance

### Subtask T026 -- Implement branch verification

- **Purpose**: Before commits/pushes, verify the current branch matches the expected branch from the active task context (FR-014, User Story 3).
- **Steps**:
  1. Create `jawn-ai-state/src/enforcement/git/branch-verify.ts`
  2. Implement `verifyBranch(config: BranchVerifyConfig): BranchVerifyResult`:
     ```typescript
     interface BranchVerifyConfig {
       currentBranch: string;          // from git
       expectedBranch: string | null;  // from task context (002 state)
       operation: 'commit' | 'push' | 'merge';
       userTier: UserTier;
     }
     interface BranchVerifyResult {
       match: boolean;
       enforcement: 'block' | 'warn' | 'none';
       currentBranch: string;
       expectedBranch: string | null;
     }
     ```
  3. Logic:
     - If `expectedBranch` is null: `match: true`, `enforcement: 'none'` (don't invent constraints)
     - If branches match: `match: true`, `enforcement: 'none'`
     - If mismatch:
       - Tier 1 (junior): `enforcement: 'block'`
       - Tier 2 (power user): `enforcement: 'warn'`
       - Tier 3 (non-technical): `enforcement: 'block'`
  4. Implement `getCurrentBranch(): string`:
     - Run `git rev-parse --abbrev-ref HEAD`
     - Parse output, trim whitespace
- **Files**: `jawn-ai-state/src/enforcement/git/branch-verify.ts` (new, ~60 lines)
- **Notes**: Expected branch comes from 002's state snapshot (task context). If 002's API isn't available yet, accept `expectedBranch` as a parameter.

### Subtask T027 -- Implement branch naming convention checker

- **Purpose**: Enforce branch naming conventions when configured (FR-015).
- **Steps**:
  1. Create `jawn-ai-state/src/enforcement/git/branch-hygiene.ts`
  2. Implement `checkBranchNaming(branchName: string, rules: BranchRule): NamingResult`:
     - If `rules.namingConvention` is set: test branch against regex
     - If valid: `{ valid: true }`
     - If invalid: `{ valid: false, suggestedName: generateSuggestion(branchName, rules.namingConvention) }`
  3. Implement `generateSuggestion(name: string, convention: string): string`:
     - Simple heuristic: lowercase, replace spaces with hyphens, add `feature/` prefix if missing
     - Return best-effort suggestion (may not always be perfect)
  4. Skip check for protected branches (main, master, develop)
- **Files**: `jawn-ai-state/src/enforcement/git/branch-hygiene.ts` (new, ~40 lines)
- **Parallel?**: Yes

### Subtask T028 -- Implement stale branch detection

- **Purpose**: Detect branches that haven't been modified in a configurable period (FR-016, User Story 5).
- **Steps**:
  1. Add to `branch-hygiene.ts`:
  2. Implement `detectStaleBranches(rules: BranchRule): Promise<StaleBranch[]>`:
     - Run `git for-each-ref --sort=-committerdate --format='%(refname:short) %(committerdate:iso8601)' refs/heads/`
     - Parse output into `{ name: string, lastModified: string }[]`
     - Filter branches older than `rules.staleDays` days
     - Exclude protected branches
     - Return sorted by age (stalest first)
  3. Define `StaleBranch`: `{ name: string, lastModified: string, daysSinceModified: number }`
- **Files**: `jawn-ai-state/src/enforcement/git/branch-hygiene.ts` (extend, ~40 lines)
- **Parallel?**: Yes

### Subtask T029 -- Implement active branch count warning

- **Purpose**: Warn when active branch count exceeds configured limit (FR-017).
- **Steps**:
  1. Add to `branch-hygiene.ts`:
  2. Implement `checkBranchCount(rules: BranchRule): Promise<BranchCountResult>`:
     - Run `git branch --list | wc -l` or parse `git for-each-ref refs/heads/`
     - Compare count to `rules.maxActiveBranches` (default: 10)
     - Return `{ count: number, limit: number, overLimit: boolean }`
- **Files**: `jawn-ai-state/src/enforcement/git/branch-hygiene.ts` (extend, ~20 lines)
- **Parallel?**: Yes

### Subtask T030 -- Implement force-push warning

- **Purpose**: Warn before force-push operations with risk explanation (FR-018).
- **Steps**:
  1. Create `jawn-ai-state/src/enforcement/git/guardrails.ts`
  2. Implement `checkForcePush(args: string[], rules: BranchRule): ForcePushResult`:
     - Detect `--force` or `-f` in git push arguments
     - Check if target branch is in `rules.protectedBranches`
     - If protected: `{ warning: 'critical', message: 'Force-pushing to protected branch...' }`
     - If not protected: `{ warning: 'caution', message: 'Force-push will overwrite remote history...' }`
     - If not force-push: `{ warning: 'none' }`
- **Files**: `jawn-ai-state/src/enforcement/git/guardrails.ts` (new, ~40 lines)
- **Parallel?**: Yes

### Subtask T031 -- Implement uncommitted changes detection

- **Purpose**: Detect uncommitted changes before branch switches to prevent data loss (FR-019).
- **Steps**:
  1. Add to `guardrails.ts`:
  2. Implement `checkUncommittedChanges(): Promise<UncommittedResult>`:
     - Run `git status --porcelain`
     - Parse output: count modified, added, deleted, untracked files
     - Return `{ hasChanges: boolean, modified: number, untracked: number, summary: string }`
  3. Summary format: "3 modified files, 1 untracked file"
- **Files**: `jawn-ai-state/src/enforcement/git/guardrails.ts` (extend, ~30 lines)
- **Parallel?**: Yes

### Subtask T032 -- Integrate git guardrails with audit trail

- **Purpose**: All git guardrail actions must be audited (FR-020).
- **Steps**:
  1. Create wrapper functions that call the checks and log audit entries:
  2. `auditBranchVerify(result, writer)`: log `branch-verify` or `branch-mismatch`
  3. `auditBranchHygiene(staleBranches, branchCount, writer)`: log `branch-hygiene`
  4. `auditNamingViolation(result, writer)`: log `naming-violation`
  5. `auditForcePush(result, writer)`: log `force-push-warning`
  6. `auditUncommitted(result, writer)`: log `uncommitted-warning`
  7. Each audit entry includes `branchName`, `userTier`, `activeSkills`, `taskId` from context
- **Files**: `jawn-ai-state/src/enforcement/git/branch-verify.ts` and `guardrails.ts` (extend, ~40 lines total)

## Risks & Mitigations

- **Git command parsing**: use `--porcelain` and `--format` flags for machine-readable output.
- **Performance with many branches**: `git for-each-ref` is efficient even with hundreds of branches. Limit to local refs.
- **Detached HEAD state**: `getCurrentBranch` returns `HEAD` in detached state. Handle this case (skip branch verification, warn user).

## Review Guidance

- Verify branch mismatch with null expectedBranch returns no warning
- Verify tier-specific enforcement (block vs warn)
- Verify stale branch detection excludes protected branches
- Verify force-push detection works with both `--force` and `-f` flags
- Verify git commands use machine-readable output formats
- Verify all guardrail actions create audit entries

## Activity Log

- 2026-02-17T15:00:00Z -- system -- lane=planned -- Prompt created.
