# Zivtech AI Agent Platform — Constitution

> Project principles that guide all decisions. These are non-negotiable unless explicitly revised.

---

## 1. Project Identity

**Name:** Joyus AI (Zivtech AI Agent Platform)

**Mission:** The only way we find a joyous future with AI is by ensuring it works for the joy of all of us. We can build the best-case scenario, but only if we do it together.

**Purpose:** A multi-tenant AI agent platform that enables Zivtech to deliver AI-powered consulting services — both for internal productivity and as a managed service for clients who cannot have Claude Code-level access. Open source at its core, because shared infrastructure for the mediation between AI and people should belong to everyone.

**Starting Point:** The asset sharing pipeline — a foundational layer so everything we build has somewhere to go — followed by deploying the existing MCP server, then building the platform framework.

---

## 2. Core Principles

### 2.1 Multi-Tenant from Day One

- Architecture must support N clients with proper isolation
- Internal Zivtech use and client deployments share the same codebase
- Configuration, not code changes, determines access levels
- No shortcuts that assume single-tenant deployment

### 2.2 Skills as Guardrails

- Skills are **constraint systems**, not just capability enhancers
- Every client gets mediated AI — outputs are guided by their skills
- Skills are **created through automated profile building** — corpus analysis produces structured writing profiles that the platform loads as skills (methodology proven on NCLC: 94.6%→97.9% attribution accuracy)
- Skills define:
  - Acceptable output formats
  - Brand/voice guidelines
  - Author-specific writing profiles (voice, vocabulary, citation patterns, audience registers)
  - Domain terminology
  - Explicit restrictions
  - Content markers for post-generation verification
- Skills include anti-patterns (what NOT to do), not just examples

### 2.3 Sandbox by Default

- Client environments are isolated unless explicitly opened
- Default posture: minimal access, add permissions as needed
- Internal Zivtech use may have full access; client deployments do not
- All data egress from client environments is logged

### 2.4 Monitor Everything

We track four layers:

| Layer | What We Monitor |
|-------|-----------------|
| **Usage** | Requests, tokens, costs, task types, durations |
| **Content Fidelity** | Output validation, brand consistency, **author/voice verification**, hallucination detection |
| **Guardrails** | Restriction hits, boundary friction, permission escalations |
| **Insights** | Trends, anomalies, skill effectiveness, engagement patterns |

Monitoring is not optional — it's how we learn and improve.

### 2.5 Feedback Loops are First-Class

- User corrections are captured, not discarded
- Corrections feed back into skill updates
- Skills improve over time based on real usage
- Version control for skills enables rollback and evolution tracking

### 2.6 Claude Code Alternative

- This platform provides Claude Code-like power with controlled access
- Clients who can't grant Claude Code's deep system access can use this instead
- Same capabilities, different trust boundary

### 2.7 Automated Pipelines as First-Class Citizens

- The platform supports fully-automated, event-driven workflows — not just human-mediated sessions
- Automated pipelines (e.g., bug triage triggered by Jira ticket creation) use the same skills, quality gates, and audit trail as human sessions
- The enforcement model is agent-agnostic: whether a human or an automated pipeline initiates an action, the same guardrails apply
- Pipelines that modify code or client-facing content must produce reviewable artifacts (PRs, ticket updates) — never silent changes

### 2.8 Open Source by Default

- The platform core — orchestration, mediation layer, monitoring framework, session management, skill loading, quality gates, and multi-tenant architecture — is **open source**
- We build in the open because:
  - The mediation layer between AI and organizations is infrastructure that should be shared, not hoarded
  - Anything in the platform can realistically be rebuilt in hours by a competent team with AI — secrecy provides no durable moat
  - Community adoption, contributions, and trust are more valuable than closed-source protection
  - Open source aligns with the mission: AI that works **for and with** people, not controlled by gatekeepers
- **What stays outside the open source repo:**
  - Client-specific skills, profiles, and corpus data (governed by Data Governance §3)
  - Zivtech's proprietary consulting skill sets (competitive differentiation through expertise, not code secrecy)
  - Security-sensitive configurations (API keys, auth secrets, deployment-specific hardening)
- The boundary is **security and client data**, not platform capability — we don't withhold platform features to create artificial scarcity
- **Zivtech's competitive advantage** is consulting expertise, client relationships, and operational know-how — not the source code
- License selection will balance community freedom with protection against hostile closed-source forks (e.g., AGPL, BSL, or similar copyleft license)
- **Repository separation model:**

| Repository | Visibility | Contains |
|------------|-----------|----------|
| `joyus-ai` | **Public** | Platform core: orchestration, mediation, monitoring, session management, skill loading framework, quality gates, multi-tenant architecture, example/starter skills |
| `zivtech-skills` | **Private** | Zivtech's proprietary consulting skills: writing styles, audit methodologies, domain expertise profiles, proven prompt engineering |
| `client-<name>-skills` | **Private** | Per-client skill sets, corpus data, writing profiles, brand assets, deployment configs |
| `joyus-ai-deploy` | **Private** | Production deployment configs, infrastructure secrets, Zivtech-specific ops (optional — may just be a branch or directory in private repos) |

- The open source repo must **never import or depend on** private repos — the dependency flows one direction only: private repos consume the public platform as a dependency
- Example and starter skills ship with the open source repo to demonstrate the skill authoring API — these are functional but generic (e.g., `example-writing-style`, `example-code-review`)
- The skill loading interface is the contract: any organization can build their own skills against the public API without needing Zivtech's proprietary ones
- This separation ensures the open source repo is self-contained, runnable, and valuable on its own — it is a complete product, not a crippled demo

### 2.9 Assumption Awareness

- AI capabilities, organizational needs, and market conditions change faster than traditional software cycles
- The platform must **track the assumptions** that informed its design decisions, skills, and guardrails
- Assumptions are named, dated, and linked to the skills or guardrails they informed
- When external signals indicate an assumption may be stale (model capability changes, client strategy shifts, market events, feedback patterns), the platform surfaces this for review
- The feedback loop (§2.5) captures reactive corrections; assumption awareness adds **proactive review** — the platform doesn't just fix what broke, it flags what might be about to break
- This is how we help organizations navigate change rather than be blindsided by it

---

## 3. Data Governance

### 3.1 Tier Classification

| Tier | Data Type | Allowed Processing |
|------|-----------|-------------------|
| 1 | Public | Any environment |
| 2 | Internal (Zivtech) | Commercial tier+ |
| 3 | Client Confidential | Enterprise plan, isolated environment |
| 4 | Ultra-Sensitive | Enterprise + Zero Data Retention |

### 3.2 Non-Negotiables

- **Never use client data for model training** — ever
- **All outputs are reviewable** before delivery to end clients
- **Client retains approval authority** over outputs bearing their name
- **Audit trail required** for all client environment actions
- **Data stays in client environment** where possible; agent receives views, not exports

---

## 4. Development Principles

### 4.1 Sharing Layer First, Then Infrastructure, Then Tools

- Phase 1 is the asset sharing pipeline — everything we build needs somewhere to go
- Phase 2 deploys the existing MCP server (already built, needs hosting)
- Phase 3 builds the platform framework (web app, multi-tenant, skills)
- Tools like the Presentation Toolkit come after the platform exists
- Each phase delivers working, usable software

### 4.2 Spec-Driven Development

- We use Spec Kitty for structured development
- Specification before implementation
- Research before coding
- Quality gates before merge

### 4.3 Incremental Delivery

- Each phase delivers working software
- No "big bang" releases
- Internal dogfooding before client deployment
- Real projects validate each phase

---

## 5. Technical Principles

### 5.1 Technology Choices

| Component | Choice | Rationale |
|-----------|--------|-----------|
| MCP Server Hosting | AWS EC2 + Docker Compose | Mature MCP ecosystem (45+ awslabs servers); ~$15-35/mo |
| Static PoC Hosting | GitHub Pages + StatiCrypt | Free, git-native, AES-256 password protection |
| Drupal PoC Hosting | Existing tools (Multidev/Tugboat/Probo.ci) | Already solved, no new infra |
| Orchestrator | Claude Agent SDK | First-party, maintained by Anthropic |
| Skills | File-based + version control | Simple, auditable, git-friendly |
| Session Tracking | Entire CLI (pilot) | Git-native, MIT, no external DB; telemetry off |
| Monitoring | Langfuse + custom | Industry standard + Zivtech-specific |

### 5.2 Cost Awareness

- Prompt caching is mandatory for repeated contexts
- Model selection by task complexity (Haiku → Sonnet → Opus)
- Token usage is tracked and attributed
- Cost per task type informs pricing

### 5.3 Reliability

- Checkpoint after each tool call for recovery
- Circuit breakers for repeated failures
- Graceful degradation over hard failures
- Human handoff for critical failures

---

## 6. Quality Standards

### 6.1 Presentation Toolkit

- Generated decks require <30 minutes manual polish
- 10-slide deck completes in <10 minutes
- Cost <$1 per deck
- Matches client brand guidelines accurately

### 6.2 Platform

- Client deployment in <1 day
- Skill updates based on feedback within 1 week
- Monitoring catches 90% of content issues before delivery
- Zero security incidents

---

## 7. Stakeholders

| Role | Responsibilities |
|------|------------------|
| **Alex UA (CEO)** | Vision, priorities, client relationships |
| **Jonathan DeLaigle (CTO)** | Technical direction, architecture review, platform strategy |
| **Zivtech Team** | Internal users, feedback, testing |
| **Clients** | Requirements, brand assets, approval authority |
| **Claude Code** | Primary development environment |

---

## 8. What This Project Is NOT

- ❌ A presentation-only tool (it's a platform with many tools)
- ❌ A replacement for human judgment (outputs are always reviewable)
- ❌ A way to bypass client approval (clients retain authority)
- ❌ A data collection play (client data is never used for training)
- ❌ A closed platform — the core is open source; proprietary value lives in skills and consulting expertise, not code secrecy
- ❌ A crippled open-source-core with paid features bolted on — the open source repo is a complete, functional product; Zivtech's private skills are consulting IP, not missing features

---

## 9. Amendment Process

This constitution can be amended by:
1. Identifying the principle to change
2. Documenting the rationale
3. Updating this document with version history
4. Communicating the change to all stakeholders

---

*Constitution Version: 1.4*
*Established: January 29, 2026*
*Last Updated: February 18, 2026*
*Changes v1.4: Added Principle 2.8 (Open Source by Default) with repository separation model; added Principle 2.9 (Assumption Awareness) for proactive tracking of design assumptions; updated Section 8 to reflect open source posture; removed "consumer product" constraint (open source inherently broadens audience)*
*Changes v1.3: Added Principle 2.7 (Automated Pipelines as First-Class Citizens) from CTO discussion; added Jonathan DeLaigle as CTO stakeholder*
*Changes v1.2: Added client profile building as skill creation methodology, author/voice verification as content fidelity check, content markers for post-generation verification (NCLC proof-of-concept)*
*Changes v1.1: Updated phase ordering (Asset Sharing → MCP Deploy → Platform → Tools), added infrastructure decisions, added session tracking*
