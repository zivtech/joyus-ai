# Joyus AI Roadmap

Joyus AI is an open-core, multi-tenant AI agent platform. This roadmap now distinguishes between public-core roadmap lanes and private companion lanes so the public repository does not blur platform capability with private implementation surfaces.

---

## Public Core: Shipped

- **MCP Server Core**: OAuth authentication, integration executors, Dockerized runtime, and Claude Desktop connectivity.
- **Session Context Management**: Event-driven state snapshots, context restoration, canonical-document handling, and companion-service support.
- **Workflow Enforcement**: Quality gates, skill enforcement, git guardrails, audit trail infrastructure, and MCP enforcement tools.
- **Web Chat UI**: Thin browser chat surface for local development and demonstrations.
- **Content Infrastructure**: Connector abstraction, sync engine, search layer, entitlements, mediation APIs, observability, and content MCP tools.
- **Inngest Evaluation Spike**: Public validation of durable workflow execution against the custom pipeline runtime.

## Public Core: Active

- **Org-Scale Agentic Governance**: Governance baseline, remediation backlog, metadata contracts, CI checks, and autonomy policy work.
- **Automated Pipelines Framework**: Public pipeline runtime remains in progress while the migration path is finalized.
- **Inngest Migration**: Planned public cutover from the custom pipeline runtime to the Inngest-based execution path.
- **Profile Isolation and Scale**: Public planning stream for tenant-safe profile infrastructure around the private profile engine.

## Public Core: Roadmap Lanes

- **Platform Framework**: Multi-tenant web portal, skill-mediated access, and shared monitoring surfaces.
- **Regulatory Change Detection Pipeline**: Event-driven detection and routing for compliance-sensitive source changes.
- **Knowledge Base Ingestion**: XML, CMS, web, and archive ingestion into the public knowledge infrastructure.
- **Code Execution Sandbox**: Isolated execution surface for high-trust automation and tool use.
- **Plugin Compatibility Layer**: Compatibility surface for external plugin ecosystems and agent formats.
- **Compliance Modules**: Public framework support for tenant-declared compliance regimes.
- **Compliance Framework Extensions**: Additional cross-industry compliance building blocks layered onto the public core.
- **Visual Regression and Accessibility Testing Service**: Public testing service for UI quality and accessibility workflows.

## Private Companion Lanes

- **Content Intelligence Runtime**: The `joyus-profile-engine` implementation remains a private companion even though its specification is public.
- **Asset Sharing Pipeline**: Secure artifact delivery and access-controlled sharing workflows.
- **Managed Hosting**: Hosted deployment offering and environment-specific operational packaging.
- **Multi-Location Operations Module**: Staffing, approvals, and operational publishing flows.
- **Content Staging and Deployment Pipeline**: Tenant-specific publishing and release workflows.
- **Structured Knowledge Capture and Artifact Lifecycle Management**: Internal capture, storage, and lifecycle tooling.
- **AI-Assisted Research and Decision Documentation Tooling**: Private research support surfaces and decision-record tooling.
- **Expert Voice Routing**: Proprietary routing over private voice/profile assets.
- **Self-Service Profile Building**: Private user-facing profile-builder experience on top of the companion engine.
- **AI-Assisted Generation**: Private generation products built on proprietary profiles and corpora.
- **Profile Engine at Scale**: Scaling work for the private profile-engine runtime.
- **Attribution Service**: Standalone authorship-analysis product surface.

---

Platform core remains open source. Private repos continue to hold proprietary skills, corpora, deployment hardening, and companion application surfaces.
