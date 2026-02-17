# Research: MCP Server AWS Deployment

**Date**: 2026-02-12
**Feature**: 001-mcp-server-aws-deployment

---

## R1: Container Architecture — Consolidated vs Per-Service

**Decision**: Consolidated (3 containers: Platform, Playwright, PostgreSQL)
**Rationale**: Team-only usage (~5-10 users) doesn't justify per-service overhead. A t3.small/medium has 2 vCPUs and 2-4GB RAM — running 10+ containers would be tight. Playwright needs its own container due to browser binary size (~500MB+) and resource spikes during rendering.
**Alternatives considered**:
- Per-service containers (maximum isolation, independent scaling) — rejected for Phase 2 due to resource constraints and operational overhead
- Single monolithic container — rejected because Playwright browser binaries would bloat the image and resource spikes from browser automation would affect MCP server responsiveness
**Revisit**: When client portal (Phase 3+) introduces multi-tenant requirements

## R2: Container Registry — GHCR vs ECR

**Decision**: GitHub Container Registry (ghcr.io)
**Rationale**: Free for private packages in GitHub org. Tightest integration with GitHub Actions (same auth, no extra config). Team already uses GitHub for everything.
**Alternatives considered**:
- AWS ECR — better when AWS footprint grows (closer to deployment, faster pulls), but adds IAM/auth complexity now
- Docker Hub — free tier limited to 1 private repo, rate limits on pulls
**Revisit**: When migrating more infrastructure to AWS

## R3: Web Chat UI Approach

**Decision**: Lightweight HTML/JS chat UI served from the Platform container
**Rationale**: Minimal scope — not a full Phase 3 web app. Just needs to: authenticate (simple token/password), send messages to Claude API, display responses with tool call results. No conversation persistence needed for MVP.
**Alternatives considered**:
- Open WebUI (self-hosted) — full-featured but heavy (Python, separate container, own DB)
- LibreChat — similar weight, more than needed
- Claude.ai with remote MCP config — depends on Anthropic supporting remote MCP servers in their consumer product (not yet confirmed)
**Key constraint**: Must work on mobile browsers (responsive design)

## R4: EC2 Instance Sizing

**Decision**: Start with t3.small ($15/mo), upgrade to t3.medium ($30/mo) if needed
**Rationale**: t3.small (2 vCPU, 2GB RAM) is likely sufficient for Platform + PostgreSQL containers. Playwright container may push memory limits when running browser automation — monitor and upgrade if OOM kills occur. t3 burstable instances are cost-effective for intermittent team use.
**Monitoring trigger**: Upgrade to t3.medium if average memory usage exceeds 75% or Playwright OOMs.

## R5: TLS Certificate Management

**Decision**: Let's Encrypt via certbot with nginx
**Rationale**: Free, automated, well-supported. Certbot auto-renews every 60 days. Nginx handles TLS termination.
**Alternatives considered**:
- AWS ACM — free but requires ALB ($16/mo minimum), overkill for single instance
- Self-signed — not acceptable for production MCP clients
**Implementation**: Certbot standalone or nginx plugin, systemd timer for renewal

## R6: Skill Runtime Packaging

**Decision**: Multi-stage Docker build layering Node.js, Python, system packages, and binaries
**Rationale**: Single Platform container needs Node.js 20 (MCP server), Python 3.12 (skill packages), git/composer/drush (Drupal skills), and squirrel binary (audit skill). Multi-stage build keeps final image size manageable (~1.5-2GB estimated).
**Layer order** (least-changing first for cache efficiency):
1. Base: `node:20-bookworm`
2. System packages: git, python3, pip, composer, php-cli
3. Python packages: python-pptx, python-docx, openpyxl, lxml, pypdf, pillow, imageio, numpy, requests, PyYAML, packaging
4. Node packages: html2pptx
5. Binaries: squirrel CLI, drush (via composer global)
6. Application: joyus-ai-mcp-server code
**Excluded**: Lando, DDEV (local-only container runtimes — would be Docker-in-Docker, not practical)

## R7: Nginx Routing

**Decision**: Path-based routing via nginx reverse proxy
**Rationale**: Single domain (`ai.zivtech.com`) with paths routing to different services.

| Path | Target | Service |
|------|--------|---------|
| `/mcp` | Platform :3000 | joyus-ai MCP protocol endpoint |
| `/api/*` | Platform :3000 | REST API |
| `/chat` | Platform :3001 | Web chat UI |
| `/playwright` | Playwright :3002 | Playwright MCP endpoint |
| `/health` | All | Aggregated health check |

WebSocket upgrade support needed for MCP streaming and chat.
