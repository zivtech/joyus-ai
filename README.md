# Jawnus — Zivtech AI Agent Platform

A multi-tenant AI agent platform for Zivtech consulting. Internal use and client deployments with skills-based guardrails, monitoring, and governance.

## What It Does

- **Business task automation** — presentations, financial planning, marketing, analysis, support
- **Client-specific mediation** — skills and styles that constrain AI outputs per customer
- **Monitoring & governance** — usage tracking, content fidelity checks, guardrails
- **Flexible deployment** — full access internally, sandboxed for clients

## Repository Structure

```
jawnus/
├── zivtech_ai_analyst_plan.md    # Project plan (v2)
├── zivtech-ai-mcp-server/       # MCP server — connects Claude Desktop to Jira, Slack, GitHub, Google
├── spec/                         # Spec Kitty specs
│   ├── constitution.md           # Project principles
│   ├── specification.md          # What to build
│   ├── plan.md                   # How to build it
│   ├── toolkit-diagnosis.md      # Current toolkit gap analysis
│   ├── toolkit-refactoring-design.md  # Refactoring approach
│   ├── internal-ai-portal-spec.md     # Internal portal spec
│   └── implementation-summary.md      # Implementation overview
├── research/                     # Technical research
│   └── zivtech_ai_analyst_research.md
├── zivtech-ai-platform-overview.jsx          # Platform overview (React component)
├── zivtech-skills-marketplace-architecture.html  # Skills marketplace design
└── project-status-feb10.md       # Current status
```

## Phased Roadmap

| Phase | Focus | Status |
|-------|-------|--------|
| **1** | Presentation Toolkit — Claude Code/Cowork skill for branded slide generation | Active |
| **2** | Platform Framework — multi-tenant infra, skills system, MCP gateway, monitoring | Planned |
| **3** | Additional Tools — document gen, analysis, research, support tools | Planned |

## Tech Stack

| Component | Technology |
|-----------|------------|
| Orchestrator | Claude Agent SDK (Python) |
| MCP Server | Node.js / TypeScript / Express |
| Development Framework | Spec Kitty |
| Integrations | Jira, Slack, GitHub, Google (Gmail, Drive, Docs) |

## Development

This project uses [Spec Kitty](https://github.com/Priivacy-ai/spec-kitty) for spec-driven development. See `spec/` for the full specification.

### MCP Server

The MCP server lives in `zivtech-ai-mcp-server/`. See its [README](zivtech-ai-mcp-server/README.md) for setup and configuration.

## Related Repos

These repos are managed separately and not included in this repository:

- `zivtech/claude-presentation-toolkit` — Presentation generation skill (WIP)
- `zivtech/drupal-brand-skill` — Drupal-specific brand design skill
- `zivtech/zivtech-claude-skills` — Shared Claude skills library
