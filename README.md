# Jawn AI — Zivtech AI Agent Platform

A multi-tenant AI agent platform for Zivtech consulting. Internal use and client deployments with skills-based guardrails, monitoring, and governance.

## What It Does

- **Session & context management** — AI agents maintain awareness across sessions, compactions, and crashes
- **Business task automation** — presentations, financial planning, marketing, analysis, support
- **Client-specific mediation** — skills and styles that constrain AI outputs per customer
- **Monitoring & governance** — usage tracking, content fidelity checks, guardrails
- **Flexible deployment** — full access internally, sandboxed for clients

## Active Development: Session & Context Management

The current focus is **Spec 1 of 2**: an invisible mediator layer that lets Claude maintain working state across sessions. The user never interacts with jawn-ai directly — Claude is the UI.

**Architecture**: MCP server (primary interface) + companion service (background state capture). User setup: add the MCP server to Claude Desktop/Code and run the companion service. That's it.

**MCP Tools** (what Claude calls on behalf of users):
- `get_context` — restore working state at session start
- `save_state` — capture snapshot after significant actions
- `verify_action` — pre-commit guardrails (branch verification, canonical conflicts)
- `check_canonical` — route to authoritative file copies, prevent document divergence
- `share_state` — share context with teammates for troubleshooting

**Status**: Fully specified and planned. 38 subtasks across 9 work packages, ready for implementation. See `kitty-specs/002-session-context-management/` for full spec, plan, and task breakdown.

## Repository Structure

```
jawn-ai/
├── jawn-ai-mcp-server/                    # Remote MCP server (Jira, Slack, GitHub, Google)
├── jawn-ai-state/                         # Session state package (in development)
│   ├── src/
│   │   ├── core/                          # Types, schemas, config
│   │   ├── state/                         # Store, canonical, sharing, divergence
│   │   ├── collectors/                    # Git, files, tests, decisions
│   │   ├── mcp/                           # MCP server + 5 tools (primary interface)
│   │   └── service/                       # Companion service (background capture)
│   ├── bin/
│   │   ├── jawn-ai-mcp                    # MCP server entry point
│   │   └── jawn-ai-service                # Companion service entry point
│   └── tests/
├── kitty-specs/                           # Feature specifications (Spec Kitty)
│   ├── 001-mcp-server-aws-deployment/     # Phase 2 — remote MCP server hosting
│   └── 002-session-context-management/    # Spec 1 — session state (active)
│       ├── spec.md                        # Requirements & user stories
│       ├── plan.md                        # Architecture & phasing
│       ├── data-model.md                  # Entity definitions
│       ├── contracts/state-api.md         # MCP tool API contracts
│       ├── quickstart.md                  # Setup & verification guide
│       ├── tasks.md                       # Work package overview (9 WPs, 38 tasks)
│       └── tasks/WP01-*.md ... WP09-*.md  # Detailed work package prompts
├── research/                              # Technical research & analysis
│   ├── existing-projects-landscape.md     # 50+ project landscape analysis
│   └── jawn-ai-session-context-pitch.md   # Session context feature pitch
├── spec/                                  # Project-level specs
│   ├── constitution.md                    # Project principles (v1.2)
│   └── ...                                # Phase 3-4 specs
├── jawn-ai-requirements-brief.md          # Requirements brief (from nclclib analysis)
└── jawn-ai-plan.md                        # Project plan (v2)
```

## Phased Roadmap

| Phase | Focus | Status |
|-------|-------|--------|
| **0** | Foundation — MCP server with Jira, Slack, GitHub, Google tools | **Complete** |
| **1** | Asset Sharing Pipeline — GitHub Pages + StatiCrypt for PoC distribution | **In Progress** |
| **S1** | Session & Context Management — MCP-first state persistence for Claude | **Specified** (9 WPs ready) |
| **2** | MCP Server Deployment — Full MCP suite + skill runtime on AWS EC2 | Specified |
| **2.5** | Activepieces Integration — Visual workflow automation, 200+ integrations, webhook triggers | Planned |
| **S2** | Workflow Enforcement — Quality gates, skill routing, branch verification | Planned |
| **3** | Platform Framework — Next.js web app, multi-tenant, Skills/Styles, MCP Gateway, code sandbox, job management | Planned |
| **4** | Additional Tools — Presentation Toolkit, Document Generator, Analysis Tools, Visual Regression Testing, Spec Kitty as Service | Planned |

## Key Architecture Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Session State Interface | MCP server (primary) | Users never run CLI commands; Claude calls MCP tools |
| Session State Capture | Companion service (daemon) | Background fs watching for git events; MCP can't do long-running processes |
| State Storage | JSON files at `~/.jawn-ai/` | Per-developer, offline, no external DB, 2-10KB per snapshot |
| MCP Server Hosting | AWS EC2 + Docker Compose (t3.medium, ~$33/mo) | Mature MCP ecosystem, Claude can manage infra |
| Static PoC Hosting | GitHub Pages + StatiCrypt (free) | Git-native, AES-256, directory structure carries forward |
| Enterprise Features | Claude Enterprise (not duplicated) | Audit logging, cost tracking, compliance handled by Enterprise |

## Claude Tooling Ecosystem

**Skills** — Prompt-based behavior modules loaded into Claude's context (Drupal standards, brand voice, ticket writing, Spec Kitty planning, etc.)

**MCP Servers** — Tool providers via Model Context Protocol (Jira, Slack, GitHub, Google, jawn-ai-state, Activepieces (~400 tools), Playwright+Backstop.js, Memory, Office)

**CLI Tools** — System executables Claude invokes through the shell (python-pptx, StatiCrypt, gh CLI, Docker, Vite, SquirrelScan)

## Tech Stack

| Component | Technology |
|-----------|------------|
| Session State | TypeScript 5.3+ / Node.js 20+ / `@modelcontextprotocol/sdk` / Zod |
| Remote MCP Server | Node.js / TypeScript / Express / Drizzle ORM / PostgreSQL |
| Orchestrator | Claude Agent SDK |
| Web App | Next.js (Phase 3) |
| PoC Sharing | GitHub Pages + StatiCrypt |
| Workflow Automation | Activepieces (self-hosted, MIT) |
| Infrastructure | AWS EC2 + Docker Compose |
| Development Framework | Spec Kitty |

## Development

This project uses [Spec Kitty](https://github.com/Priivacy-ai/spec-kitty) for spec-driven development. Feature specs live in `kitty-specs/`.

### Session State Package (jawn-ai-state)

The session state system is specified in `kitty-specs/002-session-context-management/`. Implementation is organized as 9 work packages across 3 phases:

- **Phase 1 — Foundation**: Core types, state store, collectors, canonical docs, sharing (WP01-WP05)
- **Phase 2 — Primary Interface**: MCP server + tools, companion service (WP06-WP08, parallel)
- **Phase 3 — Integration**: E2E tests, concurrency, error hardening, logging (WP09)

**MVP**: WP01 + WP02 + WP03 + WP06 = foundation + MCP server with `get_context`, `save_state`, `verify_action`.

### Remote MCP Server (jawn-ai-mcp-server)

The remote MCP server lives in `jawn-ai-mcp-server/`. See its [README](jawn-ai-mcp-server/README.md) for setup and configuration.

## Related Repos

- [`zivtech/zivtech-demos`](https://github.com/zivtech/zivtech-demos) — Password-protected demo hosting (GitHub Pages + StatiCrypt)
- [`zivtech/claude-presentation-toolkit`](https://github.com/zivtech/claude-presentation-toolkit) — Presentation generation skill
- [`zivtech/drupal-brand-skill`](https://github.com/zivtech/drupal-brand-skill) — Drupal-specific brand design skill
- [`zivtech/zivtech-claude-skills`](https://github.com/zivtech/zivtech-claude-skills) — Shared Claude skills library
