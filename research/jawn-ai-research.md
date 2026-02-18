# Zivtech AI Agent Platform — Technical Research Report

**Date:** January 29, 2026
**Status:** Research Complete (v4 — Prioritized Roadmap)
**Purpose:** Technical foundation for a multi-tenant AI agent platform for Zivtech consulting

---

## Executive Summary

A **general-purpose AI agent platform** that enables:

- Varied business tasks (financial planning, marketing campaigns, support, analysis)
- Client-specific skills/styles that mediate AI outputs
- Monitoring for usage patterns and content fidelity
- Sandboxed deployment for clients who can't have Claude Code-level access

| Component | Internal (Zivtech) | Client Deployments |
|-----------|-------------------|-------------------|
| Access Level | Full (Claude Code-like) | Sandboxed environments |
| Skills | Zivtech consulting library | Customer-specific mediation |
| Monitoring | Usage analytics | Content fidelity, guardrails |
| Tasks | All business operations | Same, but constrained |

---

## 0. Phased Roadmap

### Phase 1: Presentation Toolkit (ACTIVE)

**Status:** In progress — immediate priority

The presentation generator is being developed as a Claude Code/Cowork skill before building the full platform. This provides:
- Immediate internal value for Zivtech teams
- A concrete, testable tool to validate the approach
- Foundation for the broader platform's content generation capabilities

**Existing Work:**
- `zivtech/drupal-brand-skill` — Started as Drupal-specific brand design skill
- `zivtech/claude-presentation-toolkit` — Being generalized into standalone tool (WIP)

**Capability Goals:**
- Accept client design systems (colors, fonts, logos)
- Accept PowerPoint templates with master slides
- Ingest source content (PPT, PDF, Word docs)
- Extract and structure content intelligently
- Generate branded, sensible slides matching design system
- Output editable PPTX

**Deployment:**
| User Type | How They Access |
|-----------|-----------------|
| Zivtech devs | Skill in Claude Code / Cowork |
| Zivtech non-devs | MCP proxy (nice-to-have, lower priority) |
| Clients | Platform tool (Phase 2) |

### Phase 2: Platform Framework

Build the multi-tenant infrastructure:
- Orchestrator (Claude Agent SDK)
- Skills/Styles system for client-specific mediation
- MCP Gateway for auth, routing, logging
- Monitoring for usage and content fidelity
- Sandboxed client environments

### Phase 3: Additional Tools

Expand the tools layer:
- Document Generator (reports, proposals)
- Analysis Tools (financial, gap analysis, roadmaps)
- Research Tools (web, doc analysis)
- Support Tools (client comms, FAQs)

### Platform Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                 ZIVTECH AI AGENT PLATFORM                        │
│                                                                  │
│  Framework Layer (Phase 2)                                       │
│  ├─ Orchestrator (Claude Agent SDK)                              │
│  ├─ Skills/Styles System (client design systems, voice, rules)   │
│  ├─ MCP Gateway (auth, routing, logging)                         │
│  └─ Monitoring (usage, fidelity, guardrails)                     │
│                                                                  │
│  Tools Layer                                                     │
│  ├─ Presentation Generator  ← Phase 1 (ACTIVE)                   │
│  │   • Accepts client design systems + templates                 │
│  │   • Ingests PPT/PDF/Word as source content                    │
│  │   • Outputs branded, sensible slides                          │
│  ├─ Document Generator (Phase 3)                                 │
│  ├─ Analysis Tools (Phase 3)                                     │
│  ├─ Research Tools (Phase 3)                                     │
│  └─ Support Tools (Phase 3)                                      │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

---

## 1. Project Reframing

### What This Is NOT
- ❌ A presentation generator
- ❌ A single-purpose tool
- ❌ Just for internal Zivtech use

### What This IS
- ✅ A multi-tenant AI agent platform
- ✅ A Claude Code alternative for restricted environments
- ✅ A skills/styles system for customer-specific AI mediation
- ✅ A monitoring layer for AI governance

### Core Capability Areas

| Area | Description | Priority |
|------|-------------|----------|
| **Analysis & Planning** | Financial modeling, gap analysis, roadmaps, strategy | High |
| **Content Generation** | Docs, presentations, marketing, reports | High |
| **Monitoring & Guardrails** | Usage tracking, content fidelity, quality control | High |
| **Mediated Content** | Customer-specific skills/styles that guide outputs | High |

---

## 2. Architecture: Multi-Tenant Deployment

### Deployment Contexts

```
┌─────────────────────────────────────────────────────────────────┐
│                    ZIVTECH AI AGENT PLATFORM                     │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  ┌──────────────────────┐      ┌──────────────────────┐         │
│  │   INTERNAL USE       │      │   CLIENT DEPLOYMENTS │         │
│  │                      │      │                      │         │
│  │  • Full filesystem   │      │  • Sandboxed env     │         │
│  │  • All tools enabled │      │  • Controlled tools  │         │
│  │  • Direct API access │      │  • Audit trail       │         │
│  │  • Zivtech skills    │      │  • Client skills     │         │
│  └──────────────────────┘      └──────────────────────┘         │
│                                                                  │
│  ┌──────────────────────────────────────────────────────────┐   │
│  │                   SHARED INFRASTRUCTURE                   │   │
│  │                                                           │   │
│  │  • Orchestrator (Claude Agent SDK)                        │   │
│  │  • Skills/Styles Registry                                 │   │
│  │  • Monitoring & Analytics                                 │   │
│  │  • MCP Server Gateway                                     │   │
│  └──────────────────────────────────────────────────────────┘   │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

### Access Control Layers

| Layer | Internal | Client (Standard) | Client (Restricted) |
|-------|----------|-------------------|---------------------|
| Filesystem | Full | Workspace only | None (API only) |
| Web access | Unrestricted | Allowlisted domains | None |
| Code execution | Yes | Sandboxed | No |
| Tool access | All | Configured set | Minimal |
| Data egress | Unrestricted | Logged | Blocked |

### Relevant Notion Questions

> **"Security model: How does client authorize Zivtech MCP without exposing credentials?"**
> - OAuth2 delegation pattern
> - Zivtech-managed token vault
> - Per-client scoped access tokens

> **"How to connect clients' sensitive data to Claude without direct credential access?"**
> - MCP gateway acts as broker
> - Client data stays in client environment
> - Agent receives sanitized/anonymized views

> **"Hosting: Zivtech-managed MCP servers that clients connect to"**
> - Central MCP gateway for common services
> - Client-specific MCP instances for sensitive data
> - Hybrid model based on data classification

---

## 3. Architecture: Skills/Styles System

### Concept: Skills as Guardrails

Skills are not just capability enhancers — they're **constraint systems** that:
- Define acceptable outputs and formats
- Enforce brand/style guidelines
- Improve over time based on feedback
- Act as guardrails for content fidelity

### Skills Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                      SKILLS REGISTRY                             │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  ┌──────────────────────┐      ┌──────────────────────┐         │
│  │   ZIVTECH SKILLS     │      │   CLIENT SKILLS      │         │
│  │   (Shared Library)   │      │   (Per-Customer)     │         │
│  │                      │      │                      │         │
│  │  • Financial models  │      │  • Brand voice       │         │
│  │  • Analysis templates│      │  • Approved formats  │         │
│  │  • Report formats    │      │  • Domain terms      │         │
│  │  • Best practices    │      │  • Restrictions      │         │
│  └──────────────────────┘      └──────────────────────┘         │
│                                                                  │
│  ┌──────────────────────────────────────────────────────────┐   │
│  │                   SKILL COMPONENTS                        │   │
│  │                                                           │   │
│  │  SKILL.md           - Instructions and constraints        │   │
│  │  templates/         - Output templates                    │   │
│  │  examples/          - Good/bad examples                   │   │
│  │  validators/        - Output validation rules             │   │
│  │  feedback/          - Accumulated corrections             │   │
│  └──────────────────────────────────────────────────────────┘   │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

### Skill Lifecycle

```
1. CREATE
   └─> Zivtech designs skill for customer
   └─> Customer reviews/approves constraints

2. DEPLOY
   └─> Skill loaded into customer's agent instance
   └─> Becomes active for all interactions

3. MEDIATE
   └─> Agent uses skill to guide outputs
   └─> Outputs validated against skill rules

4. LEARN
   └─> User corrections captured
   └─> Feedback aggregated for skill updates

5. IMPROVE
   └─> Zivtech reviews feedback patterns
   └─> Skill updated with new examples/rules
   └─> Version deployed to customer
```

### Relevant Notion Questions

> **"Skills architecture research: what's possible, what's the overhead?"**
> - Skills add ~1-5K tokens to context
> - Trade-off: more specific = more tokens = higher cost
> - Recommendation: tiered skills (base + task-specific)

> **"How to create effective custom Skills (SKILL.md files)?"**
> - Clear constraints with examples
> - Include anti-patterns (what NOT to do)
> - Validation rules for output checking
> - Versioning for rollback capability

> **"How much do skills impact context window / available memory?"**
> - Each skill: 500-5000 tokens typical
> - Active skills loaded per-task
> - Skill selection should be part of orchestration

> **"Can captured corrections feed back into shared skills across the team?"**
> - Yes, via feedback aggregation
> - Corrections stored in feedback/ directory
> - Periodic review → skill updates
> - Version control for skill evolution

> **"Training Claude on client voice while preserving their approval authority over outputs"**
> - Skills define voice/style constraints
> - All outputs can be flagged for review
> - Approval workflows for sensitive content
> - Client retains final authority

> **"Style guide ownership: clients write differently for internal vs external"**
> - Multiple style profiles per client
> - Context-triggered style switching
> - Internal vs. external skill variants

---

## 4. Architecture: Monitoring Infrastructure

### Monitoring Layers

```
┌─────────────────────────────────────────────────────────────────┐
│                    MONITORING INFRASTRUCTURE                     │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  ┌──────────────────────────────────────────────────────────┐   │
│  │  LAYER 1: USAGE ANALYTICS                                 │   │
│  │                                                           │   │
│  │  • Requests per user/client                               │   │
│  │  • Token consumption                                      │   │
│  │  • Task types and durations                               │   │
│  │  • Tool usage patterns                                    │   │
│  │  • Cost attribution                                       │   │
│  └──────────────────────────────────────────────────────────┘   │
│                                                                  │
│  ┌──────────────────────────────────────────────────────────┐   │
│  │  LAYER 2: CONTENT FIDELITY                                │   │
│  │                                                           │   │
│  │  • Output validation against skill rules                  │   │
│  │  • Factual accuracy checks (where possible)               │   │
│  │  • Brand/voice consistency scoring                        │   │
│  │  • Hallucination detection                                │   │
│  │  • Citation verification                                  │   │
│  └──────────────────────────────────────────────────────────┘   │
│                                                                  │
│  ┌──────────────────────────────────────────────────────────┐   │
│  │  LAYER 3: GUARDRAILS & BOUNDARIES                         │   │
│  │                                                           │   │
│  │  • Restriction hits (blocked actions)                     │   │
│  │  • Boundary friction signals                              │   │
│  │  • Unanticipated side effects                             │   │
│  │  • Permission escalation requests                         │   │
│  │  • Audit trail for compliance                             │   │
│  └──────────────────────────────────────────────────────────┘   │
│                                                                  │
│  ┌──────────────────────────────────────────────────────────┐   │
│  │  LAYER 4: PROACTIVE INSIGHTS                              │   │
│  │                                                           │   │
│  │  • Usage trend alerts                                     │   │
│  │  • Skill effectiveness scoring                            │   │
│  │  • Client engagement patterns                             │   │
│  │  • Recommendations for skill updates                      │   │
│  │  • Anomaly detection                                      │   │
│  └──────────────────────────────────────────────────────────┘   │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

### Key Metrics

| Metric | Purpose | Action Trigger |
|--------|---------|----------------|
| Restriction hit rate | Are guardrails too tight? | >10% → review constraints |
| Task completion rate | Are skills effective? | <80% → investigate failures |
| Correction frequency | Is the agent learning? | Trending up → skill update needed |
| Cost per task type | Optimization opportunities | Outliers → review prompts |
| Time to completion | Efficiency tracking | Regression → investigate |

### Relevant Notion Questions

> **"LLM Observability Tools ('New Relic for Claude')"**
> - Langfuse, LangSmith, Helicone for logging
> - Custom dashboards for Zivtech-specific metrics
> - Integration with existing monitoring stack

> **"Can you monitor when users hit restrictions - to know if you've been too tight?"**
> - Yes, log all permission denials
> - Track patterns to identify over-restriction
> - Feedback loop to adjust guardrails

> **"How to detect unanticipated side effects from restrictions (Claude can't complete tasks due to guardrails)?"**
> - Monitor task abandonment rates
> - Capture user workarounds
> - Log "tried but failed" patterns

> **"Feedback loop: using boundary friction as signal for what to loosen or adjust"**
> - Friction = user hitting limits + expressing frustration
> - Aggregate friction signals by constraint type
> - Regular review cycle to adjust

> **"What usage data is available via API or admin tools for mediation layer?"**
> - Anthropic Admin API for enterprise
> - Custom logging via MCP gateway
> - Token usage, conversation metadata

> **"Enterprise AI Governance: Shadow AI problem and monitoring tools"**
> - Detect unauthorized AI usage
> - Provide sanctioned alternative (this platform)
> - Usage visibility reduces shadow AI

> **"Proactive check-ins based on client usage data"**
> - Low usage → engagement outreach
> - High error rate → support intervention
> - Pattern changes → training opportunity

> **"Billing: How to meter/charge for 'Ask Zivtech' MCP service?"**
> - Token-based metering
> - Task-type pricing tiers
> - Monthly usage reports
> - Cost attribution per client

---

## 5. Technical Implementation

### Core Components

| Component | Technology | Purpose |
|-----------|------------|---------|
| Orchestrator | Claude Agent SDK (Python) | Agent loop, tool routing |
| Skills Registry | File-based + version control | Skill storage and versioning |
| MCP Gateway | Custom MCP server | Tool access control, logging |
| Monitoring | Langfuse + custom | Usage, fidelity, guardrails |
| Task Environments | Docker/VM per client | Sandboxed execution |
| Output Assembly | python-pptx, docx, pdf libs | Deliverable generation |

### MCP Gateway Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                       MCP GATEWAY                                │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  INBOUND                                                         │
│  ├─> Authentication (client token validation)                   │
│  ├─> Authorization (skill-based permissions)                    │
│  ├─> Rate limiting                                               │
│  └─> Request logging                                             │
│                                                                  │
│  ROUTING                                                         │
│  ├─> Tool selection based on request                            │
│  ├─> Skill loading for context                                   │
│  ├─> Environment selection (internal vs client sandbox)          │
│  └─> Backend MCP server dispatch                                 │
│                                                                  │
│  OUTBOUND                                                        │
│  ├─> Output validation against skill rules                      │
│  ├─> Sensitive data filtering                                    │
│  ├─> Response logging                                            │
│  └─> Metrics emission                                            │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

### Relevant Notion Questions

> **"Can a single MCP server act as gateway/proxy to multiple backend services?"**
> - Yes, this is the recommended pattern
> - Gateway handles auth, logging, routing
> - Backend servers are service-specific

> **"LLM middleware/gateway systems"**
> - Portkey, LiteLLM for multi-provider
> - Custom MCP gateway for Zivtech-specific needs
> - Combine: LiteLLM for LLM routing, MCP for tools

> **"Should a smaller/faster LLM sit in front of Claude for routing, triage, simple tasks?"**
> - Yes for cost optimization
> - Haiku for classification/routing
> - Sonnet for most tasks
> - Opus for complex reasoning

### Model Routing Cost Insight (2026-02-17 CTO Discussion)

Claude Code's `--opus-plan` flag uses Opus for planning and Sonnet for execution. Internal testing suggests this can reduce token usage by up to 80% compared to running Opus for everything. The joyus-ai mediator should support similar model-tier routing — automatically selecting the appropriate model tier based on operation type. This applies to both human sessions and automated pipelines (e.g., the bug triage pipeline doesn't need Opus for ticket enrichment but may benefit from it for diagnosis).

> **"Best practices for preventing mid-task crashes on business-critical agentic workflows (checkpointing, circuit breakers)"**
> - Checkpoint after each tool call
> - Circuit breaker for repeated failures
> - Graceful degradation to simpler approach
> - Human handoff for critical failures

---

## 6. Notion Questions: Full Relevance Map

### Highest Priority (Direct Impact)

| Question | Category | Relevance |
|----------|----------|-----------|
| Skills architecture research | Skills & Knowledge | Core to mediated content |
| Security model for client MCP | MCP Architecture | Core to client deployment |
| LLM Observability Tools | Monitoring & Workflow | Core to monitoring layer |
| How to create effective Skills | Skills & Knowledge | Core to skills system |
| Feedback loop from boundary friction | Boundaries & Restrictions | Core to guardrails |
| Training on client voice | Skills & Knowledge | Core to mediated content |

### High Priority (Important Supporting)

| Question | Category | Relevance |
|----------|----------|-----------|
| MCP as gateway/proxy | MCP Architecture | MCP gateway design |
| Billing/metering for MCP | Pricing & Business | Business model |
| Proactive check-ins from usage | Client Collaboration | Engagement model |
| Sensitive data handling | Data Governance | Security design |
| Checkpointing for crashes | Monitoring & Workflow | Reliability |
| Context compaction handling | Context Window | Performance |

### Medium Priority (Address Later)

| Question | Category | Relevance |
|----------|----------|-----------|
| Memory architecture choices | Memory Architecture | Persistence design |
| Multi-LLM routing | Middleware / Mediation | Cost optimization |
| Tracking changes in data sources | Monitoring & Workflow | Data sync |
| Voice agents for interviews | Tools & Recording | Future capability |

---

## 7. Updated Work Packages

### Phase 1: Presentation Toolkit (ACTIVE)

| WP | Name | Description | Est. Effort |
|----|------|-------------|-------------|
| **WP01** | **Design System Ingestion** | Parse client brand assets (colors, fonts, logos) | 2-3 days |
| **WP02** | **Template Processing** | Extract master slides, layouts from PPT templates | 3-4 days |
| **WP03** | **Content Extraction** | Parse source docs (PPT/PDF/Word) into structured content | 3-4 days |
| **WP04** | **Slide Generation** | Content → branded slides using templates | 4-5 days |
| **WP05** | **PPTX Output** | Assemble final editable PPTX | 2-3 days |
| **WP06** | **Skill Packaging** | Package as Claude Code/Cowork skill | 1-2 days |

**Phase 1 Effort:** 15-21 days (3-4 weeks)

### Phase 2: Platform Framework

| WP | Name | Description | Est. Effort |
|----|------|-------------|-------------|
| **WP07** | **Core Orchestrator** | Claude Agent SDK setup, agent loop, basic tool routing | 3-4 days |
| **WP08** | **Skills System** | Skill registry, loading, validation, versioning | 4-5 days |
| **WP09** | **MCP Gateway** | Authentication, authorization, routing, logging | 4-5 days |
| **WP10** | **Monitoring Layer** | Usage tracking, fidelity checks, guardrail monitoring | 4-5 days |
| **WP11** | **Sandbox Environments** | Docker-based client environments, access control | 3-4 days |
| **WP12** | **Client Onboarding** | Skill creation workflow, configuration | 3-4 days |

**Phase 2 Effort:** 21-27 days (4-5 weeks)

### Phase 3: Additional Tools

| WP | Name | Description | Est. Effort |
|----|------|-------------|-------------|
| **WP13** | **Document Generator** | Reports, proposals (DOCX, PDF) | 3-4 days |
| **WP14** | **Analysis Tools** | Financial modeling, research, data analysis | 3-4 days |
| **WP15** | **Zivtech Skills Library** | Initial skills for common consulting tasks | 4-5 days |
| **WP16** | **Dashboards** | Monitoring dashboards, usage reports, alerts | 3-4 days |

**Phase 3 Effort:** 13-17 days (3 weeks)

**Total Estimated Effort:** 49-65 days (10-13 weeks)

---

## 8. Key Design Principles

1. **Skills as guardrails, not just capabilities** — Every client gets mediated AI
2. **Sandbox by default** — Client environments are isolated unless explicitly opened
3. **Monitor everything** — Usage, fidelity, friction, cost
4. **Feedback loops are first-class** — Corrections improve skills automatically
5. **Multi-tenant from day one** — Architecture supports N clients
6. **Claude Code alternative** — Same power, controlled access

---

## 9. Open Questions (Needing Resolution)

### Phase 1: Presentation Toolkit

| Question | Notes |
|----------|-------|
| What's not working in current toolkit? | Need repo access to diagnose |
| Design system format | How to standardize brand asset ingestion? |
| Template extraction approach | python-pptx? Direct XML parsing? |
| Content structure schema | How to represent extracted content for slide mapping? |
| HTML/CSS vs direct PPTX | Generate HTML then convert, or build PPTX directly? |
| Quality validation | How to assess if output "looks good"? |

### Phase 2+: Platform

| Question | Notes |
|----------|-------|
| Client environment hosting | Docker? VMs? Cloud provider? |
| Skill version control | Git-based? Database? |
| Monitoring stack selection | Langfuse? Custom? |
| Billing integration | Stripe? Custom invoicing? |
| Initial client pilot | Who's first? |

---

## 10. Manus Context Engineering Learnings

Key architectural insights from Manus's "Context Engineering for AI Agents" that apply to this platform:

### Token Efficiency

| Pattern | Problem | Solution |
|---------|---------|----------|
| **Todo.md Recitation** | Agent recites full todo list with every action (~1/3 of token budget wasted) | Shifted to Planner Agent → Executor pattern; todo updates happen sparingly |
| **100:1 Ratio** | Agents read ~100x more than they write | Optimize for read-heavy patterns; use prompt caching aggressively |
| **File-System-as-Memory** | Context window is limited | Use files as external memory; agent reads what it needs |

### KV-Cache Optimization

> **Critical insight:** Don't dynamically add/remove tools — this invalidates the KV cache and forces full recomputation.

**Manus approach:**
- Keep all tools in context always
- Use **logit masking at decode time** to constrain available actions
- This preserves KV-cache while still enforcing constraints

**Implication for Zivtech platform:**
- Skills should add constraints, not remove tools
- Guardrails work via output validation, not input restriction
- Tool availability stays constant; skill rules determine what's appropriate

### Error Preservation

> "Preserving errors in context is more valuable than correcting them."

- Don't edit failed attempts out of context
- The model learns implicitly from seeing what didn't work
- Error → correction sequences teach better than clean contexts

### Practical Application

For the Zivtech AI Agent Platform:

1. **Don't rebuild todo tracking** — Use the pattern sparingly, rely on file-based state
2. **Prompt caching is mandatory** — 90% cost reduction for repeated skill contexts
3. **Skills add constraints at validation time**, not by removing capabilities
4. **Preserve conversation history** including failed attempts for implicit learning
5. **Plan → Execute separation** — Heavy planning upfront, then focused execution

---

## 11. Sources

### Platform Architecture
- [Claude Agent SDK Overview](https://platform.claude.com/docs/en/agent-sdk/overview)
- [Context Engineering from Manus](https://manus.im/blog/Context-Engineering-for-AI-Agents-Lessons-from-Building-Manus)
- [MCP Specification](https://modelcontextprotocol.io/)

### Monitoring & Observability
- [Langfuse LLM Observability](https://langfuse.com/)
- [Helicone AI Gateway](https://helicone.ai/)
- [Enterprise AI Governance Patterns](https://www.anthropic.com/enterprise)

### Skills & Mediation
- [Claude Skills Documentation](https://docs.anthropic.com/en/docs/claude-code/skills)
- [Prompt Caching for Skills](https://platform.claude.com/docs/en/build-with-claude/prompt-caching)

### Notion Questions
- [Technical Learning Questions](https://www.notion.so/9daf8c36a31342428e29c8958e1ba782)
- [Business & Partnership Questions](https://www.notion.so/6d29c8e4f8cc42f8bec40e2d99f752b1)

---

*Research compiled: January 29, 2026*
*Version: 3.0 (Expanded to AI Agent Platform)*
*For: Zivtech AI Agent Platform project*
