# Joyus AI - Roadmap

An open-source, multi-tenant AI agent platform that encodes organizational knowledge as testable, enforceable skills.

---

## Shipped

- **MCP Server Core** (Spec 001) - OAuth authentication, tool executors for project management, chat, code hosting, and productivity integrations. Dockerized runtime available.
- **Session Context Management** (Spec 002) - Event-driven state snapshots, context handoff across session compaction, resume protocols.
- **Workflow Enforcement** (Spec 004) - Quality gates, permission escalation, and traceable workflow guardrails.
- **Web Chat UI** - Browser-based chat interface with Claude Desktop configuration support.
- **Content Intelligence** (Spec 005) - Corpus analysis, stylometric extraction, structured writing profiles, fidelity verification, drift monitoring, and repair.
- **Content Infrastructure** (Spec 006) — Corpus connector interface, search abstraction layer, content state management, access level mapping, AI-optimized content API for bot mediation.

## In Development

- **Org-Scale Agentic Governance** (Spec 007) — Maturity scoring, spec lifecycle enforcement, CI-integrated governance gates, remediation tracking. (`planning`)
- **Inngest Migration** (Spec 011) — Replace custom pipeline execution engine with Inngest via clean cutover. (`spec-only`)

## Spec-Only (Defined, Not Yet in Execution)

- **Platform Architecture Overview** (Spec 003) — Umbrella specification for all 11 platform capability domains.
- **Profile Isolation and Scale** (Spec 008) — Multi-tenant profile isolation, versioning, inheritance, self-service corpus intake, and caching for the profile engine.
- **Automated Pipelines Framework** (Spec 009) — Event-driven pipeline execution with triggers, retry policies, review gates, templates, and analytics.

## Planned

- **Inngest Evaluation Spike** (Spec 010) — Research spike evaluating Inngest as a replacement for the custom pipeline execution engine.
- **Platform Framework** — Multi-tenant web portal, skill-based mediation, thin orchestration layer, monitoring infrastructure.
- **Multi-Location Operations Module** — Staffing planner with manager approval gates and server-side POS publish (dry-run + apply), tenant-isolated and fully audited.
- **Compliance Modules** — HIPAA, FERPA, attorney-client privilege, assessment integrity, FDA/USDA — declared per tenant, enforced as hard failures.
- **Self-Service Profile Building** — Upload writing samples, receive a usable writing skill. Automatic tier detection with progression guidance.
- **AI-Assisted Generation** — Content generation using profiles as constraints for voice-consistent output (builds on Content Intelligence foundation).
- **Asset Sharing Pipeline** — Secure delivery of AI-generated artifacts behind access control.

## Roadmap

- Presentation Toolkit (branded slides, deck rebranding)
- Document Generator (reports, proposals, memos - DOCX, PDF)
- Analysis Tools (financial modeling, gap analysis, research synthesis)
- Regulatory Change Detection Pipeline
- Expert Voice Routing
- Visual Regression and Accessibility Testing Service
- Content Staging and Deployment Pipeline
- Knowledge Base Ingestion (XML, CMS, web, archives)
- Attribution Service (standalone authorship analysis)
- Code Execution Sandbox

## Under Evaluation

- Structured knowledge capture and artifact lifecycle management
- AI-assisted research and decision documentation tooling
- Industry-specific pipeline integrations
- Compliance framework extensions
- Enriched expert profiles (subject matter domains, citation networks)
- Plugin compatibility layer (Cowork/Claude Code plugin format)
- Managed hosting

---

*Platform core is open source. Constitution v1.8 published.*
*github.com/joyus-ai/joyus-ai*
