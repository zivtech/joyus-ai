# Zivtech AI Platform — Project Status (Feb 10, 2026)

## Repository State

**Repo:** [zivtech/jawn-ai](https://github.com/zivtech/jawn-ai) on GitHub
**Branch:** `main`
**Last commit:** `78e4277` — Add project README
**Status:** All work committed and pushed. Clean working tree.

---

## What's Been Built

### 1. Project Planning & Spec (Complete)
- **Project Plan v2** (`jawn-ai-plan.md`) — Full roadmap with phased approach, cost model, data governance, success criteria
- **Spec Kitty Framework** — Constitution, specification, plan, and toolkit diagnosis all documented in `spec/`
- **Implementation Plan** — 6-phase, 6-8 week plan in `jawn-ai-mcp-server/docs/IMPLEMENTATION_PLAN.md`
- **Platform Architecture** — Full architecture doc with diagrams in `jawn-ai-mcp-server/docs/`
- **Technical Research** — Manus architecture analysis, cost modeling, tooling research in `research/`

### 2. MCP Server (Phase 0 — Foundation Built)
**Location:** `jawn-ai-mcp-server/`
**Stack:** Node.js + TypeScript + Express + Drizzle ORM + PostgreSQL

**Working components:**
- OAuth authentication (Google SSO, Jira, Slack, GitHub)
- MCP protocol endpoint (`/mcp`) with JSON-RPC
- Tool executors for all 4 services:
  - **Jira** — search, get issue, my issues, comment, transitions, list projects
  - **Slack** — search, channel history, post, list channels, user info, threads
  - **GitHub** — search code, PRs, issues, repos, file contents, comments
  - **Google** — Gmail search/send/reply, Drive search, Docs content
- Scheduled tasks system (cron-based) for standup summaries, overdue alerts, sprint reports, digests, etc.
- Database schema with encrypted token storage (AES-256)
- Docker configuration (Dockerfile + docker-compose)
- Audit logging

### 3. Presentation Toolkit (Separate Repos)
Managed in their own repositories (not in jawn-ai):
- **`zivtech/claude-presentation-toolkit`** — Modular Python toolkit (~3,655 lines) for content extraction, template analysis, classification, migration planning, assembly, validation
- **`zivtech/drupal-brand-skill`** — Drupal brand integration bridge

### 4. Platform Overview UI
- Interactive React/JSX artifact showing the platform vision (`jawn-ai-platform-overview.jsx`)
- Skills marketplace architecture design (`zivtech-skills-marketplace-architecture.html`)

---

## What the Previous Sessions Worked On

**Feb 10:**
- Git housekeeping — committed all work, set up `.gitignore`, pushed to GitHub
- Added project README
- Updated this status doc

**Feb 1 (last coding session):**
- Scheduler enhancements — `notifications.ts` and `routes.ts` updated
- Auth routes — Updated `routes.ts` in auth module
- Implementation plan & architecture docs — Created detailed phase-by-phase plan
- Architecture diagrams — Mermaid diagrams for data model, system architecture, user flow, improvement loop

The project is in **Phase 0 → Phase 1 transition** — the foundation MCP server is built and ready for core platform enhancements.

---

## What Needs to Happen Next

### Phase 1: Core Platform Enhancements (per Implementation Plan)

1. **Database Schema Extensions** — Add conversations, messages, tool_executions, and confusion_events tables
2. **Claude API Integration Service** — `src/services/claude.ts` for streaming chat with tool use
3. **API Routes for Web App** — REST endpoints for conversations and messages
4. **WebSocket/SSE Infrastructure** — Real-time streaming for Claude responses

### Phase 1 (Parallel): Presentation Toolkit
1. **Design System Ingestion** — Parse client brand assets (colors, fonts, logos)
2. **Template Processing** — Extract master slides and layouts from PPT templates
3. **Content Extraction** — Parse source docs (PPT/PDF/Word) into structured content
4. **Slide Generation + PPTX Output** — Content to branded slides
5. **Skill Packaging** — Package as Claude Code/Cowork skill

### Phase 2: Web Application + Platform Framework
- Next.js web app with chat interface
- Multi-tenant infrastructure
- Skills/Styles system for client-specific mediation
- MCP Gateway for auth, routing, logging
- Monitoring for usage and content fidelity

### Phases 3+: Additional tools, browser automation, improvement system, admin dashboard, production launch

---

## Environment Requirements

To run the MCP server locally:
- Node.js 20+
- PostgreSQL
- OAuth credentials for Jira, Slack, GitHub, Google (see `jawn-ai-mcp-server/.env.example`)
