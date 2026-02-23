# Joyus AI - Open-Source Multi-Tenant AI Agent Platform

[![License](https://img.shields.io/badge/License-Apache_2.0-blue.svg)](LICENSE)

Joyus AI is an open-source platform for deploying AI agents with skills-based mediation, content intelligence, and multi-tenant governance. Founded by [Zivtech](https://zivtech.com).

## Overview

Most AI deployments are undifferentiated: the same model, the same defaults, the same outputs for every user and every organization. Joyus AI inverts that by making organizational knowledge a first-class platform primitive.

**Core ideas:**

- **Skills as encoded knowledge** - organizational standards, voice guidelines, domain rules, and workflow constraints are packaged as skills that constrain and guide AI outputs
- **Content intelligence** - writing profiles built from real corpora enable attribution, fidelity monitoring, and voice-consistent generation
- **Open core, private skills** - the platform is open source; client- and org-specific skills live in private repos and are loaded at runtime
- **MCP-native** - all agent capabilities are exposed via the [Model Context Protocol](https://modelcontextprotocol.io), making them composable with Claude and other MCP-aware tools

## Architecture

```text
┌─────────────────────────────────────────────────┐
│                  Claude / AI Client             │
└────────────────────────┬────────────────────────┘
                         │ MCP
               ┌─────────┴─────────┐
               │                   │
       ┌───────▼──────┐    ┌──────▼───────┐
       │  MCP Server  │    │    State     │
       │  (Express)   │    │   Package    │
       └───────┬──────┘    └──────┬───────┘
               │                  │
       ┌───────▼──────────────────▼───────┐
       │ Skills · Profiles · Session State│
       └───────────────────────────────────┘
```

- The MCP server is the primary interface between AI clients and platform capabilities.
- The state package maintains session continuity across Claude sessions and compactions.
- The content intelligence system (writing profiles, fidelity verification, drift monitoring) is maintained in a separate private package.
- Skills are modular prompt fragments loaded at runtime; org-specific skills live outside this repo.
- Additional capabilities — including structured knowledge capture, interactive research tooling, and artifact lifecycle management — are under active development in private repositories.

## Packages

### `joyus-ai-mcp-server/` - Remote MCP Server

Express-based MCP server hosting platform tools and operator-defined skills. Connects to external services (issue trackers, version control, messaging) and exposes them as MCP tools.

- TypeScript / Node.js / Express
- Drizzle ORM + PostgreSQL for persistent state
- Deployable via Docker Compose on any cloud VM

### `joyus-ai-state/` - Session State

Maintains working state across Claude sessions. Captures git context, open files, decisions, and test status so Claude can restore context at session start without manual re-orientation.

MCP tools exposed:
- `get_context` - restore working state at session start
- `save_state` - snapshot after significant actions
- `verify_action` - pre-commit guardrails
- `check_canonical` - route to authoritative document copies
- `share_state` - share context with teammates

### `web-chat/` - Chat UI

Minimal browser-based chat interface for local development and demonstration. Not intended for production use.

## Getting Started

**Prerequisites:** Node.js 20+, Docker (optional)

### MCP Server

```bash
cd joyus-ai-mcp-server
npm install
cp .env.example .env   # configure database and service credentials
npm run build
npm start
```

### State Package

```bash
cd joyus-ai-state
npm install
npm run build
# Add joyus-ai-mcp (MCP server binary) to your Claude Desktop / Code MCP config
```

### Full Stack (Docker)

Production deployment configuration is maintained in a separate private repository. For local development, see the per-package instructions above.

## Specs and Development

This project uses [Spec Kitty](https://github.com/Priivacy-ai/spec-kitty) for spec-driven development. Feature specifications live in `kitty-specs/`.

Current status snapshot (source: `python scripts/pride-status.py` on 2026-02-23):

| Spec | Description | Status |
|---|---|---|
| `001` | MCP Server AWS Deployment | In Progress (5/7 work packages complete) |
| `002` | Session Context Management | Done |
| `003` | Platform Architecture Overview | Spec-Only |
| `004` | Workflow Enforcement | Done |
| `005` | Content Intelligence (Profile Engine) | Done |
| `006` | Content Infrastructure | Done |
| `007` | Org-Scale Agentic Governance | Planning |

Project-level architecture decisions, implementation plan, and constitution are in `spec/`.

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) for development setup, branch conventions, and contribution guidelines.

Please read our [Code of Conduct](CODE_OF_CONDUCT.md) before participating.

## License

Apache License 2.0 - see [LICENSE](LICENSE) for details.
