# Tasks: MCP Server AWS Deployment

**Feature**: 001-mcp-server-aws-deployment
**Date**: 2026-02-12
**Spec**: [spec.md](spec.md) | **Plan**: [plan.md](plan.md)

---

## Subtask Index

| ID | Description | WP | Parallel |
|----|-------------|-----|----------|
| T001 | Create Docker Compose base configuration | WP01 | |
| T002 | Write Platform container Dockerfile (Node.js + skill runtime) | WP01 | |
| T003 | Write Playwright container Dockerfile | WP01 | [P] |
| T004 | Configure PostgreSQL service with persistent volume | WP01 | [P] |
| T005 | Create `.env.example` with all environment variables | WP01 | |
| T006 | Write EC2 provisioning script (`setup-ec2.sh`) | WP02 | |
| T007 | Configure nginx reverse proxy with path-based routing | WP02 | |
| T008 | Set up Let's Encrypt TLS via certbot | WP02 | |
| T009 | Configure firewall rules (UFW: 443, 22 only) | WP02 | [P] |
| T010 | Create production Docker Compose overrides | WP02 | |
| T011 | Create GitHub Actions workflow for CI/CD | WP03 | |
| T012 | Configure GHCR image build and push | WP03 | |
| T013 | Write deployment script (`deploy.sh`) for EC2 | WP03 | |
| T014 | Implement rollback mechanism (SHA-tagged images) | WP03 | |
| T015 | Add Slack notification on deploy success/failure | WP03 | [P] |
| T016 | Implement health check endpoints (platform, playwright, db, aggregated) | WP04 | |
| T017 | Write health check verification script (`health-check.sh`) | WP04 | [P] |
| T018 | Configure Docker restart policies for all services | WP04 | [P] |
| T019 | Set up log aggregation and rotation | WP04 | [P] |
| T020 | Configure Slack alerting for downtime (health check failures) | WP04 | |
| T021 | Verify jawn-ai MCP server tool executors (Jira, Slack, GitHub, Google) | WP05 | |
| T022 | Verify Playwright MCP + Backstop.js visual regression | WP05 | [P] |
| T023 | Verify Memory MCP persistent knowledge graph | WP05 | [P] |
| T024 | Verify Office MCP servers (PowerPoint, Excel, Word) | WP05 | [P] |
| T025 | Test skill runtime — Python packages (python-pptx, pillow, etc.) | WP05 | |
| T026 | Test skill runtime — squirrel CLI (audit-website) | WP05 | [P] |
| T027 | Test skill runtime — git, composer, drush (drupal-contribute-fix) | WP05 | [P] |
| T028 | Build lightweight web chat UI (HTML/JS/CSS) | WP06 | |
| T029 | Integrate Claude API for chat completions | WP06 | |
| T030 | Add simple token-based authentication for web chat | WP06 | |
| T031 | Ensure responsive design for mobile browsers | WP06 | |
| T032 | Configure Claude Desktop MCP client connection | WP06 | [P] |
| T033 | Provision EC2 instance (t3.small, Ubuntu 24.04, 30GB EBS) | WP07 | |
| T034 | Configure DNS: ai.zivtech.com → EC2 IP | WP07 | |
| T035 | Set GitHub Actions secrets (EC2_HOST, SSH_KEY, etc.) | WP07 | |
| T036 | First production deployment and smoke test | WP07 | |
| T037 | Verify team member Claude Desktop connections (2+ users) | WP07 | |
| T038 | Verify web chat from mobile device | WP07 | |

---

## Work Packages

### WP01: Docker Compose & Container Images (~400 lines)

**Priority**: P0 (Foundation — everything depends on this)
**Goal**: Create all Docker configuration files and container images for the 3-container architecture.
**Dependencies**: None
**Subtasks**: T001, T002, T003, T004, T005

**Implementation sketch**:
1. Create `deploy/docker-compose.yml` defining Platform, Playwright, PostgreSQL services + internal network
2. Write `deploy/Dockerfile.platform` — multi-stage build: node:20-bookworm base → Python 3 + pip packages → system packages (git, composer, drush) → squirrel CLI → application code
3. Write `deploy/Dockerfile.playwright` — mcr.microsoft.com/playwright base → Backstop.js → MCP server
4. Configure PostgreSQL with named volume for EBS persistence
5. Create `deploy/.env.example` documenting all required environment variables

**Parallel opportunities**: T003 and T004 can be built independently of T002.
**Success criteria**: `docker compose build` succeeds. `docker compose up -d` starts all 3 containers. Containers can communicate on internal network.
**Risks**: Platform container image may be large (~2GB) due to multi-runtime. Monitor build times.
**Prompt file**: [tasks/WP01-docker-compose-containers.md](tasks/WP01-docker-compose-containers.md)

---

### WP02: EC2 Provisioning & Nginx (~350 lines)

**Priority**: P0 (Infrastructure — needed before deploy)
**Goal**: Create the EC2 setup script, nginx reverse proxy configuration, and TLS.
**Dependencies**: WP01
**Subtasks**: T006, T007, T008, T009, T010

**Implementation sketch**:
1. Write `deploy/scripts/setup-ec2.sh` — install Docker, Docker Compose, certbot, fail2ban, configure swap
2. Create `deploy/nginx/nginx.conf` — reverse proxy with path-based routing (/mcp → :3000, /chat → :3001, /playwright → :3002, /health → aggregated)
3. Add Let's Encrypt certbot setup with auto-renewal systemd timer
4. Configure UFW firewall (443 HTTPS, 22 SSH only)
5. Create `deploy/docker-compose.prod.yml` — production overrides (restart policies, resource limits, log drivers)

**Parallel opportunities**: T009 (firewall) independent of T007 (nginx).
**Success criteria**: Fresh Ubuntu 24.04 instance can be provisioned from scratch by running `setup-ec2.sh`. Nginx routes requests correctly. TLS works on `ai.zivtech.com`.
**Risks**: DNS propagation delay. Certbot requires domain to resolve to EC2 IP first.
**Prompt file**: [tasks/WP02-ec2-provisioning-nginx.md](tasks/WP02-ec2-provisioning-nginx.md)

---

### WP03: CI/CD Pipeline (~350 lines)

**Priority**: P1 (Automation — enables continuous deployment)
**Goal**: GitHub Actions workflow that builds, pushes to GHCR, and deploys to EC2 on push to main.
**Dependencies**: WP01, WP02
**Subtasks**: T011, T012, T013, T014, T015

**Implementation sketch**:
1. Create `.github/workflows/deploy-mcp.yml` — triggered on push to main (paths: `deploy/`, `jawn-ai-mcp-server/`, `web-chat/`)
2. Build and push both Docker images to GHCR (tagged with SHA + `latest`)
3. Write `deploy/scripts/deploy.sh` — SSH to EC2, pull new images, compose up, run health checks
4. Implement rollback: on health check failure, revert to previous SHA tag
5. Add Slack webhook notification for deploy success/failure

**Parallel opportunities**: T015 (Slack notification) independent of T011-T014.
**Success criteria**: Push to main triggers automated build + deploy. New version live within 10 minutes. Failed deploy triggers rollback and Slack alert.
**Risks**: GitHub Actions needs `workflow` scope on gh auth. EC2 SSH key must be in GitHub secrets.
**Prompt file**: [tasks/WP03-cicd-pipeline.md](tasks/WP03-cicd-pipeline.md)

---

### WP04: Monitoring & Health Checks (~300 lines)

**Priority**: P1 (Operational readiness)
**Goal**: Health check endpoints, monitoring scripts, log management, and alerting.
**Dependencies**: WP01
**Subtasks**: T016, T017, T018, T019, T020

**Implementation sketch**:
1. Add health check endpoints to jawn-ai MCP server: `/health` (aggregated), `/health/platform`, `/health/playwright`, `/health/db`
2. Write `deploy/scripts/health-check.sh` — curl each endpoint, report status
3. Configure Docker restart policies (`unless-stopped`) and healthcheck directives in compose
4. Set up log rotation (Docker logging driver with max-size/max-file, plus logrotate for nginx)
5. Create Slack alerting: cron job runs health check, posts to Slack on failure (3 consecutive failures = alert)

**Parallel opportunities**: T017, T018, T019 all independent of each other.
**Success criteria**: `/health` endpoint returns correct service status. Logs rotate automatically. Slack alert fires on simulated downtime.
**Risks**: Health check must not create excessive load. Use lightweight checks (TCP for DB, HTTP 200 for services).
**Prompt file**: [tasks/WP04-monitoring-health.md](tasks/WP04-monitoring-health.md)

---

### WP05: MCP Server & Skill Runtime Verification (~400 lines)

**Priority**: P1 (Functional validation)
**Goal**: Verify all 10 MCP server endpoints and skill runtime dependencies work inside the containers.
**Dependencies**: WP01
**Subtasks**: T021, T022, T023, T024, T025, T026, T027

**Implementation sketch**:
1. Test jawn-ai MCP tool executors: Jira search, Slack post, GitHub PR list, Google query
2. Test Playwright MCP: navigate to URL, take screenshot. Test Backstop.js: run visual regression
3. Test Memory MCP: create entity, query, verify persistence across container restart
4. Test Office MCP: create a simple PPT, Excel spreadsheet, and Word doc
5. Test Python packages: run `python3 -c "import pptx, docx, openpyxl, lxml, pypdf, PIL, imageio, numpy"`
6. Test squirrel: `squirrel audit https://zivtech.com --format llm` (basic scan)
7. Test Drupal tools: `git --version`, `composer --version`, `drush --version`

**Parallel opportunities**: T022-T027 all independent of each other (different services/runtimes).
**Success criteria**: All MCP endpoints respond to tool calls. All Python packages importable. All CLI tools executable. Memory persists across restart.
**Risks**: OAuth tokens may need re-auth for production environment. Playwright may need display config (Xvfb or headless flag).
**Prompt file**: [tasks/WP05-mcp-skill-verification.md](tasks/WP05-mcp-skill-verification.md)

---

### WP06: Web Chat UI & Claude Desktop Config (~400 lines)

**Priority**: P2 (User access layer)
**Goal**: Build the lightweight web chat UI for mobile/AFK access and document Claude Desktop configuration.
**Dependencies**: WP01, WP04 (needs health endpoints for status display)
**Subtasks**: T028, T029, T030, T031, T032

**Implementation sketch**:
1. Create `web-chat/index.html` — clean, minimal chat interface (message input, response area, status indicator)
2. Create `web-chat/src/chat.js` — Claude API integration via fetch, streaming responses via SSE/EventSource
3. Add simple auth: bearer token check (same MCP_BEARER_TOKEN or separate WEB_CHAT_TOKEN)
4. Responsive CSS: works on iPhone/Android browsers, no frameworks needed
5. Document Claude Desktop MCP config in `quickstart.md` — connection URL, bearer token, verify tool list

**Parallel opportunities**: T032 (Claude Desktop config) independent of T028-T031.
**Success criteria**: Chat UI loads on mobile browser. Can send message and receive Claude response with tool call results. Auth prevents unauthorized access. Claude Desktop connects and lists all MCP tools.
**Risks**: Claude API streaming may need CORS configuration in nginx. Mobile keyboard handling may need viewport meta tag.
**Prompt file**: [tasks/WP06-web-chat-claude-desktop.md](tasks/WP06-web-chat-claude-desktop.md)

---

### WP07: Production Launch & Validation (~300 lines)

**Priority**: P2 (Go-live)
**Goal**: Provision the real EC2 instance, configure DNS, deploy, and validate with real team members.
**Dependencies**: WP01, WP02, WP03, WP04, WP05, WP06
**Subtasks**: T033, T034, T035, T036, T037, T038

**Implementation sketch**:
1. Provision t3.small EC2 instance in us-east-1 (or appropriate region), Ubuntu 24.04, 30GB gp3 EBS
2. Run `setup-ec2.sh` on the instance
3. Configure DNS A record: `ai.zivtech.com` → EC2 elastic IP
4. Set all GitHub Actions secrets
5. Trigger first deployment via push to main
6. Run full smoke test — all MCP endpoints, health checks, web chat
7. Have 2+ team members connect via Claude Desktop and verify tool access
8. Verify web chat from a mobile device (phone browser)

**Parallel opportunities**: T034 (DNS) can start while T033 (EC2) provisions.
**Success criteria**: `ai.zivtech.com` serves HTTPS. All health checks green. 2+ team members connected. Web chat works from phone. Monthly cost under $35.
**Risks**: DNS propagation (up to 48h worst case, usually <1h). May need t3.medium if OOM under load.
**Prompt file**: [tasks/WP07-production-launch.md](tasks/WP07-production-launch.md)

---

## Dependency Graph

```
WP01 (Docker/Containers)
  ├──▶ WP02 (EC2/Nginx) ──▶ WP03 (CI/CD) ──┐
  ├──▶ WP04 (Monitoring) ──────────────────────┤
  ├──▶ WP05 (MCP Verification) ────────────────┤
  └──▶ WP06 (Web Chat + Claude Desktop) ───────┤
                                                 ▼
                                          WP07 (Launch)
```

**Parallelization**: After WP01 completes, WP02/WP04/WP05/WP06 can all run in parallel. WP03 requires WP02. WP07 requires everything.

## Summary

| WP | Title | Subtasks | Est. Lines | Priority |
|----|-------|----------|-----------|----------|
| WP01 | Docker Compose & Container Images | 5 (T001-T005) | ~400 | P0 |
| WP02 | EC2 Provisioning & Nginx | 5 (T006-T010) | ~350 | P0 |
| WP03 | CI/CD Pipeline | 5 (T011-T015) | ~350 | P1 |
| WP04 | Monitoring & Health Checks | 5 (T016-T020) | ~300 | P1 |
| WP05 | MCP Server & Skill Verification | 7 (T021-T027) | ~400 | P1 |
| WP06 | Web Chat UI & Claude Desktop | 5 (T028-T032) | ~400 | P2 |
| WP07 | Production Launch & Validation | 6 (T033-T038) | ~300 | P2 |

**Total**: 7 work packages, 38 subtasks
**MVP scope**: WP01 + WP02 + WP05 (Docker + infra + verification = working MCP server on EC2)
