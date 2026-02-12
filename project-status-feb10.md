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

## New Requirements (Added Feb 11)

### PoC Asset Sharing
**Decision:** StatiCrypt for near-term password-protected sharing of PoC websites/web apps. AES-256 encryption, zero server deps, CI encrypts on push. Directory-based structure carries forward to eventual Drupal portal.

### Session Tracking
**Decision:** Entire CLI for git-native AI chat session tracking. Pilot on jawn-ai with telemetry disabled and manual-commit strategy. Review captured data for 2 weeks before broader rollout. ✅ Telemetry set to `false` in `.entire/settings.json`.

### Hosting
**Decision:** MCP server on AWS EC2 (Docker Compose, ~$15-35/mo). Static PoCs on GitHub Pages + StatiCrypt (free). Drupal PoCs on existing tools (Multidev/Tugboat/Probo.ci). AWS chosen over GCP for its significantly more mature MCP ecosystem — 45+ official servers enable Claude to help manage infrastructure.

See `hosting-comparison.md` for full analysis and `jawn-ai-plan.md` → "Infrastructure Requirements" for details.

---

## What Needs to Happen Next

### IMMEDIATE: Asset Sharing Pipeline (Phase 1 — NEW PRIORITY)

1. **GitHub Pages Setup** — Create repo/branch, enable Pages
2. **StatiCrypt CI Pipeline** — GitHub Actions: encrypt on push, per-project passwords in Secrets
3. **Directory Conventions** — Establish project structure, document password management
4. **First Asset Deployed** — Sample HTML page + PDF, verify password protection works

**Why first:** Everything we build with Claude needs somewhere to share it. This is the foundational layer.

### THEN: Phase 2 — MCP Server Deployment
- Deploy existing MCP server to AWS EC2 (Docker Compose)
- GitHub Actions CI/CD pipeline
- All tool executors verified in production

### Phase 3: Platform Framework
- Next.js web app with chat interface + Google SSO
- Multi-tenant infrastructure
- Skills/Styles system for client-specific mediation
- MCP Gateway for auth, routing, logging
- Monitoring for usage and content fidelity

### Phase 4: Additional Tools (Future)
- Presentation Toolkit (rebrand decks, generate slides)
- Document Generator, Analysis Tools, Spec Kitty as Service

---

## Environment Requirements

To run the MCP server locally:
- Node.js 20+
- PostgreSQL
- OAuth credentials for Jira, Slack, GitHub, Google (see `jawn-ai-mcp-server/.env.example`)
