# Joyus AI — Open-Source Multi-Tenant AI Agent Platform

[![License](https://img.shields.io/badge/License-Apache_2.0-blue.svg)](LICENSE)

Joyus AI is an open-source platform for deploying AI agents with skills-based mediation, content intelligence, and multi-tenant governance. Founded by [Zivtech](https://zivtech.com).

## Overview

Most AI deployments are undifferentiated: the same model, the same defaults, the same outputs for every user and every organization. Joyus AI inverts that by making organizational knowledge a first-class platform primitive.

**Core ideas:**

- **Skills as encoded knowledge** — organizational standards, voice guidelines, domain rules, and workflow constraints are packaged as skills that constrain and guide AI outputs
- **Content intelligence** — writing profiles built from real corpora enable attribution, fidelity monitoring, and voice-consistent generation
- **Open core, private skills** — the platform is open source; client- and org-specific skills live in private repos and are loaded at runtime
- **MCP-native** — all agent capabilities are exposed via the [Model Context Protocol](https://modelcontextprotocol.io), making them composable with Claude and other MCP-aware tools

## Architecture

```
┌─────────────────────────────────────────────────┐
│                  Claude / AI Client              │
└────────────────────────┬────────────────────────┘
                         │ MCP
          ┌──────────────┼──────────────┐
          │              │              │
  ┌───────▼──────┐ ┌─────▼──────┐ ┌───▼────────────────┐
  │  MCP Server  │ │   State    │ │  Profile Engine     │
  │  (Express)   │ │  Package   │ │  (Python)           │
  └───────┬──────┘ └─────┬──────┘ └───┬────────────────┘
          │              │             │
  ┌───────▼──────────────▼─────────────▼───────────┐
  │          Skills · Profiles · Session State      │
  └─────────────────────────────────────────────────┘
```

- The MCP server is the primary interface between AI clients and platform capabilities.
- The state package maintains session continuity across Claude sessions and compactions.
- The profile engine ingests author corpora, extracts stylometric features, and builds structured writing profiles used for generation, attribution, and fidelity checking.
- Skills are modular prompt fragments loaded at runtime; org-specific skills live outside this repo.

## Packages

### `joyus-ai-mcp-server/` — Remote MCP Server

Express-based MCP server hosting platform tools and operator-defined skills. Connects to external services (issue trackers, version control, messaging) and exposes them as MCP tools.

- TypeScript / Node.js / Express
- Drizzle ORM + PostgreSQL for persistent state
- Deployable via Docker Compose on any cloud VM

### `joyus-ai-state/` — Session State

Maintains working state across Claude sessions. Captures git context, open files, decisions, and test status so Claude can restore context at session start without manual re-orientation.

MCP tools exposed:
- `get_context` — restore working state at session start
- `save_state` — snapshot after significant actions
- `verify_action` — pre-commit guardrails
- `check_canonical` — route to authoritative document copies
- `share_state` — share context with teammates

### `joyus-profile-engine/` — Writing Profile Engine (Python)

Analyzes author corpora to produce structured writing profiles. Profiles power consistent voice generation, authorship attribution, and fidelity monitoring.

Capabilities:
- Corpus ingestion and preprocessing (Python 3.11–3.12, spaCy, faststylometry)
- Stylometric analysis — function word distributions, sentence statistics, vocabulary richness, structural patterns
- Marker extraction — vocabulary, audience markers, structural markers
- Profile generation and skill emission (Pydantic v2 schemas)
- Inline and deep fidelity verification with scored feedback
- Hierarchical profiles — composite builder, hierarchy management, cascade attribution
- Voice context resolution — per-audience profile layering (Formal, Accessible, Technical, Persuasive)
- Drift monitoring — pipeline, 5-signal drift detection, rollups, diagnosis, and repair

MCP tools exposed (via `joyus-profile-engine serve`):
- `build_profile` — ingest corpus and build a writing profile
- `get_profile` — retrieve a stored profile
- `compare_profiles` — diff two profiles for similarity or divergence
- `verify_content` — check a piece of writing against a profile
- `check_fidelity` — score fidelity and return actionable repair suggestions
- Monitoring tools — drift detection, rollup queries, repair recommendations

### `web-chat/` — Chat UI

Minimal browser-based chat interface for local development and demonstration. Not intended for production use.

## Getting Started

**Prerequisites:** Node.js 20+, Python 3.11–3.12, Docker (optional), uv (for Python)

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

### Profile Engine

```bash
cd joyus-profile-engine
uv venv --python 3.12
source .venv/bin/activate
uv pip install -e ".[dev]"
python -m spacy download en_core_web_md

# Run tests
pytest tests/

# Start MCP server
python -m joyus_profile serve
```

### Full Stack (Docker)

```bash
cd deploy
docker compose up
```

See `deploy/` for environment variable documentation and health-check scripts.

## Specs and Development

This project uses [Spec Kitty](https://github.com/Priivacy-ai/spec-kitty) for spec-driven development. Feature specifications live in `kitty-specs/`:

| Spec | Description | Status |
|------|-------------|--------|
| `001` | MCP Server AWS Deployment | Complete |
| `002` | Session Context Management | Complete |
| `004` | Workflow Enforcement | Complete |
| `005` | Content Intelligence (Profile Engine) | Complete (Phases A–C, WP01–WP14) |

Project-level architecture decisions, implementation plan, and constitution are in `spec/`.

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) for development setup, branch conventions, and contribution guidelines.

Please read our [Code of Conduct](CODE_OF_CONDUCT.md) before participating.

## License

Apache License 2.0 — see [LICENSE](LICENSE) for details.
