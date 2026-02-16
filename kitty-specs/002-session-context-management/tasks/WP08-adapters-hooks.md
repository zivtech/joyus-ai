---
work_package_id: WP08
title: Adapters & Hook Generation
lane: planned
dependencies:
- WP01
subtasks:
- T030
- T031
- T032
- T033
- T034
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

# Work Package Prompt: WP08 -- Adapters & Hook Generation

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

- Define the adapter interface that enables jawn-ai to work with multiple AI agent platforms
- Build the Claude Code adapter (generates hook scripts for `.claude/settings.json`)
- Create hook templates for session-start, post-tool-use, and session-end events
- Implement `jawn-ai hooks install` command
- Create a generic adapter stub for future Codex/web integration
- **Done when**: `jawn-ai hooks install` generates correct hook scripts; hooks call `jawn-ai snapshot` on events; adapter interface is defined for future platforms

## Context & Constraints

- **Research**: R4 -- Claude Code hooks call the `jawn-ai` CLI binary. Shell scripts in `.claude/settings.json`.
- **Plan**: See Architecture > Adapter Pattern for the design
- **Spec**: User Story 4 (event-driven snapshots), FR-001 (persist on events)
- **Claude Code hooks**: Shell commands in `.claude/settings.json` with `SessionStart`, `PostToolUse`, `Stop` event types
- **Hook mapping**:
  - `SessionStart` -> `jawn-ai restore` (display prior state)
  - `PostToolUse` (git commit, git checkout, test commands) -> `jawn-ai snapshot --event=<type> --quiet`
  - `Stop` -> `jawn-ai snapshot --event=session-end --quiet`
- **Depends on**: WP01 (types), WP04 (CLI must exist for hooks to call)

**Implementation command**: `spec-kitty implement WP08 --base WP04`

## Subtasks & Detailed Guidance

### Subtask T030 -- Adapter interface definition

- **Purpose**: Define the base interface that all platform adapters implement. This enables the agent-agnostic architecture from the plan.
- **Steps**:
  1. Create `src/adapters/types.ts` with:
     ```typescript
     export interface PlatformAdapter {
       /** Platform identifier */
       readonly name: string;

       /** Install hooks/integration for this platform */
       install(projectRoot: string, options?: InstallOptions): Promise<InstallResult>;

       /** Uninstall hooks/integration */
       uninstall(projectRoot: string): Promise<void>;

       /** Check if this platform is detected in the current environment */
       detect(projectRoot: string): Promise<boolean>;

       /** Map platform-specific events to jawn-ai event types */
       mapEvent(platformEvent: string): EventType | null;
     }

     export interface InstallOptions {
       force?: boolean;       // Overwrite existing hooks
       dryRun?: boolean;      // Show what would be installed without writing
     }

     export interface InstallResult {
       installed: string[];   // List of hooks/files installed
       skipped: string[];     // List of existing hooks not overwritten
       warnings: string[];    // Any warnings during installation
     }
     ```
  2. Export from `src/index.ts`

- **Files**:
  - `jawn-ai-state/src/adapters/types.ts` (new)

- **Parallel?**: No -- T031 implements this interface.
- **Notes**: The interface is intentionally minimal. Platform-specific details (hook scripts, config files, API endpoints) live in the adapter implementations, not the interface.

---

### Subtask T031 -- Claude Code adapter

- **Purpose**: Implement the Claude Code adapter that generates shell hook scripts and installs them into `.claude/settings.json`.
- **Steps**:
  1. Create `src/adapters/claude-code.ts` implementing `PlatformAdapter`:
     ```typescript
     export class ClaudeCodeAdapter implements PlatformAdapter {
       readonly name = 'claude-code';

       async install(projectRoot: string, options?: InstallOptions): Promise<InstallResult>;
       async uninstall(projectRoot: string): Promise<void>;
       async detect(projectRoot: string): Promise<boolean>;
       mapEvent(platformEvent: string): EventType | null;
     }
     ```
  2. `detect()`: Check for `.claude/` directory or `.claude/settings.json` in the project
  3. `mapEvent()`: Map Claude Code events to jawn-ai events:
     - PostToolUse where tool matches `git commit` -> `"commit"`
     - PostToolUse where tool matches `git checkout`/`git switch` -> `"branch-switch"`
     - PostToolUse where tool matches test commands (`npm test`, `vitest`, `phpunit`, `pytest`) -> `"test-run"`
     - SessionStart -> `"session-start"`
     - Stop -> `"session-end"`
  4. `install()`:
     - Resolve the absolute path to the `jawn-ai` binary (`which jawn-ai` or use the known install path)
     - Generate hook scripts from templates (T032)
     - Read existing `.claude/settings.json` (create if missing)
     - Merge jawn-ai hooks WITHOUT clobbering existing user hooks:
       - If a hook event already has entries, append jawn-ai hooks
       - If a hook event is new, add it
       - Track what was installed vs skipped
     - Write updated `.claude/settings.json`
     - Return `InstallResult`
  5. `uninstall()`: Remove jawn-ai hook entries from `.claude/settings.json` (leave other hooks intact)

- **Files**:
  - `jawn-ai-state/src/adapters/claude-code.ts` (new)

- **Parallel?**: No -- depends on T030 interface and T032 templates.
- **Notes**: The merge strategy is critical. NEVER clobber user's existing hooks. Use a marker comment in generated hooks (e.g., `# jawn-ai-managed`) to identify hooks that can be updated/removed.

---

### Subtask T032 -- Hook templates

- **Purpose**: Shell script templates that become the actual hooks Claude Code executes.
- **Steps**:
  1. Create `src/hooks/templates/session-start.sh.tmpl`:
     ```bash
     #!/bin/bash
     # jawn-ai-managed: session-start hook
     # Restores prior session context on new session start
     {{JAWN_AI_BIN}} restore --format=text 2>/dev/null || true
     ```
  2. Create `src/hooks/templates/post-tool-use.sh.tmpl`:
     ```bash
     #!/bin/bash
     # jawn-ai-managed: post-tool-use hook
     # Captures state snapshot after significant git/test events

     TOOL_NAME="$1"
     TOOL_INPUT="$2"

     # Detect event type from tool usage
     case "$TOOL_NAME" in
       Bash)
         case "$TOOL_INPUT" in
           *"git commit"*|*"git merge"*)
             {{JAWN_AI_BIN}} snapshot --event=commit --quiet 2>/dev/null || true
             ;;
           *"git checkout"*|*"git switch"*)
             {{JAWN_AI_BIN}} snapshot --event=branch-switch --quiet 2>/dev/null || true
             ;;
           *"npm test"*|*"vitest"*|*"jest"*|*"phpunit"*|*"pytest"*)
             {{JAWN_AI_BIN}} snapshot --event=test-run --quiet 2>/dev/null || true
             ;;
         esac
         ;;
     esac
     ```
  3. Create `src/hooks/templates/session-end.sh.tmpl`:
     ```bash
     #!/bin/bash
     # jawn-ai-managed: session-end hook
     # Captures final state snapshot on clean session exit
     {{JAWN_AI_BIN}} snapshot --event=session-end --quiet 2>/dev/null || true
     ```
  4. All templates:
     - Use `{{JAWN_AI_BIN}}` placeholder for the absolute path to the CLI binary
     - End with `|| true` to never block the user's workflow (FR-011)
     - Redirect stderr to `/dev/null` to avoid noisy error output
     - Include `# jawn-ai-managed` marker for identification

- **Files**:
  - `jawn-ai-state/src/hooks/templates/session-start.sh.tmpl` (new)
  - `jawn-ai-state/src/hooks/templates/post-tool-use.sh.tmpl` (new)
  - `jawn-ai-state/src/hooks/templates/session-end.sh.tmpl` (new)

- **Parallel?**: No -- T031 uses these templates.
- **Notes**: The `post-tool-use` hook receives tool name and input as arguments from Claude Code. Pattern matching on `$TOOL_INPUT` detects git/test commands. The `|| true` ensures hooks never fail and never block operations.

---

### Subtask T033 -- `jawn-ai hooks install` command

- **Purpose**: User-facing command that generates and installs hooks for the detected platform.
- **Steps**:
  1. Create `src/cli/commands/hooks.ts`:
     ```
     jawn-ai hooks install [--force] [--dry-run] [--platform=<claude-code>]
     ```
  2. Implementation:
     - If `--platform` not specified, auto-detect by trying each registered adapter's `detect()`
     - If no platform detected, list available platforms and ask user to specify
     - Call `adapter.install(projectRoot, { force, dryRun })`
     - Print installation summary:
       ```
       Hooks installed for Claude Code:
         ✓ SessionStart: jawn-ai restore
         ✓ PostToolUse: jawn-ai snapshot (commit, branch-switch, test-run)
         ✓ Stop: jawn-ai snapshot --event=session-end
       ```
     - If `--dry-run`: show what would be installed without writing
  3. Also support:
     ```
     jawn-ai hooks uninstall [--platform=<claude-code>]
     jawn-ai hooks status
     ```
     - `uninstall`: Remove jawn-ai hooks from the platform config
     - `status`: Show which hooks are currently installed

- **Files**:
  - `jawn-ai-state/src/cli/commands/hooks.ts` (new)

- **Parallel?**: No -- depends on T031 (Claude Code adapter).
- **Notes**: The `--dry-run` flag is important for users who want to see what will change before committing. The `--force` flag overwrites existing jawn-ai hooks but never touches non-jawn-ai hooks.

---

### Subtask T034 -- Generic adapter stub [P]

- **Purpose**: Create a stub adapter for future platforms (Codex, OpenClaw, web interface). This establishes the pattern without implementing the full integration.
- **Steps**:
  1. Create `src/adapters/generic.ts`:
     ```typescript
     export class GenericAdapter implements PlatformAdapter {
       readonly name = 'generic';

       async install(): Promise<InstallResult> {
         return {
           installed: [],
           skipped: [],
           warnings: ['Generic adapter does not support hook installation. Use the API directly.']
         };
       }

       async uninstall(): Promise<void> {
         // No-op for generic adapter
       }

       async detect(): Promise<boolean> {
         return false; // Generic adapter is never auto-detected
       }

       mapEvent(platformEvent: string): EventType | null {
         // Direct mapping for generic events
         const validEvents: EventType[] = ['commit', 'branch-switch', 'test-run', 'session-start', 'session-end', 'manual'];
         return validEvents.includes(platformEvent as EventType) ? (platformEvent as EventType) : null;
       }
     }
     ```
  2. Add a comment block explaining the intended use:
     - For Codex: would install via Codex's hook/plugin system
     - For web UI: would expose an HTTP endpoint for webhook-style events
     - For OpenClaw: would use their extension API
  3. Register the generic adapter in the adapter registry alongside Claude Code

- **Files**:
  - `jawn-ai-state/src/adapters/generic.ts` (new)

- **Parallel?**: Yes -- independent of T031-T033 (Claude Code adapter).
- **Notes**: This is a stub. It exists to (a) validate the adapter interface works for non-Claude-Code platforms, (b) provide a starting point for future implementations, and (c) allow the CLI to list available adapters.

---

## Risks & Mitigations

| Risk | Mitigation |
|------|-----------|
| Clobbering existing user hooks | Merge strategy: append jawn-ai hooks, never overwrite. Use `# jawn-ai-managed` marker. |
| Hook path resolution fails after `npm link` | Use absolute path to binary. Resolve at install time. |
| Claude Code hook format changes | Version-check Claude Code settings. Document minimum supported version. |
| Hook scripts fail silently | All hooks end with `\|\| true` and redirect stderr. Log failures to a file for debugging. |
| PostToolUse pattern matching too broad | Use specific patterns (e.g., `git commit` not just `git`). Test with real tool inputs. |

## Review Guidance

- Verify adapter interface is generic enough for non-Claude-Code platforms
- Verify Claude Code adapter merges hooks without clobbering existing ones
- Verify hook templates use absolute binary paths and `|| true`
- Verify `--dry-run` accurately shows what would be installed
- Verify `hooks uninstall` cleanly removes jawn-ai hooks while preserving user hooks
- Verify generated `.claude/settings.json` is valid JSON
- Test hook installation on a real Claude Code project

## Activity Log

- 2026-02-16T19:42:12Z -- system -- lane=planned -- Prompt created.
