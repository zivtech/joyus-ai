# Quickstart: MCP Server AWS Deployment

**Feature**: 001-mcp-server-aws-deployment
**Date**: 2026-02-12

---

## Prerequisites

- AWS account with EC2 access
- Domain DNS access for `ai.example.com`
- GitHub org access (`zivtech`)
- GitHub Actions secrets configured (see below)

## Initial EC2 Setup (One-Time)

```bash
# 1. Provision EC2 instance (t3.small, Ubuntu 24.04 LTS, 30GB EBS)
# 2. SSH in and run:
./deploy/scripts/setup-ec2.sh

# This installs: Docker, Docker Compose, certbot, fail2ban
# Configures: firewall (443, 22 only), swap, log rotation
```

## DNS Configuration

Point `ai.example.com` → EC2 public IP (A record)

## GitHub Secrets Required

| Secret | Description |
|--------|-------------|
| `EC2_HOST` | EC2 public IP or hostname |
| `EC2_SSH_KEY` | Private key for deployment |
| `EC2_USER` | SSH user (ubuntu) |
| `ENCRYPTION_KEY` | AES-256 key for token vault |
| `CLAUDE_API_KEY` | Anthropic API key |
| `MCP_BEARER_TOKEN` | MCP client auth token |
| `POSTGRES_PASSWORD` | Database password |

OAuth credentials (Jira, Slack, GitHub, Google) are already in the MCP server's encrypted token vault — migrated from local development.

## Deploy

Push to `main` triggers automatic deployment. To deploy manually:

```bash
# On EC2:
cd /opt/joyus-ai
docker compose -f docker-compose.yml -f docker-compose.prod.yml pull
docker compose -f docker-compose.yml -f docker-compose.prod.yml up -d
./deploy/scripts/health-check.sh
```

## Verify

```bash
# Health check (from anywhere)
curl https://ai.example.com/health

# Expected response:
# { "status": "ok", "services": { "platform": "ok", "playwright": "ok", "db": "ok" } }
```

## Connect Claude Desktop

Add to Claude Desktop MCP config (`claude_desktop_config.json`):

```json
{
  "mcpServers": {
    "joyus-ai": {
      "url": "https://ai.example.com/mcp",
      "headers": {
        "Authorization": "Bearer <MCP_BEARER_TOKEN>"
      }
    }
  }
}
```

## Web Chat (Mobile/AFK)

Open `https://ai.example.com/chat` in any browser.

## Rollback

```bash
# On EC2 — roll back to previous version:
docker compose -f docker-compose.yml -f docker-compose.prod.yml up -d --force-recreate \
  --pull never  # Uses locally cached previous images

# Or specify a specific SHA:
# Edit docker-compose.prod.yml image tags to ghcr.io/zivtech/joyus-ai-platform:<sha>
```
