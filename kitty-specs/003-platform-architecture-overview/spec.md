# Feature Specification: joyus-ai Platform Architecture Overview

**Feature Branch**: `003-platform-architecture-overview`
**Created**: 2026-02-17
**Status**: Draft
**Input**: Umbrella specification — high-level architecture and domain inventory for the Joyus AI Platform

---

## Platform Identity

**joyus-ai** is a multi-tenant AI agent platform that mediates between users and AI coding agents (Claude Code, Codex, Gemini, etc.). It enforces workflow discipline, quality gates, skill-based guardrails, and contextual awareness that individual AI sessions lack on their own.

### Core Thesis

AI coding agents are powerful but stateless and permissive. They will commit to the wrong branch, ignore coding standards, lose track of canonical files, push without tests, and burn through context with unfocused work. Less-technical users amplify these failure modes because they don't know what to ask for and can't catch mistakes in code they don't understand.

joyus-ai prevents these failures through **structured mediation** — not by limiting what users can do, but by ensuring the right checks, context, and skills are always in play.

### What joyus-ai Is

- A mediator layer between users and AI agents
- A multi-tenant platform for internal use and client deployments
- A skills-as-guardrails system where outputs are guided by constraints
- A Claude Code alternative for clients who can't grant deep system access

### What joyus-ai Is NOT

- A replacement for Claude Code or spec-kitty (it sits between the user and the agent)
- A consumer product (it's for internal + managed client use)
- A replacement for human judgment (outputs are always reviewable)
- A way to bypass client approval (clients retain authority)
- A data collection play (client data is never used for training)

---

## User Scenarios & Testing *(mandatory)*

### User Story 1 — Junior Dev Gets Workflow Guardrails (Priority: P1)

A junior developer uses Claude Code to work on a Drupal client project. joyus-ai intercepts their session, loads the correct skills (drupal-coding-standards, drupal-security), enforces branch verification, and gates pushes behind quality checks — all without the developer needing to remember any of this.

**Why this priority**: Junior devs are the highest-risk, highest-volume users. Preventing their mistakes has the largest ROI.

**Independent Test**: Can be tested by having a junior dev attempt a typical Drupal coding task and verifying that skills are auto-loaded, branch is verified, and quality gates fire before push.

**Acceptance Scenarios**:

1. **Given** a junior dev starts a Claude Code session on a Drupal project, **When** they begin editing a `.module` or `.theme` file, **Then** joyus-ai auto-loads the relevant Drupal skills without manual invocation.
2. **Given** a junior dev asks Claude to push code, **When** the push is initiated, **Then** joyus-ai prompts for configured quality checks (linting, tests, visual regression) before allowing the push.
3. **Given** a junior dev is on branch X but their task is assigned to branch Y, **When** they attempt to commit, **Then** joyus-ai warns about the branch mismatch and offers to switch.

---

### User Story 2 — Power User Gets Consistency Without Hand-Holding (Priority: P1)

An experienced developer (Alex-tier) uses joyus-ai with configurable flags. They get session state continuity across compactions, skill enforcement for consistency, and cost tracking — but can bypass gates with explicit flags when needed.

**Why this priority**: Power users are the testbed — if it works for them, it works for everyone. They also define the platform's configuration model.

**Independent Test**: Can be tested by running a multi-session workflow where context survives compaction and skills are enforced without manual invocation.

**Acceptance Scenarios**:

1. **Given** a power user's session compacts mid-task, **When** a new session starts, **Then** joyus-ai restores active state (branch, modified files, pending tasks, last test results) automatically.
2. **Given** a power user has configured quality gates as "ask me", **When** they push code, **Then** joyus-ai presents available checks as options rather than blocking.
3. **Given** a power user runs a week of sessions, **When** they check usage, **Then** joyus-ai shows token consumption, cost attribution, and task-type breakdown.

---

### User Story 3 — Platform Operator Manages a Client Deployment (Priority: P2)

The platform operator onboards a new client onto the platform. They create a workspace with the client's brand skills, writing profiles, and spend limits. The client's staff interact with AI through the platform with appropriate guardrails, and the operator monitors usage and content fidelity.

**Why this priority**: Multi-tenant client deployment is the business model. It must work, but internal use (P1) validates the architecture first.

**Independent Test**: Can be tested by creating a client workspace, loading client-specific skills, running sample tasks, and verifying isolation, billing attribution, and content fidelity checks.

**Acceptance Scenarios**:

1. **Given** the operator creates a new client workspace, **When** the client's users interact with the platform, **Then** only that client's skills and brand assets are loaded.
2. **Given** a client has a monthly spend limit of $500, **When** usage approaches the limit, **Then** the platform alerts the operator and throttles or blocks further requests.
3. **Given** a client task generates content, **When** the output is produced, **Then** content fidelity checks verify brand compliance and voice consistency before delivery.

---

### User Story 4 — Non-Technical Staff Uses Chat Interface (Priority: P3)

A PM or content editor accesses joyus-ai through a web-based chat interface. They can request AI assistance for tasks within their permission level, with maximum automation and human-readable explanations. They cannot access CLI or code-level features.

**Why this priority**: Broadest user base but requires the web app (Phase 3 platform framework) to exist first.

**Independent Test**: Can be tested by having a non-technical user complete a common task (e.g., "summarize this Jira ticket", "draft a client email") through the web interface.

**Acceptance Scenarios**:

1. **Given** a PM logs into the web interface, **When** they ask to summarize recent Jira activity, **Then** joyus-ai queries Jira via MCP and returns a human-readable summary.
2. **Given** a content editor requests a document draft, **When** the draft is generated, **Then** it uses the client's brand voice skill and is flagged for review before delivery.

---

### Edge Cases

- What happens when a user's session compacts mid-task with uncommitted changes?
- How does the system handle conflicting skills (e.g., two skills with contradictory formatting rules)?
- What happens when a client's API spend limit is hit mid-task?
- How does the platform handle an AI agent that is unresponsive or returns errors repeatedly?
- What happens when a user switches between projects with different skill sets in the same session?

---

## Domain Inventory

Each domain is summarized here. Each will receive its own deep specification via separate `/spec-kitty.specify` runs.

### Domain 1: Session State & Context Handoff

**Problem**: Claude loses context across compactions and session restarts. Memory.md captures stable facts but not active work state (current branch, in-progress task, modified files, pending decisions).

**Scope**: Active state snapshots, automatic persistence on session end/compaction, state restore protocol at session start, structured handoff documents (machine-readable, not prose summaries).

**Existing work**: `kitty-specs/002-session-context-management/spec.md` — already has a detailed spec.

---

### Domain 2: Quality Gates

**Problem**: Code gets pushed with no automated checks. Visual regression tests, accessibility audits, linting, and coding standards checks exist as tools but are never run before push/commit.

**Scope**: Pre-commit and pre-push hook system, configurable check tiers ("always run" / "optional" / "ask me"), CLI flags for power users, interactive mode for junior devs, per-project configuration, results gating (fail/warn/pass).

---

### Domain 3: Skill Enforcement

**Problem**: Relevant skills exist but are never auto-invoked. The AI writes code without checking coding standards or searching for existing upstream solutions.

**Scope**: File-pattern-to-skill routing table (glob to required skills), auto-invocation before edits, "did you check upstream?" prompts, skill audit trail.

---

### Domain 4: Git Sanity

**Problem**: Branch sprawl, wrong-branch commits, cherry-pick chains, safety branches, failed patches, and merge conflicts on tracking files.

**Scope**: Pre-commit branch verification, branch naming enforcement, active branch limit warnings, stale branch cleanup, cherry-pick guardrails, "current working context" display.

---

### Domain 5: Canonical Document Management

**Problem**: Reference documents get copied into multiple locations. Git-tracked copies diverge from working copies. Claude updates one and forgets the other.

**Scope**: Single source of truth with declared location, sync mechanism between vault and working copies, conflict-resistant storage.

---

### Domain 6: Error Recovery

**Problem**: When the AI makes a mistake, the recovery path requires git expertise that junior devs don't have. Revert/reapply cycles, safety branches, orphaned .rej files.

**Scope**: Checkpoint/snapshot system before risky operations, "undo last action" that understands git state, graduated rollback, orphaned artifact cleanup.

---

### Domain 7: Token & Cost Guardrails

**Problem**: Unfocused prompts and redundant operations burn through context windows. Junior devs don't know they're being inefficient.

**Scope**: Prompt coaching for overly broad requests, context budget awareness and warnings, efficient tool routing, task scoping assistance.

---

### Domain 8: Audit Trail

**Problem**: No unified record of what was changed, why, by whom (human vs AI), and what the reasoning was across multiple sessions.

**Scope**: Change-to-requirement traceability, session action log, agent attribution (model, session, active skills), queryable history.

---

### Domain 9: Tracking Data Architecture

**Problem**: CSV files in git for collaborative tracking data guarantee merge conflicts. Every branch modifies the same rows.

**Scope**: Alternative to CSV-in-git (database, API, structured YAML with per-item files, or append-only log), migration path from existing workflows, merge-friendly formats.

---

### Domain 10: Multi-Tier User Interface

**Problem**: Non-technical staff (PMs, content editors) can't use CLI directly but need AI assistance. Power users want to interact with the platform from anywhere — including voice commands while driving or mobile access away from their desk.

**Scope**: Web-based chat interface, voice interaction mode (mobile/car), role-based access control, maximum automation with human-readable explanations, permission-gated capabilities. Session handoff (Domain 1) enables seamless transitions between desktop, mobile, and voice access modes.

---

### Domain 11: API Account & Billing Model

**Problem**: The platform needs to support multiple billing configurations — the operator managing API costs on behalf of clients, and potentially clients bringing their own Anthropic API keys.

**Scope**: Anthropic API workspace management (one organization, workspace per client), BYOK (Bring Your Own Key) support, per-workspace spend limits, Admin API integration for programmatic workspace/key management, Usage & Cost API integration for billing attribution.

**Key context**: Anthropic's API uses Organizations > Workspaces > API keys. This is entirely separate from Claude Team/Pro subscriptions. Workspaces have per-workspace API keys and spend limits. The Admin API (`sk-ant-admin...`) enables programmatic management. The Usage & Cost API provides token consumption breakdowns by model, workspace, and service tier.

---

### Domain 12: Automated Bug Triage & Remediation

**Problem**: When a client reports a bug, the ticket often has incomplete information. A developer must manually read the ticket, try to reproduce, diagnose, and fix — or escalate. This is time-consuming, especially for straightforward issues that an AI agent could handle autonomously.

**Scope**: An event-driven pipeline triggered by bug ticket creation (via Activepieces or similar automation). The pipeline has five stages: (1) **Enrich** — parse the ticket, identify missing information (environment, steps to reproduce, affected URLs), and update the ticket; (2) **Confirm** — access staging/dev environments (via Playwright MCP) to attempt reproduction, capture screenshots or logs as evidence; (3) **Diagnose** — load project-specific skills (e.g., drupal-coding-standards, drupal-security), search the codebase via GitHub, identify likely root cause, and update the ticket with analysis; (4) **Fix** — attempt a code fix, run quality gates (from 004-workflow-enforcement) to validate; (5) **Deliver** — if successful, create a PR linked to the Jira ticket and notify the PM/assignee; if unsuccessful, leave detailed diagnosis notes and transition the ticket for human developer pickup.

**Key dependencies**: 001 (MCP server — GitHub, Jira access), 004 (quality gates and skill enforcement for the fix stage), Playwright MCP (browser access for reproduction), Activepieces or similar (event trigger/orchestration).

**Existing work**: Concept described as "Probo on steroids" — extending existing proactive monitoring approaches with AI-powered diagnosis and remediation. Validated by CTO (Jonathan DeLaigle) as a high-value addition to the pipeline.

---

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: System MUST mediate between users and AI agents, enriching prompts with context and enforcing skill usage
- **FR-002**: System MUST support multi-tenant deployment with proper isolation between client environments
- **FR-003**: System MUST auto-load relevant skills based on file patterns and project context without manual invocation
- **FR-004**: System MUST persist active session state (branch, modified files, pending tasks, test results) across compactions and restarts
- **FR-005**: System MUST enforce configurable quality gates before code push/commit operations
- **FR-006**: System MUST verify the user is on the correct branch before allowing commits
- **FR-007**: System MUST track and attribute token usage and costs per user, client, and task type
- **FR-008**: System MUST support per-client spend limits with alerts and throttling
- **FR-009**: System MUST provide an audit trail linking changes to requirements, sessions, and agent attribution
- **FR-010**: System MUST support three user tiers (junior dev, power user, non-technical staff) with appropriate interfaces and guardrail levels
- **FR-011**: System MUST capture user corrections and feed them back into skill updates
- **FR-012**: System MUST support checkpoint/snapshot before risky operations with graduated rollback
- **FR-013**: System MUST work with existing Claude Code infrastructure (hooks, CLAUDE.md, MCP servers)
- **FR-014**: System MUST be incrementally adoptable — teams can start with a single domain and add more later
- **FR-015**: System MUST support multiple AI backends (Claude, Codex, Gemini) even if Claude is first
- **FR-016**: System MUST manage Anthropic API workspaces and keys programmatically for client onboarding
- **FR-017**: System MUST monitor content fidelity including brand compliance and voice consistency
- **FR-018**: System MUST never use client data for model training
- **FR-019**: System MUST provide all outputs as reviewable before delivery to end clients
- **FR-020**: System MUST support event-driven automated pipelines triggered by external events (e.g., Jira ticket creation), with configurable stages that can enrich, confirm, diagnose, fix, and deliver without human intervention
- **FR-021**: System MUST leave structured diagnostic notes on tickets when automated remediation is unsuccessful, providing enough context for a human developer to pick up the work efficiently

### Key Entities

- **Tenant**: A client or internal team with isolated configuration, skills, spend limits, and data boundaries
- **Workspace**: An Anthropic API workspace mapped to a tenant, with its own API keys and spend limits
- **Skill**: A constraint system defining acceptable outputs, brand/voice guidelines, domain terminology, restrictions, and anti-patterns
- **Writing Profile**: A structured skill derived from corpus analysis — voice, vocabulary, citation patterns, audience registers
- **Automated Pipeline**: An event-driven workflow triggered by an external event (e.g., bug ticket creation) that executes a sequence of stages (enrich, confirm, diagnose, fix, deliver) autonomously, using skills and quality gates from the platform
- **Session State**: Ephemeral work-in-progress data (branch, modified files, pending tasks, test results) distinct from persistent memory
- **Quality Gate**: A configurable check (lint, test, visual regression, a11y audit) that runs at defined trigger points (pre-commit, pre-push)
- **Audit Entry**: A record linking a change to its requirement, session, agent, active skills, and human/AI attribution

---

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: Junior developers produce zero wrong-branch commits after joyus-ai is enabled (measured over 30-day period)
- **SC-002**: Skills are auto-loaded for 100% of file edits matching configured patterns, with zero manual invocation required
- **SC-003**: Session state restores within 5 seconds of a new session starting, with all active context (branch, files, tasks) intact
- **SC-004**: Quality gate adoption reaches 90%+ of push/commit operations within 2 weeks of enabling for a project
- **SC-005**: Token usage per task decreases by 20%+ compared to unmediated sessions (measured via prompt coaching and efficient routing)
- **SC-006**: Client onboarding (workspace creation, skill loading, spend limits) completes in under 1 day
- **SC-007**: Content fidelity checks catch 90%+ of brand/voice violations before delivery
- **SC-008**: System supports 10+ concurrent tenants with no cross-tenant data leakage
- **SC-009**: Cost attribution is accurate to the workspace and task-type level, reconcilable with Anthropic's Usage API
- **SC-010**: Platform is incrementally adoptable — teams can enable a single domain (e.g., quality gates only) and see value within 1 day

---

## Open Architectural Questions

These are captured from the requirements brief and ongoing discussions. Each will be resolved during planning or domain-specific specs.

| # | Question | Impact | Resolution Path |
|---|----------|--------|-----------------|
| 1 | Runtime form: Is joyus-ai a CLI wrapper, daemon, hooks system, or service? | High | Resolve during `/spec-kitty.plan` |
| 2 | Hook vs middleware: Does joyus-ai work via Claude Code hooks or as a prompt-rewriting middleware? | High | Resolve during `/spec-kitty.plan` |
| 3 | State storage: Where does session state live (file, local DB, API)? | High | Resolve in Domain 1 spec |
| 4 | Skill routing engine: How does file-pattern-to-skill matching work at runtime? | Medium | Resolve in Domain 3 spec |
| 5 | Risk tiering: Who defines low/medium/high risk — per-project config, per-user, or derived from action? | Medium | Resolve in Domain 2 spec |
| 6 | Multi-agent coordination: How to maintain consistent state across Claude, Codex, Gemini? | Medium | Resolve in Domain 1 spec |
| 7 | Spec-kitty integration: Does joyus-ai use spec-kitty artifacts as input at runtime? | Low | Resolve during `/spec-kitty.plan` |
| 8 | Billing model: Operator-managed vs BYOK vs both? | High | Resolve in Domain 11 spec |
| 9 | Orchestration: OMC, standalone service, or hybrid? | High | Evaluation planned for Phase 3 |
| 10 | Bug triage pipeline: What constraints should limit automated fixes (file count, risk level, project type)? | High | Resolve in Domain 12 spec |
| 11 | Bug triage pipeline: How does the agent access staging/dev environments safely for reproduction? | High | Resolve in Domain 12 spec (Playwright MCP + sandboxing) |
| 12 | Bug triage pipeline: What is the orchestration trigger — Activepieces, custom webhook, or Jira automation? | Medium | Resolve in Domain 12 spec |

---

## Assumptions

- Internal use is the first deployment target; client deployments come after internal validation
- Claude Code is the primary AI agent for initial implementation; other backends are supported but not first-class initially
- The existing constitution (`spec/constitution.md`) and plan (`spec/plan.md`) remain the authoritative source for principles and phasing
- Phase ordering (Asset Sharing > MCP Deploy > Platform > Tools) is fixed; this spec covers Phase 3+ architecture
- Existing skills in the skills repository will be leveraged, not rewritten
- Each domain in the inventory will receive its own deep spec before implementation begins

---

## Constraints

- Must work with existing Claude Code infrastructure (hooks, CLAUDE.md, MCP servers)
- Must be incrementally adoptable — teams can start with just one domain and add more later
- Must not require users to learn a new CLI — mediation should be invisible or minimal
- Must be open to multiple AI backends even if Claude is first
- Spec-kitty manages specs; joyus-ai is the product being specified
- Client data governance follows the tier classification in the constitution (Tiers 1-4)
- Never use client data for model training

---

## Related Artifacts

| Artifact | Location | Relationship |
|----------|----------|-------------|
| Constitution | `spec/constitution.md` | Governing principles — this spec must not contradict |
| Implementation Plan | `spec/plan.md` | Phased roadmap, decision log, open questions |
| Requirements Brief | `joyus-ai-requirements-brief.md` | Evidence-based problem descriptions from prior project workflow |
| Session Context Spec | `kitty-specs/002-session-context-management/spec.md` | Domain 1 deep spec (already exists) |
| MCP Server Deployment | `kitty-specs/001-mcp-server-aws-deployment/spec.md` | Phase 2 infrastructure dependency |
| Internal Portal Spec | `spec/internal-ai-portal-spec.md` | Earlier portal spec — superseded by this umbrella |

---

*Specification captured: February 17, 2026*
*Interview conducted with: project leadership*
*For: joyus-ai — Joyus AI Platform (Feature 003)*
