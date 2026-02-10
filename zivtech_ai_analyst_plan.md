# Zivtech AI Agent Platform — Project Plan

**Version:** 2.0
**Date:** January 29, 2026
**Status:** Ready to Initialize
**Notion:** [Crazy Ideas & Research](https://www.notion.so/2f798ac3bc5681f99793e84bf1f55c3a)
**Research:** [Technical Research Report](research/zivtech_ai_analyst_research.md)

---

## Executive Summary

Build a **multi-tenant AI agent platform** for Zivtech consulting that provides:

- **Varied business tasks:** Financial planning, marketing campaigns, support, analysis, presentations
- **Client-specific mediation:** Skills/styles that constrain and guide AI outputs per customer
- **Monitoring & governance:** Usage tracking, content fidelity checks, guardrails
- **Flexible deployment:** Full access internally, sandboxed for clients

**Starting Point:** The presentation toolkit — a concrete, immediately useful tool that validates the approach and informs the broader platform.

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

1. **Presentation Generator** (Phase 1 — ACTIVE)
2. Document Generator (reports, proposals)
3. Analysis Tools (financial, gap analysis, roadmaps)
4. Research Tools (web, doc analysis)
5. Support Tools (client comms, FAQs)

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

See [Technical Research Report](research/zivtech_ai_analyst_research.md) for full details.

---

## Phased Roadmap

### Phase 1: Presentation Toolkit (ACTIVE)

**Goal:** Working presentation generator as a Claude Code/Cowork skill

**Existing Work:**
- `zivtech/drupal-brand-skill` — Drupal-specific brand design skill
- `zivtech/claude-presentation-toolkit` — Being generalized (WIP)

**Capabilities:**
- Accept client design systems (colors, fonts, logos)
- Accept PowerPoint templates with master slides
- Ingest source content (PPT, PDF, Word docs)
- Generate branded, sensible slides
- Output editable PPTX

**Deployment:**
- Zivtech devs: Skill in Claude Code / Cowork
- Zivtech non-devs: MCP proxy (nice-to-have)
- Clients: Platform tool (Phase 2)

### Phase 2: Platform Framework

**Goal:** Multi-tenant infrastructure for client deployments

- Orchestrator (Claude Agent SDK)
- Skills/Styles system for client-specific mediation
- MCP Gateway for auth, routing, logging
- Monitoring for usage and content fidelity
- Sandboxed client environments

### Phase 3: Additional Tools

**Goal:** Expand the tools layer

- Document Generator
- Analysis Tools
- Research Tools
- Support Tools

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
spec-kitty init zivtech-ai-platform --ai claude
cd zivtech-ai-platform
```

#### Phase 1: Constitution (`/spec-kitty.constitution`)

Establish project principles:
- Multi-tenant from day one
- Skills as guardrails, not just capabilities
- Client data governance (Tier 3/4)
- Monitor everything (usage, fidelity, friction)
- Feedback loops improve skills automatically

#### Phase 2: Specification (`/spec-kitty.specify`)

Define WHAT to build:

**For Presentation Toolkit:**
- User stories for internal teams generating decks
- Input types: design systems, templates, source docs (PPT/PDF/Word)
- Output types: branded PPTX matching client templates
- Quality criteria: "looks good," matches brand, sensible content structure

**For Platform:**
- User stories for client deployments
- Skill creation and management workflows
- Monitoring and guardrail requirements
- Access control and sandboxing needs

#### Phase 3: Planning (`/spec-kitty.plan`)

Define HOW to build:
- Tech stack decisions (see below)
- Architecture for multi-tenant deployment
- Skills system design
- MCP Gateway architecture

#### Phase 4: Research (`/spec-kitty.research`)

Investigate before coding:
- Current toolkit gaps (need repo access)
- Template extraction approaches
- HTML/CSS to PPTX conversion
- Monitoring stack options

#### Phase 5: Tasks (`/spec-kitty.tasks`)

Break into work packages (see below)

#### Phase 6: Implementation (`/spec-kitty.implement`)

- Work in isolated worktree
- Kanban dashboard tracks progress
- Multi-agent: Claude Code for core, specialized tools as needed

#### Phase 7: Review/Accept/Merge

- Quality gates verify work packages complete
- Merge to main when feature ready

---

## Tech Stack

| Component | Technology | Phase |
|-----------|------------|-------|
| Orchestrator | Claude Agent SDK (Python) | 2 |
| Skills Registry | File-based + version control | 2 |
| MCP Gateway | Custom MCP server | 2 |
| Monitoring | Langfuse + custom | 2 |
| Presentation Generation | Python + Node.js (PptxGenJS) | 1 |
| Document Generation | python-docx, ReportLab | 3 |
| Development Framework | Spec Kitty | All |

---

## Work Packages

### Phase 1: Presentation Toolkit

| WP | Name | Description | Est. Effort |
|----|------|-------------|-------------|
| WP01 | Design System Ingestion | Parse client brand assets (colors, fonts, logos) | 2-3 days |
| WP02 | Template Processing | Extract master slides, layouts from PPT templates | 3-4 days |
| WP03 | Content Extraction | Parse source docs (PPT/PDF/Word) into structured content | 3-4 days |
| WP04 | Slide Generation | Content → branded slides using templates | 4-5 days |
| WP05 | PPTX Output | Assemble final editable PPTX | 2-3 days |
| WP06 | Skill Packaging | Package as Claude Code/Cowork skill | 1-2 days |

**Phase 1 Effort:** 15-21 days (3-4 weeks)

### Phase 2: Platform Framework

| WP | Name | Description | Est. Effort |
|----|------|-------------|-------------|
| WP07 | Core Orchestrator | Claude Agent SDK setup, agent loop, tool routing | 3-4 days |
| WP08 | Skills System | Skill registry, loading, validation, versioning | 4-5 days |
| WP09 | MCP Gateway | Authentication, authorization, routing, logging | 4-5 days |
| WP10 | Monitoring Layer | Usage tracking, fidelity checks, guardrail monitoring | 4-5 days |
| WP11 | Sandbox Environments | Docker-based client environments, access control | 3-4 days |
| WP12 | Client Onboarding | Skill creation workflow, configuration | 3-4 days |

**Phase 2 Effort:** 21-27 days (4-5 weeks)

### Phase 3: Additional Tools

| WP | Name | Description | Est. Effort |
|----|------|-------------|-------------|
| WP13 | Document Generator | Reports, proposals (DOCX, PDF) | 3-4 days |
| WP14 | Analysis Tools | Financial modeling, research, data analysis | 3-4 days |
| WP15 | Zivtech Skills Library | Initial skills for common consulting tasks | 4-5 days |
| WP16 | Dashboards | Monitoring dashboards, usage reports, alerts | 3-4 days |

**Phase 3 Effort:** 13-17 days (3 weeks)

**Total Estimated Effort:** 49-65 days (10-13 weeks)

---

## Cost Model

### Phase 1: Presentation Toolkit

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

### Now: Initialize with Spec Kitty

```bash
spec-kitty init zivtech-ai-platform --ai claude
cd zivtech-ai-platform
```

### Week 1-2: Foundation
- [ ] Complete constitution phase
- [ ] Run specification discovery interview
- [ ] Get access to existing toolkit repos
- [ ] Diagnose current toolkit gaps

### Week 3-6: Phase 1 (Presentation Toolkit)
- [ ] WP01-06: Build presentation toolkit
- [ ] Test with real Zivtech projects
- [ ] Package as skill for Claude Code/Cowork

### Week 7-11: Phase 2 (Platform Framework)
- [ ] WP07-12: Build multi-tenant infrastructure
- [ ] Internal pilot

### Week 12+: Phase 3 (Additional Tools)
- [ ] WP13-16: Expand tools layer
- [ ] Client pilot

---

## Success Criteria

### Phase 1: Presentation Toolkit
- Generated decks require <30 min manual polish
- 10-slide deck in <10 minutes
- Cost <$1 per deck
- 3+ Zivtech team members using regularly

### Phase 2+: Platform
- Client can deploy in <1 day
- Skills updated based on feedback within 1 week
- Monitoring catches 90% of content issues
- No security incidents

---

## Open Questions

### Phase 1
| Question | Notes |
|----------|-------|
| What's not working in current toolkit? | Need repo access |
| Design system format | How to standardize brand asset ingestion? |
| Template extraction approach | python-pptx? Direct XML? |
| HTML/CSS vs direct PPTX | Generate HTML then convert, or build PPTX directly? |

### Phase 2+
| Question | Notes |
|----------|-------|
| Client environment hosting | Docker? VMs? Cloud provider? |
| Skill version control | Git-based? Database? |
| Monitoring stack | Langfuse? Custom? |
| Billing integration | Stripe? Custom? |

---

## Next Actions

1. **Now:** Initialize Spec Kitty project
   ```bash
   spec-kitty init zivtech-ai-platform --ai claude
   ```

2. **This week:**
   - Complete constitution + specification phases
   - Get access to existing toolkit repos
   - Diagnose what's not working

3. **Next week:**
   - Finalize plan and research phases
   - Begin WP01 (Design System Ingestion)

---

## References

- [Technical Research Report](research/zivtech_ai_analyst_research.md) — Full research findings
- [Spec Kitty GitHub](https://github.com/Priivacy-ai/spec-kitty) — Development framework
- [Claude Agent SDK Docs](https://docs.anthropic.com/en/docs/agents) — Orchestration patterns
- [Notion: Technical Learning Questions](https://www.notion.so/9daf8c36a31342428e29c8958e1ba782)
- [Notion: Business & Partnership Questions](https://www.notion.so/6d29c8e4f8cc42f8bec40e2d99f752b1)

---

*Document maintained in: `/mnt/jawn-ai/zivtech_ai_analyst_plan.md`*
*Notion canonical: [Crazy Ideas & Research](https://www.notion.so/2f798ac3bc5681f99793e84bf1f55c3a)*
