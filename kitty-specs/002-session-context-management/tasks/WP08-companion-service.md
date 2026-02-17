---
work_package_id: WP08
title: Companion Service
lane: planned
dependencies:
- WP01
subtasks:
- T029
- T030
- T031
- T032
- T033
phase: Phase 2 - Primary Interface
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

# Work Package Prompt: WP08 -- Companion Service

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

- Build a background service that watches for significant events and captures state snapshots automatically
- Implement filesystem watching for git operations and file changes with debouncing
- Provide IPC for the MCP server to check service status and request immediate captures
- **Done when**: Service starts, detects a git commit, captures a snapshot, and stops gracefully on SIGTERM. MCP server can check service health via IPC.

## Context & Constraints

- **Plan**: `plan.md` — Companion Service section (daemon, watcher, event-handler, IPC, event detection table)
- **Architecture**: The companion service handles background state capture that the MCP request/response protocol can't do (long-running processes, filesystem watchers)
- **Optional**: MCP server works without the companion service (degraded but functional). The service adds automatic event capture.
- **Performance**: <1% CPU during idle. Snapshot capture <100ms. Event detection non-blocking.
- **Lifecycle**: User runs `npx jawn-ai-service`. Writes PID file. Graceful shutdown on SIGTERM/SIGINT.
- **Depends on**: WP01 (types), WP02 (state store), WP03 (collectors)

**Implementation command**: `spec-kitty implement WP08 --base WP03`

(Note: WP08 depends on WP01+WP02+WP03 — same as WP06. WP06 and WP08 can be built in parallel.)

## Subtasks & Detailed Guidance

### Subtask T029 -- Service daemon

- **Purpose**: The main service process — handles lifecycle, PID file management, and orchestrates the watcher and event handler.
- **Steps**:
  1. Create `src/service/daemon.ts`:
     ```typescript
     export interface ServiceOptions {
       projectRoot: string;
       foreground?: boolean;  // default: true (run in foreground)
     }

     export async function startService(options: ServiceOptions): Promise<void>;
     export async function stopService(stateDir: string): Promise<void>;
     export function isServiceRunning(stateDir: string): boolean;
     ```
  2. `startService()`:
     - Compute state directory from project root
     - Check if another service instance is already running (check PID file)
     - If running, log warning and exit
     - Write PID file: `~/.jawn-ai/projects/<hash>/service.pid` containing `{ pid: process.pid, startedAt: ISO8601 }`
     - Initialize the filesystem watcher (T030)
     - Initialize the event handler (T031)
     - Initialize the IPC server (T032)
     - Log startup message to stderr
     - Register signal handlers:
       - SIGTERM: graceful shutdown
       - SIGINT: graceful shutdown
       - SIGUSR1: force an immediate snapshot capture
  3. Graceful shutdown:
     - Stop the filesystem watcher
     - Stop the IPC server
     - Remove PID file
     - Remove port file (IPC)
     - Log shutdown message
     - Exit cleanly
  4. `stopService()`: Read PID file, send SIGTERM to the process
  5. `isServiceRunning()`: Check PID file exists and process is alive (`process.kill(pid, 0)`)

- **Files**:
  - `jawn-ai-state/src/service/daemon.ts` (new)

- **Parallel?**: No -- T030-T032 are components of the daemon.
- **Notes**: The PID file check prevents multiple service instances for the same project. If the PID file exists but the process is dead (stale PID), remove the file and start normally.

---

### Subtask T030 -- Filesystem watcher

- **Purpose**: Monitor the project directory for significant events — git operations, file changes. Emit events for the handler to process.
- **Steps**:
  1. Create `src/service/watcher.ts`:
     ```typescript
     import { EventEmitter } from 'events';

     export interface WatcherOptions {
       projectRoot: string;
       debounce?: {
         gitEvents: number;    // default: 500ms
         testRuns: number;     // default: 2000ms
         fileChanges: number;  // default: 5000ms
       };
     }

     export class FileWatcher extends EventEmitter {
       constructor(options: WatcherOptions);
       start(): void;
       stop(): void;
     }

     // Events emitted:
     // 'git-commit' — .git/refs/heads/<branch> changed
     // 'git-branch-switch' — .git/HEAD changed
     // 'file-change' — project files modified
     // 'test-output' — test output file detected
     ```
  2. Watch targets:
     - `.git/HEAD` — detect branch switches (content changes from `ref: refs/heads/X` to `ref: refs/heads/Y`)
     - `.git/refs/heads/` — detect new commits (file modified timestamps change)
     - Project files (respecting `.gitignore`) — detect significant file changes
  3. Debouncing strategy:
     - Use a timer per event type
     - When a filesystem event fires, reset the timer
     - When the timer fires (after debounce period with no new events), emit the event
     - Git events: 500ms debounce (fast — these are important)
     - File changes: 5000ms debounce (slow — avoid noise from rapid edits)
  4. Use `fs.watch` (Node.js built-in) for v1. Consider `chokidar` if `fs.watch` proves unreliable.
  5. Ignore patterns:
     - `.git/objects/` (too noisy)
     - `node_modules/`
     - Files matching `.gitignore` patterns
     - `.tmp` files (our own atomic writes)
  6. CPU budget: <1% during idle. File watchers are kernel-level (inotify/FSEvents) so this should be achievable.

- **Files**:
  - `jawn-ai-state/src/service/watcher.ts` (new)

- **Parallel?**: No -- T031 consumes events from this watcher.
- **Notes**: `fs.watch` on macOS uses FSEvents which is efficient. On Linux, it uses inotify which has a limit on watch descriptors. For large repos, we may need to watch only `.git/` and a limited set of project paths rather than the entire tree.

---

### Subtask T031 -- Event handler

- **Purpose**: Receive events from the filesystem watcher, classify them into EventType values, and trigger snapshot capture.
- **Steps**:
  1. Create `src/service/event-handler.ts`:
     ```typescript
     export class EventHandler {
       constructor(
         private projectRoot: string,
         private stateStore: StateStore,
       );

       async handleEvent(eventType: string, detail?: string): Promise<void>;
     }
     ```
  2. Event classification:
     - `git-commit` → EventType `"commit"`
     - `git-branch-switch` → EventType `"branch-switch"`
     - `file-change` → EventType `"file-change"`
     - `test-output` → EventType `"test-run"`
  3. `handleEvent()`:
     - Map the raw event to an EventType
     - Run collectors (git, files) — same as `save_state` MCP tool
     - If test event: parse test output if available
     - Carry forward decisions from last snapshot
     - Assemble and write snapshot
     - Log the capture to stderr: `[jawn-ai-service] Snapshot captured: <timestamp> [<event>]`
  4. Error handling: catch all errors, log to stderr, never crash the service
  5. Connect to the FileWatcher events in the daemon (T029)

- **Files**:
  - `jawn-ai-state/src/service/event-handler.ts` (new)

- **Parallel?**: Yes -- can be developed alongside T032 (IPC). Depends on T030 for event types.

---

### Subtask T032 -- MCP ↔ Service IPC

- **Purpose**: Allow the MCP server to communicate with the companion service — check if it's running, request immediate snapshot capture, and query status.
- **Steps**:
  1. Create `src/service/ipc.ts`:
     ```typescript
     import http from 'http';

     export interface IpcServer {
       start(): Promise<number>;  // returns port number
       stop(): Promise<void>;
     }

     export function createIpcServer(
       projectRoot: string,
       eventHandler: EventHandler
     ): IpcServer;

     // Client functions (used by MCP server)
     export async function checkServiceHealth(stateDir: string): Promise<boolean>;
     export async function requestCapture(stateDir: string, event?: EventType): Promise<void>;
     ```
  2. IPC server (runs inside companion service):
     - Create a simple HTTP server on localhost with a random port
     - Write port to `~/.jawn-ai/projects/<hash>/service.port`
     - Endpoints:
       - `GET /health` → `{ status: "running", pid, uptime, lastCapture }`
       - `POST /capture` → trigger immediate snapshot, body: `{ event?: EventType }`
     - Remove port file on shutdown
  3. IPC client functions (used by MCP server in WP06):
     - `checkServiceHealth()`: Read port file, call `/health`, return true/false
     - `requestCapture()`: Read port file, call `/capture` with event type
  4. If port file doesn't exist or connection fails: service is not running (return false / no-op)

- **Files**:
  - `jawn-ai-state/src/service/ipc.ts` (new)

- **Parallel?**: Yes -- independent of T030/T031.
- **Notes**: Using HTTP on localhost is simple and debuggable. Unix sockets would be slightly more efficient but harder to debug. HTTP is fine for v1 since the traffic is minimal (a few requests per session).

---

### Subtask T033 -- Service entry point

- **Purpose**: Create the executable entry point that users run to start the companion service.
- **Steps**:
  1. Update `bin/jawn-ai-service`:
     ```javascript
     #!/usr/bin/env node
     import { startService } from '../dist/service/daemon.js';

     const projectRoot = process.env.PROJECT_ROOT || process.cwd();

     startService({ projectRoot }).catch((error) => {
       console.error('Failed to start companion service:', error);
       process.exit(1);
     });
     ```
  2. Make executable: `chmod +x bin/jawn-ai-service`
  3. Support CLI flags (parse process.argv):
     - `--project <path>`: explicit project root (overrides cwd)
     - `--stop`: stop a running service for the project
     - `--status`: check if service is running
  4. Verify it starts, watches, detects a commit, and captures a snapshot
  5. Verify graceful shutdown on Ctrl+C

- **Files**:
  - `jawn-ai-state/bin/jawn-ai-service` (update from stub)

- **Parallel?**: No -- depends on T029 daemon.

---

## Risks & Mitigations

| Risk | Mitigation |
|------|-----------|
| File watcher CPU usage on large repos | Debounce aggressively. Watch `.git/` + limited project paths only. |
| `fs.watch` unreliable on Linux | Use `chokidar` as fallback. Document known limitations. |
| Port conflicts for IPC | Random port with retry on EADDRINUSE. Port written to file. |
| Stale PID file after crash | Check if PID is alive before declaring conflict. Remove stale files. |
| Service and MCP server race on writes | Both use atomic writes. Concurrent writes produce separate valid files. |

## Review Guidance

- Verify service starts and writes PID file
- Verify service detects git commit (modify `.git/refs/heads/<branch>` and check for snapshot)
- Verify service detects branch switch (modify `.git/HEAD` and check for snapshot)
- Verify debouncing works (rapid events produce one snapshot, not many)
- Verify graceful shutdown removes PID and port files
- Verify IPC health endpoint returns correct status
- Verify IPC capture endpoint triggers immediate snapshot
- Verify service handles "already running" case gracefully
- Verify <1% CPU during idle (no busy loops)

## Activity Log

- 2026-02-17T03:14:10Z -- system -- lane=planned -- Prompt created.
