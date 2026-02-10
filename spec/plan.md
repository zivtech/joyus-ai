# Zivtech AI Agent Platform — Implementation Plan

**Project:** Zivtech AI Agent Platform
**Date:** January 29, 2026
**Status:** Phase 0 In Progress

---

## 0. Immediate Priority: Internal Staff Web App

### Context
A Zivtech staff member on Windows cannot access Claude Cowork (Mac/Linux only). We need a web-based alternative that provides similar agentic capabilities.

### Objective
Build a self-hosted web application that gives internal staff access to Claude-powered workflows with integrations to their existing tools.

### User Flow
```
┌─────────────────────────────────────────────────────────────────┐
│                    ZIVTECH INTERNAL AI PORTAL                    │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  ┌──────────────────────────────────────────────────────────┐   │
│  │                  GOOGLE SSO LOGIN                         │   │
│  │                                                           │   │
│  │   [Sign in with Google]  (restricted to @zivtech.com)    │   │
│  └──────────────────────────────────────────────────────────┘   │
│                              │                                   │
│                              ▼                                   │
│  ┌──────────────────────────────────────────────────────────┐   │
│  │              CONNECTED ACCOUNTS SETUP                     │   │
│  │                                                           │   │
│  │   ☑ Google (Gmail, Docs, Drive)   ☐ Atlassian (Jira)    │   │
│  │   ☐ Slack                          ☐ GitHub              │   │
│  │                                                           │   │
│  │   [Connect All]  [Skip for Now]                          │   │
│  └──────────────────────────────────────────────────────────┘   │
│                              │                                   │
│                              ▼                                   │
│  ┌──────────────────────────────────────────────────────────┐   │
│  │                   CHAT INTERFACE                          │   │
│  │                                                           │   │
│  │   ┌────────────────────────────────────────────────────┐ │   │
│  │   │ "Can you check my Jira tickets and summarize what  │ │   │
│  │   │  I should focus on today?"                         │ │   │
│  │   └────────────────────────────────────────────────────┘ │   │
│  │                                                           │   │
│  │   ┌────────────────────────────────────────────────────┐ │   │
│  │   │ [Claude response with Jira context]                │ │   │
│  │   │                                                     │ │   │
│  │   │ Based on your Jira board, here are your priorities:│ │   │
│  │   │ 1. PROJ-123: Fix login bug (Due today)             │ │   │
│  │   │ 2. PROJ-456: Review PR from Alex (Blocking)        │ │   │
│  │   │ ...                                                 │ │   │
│  │   └────────────────────────────────────────────────────┘ │   │
│  │                                                           │   │
│  │   [Type a message...]                           [Send]   │   │
│  └──────────────────────────────────────────────────────────┘   │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

### Technical Architecture
```
┌─────────────────────────────────────────────────────────────────┐
│                     ZIVTECH AI PORTAL                            │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  ┌────────────────────────────────────────────────────────────┐ │
│  │                    WEB FRONTEND                             │ │
│  │                                                              │ │
│  │   React/Next.js   │   Chat UI   │   OAuth Flows            │ │
│  └────────────────────────────────────────────────────────────┘ │
│                              │                                   │
│                              ▼                                   │
│  ┌────────────────────────────────────────────────────────────┐ │
│  │                    API BACKEND                              │ │
│  │                                                              │ │
│  │   FastAPI/Node    │   Session Mgmt   │   Auth Middleware   │ │
│  └────────────────────────────────────────────────────────────┘ │
│                              │                                   │
│           ┌──────────────────┼──────────────────┐               │
│           ▼                  ▼                  ▼               │
│  ┌─────────────┐    ┌─────────────┐    ┌─────────────┐         │
│  │   Google    │    │   Claude    │    │    MCP      │         │
│  │    OAuth    │    │     API     │    │   Servers   │         │
│  │             │    │             │    │             │         │
│  │ • Gmail     │    │ Messages    │    │ • Jira      │         │
│  │ • Drive     │    │ w/ Tools    │    │ • Slack     │         │
│  │ • Docs      │    │             │    │ • GitHub    │         │
│  └─────────────┘    └─────────────┘    └─────────────┘         │
│                                                                  │
│  ┌────────────────────────────────────────────────────────────┐ │
│  │                    TOKEN STORAGE                            │ │
│  │                                                              │ │
│  │   PostgreSQL (encrypted)   │   Per-user OAuth tokens       │ │
│  └────────────────────────────────────────────────────────────┘ │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

### Required Integrations

| Service | Auth Type | Capabilities Needed |
|---------|-----------|---------------------|
| **Google** | OAuth 2.0 | SSO, Gmail read/send, Drive files, Docs read/edit |
| **Atlassian** | OAuth 2.0 | Jira issues (read/create/update), search |
| **Slack** | OAuth 2.0 | Read messages, post messages, search history |
| **GitHub** | OAuth 2.0 | Repos, PRs, issues, code search |

### Implementation Phases

#### Phase 0a: Core Infrastructure (Week 1)
- [ ] Set up project with Next.js + FastAPI
- [ ] Implement Google OAuth for SSO
- [ ] Basic chat UI with Claude API integration
- [ ] Deploy to Zivtech server

#### Phase 0b: MCP Integrations (Week 2-3)
- [ ] Add Jira MCP server connection
- [ ] Add Slack MCP server connection
- [ ] Add Gmail MCP server connection
- [ ] Add GitHub MCP server connection
- [ ] Per-user token storage with encryption

#### Phase 0c: Polish & Security (Week 4)
- [ ] Domain restriction (@zivtech.com only)
- [ ] Session management
- [ ] Error handling and retry logic
- [ ] Usage logging for cost tracking

### Security Considerations
1. **Google SSO only**: Restrict to @zivtech.com domain
2. **Token encryption**: All OAuth tokens encrypted at rest
3. **HTTPS only**: Server behind SSL
4. **Audit logging**: Track who accessed what
5. **No code execution**: Unlike Cowork, no sandboxed compute (Phase 1+)

### Success Criteria
- Staff member can sign in with Google
- Can ask questions that pull context from Jira, Slack, Gmail, GitHub
- Claude provides helpful responses using the connected tools
- No manual API key management required by user

---

## 1. Platform Architecture Overview

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
│  │   │ ← PHASE 1   │  │   Phase 3   │  │   Phase 3   │  │   Phase 3   │  │ │
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

**Phase 1-2: Skill-based isolation**
- Same infrastructure for all users
- Client differentiation via skill loading
- Simpler, faster to implement

**Phase 3+: Container-based isolation (as needed)**
- Separate containers per client
- Stronger security boundaries
- Higher operational overhead

```
Phase 1-2: Shared Infrastructure
┌─────────────────────────────────────────┐
│           Platform Instance             │
│  ┌─────────┐ ┌─────────┐ ┌─────────┐   │
│  │Zivtech  │ │Client A │ │Client B │   │
│  │ Skills  │ │ Skills  │ │ Skills  │   │
│  └─────────┘ └─────────┘ └─────────┘   │
└─────────────────────────────────────────┘

Phase 3+: Container Isolation (if needed)
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
- `spec_kitty` — Spec-driven development workflow (for clients who can't run locally)

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
jawn-ai-skills/                       (Git repository)
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
    │   └── overrides/                (client-specific tool config)
    │
    └── beta-inc/
        └── ...
```

### Skill Loading Pattern

```python
# Conceptual skill loading (actual implementation TBD)

def load_skills_for_context(client_id: str, task_type: str) -> SkillSet:
    """
    Load appropriate skills for a given client and task.

    Skill precedence:
    1. Client-specific overrides (highest)
    2. Client brand/voice skill
    3. Core task skill (presentation, document, etc.)
    4. Platform defaults (lowest)
    """
    skills = SkillSet()

    # Load core skill for task type
    skills.add(load_skill(f"core/{task_type}"))

    # Load client brand skill
    if client_has_brand(client_id):
        skills.add(load_skill(f"clients/{client_id}/brand"))

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

### Option D: Oh My Claude Code (OMC)

Use [Oh My Claude Code](https://github.com/Yeachan-Heo/oh-my-claudecode) as the orchestration layer for internal use.

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

### Recommendation

**Evaluate Option D (OMC) for Phase 1**, with Option C (Hybrid) as the Phase 2+ path.

```
Phase 1 Decision Tree:
┌─────────────────────────────────────────────────────────┐
│  Try OMC for internal presentation toolkit              │
│                                                         │
│  ├─ If OMC works well:                                  │
│  │   └─ Use OMC for internal, custom service for clients│
│  │                                                      │
│  └─ If OMC doesn't fit:                                 │
│      └─ Fall back to Option A (plain skill)            │
└─────────────────────────────────────────────────────────┘
```

Rationale: OMC's Pipeline mode and cost optimization align with our needs. Worth experimenting before building custom orchestration. Client deployments will still need standalone service regardless.

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
│  │   Layer 2: Content Fidelity                                              ││
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

## 6. Phase 1 Implementation Plan

### Goal

Build the **Presentation Toolkit** as the first tool in the platform, structured to fit the overall architecture.

### Architecture Fit

```
Phase 1 Deliverables:
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

- [ ] Create `jawn-ai-skills` repository
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

### Phase 1 Timeline

| Week | Tasks | Deliverable |
|------|-------|-------------|
| 1 | Repo setup, extraction pipeline | Content extraction working |
| 2 | Brand processing, transformation | Brand → content mapping working |
| 3 | Assembly, validation | End-to-end pipeline working |
| 4 | Skill packaging, testing | Deployable skill |

**Total: ~4 weeks**

---

## 7. Phase 2-3 Preview

After Phase 1, build the platform framework:

**Phase 2: Platform Framework**
- **Orchestration layer** — Decide on skill vs service, implement
- **MCP Gateway** — Expose platform as MCP server
- **Client onboarding** — Workflow for creating client skills
- **Monitoring** — Full monitoring infrastructure

**Phase 3: Additional Tools**
- **Document Generator** — Reports, proposals, memos (DOCX, PDF)
- **Analysis Tools** — Financial modeling, gap analysis, roadmaps
- **Spec Kitty as Service** — Spec-driven development for clients who can't run Claude Code locally
  - Constitution → Specification → Plan → Research → Tasks workflow
  - Project initialization and phase management
  - Enables structured software development without local tooling

---

## 8. Decision Log

| Decision | Options | Choice | Rationale |
|----------|---------|--------|-----------|
| Skills storage | Git / DB / Files | **Git repo** | Version control, easy rollback, familiar workflow |
| Initial isolation | Skill / Container / Full | **Skill-based** | Start simple, evolve as needed |
| MCP role | Server / Client / Both | **Both** | Platform exposes interface AND consumes services |
| Orchestration (Phase 1) | Skill / OMC / Service / Hybrid | **Evaluate OMC** | Pipeline mode + cost savings worth testing; fall back to plain skill if needed |
| Orchestration (Phase 2+) | OMC / Service / Hybrid | **TBD** | Depends on Phase 1 learnings + client requirements |

---

## 9. Open Questions

| Question | Owner | Due |
|----------|-------|-----|
| Diagnose current toolkit issues | Alex + Claude | Before Task 2 |
| Content structure schema design | Claude | Task 2 |
| Layout decision heuristics | Claude | Task 4 |
| First client pilot | Alex | Phase 2 |
| **OMC evaluation** | Alex | Phase 1 Week 1 |
| ├─ Does OMC support custom skills? | | |
| ├─ State isolation for multi-project? | | |
| └─ Stability/maintenance trajectory? | | |

---

*Plan created: January 29, 2026*
*For: Zivtech AI Agent Platform*
