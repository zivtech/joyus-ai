---
work_package_id: WP08
title: Companion Service Extensions
lane: "done"
dependencies:
- WP04
- WP05
base_branch: 004-workflow-enforcement-WP08-merge-base
base_commit: 0a0a7874eacaee8259976cf86da33da562576c37
created_at: '2026-02-18T19:41:44.077305+00:00'
subtasks:
- T042
- T043
- T044
- T045
phase: Phase 3 - MCP Tools & Events
assignee: ''
agent: "claude-opus"
shell_pid: "31513"
review_status: "approved"
reviewed_by: "Alex Urevick-Ackelsberg"
history:
- timestamp: '2026-02-17T15:00:00Z'
  lane: planned
  agent: system
  shell_pid: ''
  action: Prompt generated via /spec-kitty.tasks
---

# Work Package Prompt: WP08 -- Companion Service Extensions

## IMPORTANT: Review Feedback Status

- **Has review feedback?**: Check `review_status` above.
- **Mark as acknowledged**: Update `review_status: acknowledged` when addressing feedback.

---

## Review Feedback

*[This section is empty initially.]*

---

## Objectives & Success Criteria

- Extend the companion service from 002 with enforcement-specific event handlers
- Implement session-start hygiene check, file-change skill reload, and branch-switch config reload
- Wire events into the existing event handler infrastructure
- **Done when**: Companion service triggers hygiene checks on startup, reloads skills when matching files change, reloads config on branch switch

## Context & Constraints

- **002 Companion Service**: `joyus-ai-state/src/service/` -- daemon.ts, watcher.ts, event-handler.ts
- **Plan**: Companion service from 002 already watches filesystem and git events. This WP adds new event types.
- **Spec**: User Story 5 (session-start hygiene), FR-008/FR-013 (skill auto-load on file change)
- **Risk**: 002's companion service may not exist yet. Build event handlers as standalone modules.

**Implementation command**: `spec-kitty implement WP08 --base WP05`

## Subtasks & Detailed Guidance

### Subtask T042 -- Implement session-start hygiene check trigger

- **Purpose**: When a new session starts (companion service boots or MCP server connects), automatically run branch hygiene checks and report to Claude.
- **Steps**:
  1. Create `joyus-ai-state/src/enforcement/events/session-start.ts`
  2. Implement `onSessionStart(config: EnforcementConfig): Promise<SessionStartReport>`:
     - Call `detectStaleBranches()` from git engine
     - Call `checkBranchCount()` from git engine
     - Compile report: stale branches, branch count warnings
     - Create audit entry with `actionType: 'branch-hygiene'`
     - Return report for MCP server to surface to Claude
  3. Report format:
     ```typescript
     interface SessionStartReport {
       staleBranches: StaleBranch[];
       branchCountWarning: boolean;
       activeBranchCount: number;
       suggestions: string[];  // human-readable suggestions for Claude
     }
     ```
- **Files**: `joyus-ai-state/src/enforcement/events/session-start.ts` (new, ~50 lines)
- **Parallel?**: Yes

### Subtask T043 -- Implement file-change skill auto-load trigger

- **Purpose**: When files change that match skill mapping patterns, trigger skill reload so Claude has up-to-date constraints.
- **Steps**:
  1. Create `joyus-ai-state/src/enforcement/events/file-change.ts`
  2. Implement `onFileChange(changedFiles: string[], config: EnforcementConfig): Promise<SkillReloadResult>`:
     - Call `matchSkillsForFiles()` with changed file paths
     - If new skills matched: load them (with cache fallback)
     - Resolve precedence
     - Return list of newly loaded skills and updated context
  3. Implement debouncing: rapid file changes (< 2 seconds apart) should be batched
  4. Only trigger reload if the matched skill set changes (avoid redundant reloads)
  5. Create audit entry with `actionType: 'skill-load'` for each newly loaded skill
- **Files**: `joyus-ai-state/src/enforcement/events/file-change.ts` (new, ~60 lines)
- **Parallel?**: Yes
- **Notes**: Debouncing is important -- rapid saves in an IDE shouldn't trigger 10 skill reloads.

### Subtask T044 -- Implement branch-switch config reload trigger

- **Purpose**: When the developer switches branches, enforcement config may change (different branch may have different gates/rules). Reload config.
- **Steps**:
  1. Create `joyus-ai-state/src/enforcement/events/branch-switch.ts`
  2. Implement `onBranchSwitch(newBranch: string, config: EnforcementConfig): Promise<ConfigReloadResult>`:
     - Reload project config from `.joyus-ai/config.json` (may be different on new branch)
     - Reload developer config (in case project hash changed)
     - Re-merge configs
     - Compare with previous config: detect what changed (new gates, different rules)
     - Create audit entry with `actionType: 'config-reload'`
     - Return diff summary of config changes
  3. Also check branch naming convention for the new branch
- **Files**: `joyus-ai-state/src/enforcement/events/branch-switch.ts` (new, ~50 lines)
- **Parallel?**: Yes

### Subtask T045 -- Wire enforcement events into companion service

- **Purpose**: Connect the event handlers (T042-T044) to the companion service's event routing system.
- **Steps**:
  1. If 002's `event-handler.ts` exists: extend it with new event types
  2. If not: create `joyus-ai-state/src/enforcement/events/router.ts`:
     ```typescript
     export class EnforcementEventRouter {
       constructor(private config: EnforcementConfig, private auditWriter: AuditWriter) {}

       async handleEvent(event: EnforcementEvent): Promise<void> {
         switch (event.type) {
           case 'session-start': return this.onSessionStart();
           case 'file-change': return this.onFileChange(event.files);
           case 'branch-switch': return this.onBranchSwitch(event.branch);
         }
       }
     }
     ```
  3. Define `EnforcementEvent` type:
     - `{ type: 'session-start' }`
     - `{ type: 'file-change', files: string[] }`
     - `{ type: 'branch-switch', branch: string }`
  4. Export router for integration with 002's companion service (or standalone use)
- **Files**: `joyus-ai-state/src/enforcement/events/router.ts` (new, ~40 lines)
- **Notes**: Build as a standalone module that can be wired into 002's event system later. Don't create hard dependencies on 002's daemon if it doesn't exist yet.

## Risks & Mitigations

- **002 companion service doesn't exist yet**: build event handlers as standalone modules with a router. Wire into 002 when it's ready.
- **File watcher performance**: rely on 002's watcher if available. Don't create a second filesystem watcher.
- **Debounce timing**: 2 seconds for file changes, 500ms for branch switches (matching 002's event detection strategy).

## Review Guidance

- Verify session-start runs hygiene checks and returns actionable suggestions
- Verify file-change trigger only reloads when the matched skill set actually changes
- Verify branch-switch reloads config and detects differences
- Verify debouncing prevents redundant triggers
- Verify event router handles unknown event types gracefully (log and skip)

## Activity Log

- 2026-02-17T15:00:00Z -- system -- lane=planned -- Prompt created.
- 2026-02-18T19:44:29Z – unknown – shell_pid=22467 – lane=for_review – Ready for review: 4 event handlers (session-start, file-change, branch-switch, router) with 16 passing tests
- 2026-02-18T19:44:38Z – claude-opus – shell_pid=31513 – lane=doing – Started review via workflow command
- 2026-02-18T19:45:34Z – claude-opus – shell_pid=31513 – lane=done – Review passed: Session-start hygiene with suggestions, file-change debounced reload, branch-switch config diff, router handles unknown events. 16 tests passing.
