---
work_package_id: WP09
title: Integration & Hardening
lane: "doing"
dependencies: []
subtasks:
- T034
- T035
- T036
- T037
- T038
phase: Phase 3 - Integration & Hardening
assignee: ''
agent: "claude-opus"
shell_pid: "22194"
review_status: ''
reviewed_by: ''
history:
- timestamp: '2026-02-17T03:14:10Z'
  lane: planned
  agent: system
  shell_pid: ''
  action: Prompt generated via /spec-kitty.tasks (MCP-first architecture)
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

- Verify full system works end-to-end: MCP tools + companion service + state store
- Implement concurrent session handling with file locking
- Harden error handling across all components
- Add logging infrastructure
- **Done when**: E2E tests pass; concurrent sessions don't corrupt state; errors are logged but never block the user; all components degrade gracefully

## Context & Constraints

- **Spec FR-006**: Survive dirty exits (crash, force-quit)
- **Spec FR-009**: Handle concurrent sessions without data loss
- **Spec FR-011**: Fall back gracefully on corrupted/missing/stale state — NEVER block session start
- **Spec SC-005**: After simulated crash, next session recovers state no more than one event behind
- **Quickstart**: `quickstart.md` verification section defines the E2E acceptance flow
- **Golden rule**: Errors in state capture must not block the developer's work. Log, return gracefully.
- **Depends on**: ALL Phase 2 packages (WP06, WP07, WP08)

**Implementation command**: `spec-kitty implement WP09 --base WP08`

(Note: WP09 depends on all Phase 2 WPs. Use `--base WP08` as the latest dependency.)

## Subtasks & Detailed Guidance

### Subtask T034 -- MCP tools integration tests

- **Purpose**: Verify the full MCP tool lifecycle works end-to-end in a real git repository: get_context → save_state → verify_action → check_canonical → share_state.
- **Steps**:
  1. Create `tests/integration/mcp-tools.test.ts`:
     ```typescript
     describe('MCP Tools E2E', () => {
       let tempDir: string;
       let projectRoot: string;
       let server: Server;

       beforeEach(async () => {
         // Create temp directory with fresh git repo
         // Set HOME to temp location (isolate ~/.joyus-ai/)
         // Initialize state directory
         // Create MCP server for the project
       });

       afterEach(async () => {
         // Stop server
         // Clean up temp directory
       });

       test('get_context returns live state when no snapshots exist', async () => {
         // Call get_context
         // Verify response has git state (branch, commit) but null tests/decisions
       });

       test('save_state → get_context round-trip', async () => {
         // Make a git commit
         // Call save_state with event=commit
         // Call get_context
         // Verify response includes the commit
       });

       test('verify_action catches branch mismatch', async () => {
         // Save state on feature branch
         // Switch to main
         // Call verify_action with action=commit
         // Verify warning about branch mismatch
       });

       test('check_canonical declare and check', async () => {
         // Create a test file
         // Call check_canonical with action=declare
         // Call check_canonical with action=check on canonical path → isCanonical: true
         // Call check_canonical with action=check on different path → isCanonical: false
       });

       test('share_state export and import', async () => {
         // Save a snapshot
         // Call share_state with action=export and a note
         // Verify shared file exists
         // Call share_state with action=import on the shared file
         // Verify sharer note is returned
       });

       test('full lifecycle', async () => {
         // 1. get_context (empty)
         // 2. Make commit, save_state
         // 3. get_context (has commit)
         // 4. Declare canonical doc
         // 5. verify_action (branch check passes)
         // 6. Share state
         // 7. Load shared state
       });
     });
     ```
  2. Each test:
     - Uses isolated temp directory with fresh git repo
     - Calls tool handlers directly (not via stdio — faster and more controllable)
     - Validates response format matches `contracts/state-api.md`
     - Cleans up after itself

- **Files**:
  - `joyus-ai-state/tests/integration/mcp-tools.test.ts` (new)

- **Parallel?**: Yes -- independent of T035.

---

### Subtask T035 -- Companion service integration tests

- **Purpose**: Verify the companion service detects events and captures snapshots automatically.
- **Steps**:
  1. Create `tests/integration/service.test.ts`:
     ```typescript
     describe('Companion Service Integration', () => {
       test('detects git commit and captures snapshot', async () => {
         // Start watcher on temp git repo
         // Make a commit (modify .git/refs/heads/main)
         // Wait for debounce period
         // Verify a snapshot was created
       });

       test('detects branch switch and captures snapshot', async () => {
         // Start watcher
         // Switch branches (modify .git/HEAD)
         // Wait for debounce
         // Verify snapshot with event=branch-switch
       });

       test('debounces rapid events', async () => {
         // Start watcher
         // Trigger 5 rapid file changes within 1 second
         // Wait for debounce period
         // Verify only 1 snapshot was created (not 5)
       });

       test('IPC health check works', async () => {
         // Start service
         // Call checkServiceHealth
         // Verify returns true with status info
       });

       test('IPC capture request works', async () => {
         // Start service
         // Call requestCapture
         // Verify new snapshot was created
       });

       test('graceful shutdown cleans up', async () => {
         // Start service
         // Verify PID file exists
         // Send SIGTERM
         // Verify PID and port files removed
       });
     });
     ```
  2. Use short debounce periods in tests (100ms instead of 500ms) for speed
  3. Tests must clean up watchers and servers to avoid resource leaks

- **Files**:
  - `joyus-ai-state/tests/integration/service.test.ts` (new)

- **Parallel?**: Yes -- independent of T034.

---

### Subtask T036 -- Concurrent session handling

- **Purpose**: Ensure multiple sessions writing to the same state store don't corrupt data. Critical for developers with multiple terminal windows.
- **Steps**:
  1. Add file locking to `src/state/store.ts`:
     ```typescript
     // Lockfile: <state-dir>/snapshots/write.lock
     // Contains: { pid: number, timestamp: string }
     // Strategy:
     //   1. Try atomic create (O_CREAT | O_EXCL)
     //   2. If exists, check PID alive
     //   3. If stale, remove and retry
     //   4. If alive, wait up to 5s (100ms polling)
     //   5. If timeout, give up gracefully (log warning, skip write)
     ```
  2. Implement lock acquisition:
     ```typescript
     async function acquireLock(lockPath: string, timeoutMs: number): Promise<boolean>;
     async function releaseLock(lockPath: string): Promise<void>;
     ```
  3. Wrap `StateStore.write()` with lock:
     ```typescript
     async write(snapshot: Snapshot): Promise<string | null> {
       const locked = await acquireLock(this.lockPath, 5000);
       if (!locked) {
         console.error('[joyus-ai] Could not acquire write lock, skipping snapshot');
         return null;
       }
       try {
         // ... existing write logic ...
       } finally {
         await releaseLock(this.lockPath);
       }
     }
     ```
  4. Key invariant: even without locking, atomic writes (temp + rename) prevent corruption. Locking prevents duplicate/missed snapshots, not data corruption.
  5. Never block the user — if lock can't be acquired, skip the write silently

- **Files**:
  - `joyus-ai-state/src/state/store.ts` (update — add locking)

- **Parallel?**: No -- modifies the core store.

---

### Subtask T037 -- Error handling audit

- **Purpose**: Audit all public functions across all modules and ensure graceful degradation. The system must NEVER block the developer's workflow.
- **Steps**:
  1. Audit each module category:
     - **Collectors** (git, files, tests, decisions): Must return partial/default data on error. Never throw.
     - **State store** (write, read, list): Return null on read errors. Log on write errors. Never throw to caller.
     - **Canonical** (load, save, check): Return empty declarations if file missing/corrupted. Never throw.
     - **Sharing** (export, import): Return clear error messages. Never throw unhandled.
     - **MCP tools**: Wrap in try/catch. Return MCP error responses. Never crash server.
     - **Companion service**: Log errors. Never crash. Continue running.
  2. Test specific failure scenarios:
     - Corrupted snapshot file (invalid JSON) → skip, load next valid
     - Missing `.joyus-ai/` directory → create on demand
     - Git not installed or not a git repo → return defaults
     - Permission denied on state directory → log warning, degrade
     - Snapshot file exceeds schema validation → reject with warning, skip
     - Config file with invalid values → use defaults for invalid fields
  3. Create `tests/unit/error-handling.test.ts` with tests for each scenario
  4. Fix any functions that throw on expected error conditions

- **Files**:
  - Various modules (updates for error handling)
  - `joyus-ai-state/tests/unit/error-handling.test.ts` (new)

- **Parallel?**: Yes -- can develop alongside T036 and T038.

---

### Subtask T038 -- Logging utility

- **Purpose**: Centralize logging with levels, stderr output, and verbose mode. Used by all components.
- **Steps**:
  1. Create `src/utils/logger.ts`:
     ```typescript
     export enum LogLevel {
       ERROR = 0,
       WARN = 1,
       INFO = 2,
       DEBUG = 3,
     }

     let currentLevel: LogLevel = LogLevel.WARN;

     export function setLogLevel(level: LogLevel): void;
     export function logError(message: string, error?: Error): void;
     export function logWarn(message: string): void;
     export function logInfo(message: string): void;
     export function logDebug(message: string): void;
     ```
  2. All output goes to stderr (`console.error`), never stdout
  3. Format: `[joyus-ai] [LEVEL] message`
  4. `logError` includes stack trace in debug mode
  5. Default level: WARN (show errors and warnings)
  6. Environment variable `JOYUS_AI_LOG_LEVEL` to override (ERROR, WARN, INFO, DEBUG)
  7. Verbose mode (DEBUG) shows collector timing, snapshot sizes, file paths
  8. Export from `src/index.ts`
  9. Update existing modules to use the logger instead of direct `console.error`

- **Files**:
  - `joyus-ai-state/src/utils/logger.ts` (new)
  - `joyus-ai-state/src/index.ts` (update exports)
  - Various modules (update to use logger)

- **Parallel?**: Yes -- independent utility.

---

## Risks & Mitigations

| Risk | Mitigation |
|------|-----------|
| Flaky tests from filesystem timing | Use proper async/await. Add small delays where needed. Isolated temp dirs. |
| Platform differences (macOS vs Linux vs WSL2) | Primary target is macOS. Document known differences. |
| Lock contention under heavy use | 5-second timeout with graceful fallback. Locks held for <100ms. |
| Error handling audit misses edge cases | Structure audit by module. Create checklist of failure scenarios. |
| Logging too verbose | Default to WARN level. Only show errors and warnings unless explicitly set to DEBUG. |

## Review Guidance

- Run integration tests and verify they pass in a clean environment
- Verify concurrent write test actually tests concurrency (not sequential)
- Verify corrupted snapshot handling (manually corrupt a file and test read)
- Verify the golden rule: NO error path blocks the developer
- Verify all logging goes to stderr (not stdout)
- Verify service graceful degradation (kill -9 then restart)
- Verify SC-005: after simulated crash, next session recovers state no more than one event behind

## Activity Log

- 2026-02-17T03:14:10Z -- system -- lane=planned -- Prompt created.
- 2026-02-19T00:27:21Z – claude-opus – shell_pid=22194 – lane=doing – Started implementation via workflow command
