# Data Model: MCP Server AWS Deployment

**Date**: 2026-02-12
**Feature**: 001-mcp-server-aws-deployment

---

## Service Topology

This feature is infrastructure-focused. The "data model" is the service topology and their relationships.

### Services

| Service | Container | Port | Protocol | State |
|---------|-----------|------|----------|-------|
| joyus-ai MCP Server | Platform | 3000 | MCP/HTTP | Stateful (PostgreSQL) |
| Memory MCP | Platform | (internal) | MCP | Stateful (file-based knowledge graph) |
| Office MCP (PPT/Excel/Word) | Platform | (internal) | MCP | Stateless |
| Skill Runtime | Platform | (internal) | Bash/Python/Node | Stateless |
| Web Chat UI | Platform | 3001 | HTTP/WS | Stateless |
| Playwright MCP | Playwright | 3002 | MCP | Stateless |
| Backstop.js | Playwright | (internal) | CLI | Stateless (screenshots on disk) |
| PostgreSQL | PostgreSQL | 5432 | TCP | Stateful (EBS volume) |
| Nginx | Host/Sidecar | 443 | HTTPS | Stateless |

### Data Stores

| Store | Container | Persistence | Contents |
|-------|-----------|-------------|----------|
| PostgreSQL | PostgreSQL | EBS volume (survives restarts) | OAuth tokens (AES-256), user sessions, scheduled tasks, audit logs |
| Memory Graph | Platform | Docker volume | Knowledge graph nodes and relationships |
| Backstop Screenshots | Playwright | Docker volume (ephemeral OK) | Visual regression baseline and diff images |
| Let's Encrypt Certs | Host | Host filesystem | TLS certificates, auto-renewed |

### Network Topology

```
Internet
    │
    ▼ :443 (HTTPS)
┌─────────┐
│  Nginx  │──── ai.example.com
└────┬────┘
     │
     ├── /mcp, /api/* ──────▶ Platform :3000
     ├── /chat ──────────────▶ Platform :3001
     ├── /playwright ────────▶ Playwright :3002
     └── /health ────────────▶ All (aggregated)

Internal network (docker-compose):

Platform ◄────────▶ PostgreSQL :5432
Platform ◄────────▶ Playwright :3002 (internal)
```

### Environment Variables

| Variable | Container | Description |
|----------|-----------|-------------|
| `DATABASE_URL` | Platform | PostgreSQL connection string |
| `ENCRYPTION_KEY` | Platform | AES-256 key for OAuth token encryption |
| `JIRA_CLIENT_ID` | Platform | Jira OAuth app credentials |
| `JIRA_CLIENT_SECRET` | Platform | Jira OAuth app credentials |
| `SLACK_BOT_TOKEN` | Platform | Slack bot token |
| `GITHUB_TOKEN` | Platform | GitHub PAT for API access |
| `GOOGLE_CLIENT_ID` | Platform | Google OAuth credentials |
| `GOOGLE_CLIENT_SECRET` | Platform | Google OAuth credentials |
| `CLAUDE_API_KEY` | Platform | Anthropic API key (for web chat) |
| `MCP_BEARER_TOKEN` | Platform | Token for MCP client authentication |
| `POSTGRES_PASSWORD` | PostgreSQL | Database password |
| `DOMAIN` | Nginx | `ai.example.com` |
| `LETSENCRYPT_EMAIL` | Nginx/Certbot | Email for cert notifications |

### Health Check Endpoints

| Endpoint | Method | Success | Failure |
|----------|--------|---------|---------|
| `/health` | GET | `200 { "status": "ok", "services": {...} }` | `503 { "status": "degraded", "failures": [...] }` |
| `/health/platform` | GET | `200` | `503` |
| `/health/playwright` | GET | `200` | `503` |
| `/health/db` | GET | `200` | `503` |
