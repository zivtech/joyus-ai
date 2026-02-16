---
work_package_id: WP09
title: Integration & Hardening
lane: planned
dependencies:
- WP01
subtasks:
- T035
- T036
- T037
- T038
phase: Phase 4 - Polish
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

# Work Package Prompt: WP09 -- Integration & Hardening

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

- Verify full snapshot -> restore cycle works end-to-end in a real git repository
- Verify hooks fire correctly and produce valid snapshots
- Implement concurrent session handling (file locking, stale lock detection)
- Harden error handling across all components (corrupted files, missing git, partial state)
- **Done when**: E2E tests pass; concurrent sessions don't corrupt state; errors are logged but never block the user

## Context & Constraints

- **Spec FR-006**: Survive dirty exits (crash, force-quit)
- **Spec FR-009**: Handle concurrent sessions without data loss
- **Spec FR-011**: Fall back gracefully on corrupted/missing/stale state
- **Spec SC-005**: After simulated crash, next session recovers state no more than one event behind
- **Quickstart**: `quickstart.md` verification section defines the E2E acceptance flow
- **Depends on**: ALL previous WPs (WP01-WP08) -- this is the integration layer

**Implementation command**: `spec-kitty implement WP09 --base WP08`

(Note: WP09 depends on all prior WPs. Use `--base WP08` as the last WP in the chain.)

## Subtasks & Detailed Guidance

### Subtask T035 -- End-to-end integration test

- **Purpose**: Verify the full lifecycle works: init -> snapshot -> restore -> status -> canonical -> share -> load. This is the acceptance test for the entire feature.
- **Steps**:
  1. Create `tests/integration/cli.test.ts` with:
     ```typescript
     describe('jawn-ai CLI E2E', () => {
       let tempDir: string;
       let projectRoot: string;

       beforeEach(async () => {
         // Create temp directory
         // Initialize a git repo with initial commit
         // Run jawn-ai config init
       });

       afterEach(async () => {
         // Clean up temp directory
       });

       test('snapshot -> restore cycle', async () => {
         // 1. Make a git commit
         // 2. Run jawn-ai snapshot --event=commit
         // 3. Verify snapshot file exists in ~/.jawn-ai/projects/<hash>/snapshots/
         // 4. Run jawn-ai restore
         // 5. Verify output includes branch, commit hash, commit message
       });

       test('status shows live context', async () => {
         // 1. Create a snapshot
         // 2. Switch branches
         // 3. Run jawn-ai status
         // 4. Verify divergence warning (branch changed)
       });

       test('canonical workflow', async () => {
         // 1. Create a test file
         // 2. jawn-ai canonical add "test-doc" path/to/file
         // 3. jawn-ai canonical check path/to/file -> isCanonical: true
         // 4. jawn-ai canonical check other/path/to/file -> warning
         // 5. jawn-ai canonical list -> shows declaration
       });

       test('share -> load workflow', async () => {
         // 1. Create a snapshot
         // 2. jawn-ai share --note "test note"
         // 3. Verify shared file exists
         // 4. jawn-ai load <shared-file-path>
         // 5. Verify output includes sharer note
       });

       test('config init creates required files', async () => {
         // Verify .jawn-ai/config.json exists
         // Verify .jawn-ai/canonical.json exists
         // Verify ~/.jawn-ai/projects/<hash>/ exists
       });
     });
     ```
  2. Each test should:
     - Use a temporary directory with a fresh git repo
     - Run CLI commands via `execFile` (testing the actual binary)
     - Validate output format matches contracts
     - Clean up after itself
  3. Follow the verification flow from `quickstart.md`

- **Files**:
  - `jawn-ai-state/tests/integration/cli.test.ts` (new)

- **Parallel?**: Yes -- can develop alongside T036.
- **Notes**: Use `os.tmpdir()` for temp directories. Set `HOME` environment variable to a temp location to avoid polluting real `~/.jawn-ai/`. Each test must be fully isolated.

---

### Subtask T036 -- Hook integration test

- **Purpose**: Verify that Claude Code hooks correctly trigger snapshots on the right events.
- **Steps**:
  1. Create `tests/integration/hook-integration.test.ts`:
     ```typescript
     describe('Hook Integration', () => {
       test('hooks install creates correct settings.json', async () => {
         // 1. Create a project with .claude/ directory
         // 2. Run jawn-ai hooks install --platform=claude-code
         // 3. Read .claude/settings.json
         // 4. Verify SessionStart, PostToolUse, Stop hooks are present
         // 5. Verify hook scripts reference the correct binary path
       });

       test('session-start hook runs restore', async () => {
         // 1. Create a snapshot
         // 2. Execute the session-start hook script directly
         // 3. Verify output matches restore format
       });

       test('post-tool-use hook captures commit snapshot', async () => {
         // 1. Execute the post-tool-use hook with git commit args
         // 2. Verify a new snapshot was created with event=commit
       });

       test('post-tool-use hook captures branch-switch snapshot', async () => {
         // 1. Execute the post-tool-use hook with git checkout args
         // 2. Verify a new snapshot was created with event=branch-switch
       });

       test('session-end hook captures final snapshot', async () => {
         // 1. Execute the session-end hook script
         // 2. Verify a new snapshot was created with event=session-end
       });

       test('hooks install preserves existing hooks', async () => {
         // 1. Create .claude/settings.json with existing hooks
         // 2. Run jawn-ai hooks install
         // 3. Verify existing hooks are still present
         // 4. Verify jawn-ai hooks were added
       });

       test('hooks uninstall removes only jawn-ai hooks', async () => {
         // 1. Install jawn-ai hooks alongside existing hooks
         // 2. Run jawn-ai hooks uninstall
         // 3. Verify jawn-ai hooks removed
         // 4. Verify existing hooks still present
       });
     });
     ```
  2. Test hook scripts by executing them directly with simulated arguments
  3. Verify hooks never fail (always exit 0)

- **Files**:
  - `jawn-ai-state/tests/integration/hook-integration.test.ts` (new)

- **Parallel?**: Yes -- can develop alongside T035.
- **Notes**: Hook scripts are shell scripts -- test them by running with `bash -c` or `execFile`. The key assertion for every hook: it must exit 0 even on error.

---

### Subtask T037 -- Concurrent session handling

- **Purpose**: Ensure multiple sessions writing to the same state store don't corrupt data. This is critical for developers running multiple terminal windows.
- **Steps**:
  1. Create or enhance `src/state/store.ts` with robust locking:
     ```typescript
     // Lockfile: <state-dir>/snapshot.lock
     // Contains: { pid: number, timestamp: string }
     // Timeout: 5 seconds (acquire lock or give up)
     // Stale detection: Check if PID is still running (process.kill(pid, 0))
     ```
  2. Implement lock acquisition:
     - Try to create lockfile with `O_CREAT | O_EXCL` (atomic creation)
     - If file exists, check if PID is still running
     - If PID is dead (stale lock), remove and retry
     - If PID is alive, wait up to 5 seconds with 100ms polling
     - If timeout, give up gracefully (log warning, don't write) -- FR-011 never blocks
  3. Implement lock release:
     - Remove lockfile after write completes
     - Use try/finally to ensure release even on error
  4. Create `tests/unit/concurrent.test.ts`:
     - Test concurrent writes don't corrupt the snapshot directory
     - Test stale lock detection works
     - Test lock timeout behavior
     - Simulate concurrent writes using Promise.all with multiple store.write() calls

- **Files**:
  - `jawn-ai-state/src/state/store.ts` (update -- add/enhance locking)
  - `jawn-ai-state/tests/unit/concurrent.test.ts` (new)

- **Parallel?**: Yes -- can develop alongside T038.
- **Notes**: The locking doesn't need to be perfect -- the worst case is a missed snapshot, which is acceptable (FR-011). The key invariant is: writes never produce corrupted files (atomic write pattern from T005 ensures this regardless of locking).

---

### Subtask T038 -- Error handling and graceful degradation

- **Purpose**: Ensure every component degrades gracefully when things go wrong. The system must NEVER block the developer's workflow.
- **Steps**:
  1. Audit all public functions across all modules for error handling:
     - **Collectors**: Return partial/default data on error (never throw)
     - **Store**: Return null on read errors, log on write errors (never throw to caller)
     - **CLI commands**: Catch all errors, print user-friendly message, exit(1) but NEVER hang
     - **MCP tools**: Return MCP error responses (never crash server)
     - **Hooks**: Already protected by `|| true` in templates
  2. Test specific failure scenarios:
     - Corrupted snapshot file (invalid JSON)
     - Missing `.jawn-ai/` directory
     - Git not installed or not a git repo
     - Disk full during write
     - Permission denied on state directory
     - Snapshot file exceeds 1MB size limit
     - Config file with invalid values
  3. Create `tests/unit/error-handling.test.ts` with:
     ```typescript
     describe('Graceful Degradation', () => {
       test('corrupted snapshot is skipped, next valid one loaded', ...);
       test('missing git returns default GitState', ...);
       test('missing state directory is created on first write', ...);
       test('invalid config values use defaults', ...);
       test('oversized snapshot is rejected with warning', ...);
       test('restore with no snapshots prints friendly message', ...);
     });
     ```
  4. Add a logging utility (simple stderr logger with levels):
     ```typescript
     export function logWarn(message: string): void;  // Always show
     export function logDebug(message: string): void; // Only in verbose mode
     export function logError(message: string): void; // Always show
     ```

- **Files**:
  - Various modules (updates for error handling)
  - `jawn-ai-state/src/utils/logger.ts` (new -- simple logging utility)
  - `jawn-ai-state/tests/unit/error-handling.test.ts` (new)

- **Parallel?**: Yes -- can develop alongside T037.
- **Notes**: The golden rule from the spec: **errors in state capture must not block the developer's work**. Log the error, return gracefully. This applies to every single public function. When in doubt, fail silently rather than crash.

---

## Risks & Mitigations

| Risk | Mitigation |
|------|-----------|
| Flaky tests from filesystem timing | Use proper async/await. Add small delays where needed. Use isolated temp dirs. |
| Platform differences (macOS vs Linux vs WSL2) | Primary target is macOS. Document known differences. |
| Lock contention under heavy use | 5-second timeout with graceful fallback. Locks are held for <100ms. |
| Error handling audit misses edge cases | Structure audit by module. Create a checklist of failure scenarios. |

## Review Guidance

- Run E2E tests and verify they pass in a clean environment
- Verify ALL hook scripts exit 0 even when jawn-ai binary is missing
- Verify concurrent write test actually tests concurrency (not sequential)
- Verify corrupted snapshot handling (manually corrupt a file and test restore)
- Verify the golden rule: no error path blocks the developer
- Check that logging goes to stderr (not stdout) to avoid interfering with CLI output or MCP protocol

## Activity Log

- 2026-02-16T19:42:12Z -- system -- lane=planned -- Prompt created.
