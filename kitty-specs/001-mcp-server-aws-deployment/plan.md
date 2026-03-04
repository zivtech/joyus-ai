# Implementation Plan: MCP Server AWS Deployment

**Branch**: `main` | **Date**: 2026-02-12 | **Spec**: [spec.md](spec.md)
**Input**: Feature specification from `kitty-specs/001-mcp-server-aws-deployment/spec.md`

---

## Summary

Deploy the joyus-ai MCP server and a full suite of MCP servers to AWS EC2 with Docker Compose. Three consolidated containers (Platform, Playwright, PostgreSQL) serve the team via Claude Desktop and a lightweight web chat UI for mobile/AFK access. The Platform container includes the skill runtime with all CLI dependencies (Python, Node, git, composer, drush, squirrel, Office packages). CI/CD via GitHub Actions pushes to GHCR and deploys automatically. Domain: `ai.example.com` with Let's Encrypt TLS.

## Technical Context

**Language/Version**: Node.js 20 LTS (MCP server), Python 3.12 (skill runtime), Go (squirrel binary)
**Primary Dependencies**: Express, Drizzle ORM, python-pptx, python-docx, openpyxl, Playwright, Backstop.js
**Storage**: PostgreSQL 16 (containerized, persistent EBS volume)
**Testing**: Smoke tests per tool executor, health check endpoints, Backstop.js visual regression
**Target Platform**: AWS EC2 (t3.small/medium), Ubuntu 24.04 LTS, Docker + Docker Compose
**Project Type**: Infrastructure deployment (Docker Compose + CI/CD)
**Performance Goals**: MCP tool calls <5s standard, <60s Playwright operations
**Constraints**: $15-35/month budget, single EC2 instance, internal team only
**Scale/Scope**: ~5-10 concurrent users (internal team), 10 MCP server endpoints

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| Principle | Status | Notes |
|-----------|--------|-------|
| 2.1 Multi-Tenant from Day One | **PASS** | Consolidated containers now; architecture notes future split per client. No single-tenant shortcuts. |
| 2.2 Skills as Guardrails | **PASS** | Skill runtime deployed with all dependencies; skills loaded per context. |
| 2.3 Sandbox by Default | **PASS** | Internal-only access at launch. MCP bearer tokens revocable. SSH restricted. |
| 2.4 Monitor Everything | **PARTIAL** | Phase 2 covers operational monitoring (health checks, log aggregation, Slack alerts). Full 4-layer monitoring (usage, content fidelity, guardrails, insights) is Phase 3 scope. |
| 2.5 Feedback Loops | **DEFERRED** | Full feedback system is Phase 3. Phase 2 has logging for manual review. |
| 2.6 Claude Code Alternative | **PASS** | Web chat UI provides access for users without Claude Desktop. |
| 3.2 Data Governance | **PASS** | OAuth tokens encrypted AES-256. No client data at this phase. HTTPS everywhere. |
| 4.1 Sharing First | **PASS** | Phase 1 (sharing) complete/in-progress. Phase 2 follows correctly. |
| 5.1 Technology Choices | **PASS** | AWS EC2 + Docker Compose matches constitution decision. |
| 5.2 Cost Awareness | **PASS** | $15-35/mo target. PostgreSQL in container (not managed). GHCR free tier. |
| 5.3 Reliability | **PARTIAL** | Docker restart policies and health checks cover container-level resilience. Tool-call checkpointing and circuit breakers are Phase 3 scope. |

No violations. All gates pass.

## Project Structure

### Documentation (this feature)

```
kitty-specs/001-mcp-server-aws-deployment/
├── plan.md              # This file
├── spec.md              # Feature specification
├── meta.json            # Feature metadata
├── research.md          # Phase 0 output (technology decisions)
├── data-model.md        # Phase 1 output (service topology)
├── quickstart.md        # Phase 1 output (deployment guide)
├── contracts/           # Phase 1 output (API/health endpoints)
├── checklists/          # Quality validation
└── tasks/               # Phase 2 output (created by /spec-kitty.tasks)
```

### Source Code (repository root)

```
deploy/
├── docker-compose.yml          # All 3 services (Platform, Playwright, PostgreSQL)
├── docker-compose.prod.yml     # Production overrides
├── Dockerfile.platform         # Platform container (MCP server + skill runtime)
├── Dockerfile.playwright       # Playwright + Backstop.js container
├── nginx/
│   ├── nginx.conf              # Reverse proxy config
│   └── ssl/                    # Let's Encrypt certs (mounted volume)
├── .env.example                # Template for environment variables
└── scripts/
    ├── deploy.sh               # EC2 deployment script (called by CI)
    ├── health-check.sh         # Verify all services running
    └── setup-ec2.sh            # Initial EC2 provisioning

web-chat/
├── index.html                  # Lightweight chat UI
├── src/
│   ├── chat.js                 # Claude API integration
│   └── styles.css              # Minimal styling
└── package.json                # Build dependencies (if any)

.github/
└── workflows/
    └── deploy-mcp.yml          # CI/CD: build → push GHCR → deploy EC2
```

**Structure Decision**: Infrastructure-focused layout. `deploy/` contains all Docker and deployment config. `web-chat/` is the lightweight mobile/AFK UI. The existing `joyus-ai-mcp-server/` remains unchanged — the Platform Dockerfile builds from it. CI/CD workflow goes in `.github/workflows/`.

## Container Architecture

```
┌─────────────────────────────────────────────────────────┐
│                    AWS EC2 (t3.small/medium)             │
│                    Ubuntu 24.04 LTS                      │
│                                                          │
│  ┌─────────────────────────────────────────────────────┐│
│  │              Nginx Reverse Proxy (:443)              ││
│  │  ai.example.com → routes to services                ││
│  │  Let's Encrypt auto-renewal                         ││
│  └──────────┬──────────────┬───────────────────────────┘│
│             │              │                             │
│  ┌──────────▼──────────┐  │  ┌─────────────────────┐   │
│  │  Platform Container │  │  │ Playwright Container │   │
│  │                     │  │  │                      │   │
│  │  • joyus-ai MCP srv  │  │  │ • Playwright MCP     │   │
│  │  • Memory MCP       │  │  │ • Backstop.js        │   │
│  │  • Office MCP       │  │  │ • Chromium browser    │   │
│  │    (PPT/Excel/Word) │  │  │                      │   │
│  │  • Skill runtime    │  │  └──────────────────────┘   │
│  │    (Python, Node,   │  │                             │
│  │     git, composer,  │  │  ┌──────────────────────┐   │
│  │     drush, squirrel)│  └──▶ PostgreSQL Container │   │
│  │  • Web Chat UI      │     │                      │   │
│  └─────────────────────┘     │ • Persistent EBS vol │   │
│                               │ • Encrypted tokens   │   │
│                               └──────────────────────┘   │
└─────────────────────────────────────────────────────────┘
```

### Container Details

**Platform Container** (`Dockerfile.platform`):
- Base: `node:20-bookworm` (Debian for broad package support)
- Layers: Node.js app → Python 3 + pip packages → git/composer/drush → squirrel CLI
- Ports: 3000 (MCP), 3001 (web chat)
- Services: joyus-ai MCP server, Memory MCP, Office MCP (PPT/Excel/Word)
- Skill runtime: All Python/Node packages, squirrel binary

**Playwright Container** (`Dockerfile.playwright`):
- Base: `mcr.microsoft.com/playwright:v1.50.0-noble`
- Ports: 3002 (Playwright MCP)
- Services: Playwright MCP server, Backstop.js
- Includes: Chromium, Firefox, WebKit browsers

**PostgreSQL Container**:
- Image: `postgres:16-alpine`
- Port: 5432 (internal only, not exposed)
- Volume: EBS-backed persistent storage
- Config: Encrypted token vault (AES-256)

**Nginx Reverse Proxy**:
- Runs on host (not in Docker Compose)
- Routes `ai.example.com` to appropriate service
- Handles TLS termination (Let's Encrypt / certbot)
- WebSocket support for streaming

## CI/CD Pipeline

```
Push to main
    │
    ▼
GitHub Actions (.github/workflows/deploy-mcp.yml)
    │
    ├── Build Platform image → ghcr.io/<org>/joyus-ai-platform:latest
    ├── Build Playwright image → ghcr.io/<org>/joyus-ai-playwright:latest
    │
    ▼
SSH to EC2
    │
    ├── docker compose pull
    ├── docker compose up -d
    ├── Run health checks (scripts/health-check.sh)
    │
    ├── ✅ Success → Slack notification
    └── ❌ Failure → Rollback to previous tag, Slack alert
```

### Rollback Strategy
- Each successful build is tagged with git SHA (e.g., `ghcr.io/<org>/joyus-ai-platform:abc123`)
- `latest` tag always points to current production
- Rollback: `docker compose` with previous SHA tag
- PostgreSQL volume persists across deployments

## Security

- **TLS**: Let's Encrypt auto-renewed certificates on `ai.example.com`
- **SSH**: Key-based only, restricted to authorized IPs
- **MCP Auth**: Bearer tokens (existing implementation, revocable)
- **OAuth Tokens**: AES-256 encrypted in PostgreSQL (existing implementation)
- **Secrets**: GitHub Actions secrets for deploy key, env vars. `.env` on EC2 not in repo.
- **Docker**: No `--privileged`, minimal capabilities. Playwright sandboxed.
- **Network**: PostgreSQL not exposed externally. Only nginx (:443) public.

## Future Considerations (Not in Scope)

- **Container-per-service split**: When client portal arrives, break Platform container into individual service containers for per-client isolation
- **ECR migration**: Move from GHCR to AWS ECR when AWS footprint justifies it
- **Custom domain rebrand**: New brand URL replaces `ai.example.com`
- **Auto-scaling**: Single instance sufficient for team use; revisit for client load
- **Managed PostgreSQL**: RDS when data volume or reliability requirements increase

## Complexity Tracking

Two principles marked PARTIAL (2.4 Monitor Everything, 5.3 Reliability) — acceptable for Phase 2 infrastructure scope. Full implementation deferred to Phase 3.
