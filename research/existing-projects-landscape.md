# Existing Projects Landscape Analysis

**Date**: 2026-02-16
**Purpose**: Identify established GitHub projects that overlap with jawn-ai's planned feature set to determine build-vs-leverage decisions.
**Scope**: ~50+ projects surveyed across all 10 problem domains from jawn-ai-requirements-brief.md

---

## Executive Summary

jawn-ai's core value — an invisible mediator layer that protects non-technical users from workflow mistakes — is a genuine gap in the ecosystem. No existing project combines structured state management, canonical document tracking, skill auto-routing, and quality gates into a single system that the user never directly interacts with. Claude Enterprise covers observability, audit trails, and security, but does NOT cover working state persistence, workflow enforcement, or skill routing. The deployment model is: **MCP server + companion service** — the maximum the end user configures is connecting the MCP server (and possibly running a companion app). Everything else is invisible mediation.

---

## 1. Session State Persistence & Context Handoff (Spec 1 — Current Focus)

### Continuous-Claude-v3
- **GitHub**: [parcadei/Continuous-Claude-v3](https://github.com/parcadei/Continuous-Claude-v3)
- **Stars**: 3.5k | **License**: MIT | **Status**: Active (created Dec 2025, 117 commits)
- **What it does**: YAML handoff documents in `thoughts/shared/handoffs/*.yaml`, pre-compaction hooks, ledger-based context tracking, agent orchestration with isolated context windows
- **Relevance**: Closest match to Spec 1 handoff documents. Too heavyweight to adopt wholesale (109 skills, 32 agents, 30 hooks) but excellent for studying YAML handoff structure and hook trigger patterns.
- **Recommendation**: **Study patterns only** — do not use as dependency.

### oh-my-claudecode
- **GitHub**: [Yeachan-Heo/oh-my-claudecode](https://github.com/Yeachan-Heo/oh-my-claudecode)
- **Stars**: 6.4k | **Status**: Very active (1,004 commits, v4.2.11)
- **What it does**: Three-tier notepad system (`.omc/notepad.md`) survives compaction, project memory persists across conversations, state stored in `.omc/state/`, multi-worktree support.
- **Relevance**: Already installed in this project. Good patterns for compaction-resilient memory and multi-worktree isolation.
- **Recommendation**: **Study `.omc/` architecture** for notepad and state management patterns.

### mcp-memory-service
- **GitHub**: [doobidoo/mcp-memory-service](https://github.com/doobidoo/mcp-memory-service)
- **Stars**: 1.3k | **Status**: Very active (v10.13.1, Feb 15, 2026)
- **What it does**: Persistent memory across sessions for 13+ AI tools, semantic search + BM25 hybrid retrieval, 5ms performance, web dashboard.
- **Relevance**: Handles stable/long-term memory (facts, preferences) — could complement jawn-ai's ephemeral state (branch, files, tests). Cross-platform via MCP.
- **Recommendation**: **Could complement** jawn-ai for stable memory while hooks handle ephemeral state.

### task-orchestrator
- **GitHub**: [jpicklyk/task-orchestrator](https://github.com/jpicklyk/task-orchestrator)
- **Stars**: 156 | **Status**: Active (424 commits)
- **What it does**: SQLite-backed external memory, task summaries (300-500 tokens vs 5-10k full contexts), 90% token reduction, Claude Code hooks + MCP server.
- **Relevance**: Good patterns for MCP API design and summary generation for token efficiency.
- **Recommendation**: **Study for** MCP tool API design and summary patterns.

### DevContext
- **GitHub**: [IAmUnbounded/devctx](https://github.com/IAmUnbounded/devctx)
- **Stars**: 133 | **Status**: New (created Feb 14, 2026)
- **What it does**: CLI: `devctx save` captures context in `.devctx/`, `devctx resume` copies formatted prompt to clipboard. Works with Cursor, Claude Code, Windsurf, ChatGPT. MCP server + VS Code extension.
- **Relevance**: "Git tracks code, DevContext tracks intent" — good UX pattern for the "share context" feature (User Story 6).
- **Recommendation**: **Good UX reference** for context sharing commands.

### claude-sessions
- **GitHub**: [iannuttall/claude-sessions](https://github.com/iannuttall/claude-sessions)
- **Stars**: 1.2k | **Status**: Active
- **What it does**: Custom slash commands (`/session:start`, `/session:update`, `/session:end`), timestamped markdown files, automatic summaries with git changes.
- **Relevance**: Documentation-focused, not programmatic state restoration. Good for human-readable session logs.
- **Recommendation**: **Reference for** user-facing session documentation format.

### ccmanager
- **GitHub**: [kbwo/ccmanager](https://github.com/kbwo/ccmanager)
- **Stars**: 859 | **Status**: Active (627 commits)
- **What it does**: Session manager for 8 AI assistants (Claude Code, Gemini, Codex, Cursor, Cline, etc.), parallel sessions across git worktrees, session data copying.
- **Relevance**: Multi-tool session switching, not state persistence. Good for multi-worktree patterns.
- **Recommendation**: **Reference for** multi-worktree session patterns.

### code-on-incus
- **GitHub**: [mensfeld/code-on-incus](https://github.com/mensfeld/code-on-incus)
- **Stars**: 245 | **Status**: Active (232 commits)
- **What it does**: Runs coding agents in isolated containers, state saved to `~/.coi/sessions-<tool>/`, resume restores full session data.
- **Relevance**: Automatic session persistence on container exit. Good isolation model.
- **Recommendation**: **Reference for** workspace isolation patterns (overkill for non-containerized workflows).

### coding-agent-session-search
- **GitHub**: [Dicklesworthstone/coding_agent_session_search](https://github.com/Dicklesworthstone/coding_agent_session_search)
- **Stars**: 461 | **Status**: Alpha (1,634 commits)
- **What it does**: Indexes local session history across 11+ providers, full-text search with BM25, vector embeddings.
- **Relevance**: Post-hoc analysis tool. Good for "query prior sessions" (FR-008).
- **Recommendation**: **Reference for** historical session search capabilities.

### everything-claude-code
- **GitHub**: [affaan-m/everything-claude-code](https://github.com/affaan-m/everything-claude-code)
- **Stars**: 47k | **Status**: Active (v1.4.1)
- **What it does**: Hook examples including `memory-persistence/pre-compact.sh`, `session-start.js`, `session-end.js`. Context injection patterns.
- **Relevance**: Simple, copy-paste hook examples for session lifecycle.
- **Recommendation**: **Reference for** hook implementation patterns.

### Agent File (.af)
- **GitHub**: [letta-ai/agent-file](https://github.com/letta-ai/agent-file)
- **Stars**: 1k | **Status**: Active (141 commits)
- **What it does**: Open file format for serializing stateful AI agents — packages system prompts, memory, tools, LLM settings, message history.
- **Relevance**: Interesting format for agent configuration portability, but not session working state.
- **Recommendation**: **Monitor** for cross-framework sharing standards.

### Spec 1 Gap Analysis

| Requirement | Existing Coverage | Gap? |
|------------|-------------------|------|
| Event-driven snapshots (FR-001) | oh-my-claudecode, Continuous-Claude-v3 have patterns | No — pattern exists |
| Structured handoffs (FR-003) | Continuous-Claude-v3 (YAML) | No — use YAML |
| **Test results in handoffs (FR-013)** | **No tool captures test results** | **YES — our innovation** |
| **Canonical document tracking (FR-004, FR-005)** | **No tool has this concept** | **YES — our innovation** |
| Dirty exit recovery (FR-006) | Rare (code-on-incus has it) | Partially — atomic writes solve it |
| **Share context with note (FR-015)** | DevContext has clipboard pattern | **Partially — combine with structured state** |
| Per-developer state (FR-009) | Standard pattern | No |
| MCP query tools (FR-008) | task-orchestrator, mcp-memory-service | No — MCP is standard |

---

## 2. Quality Gates & Pre-commit Systems (Spec 2 — Workflow Enforcement)

### Lefthook
- **GitHub**: [evilmartians/lefthook](https://github.com/evilmartians/lefthook)
- **Stars**: 7.6k | **License**: MIT | **Status**: Very active (v2.1.1, Feb 2026)
- **What it does**: Fast parallel hook execution (Go binary), YAML config, glob patterns, Docker integration, tag-based command grouping.
- **Recommendation**: **Use as dependency** — best performance for polyglot/monorepo projects.

### pre-commit
- **GitHub**: [pre-commit/pre-commit](https://github.com/pre-commit/pre-commit)
- **Stars**: 15k | **License**: MIT | **Status**: Very active (v4.5.1, 248k projects)
- **What it does**: Multi-language pre-commit hook framework, `.pre-commit-config.yaml`, built-in hooks, CI/CD integration.
- **Recommendation**: **Use as dependency** — largest ecosystem.

### Husky
- **GitHub**: [typicode/husky](https://github.com/typicode/husky)
- **Stars**: 34.8k | **License**: MIT | **Status**: Active (v9.1.7, 17.8M weekly npm downloads)
- **What it does**: Lightweight Node.js Git hooks (2kB gzipped), ~1ms startup, all 13 client-side hooks.
- **Recommendation**: **Use as dependency** for Node.js projects.

### lint-staged
- **GitHub**: [lint-staged/lint-staged](https://github.com/lint-staged/lint-staged)
- **Stars**: 14.4k | **License**: MIT | **Status**: Very active
- **What it does**: Runs linters only on staged files, glob-to-command mapping, integrates with Husky/pre-commit.
- **Recommendation**: **Use with Husky** for file-pattern-to-tool routing.

### Overcommit
- **GitHub**: [sds/overcommit](https://github.com/sds/overcommit)
- **Stars**: 4k | **License**: MIT | **Status**: Maintained
- **What it does**: Comprehensive git hook manager with **best tiered enforcement**: `on_fail`/`on_warn`, `required: true`, `skip_if`, parallel execution.
- **Recommendation**: **Study for tiering model** (always run / optional / ask me).

### Hook Manager Comparison

| Tool | Downloads | Stars | Performance | Tiered Enforcement | Best For |
|------|-----------|-------|-------------|-------------------|----------|
| Husky | 17.8M/wk | 34.8k | Sequential | No | Node.js |
| Lefthook | 815k/wk | 7.6k | Parallel (fast) | Partial (on_fail) | Polyglot/monorepos |
| pre-commit | 304k/wk | 15k | Sequential | No | Multi-language |
| Overcommit | N/A (Ruby) | 4k | Parallel | **Yes** (best) | Ruby, tiered enforcement |

**Verdict**: Don't build a hook runner. Wrap Lefthook or pre-commit with a tiered enforcement layer.

---

## 3. Git Sanity & Branch Management

### git-town
- **GitHub**: [git-town/git-town](https://github.com/git-town/git-town)
- **Stars**: 3.1k | **License**: MIT | **Status**: Very active (v22.5.0, Jan 2026)
- **What it does**: High-level git commands (hack, sync, switch, delete), stacked changes support, compatible with Git Flow/GitHub Flow/trunk-based.
- **Recommendation**: **Use as-is** for workflow commands. No stale branch detection or naming enforcement.

### git-branchless
- **GitHub**: [arxanas/git-branchless](https://github.com/arxanas/git-branchless)
- **Stars**: 4k | **License**: Apache-2.0/MIT | **Status**: Active (alpha, v0.10.0)
- **What it does**: `git undo` for general recovery, smartlog visualization, `git restack` auto-repairs, monorepo-scale performance.
- **Recommendation**: **Use for** undo/recovery capabilities (Domain 7: Error Recovery).

### Branch Naming Enforcement
- **Brack**: [Kraymer/brack](https://github.com/Kraymer/brack) — pre-commit hook for regex-based branch name validation.
- **Custom hooks**: Pattern validation (e.g., `^(feature|bugfix|hotfix)/[a-z0-9-]+$`).
- **Recommendation**: **Use Brack** or custom pre-commit hooks.

### Stale Branch Cleanup
- Multiple GitHub Actions: [Cleanup Stale Branches](https://github.com/marketplace/actions/cleanup-stale-branches-action), [Stale Branches](https://github.com/marketplace/actions/stale-branches), [Prune Stale Branches](https://github.com/liatrio/prune-stale-branches-action)
- **Recommendation**: **Use GitHub Actions** directly — no custom code needed.

**Verdict**: Branch verification before commits ("you're on the wrong branch") is a gap you'd fill. Recovery/undo from git-branchless is worth leveraging.

---

## 4. Skill/Tool Auto-Invocation (File Pattern Routing)

### MegaLinter
- **GitHub**: [oxsecurity/megalinter](https://github.com/oxsecurity/megalinter)
- **Stars**: 2.4k | **License**: AGPL-3.0 | **Status**: Very active
- **What it does**: 50+ languages, 22 formats, file-pattern-to-linter routing via regex, auto-fix.
- **Recommendation**: **Use in CI** (note AGPL license).

### Super-Linter
- **GitHub**: [super-linter/super-linter](https://github.com/super-linter/super-linter)
- **Stars**: 10.3k | **License**: MIT | **Status**: Very active
- **What it does**: 50+ linters, parallelized (v6), GitHub Actions + Docker, slim variant.
- **Recommendation**: **Use in CI** — better MIT license.

### Trunk.io
- **GitHub**: [trunk-io/trunk-action](https://github.com/trunk-io/trunk-action)
- **Stars**: 235 | **License**: MIT (action) / Free tier (CLI)
- **What it does**: Meta-linter, 100+ tools, "Hold The Line" (changed files only), hermetic execution.
- **Recommendation**: **Use locally** — free for <5 committers.

### Reviewdog
- **GitHub**: [reviewdog/reviewdog](https://github.com/reviewdog/reviewdog)
- **Stars**: 8.8k | **License**: MIT | **Status**: Very active
- **What it does**: Post any linter output as PR review comments, multi-platform (GitHub, GitLab, Bitbucket).
- **Recommendation**: **Use as dependency** for posting review results.

**Verdict**: File-pattern-to-linter routing is solved. File-pattern-to-*AI-skill* routing (e.g., "editing .php triggers drupal-security skill") is novel — you'd build the routing table, leverage these tools for standard checks.

---

## 5. AI-Specific Guardrails & Workflow Enforcement

### Qodo PR-Agent
- **GitHub**: [qodo-ai/pr-agent](https://github.com/qodo-ai/pr-agent)
- **Stars**: 10.2k | **License**: AGPL-3.0 | **Status**: Very active (v0.31)
- **What it does**: AI-powered code review (/describe, /review, /improve), multi-platform, 15+ automated agentic workflows, pre-commit enforcement.
- **Recommendation**: **Use for PR review automation** — strongest open-source option.

### Codacy Guardrails
- **Website**: [codacy.com/guardrails](https://www.codacy.com/guardrails) (commercial, free tier)
- **What it does**: MCP server for AI agent integration, real-time code checks, IDE extensions, Claude Code integration.
- **Recommendation**: **Evaluate** — has native Claude Code MCP integration. Could complement or compete with jawn-ai's quality gates.

### NeMo Guardrails (NVIDIA)
- **GitHub**: [NVIDIA-NeMo/Guardrails](https://github.com/NVIDIA-NeMo/Guardrails)
- **Stars**: 5.7k | **License**: Apache-2.0 | **Status**: Very active
- **What it does**: Programmable guardrails for LLM systems, Colang language, 5 rail types, OpenTelemetry tracing.
- **Recommendation**: **Wrong layer** — designed for conversational AI safety, not code quality enforcement.

### Guardrails AI
- **GitHub**: [guardrails-ai/guardrails](https://github.com/guardrails-ai/guardrails)
- **Stars**: 6.4k | **License**: Apache-2.0 | **Status**: Very active (v0.8.1)
- **What it does**: Input/output validation for LLMs, Pydantic models, Guardrails Hub, Flask server.
- **Recommendation**: **Could use** for structured output validation from AI agents.

### OpenGuardrails
- **GitHub**: [openguardrails/openguardrails](https://github.com/openguardrails/openguardrails)
- **Stars**: 231 | **License**: Apache-2.0 | **Status**: Very active (v5.2.7)
- **What it does**: Prevents AI apps from leaking sensitive data — PII, credentials, confidential data scanners.
- **Recommendation**: **Use for** data leak prevention in AI agent interactions.

---

## 6. Multi-Agent Orchestration & AI Platforms

### LangGraph
- **GitHub**: [langchain-ai/langgraph](https://github.com/langchain-ai/langgraph)
- **Stars**: 24.7k | **Status**: Production-ready
- **What it does**: Stateful graph-based orchestration, durable execution, memory, human-in-the-loop.
- **Recommendation**: **Too heavy** — requires framework adoption. Study for state management patterns.

### AutoGen (Microsoft)
- **GitHub**: [microsoft/autogen](https://github.com/microsoft/autogen)
- **Stars**: 54.4k | **Status**: Highly active (merging with Semantic Kernel)
- **What it does**: Multi-agent conversations with human participation.
- **Recommendation**: **Too abstract** — conversation-focused, not code workflow mediation.

### CrewAI
- **GitHub**: [crewAIInc/crewAI](https://github.com/crewAIInc/crewAI)
- **Stars**: 8.3k | **Status**: Active (YC W23)
- **What it does**: Role-based collaborative agents, lightweight Python framework.
- **Recommendation**: **Wrong abstraction** — task agents, not workflow mediation.

### OpenHands (formerly OpenDevin)
- **GitHub**: [OpenHands/OpenHands](https://github.com/OpenHands/OpenHands)
- **Stars**: 65k | **License**: MIT | **Status**: Very active
- **What it does**: Open platform for generalist/specialist AI coding agents, 26% SWE-bench Lite.
- **Recommendation**: **Competitor, not component** — autonomous coding, not mediated workflow.

### claude-flow
- **GitHub**: [ruvnet/claude-flow](https://github.com/ruvnet/claude-flow)
- **Stars**: 14.1k | **Status**: Active (5,918 commits)
- **What it does**: Session persistence with SQLite WAL, 3-scope agent memory, multi-agent orchestration.
- **Recommendation**: **Reference for** multi-agent persistence patterns. Too complex for session state alone.

**Verdict**: All are the wrong abstraction level for jawn-ai. Either too abstract (orchestration) or too autonomous (coding agents). jawn-ai's mediator layer concept is a unique gap.

---

## 7. Observability & Audit Trail (Spec 3 — Future)

### Langfuse
- **GitHub**: [langfuse/langfuse](https://github.com/langfuse/langfuse)
- **Stars**: 5.9k | **License**: MIT | **Status**: Very active
- **What it does**: Open-source LLM observability, metrics, evals, prompt management, OpenTelemetry, self-hostable.
- **Recommendation**: **Use as dependency** for Spec 3 audit trails.

### Arize Phoenix
- **GitHub**: [Arize-ai/phoenix](https://github.com/Arize-ai/phoenix)
- **Stars**: 7.8k | **Status**: Very active (Arize raised $70M Series C)
- **What it does**: Self-hosted LLM observability, OpenTelemetry, auto-instrumentation, 2.5M+ monthly downloads.
- **Recommendation**: **Alternative to Langfuse** for Spec 3.

### LiteLLM
- **GitHub**: [BerriAI/litellm](https://github.com/BerriAI/litellm)
- **Stars**: 35k | **Status**: Very active
- **What it does**: Unified gateway to 100+ LLM APIs (OpenAI format), cost tracking, load balancing, 8ms P95 latency.
- **Recommendation**: **Use for** multi-backend routing when supporting Claude + Codex + Gemini.

### Tokscale
- **GitHub**: [junhoyeo/tokscale](https://github.com/junhoyeo/tokscale)
- **Status**: Active
- **What it does**: Token usage tracking across Claude Code, Codex, Cursor, Gemini CLI, etc.
- **Recommendation**: **Lightweight option** for cost tracking.

### AI Observer
- **GitHub**: [tobilg/ai-observer](https://github.com/tobilg/ai-observer)
- **Status**: Active
- **What it does**: Self-hosted, single-binary, OpenTelemetry-compatible observability for local AI tools.
- **Recommendation**: **Lightweight option** for local observability.

---

## 8. Documentation & Context Tools

### Context7
- **Website**: [context7.com](https://context7.com)
- **Integration**: Already configured as MCP server (`mcp__context7__resolve-library-id`, `mcp__context7__query-docs`)
- **What it does**: Up-to-date documentation and code examples for any library via MCP.
- **Relevance**: Reduces hallucinated API usage, keeps agents current on library versions, saves context tokens.
- **Recommendation**: **Already integrated** — complements jawn-ai (library knowledge vs project state/workflow).

### .cursorrules / CLAUDE.md Ecosystem
- Various projects for project-specific AI coding rules
- CodeRabbit auto-detects .cursorrules, CLAUDE.md, .clinerules, .windsurfrules
- Conversion tools exist between formats
- **Recommendation**: **Static files, not dynamic mediation** — jawn-ai goes beyond this.

---

## Build vs. Leverage Decision Matrix

| Domain | Decision | What to Use |
|--------|----------|-------------|
| Session state persistence | **BUILD** (novel) | Study Continuous-Claude-v3 + OMC patterns |
| Structured handoff documents | **BUILD** (novel) | YAML format from industry patterns |
| Canonical document tracking | **BUILD** (novel — nobody does this) | — |
| Test results in handoffs | **BUILD** (novel) | — |
| Context sharing | **BUILD** (novel UX) | Study DevContext for CLI patterns |
| Pre-commit/push hooks | **WRAP** existing | Lefthook or pre-commit as engine |
| Tiered enforcement (always/optional/ask) | **BUILD** thin layer | On top of existing hook runners |
| Branch verification ("wrong branch") | **BUILD** | — |
| Stale branch cleanup | **USE AS-IS** | GitHub Actions |
| Branch naming enforcement | **USE AS-IS** | Brack or custom pre-commit hook |
| File-pattern-to-skill routing | **BUILD** (novel for AI skills) | lint-staged pattern for linters |
| Git undo/recovery | **WRAP** existing | git-branchless |
| AI code review | **INTEGRATE** | Qodo PR-Agent |
| Audit trail | **INTEGRATE** | Langfuse or Phoenix |
| Token/cost tracking | **INTEGRATE** | Langfuse or Tokscale |
| Multi-backend routing | **INTEGRATE** | LiteLLM |
| Library docs for agents | **ALREADY DONE** | Context7 (configured) |
| Data leak prevention | **INTEGRATE** | OpenGuardrails |

---

## Key Takeaways

1. **Spec 1 is genuinely novel** — build it from scratch, studying patterns from Continuous-Claude-v3 and oh-my-claudecode.
2. **Spec 2 can leverage existing hook runners** (Lefthook/pre-commit) and linting tools (Super-Linter/Trunk.io). Build the mediation/tiering layer on top.
3. **Spec 3 should integrate, not build** — Langfuse/Phoenix for observability, LiteLLM for multi-backend routing.
4. **The mediator layer concept is a real gap** — nobody has built a system that sits between users and AI agents to enforce workflow discipline with quality gates, canonical document management, and skill routing.
5. **Context7 is complementary** — handles library knowledge while jawn-ai handles project state and workflow.

---

---

## 9. Claude Enterprise Feature Overlap (Added 2026-02-16)

### What Enterprise Covers (Don't Build)

| Domain | Enterprise Feature | Coverage |
|---|---|---|
| **Audit logging** | 180-day audit logs, Compliance API, OpenTelemetry | Strong — covers event tracking, usage metrics |
| **Cost/token tracking** | OpenTelemetry metrics, spend caps per user/org, Analytics API | Strong — granular, exportable |
| **Security/compliance** | SOC 2, HIPAA-ready, SSO/SAML, SCIM, ZDR, IP allowlisting | Strong — enterprise-grade |
| **MCP infrastructure** | Native MCP support platform-wide, hundreds of connectors | Strong — this is the platform |
| **Custom instructions** | CLAUDE.md, Project instructions, Skills governance | Good — multiple layers |
| **Basic session resume** | Agent SDK session management, Claude Code Tasks (persistent to disk) | Good — conversation continuity |
| **Context windows** | 500K chat / 1M Claude Code | Good — reduces compaction frequency |
| **Team collaboration** | Shared Projects, Cowork (shared workspace), Claude Code agent teams | Moderate — shared knowledge, not structured state sharing |
| **Admin guardrails** | Managed settings, tool permissions, file access restrictions, spend caps | Moderate — controls access, not workflow discipline |
| **Skills governance** | Admin approval for Skills, evaluation suites, peer review | Moderate — governs deployment, not auto-invocation |

### What Enterprise Does NOT Cover (Build)

| Domain | Gap | Why It Matters |
|---|---|---|
| **Working state snapshots** | Enterprise persists conversations, not git branch/modified files/test results/pending decisions | Session compaction loses working context — user must re-explain |
| **Canonical document management** | No concept of "this file is the authoritative version" | Users (especially non-technical) will create/access duplicate files |
| **Structured handoff documents** | No machine-parseable state transfer between sessions | New sessions start from scratch or from lossy prose summaries |
| **Quality gates (tiered)** | Controls what tools can be used, not workflow verification before actions | No "run tests before pushing" or "verify branch before committing" |
| **Skill auto-routing** | Skills require manual invocation or admin-deployed workflows | No automatic "editing .php triggers drupal-security" |
| **Branch verification** | No wrong-branch detection or git workflow enforcement | Users on wrong branch don't know until it's too late |
| **Structured context sharing** | Shared Projects for knowledge, not "here's my exact working state + a note about what's broken" | Junior devs can't articulate what's wrong; state export automates this |

### Impact on Spec Roadmap

| Original Spec | Enterprise Impact | Revised Priority |
|---|---|---|
| **Spec 1: Session & Context** | Core value preserved — Enterprise doesn't do working state | **Still P1** |
| **Spec 2: Workflow Enforcement** | Quality gates, skill routing, git sanity unmet by Enterprise | **Still P2** |
| **Spec 3: Observability** | **~80% covered by Enterprise** (audit logs, cost tracking, OpenTelemetry) | **Deprioritize** — only build change-to-requirement traceability, skill invocation audit |

---

## 10. Critical Reframing: Non-Technical User Lens (Added 2026-02-16)

### The Core Insight

The target user is NOT a developer who can configure hooks and shell scripts. The target user:
- May not know what a git branch is
- Cannot write or run shell commands
- Will never edit a YAML config file
- Maximum setup effort: **add an MCP server + run a companion application**

This means every "just configure the hooks" solution is invalid for the target audience. The mediator must be invisible.

### Revised Architecture Model

```
User talks to Claude Desktop/Code
        |
Claude connects to jawn-ai MCP server (user configured this ONE thing)
        |
Companion service runs alongside (handles background state capture,
  event monitoring, things MCP protocol can't do)
        |
The system silently:
  - Captures working state on every significant action
  - Provides context tools Claude can call to stay oriented
  - Enforces quality gates before risky operations
  - Routes skills based on what files are being touched
  - Blocks or warns on dangerous actions
  - Logs everything for audit
        |
The user never sees any of this. Claude is the UI.
```

### Why Each "Novel" Feature Survives This Lens

| Feature | Power User Critique | Non-Technical User Reality |
|---|---|---|
| Full snapshot system | "A 5-line shell hook is enough" | User can't write shell hooks. MCP tool needs reliable structured data. |
| Canonical doc management | "Just delete the duplicate" | User doesn't know there IS a duplicate. System must route automatically. |
| Machine-parseable handoffs | "Claude parses prose fine" | Machine-to-machine transfer needs structure. Consistency across all users. |
| Test results in handoffs | "Just re-run the tests" | User doesn't know how to run tests. Stored results give Claude context. |
| Context sharing + notes | "Just send a Slack message" | Junior dev can't articulate what's wrong. Auto-packaged state solves this. |
| Tiered quality gates | "Config file on Lefthook" | User doesn't run Lefthook. MCP-mediated gates via Claude. |
| Skill auto-routing | "Config file + hook script" | This IS the product. Admin configures once, all users get guardrails. |
| Branch verification | "Standard pre-commit hook" | User doesn't have hooks. MCP intercepts git operations. |

### What to Simplify (Even With This Lens)

1. **CLI component**: Deprioritize. Power users/admins need it; build MCP server first, CLI second.
2. **Adapter pattern** (Claude Code/Codex/generic): YAGNI. Build Claude Code path. Add adapters when there's a second platform.
3. **Historical snapshot queries**: Nice-to-have. Critical path is save/restore last state.
4. **Retention policies**: Premature. Snapshots are 2-10KB. Keep all, prune later.

---

## Revised Build vs. Leverage Decision Matrix (Updated 2026-02-16)

| Domain | Decision | What to Use |
|--------|----------|-------------|
| **MCP server (core tools)** | **BUILD FIRST** | `get_context`, `save_state`, `check_canonical`, `verify_before_action` |
| **Companion service** | **BUILD** | Background state capture, event monitoring, skill routing engine |
| Session state persistence | **BUILD** | Structured snapshots, MCP-queryable |
| Canonical document tracking | **BUILD** | Admin-configured, user-invisible |
| Structured handoff documents | **BUILD** | Machine-to-machine via MCP tools |
| Skill auto-routing | **BUILD** | Glob-to-skill config, auto-injection via MCP |
| Quality gate enforcement | **BUILD** | MCP-mediated pre-action checks |
| Branch verification | **BUILD** | MCP guardrail on git operations |
| Context sharing + notes | **BUILD** | Auto-packaged state export |
| Test results in state | **BUILD** | Include in snapshots as context (not ground truth) |
| CLI for admins | **BUILD SECOND** | Power user config/debugging interface |
| Adapters (Codex, etc.) | **DEFER** | Build when there's a second platform |
| Historical queries | **DEFER** | Build after core save/restore works |
| Retention policies | **DEFER** | Build when storage is actually a problem |
| Audit logging | **DON'T BUILD** | Claude Enterprise covers it |
| Cost/token tracking | **DON'T BUILD** | Claude Enterprise covers it |
| Security/compliance | **DON'T BUILD** | Claude Enterprise covers it |
| Multi-backend routing | **DEFER** | LiteLLM when needed |
| Library docs | **ALREADY DONE** | Context7 (configured) |

---

## Key Takeaways (Revised 2026-02-16)

1. **The product is an invisible mediator.** The user interacts with Claude. Claude interacts with jawn-ai's MCP server. The user never touches jawn-ai directly. Maximum setup: add MCP server + run companion app.
2. **Claude Enterprise eliminates Spec 3.** Don't build audit logging, cost tracking, or security infrastructure. Enterprise handles it.
3. **Spec 1 and Spec 2 are still fully valuable.** Enterprise doesn't do working state persistence, workflow enforcement, skill routing, or canonical document management.
4. **MCP server first, CLI second.** The MCP server IS the product for non-technical users. The CLI is an admin tool built later.
5. **Context7 handles library knowledge.** jawn-ai handles project state and workflow. They're complementary.
6. **Existing OSS tools (Lefthook, pre-commit, git-branchless, etc.) are useful internally** — the companion service can use them under the hood — but users never interact with them directly.

---

*Research compiled: February 16, 2026*
*Updated: February 16, 2026 (Claude Enterprise analysis, non-technical user reframing)*
*For: jawn-ai — Mediator Layer landscape analysis*
*Evidence: GitHub search, web research, MCP ecosystem analysis, Claude Enterprise documentation*
