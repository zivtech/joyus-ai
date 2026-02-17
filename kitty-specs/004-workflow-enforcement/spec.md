# Feature Specification: Workflow Enforcement

**Feature**: `004-workflow-enforcement`
**Created**: 2026-02-17
**Status**: Draft
**Input**: Domains 2 (Quality Gates), 3 (Skill Enforcement), 4 (Git Sanity) from 003-platform-architecture-overview, plus residual audit/traceability from eliminated Spec 3

> **Architecture Note**: This spec follows the MCP-first architecture established in 002 (Session & Context Management). The user never interacts with jawn-ai directly — Claude is the UI. Claude calls MCP tools; the companion service handles background enforcement. All enforcement is conversational: Claude explains what's happening and why, adapting verbosity to the user's tier.

> **Terminology**: This spec covers the **local workflow enforcement system** running on each developer's machine, extending the local MCP server (`jawn-ai-state`) from feature 002. The remote MCP server from feature 001 (AWS deployment) is a separate system.

---

## Overview

### Problem

AI coding agents are powerful but permissive. They will commit to the wrong branch, ignore coding standards, skip tests before pushing, lose track of canonical files, and write code without checking for existing upstream solutions. Less-technical users amplify these failure modes because they don't know what to ask for and can't catch mistakes in code they don't understand.

Evidence from the nclclib project workflow analysis documents these specific failure patterns:
- Wrong-branch commits requiring cherry-pick chains to recover
- Code pushed without any automated quality checks (linting, tests, accessibility)
- Relevant skills (drupal-coding-standards, drupal-security) available but never invoked
- Branch sprawl with stale branches, conflicting naming, and lost context
- No record of which skills were active during which operations, making it impossible to trace why a particular output was produced

### Solution

A structured mediation layer that enforces workflow discipline through quality gates, automatic skill loading, git guardrails, and operation traceability — all invisible to the end user. Claude mediates every enforcement action conversationally, explaining what's happening and adapting to the user's expertise level.

### Users

- **Junior developers** (Tier 1): Maximum guardrails. Gates block by default. Skills auto-load without option to skip. Branch verification is mandatory. Claude explains every enforcement action in detail.
- **Power users** (Tier 2): Configurable guardrails. Gates are "ask me" by default — Claude presents the check and the user decides. Skills auto-load but can be overridden with explicit flags. Branch verification warns but doesn't block. Claude is concise.
- **Non-technical staff** (Tier 3): Invisible guardrails. Gates run silently. Skills load automatically. Git operations are fully mediated by Claude — the user never sees branch names or git commands. Claude handles everything and reports outcomes in plain language.

---

## User Scenarios & Testing

### User Story 1 — Quality Gate Blocks Bad Push (Priority: P1)

A junior developer asks Claude to push their code. Before pushing, the system automatically runs the configured quality gates for this project: linting, unit tests, and accessibility checks. Two tests fail. Claude explains what failed, shows the relevant test output, and refuses to push until the tests pass. The developer fixes the issues and pushes successfully on the second attempt.

**Why this priority**: Unvetted code reaching the remote repository is the highest-impact failure. Quality gates at push time are the last line of defense.

**Independent Test**: Can be tested by configuring quality gates for a project, introducing a deliberate test failure, and verifying that the push is blocked with a clear explanation.

**Acceptance Scenarios**:

1. **Given** a project with quality gates configured (linting + tests), **When** the user asks Claude to push code, **Then** the system runs all "always run" gates before the push proceeds.
2. **Given** a quality gate fails, **When** the user is a junior developer (Tier 1), **Then** the push is blocked and Claude explains what failed, why it matters, and how to fix it.
3. **Given** a quality gate fails, **When** the user is a power user (Tier 2) with the gate set to "ask me", **Then** Claude presents the failure and asks whether to push anyway or fix first.
4. **Given** all quality gates pass, **When** the push proceeds, **Then** the gate results are recorded in the operation audit trail.

---

### User Story 2 — Skills Auto-Load for Drupal Editing (Priority: P1)

An experienced developer starts editing a `.module` file in a Drupal project. The system detects the file pattern, loads the `drupal-coding-standards` and `drupal-security` skills, and enriches Claude's context with those constraints. When the developer asks Claude to write a database query, Claude automatically follows Drupal's database abstraction layer instead of writing raw SQL — because the security skill is active.

**Why this priority**: Skills exist but are never manually invoked. Auto-loading based on file patterns turns passive skill libraries into active guardrails.

**Independent Test**: Can be tested by editing a file matching a configured pattern and verifying that the corresponding skills are loaded without manual invocation.

**Acceptance Scenarios**:

1. **Given** a project with file-pattern-to-skill mappings configured, **When** a user edits a file matching a pattern (e.g., `*.module`), **Then** the mapped skills are loaded into the active context.
2. **Given** multiple skills are loaded, **When** the skills have conflicting rules, **Then** the system applies the precedence order (client override > client brand > core skill > platform default) and logs the conflict resolution.
3. **Given** skills are loaded, **When** the user asks Claude to perform an action covered by a skill constraint, **Then** Claude's output conforms to the skill's requirements without the user requesting it.
4. **Given** a power user wants to bypass a loaded skill, **When** they explicitly request it, **Then** the system allows the bypass but logs the override in the audit trail.

---

### User Story 3 — Branch Verification Prevents Wrong-Branch Commit (Priority: P1)

A developer has been assigned to work on the `feature/accessibility-fixes` branch but their current session is on `main`. When they ask Claude to commit their changes, the system checks the current branch against the expected branch (from the active task context in the state snapshot). Claude warns that they're on the wrong branch and offers to switch before committing.

**Why this priority**: Wrong-branch commits were the single most frequent git mistake in the evidence. They require cherry-pick chains, safety branches, and expert git knowledge to recover — knowledge that junior developers don't have.

**Independent Test**: Can be tested by setting an expected branch in the task context, switching to a different branch, and verifying that a commit attempt triggers a warning.

**Acceptance Scenarios**:

1. **Given** the state snapshot includes an expected branch for the active task, **When** the user asks to commit on a different branch, **Then** the system warns about the mismatch before the commit proceeds.
2. **Given** a branch mismatch warning, **When** the user is a junior developer (Tier 1), **Then** the commit is blocked until the user confirms the correct branch or switches.
3. **Given** a branch mismatch warning, **When** the user is a power user (Tier 2), **Then** Claude warns but allows the commit if the user confirms.
4. **Given** no expected branch is set in the task context, **When** the user commits, **Then** no branch verification occurs (the system doesn't invent constraints).

---

### User Story 4 — "Did You Check Upstream?" Prompt (Priority: P2)

A developer asks Claude to implement a date formatting utility. Before writing new code, the system prompts: "There may be an existing solution in the project's dependencies. Should I check first?" Claude searches the project's installed packages and finds that `date-fns` is already a dependency. Instead of writing a new utility, Claude uses the existing library.

**Why this priority**: Reinventing existing solutions wastes time and introduces maintenance burden. This prompt prevents unnecessary code by encouraging reuse.

**Independent Test**: Can be tested by asking Claude to implement something that already exists in the project's dependencies and verifying that the "check upstream" prompt fires.

**Acceptance Scenarios**:

1. **Given** a user asks to implement functionality that could exist in project dependencies, **When** the "check upstream" skill is active, **Then** the system prompts to search existing dependencies before writing new code.
2. **Given** an existing solution is found upstream, **When** the user confirms they want to use it, **Then** Claude integrates the existing solution instead of writing new code.
3. **Given** no existing solution is found, **When** the search completes, **Then** Claude proceeds with implementing the new code.

---

### User Story 5 — Git Hygiene Warnings (Priority: P2)

A developer's project has 15 active branches, 8 of which haven't been touched in over 2 weeks. When they start a new session, Claude mentions: "You have 8 stale branches. Would you like me to clean up any of them?" The developer selects 5 for deletion and keeps 3. Claude deletes the stale branches and updates the session context.

**Why this priority**: Branch sprawl causes confusion and increases the risk of working on the wrong branch. Proactive cleanup keeps the workspace manageable.

**Independent Test**: Can be tested by creating multiple branches with old timestamps and verifying that the system detects and reports them.

**Acceptance Scenarios**:

1. **Given** a project with branches that haven't been modified in a configurable period (default: 14 days), **When** a new session starts, **Then** the system reports stale branches and offers cleanup.
2. **Given** a project has more active branches than a configurable limit (default: 10), **When** the user creates a new branch, **Then** the system warns about the high branch count.
3. **Given** stale branches are identified, **When** the user selects branches for deletion, **Then** Claude confirms each deletion and only deletes the confirmed ones.
4. **Given** a branch naming convention is configured for the project, **When** the user creates a branch with a non-conforming name, **Then** Claude suggests a corrected name.

---

### User Story 6 — Operation Audit Trail (Priority: P2)

A team lead reviews what happened during a junior developer's coding session. They can see that Claude committed changes to three files, that the `drupal-security` skill was active during the session, that one quality gate (linting) was bypassed with a power-user override, and that the commit was linked to Jira ticket PROJ-142. The audit trail provides full traceability from change to requirement.

**Why this priority**: Without an audit trail, there's no way to understand what happened, why, and whether the right guardrails were in place. This is essential for both quality assurance and client accountability.

**Independent Test**: Can be tested by performing a series of operations and verifying that the audit trail captures each operation with its associated skills, gate results, and requirement links.

**Acceptance Scenarios**:

1. **Given** any enforcement action occurs (gate check, skill load, branch verification), **When** the action completes, **Then** an audit entry is recorded with timestamp, action type, result, active skills, and user tier.
2. **Given** a commit is made, **When** a task/ticket ID is present in the session context, **Then** the audit entry links the commit to the task/ticket for requirement traceability.
3. **Given** a quality gate is bypassed, **When** the bypass is logged, **Then** the audit entry records who bypassed it, the reason given, and the gate that was skipped.
4. **Given** an audit trail exists for a session, **When** a team lead queries the trail, **Then** all entries are returned in chronological order with sufficient detail to reconstruct the session's enforcement decisions.

---

### Edge Cases

- What happens when a quality gate tool is unavailable (e.g., linter not installed)? The system should degrade gracefully — warn that the gate couldn't run rather than blocking the operation.
- What happens when file-pattern-to-skill mappings overlap (e.g., a file matches both `*.module` and `*.php`)? Both skills should load; conflicts resolved by precedence order.
- What happens when a user switches branches during a session and the new branch has different quality gate configurations? The system should detect the config change and reload gates for the new branch context.
- What happens when quality gates take too long (e.g., full test suite takes 10+ minutes)? The system should support timeouts with user notification and the option to push without waiting.
- What happens when the companion service isn't running? The MCP server should still function — Claude can explicitly trigger checks, but automatic event-driven enforcement is degraded.
- What happens when a user is offline? All enforcement should work locally. No network dependency for core quality gates, skill loading, or branch verification.
- What happens when two developers have different tier configurations for the same project? Each developer's tier is per-developer configuration, not per-project. The same project can have junior and power users with different enforcement levels.

---

## Requirements

### Functional Requirements

#### Quality Gates

- **FR-001**: System MUST support configurable quality gates that run before specified trigger points (pre-commit, pre-push).
- **FR-002**: System MUST support three enforcement tiers per gate: "always run" (blocks on failure), "ask me" (Claude presents choice on failure), and "skip" (gate runs but result is informational only).
- **FR-003**: System MUST map enforcement tiers to user tiers by default: Tier 1 (junior) = "always run", Tier 2 (power user) = "ask me", Tier 3 (non-technical) = "always run" (invisible). Defaults are overridable per-project and per-user.
- **FR-004**: System MUST support these gate types at minimum: linting, unit tests, accessibility audit, visual regression. Additional gate types are extensible via configuration.
- **FR-005**: System MUST handle gate tool unavailability gracefully — warn and continue rather than blocking the operation.
- **FR-006**: System MUST support gate timeouts with user notification when a gate exceeds a configurable duration.
- **FR-007**: System MUST record gate results (pass/fail/skip/timeout/unavailable) in the audit trail for every execution.

#### Skill Enforcement

- **FR-008**: System MUST auto-load skills based on file-pattern-to-skill mappings configured per project.
- **FR-009**: System MUST support a skill precedence order for conflict resolution: client-specific override > client brand/voice > core skill > platform default.
- **FR-010**: System MUST support explicit skill bypass by power users (Tier 2), with the bypass recorded in the audit trail.
- **FR-011**: System MUST prompt users to check for existing upstream solutions before implementing new code, when a "check upstream" skill is active.
- **FR-012**: System MUST report which skills are currently active when queried, including how each was loaded (auto-loaded by pattern, manually loaded, inherited from project config).
- **FR-013**: System MUST detect when skill-relevant files are modified and ensure the corresponding skills are loaded before the modification proceeds.

#### Git Sanity

- **FR-014**: System MUST verify the current branch against the expected branch (from task context) before commits and warn on mismatch.
- **FR-015**: System MUST enforce branch naming conventions when configured, suggesting corrected names for non-conforming branches.
- **FR-016**: System MUST detect and report stale branches (configurable threshold, default: 14 days without modification).
- **FR-017**: System MUST warn when the active branch count exceeds a configurable limit (default: 10 branches).
- **FR-018**: System MUST warn before force-push operations with an explanation of the risks.
- **FR-019**: System MUST detect uncommitted changes before branch switches and warn the user.

#### Audit & Traceability

- **FR-020**: System MUST record an audit entry for every enforcement action: gate execution, skill load/bypass, branch verification, and git guardrail trigger.
- **FR-021**: System MUST link audit entries to task/ticket IDs when present in the session context, enabling change-to-requirement traceability.
- **FR-022**: System MUST record which skills were active during each operation, creating a skill invocation audit trail.
- **FR-023**: System MUST record the user tier and any enforcement overrides (bypasses, force flags) in each audit entry.
- **FR-024**: System MUST support querying the audit trail by time range, action type, skill, and task/ticket ID.
- **FR-025**: System MUST store audit data locally per-developer. Team-wide audit aggregation is deferred to the platform (Phase 3).

#### Configuration

- **FR-026**: System MUST support per-project configuration for quality gates, skill mappings, branch naming conventions, and stale branch thresholds.
- **FR-027**: System MUST support per-developer configuration for user tier, enforcement overrides, and gate tier preferences.
- **FR-028**: System MUST support configuration inheritance: project config provides defaults; developer config overrides where permitted by the project's enforcement policy.
- **FR-029**: System MUST validate configuration on load and report errors clearly, falling back to safe defaults when configuration is invalid.

#### Feedback Capture

- **FR-030**: System MUST capture user corrections when Claude's output doesn't meet skill constraints — recording what was wrong, what the user corrected, and which skill should have prevented it.
- **FR-031**: System MUST store captured corrections locally, structured for future aggregation into skill update proposals. The mechanism for flowing corrections into actual skill updates is deferred.

### Key Entities

- **Quality Gate**: A configurable check (lint, test, a11y audit, visual regression) that runs at a defined trigger point (pre-commit, pre-push). Each gate has an enforcement tier (always-run, ask-me, skip) that can vary by user tier and project.
- **Skill Mapping**: A file-pattern-to-skill association. When a file matching the pattern is touched, the mapped skill is auto-loaded. Stored in project configuration.
- **Skill**: A constraint system defining acceptable outputs, restrictions, and anti-patterns. Loaded from the skills repository. Has a precedence level for conflict resolution.
- **Branch Rule**: A project-level rule governing branch naming, expected branch for a task, stale branch threshold, and active branch limits.
- **Audit Entry**: A timestamped record of an enforcement action — gate execution result, skill load/bypass, branch verification outcome, or git guardrail trigger. Includes active skills, user tier, task/ticket ID, and any overrides.
- **Correction**: A captured instance where the user corrected Claude's output because it didn't meet a skill constraint. Includes the original output, the correction, and the relevant skill.
- **Enforcement Policy**: A project-level policy defining which enforcement behaviors are mandatory (cannot be overridden by developer config) and which are configurable.

---

## Success Criteria

### Measurable Outcomes

- **SC-001**: Zero wrong-branch commits after workflow enforcement is enabled — measured over a 30-day period per developer.
- **SC-002**: Quality gates run for 100% of push operations where gates are configured as "always run" — no silent bypasses.
- **SC-003**: Skills auto-load for 100% of file edits matching configured patterns, with zero manual invocation required.
- **SC-004**: Developers using Tier 1 (junior) enforcement produce zero unvetted pushes (all pushes pass configured gates or are explicitly reviewed).
- **SC-005**: Power users (Tier 2) can bypass any non-mandatory gate or skill within 10 seconds — enforcement must not impede expert workflows.
- **SC-006**: The audit trail captures 100% of enforcement actions with sufficient detail to reconstruct the enforcement decisions of any session.
- **SC-007**: Configuration for a new project (gates, skills, branch rules) can be completed in under 15 minutes using documented templates.
- **SC-008**: System works fully offline — no network dependency for core enforcement features (gates, skills, branch checks, audit logging).
- **SC-009**: Gate unavailability (tool not installed) never blocks a developer — the system degrades gracefully with a clear warning.
- **SC-010**: Skill conflict resolution is deterministic — the same file pattern and skill set always produces the same precedence resolution, logged for debugging.

---

## Assumptions

- The MCP-first architecture from 002 is the deployment model — local MCP server + companion service on each developer's machine.
- Claude (Desktop or Code) is the primary UI. Users do not interact with the enforcement system directly.
- The state snapshot infrastructure from 002 (branch, modified files, task context) is available and provides the context for branch verification and task linking.
- Skills are stored in a git-based skill repository (as defined in 003 architecture overview) and are available on the local filesystem.
- Quality gate tools (linters, test runners, etc.) are installed on the developer's machine. The system invokes them but does not install them.
- Claude Enterprise handles general audit logging, cost tracking, and security compliance. This system handles only jawn-ai-specific enforcement audit (gate results, skill activity, branch checks).
- Per-developer storage (from 002) is used for audit data and developer-specific configuration. Team-wide aggregation is Phase 3 scope.
- The companion service from 002 provides event detection (git commits, branch switches, file changes) that triggers enforcement actions.

---

## Dependencies

- **002-session-context-management** (required): Provides the MCP server infrastructure, companion service, state snapshots (branch, files, task context), and event detection system. Workflow enforcement extends these with new MCP tools and event handlers.
- **003-platform-architecture-overview** (informational): Defines the domain inventory, skill repository structure, and monitoring architecture that this spec implements for Domains 2-4.
- **Skills repository** (required at runtime): A git-based skill repository must exist with at least one skill for enforcement to be meaningful. Initial skills can be the existing `zivtech-claude-skills/` collection.
- **Quality gate tools** (required at runtime): Linters, test runners, and other gate tools must be installed on the developer's machine. The system invokes but does not manage tool installation.
- **Claude Enterprise** (recommended): Handles general audit logging, cost tracking, and compliance. Not required for core enforcement, but recommended for team-wide visibility.

---

## Out of Scope

- **Skill authoring or creation** — this spec covers skill loading and enforcement, not how skills are written or updated. Skill authoring is a separate concern (see 003 Domain: Client Profile Building).
- **Team-wide audit aggregation** — audit data is per-developer locally. Aggregation into dashboards or team views is Phase 3 platform scope.
- **Automatic skill updates from corrections** — FR-030/031 capture corrections, but the mechanism for flowing them into actual skill file changes is deferred. The constitution (2.5) mandates feedback loops, but the automation is future work.
- **Remote enforcement** — this spec covers local enforcement on the developer's machine. Server-side enforcement (e.g., git hooks on the remote repo) is separate.
- **Multi-agent coordination** — enforcing workflow across multiple concurrent AI agents in the same project is deferred.
- **Gate tool installation or management** — the system assumes tools are installed and invokes them. Package management is the developer's responsibility.
- **Custom gate authoring** — the system supports a fixed set of gate types (lint, test, a11y, visual regression) plus a generic "custom command" gate. A gate plugin system is deferred.
- **Historical audit queries via UI** — audit data is queryable via MCP tools. A visual interface for browsing audit history is Phase 3.

---

## Relationship to Other Specs

This is **Spec 2 of 2** for the jawn-ai mediator layer:

1. **Session & Context Management** (002) — knowing where you are and what's current
2. **Workflow Enforcement** (this spec) — preventing mistakes, routing skills, enforcing quality gates

Session & Context Management is foundational — this spec depends on the state and context infrastructure built there.

**Spec 3 (Observability & Data) has been eliminated** — Claude Enterprise covers ~80% of it. The residual (change-to-requirement traceability, skill invocation audit trail) is incorporated here as the Audit & Traceability domain.

---

## Clarifications

### Session 2026-02-17 (Initial)

- Q: Should these four domains (Quality Gates, Skill Enforcement, Git Sanity, Audit) be separate specs? -> A: Combined into one spec. The domains are deeply coupled at runtime (skills inform gates, gates check git state, git state determines skills). Splitting creates circular cross-spec dependencies.
- Q: How should quality gate results surface to the user in the MCP-first model? -> A: Claude mediates conversationally. Claude calls the gate, gets a result, and based on the tier config either blocks and explains, presents a choice, or logs and proceeds. The user's experience is conversational, not CLI prompts.
- Q: What's the scope boundary with 002? -> A: 002 handles state awareness (snapshots, restore, canonical docs). This spec handles active enforcement (gates, skills, branch checks, audit). 002 provides the infrastructure; this spec provides the rules.

---

*Specification captured: February 17, 2026*
*Discovery conducted with: Alex UA*
*Evidence source: 003-platform-architecture-overview (Domains 2-4), jawn-ai-requirements-brief.md, 002 deferred items*
*For: jawn-ai — Mediator Layer, Spec 2 of 2*
