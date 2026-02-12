# Zivtech AI Agent Platform — Project Plan

**Version:** 2.0
**Date:** January 29, 2026
**Status:** Phase 1 Active (Asset Sharing Pipeline)
**Notion:** [Crazy Ideas & Research](https://www.notion.so/2f798ac3bc5681f99793e84bf1f55c3a)
**Research:** [Technical Research Report](research/jawn-ai-research.md)

---

## Executive Summary

Build a **multi-tenant AI agent platform** for Zivtech consulting that provides:

- **Varied business tasks:** Financial planning, marketing campaigns, support, analysis, presentations
- **Client-specific mediation:** Skills/styles that constrain and guide AI outputs per customer
- **Monitoring & governance:** Usage tracking, content fidelity checks, guardrails
- **Flexible deployment:** Full access internally, sandboxed for clients

**Starting Point:** The asset sharing pipeline — a foundational layer so everything we build has somewhere to go — followed by deploying the existing MCP server, then building the platform framework.

**Development Framework:** Spec Kitty for spec-driven development with structured phases.

---

## Scope Clarification

### What This Platform Does

| Capability | Internal (Zivtech) | Client Deployments |
|------------|-------------------|-------------------|
| Access Level | Full (Claude Code-like) | Sandboxed environments |
| Skills | Zivtech consulting library | Customer-specific mediation |
| Monitoring | Usage analytics | Content fidelity, guardrails |
| Tasks | All business operations | Same, but constrained |

### Tools Within the Platform

1. **Asset Sharing Pipeline** (Phase 1 — ACTIVE)
2. Presentation Generator (Phase 4)
3. Document Generator (reports, proposals — Phase 4)
4. Analysis Tools (financial, gap analysis, roadmaps — Phase 4)
5. Research Tools (web, doc analysis — Phase 4)
6. Support Tools (client comms, FAQs — Phase 4)

---

## Background Research

### Manus Architecture (Corrected)

**Key Finding:** Manus uses **HTML/CSS for slide structure**, not AI-generated images for entire slides.

- Slides are built with HTML/CSS (viewable in "Code" tab)
- Gemini 3 Pro Image ("Nano Banana Pro") used **selectively** for custom graphics
- Export to PPTX, PDF, HTML, Google Slides
- Claude powers content extraction and layout decisions

**Implication:** Our approach should generate HTML/CSS slides with template support, using AI images only for complex diagrams/illustrations.

### What We Learned from Research

| Topic | Key Finding |
|-------|-------------|
| Slide rendering | HTML/CSS foundation, not full-image slides |
| PPTX export | PptxGenJS (Node.js) is most mature option |
| Cost optimization | Prompt caching can reduce costs 90% |
| Skills | 500-5000 tokens each; use sparingly |
| Monitoring | Langfuse, Helicone for observability |

See [Technical Research Report](research/jawn-ai-research.md) for full details.

---

## Phased Roadmap

### Phase 1: Asset Sharing Pipeline (ACTIVE — Feb 11, 2026)

**Goal:** A working pipeline to share Claude-generated artifacts — HTML pages, PDFs, React apps, and other files — behind password protection.

**Why first:** Everything else we build needs somewhere to go. This is the foundational sharing layer.

**Implementation:**
- GitHub repo (dedicated or branch of jawn-ai) with GitHub Pages enabled
- GitHub Actions workflow: push assets → StatiCrypt encrypts → GitHub Pages serves
- Per-project passwords in GitHub Secrets
- Directory-based organization (`zivtech.github.io/project-name/`)
- Custom domain (`demos.zivtech.com`) when ready

**Estimated effort:** 1-2 days

### Phase 4: Presentation Toolkit + Additional Tools (Future)

**Goal:** Expand the tools layer on top of the platform.

**Presentation Toolkit:**
- Accept client design systems (colors, fonts, logos)
- Accept PowerPoint templates with master slides
- Ingest source content (PPT, PDF, Word docs)
- Generate branded, sensible slides
- Output editable PPTX

**Existing Work:**
- `zivtech/drupal-brand-skill` — Drupal-specific brand design skill
- `zivtech/claude-presentation-toolkit` — Being generalized (WIP)

**Also in Phase 4:**
- Document Generator (reports, proposals — DOCX, PDF)
- Analysis Tools (financial modeling, research, data analysis)
- Spec Kitty as Service (for clients who can't run locally)

### Phase 2: MCP Server Deployment

**Goal:** Deploy the existing MCP server to AWS EC2

**What's already built:** OAuth auth, MCP protocol endpoint, tool executors for Jira/Slack/GitHub/Google, scheduled tasks, encrypted token storage, Docker config (see `jawn-ai-mcp-server/`)

**Implementation:**
- Provision AWS EC2 (t3.small/medium)
- Docker Compose: Node.js app + PostgreSQL
- GitHub Actions CI/CD pipeline
- AWS MCP servers for infrastructure management via Claude

### Phase 3: Platform Framework

**Goal:** Multi-tenant infrastructure for client deployments

- Internal AI portal (web app with chat interface, Google SSO)
- Orchestrator (Claude Agent SDK)
- Skills/Styles system for client-specific mediation
- MCP Gateway for auth, routing, logging
- Monitoring for usage and content fidelity
- Sandboxed client environments

---

## Development Workflow: Spec Kitty

**Tool:** [Spec Kitty](https://github.com/Priivacy-ai/spec-kitty) — Spec-driven development framework

### Why Spec Kitty

1. **Structured PRD creation** — Forces clarity on WHAT before HOW
2. **Research phase built-in** — API investigation before coding
3. **Multi-agent coordination** — Claude Code + other agents in parallel
4. **Kanban visibility** — Real-time dashboard shows progress
5. **Quality gates** — Accept/merge workflow prevents incomplete features

### Spec Kitty Phases

#### Phase 0: Project Setup
```bash
spec-kitty init jawn-ai-platform --ai claude
cd jawn-ai-platform
```

#### Spec Kitty Phase 1: Constitution (`/spec-kitty.constitution`) ✅

Establish project principles:
- Multi-tenant from day one
- Skills as guardrails, not just capabilities
- Client data governance (Tier 3/4)
- Monitor everything (usage, fidelity, friction)
- Feedback loops improve skills automatically

#### Spec Kitty Phase 2: Specification (`/spec-kitty.specify`) ✅

Define WHAT to build:

**For Platform:**
- User stories for client deployments
- Skill creation and management workflows
- Monitoring and guardrail requirements
- Access control and sandboxing needs

**For Presentation Toolkit (Phase 4):**
- User stories for internal teams generating decks
- Input types: design systems, templates, source docs (PPT/PDF/Word)
- Output types: branded PPTX matching client templates

#### Spec Kitty Phase 3: Planning (`/spec-kitty.plan`) ✅

Define HOW to build:
- Tech stack decisions (see below)
- Architecture for multi-tenant deployment
- Skills system design
- MCP Gateway architecture
- Infrastructure decisions (AWS, GitHub Pages, StatiCrypt)

#### Spec Kitty Phase 4: Research (`/spec-kitty.research`) — In Progress

Investigate before coding:
- Hosting comparison (AWS vs Platform.sh vs alternatives) ✅
- Session tracking evaluation (Entire CLI) ✅
- Current toolkit gaps (need repo access)
- Monitoring stack options

#### Spec Kitty Phase 5: Tasks (`/spec-kitty.tasks`)

Break into work packages (see below)

#### Spec Kitty Phase 6: Implementation (`/spec-kitty.implement`)

- Work in isolated worktree
- Kanban dashboard tracks progress
- Multi-agent: Claude Code for core, specialized tools as needed

#### Spec Kitty Phase 7: Review/Accept/Merge

- Quality gates verify work packages complete
- Merge to main when feature ready

---

## Tech Stack

| Component | Technology | Phase |
|-----------|------------|-------|
| Asset Sharing | GitHub Pages + StatiCrypt + GitHub Actions | 1 |
| MCP Server Hosting | AWS EC2 + Docker Compose | 2 |
| Orchestrator | Claude Agent SDK (Python) | 3 |
| Web App | Next.js + FastAPI | 3 |
| Skills Registry | File-based + version control | 3 |
| MCP Gateway | Custom MCP server | 3 |
| Monitoring | Langfuse + custom | 3 |
| Session Tracking | Entire CLI (pilot) | 1 |
| Presentation Generation | Python + Node.js (PptxGenJS) | 4 |
| Document Generation | python-docx, ReportLab | 4 |
| Development Framework | Spec Kitty | All |

---

## Work Packages

### Phase 1: Asset Sharing Pipeline

| WP | Name | Description | Est. Effort |
|----|------|-------------|-------------|
| WP00 | GitHub Pages Setup | Create repo/branch, enable Pages, configure domain | 0.5 days |
| WP00a | StatiCrypt CI Pipeline | GitHub Actions workflow: encrypt on push, per-project passwords in Secrets | 0.5 days |
| WP00b | Directory Conventions | Establish project structure, README, password management docs | 0.5 days |
| WP00c | First Asset Deployed | Deploy a sample HTML page + PDF, verify password protection | 0.5 days |

**Phase 1 Effort:** 1-2 days

### Phase 2: MCP Server Deployment

| WP | Name | Description | Est. Effort |
|----|------|-------------|-------------|
| WP06a | AWS EC2 Provisioning | Instance setup, security groups, Docker + Compose install | 0.5 days |
| WP06b | Docker Compose Config | Production compose file, env vars, PostgreSQL container | 0.5 days |
| WP06c | CI/CD Pipeline | GitHub Actions: build → push image → deploy to EC2 | 1 day |
| WP06d | DNS + TLS | Domain config, Let's Encrypt or ACM | 0.5 days |
| WP06e | Smoke Test + Monitoring | Verify all tool executors, basic uptime monitoring | 0.5 days |

**Phase 2 Effort:** 3 days

### Phase 3: Platform Framework

| WP | Name | Description | Est. Effort |
|----|------|-------------|-------------|
| WP07 | Core Orchestrator | Claude Agent SDK setup, agent loop, tool routing | 3-4 days |
| WP08 | Skills System | Skill registry, loading, validation, versioning | 4-5 days |
| WP09 | MCP Gateway | Authentication, authorization, routing, logging | 4-5 days |
| WP10 | Monitoring Layer | Usage tracking, fidelity checks, guardrail monitoring | 4-5 days |
| WP11 | Sandbox Environments | Docker-based client environments, access control | 3-4 days |
| WP12 | Client Onboarding | Skill creation workflow, configuration | 3-4 days |

**Phase 3 Effort:** 21-27 days (4-5 weeks)

### Phase 4: Presentation Toolkit + Additional Tools

| WP | Name | Description | Est. Effort |
|----|------|-------------|-------------|
| WP13 | Design System Ingestion | Parse client brand assets (colors, fonts, logos) | 2-3 days |
| WP14 | Template Processing | Extract master slides, layouts from PPT templates | 3-4 days |
| WP15 | Content Extraction | Parse source docs (PPT/PDF/Word) into structured content | 3-4 days |
| WP16 | Slide Generation + PPTX Output | Content → branded slides → editable PPTX | 4-5 days |
| WP17 | Skill Packaging | Package presentation toolkit as Claude Code/Cowork skill | 1-2 days |
| WP18 | Document Generator | Reports, proposals (DOCX, PDF) | 3-4 days |
| WP19 | Analysis Tools | Financial modeling, research, data analysis | 3-4 days |
| WP20 | Zivtech Skills Library | Initial skills for common consulting tasks | 4-5 days |
| WP21 | Dashboards | Monitoring dashboards, usage reports, alerts | 3-4 days |

**Phase 4 Effort:** ~28-37 days (6-7 weeks)

---

## Cost Model

### Phase 4: Presentation Toolkit

| Component | Est. Cost | Notes |
|-----------|-----------|-------|
| Claude orchestration | $0.01-0.02 | With prompt caching |
| AI image (30% of slides) | $0.01-0.02 | Only when needed |
| Quality check | $0.005 | Quick review |
| **Per slide** | **$0.02-0.05** | |
| **10-slide deck** | **$0.20-0.50** | |

### Phase 2+: Platform

Additional costs for:
- Monitoring infrastructure
- MCP Gateway hosting
- Client environment isolation
- Usage metering/billing

---

## Data Governance

| Tier | Data Type | Allowed Processing |
|------|-----------|-------------------|
| 1 | Public | Any tier |
| 2 | Internal | Commercial tier+ |
| 3 | Client Confidential | Enterprise plan |
| 4 | Ultra-Sensitive | Enterprise + ZDR |

**For This Project:**
- Client documents = Tier 3
- Enterprise plan required for production
- Never use client data for training
- All outputs reviewable before delivery

---

## Timeline

### Now: Asset Sharing Pipeline + Spec Kitty (Feb 11)

- [ ] Set up GitHub Pages + StatiCrypt pipeline (WP00-00c)
- [ ] Run Spec Kitty in Claude Code — reconcile specs with updated decisions ✅
- [ ] Entire CLI pilot running (telemetry off, manual-commit)

### Week 1: Asset Sharing Pipeline (Phase 1)
- [ ] GitHub Pages repo/branch configured
- [ ] StatiCrypt GitHub Actions workflow working
- [ ] First asset deployed and password-protected
- [ ] Directory conventions documented

### Week 2: MCP Server Deployment (Phase 2)
- [ ] WP06a-06e: Deploy MCP server to AWS EC2
- [ ] All tool executors verified in production
- [ ] GitHub Actions CI/CD pipeline working

### Week 3-7: Platform Framework (Phase 3)
- [ ] WP07-12: Build web app, multi-tenant infrastructure
- [ ] Google SSO, chat UI, MCP integrations
- [ ] Internal pilot

### Week 8+: Additional Tools (Phase 4)
- [ ] WP13-21: Presentation toolkit, document generator, analysis tools
- [ ] Client pilot

---

## Success Criteria

### Phase 1: Asset Sharing Pipeline
- Any Claude-generated artifact (HTML, PDF, React app) shareable via URL within 5 minutes of creation
- Password protection working per-project
- At least 3 PoCs/assets deployed and shared

### Phase 2: MCP Server Deployment
- All 4 tool executors (Jira, Slack, GitHub, Google) working in production
- CI/CD pipeline deploys on push
- Uptime monitoring active

### Phase 3+: Platform
- Client can deploy in <1 day
- Skills updated based on feedback within 1 week
- Monitoring catches 90% of content issues
- No security incidents

---

## Infrastructure Requirements

### PoC Asset Sharing (StatiCrypt)

**Need:** Share PoC websites and web apps with clients/stakeholders behind password protection.

**Near-Term Solution:** [StatiCrypt](https://github.com/robinmoisson/staticrypt) — AES-256 client-side encryption for static HTML files.

| Aspect | Approach |
|--------|----------|
| Encryption | AES-256, zero server dependencies |
| Password management | Per-project directory, stored in GitHub Secrets |
| CI integration | Encrypt on push via GitHub Actions |
| Directory structure | Project-based; carries forward to eventual Drupal portal |
| Git managed | Yes — encrypted output committed, passwords in Secrets |

**Future State:** Drupal-based portal for user accounts, groups, permissions. The directory-based structure established now transitions cleanly into Drupal's content organization.

### Hosting

**MCP Server:** Docker Compose on AWS EC2 (~$15-35/mo, t3.small/medium). Node.js + PostgreSQL in containers, GitHub Actions CI/CD. AWS chosen for its mature MCP ecosystem (45+ official servers from awslabs) — enables Claude to help manage infrastructure directly.

**Static PoCs:** GitHub Pages + StatiCrypt. Free, git-native, directory-based (`zivtech.github.io/poc-name/`). Custom domain (e.g., `demos.zivtech.com`) when ready.

**Drupal PoCs:** Separate system using existing tools — Pantheon Multidev, Tugboat, or Probo.ci. No new infrastructure needed.

See `hosting-comparison.md` for full analysis and options evaluated.

### Session Tracking (Entire CLI)

**Need:** Track what happens in AI chat sessions for auditability, learning, and process improvement.

**Tool:** [Entire CLI](https://github.com/entireio/cli) — MIT licensed, git-native, no external database.

**Privacy/Security Assessment:**

| Concern | Detail | Mitigation |
|---------|--------|------------|
| Telemetry | On by default (Posthog); undocumented collection scope | Disable at init: `telemetry: false` |
| Auto-push | Session transcripts auto-push to remote (everything said in AI chats lands on GitHub) | Use `strategy: manual-commit`; review before pushing |
| Data exposure | Full chat transcripts in git history | Keep repo private; review transcripts before commit |

**Current Config (`.entire/settings.json`):**
- `strategy: manual-commit` ✅
- `telemetry: false` ✅ (fixed Feb 11)

**Rollout Plan:**
1. Pilot on jawn-ai itself with telemetry off and auto-push disabled
2. Review captured data for 2 weeks
3. Decide on broader team rollout based on findings

---

## Open Questions

### Phase 1 (Asset Sharing) — Resolved
| Question | Resolution |
|----------|------------|
| GitHub Pages repo structure for PoCs | **Resolved** — Dedicated repo `zivtech/zivtech-demos` with `projects/<name>/` convention |
| StatiCrypt CI pipeline design | **Resolved** — GitHub Actions workflow in `.github/workflows/deploy.yml`, per-project passwords in Secrets |

### Phase 2 (MCP Deploy)
| Question | Notes |
|----------|-------|
| AWS EC2 instance sizing | t3.small vs t3.medium for MCP server |
| Coolify vs raw Docker Compose | Evaluate management UI after 1 month |

### Phase 3 (Platform)
| Question | Notes |
|----------|-------|
| Client environment hosting | Docker? VMs? Cloud provider? → AWS EC2 decided |
| Skill version control | Git-based? Database? |
| Monitoring stack | Langfuse? Custom? |
| Billing integration | Stripe? Custom? |

### Phase 4 (Tools)
| Question | Notes |
|----------|-------|
| What's not working in current toolkit? | Need repo access |
| Design system format | How to standardize brand asset ingestion? |
| Template extraction approach | python-pptx? Direct XML? |
| HTML/CSS vs direct PPTX | Generate HTML then convert, or build PPTX directly? |

### Cross-cutting
| Question | Notes |
|----------|-------|
| Entire CLI pilot evaluation | Review after 2 weeks of use |
| Git hosting: GitHub vs self-hosted | GitLab/Gitea for better disk/artifact management, LFS limits at scale, S3 offload |
| Drupal client portal scope | Role-based access, CMS content, migration path from StatiCrypt |

---

## Next Actions

1. **Now (Feb 11):**
   - ✅ Spec Kitty upgraded to v0.13.7
   - ✅ Specs reconciled with new decisions and phase ordering
   - Set up GitHub Pages + StatiCrypt pipeline (WP00-00c)

2. **This week:**
   - Complete Phase 1 (Asset Sharing Pipeline)
   - First asset deployed and password-protected

3. **Next week:**
   - Begin Phase 2 (MCP Server Deployment to AWS EC2)

---

## References

- [Technical Research Report](research/jawn-ai-research.md) — Full research findings
- [Spec Kitty GitHub](https://github.com/Priivacy-ai/spec-kitty) — Development framework
- [Claude Agent SDK Docs](https://docs.anthropic.com/en/docs/agents) — Orchestration patterns
- [Notion: Technical Learning Questions](https://www.notion.so/9daf8c36a31342428e29c8958e1ba782)
- [Notion: Business & Partnership Questions](https://www.notion.so/6d29c8e4f8cc42f8bec40e2d99f752b1)

---

*Document maintained in: `jawn-ai/jawn-ai-plan.md`*
*Updated: February 12, 2026 — Aligned with Feb 11-12 decisions, resolved Phase 1 questions*
*Notion canonical: [Crazy Ideas & Research](https://www.notion.so/2f798ac3bc5681f99793e84bf1f55c3a)*
