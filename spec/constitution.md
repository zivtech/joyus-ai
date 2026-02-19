# Joyus AI — Constitution

> Project principles that guide all decisions. These are non-negotiable unless explicitly revised.

---

## 1. Project Identity

**Name:** Joyus AI

**Mission:** The only way we find a joyous future with AI is by ensuring it works for the joy of all of us. We can build the best-case scenario, but only if we do it together.

**Purpose:** An open source, multi-tenant AI agent platform that gives organizations mediated, skill-driven access to AI capabilities. The platform encodes organizational knowledge — business rules, operational context, quality standards, brand voice, compliance requirements — as reusable, testable skills that shape every AI interaction.

**Who it's for:** Any organization that needs AI agents to understand their operational reality, not just execute generic prompts. Every business — regardless of size or industry — needs to bring people onto AI systems in a moderated, safe, knowledge-aware way. Whether that's done by an internal team or an outside consultant is an org chart detail, not a platform distinction. The platform supports both:
- **Single-org deployment:** An organization deploys the platform for their own teams, departments, or business units (e.g., a food manufacturer running daily sales reports and weekly production summaries)
- **Multi-org deployment:** A team (internal or consulting) deploys the platform to serve multiple organizations or divisions with isolated, skill-mediated environments

**First validated use case:** An ice cream manufacturer, wholesale distributor, and multi-location retailer — a single business operating across food manufacturing (dairy + frozen, cold chain, USDA/FDA compliance), wholesale distribution (account management, order fulfillment), retail (POS analytics, labor scheduling), and seasonal operations (70% of revenue in 6 months). The platform handles all four operational realities through skill composition, not by building a bespoke industry tool.

**Early use cases span:** food manufacturing and distribution, healthcare, legal services, higher education, cultural institutions, and assessment/credentialing organizations — validating that the platform's skill-composition approach works across industries with radically different compliance requirements, from HIPAA to FERPA to attorney-client privilege.

**Founded by:** [Zivtech](https://zivtech.com), a 20-year technology consulting firm. Zivtech uses the platform for internal productivity and as a managed service for clients. The open source project is maintained by Zivtech and the community.

**Starting Point:** The asset sharing pipeline — a foundational layer so everything we build has somewhere to go — followed by deploying the existing MCP server, then building the platform framework.

---

## 2. Core Principles

### 2.1 Multi-Tenant from Day One

- Architecture must support N tenants with proper isolation
- A tenant may be a client organization (managed service model) or a department/team within the deploying organization (self-service model)
- Single-org and multi-org deployments share the same codebase
- Configuration, not code changes, determines access levels and tenant boundaries
- No shortcuts that assume single-tenant deployment

### 2.2 Skills as Encoded Knowledge

- Skills are **encoded organizational knowledge** — the bridge between what an organization knows and what AI agents need to act correctly
- Skills encompass multiple categories:

| Category | What it encodes | Example |
|----------|----------------|---------|
| **Guardrails** | Constraints, restrictions, anti-patterns | "Never imply a medical prognosis the care team hasn't authorized" |
| **Operational context** | Business rules, data relationships, domain facts | "Who works at each location, what each role's labor cost is" |
| **Report definitions** | Templates, metrics, thresholds, alert conditions | "Daily sales/hour by location; flag if labor exceeds 35% of sales" |
| **Voice & brand** | Writing profiles, terminology, tone, audience registers | "Match the author's citation style and vocabulary" |
| **Process logic** | Workflow steps, approval chains, quality gates | "Production batches require QA sign-off before distribution" |
| **Compliance** | Regulatory requirements, audit trails, documentation rules | "Cold chain temperature logs must be retained for 2 years" |

- Skills are **created through automated profile building** — corpus analysis produces structured profiles that the platform loads as skills (methodology proven on a client engagement: 94.6% to 97.9% attribution accuracy across 9 authors)
- Skills include anti-patterns (what NOT to do), not just positive examples
- The skill loading interface is the contract: any organization can build skills against the public API
- **Skill ecosystem:** Example/starter skills ship with the platform. Community-contributed skill packs (industry archetypes, common integrations) are welcome. Organizations build their own private skills for proprietary knowledge.

### 2.3 Sandbox by Default

- Tenant environments are isolated unless explicitly opened
- Default posture: minimal access, add permissions as needed
- Platform administrators may have full access; individual tenants get scoped permissions appropriate to their role
- All data egress from tenant environments is logged

### 2.4 Monitor Everything

We track four layers:

| Layer | What We Monitor |
|-------|-----------------|
| **Usage** | Requests, tokens, costs, task types, durations |
| **Output Accuracy** | Operational correctness (are the numbers right?), content fidelity (does it match the voice/brand?), author/voice verification, hallucination detection |
| **Guardrails** | Restriction hits, boundary friction, permission escalations, compliance violations |
| **Insights** | Trends, anomalies, skill effectiveness, engagement patterns, assumption staleness signals |

Monitoring is not optional — it's how we learn and improve. For operational use cases (reports, analysis, business intelligence), monitoring output accuracy is as critical as monitoring content fidelity is for communications use cases.

### 2.5 Feedback Loops are First-Class

- User corrections are captured, not discarded
- Corrections feed back into skill updates
- Skills improve over time based on real usage
- Version control for skills enables rollback and evolution tracking

### 2.6 Mediated AI Access

- The platform provides controlled, skill-mediated access to AI capabilities — the AI acts through the platform, not directly on the organization's systems
- Organizations that can't or shouldn't grant raw AI agent access to their systems, data, or communications use this instead
- The mediation layer is **model-agnostic by design** — skills, guardrails, monitoring, and session management work regardless of which AI model backs the agent
- Initial implementation uses Claude (via the Anthropic Agent SDK) as the primary orchestrator; the architecture supports adding other model backends without changing the skill or enforcement layer
- Same capabilities as direct AI access, different trust boundary

### 2.7 Automated Pipelines as First-Class Citizens

- The platform supports fully-automated, event-driven workflows — not just human-mediated sessions
- Automated pipelines use the same skills, quality gates, and audit trail as human sessions
- Examples: daily sales/labor reports from POS data, weekly production summaries, bug triage triggered by Jira ticket creation, compliance document generation on schedule
- The enforcement model is agent-agnostic: whether a human or an automated pipeline initiates an action, the same skills and guardrails apply
- Pipelines that modify code, client-facing content, or operational data must produce reviewable artifacts — never silent changes

### 2.8 Open Source by Default

- The platform core — orchestration, mediation layer, monitoring framework, session management, skill loading, quality gates, and multi-tenant architecture — is **open source**
- We build in the open because:
  - The mediation layer between AI and organizations is infrastructure that should be shared, not hoarded
  - Anything in the platform can realistically be rebuilt in hours by a competent team with AI — secrecy provides no durable moat
  - Community adoption, contributions, and trust are more valuable than closed-source protection
  - Open source aligns with the mission: AI that works **for and with** people, not controlled by gatekeepers
- **What stays outside the open source repo:**
  - Organization-specific skills, profiles, and corpus data (governed by Data Governance §3)
  - Proprietary skill sets (competitive differentiation through encoded expertise, not code secrecy)
  - Security-sensitive configurations (API keys, auth secrets, deployment-specific hardening)
- The boundary is **security and organizational data**, not platform capability — we don't withhold platform features to create artificial scarcity
- **Zivtech's competitive advantage** (as the founding maintainer) is 20 years of consulting expertise, client relationships, and operational know-how — not the source code. Other organizations using the platform build their own competitive advantage through their own encoded knowledge.
- License selection will balance community freedom with protection against hostile closed-source forks (e.g., AGPL, BSL, or similar copyleft license)
- **Repository separation model:**

| Repository | Visibility | Contains |
|------------|-----------|----------|
| `joyus-ai` | **Public** | Platform core: orchestration, mediation, monitoring, session management, skill loading framework, quality gates, multi-tenant architecture, example/starter skills |
| `<org>-skills` | **Private** | Organization-specific skill sets (e.g., `zivtech-skills` for consulting expertise, `<client>-skills` for per-client profiles, corpus data, brand assets) |
| `<org>-deploy` | **Private** | Production deployment configs, infrastructure secrets, organization-specific ops |

- The open source repo must **never import or depend on** private repos — the dependency flows one direction only: private repos consume the public platform as a dependency
- Example and starter skills ship with the open source repo to demonstrate the skill authoring API — these are functional but generic (e.g., `example-writing-style`, `example-daily-report`, `example-code-review`)
- Community-contributed archetype packs (e.g., food-manufacturer, seasonal-business, professional-services) are welcome in the open source repo — generic operational templates that any organization can customize
- The skill loading interface is the contract: any organization can build their own skills against the public API
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
| 2 | Internal (deploying organization) | Commercial tier+ |
| 3 | Client / Tenant Confidential | Enterprise plan, isolated environment |
| 4 | Ultra-Sensitive (PII, financial, health, legal) | Enterprise + Zero Data Retention |

### 3.2 Compliance Framework Awareness

Different industries bring different regulatory requirements. The platform must support compliance-aware data handling, not just generic tiers. Skills and tenant configurations declare which frameworks apply, and the platform enforces the corresponding constraints:

| Framework | Applies to | Key requirements the platform must enforce |
|-----------|-----------|-------------------------------------------|
| **HIPAA** | Healthcare (hospitals, clinics) | PHI encryption at rest and in transit, minimum necessary access, audit logging with 6-year retention, breach notification within 60 days, BAA-compatible architecture |
| **FERPA** | Higher education | Student record access restricted to legitimate educational interest, parental/student consent for disclosure, audit trail of all access, directory information opt-out support |
| **Attorney-client privilege** | Legal organizations | Strict isolation — privileged material never crosses tenant boundaries, no summarization that could constitute waiver, metadata handling that preserves privilege claims |
| **Assessment integrity** | Testing/credentialing orgs | Test content isolation, individual score confidentiality, ADA accommodation records protection, chain-of-custody for assessment materials |
| **FDA/USDA** | Food manufacturing | Production records retention, batch traceability, temperature/cold chain logging, recall-ready documentation |

This list is not exhaustive — the skill and tenant configuration system is designed so that new compliance frameworks can be declared without platform code changes.

### 3.3 Non-Negotiables

- **Never use organizational data for model training** — ever
- **All outputs are reviewable** before delivery to end users or clients
- **The organization retains approval authority** over outputs bearing their name
- **Audit trail required** for all tenant environment actions — granularity determined by the applicable compliance framework
- **Data stays in the tenant environment** where possible; agents receive views, not exports
- **Compliance framework violations are hard failures** — the platform must refuse to proceed rather than silently violate a declared compliance constraint

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
| Orchestrator | Claude Agent SDK (initial) | First-party, maintained by Anthropic; architecture supports other model backends (§2.6) |
| Skills | File-based + version control | Simple, auditable, git-friendly |
| Session Tracking | Entire CLI (pilot) | Git-native, MIT, no external DB; telemetry off |
| Monitoring | Langfuse + custom | Industry standard + platform-specific dashboards |

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

- New tenant deployment in <1 day
- Skill updates based on feedback within 1 week
- Monitoring catches 90% of output issues before delivery
- Zero security incidents

---

## 7. Stakeholders

| Role | Responsibilities |
|------|------------------|
| **Alex UA (CEO, Zivtech)** | Vision, priorities, project leadership |
| **Jonathan DeLaigle (CTO, Zivtech)** | Technical direction, architecture review, platform strategy |
| **Zivtech Team** | Internal users, feedback, testing, first managed-service deployments |
| **Open source community** | Contributions, bug reports, skill packs, archetype definitions, integrations |
| **Deploying organizations** | Self-service deployments, requirements, feedback, skill authoring |
| **Managed-service clients** | Requirements, brand assets, approval authority |
| **Claude Code** | Primary development environment |

---

## 8. What This Project Is NOT

- ❌ A tool for one industry — the platform works for consulting firms, food manufacturers, law offices, healthcare systems, or any organization that needs mediated AI
- ❌ A replacement for human judgment (outputs are always reviewable)
- ❌ A way to bypass organizational approval (the deploying organization retains authority)
- ❌ A data collection play (organizational data is never used for model training)
- ❌ Tied to one AI model — the mediation layer is model-agnostic; Claude is the initial backend, not the only one
- ❌ A closed platform — the core is open source; proprietary value lives in skills and encoded organizational knowledge, not code secrecy
- ❌ A crippled open-source-core with paid features bolted on — the open source repo is a complete, functional product

---

## 9. Amendment Process

This constitution can be amended by:
1. Identifying the principle to change
2. Documenting the rationale
3. Updating this document with version history
4. Communicating the change to all stakeholders

---

*Constitution Version: 1.5*
*Established: January 29, 2026*
*Last Updated: February 18, 2026*
*Changes v1.5: Open source audience rewrite — generalized "Zivtech" to "deploying organization" throughout; renamed §2.2 from "Skills as Guardrails" to "Skills as Encoded Knowledge" (skills now include operational context, business rules, report definitions, compliance, not just constraints); renamed §2.6 from "Claude Code Alternative" to "Mediated AI Access" (model-agnostic framing); added single-org and multi-org deployment models; added first validated use case (ice cream manufacturer/distributor/retailer) and early use case breadth (healthcare, legal, higher ed, museum, assessment/credentialing); expanded stakeholders to include open source community and deploying organizations; broadened monitoring to include operational accuracy; added skill ecosystem concept (community packs, archetype packs); added §3.2 Compliance Framework Awareness (HIPAA, FERPA, attorney-client privilege, assessment integrity, FDA/USDA) with hard-failure enforcement; updated Section 8 for multi-industry, model-agnostic positioning*
*Changes v1.4: Added Principle 2.8 (Open Source by Default) with repository separation model; added Principle 2.9 (Assumption Awareness) for proactive tracking of design assumptions; updated Section 8 to reflect open source posture; removed "consumer product" constraint (open source inherently broadens audience)*
*Changes v1.3: Added Principle 2.7 (Automated Pipelines as First-Class Citizens) from CTO discussion; added Jonathan DeLaigle as CTO stakeholder*
*Changes v1.2: Added client profile building as skill creation methodology, author/voice verification as content fidelity check, content markers for post-generation verification*
*Changes v1.1: Updated phase ordering (Asset Sharing → MCP Deploy → Platform → Tools), added infrastructure decisions, added session tracking*
