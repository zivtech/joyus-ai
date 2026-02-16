---
work_package_id: WP04
title: CLI Foundation & Core Commands
lane: planned
dependencies:
- WP01
subtasks:
- T012
- T013
- T014
- T015
- T016
- T017
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

# Work Package Prompt: WP04 -- CLI Foundation & Core Commands

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

- Build the `jawn-ai` CLI binary with `commander` as the framework
- Implement the four core commands: `snapshot`, `restore`, `status`, `config`
- Create human-readable formatters for text output
- **Done when**: `jawn-ai snapshot` captures state to disk; `jawn-ai restore` displays formatted summary; `jawn-ai status` shows live context; `jawn-ai config init` sets up a new project

## Context & Constraints

- **Contracts**: `kitty-specs/002-session-context-management/contracts/state-api.md` (authoritative for CLI command signatures and output formats)
- **Quickstart**: `kitty-specs/002-session-context-management/quickstart.md` (user-facing flow to validate against)
- **Plan**: See project structure in `plan.md` for file locations under `src/cli/`
- **Performance**: CLI should start in <100ms. Use `tsx` for development, compiled JS for production.
- **Exit codes**: 0 = success, 1 = error. Errors must be logged but NEVER block the user's workflow (FR-011).
- **Depends on**: WP01 (types, schemas, config), WP02 (state store), WP03 (collectors)

**Implementation command**: `spec-kitty implement WP04 --base WP03`

(Note: WP04 depends on WP01+WP02+WP03. Use `--base WP03` since WP03 builds on WP01, and WP02 should also be merged by then.)

## Subtasks & Detailed Guidance

### Subtask T012 -- CLI entry point and commander setup

- **Purpose**: Establish the CLI framework that all commands plug into.
- **Steps**:
  1. Create `src/cli/index.ts` as the CLI entry point:
     ```typescript
     import { Command } from 'commander';

     const program = new Command();
     program
       .name('jawn-ai')
       .description('Session & context management for AI coding agents')
       .version('0.1.0');

     // Register commands here (snapshot, restore, status, config, etc.)

     program.parse();
     ```
  2. Update `bin/jawn-ai` to import and run the CLI:
     ```bash
     #!/usr/bin/env node
     import '../dist/cli/index.js';
     ```
  3. Register each command module (T013-T016) as subcommands
  4. Add global error handling: wrap the main program in try/catch, log errors, exit(1)
  5. Verify `npm link` makes the `jawn-ai` command available globally

- **Files**:
  - `jawn-ai-state/src/cli/index.ts` (new)
  - `jawn-ai-state/bin/jawn-ai` (update from WP01 stub)

- **Parallel?**: No -- must complete before T013-T016 can be tested end-to-end, but the command implementations can be written in parallel.

---

### Subtask T013 -- `jawn-ai snapshot` command

- **Purpose**: The primary write command. Orchestrates all collectors, assembles a Snapshot, and writes it via the store. Called by hooks on every significant event.
- **Steps**:
  1. Create `src/cli/commands/snapshot.ts`:
     ```typescript
     export function registerSnapshotCommand(program: Command): void;
     ```
  2. Command definition:
     ```
     jawn-ai snapshot [--event=<type>] [--decision="<text>"] [--quiet]
     ```
  3. Implementation flow:
     - Determine project root (walk up from cwd looking for `.git/`)
     - Load config (project + global)
     - Run all collectors in parallel:
       - `collectGitState(projectRoot)`
       - `collectFileState(projectRoot)`
       - (test results: only if `--event=test-run` and stdin has data)
     - Load existing decisions from last snapshot (for carry-forward)
     - If `--decision` flag provided, add a new pending decision
     - Assemble the `Snapshot` object:
       - Generate `id` with CUID2
       - Set `version: "1.0.0"`
       - Set `timestamp` to current ISO 8601
       - Set `event` from `--event` flag (default: `"manual"`)
       - Populate all fields from collector results
     - Validate with `SnapshotSchema`
     - Write via `StateStore.write()`
     - Print confirmation (unless `--quiet`)
  4. Output format (unless `--quiet`):
     ```
     Snapshot captured: 2026-02-16T14:30:00 [commit]
       Branch: feature/a11y-652 | Files: 3 modified | Tests: 12 pass, 2 fail
     ```

- **Files**:
  - `jawn-ai-state/src/cli/commands/snapshot.ts` (new)

- **Parallel?**: No -- other commands (restore, status) depend on snapshots existing.
- **Notes**: The `--quiet` flag is essential for hooks (they should not pollute tool output). The `--event` flag maps to the `EventType` enum.

---

### Subtask T014 -- `jawn-ai restore` command

- **Purpose**: The primary read command at session start. Loads the latest snapshot and displays a formatted summary so the user knows where they left off.
- **Steps**:
  1. Create `src/cli/commands/restore.ts`:
     ```
     jawn-ai restore [--format=<text|json>] [--id=<snapshot-id>]
     ```
  2. Implementation flow:
     - Determine project root
     - Load state store
     - Read latest snapshot (or specific `--id` if provided)
     - If no snapshot exists: print "No prior session state found." and exit(0)
     - If `--format=json`: print raw JSON and exit
     - If `--format=text` (default): pass to formatter (T017)
  3. The text output format must match the contract in `state-api.md`:
     ```
     === Session Context (from 2026-02-16T14:30:00, event: commit) ===

     Branch: feature/a11y-652 (3 ahead of origin)
     Last commit: abc1234 "Fix FilterPipeSeparators accessibility"

     Modified files (not committed):
       - src/templates/navigation.html.twig
       - src/css/accessible-nav.css

     Tests (last run):
       12 passed, 2 failed
       Failing: FilterPipeSeparatorsTest::testMobileNav, ThemeA11yTest::testAriaLabels

     Pending decisions:
       - [OPEN] Should mobile nav use accordion or dropdown?

     Canonical documents:
       - tracking-spreadsheet: path/to/file.csv (modified 2h ago)

     ===
     ```

- **Files**:
  - `jawn-ai-state/src/cli/commands/restore.ts` (new)

- **Parallel?**: Yes -- can develop alongside T015, T016 once T012 is set up.

---

### Subtask T015 -- `jawn-ai status` command

- **Purpose**: Show the current live context (reads git and filesystem directly, not from snapshot). Combines live data with last snapshot's decisions and task context.
- **Steps**:
  1. Create `src/cli/commands/status.ts`:
     ```
     jawn-ai status [--format=<text|json>]
     ```
  2. Implementation flow:
     - Determine project root
     - Run collectors for live state: `collectGitState()`, `collectFileState()`
     - Load latest snapshot for decisions and task context
     - Run divergence detection (T007 from WP02) if a snapshot exists
     - If diverged: show a prominent warning at the top
     - Format and display the combined state
  3. Output is similar to `restore` but with "LIVE" context and divergence warnings:
     ```
     === Current Context (live) ===

     ⚠ State diverged: branch changed from feature/a11y-652 to main

     Branch: main
     ...
     ```

- **Files**:
  - `jawn-ai-state/src/cli/commands/status.ts` (new)

- **Parallel?**: Yes -- can develop alongside T014, T016.

---

### Subtask T016 -- `jawn-ai config` command

- **Purpose**: Manage global and project configuration. Includes the `init` subcommand for first-time project setup.
- **Steps**:
  1. Create `src/cli/commands/config.ts`:
     ```
     jawn-ai config get <key>
     jawn-ai config set <key> <value>
     jawn-ai config list
     jawn-ai config init
     ```
  2. `config init`:
     - Create `.jawn-ai/` in project root
     - Create `.jawn-ai/config.json` with defaults
     - Create `.jawn-ai/canonical.json` with empty `{ "documents": {} }`
     - Create state directory at `~/.jawn-ai/projects/<hash>/`
     - Print setup summary
     - Suggest adding `.jawn-ai/` to `.gitignore`
  3. `config get <key>`: Read config and print the value for the given key (dot-notation: `eventTriggers.commit`)
  4. `config set <key> <value>`: Parse value (boolean/number/string), update config, save
  5. `config list`: Print all current settings with their values and defaults

- **Files**:
  - `jawn-ai-state/src/cli/commands/config.ts` (new)

- **Parallel?**: Yes -- can develop alongside T014, T015.
- **Notes**: `config set` should validate values before saving. Boolean keys accept "true"/"false". Number keys reject non-numeric values. The `init` subcommand is the first thing a user runs in a new project.

---

### Subtask T017 -- Human-readable formatters

- **Purpose**: Centralize the text output formatting used by `restore`, `status`, and other display commands. Consistent, readable output is critical for user experience.
- **Steps**:
  1. Create `src/cli/formatters.ts` with:
     ```typescript
     export function formatSnapshot(snapshot: Snapshot, options?: { verbosity: 'minimal' | 'normal' | 'verbose' }): string;
     export function formatDivergence(report: DivergenceReport): string;
     export function formatSharedState(snapshot: Snapshot, sharerNote: SharerNote): string;
     ```
  2. `formatSnapshot()` produces the text format from the `state-api.md` contract:
     - Header line with timestamp and event type
     - Branch info with ahead/behind counts
     - Last commit hash and message
     - Modified files section (if any)
     - Test results section (if available)
     - Pending decisions section (if any)
     - Canonical documents section (if any)
     - Footer line
  3. Verbosity levels:
     - `minimal`: Branch + commit only
     - `normal`: Full snapshot (default)
     - `verbose`: Everything + file lists, all decisions (including resolved)
  4. `formatDivergence()` produces a warning block
  5. `formatSharedState()` adds the sharer note header before the snapshot format
  6. Use chalk or similar for terminal colors (optional -- plain text must also work)

- **Files**:
  - `jawn-ai-state/src/cli/formatters.ts` (new)

- **Parallel?**: No -- should be developed after T014 (restore) so the output format is validated against real data.
- **Notes**: Formatters should handle missing/null fields gracefully (e.g., no test results = skip that section). Consider relative time for timestamps ("2 hours ago" vs "2026-02-16T14:30:00").

---

## Risks & Mitigations

| Risk | Mitigation |
|------|-----------|
| CLI cold start too slow | Use compiled JS (not tsx) in production. Keep dependency tree minimal. |
| `npm link` path issues on macOS | Document in quickstart. Test during WP01 setup. |
| Project root detection fails | Walk up from cwd looking for `.git/`. Clear error if not found. |
| Config init clobbers existing config | Check for existing `.jawn-ai/` and warn before overwriting. |

## Review Guidance

- Test the quickstart flow end-to-end: `config init` -> `snapshot` -> `restore`
- Verify output formats match `contracts/state-api.md` exactly
- Verify `--quiet` suppresses all output (critical for hook usage)
- Verify `--format=json` produces valid, parseable JSON
- Verify all commands handle "no project root found" gracefully
- Verify formatters handle missing/null fields without crashing

## Activity Log

- 2026-02-16T19:42:12Z -- system -- lane=planned -- Prompt created.
