# Jawn AI — Zivtech AI Agent Platform

A multi-tenant AI agent platform for Zivtech consulting. Internal use and client deployments with skills-based guardrails, monitoring, and governance.

## What It Does

- **Business task automation** — presentations, financial planning, marketing, analysis, support
- **Client-specific mediation** — skills and styles that constrain AI outputs per customer
- **Monitoring & governance** — usage tracking, content fidelity checks, guardrails
- **Flexible deployment** — full access internally, sandboxed for clients

## Repository Structure

```
jawn-ai/
├── jawn-ai-plan.md              # Project plan (v2)
├── jawn-ai-mcp-server/          # MCP server — connects Claude to Jira, Slack, GitHub, Google
├── spec/                         # Spec Kitty specs
│   ├── constitution.md           # Project principles (v1.1)
│   ├── specification.md          # What to build
│   ├── plan.md                   # How to build it
│   ├── toolkit-diagnosis.md      # Current toolkit gap analysis
│   ├── toolkit-refactoring-design.md  # Refactoring approach
│   ├── internal-ai-portal-spec.md     # Internal portal spec
│   └── implementation-summary.md      # Implementation overview
├── research/                     # Technical research
│   └── jawn-ai-research.md
├── hosting-comparison.md         # Infrastructure hosting analysis
└── project-status-feb10.md       # Status snapshot
```

## Phased Roadmap

| Phase | Focus | Status |
|-------|-------|--------|
| **0** | Foundation — MCP server with Jira, Slack, GitHub, Google tools | **Complete** |
| **1** | Asset Sharing Pipeline — GitHub Pages + StatiCrypt for PoC distribution | **In Progress** |
| **2** | MCP Server Deployment — AWS EC2 + Docker Compose, CI/CD | Planned |
| **3** | Platform Framework — Next.js web app, multi-tenant, Skills/Styles, MCP Gateway | Planned |
| **4** | Additional Tools — Presentation Toolkit, Document Generator, Playwright, Spec Kitty as Service | Planned |

## Key Architecture Decisions (Feb 11, 2026)

| Decision | Choice | Rationale |
|----------|--------|-----------|
| MCP Server Hosting | AWS EC2 + Docker Compose (~$15-35/mo) | Mature MCP ecosystem, Claude can manage infra |
| Static PoC Hosting | GitHub Pages + StatiCrypt (free) | Git-native, AES-256, directory structure carries forward |
| Client Portal (Future) | Drupal-based | Role-based access, CMS content, client dashboards |
| Session Tracking | Entire CLI (pilot) | Git-native, no external DB, telemetry off |
| Git Hosting | Under evaluation | GitHub vs self-hosted (GitLab/Gitea) for disk/artifact management at scale |

## Claude Tooling Ecosystem

The platform leverages three categories of Claude capabilities:

**Skills** — Prompt-based behavior modules loaded into Claude's context (Drupal standards, brand voice, ticket writing, Spec Kitty planning, etc.)

**MCP Servers** — Tool providers via Model Context Protocol (Jira, Slack, GitHub, Google, Notion, Playwright, Memory, PowerPoint, Filesystem)

**CLI Tools** — System executables Claude invokes through the shell (python-pptx, StatiCrypt, gh CLI, Docker, Vite, SquirrelScan, Entire CLI)

## Tech Stack

| Component | Technology |
|-----------|------------|
| Orchestrator | Claude Agent SDK (Python) |
| MCP Server | Node.js / TypeScript / Express / Drizzle ORM |
| Database | PostgreSQL (encrypted token storage) |
| Web App | Next.js (Phase 3) |
| PoC Sharing | GitHub Pages + StatiCrypt |
| Infrastructure | AWS EC2 + Docker Compose |
| Development Framework | Spec Kitty |
| Integrations | Jira, Slack, GitHub, Google, Notion, Playwright |

## Sharing & Distribution

### Current: GitHub Pages + StatiCrypt
Password-protected PoC sharing via static sites. Per-project AES-256 encryption, automated CI/CD, zero server costs. Managed in [`zivtech/zivtech-demos`](https://github.com/zivtech/zivtech-demos).

### Future: Drupal Client Portal
Full-featured portal with role-based access, client dashboards, and CMS-managed content. The `projects/<name>/` directory convention from Phase 1 maps directly to Drupal content types.

## Development

This project uses [Spec Kitty](https://github.com/Priivacy-ai/spec-kitty) for spec-driven development. See `spec/` for the full specification.

### MCP Server

The MCP server lives in `jawn-ai-mcp-server/`. See its [README](jawn-ai-mcp-server/README.md) for setup and configuration.

## Related Repos

- [`zivtech/zivtech-demos`](https://github.com/zivtech/zivtech-demos) — Password-protected demo hosting (GitHub Pages + StatiCrypt)
- [`zivtech/claude-presentation-toolkit`](https://github.com/zivtech/claude-presentation-toolkit) — Presentation generation skill
- [`zivtech/drupal-brand-skill`](https://github.com/zivtech/drupal-brand-skill) — Drupal-specific brand design skill
- [`zivtech/zivtech-claude-skills`](https://github.com/zivtech/zivtech-claude-skills) — Shared Claude skills library
