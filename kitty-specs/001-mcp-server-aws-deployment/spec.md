# Specification: MCP Server AWS Deployment

**Project:** Joyus AI Platform
**Phase:** 2 — MCP Server Deployment
**Date:** February 12, 2026
**Status:** Specification Complete

---

## 1. Overview

### Problem

The joyus-ai MCP server and supporting tools are fully built but running only locally. The team needs centralized, always-on access to all MCP-connected tools and Claude skills — from Claude Desktop at their workstations and from the web when working from a phone or away from their computer.

### Solution

Deploy the complete MCP server suite to AWS EC2 with Docker Compose, including all tool executors, skill runtime dependencies, and web accessibility. Automated CI/CD ensures the deployment stays current with every push to main.

### Users

- **Internal team** — connecting via Claude Desktop (primary) and web browser (mobile/AFK)
- No client access at this phase

> **Terminology**: This spec covers the **remote MCP server** — deployed to AWS, accessed over HTTPS. Feature 002 (Session & Context Management) defines a separate **local MCP server** (`joyus-ai-state`) that runs on each developer's machine. They are independent systems.

---

## 2. Functional Requirements

### FR1: MCP Server Suite Deployment

Deploy the following MCP servers as containerized services:

**Platform Server:**
- joyus-ai MCP server (`/mcp` endpoint) — Jira, Slack, GitHub, Google tool executors with OAuth auth, encrypted token storage, scheduled tasks

**Additional MCP Servers:**
- Playwright + Backstop.js — browser automation and visual regression testing
- Memory — persistent knowledge graph across sessions
- PowerPoint — create and edit presentations
- Excel — spreadsheet creation and manipulation
- Word — document creation and manipulation

### FR2: Skill Runtime Environment

The deployment must include a runtime environment that supports all platform Claude skills:

**System packages:**
- Python 3 with pip
- Node.js with npm
- git, composer, drush

**Python packages:**
- `python-pptx`, `python-docx`, `openpyxl` — Office document manipulation
- `lxml` — XML processing
- `pypdf` — PDF manipulation
- `requests`, `PyYAML`, `packaging` — API and data handling
- `pillow`, `imageio`, `numpy` — image/GIF creation

**Node packages:**
- `html2pptx` and related conversion tools

**Standalone binaries:**
- `squirrel` CLI (SquirrelScan) — website auditing

**Excluded from server deployment:**
- Lando, DDEV — local-only container runtimes (local-drupal-development and drupal-setup skills remain workstation-only)

### FR3: Network Accessibility

- The MCP server must be reachable over HTTPS from any device
- Supports Claude Desktop MCP client connections
- Supports web browser access for mobile/AFK scenarios
- Custom domain with TLS certificate

### FR4: CI/CD Pipeline

- GitHub Actions workflow: push to main triggers build, test, and deploy
- Docker image build and push to container registry
- Automated deployment to EC2 instance
- Rollback capability (previous image tagged and retained)

### FR5: Infrastructure as Code

- Docker Compose configuration for all services
- PostgreSQL database container with persistent volume
- Environment variables and secrets managed securely (not in repo)

### FR6: Monitoring and Health

- Health check endpoints for each service
- Basic uptime monitoring with alerting (Slack notification on downtime)
- Log aggregation accessible for debugging
- Resource usage visibility (CPU, memory, disk)

---

## 3. Non-Functional Requirements

### Performance
- MCP tool calls respond within 5 seconds for standard operations (Jira queries, Slack posts, etc.)
- Playwright operations may take longer (up to 60 seconds for page loads and screenshots)

### Availability
- Target 99% uptime during business hours (US Eastern)
- Graceful restart capability without data loss
- PostgreSQL data persisted across container restarts

### Security
- All traffic over HTTPS (TLS 1.2+)
- OAuth tokens encrypted at rest (AES-256, existing implementation)
- No credentials in Docker images or repository
- SSH access restricted to authorized IPs
- MCP bearer tokens for client authentication (revocable)

### Cost
- Target: $15-35/month for EC2 instance (t3.small or t3.medium)
- PostgreSQL runs in container (not managed service) to minimize cost
- Storage: 30GB gp3 EBS volume (expandable)

---

## 4. User Scenarios

### Scenario 1: Team Member Connects via Claude Desktop
A developer configures their Claude Desktop MCP client to point at the deployed server. They can immediately search Jira issues, post to Slack, create GitHub PRs, and query Google services — all through natural conversation. Skills like ticket-writing standards and coding standards are enforced automatically.

### Scenario 2: Mobile/AFK Access
Alex is away from his computer and needs to check on a project. From his phone's web browser, he opens the lightweight web chat UI hosted on the server. Through a conversational interface backed by the Claude API, he can ask about Jira issues, check Slack threads, and review GitHub PRs — the chat UI routes requests through the MCP tool executors behind the scenes.

### Scenario 3: Automated Deployment
A developer pushes a fix to the MCP server code on main. GitHub Actions automatically builds a new Docker image, pushes it to the registry, and deploys it to EC2. The team sees the update live within minutes.

### Scenario 4: Visual Regression Testing
A team member uses the Playwright + Backstop.js MCP server to capture screenshots of a client's staging site and compare them against baseline images, identifying visual regressions before a release.

### Scenario 5: Office Document Generation
A team member invokes the PowerPoint MCP server to generate a branded client presentation, or uses the Word MCP server to produce a proposal document — all from Claude Desktop or the web interface.

---

## 5. Key Entities

| Entity | Description |
|--------|-------------|
| MCP Server | The platform server exposing tool executors via MCP protocol |
| Tool Executor | Individual service integration (Jira, Slack, GitHub, Google, etc.) |
| MCP Client | Claude Desktop or web browser connecting to the server |
| OAuth Token | Encrypted credential for third-party service access |
| Skill | Prompt-based behavior module with optional CLI dependencies |
| Docker Service | Individual container in the Docker Compose stack |
| Health Check | Endpoint returning service status for monitoring |

---

## 6. Success Criteria

1. **All MCP servers operational** — Jira, Slack, GitHub, Google, Playwright, Memory, PowerPoint, Excel, Word, and the platform `/mcp` endpoint all respond to tool calls successfully
2. **Skills runtime complete** — All non-container skills (17 of 19) can execute their CLI dependencies on the server
3. **Web accessible** — Server reachable via HTTPS on a custom domain from any device
4. **CI/CD working** — Push to main triggers automated build and deployment; new version live within 10 minutes
5. **Uptime verified** — Health checks passing, Slack alerts configured for downtime
6. **Team connected** — At least 2 team members successfully using the deployed server via Claude Desktop
7. **Cost within budget** — Monthly infrastructure cost under $35/month

---

## 7. Assumptions

- AWS account already exists or can be created
- DNS can be configured for `ai.example.com`
- The existing joyus-ai MCP server codebase is deployment-ready (Phase 0 complete)
- Team members have Claude Desktop installed and configured
- GitHub Actions runners have access to deploy to EC2

---

## 8. Dependencies

- **Phase 0 (Complete):** Working MCP server with OAuth, Drizzle ORM, Docker config
- **Phase 1 (In Progress):** Asset sharing pipeline (independent, no blocker)
- **External:** AWS account, domain DNS access, GitHub Actions secrets

---

## 9. Edge Cases

- **Service crashes:** Individual MCP server failure should not take down the entire stack; Docker Compose restart policies handle recovery
- **Disk space exhaustion:** Playwright screenshots and logs can accumulate; implement rotation/cleanup
- **OAuth token expiry:** Refresh tokens must work server-side; alert if refresh fails
- **Network connectivity:** EC2 must have stable outbound access to Jira, Slack, GitHub, Google APIs
- **Concurrent users:** Multiple team members connecting simultaneously; MCP server must handle concurrent tool calls without blocking

---

## 10. Out of Scope

- Client/external user access (deferred to Phase 3)
- Multi-tenant isolation (Phase 3)
- Full monitoring dashboard (Phase 3)
- Lando/DDEV container runtimes (remain local-only)
- Managed database service (PostgreSQL in container for now)
- Load balancing or auto-scaling (single instance sufficient for team use)
