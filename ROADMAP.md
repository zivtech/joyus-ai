# Joyus AI — Roadmap

An open-source, multi-tenant AI agent platform that encodes organizational knowledge as testable, enforceable skills.

---

## Shipped

- **MCP Server** — OAuth authentication, tool executors for project management, chat, code hosting, and productivity integrations. Docker deployment.
- **Session Context Management** — Event-driven state snapshots, context handoff across session compaction, resume protocols.
- **Workflow Enforcement** — Quality gates, permission escalation, kanban state machine with enforced transitions.
- **Web Chat UI** — Browser-based chat interface with Claude Desktop configuration.
- **Content Intelligence** — Corpus analysis, 129-feature stylometric extraction, structured writing profiles with hierarchical composition (person → department → organization), multi-audience voice support, fidelity verification, drift monitoring, and repair. 500+ tests across the full pipeline.

## In Development

- **Content Infrastructure** — Corpus connector interface, search abstraction layer, content state management, access level mapping, AI-optimized content API for bot mediation.

## Planned

- **Platform Framework** — Multi-tenant web portal, skill-based mediation, thin orchestration layer, monitoring infrastructure.
- **Fast Casual Operations Module** — Multi-location staffing planner with manager/CEO approval gates and server-side Square publish (dry-run + apply), tenant-isolated and fully audited.
- **Compliance Modules** — HIPAA, FERPA, attorney-client privilege, assessment integrity, FDA/USDA — declared per tenant, enforced as hard failures.
- **Automated Pipelines** — Event-driven workflows: regulatory change detection, scheduled reports, content update routing, quality gate automation.
- **Self-Service Profile Building** — Upload writing samples, receive a usable writing skill. Automatic tier detection with progression guidance.
- **AI-Assisted Generation** — Content generation using profiles as constraints for voice-consistent output (builds on Content Intelligence foundation).
- **Multi-Tenant Profile Isolation** — Tenant-scoped profile storage, access control, and audit logging for the profile engine.
- **Profile Engine at Scale** — Batch ingestion, caching, and latency optimization for large corpora and high-throughput verification.
- **Asset Sharing Pipeline** — Secure delivery of AI-generated artifacts behind access control.

## Roadmap

- Presentation Toolkit (branded slides, deck rebranding)
- Document Generator (reports, proposals, memos — DOCX, PDF)
- Analysis Tools (financial modeling, gap analysis, research synthesis)
- Regulatory Change Detection Pipeline
- Expert Voice Routing
- Visual Regression & Accessibility Testing Service
- Content Staging & Deployment Pipeline
- Knowledge Base Ingestion (XML, CMS, web, archives)
- Attribution Service (standalone authorship analysis)
- Code Execution Sandbox

## Under Evaluation

- Industry-specific pipeline integrations
- Compliance framework extensions
- Enriched expert profiles (subject matter domains, citation networks)
- Plugin compatibility layer (Cowork/Claude Code plugin format)
- Managed hosting

---

*Platform core is open source. Constitution v1.6 published.*
*github.com/joyus-ai/joyus-ai*
