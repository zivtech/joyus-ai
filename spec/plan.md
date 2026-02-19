# Zivtech AI Agent Platform — Implementation Plan

**Project:** Joyus AI Platform
**Date:** January 29, 2026 (Updated February 11, 2026)
**Status:** Phase 1 Starting — Asset Sharing Pipeline

---

## 0. Phased Roadmap (Updated Feb 11, 2026)

### Phase Ordering

| Phase | Name | Status | Description |
|-------|------|--------|-------------|
| **1** | Asset Sharing Pipeline | **Starting** | GitHub Pages + StatiCrypt for sharing PoCs behind passwords |
| **2** | MCP Server Deployment | Planned | Deploy existing MCP server to AWS EC2 |
| **2.5** | Profile Engine + Content Fidelity | **Priority** | Standalone library: corpus → profiles → skill files + two-tier verification. Platform's moat. |
| **2.7** | Content Infrastructure | **Planned** | Corpus connectors, search abstraction, access enforcement, bot mediation, generate-then-verify chat (Feature 006) |
| **3** | Platform Framework | Planned | Internal AI portal — web app, multi-tenant, skills system (imports profile engine + content infrastructure) |
| **4** | Additional Tools | Future | Presentation toolkit, document generator, analysis tools |

### Key Decisions (Feb 11, 2026)

| Decision | Choice | Rationale |
|----------|--------|-----------|
| MCP server hosting | AWS EC2 + Docker Compose (~$15-35/mo) | Mature MCP ecosystem (45+ awslabs servers); Claude can manage infra |
| Static PoC hosting | GitHub Pages + StatiCrypt (free) | Git-native, AES-256 password protection, directory-based |
| Drupal PoC hosting | Existing tools — separate system | Pantheon Multidev / Tugboat / Probo.ci; already solved |
| Password protection | StatiCrypt (near-term) | AES-256 client-side; directory structure carries forward to Drupal portal |
| Session tracking | Entire CLI (pilot) | Git-native, MIT, no external DB; telemetry off, manual-commit; 2-week eval |

See `hosting-comparison.md` for full infrastructure analysis.

### Phase 1: Asset Sharing Pipeline (ACTIVE)

**Goal:** A working pipeline to share Claude-generated artifacts — HTML pages, PDFs, React apps — behind password protection.

**Why first:** Everything else we build needs somewhere to go. This is the foundational sharing layer.

**Implementation:**
- [ ] GitHub repo (dedicated or branch of joyus-ai) with GitHub Pages enabled
- [ ] GitHub Actions workflow: push assets → StatiCrypt encrypts → GitHub Pages serves
- [ ] Per-project passwords in GitHub Secrets
- [ ] Directory-based organization (`zivtech.github.io/project-name/`)
- [ ] First asset deployed and password-protected
- [ ] Custom domain (`ai.example.com`) when ready

**Estimated effort:** 1-2 days

### Phase 2: MCP Server Deployment

**Goal:** Deploy the existing MCP server to AWS EC2.

**What's already built:** OAuth auth, MCP protocol endpoint, tool executors for Jira/Slack/GitHub/Google, scheduled tasks, encrypted token storage, Docker config (see `joyus-ai-mcp-server/`).

**Implementation:**
- [ ] Provision AWS EC2 (t3.small/medium)
- [ ] Docker Compose: Node.js app + PostgreSQL
- [ ] GitHub Actions CI/CD pipeline
- [ ] DNS + TLS configuration
- [ ] Smoke test all tool executors
- [ ] AWS MCP servers for infrastructure management via Claude

**Estimated effort:** 3 days

### Phase 2.5: Profile Engine + Content Fidelity (PRIORITY)

**Goal:** Standalone library that turns a client document corpus into structured writing profiles (skill files) and provides two-tier content fidelity verification. This is the platform's moat — the "thick domain" investment per Decision #18.

**Why before Phase 3:** The profile engine is independent of the web portal, MCP gateway, and container infrastructure. Building it standalone means: (1) immediate use for the client PoC, (2) validation on a second domain before the platform exists, (3) Phase 3 development gets simpler — the hardest piece is already built. Per Boris Cherny's insight: invest in domain knowledge and verification, keep orchestration thin.

**What's already built (client PoC):**
- Tiered hybrid attribution model (Python, 3 confidence tiers)
- 129-feature stylometric engine (Burrows' Delta)
- Content marker extraction (topic-specific terminology as primary discriminator)
- Comprehensive 22K-word, 12-section profile template
- Author inventory (40 authors, 20 profiled, 94.6%→97.9% accuracy)
- Validation scripts (`validate_new_profiles.py`, `validate_tier1_profiles.py`)
- Webapp (FastAPI + React) for real-time attribution

**Detailed spec:** See [`profile-engine-spec.md`](profile-engine-spec.md)

**Implementation:**
- [ ] Extract client PoC attribution code into domain-agnostic library
- [ ] Parameterize corpus analyzer (remove client-specific vocabulary)
- [ ] Build skill file emitter (profile → SKILL.md + markers.json + stylometrics.json)
- [ ] Build Tier 1 inline verification (marker presence + stylometric distance, ~100ms)
- [ ] Build Tier 2 deep analysis (full Burrows' Delta, cross-document consistency)
- [ ] CLI tools for profile building and content verification
- [ ] Regression tests (accuracy must not drop)
- [ ] Second-domain validation (Zivtech internal writing profile)

**Estimated effort:** 2-3 weeks

### Phase 3: Platform Framework

**Goal:** Internal AI portal — web app with chat interface, multi-tenant infrastructure.

**Context:** A Zivtech staff member on Windows cannot access Claude Cowork (Mac/Linux only). We need a web-based alternative that provides similar agentic capabilities.

**Detailed spec:** See [`internal-ai-portal-spec.md`](internal-ai-portal-spec.md)

**Implementation:**
- [ ] Next.js + FastAPI web app
- [ ] Google OAuth SSO (restricted to organization domain)
- [ ] Chat UI with Claude API integration
- [ ] MCP server connections (Jira, Slack, Gmail, GitHub)
- [ ] Per-user token storage with encryption
- [ ] Skills/Styles system for client-specific mediation
- [ ] MCP Gateway for auth, routing, logging (include browser abstraction layer — high-level actions over raw Playwright)
- [ ] Monitoring for usage and content fidelity
- [ ] Sandboxed client environments
- [ ] Container-based code execution sandbox (Docker/gVisor — prerequisite for Phase 4 Analysis Tools + Spec Kitty as Service)
- [ ] Background task/job management in orchestration layer (job queue with status, logs, cancellation, timeout)

### Phase 4: Additional Tools (Future)

**Goal:** Expand the tools layer on top of the platform.

- Presentation Toolkit (rebrand decks, generate slides)
- Document Generator (reports, proposals — DOCX, PDF)
- Analysis Tools (financial modeling, research, data analysis)
- Spec Kitty as Service (spec-driven development for clients who can't run locally)
- Visual Regression Testing Service (PR-based a11y + visual regression on demand)

### Session Tracking

**Tool:** [Entire CLI](https://github.com/entireio/cli) — MIT licensed, git-native, no external database.

**Current Config (`.entire/settings.json`):**
- `strategy: manual-commit` — review transcripts before pushing
- `telemetry: false` — no Posthog data collection

**Rollout Plan:**
1. Pilot on joyus-ai itself with telemetry off and auto-push disabled
2. Review captured data for 2 weeks
3. Decide on broader team rollout based on findings

---

## 1. Platform Architecture Overview

### Architectural Principle: Thick Domain, Thin Orchestration (Decision #18)

Informed by Boris Cherny's (Claude Code creator) design philosophy: orchestration scaffolding gets subsumed by model upgrades — his team deletes product code with every new model release. Domain knowledge is durable.

| Layer | Investment | Why |
|-------|-----------|-----|
| **Skills Layer** | **Thick** | Domain knowledge (brand assets, author profiles, client constraints). The model can't know this without being told. Durable across model upgrades. |
| **Content Fidelity / Verification** | **Thick** | Verification loops multiply quality 2-3x (Boris's #1 insight). Attribution model, content markers, stylometrics — this is the platform's moat. |
| **Monitoring** | **Thick** | Usage analytics, cost attribution, guardrail hits. Business infrastructure, not model scaffolding. |
| **MCP Gateway** | **Medium** | Auth, routing, logging — standard infrastructure. Won't change with model upgrades. Keep protocol surface minimal. |
| **Orchestration** | **Thin** | Router, not engine. Authenticate → load skills → inject verification → call Agent SDK → log → return. The model handles planning, retries, and output formatting. |
| **Context Management** | **Thin** | Agentic search over skill files, not vector embeddings. Boris's team moved away from embeddings — same accuracy, cleaner deployment. |

### Core Architecture

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                      ZIVTECH AI AGENT PLATFORM                               │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                              │
│  ┌────────────────────────────────────────────────────────────────────────┐ │
│  │                         MCP INTERFACE LAYER                            │ │
│  │                                                                        │ │
│  │   Exposes platform as MCP server    Consumes external MCP servers     │ │
│  │   (clients connect here)            (Jira, Slack, databases, etc.)    │ │
│  └────────────────────────────────────────────────────────────────────────┘ │
│                                    │                                         │
│                                    ▼                                         │
│  ┌────────────────────────────────────────────────────────────────────────┐ │
│  │                         ORCHESTRATION LAYER                            │ │
│  │                                                                        │ │
│  │   • Request routing           • Context management                    │ │
│  │   • Skill loading             • Tool dispatch                         │ │
│  │   • Session handling          • Error recovery                        │ │
│  │                                                                        │ │
│  │   [Decision: Claude Code skill vs Standalone service vs Hybrid]       │ │
│  └────────────────────────────────────────────────────────────────────────┘ │
│                                    │                                         │
│                                    ▼                                         │
│  ┌────────────────────────────────────────────────────────────────────────┐ │
│  │                           SKILLS LAYER                                 │ │
│  │                                                                        │ │
│  │   Git-based skill repository:                                         │ │
│  │   ├── zivtech-skills/           (shared Zivtech library)              │ │
│  │   │   ├── presentation/                                               │ │
│  │   │   ├── document/                                                   │ │
│  │   │   └── analysis/                                                   │ │
│  │   └── client-skills/            (per-client customizations)           │ │
│  │       ├── acme-corp/                                                  │ │
│  │       └── beta-inc/                                                   │ │
│  │                                                                        │ │
│  │   Each skill folder:                                                  │ │
│  │   ├── SKILL.md          (instructions, constraints)                   │ │
│  │   ├── templates/        (output templates)                            │ │
│  │   ├── examples/         (good/bad examples)                           │ │
│  │   ├── validators/       (output validation rules)                     │ │
│  │   └── assets/           (brand assets, logos, etc.)                   │ │
│  └────────────────────────────────────────────────────────────────────────┘ │
│                                    │                                         │
│                                    ▼                                         │
│  ┌────────────────────────────────────────────────────────────────────────┐ │
│  │                           TOOLS LAYER                                  │ │
│  │                                                                        │ │
│  │   ┌─────────────┐  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐  │ │
│  │   │Presentation │  │  Document   │  │  Analysis   │  │  Spec Kitty │  │ │
│  │   │  Toolkit    │  │  Generator  │  │   Tools     │  │  (Dev Tool) │  │ │
│  │   │             │  │             │  │             │  │             │  │ │
│  │   │ ← PHASE 4   │  │   Phase 4   │  │   Phase 4   │  │   Phase 4   │  │ │
│  │   └─────────────┘  └─────────────┘  └─────────────┘  └─────────────┘  │ │
│  └────────────────────────────────────────────────────────────────────────┘ │
│                                    │                                         │
│                                    ▼                                         │
│  ┌────────────────────────────────────────────────────────────────────────┐ │
│  │                        MONITORING LAYER                                │ │
│  │                                                                        │ │
│  │   • Usage analytics        • Content fidelity checks                  │ │
│  │   • Cost attribution       • Guardrail monitoring                     │ │
│  │   • Feedback capture       • Anomaly detection                        │ │
│  └────────────────────────────────────────────────────────────────────────┘ │
│                                                                              │
└─────────────────────────────────────────────────────────────────────────────┘
```

### Deployment Model

**Phase 3: Skill-based isolation**
- Same infrastructure for all users
- Client differentiation via skill loading
- Simpler, faster to implement

**Phase 4+: Container-based isolation (as needed)**
- Separate containers per client
- Stronger security boundaries
- Higher operational overhead

```
Phase 3: Shared Infrastructure
┌─────────────────────────────────────────┐
│           Platform Instance             │
│  ┌─────────┐ ┌─────────┐ ┌─────────┐   │
│  │Zivtech  │ │Client A │ │Client B │   │
│  │ Skills  │ │ Skills  │ │ Skills  │   │
│  └─────────┘ └─────────┘ └─────────┘   │
└─────────────────────────────────────────┘

Phase 4+: Container Isolation (if needed)
┌─────────────┐ ┌─────────────┐ ┌─────────────┐
│  Zivtech    │ │  Client A   │ │  Client B   │
│  Container  │ │  Container  │ │  Container  │
└─────────────┘ └─────────────┘ └─────────────┘
```

---

## 2. MCP Architecture

The platform has a dual MCP role:

### Platform AS MCP Server (Outbound Interface)

Clients and internal tools connect to the platform via MCP:

```
┌─────────────┐     MCP      ┌─────────────────────┐
│ Claude Code │ ──────────▶  │                     │
│ / Cowork    │              │   Zivtech Platform  │
└─────────────┘              │   (MCP Server)      │
                             │                     │
┌─────────────┐     MCP      │   Tools:            │
│ Client App  │ ──────────▶  │   • rebrand_deck    │
│             │              │   • generate_doc    │
└─────────────┘              │   • analyze_data    │
                             └─────────────────────┘
```

**Exposed MCP Tools (examples):**
- `rebrand_deck` — Rebrand a presentation with new brand assets
- `generate_document` — Create document from template + content
- `analyze_financials` — Run financial analysis
- `research_topic` — Research and summarize a topic
- `spec_kitty` — Spec-driven development workflow (for clients who can't run locally, Phase 4)

### Platform USES MCP Servers (Inbound Connections)

Platform orchestrates calls to external services:

```
┌─────────────────────┐
│   Zivtech Platform  │
│   (MCP Client)      │
│                     │      MCP      ┌─────────────┐
│   Orchestrator  ────┼─────────────▶ │    Jira     │
│                     │              └─────────────┘
│                     │      MCP      ┌─────────────┐
│                 ────┼─────────────▶ │    Slack    │
│                     │              └─────────────┘
│                     │      MCP      ┌─────────────┐
│                 ────┼─────────────▶ │  Database   │
│                     │              └─────────────┘
└─────────────────────┘
```

### MCP Gateway Pattern

Central gateway for auth, routing, logging:

```
┌─────────────────────────────────────────────────────────────┐
│                       MCP GATEWAY                            │
├─────────────────────────────────────────────────────────────┤
│                                                              │
│  INBOUND (Platform as Server)                                │
│  ├── Authentication (API keys, OAuth tokens)                │
│  ├── Authorization (skill-based permissions)                │
│  ├── Rate limiting (per-client quotas)                      │
│  └── Request logging (audit trail)                          │
│                                                              │
│  OUTBOUND (Platform as Client)                               │
│  ├── Credential management (secure token storage)           │
│  ├── Connection pooling                                      │
│  ├── Response caching                                        │
│  └── Error handling + retry logic                           │
│                                                              │
└─────────────────────────────────────────────────────────────┘
```

---

## 3. Skills Architecture

### Repository Structure

```
joyus-ai-skills/                       (Git repository)
├── README.md
├── .skill-registry.json              (skill metadata, versions)
│
├── core/                             (Zivtech shared skills)
│   ├── presentation/
│   │   ├── SKILL.md                  (instructions + constraints)
│   │   ├── templates/
│   │   │   ├── title-slide.json
│   │   │   ├── content-slide.json
│   │   │   └── ...
│   │   ├── examples/
│   │   │   ├── good/
│   │   │   └── bad/
│   │   ├── validators/
│   │   │   └── content-check.py
│   │   └── lib/                      (Python modules)
│   │       ├── extract.py
│   │       ├── transform.py
│   │       └── assemble.py
│   │
│   ├── document/
│   ├── analysis/
│   └── research/
│
└── clients/                          (Per-client customizations)
    ├── acme-corp/
    │   ├── brand/
    │   │   ├── SKILL.md              (brand voice, restrictions)
    │   │   ├── assets/
    │   │   │   ├── logo.png
    │   │   │   ├── colors.json
    │   │   │   └── template.pptx
    │   │   └── examples/
    │   ├── profiles/                 (author/voice writing profiles)
    │   │   ├── author-a/
    │   │   │   ├── SKILL.md          (voice, tone, vocabulary, anti-patterns)
    │   │   │   ├── markers.json      (content markers for attribution)
    │   │   │   ├── stylometrics.json (function word distributions)
    │   │   │   └── examples/
    │   │   │       ├── good/
    │   │   │       └── bad/
    │   │   └── author-b/
    │   │       └── ...
    │   └── overrides/                (client-specific tool config)
    │
    └── beta-inc/
        └── ...
```

### Client Profile Building Pipeline

The Skills Layer requires a **method for creating skills** — not just storing them. The Client Profile Building pipeline is that method. Proven on the client PoC (94.6% accuracy on 4 authors, 97.9% on 9 authors), it transforms a client's document corpus into structured writing profiles that the orchestrator loads as skills.

```
Client Profile Building Pipeline:
┌──────────────┐     ┌──────────────────┐     ┌──────────────────┐     ┌─────────────────┐
│  Client       │     │  Corpus           │     │  Profile          │     │  Skill File     │
│  Corpus       │────▶│  Analysis          │────▶│  Generation       │────▶│  Output         │
│  (docs, web)  │     │                    │     │                   │     │                 │
└──────────────┘     │  • Content markers  │     │  • Voice & tone   │     │  SKILL.md       │
                      │  • Stylometric      │     │  • Vocabulary     │     │  validators/    │
                      │    features (129)   │     │  • Citations      │     │  examples/      │
                      │  • Topic detection  │     │  • Audience regs  │     │  markers.json   │
                      │  • Audience analysis │     │  • Anti-patterns  │     │                 │
                      └──────────────────┘     └──────────────────┘     └─────────────────┘
```

**Profile schema (standardized for platform consumption):**
- **Voice & tone** — formality, advocacy stance, rhetorical patterns
- **Vocabulary** — signature phrases, domain terminology, preferred/avoided terms
- **Structural patterns** — document organization, paragraph flow, heading conventions
- **Citation practices** — preferred authorities, citation density, formatting
- **Audience registers** — how voice shifts for Congress vs. regulators vs. attorneys vs. public
- **Anti-patterns** — what NOT to do (maps to Constitution §2.2: skills include anti-patterns)
- **Content markers** — machine-readable tokens for attribution verification (see Monitoring §5)

**Client PoC:** 20 of 40 authors profiled, hybrid attribution model operational, web app deployed. See `../poc/author-identification-research/`.

### Skill Loading Pattern

```python
# Conceptual skill loading (actual implementation TBD)

def load_skills_for_context(client_id: str, task_type: str) -> SkillSet:
    """
    Load appropriate skills for a given client and task.

    Skill precedence:
    1. Client-specific overrides (highest)
    2. Client brand/voice skill
    3. Author-specific writing profile (if applicable)
    4. Core task skill (presentation, document, etc.)
    5. Platform defaults (lowest)
    """
    skills = SkillSet()

    # Load core skill for task type
    skills.add(load_skill(f"core/{task_type}"))

    # Load client brand skill
    if client_has_brand(client_id):
        skills.add(load_skill(f"clients/{client_id}/brand"))

    # Load author-specific writing profile
    if author_profile_requested(client_id, context):
        skills.add(load_skill(f"clients/{client_id}/profiles/{author_id}"))

    # Load client overrides
    if client_has_overrides(client_id, task_type):
        skills.add(load_skill(f"clients/{client_id}/overrides/{task_type}"))

    return skills
```

### Skill Versioning

- Skills versioned via Git commits
- `.skill-registry.json` tracks active versions per client
- Rollback = point to previous commit
- Client approval required for skill updates

```json
{
  "skills": {
    "core/presentation": {
      "version": "1.2.0",
      "commit": "abc123"
    }
  },
  "clients": {
    "acme-corp": {
      "brand": {
        "version": "2.0.0",
        "commit": "def456"
      },
      "active_core_versions": {
        "presentation": "1.2.0"
      }
    }
  }
}
```

---

## 4. Orchestration Options

**Decision pending** — document options for future selection:

### Option A: Claude Code Skill

Platform is a skill that runs inside Claude Code/Cowork.

```
┌─────────────────────────────────────────┐
│           Claude Code / Cowork          │
│  ┌───────────────────────────────────┐  │
│  │     Zivtech Platform Skill        │  │
│  │  ┌─────────────────────────────┐  │  │
│  │  │  Orchestration logic        │  │  │
│  │  │  Skill loading              │  │  │
│  │  │  Tool dispatch              │  │  │
│  │  └─────────────────────────────┘  │  │
│  └───────────────────────────────────┘  │
└─────────────────────────────────────────┘
```

**Pros:**
- Simplest to implement
- Leverages existing Claude Code infrastructure
- No separate deployment

**Cons:**
- Limited to Claude Code/Cowork users
- Harder to expose as MCP server to external clients
- Less control over execution environment

### Option B: Standalone Service

Separate Python service using Claude Agent SDK.

```
┌─────────────────────────────────────────┐
│        Zivtech Platform Service         │
│        (Python + Agent SDK)             │
│  ┌───────────────────────────────────┐  │
│  │  FastAPI / Flask server           │  │
│  │  ┌─────────────────────────────┐  │  │
│  │  │  Agent SDK orchestration    │  │  │
│  │  │  MCP server interface       │  │  │
│  │  │  Monitoring integration     │  │  │
│  │  └─────────────────────────────┘  │  │
│  └───────────────────────────────────┘  │
└─────────────────────────────────────────┘
```

**Pros:**
- Full control over execution
- Can expose MCP interface to any client
- Better for client deployments

**Cons:**
- More infrastructure to manage
- Separate deployment pipeline
- Higher operational overhead

### Option C: Hybrid

Skill for internal use, standalone service for clients.

```
Internal (Zivtech):           External (Clients):
┌─────────────────┐           ┌─────────────────┐
│  Claude Code    │           │ Platform Service│
│  + Platform     │           │ (Agent SDK)     │
│    Skill        │           │                 │
└─────────────────┘           └─────────────────┘
        │                             │
        └──────────┬──────────────────┘
                   │
                   ▼
         ┌─────────────────┐
         │  Shared Skills  │
         │  Repository     │
         └─────────────────┘
```

**Pros:**
- Best of both worlds
- Internal team uses familiar tools
- Clients get controlled access

**Cons:**
- Two codepaths to maintain
- Potential feature drift

### Option D: Oh My Claude Code (OMC) — EVALUATED, NOT ADOPTED (Decision #16)

~~Use [Oh My Claude Code](https://github.com/Yeachan-Heo/oh-my-claudecode) as the orchestration layer for internal use.~~

> **Feb 17, 2026:** After analyzing Boris Cherny's Claude Code design philosophy, OMC was determined to solve the wrong problem. Power users don't need an orchestration framework (Boris runs vanilla Claude Code with workflow discipline). Web portal users can't use a CLI plugin. Replaced by Option E: thin server orchestrator. See Recommendation below.

```
┌─────────────────────────────────────────┐
│           Claude Code + OMC             │
│  ┌───────────────────────────────────┐  │
│  │  OMC Orchestration Layer          │  │
│  │  • 5 execution modes              │  │
│  │  • 32 specialized agents          │  │
│  │  • Smart model routing            │  │
│  │  ┌─────────────────────────────┐  │  │
│  │  │  Zivtech Presentation Skill │  │  │
│  │  └─────────────────────────────┘  │  │
│  └───────────────────────────────────┘  │
└─────────────────────────────────────────┘
```

**OMC Execution Modes:**

| Mode | Description | Use Case |
|------|-------------|----------|
| **Autopilot** | Autonomous execution | Single complex tasks |
| **Ultrapilot** | 3-5x parallel workers | Multi-component work (slides) |
| **Swarm** | Coordinated agents, shared task pool | Large batch processing |
| **Pipeline** | Sequential chains | Extract → Transform → Assemble |
| **Ecomode** | Budget-friendly, 30-50% token savings | Cost-sensitive tasks |

**Pros:**
- Multi-agent orchestration built-in
- Pipeline mode fits presentation workflow naturally
- 30-50% cost savings via smart routing
- 3.3k stars, active community
- Zero learning curve for Claude Code users

**Cons:**
- External dependency (not controlled by Zivtech)
- Designed for dev workflows, not multi-tenant
- Still need custom solution for client deployments
- Less visibility into orchestration internals

**Open Questions:**
- Does OMC support custom skill integration?
- How does state isolation work for multiple projects?
- Maintenance/stability trajectory?

### Recommendation (Updated Feb 17, 2026)

**Option E: Thin server orchestrator + native Claude Code for internal use.** Skip OMC.

```
Phase 3 Architecture:
┌─────────────────────────────────────────────────────────┐
│  Internal (Zivtech CLI users):                          │
│  └─ Native Claude Code + subagents + Plan Mode          │
│     └─ Skills loaded via CLAUDE.md / skill files        │
│                                                         │
│  Web Portal (Zivtech staff + future clients):           │
│  └─ Thin FastAPI orchestrator + Agent SDK               │
│     └─ Authenticate → load skills → inject verification │
│        → call Agent SDK → log → return                  │
└─────────────────────────────────────────────────────────┘
```

**Rationale — informed by Boris Cherny (Claude Code creator) insights:**

1. **OMC solves the wrong problem.** Boris runs 10-15 raw Claude Code sessions with no framework. His "orchestration" is workflow discipline: Plan Mode on every task, CLAUDE.md for institutional memory, native subagents for parallel work. Power users don't need a framework layer.

2. **OMC can't serve the web portal.** It's a local CLI plugin. The Phase 3 web portal (for Zivtech Windows users and future clients) needs server-side orchestration regardless. Building two orchestration paths (OMC + server) creates maintenance burden for no gain.

3. **Scaffolding gets subsumed.** Boris's team deletes product code with every model upgrade. Complex orchestration logic has an expiration date. Domain knowledge (skills, client profiles, verification) does not. Invest there instead.

4. **The orchestrator should be a thin router, not a smart engine.**

```
What the orchestrator DOES:
  1. Authenticate user, resolve client context
  2. Load skills (client brand + author profile + task skill)
  3. Inject verification hook (content fidelity check)
  4. Call Agent SDK with tools + skills as context
  5. Log everything to monitoring layer
  6. Return result

What the orchestrator DOES NOT do:
  - Multi-step planning logic (model does this)
  - Complex retry/fallback chains (model handles retries)
  - Output post-processing or reformatting (model + skills)
  - Template filling or structured generation (model + skills)
```

**Previous recommendation (Jan 29):** ~~Evaluate Option D (OMC) for Phase 3.~~ Superseded by analysis of Boris Cherny's design philosophy and evaluation of where OMC adds vs. doesn't add value. See Decision #16.

---

## 5. Monitoring Architecture

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                         MONITORING INFRASTRUCTURE                            │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                              │
│  ┌─────────────────────────────────────────────────────────────────────────┐│
│  │                    DATA COLLECTION                                       ││
│  │                                                                          ││
│  │   Every request captures:                                                ││
│  │   • Client ID, user ID, session ID                                       ││
│  │   • Task type, skill(s) loaded                                           ││
│  │   • Input tokens, output tokens                                          ││
│  │   • Latency, tool calls                                                  ││
│  │   • Success/failure, error details                                       ││
│  │   • Content hash (for fidelity tracking)                                 ││
│  └─────────────────────────────────────────────────────────────────────────┘│
│                                      │                                       │
│                                      ▼                                       │
│  ┌─────────────────────────────────────────────────────────────────────────┐│
│  │                    ANALYSIS LAYERS                                       ││
│  │                                                                          ││
│  │   Layer 1: Usage Analytics                                               ││
│  │   • Requests per client/user                                             ││
│  │   • Token consumption trends                                             ││
│  │   • Cost attribution                                                     ││
│  │                                                                          ││
│  │   Layer 2: Content Fidelity (Two-Tier Verification)                       ││
│  │                                                                          ││
│  │   TIER 1 — Inline verification loop (in-context, per-generation):       ││
│  │   • Content marker presence check (~ms)                                  ││
│  │   • Stylometric distance from author profile (~100ms)                   ││
│  │   • On mismatch: feed details back to model, regenerate (max 3x)       ││
│  │   • Latency budget: ~2-5s per verification pass                         ││
│  │   • This is the quality gate — model self-corrects before delivery     ││
│  │                                                                          ││
│  │   TIER 2 — Deep async analysis (monitoring layer, post-delivery):       ││
│  │   • Full Burrows' Delta stylometric analysis (heavier compute)          ││
│  │   • Cross-document consistency over time                                 ││
│  │   • Voice drift detection across sessions                               ││
│  │   • Correction aggregation → skill update recommendations              ││
│  │   • Monthly quality reports per client                                   ││
│  │                                                                          ││
│  │   Also:                                                                  ││
│  │   • Output validation results                                            ││
│  │   • Brand compliance scoring                                             ││
│  │   • Correction frequency                                                 ││
│  │                                                                          ││
│  │   Layer 3: Guardrail Monitoring                                          ││
│  │   • Restriction hits                                                     ││
│  │   • Permission escalations                                               ││
│  │   • Boundary friction signals                                            ││
│  │                                                                          ││
│  │   Layer 4: Proactive Insights                                            ││
│  │   • Skill effectiveness scoring                                          ││
│  │   • Anomaly detection                                                    ││
│  │   • Improvement recommendations                                          ││
│  └─────────────────────────────────────────────────────────────────────────┘│
│                                      │                                       │
│                                      ▼                                       │
│  ┌─────────────────────────────────────────────────────────────────────────┐│
│  │                    OUTPUTS                                               ││
│  │                                                                          ││
│  │   • Dashboards (Langfuse / custom)                                       ││
│  │   • Alerts (Slack, email)                                                ││
│  │   • Reports (monthly usage, billing)                                     ││
│  │   • Feedback loop to skills (correction aggregation)                     ││
│  └─────────────────────────────────────────────────────────────────────────┘│
│                                                                              │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## 6. Presentation Toolkit Implementation Plan (Phase 4)

### Goal

Build the **Presentation Toolkit** as a tool within the platform, structured to fit the overall architecture. This is now Phase 4 — after the platform framework is in place.

### Architecture Fit

```
Phase 4 Deliverables:
┌─────────────────────────────────────────────────────────────────────────────┐
│                                                                              │
│  Skills Layer:                                                               │
│  └── core/presentation/          ← Build this skill                         │
│      ├── SKILL.md                                                           │
│      ├── templates/                                                         │
│      ├── validators/                                                        │
│      └── lib/                                                               │
│          ├── extract.py          ← Content extraction from PPTX             │
│          ├── brand.py            ← Brand asset processing                   │
│          ├── transform.py        ← Content → branded structure              │
│          └── assemble.py         ← Structure → output PPTX                  │
│                                                                              │
│  Tools Layer:                                                                │
│  └── Presentation Toolkit        ← Exposed as skill capability              │
│      • rebrand_deck()                                                       │
│      • (future: generate_deck())                                            │
│                                                                              │
│  Monitoring (lightweight):                                                   │
│  └── Basic logging + validation  ← Foundation for full monitoring           │
│                                                                              │
└─────────────────────────────────────────────────────────────────────────────┘
```

### Implementation Tasks

#### Task 1: Repository Setup (1 day)

- [ ] Create `joyus-ai-skills` repository
- [ ] Set up folder structure (core/, clients/)
- [ ] Create `.skill-registry.json`
- [ ] Set up basic CI (linting, tests)

#### Task 2: Content Extraction Pipeline (3-4 days)

- [ ] Parse PPTX structure (python-pptx)
- [ ] Extract text content (titles, body, bullets)
- [ ] Extract images and graphics
- [ ] Extract tables and charts
- [ ] Build structured content representation
- [ ] Handle edge cases (complex layouts, embedded objects)

**Output:** `lib/extract.py` — Given a PPTX, returns structured content JSON

#### Task 3: Brand Asset Processing (2-3 days)

- [ ] Parse PPT templates (master slides, layouts)
- [ ] Extract color schemes
- [ ] Extract font definitions
- [ ] Process logo files
- [ ] Handle brand guideline PDFs (with Claude assistance)
- [ ] Normalize to standard brand schema

**Output:** `lib/brand.py` — Given brand assets, returns normalized brand config

#### Task 4: Content Transformation (3-4 days)

- [ ] Map extracted content to slide types
- [ ] Apply brand colors/fonts to content
- [ ] Determine layout placement
- [ ] Handle content overflow/splitting
- [ ] Preserve semantic structure

**Output:** `lib/transform.py` — Given content + brand, returns branded slide structures

#### Task 5: PPTX Assembly (2-3 days)

- [ ] Build slides using python-pptx
- [ ] Apply master slides from template
- [ ] Position elements correctly
- [ ] Handle images, tables, charts
- [ ] Validate output file integrity

**Output:** `lib/assemble.py` — Given slide structures, produces PPTX file

#### Task 6: Validation & Quality Checks (2 days)

- [ ] Content completeness verification
- [ ] Brand compliance checking
- [ ] File integrity validation
- [ ] Basic layout heuristics

**Output:** `validators/content-check.py`

#### Task 7: Skill Packaging (1-2 days)

- [ ] Write SKILL.md with instructions and constraints
- [ ] Create good/bad examples
- [ ] Integration with Claude Code/Cowork
- [ ] Usage documentation

**Output:** Complete `core/presentation/` skill folder

#### Task 8: Testing & Iteration (3-4 days)

- [ ] Test with 5+ real client decks
- [ ] Identify and fix quality issues
- [ ] Iterate on layout logic
- [ ] Document known limitations

### Toolkit Timeline (when Phase 4 begins)

| Week | Tasks | Deliverable |
|------|-------|-------------|
| 1 | Repo setup, extraction pipeline | Content extraction working |
| 2 | Brand processing, transformation | Brand → content mapping working |
| 3 | Assembly, validation | End-to-end pipeline working |
| 4 | Skill packaging, testing | Deployable skill |

**Total: ~4 weeks**

---

## 7. Phase 3-4 Preview

After Phases 1-2 (Asset Sharing + MCP Deployment):

**Phase 3: Platform Framework**
- **Web App** — Next.js + FastAPI, Google SSO, chat UI
- **Orchestration layer** — Thin server orchestrator (FastAPI + Agent SDK): authenticate → load skills → inject verification → call Agent SDK → log. Not a smart engine — the model does the thinking. (Decision #16)
- **MCP Gateway** — Expose platform as MCP server; include browser abstraction layer (high-level navigate/click/extract actions over raw Playwright, per-user browser contexts)
- **Client Profile Building** — Automated pipeline: ingest client corpus → extract stylometric features + content markers → generate structured writing profiles → output as platform-consumable skill files. Generalizes client PoC methodology (94.6%→97.9% accuracy) into multi-domain service
- **Author Verification / Content Fidelity** — Post-generation validator: run attribution model on AI output, compare intended vs. detected voice, flag mismatches before delivery, feed corrections back into skill updates (Constitution §2.5)
- **Client onboarding** — Workflow for creating client skills (including profile intake)
- **Code execution sandbox** — Container-based (Docker/gVisor) multi-language execution with per-user isolation, resource limits, network restrictions. Prerequisite for Phase 4 Analysis Tools and Spec Kitty as Service
- **Job management** — Background task queue in orchestration layer with status tracking, logs, cancellation, and timeout. Supports long-running operations (data processing, test suites, dev servers)
- **Monitoring** — Full monitoring infrastructure (note: design for potential standalone offering — monitoring layer may have value as an independent service for clients managing their own AI deployments)

**Phase 4: Additional Tools**
- **Presentation Toolkit** — Rebrand decks, generate branded slides from content
- **Document Generator** — Reports, proposals, memos (DOCX, PDF)
- **Analysis Tools** — Financial modeling, gap analysis, roadmaps
  - Includes `research_topic` tool: search (via Exa MCP) → browse → extract → summarize chain
  - Leverages Phase 3 code execution sandbox for data processing and scripting
- **Author Attribution Service** — Standalone client-facing tool for document authorship analysis
  - Web app (FastAPI + React) with real-time attribution, expert question routing, batch processing
  - Generalizes client PoC webapp (`../poc/author-identification-research/webapp/`) into multi-client platform tool
  - Exposed as MCP tools: `attribute_document`, `route_to_expert`
- **Spec Kitty as Service** — Spec-driven development for clients who can't run Claude Code locally
  - Constitution → Specification → Plan → Research → Tasks workflow
  - Project initialization and phase management
  - Enables structured software development without local tooling
- **Visual Regression Testing Service** — On-demand a11y and visual regression testing for client PRs
  - Builds on existing `a11y-test` Claude Code skill (Playwright + BackstopJS)
  - Branch-based baseline management: capture baselines for a target branch, test PR groups against it
  - Baselines are locked to their branch — no updates until the underlying branch changes
  - When the baseline branch changes, prompt user: update baselines or keep existing?
  - Supports testing individual PRs or grouped PR sets against the same baseline
  - Outputs: Playwright HTML reports, BackstopJS side-by-side visual diffs
  - Client site testing (Drupal, web apps) — not platform self-testing

---

## 8. Decision Log

| # | Decision | Options | Choice | Rationale | Date |
|---|----------|---------|--------|-----------|------|
| 1 | Skills storage | Git / DB / Files | **Git repo** | Version control, easy rollback, familiar workflow | Jan 29 |
| 2 | Initial isolation | Skill / Container / Full | **Skill-based** | Start simple, evolve as needed | Jan 29 |
| 3 | MCP role | Server / Client / Both | **Both** | Platform exposes interface AND consumes services | Jan 29 |
| 4 | ~~Orchestration (Phase 3)~~ | ~~Skill / OMC / Service / Hybrid~~ | ~~Evaluate OMC~~ | ~~Pipeline mode + cost savings worth testing; fall back to plain skill~~ | ~~Jan 29~~ | **Superseded by Decision #16 (Feb 17)** |
| 5 | Orchestration (Phase 4+) | Thin server / Service / Hybrid | **Thin server + Agent SDK** | Same thin orchestrator scales to client deployments; add container isolation as needed | Jan 29 (updated Feb 17) |
| 6 | MCP server hosting | Platform.sh / AWS / GCP / VPS / Railway | **AWS EC2 + Docker Compose** | Mature MCP ecosystem (45+ awslabs servers); Claude can manage infra; ~$15-35/mo | Feb 11 |
| 7 | Static PoC hosting | GitHub Pages / Cloudflare Pages / Netlify / S3 | **GitHub Pages + StatiCrypt** | Free, git-native, directory-based; AES-256 password protection | Feb 11 |
| 8 | Drupal PoC hosting | Platform.sh / AWS / Self-host | **Existing tools (separate)** | Pantheon Multidev / Tugboat / Probo.ci — already solved, no new infra | Feb 11 |
| 9 | PoC password protection | StatiCrypt / HTTP basic / custom auth | **StatiCrypt (near-term)** | AES-256 client-side; directory structure carries forward to Drupal portal | Feb 11 |
| 10 | Session tracking | Entire CLI / custom / none | **Entire CLI (pilot)** | Git-native, MIT, no external DB; telemetry off, manual-commit; 2-week eval | Feb 11 |
| 11 | Phase ordering | Toolkit first / Sharing first / Infra first | **Sharing → Deploy → Platform → Tools** | Everything we build needs somewhere to go; MCP server already built | Feb 11 |
| 12 | Git hosting | GitHub (SaaS) / GitLab (self-hosted) / Gitea (self-hosted) | **Under evaluation** | Need better disk/artifact management at scale; LFS bandwidth limits on GitHub; self-hosted gives S3 offload and custom runners | Feb 12 |
| 13 | Manus-MCP pattern | Emulate manus-mcp / Extract capabilities / Skip | **Extract capabilities, better architecture** | Adopt code sandbox, job mgmt, browser abstraction, research tool — but with container isolation, per-user contexts, proper search API instead of manus-mcp's weak directory sandbox and Google scraping | Feb 13 |
| 14 | Client Profile Building | Manual skill creation / Automated pipeline / Hybrid | **Automated pipeline (proven)** | Client PoC validates methodology: corpus analysis → content markers + stylometrics → structured profiles. 94.6% accuracy (4 authors), 97.9% (9 authors). Generalizable to arbitrary client domains. Pipeline outputs platform-consumable skill files. | Feb 15 |
| 15 | Author Verification placement | Phase 4 tool only / Phase 3 monitoring only / Both | **Both: Phase 3 monitor + Phase 4 tool** | Internal use as Content Fidelity check (Phase 3 Monitoring Layer 2) + external use as standalone Attribution Service (Phase 4). Same core engine, different interfaces. | Feb 15 |
| 16 | Orchestration (Phase 3) — revised | OMC / Thin server + native CC / Hybrid | **Thin server + native Claude Code** | Boris Cherny analysis: OMC solves wrong problem (power users don't need framework; web portal can't use CLI plugin); scaffolding gets subsumed by model upgrades; invest in skills + verification instead. Thin FastAPI + Agent SDK for portal, native Claude Code for internal CLI users. Supersedes Decision #4. | Feb 17 |
| 17 | Attribution verification timing | Inline only / Async only / Two-tier | **Two-tier (inline + async)** | Boris Cherny's #1 insight: verification loops multiply quality 2-3x, but only if the model sees the failure and self-corrects. Tier 1: fast inline checks (~2-5s) as quality gate before delivery. Tier 2: deep async analysis for monitoring, drift detection, and skill improvement. | Feb 17 |
| 18 | Layer investment principle | Equal / Model-dependent | **Thick domain, thin orchestration** | Boris Cherny's "scaffolding gets subsumed" principle: orchestration code gets deleted with model upgrades, but domain knowledge (skills, profiles, verification) is durable. Build skills and verification thick; keep orchestration as a thin router. | Feb 17 |
| 19 | Profile engine timing | Phase 3 / Phase 2.5 standalone / Phase 4 | **Phase 2.5 standalone library** | Profile engine + content fidelity are independent of platform infrastructure (no web portal, MCP gateway, or containers needed). Building standalone means: immediate client PoC use, second-domain validation before platform exists, Phase 3 imports a tested library. This is the "thick domain" investment per Decision #18. | Feb 17 |
| 20 | Auth integration model | Drupal module / Auth passthrough / JWT token exchange / Platform-agnostic interface | **Platform-agnostic auth provider interface (JWT first impl)** | Platform defines `resolve_access_level(token) → AccessContext` interface. First implementation: Drupal issues scoped JWT on login, platform validates stateless. Interface supports any IdP (OAuth2, SAML, API keys). Drupal is the primary deployment target but not the only one — hospital, university, museum deployments may use different auth backends. Avoids coupling to any single CMS or IdP. | Feb 19 |
| 21 | Multi-audience voice model | RegisterShift (parameter deltas) / VoiceContext (section overrides) / Separate profiles per voice | **VoiceContext with 3-layer opt-in** | RegisterShift insufficient — client PoC voices differ across all 12 profile sections, not just tone. VoiceContext provides per-section overrides with backwards-compatible layering: Layer 0 (single voice, no change), Layer 1 (multi-audience), Layer 2 (restricted voices with access control). Per-voice fidelity tiers. See profile-engine-spec §3.1. | Feb 19 |
| 22 | Content infrastructure placement | Extend 005 / New feature 006 / Defer | **New feature 006 (Content Infrastructure)** | Knowledge infrastructure gap too large for 005 amendment. 006 covers: corpus connectors, search abstraction, content state model, access mapping, MCP search tool, subscription gating, generate-then-verify chat, bot mediation API. Platform-level feature, not client-specific. | Feb 19 |

---

## 9. Open Questions

| Question | Owner | Due | Status |
|----------|-------|-----|--------|
| GitHub Pages repo structure for PoCs | Alex + Claude | Phase 1 | **Resolved** — `zivtech/zivtech-demos` with `projects/<name>/` convention |
| StatiCrypt CI pipeline design | Claude | Phase 1 | **Resolved** — GitHub Actions workflow in `zivtech-demos/.github/workflows/deploy.yml` |
| AWS EC2 instance sizing for MCP server | Alex + Claude | Phase 2 | Open |
| Coolify vs raw Docker Compose for management | Alex + Claude | After Phase 2 + 1 month | Open |
| Entire CLI pilot evaluation (2-week review) | Alex | Phase 1 + 2 weeks | Open |
| Git hosting: GitHub vs self-hosted (GitLab/Gitea) | Alex | Phase 2-3 | Open — disk management, artifact storage, LFS limits at scale |
| Drupal client portal scope and timeline | Alex | Phase 3+ | Open — role-based access, CMS content, migration from StatiCrypt |
| Diagnose current toolkit issues | Alex + Claude | Before Phase 4 | Open |
| Content structure schema design | Claude | Phase 4 | Open |
| Layout decision heuristics | Claude | Phase 4 | Open |
| First client pilot | Alex | Phase 3 | Open |
| ~~OMC evaluation~~ | Alex | Phase 3 | **Resolved (Feb 17)** — Skip OMC. Thin server orchestrator + native Claude Code. See Decision #16. |
| ├─ ~~Does OMC support custom skills?~~ | | | Moot — not adopting OMC |
| ├─ ~~State isolation for multi-project?~~ | | | Moot — not adopting OMC |
| └─ ~~Stability/maintenance trajectory?~~ | | | Moot — not adopting OMC |
| Skill testing/validation methodology | Alex + Claude | Phase 3 | Open — how to measure whether a skill is effective; detect unanticipated side effects from restrictions; acceptance criteria for skill quality |
| Feedback loop mechanics | Alex + Claude | Phase 3 | Open — how user corrections flow into skill updates; who approves changes; update cadence; Constitution S2.5 declares first-class but mechanism unspecified |
| Client onboarding workflow | Alex | Phase 3 | Open — what goes into a single-entry-point package; integration with existing client tools; skill creation process; brand asset intake |
| **Client Profile Building pipeline** | Alex + Claude | Phase 3 | Open |
| ├─ Profile schema: what fields are required vs. optional? | | | Client PoC schema covers legal advocacy — need to validate for other domains (marketing, technical, corporate) |
| ├─ Minimum corpus size for reliable profiles? | | | Client PoC used 7-9 docs per author; what's the floor for new clients? |
| ├─ Self-service onboarding vs. Zivtech-assisted profile creation? | | | Cost/quality tradeoff; manual curation produced 94.6%+ accuracy |
| └─ Profile update cadence: how often do profiles need refreshing? | | | Authors evolve; need versioning + staleness detection |
| **Author Verification / Content Fidelity** | Alex + Claude | Phase 3 | Open |
| ├─ Confidence threshold: what score triggers a mismatch flag? | | | Client PoC used content markers as primary discriminator; need calibration per client |
| ├─ Feedback loop mechanics: how do flagged mismatches flow into skill updates? | | | Constitution §2.5 declares first-class but mechanism unspecified |
| └─ ~~Performance: can attribution run in-line or must it be async post-generation?~~ | | | **Resolved (Feb 17)** — Both. Two-tier: fast inline checks (~2-5s) as quality gate + deep async analysis for monitoring. See Decision #17. |
| **Code execution sandbox** | Alex + Claude | Phase 3 | Open — container tech (Docker vs gVisor vs Firecracker); resource limit defaults; supported languages; network policy |
| **Job/task management** | Alex + Claude | Phase 3 | Open — queue implementation (Redis, PostgreSQL, in-memory); status API design; log streaming; cancellation semantics |
| **API account & billing model** | Alex + Claude | Phase 3 | Open — Anthropic API uses Organizations → Workspaces → API keys (separate from Claude Team/Pro subscriptions). Key decisions: |
| ├─ Zivtech-managed (one org, workspace per client) vs BYOK (client brings own API key)? | | | Zivtech-managed is simpler; BYOK gives clients billing control but adds complexity |
| ├─ Per-workspace spend limits sufficient, or need per-user/per-task limits? | | | Workspaces have built-in spend caps; finer granularity requires platform-level tracking |
| ├─ Admin API integration for programmatic workspace/key management? | | | Admin API (`sk-ant-admin...`) can create workspaces, manage keys, set limits |
| └─ Usage & Cost API integration for billing attribution? | | | Anthropic provides token consumption breakdowns by model, workspace, service tier |
| **Visual regression testing service** | Alex + Claude | Phase 4 | Open |
| ├─ Baseline storage: Git LFS, S3, or local? | | | |
| ├─ PR detection: GitHub webhooks, manual trigger, or CI integration? | | | |
| ├─ Branch change detection: how to know when to prompt for baseline update? | | | |
| └─ Execution environment: platform EC2, client infra, or ephemeral containers? | | | |
| **Content Infrastructure (Feature 006)** | Alex + Claude | Phase 2.7 | Open |
| ├─ Search backend: Solr, Elasticsearch, Drupal Search API, or abstraction layer? | | | Recommendation: platform defines search interface, deployment wires backend |
| ├─ Content ingestion: what source types must be supported at launch? | | | XML treatises, Drupal CMS, web scraping — listservs and file shares deferred |
| ├─ Content state model: draft → staged → published → superseded? | | | Needs validation against the client's existing XML version control |
| ├─ Bot mediation API: llms.txt standard or custom endpoint? | | | Research llms.txt adoption before deciding |
| └─ Generate-then-verify: separate from standard RAG or unified interface? | | | Recommendation: unified interface with retrieval_strategy parameter |

---

*Plan created: January 29, 2026*
*Updated: February 19, 2026 — Added Phase 2.7 (Content Infrastructure, Feature 006) as new phase between Profile Engine and Platform Framework (Decision #22). Added platform-agnostic auth provider interface with JWT first implementation (Decision #20). Added VoiceContext 3-layer voice architecture (Decision #21). Added Content Infrastructure open questions. Based on architecture research report (5 parallel agents + cross-validation, 22 systems mapped).*
*Updated: February 17, 2026 — Added Phase 2.5 (Profile Engine + Content Fidelity) as priority standalone library (Decision #19). Boris Cherny (Claude Code creator) analysis: replaced OMC with thin server orchestrator + native Claude Code (Decision #16), added two-tier content fidelity verification (Decision #17), added "thick domain, thin orchestration" architectural principle (Decision #18), resolved attribution timing and OMC open questions. Prior: Feb 15 — Client Profile Building pipeline, author verification, Attribution Service, decisions #14-15. Feb 13 — Manus-MCP evaluation: code execution sandbox, job management, browser abstraction, research tool, visual regression testing service*
*For: Zivtech AI Agent Platform*
