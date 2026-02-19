# Feature Specification: Session & Context Management

**Feature Branch**: `002-session-context-management`
**Created**: 2026-02-16
**Revised**: 2026-02-16 (architecture reframing, Enterprise overlap analysis)
**Status**: Draft
**Input**: Domains 1, 2, 10 from joyus-ai-requirements-brief.md (Canonical Document Management, Session State Continuity, Context Handoff Protocol)

> **Architecture Note (2026-02-16 revision):** This spec was originally written assuming a CLI + hooks architecture for technical users. After landscape analysis and Claude Enterprise overlap review, the architecture has been reframed:
>
> - **Primary interface**: MCP server that Claude calls on behalf of the user. The user never interacts with joyus-ai directly.
> - **Deployment model**: User adds MCP server to Claude Desktop + runs a companion service. That's the maximum setup effort.
> - **Target user**: Non-technical staff who cannot configure hooks, write scripts, or manage git workflows. Claude is the UI.
> - **Companion service**: Handles background state capture, event monitoring, and anything the MCP request/response protocol can't do (long-running processes, filesystem watchers, etc.)
> - **Claude Enterprise**: Covers audit logging, cost tracking, security/compliance, and basic session resume. This spec does NOT duplicate those capabilities.
> - **Full analysis**: See `research/existing-projects-landscape.md` sections 9-10.

---

## User Scenarios & Testing

### User Story 1 - Session Survives Compaction (Priority: P1)

A junior developer is mid-task — they've switched to a feature branch, modified three files, and run tests that showed two failures. Their Claude Code session hits a context limit and compacts. They start a new session and say "continue." The system automatically restores their active work state: current branch, modified files, pending task, and last test results. The developer picks up exactly where they left off without manually re-explaining context.

**Why this priority**: This is the single most painful daily problem identified in evidence. The prior project showed 8000+ word continuation summaries that still missed key details, wrong-branch commits from lost context, and cherry-pick chains to recover from mistakes caused by state loss.

**Independent Test**: Can be fully tested by starting a session, performing git operations and file edits, triggering a session restart, and verifying that the new session has access to the prior state. Delivers immediate value for any Claude Code user.

**Acceptance Scenarios**:

1. **Given** a session with active work (branch, modified files, test results), **When** the session ends (clean exit, compaction, or crash), **Then** a structured state snapshot is persisted to disk within 5 seconds of the triggering event.
2. **Given** a persisted state snapshot exists, **When** a new session starts in the same project, **Then** the system presents a human-readable summary of the prior state (branch, modified files, pending tasks, last test results, recent decisions) without the user requesting it.
3. **Given** a new session restores prior state, **When** the user says "continue", **Then** the system has sufficient context to resume work without asking the user to re-explain what they were doing.
4. **Given** a session crashes unexpectedly (dirty exit), **When** the next session starts, **Then** the most recent state snapshot is available (written at last significant event, not just at clean exit).

---

### User Story 2 - Canonical Document Declaration (Priority: P2)

A team has a tracking document (e.g., accessibility-audit-tracking.csv) that exists in two locations — one git-tracked, one in a working directory. A developer declares which copy is canonical. From that point on, when anyone references "the tracking spreadsheet," the system knows which file to read and warns if a stale copy is accessed.

**Why this priority**: Document divergence causes silent data loss. In the prior project, accessibility-fixes-todo.md existed in two locations with different content and dates. The tracking CSV conflicted on every merge because multiple branches modified it independently. Declaring canonical sources prevents this class of error entirely.

**Independent Test**: Can be tested by declaring a canonical path for a document, then attempting to read or modify a non-canonical copy. The system should warn or redirect. Delivers value for any project with shared reference documents.

**Acceptance Scenarios**:

1. **Given** a project with no canonical declarations, **When** a user declares a file as the canonical source for a named document, **Then** the declaration is stored in project configuration and persists across sessions.
2. **Given** a canonical source is declared for "tracking spreadsheet", **When** a session attempts to read or modify a different copy of that document, **Then** the system warns that a canonical source exists and offers to redirect.
3. **Given** a canonical source is declared, **When** the canonical file is modified, **Then** the system records the modification timestamp and can report when it was last updated.
4. **Given** multiple files match a document name, **When** the user asks to "update the tracking spreadsheet", **Then** the system routes to the canonical copy without ambiguity.

---

### User Story 3 - Context Handoff Document (Priority: P1)

When a session ends or compacts, the system automatically generates a structured, machine-readable handoff document. This is not a prose summary — it's a structured snapshot that a new session can parse programmatically to restore full working context. It includes branch, modified files, git status, task progress, last test results, pending decisions, and active tool connections.

**Why this priority**: Equal priority with Story 1 — they're two halves of the same capability. Story 1 is the state persistence engine; Story 3 is the format and protocol that makes the persisted state usable. Without a structured format, restored state is just another blob of text that Claude has to interpret (the current failure mode).

**Independent Test**: Can be tested by ending a session and inspecting the generated handoff document for completeness and machine-readability. A script or new session should be able to parse every field without ambiguity.

**Acceptance Scenarios**:

1. **Given** a session with active work, **When** the session ends (any trigger: clean exit, compaction, crash recovery), **Then** a handoff document is generated in a defined, parseable format (not freeform prose).
2. **Given** a handoff document exists, **When** a new session starts, **Then** the system can programmatically extract: current branch, list of modified files, git status summary, active task/ticket ID, last test results (pass/fail counts), and pending decisions.
3. **Given** the handoff document includes "pending decisions", **When** a new session restores context, **Then** each pending decision is presented with its original context so the user can confirm or revise without re-deriving the reasoning.
4. **Given** multiple handoff documents exist from previous sessions, **When** a new session starts, **Then** only the most recent handoff is loaded by default, with the ability to query older handoffs if needed.

---

### User Story 4 - State Snapshot on Significant Events (Priority: P2)

The system automatically captures state snapshots when meaningful events occur — not continuously, but at moments that matter: git commits, branch switches, test runs, file saves to canonical documents, and session milestones. This ensures that even if a session crashes between events, the most recent snapshot reflects a coherent state.

**Why this priority**: The persistence mechanism must be event-driven to be both reliable and efficient. Continuous writes are wasteful; exit-only writes are lossy. Event-driven snapshots hit the right balance — the prior project evidence showed that wrong-branch commits happened because state wasn't captured at the moment of branch switching.

**Independent Test**: Can be tested by performing a sequence of git operations and verifying that a state snapshot is updated after each one. Then simulate a crash and confirm the snapshot reflects the last event.

**Acceptance Scenarios**:

1. **Given** a session is active, **When** the user commits code, **Then** the state snapshot is updated to reflect the new commit hash, branch, and changed files.
2. **Given** a session is active, **When** the user switches branches, **Then** the state snapshot is updated immediately with the new branch name and any uncommitted changes.
3. **Given** a session is active, **When** tests are run, **Then** the state snapshot is updated with pass/fail counts and failing test names.
4. **Given** a session is active, **When** a canonical document is modified, **Then** the state snapshot records the modification and the document's canonical path.
5. **Given** no significant events have occurred for an extended period, **When** the user is actively working (file reads, edits), **Then** periodic lightweight snapshots capture the working set without flooding the snapshot store.

---

### User Story 5 - Power User Configuration (Priority: P3)

A power user (Alex-tier) wants to customize what gets captured, when snapshots fire, and how verbose the restored context is. They can configure event triggers, opt out of automatic restore prompts, and access raw state files directly. The system respects their expertise without removing guardrails for other users.

**Why this priority**: Power users need the system to stay out of their way while still providing value. If the system is too chatty or rigid, they'll disable it. Configurability ensures adoption across user tiers.

**Independent Test**: Can be tested by modifying configuration values and verifying that the system behavior changes accordingly (e.g., disabling auto-restore prompt, adding custom event triggers).

**Acceptance Scenarios**:

1. **Given** a power user's project configuration, **When** they set `auto_restore: false`, **Then** new sessions do not automatically present the prior state summary (but state is still persisted and queryable on demand).
2. **Given** a power user's configuration, **When** they define a custom event trigger (e.g., "snapshot on Docker build"), **Then** the system captures state when that event occurs.
3. **Given** a power user wants to inspect raw state, **When** they access the state snapshot file directly, **Then** the file is human-readable and in a documented format.

---

### User Story 6 - Share State for Troubleshooting (Priority: P2)

A junior developer hits a problem they can't resolve — tests are failing, they're not sure why, and they don't know how to explain the full context. They share their state with a senior developer (e.g., Alex). The shared state includes a short note from the sharer ("trying to fix the accessibility filter but tests keep failing on line 42"). The senior developer starts a new session, loads the shared state, and immediately has the junior dev's branch, modified files, test results, pending decisions, and the sharer's note — enough to diagnose the problem without a lengthy back-and-forth.

**Why this priority**: This is the team-multiplier use case. Without it, troubleshooting requires the junior dev to accurately explain their state (which they often can't). With it, the senior dev gets structured context plus the dev's own framing of the problem.

**Independent Test**: Can be tested by having one developer share state with a note, and another developer loading that shared state in a new session. Verify all fields are present including the note.

**Acceptance Scenarios**:

1. **Given** a developer wants to share their state, **When** they invoke the "share context" action, **Then** they are prompted to add a short note describing what they were trying to do (optional but encouraged).
2. **Given** a shared state with a note exists, **When** a recipient loads it, **Then** they see the full handoff document plus the sharer's note prominently displayed.
3. **Given** a senior developer loads a shared state, **When** they begin working, **Then** the system restores the sharer's branch, shows their modified files and test results, and presents the note — enabling the senior dev to troubleshoot without additional context from the sharer.

---

### User Story 7 - Session Switching (Priority: P3)

A power user has multiple Claude Code sessions running across different projects. From within their current session, they ask to see what other sessions are active and jump to one — picking up that session's full context without opening a new terminal. This mirrors OpenCode's session handler, where you can navigate between running sessions from a single interface.

**Why this priority**: Convenience feature for power users managing multiple concurrent workstreams. Not blocking for MVP but improves the multi-project workflow significantly.

**Independent Test**: Can be tested by running two sessions in different projects, then from one session requesting a list of active sessions and switching to the other. Verify that the switched-to session's full state is loaded.

**Acceptance Scenarios**:

1. **Given** multiple sessions are active across different projects, **When** a user requests a list of active sessions, **Then** the system returns session identifiers with project name, branch, and last activity timestamp.
2. **Given** a list of active sessions, **When** the user selects one to switch to, **Then** the current session's state is snapshotted and the target session's full context is loaded.
3. **Given** a user switches sessions, **When** they switch back to the original session later, **Then** the original session's state is intact from the snapshot taken at switch time.

---

### Edge Cases

- What happens when the state snapshot is corrupted or unparseable? The system must fall back gracefully — present what it can, warn about missing fields, and never block session start.
- What happens when the user manually changes branches outside of the mediated session (e.g., in a separate terminal)? The system should detect the divergence at next snapshot or session start and reconcile.
- What happens when two sessions run concurrently in the same project? State snapshots must not clobber each other — either lock, merge, or partition by session.
- What happens when a project has no prior state? First session initializes cleanly with no restore prompt.
- What happens when the canonical source file is deleted or moved? The system should warn on next access and prompt the user to update the declaration.
- What happens when a handoff document references files that have since been deleted or branches that have been merged? The system should note stale references rather than failing.

---

## Requirements

### Functional Requirements

- **FR-001**: System MUST persist active work state to disk on significant events (git commit, branch switch, test run, canonical document modification, session end).
- **FR-002**: System MUST restore persisted state at session start and present a human-readable summary to the user.
- **FR-003**: System MUST generate a structured, machine-readable handoff document on session end or compaction. Since every event-driven snapshot includes full handoff fields (pending decisions, reasoning), the handoff on dirty exit is the most recent snapshot — no separate richer document is needed.
- **FR-004**: System MUST support declaring canonical source paths for named documents within a project. Declarations are project-wide by default, with optional per-branch overrides when explicitly set.
- **FR-005**: System MUST warn users when they access or modify a non-canonical copy of a declared document.
- **FR-006**: System MUST survive dirty exits (crash, force-quit) by persisting state at events, not only at clean exit.
- **FR-007**: System MUST distinguish between stable memory (facts, preferences) and ephemeral state (branch, modified files, in-progress work). This distinction is enforced by design: stable memory lives in CLAUDE.md and memory.md (user-managed, committed to git); ephemeral state lives in the snapshot store (~/.joyus-ai/, gitignored, per-developer). The system never writes to stable memory files and never reads ephemeral state from them.
- **FR-008**: System MUST support querying prior state on demand (not just at session start) for users who want to check context mid-session.
- **FR-009**: System MUST handle concurrent sessions in the same project without data loss or corruption. State is per-developer by default; concurrent sessions from the same developer are partitioned or locked, while different developers' states are isolated.
- **FR-015**: System MUST store state files in a per-developer location (gitignored or user-specific) by default, with an explicit "share context" action that allows a developer to make their current state visible to teammates. The share action MUST prompt the sharer to add an optional note describing what they were trying to do.
- **FR-010**: System MUST provide configuration options for power users to customize snapshot triggers, restore behavior, and verbosity.
- **FR-011**: System MUST fall back gracefully when state files are corrupted, missing, or stale — never block session start.
- **FR-012**: System MUST detect divergence between persisted state and actual project state (e.g., branch changed externally) and alert the user.
- **FR-013**: Handoff documents MUST include: current branch, modified files, git status, active task/ticket ID, last test results, pending decisions, and canonical document status.
- **FR-014**: System MUST load the most recent snapshot by default at session start. Retention policy (pruning old snapshots) is deferred — snapshots are 2-10KB each, so thousands accumulate before storage is a concern. When implemented, default retention will be 7 days with a 50MB disk safety cap (oldest pruned first). Retention period will be configurable.

### Key Entities

- **State Snapshot**: A point-in-time capture of the full working context — branch, modified files, git status, test results, active task, recent decisions, pending decisions, and reasoning. Triggered by significant events. Machine-readable. Every snapshot includes all handoff fields, so any snapshot can serve as a complete handoff document on dirty exit.
- **Handoff Document**: Conceptually identical to a state snapshot. The term "handoff" refers to whichever snapshot the next session loads to restore context. On clean exit, a final snapshot is captured; on dirty exit, the most recent event-driven snapshot serves as the handoff. There is no separate, richer document format — snapshots always carry the full context.
- **Canonical Declaration**: A project-level mapping from a document name (e.g., "tracking spreadsheet") to its authoritative file path. Stored in project configuration. Project-wide by default; individual branches can override the canonical path if explicitly set.
- **Session State Store**: The persistent storage location for state snapshots and handoff documents. Per-developer by default (stored in a user-specific or gitignored location), with an explicit "share context" action to make specific state visible to teammates. Project-scoped, survives across sessions.
- **Event Trigger**: A defined action (commit, branch switch, test run, etc.) that causes the system to capture a new state snapshot.

---

## Success Criteria

### Measurable Outcomes

- **SC-001**: After a session compaction or restart, users can resume work within 30 seconds without manually re-explaining context — measured by the absence of "what branch am I on" or "what was I working on" questions in the first 5 turns.
- **SC-002**: Zero wrong-branch commits attributable to lost session context — the system warns before any commit if the current branch doesn't match the expected branch from state.
- **SC-003**: Canonical document conflicts drop to zero for declared documents — no merge conflicts on files with declared canonical sources.
- **SC-004**: Handoff documents are machine-parseable — a validation script can extract all 7 required fields (branch, modified files, git status, task ID, test results, pending decisions, canonical doc status) from any generated handoff document with 100% accuracy.
- **SC-005**: State survives dirty exits — after a simulated crash (kill -9), the next session recovers state that is no more than one significant event behind.
- **SC-006**: Power users can configure the system in under 5 minutes and see their changes take effect immediately.

---

## Assumptions

- The primary user interface is Claude (Desktop or Code). Users interact with Claude; Claude interacts with joyus-ai's MCP server. Users do not run joyus-ai commands directly.
- Maximum user setup effort: add the joyus-ai MCP server to Claude Desktop/Code + run a companion service. No hook configuration, no YAML editing, no CLI usage required from end users.
- A companion service (daemon/background process) runs alongside the MCP server to handle event-driven state capture, filesystem monitoring, and background tasks that the MCP request/response protocol cannot support.
- Claude Code hooks (SessionStart, PreToolUse, PostToolUse, session end) are available for technical users (Tier 2) and for the companion service, but are NOT required for end users.
- MCP server infrastructure exists or will exist (from 001-mcp-server-aws-deployment) to provide interactive context query tools.
- Projects use git as their version control system.
- Users have a project root directory that the system can use for storing configuration and state files.
- The existing CLAUDE.md and memory.md conventions are preserved — this system complements them, not replaces them.
- Claude Enterprise handles audit logging, cost/token tracking, and security/compliance. This system does NOT duplicate those capabilities.
- Context7 MCP server handles library documentation. This system handles project state and workflow.

---

## Dependencies

- **001-mcp-server-aws-deployment** (partial): The remote MCP server (deployed to AWS in feature 001) provides tool executors for Jira, Slack, GitHub, and Google. This feature (002) creates a separate local MCP server (`joyus-ai-state`) that runs on the developer's machine for session state management. The two servers are independently deployable and serve different purposes: 001 = remote tool access, 002 = local state awareness. Future integration (e.g., syncing shared state to the remote server) is deferred.
- **Claude Desktop/Code MCP support**: Required for the primary user interface. Users connect to the joyus-ai MCP server through Claude's MCP configuration.
- **Companion service**: A locally-running service that handles background state capture, event monitoring, and filesystem watching. This is a new component that ships with joyus-ai.
- **Claude Code hooks system** (optional): Hooks provide tighter integration for Tier 2 (power users) but are not required for the core MCP-based workflow.
- **Existing memory.md convention**: State management must coexist with, not conflict with, the existing memory system.
- **Claude Enterprise** (recommended): Audit logging, spend controls, and compliance features are handled by Enterprise. joyus-ai works without Enterprise but benefits from it.

---

## Out of Scope

- Audit logging, cost/token tracking, security/compliance — **covered by Claude Enterprise** (see `research/existing-projects-landscape.md` section 9)
- Multi-agent state coordination (deferred to Spec 2: Workflow Enforcement)
- Tracking data architecture changes (CSV replacement — evaluate need after Spec 2)
- Skill enforcement or quality gates (covered in Spec 2: Workflow Enforcement)
- Multi-backend routing (Claude + Codex + Gemini) — deferred until second platform is needed; use LiteLLM when ready
- Adapter pattern for non-Claude-Code platforms — YAGNI; build Claude Code path first
- Historical snapshot query UI — defer until core save/restore is validated
- Retention policies beyond basic cleanup — snapshots are 2-10KB; premature optimization

---

## Relationship to Other Specs

This is **Spec 1 of 2** for the joyus-ai mediator layer (revised from 3 after Enterprise overlap analysis):

1. **Session & Context Management** (this spec) — knowing where you are and what's current
2. **Workflow Enforcement** (next) — preventing mistakes, routing skills, enforcing quality gates

**Spec 3 (Observability & Data) has been largely eliminated** by Claude Enterprise's audit logging, OpenTelemetry, Compliance API, and Analytics API. The only Spec 3 residual is change-to-requirement traceability and skill invocation audit trail, which can be folded into Spec 2.

Session & Context Management is foundational — Spec 2 depends on the state and context infrastructure built here.

---

## Clarifications

### Session 2026-02-16 (Initial)

- Q: Should state files be per-developer or shared across the team? → A: Per-developer by default, with an explicit "share context" action to optionally make state visible to teammates. Shared state includes a sharer note describing what they were trying to do.
- Q: Should canonical document declarations be project-wide, per-branch, or both? → A: Project-wide by default, with optional per-branch overrides when explicitly set.
- Q: On dirty exit, should the last snapshot serve as the handoff, or should handoffs be richer than snapshots? → A: Snapshots and handoffs merge — every snapshot always includes full handoff fields (pending decisions, reasoning), so any snapshot can serve as a complete handoff. No separate document format.
- Q: What retention policy for historical snapshots? → A: Time-based — keep all snapshots from the last 7 days (configurable), with a 50MB disk safety cap pruning oldest-first. Snapshots are 2-10KB each so the cap rarely triggers.

### Session 2026-02-16 (Architecture Reframing)

After landscape analysis of ~50+ existing projects and Claude Enterprise feature overlap review:

- Q: What is the deployment model? → A: MCP server + companion service. User adds the MCP server to Claude Desktop/Code and runs a companion app alongside it. That's the maximum setup effort. No hook configuration, no CLI usage, no YAML editing required from end users.
- Q: Who is the primary user? → A: Non-technical staff (Tier 1/3) who cannot configure developer tools. Claude is the UI. The user talks to Claude; Claude calls joyus-ai's MCP tools. Power users (Tier 2) get optional CLI and hook access for admin/debugging.
- Q: What does Claude Enterprise already cover? → A: Audit logging (180-day, Compliance API), cost/token tracking (OpenTelemetry, spend caps), security (SOC 2, SSO, SCIM, ZDR), basic session resume (Agent SDK, Tasks), and team collaboration (Projects, Cowork). joyus-ai does NOT duplicate these. See `research/existing-projects-landscape.md` section 9.
- Q: What does Enterprise NOT cover that joyus-ai provides? → A: Working state snapshots (branch, files, tests, decisions), canonical document management, structured handoff documents, quality gates, skill auto-routing, branch verification, and structured context sharing with notes.
- Q: Should we still build Spec 3 (Observability)? → A: No. Enterprise covers ~80% of it. Residual needs (change-to-requirement traceability, skill invocation audit) fold into Spec 2. Roadmap is now Spec 1 + Spec 2, not Spec 1 + 2 + 3.
- Q: Are there existing projects we should use as dependencies? → A: No direct dependencies, but study patterns from Continuous-Claude-v3 (YAML handoffs), oh-my-claudecode (compaction-resilient state), task-orchestrator (MCP API design). Existing OSS tools (Lefthook, git-branchless, etc.) may be used internally by the companion service but are invisible to users.
- Q: What should we defer? → A: Adapter pattern (multi-platform), historical snapshot queries, retention policies, CLI (build after MCP server). MCP server is the priority.
- Q: What about Context7? → A: Context7 MCP server handles library documentation for AI agents. Already configured. Complementary to joyus-ai (library knowledge vs project state/workflow). Will use for our own tech stack documentation needs.

---

*Specification captured: February 16, 2026*
*Revised: February 16, 2026 (architecture reframing, Enterprise overlap)*
*Discovery conducted with: Alex UA*
*Evidence source: joyus-ai-requirements-brief.md (prior project workflow analysis), existing-projects-landscape.md*
*For: joyus-ai — Mediator Layer, Spec 1 of 2*
