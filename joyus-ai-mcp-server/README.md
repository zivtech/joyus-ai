# Zivtech AI MCP Server

A remote MCP (Model Context Protocol) server that enables Claude Desktop to interact with your work tools: Jira, Slack, GitHub, Gmail, and Google Drive/Docs.

## Architecture

```
┌─────────────────────────────────────────────────────────────────────────┐
│                          CLAUDE DESKTOP                                   │
│                    (Windows/Mac - Paid Plan)                              │
│                                                                           │
│     ┌─────────────────────────────────────────────────────────────┐      │
│     │  Settings → Connectors → Add MCP Server                     │      │
│     │  URL: https://mcp.zivtech.com/mcp                           │      │
│     │  Auth: Bearer <your-mcp-token>                              │      │
│     └─────────────────────────────────────────────────────────────┘      │
└───────────────────────────────────┬─────────────────────────────────────┘
                                    │
                                    │ MCP Protocol (HTTP + JSON-RPC)
                                    │
┌───────────────────────────────────▼─────────────────────────────────────┐
│                       ZIVTECH AI MCP SERVER                              │
│                                                                          │
│  ┌──────────────┐  ┌─────────────────┐  ┌────────────────────────────┐  │
│  │ Auth Portal  │  │  MCP Endpoint   │  │     Tool Executors         │  │
│  │              │  │                 │  │                            │  │
│  │ • Google SSO │  │ /mcp            │  │  • Jira (search, comment)  │  │
│  │ • Connect    │  │ • tools/list    │  │  • Slack (search, post)    │  │
│  │   services   │  │ • tools/call    │  │  • GitHub (PRs, issues)    │  │
│  │ • Get token  │  │                 │  │  • Google (Gmail, Drive)   │  │
│  └──────────────┘  └─────────────────┘  └────────────────────────────┘  │
│                                                                          │
│  ┌─────────────────────────────────────────────────────────────────────┐ │
│  │                         PostgreSQL                                  │ │
│  │  Users | Connections (encrypted tokens) | AuditLogs | OAuthState   │ │
│  └─────────────────────────────────────────────────────────────────────┘ │
└──────────────────────────────────────────────────────────────────────────┘
                                    │
                    ┌───────────────┼───────────────┐
                    │               │               │
              ┌─────▼─────┐  ┌─────▼─────┐  ┌─────▼─────┐
              │   Jira    │  │   Slack   │  │  GitHub   │  ...
              │   API     │  │   API     │  │   API     │
              └───────────┘  └───────────┘  └───────────┘
```

## Features

- **Jira Integration**: Search issues, view details, add comments, transition status
- **Slack Integration**: Search messages, read channels, post messages, list channels
- **GitHub Integration**: Search code, list PRs/issues, view file contents, add comments
- **Google Integration**: Gmail search/send, Drive search, Google Docs content
- **Scheduled Tasks**: Automated reports and alerts on a schedule (cron-based)

## Quick Start

### Prerequisites

- Node.js 20+
- PostgreSQL 15+
- OAuth apps configured for each service (see Setup section)

### Local Development

```bash
# Clone and install
cd joyus-ai-mcp-server
npm install

# Set up environment
cp .env.example .env
# Edit .env with your OAuth credentials

# Start database
docker-compose up -d db

# Run migrations
npm run db:push

# Start server
npm run dev
```

Or use Docker Compose for everything:

```bash
# Copy environment file and add your OAuth credentials
cp .env.example .env

# Start everything
docker-compose up
```

### Connect Claude Desktop

1. Open Claude Desktop (requires Pro/Max/Team/Enterprise plan)
2. Go to **Settings → Connectors**
3. Add a new MCP server:
   - **URL**: `http://localhost:3000/mcp` (or your production URL)
   - **Authentication**: Bearer token from Auth Portal
4. Visit `http://localhost:3000/auth` to:
   - Sign in with Google (Zivtech account)
   - Connect Jira, Slack, GitHub
   - Copy your MCP token

## OAuth App Setup

### Google Cloud Console

1. Go to [Google Cloud Console](https://console.cloud.google.com/apis/credentials)
2. Create OAuth 2.0 credentials
3. Add redirect URI: `https://your-domain.com/auth/google/callback`
4. Enable APIs: Gmail, Drive, Docs
5. Add scopes in OAuth consent screen:
   ```
   openid, email, profile
   https://www.googleapis.com/auth/gmail.readonly
   https://www.googleapis.com/auth/gmail.send
   https://www.googleapis.com/auth/drive.readonly
   https://www.googleapis.com/auth/documents.readonly
   ```
6. Restrict to your organization's domain (e.g., `zivtech.com`)

### Atlassian Developer Console

1. Go to [Atlassian Developer Console](https://developer.atlassian.com/console/myapps/)
2. Create an OAuth 2.0 integration
3. Add callback URL: `https://your-domain.com/auth/jira/callback`
4. Required scopes:
   ```
   read:jira-work
   write:jira-work
   read:jira-user
   offline_access
   ```

### Slack API

1. Go to [Slack API Apps](https://api.slack.com/apps)
2. Create a new app
3. Add redirect URL: `https://your-domain.com/auth/slack/callback`
4. User Token Scopes:
   ```
   channels:history
   channels:read
   chat:write
   users:read
   search:read
   ```

### GitHub OAuth

1. Go to [GitHub Developer Settings](https://github.com/settings/developers)
2. Create an OAuth App
3. Add callback URL: `https://your-domain.com/auth/github/callback`
4. Scopes are requested at authorization time:
   ```
   repo, read:user, read:org
   ```

## Available Tools

### Jira

| Tool | Description |
|------|-------------|
| `jira_search_issues` | Search using JQL |
| `jira_get_issue` | Get issue details |
| `jira_get_my_issues` | Get assigned issues |
| `jira_add_comment` | Add a comment |
| `jira_transition_issue` | Change issue status |
| `jira_list_projects` | List all projects |

### Slack

| Tool | Description |
|------|-------------|
| `slack_search_messages` | Search messages |
| `slack_get_channel_history` | Get channel messages |
| `slack_post_message` | Post a message |
| `slack_list_channels` | List channels |
| `slack_get_user_info` | Get user info |
| `slack_get_thread` | Get thread replies |

### GitHub

| Tool | Description |
|------|-------------|
| `github_search_code` | Search code |
| `github_list_prs` | List pull requests |
| `github_get_pr` | Get PR details |
| `github_list_issues` | List issues |
| `github_get_issue` | Get issue details |
| `github_list_repos` | List org repos |
| `github_get_file` | Get file contents |
| `github_create_issue_comment` | Add comment |

### Google

| Tool | Description |
|------|-------------|
| `gmail_search` | Search emails |
| `gmail_get_message` | Get email content |
| `gmail_get_thread` | Get thread |
| `gmail_send` | Send email |
| `gmail_reply` | Reply to thread |
| `drive_search` | Search files |
| `drive_get_file` | Get file metadata |
| `drive_list_folder` | List folder contents |
| `docs_get_content` | Get doc text |
| `docs_get_document` | Get doc structure |

## Scheduled Tasks

Run automated reports and alerts on a schedule. Manage tasks at `http://localhost:3000/tasks`.

### Available Task Types

| Task Type | Description | Example Schedule |
|-----------|-------------|------------------|
| `JIRA_STANDUP_SUMMARY` | Daily summary of team's Jira activity | `0 9 * * 1-5` (9am weekdays) |
| `JIRA_OVERDUE_ALERT` | Alert on overdue tickets | `0 8 * * *` (8am daily) |
| `JIRA_SPRINT_REPORT` | Sprint progress report | `0 17 * * 5` (5pm Friday) |
| `SLACK_CHANNEL_DIGEST` | Summarize channel activity | `0 18 * * 1-5` (6pm weekdays) |
| `SLACK_MENTIONS_SUMMARY` | Summary of your mentions | `0 9 * * 1-5` |
| `GITHUB_PR_REMINDER` | Open PRs needing review | `0 10 * * 1-5` |
| `GITHUB_STALE_PR_ALERT` | PRs open too long | `0 9 * * 1` (Monday 9am) |
| `GITHUB_RELEASE_NOTES` | Generate release notes | `0 12 * * 5` (Friday noon) |
| `GMAIL_DIGEST` | Email digest/summary | `0 8 * * 1-5` |
| `WEEKLY_STATUS_REPORT` | Combined report from all services | `0 17 * * 5` |

### Task Configuration

Each task type accepts specific configuration in JSON format:

```json
// Jira tasks
{"project": "PROJ", "team": ["user1", "user2"], "daysOverdue": 3}

// Slack tasks
{"channel": "general", "lookbackHours": 24}

// GitHub tasks
{"repo": "zivtech/website", "org": "zivtech", "staleDays": 7}

// Gmail tasks
{"query": "is:unread label:important"}
```

### Notifications

Tasks can notify via:
- **Slack**: Post results to a channel (e.g., `#standup`)
- **Email**: Send results via Gmail

Configure `notifyOnSuccess` and `notifyOnError` per task.

### Cron Expression Examples

| Expression | Meaning |
|------------|---------|
| `0 9 * * 1-5` | 9:00 AM, Monday-Friday |
| `0 8 * * 1` | 8:00 AM, Mondays |
| `0 */4 * * *` | Every 4 hours |
| `0 17 * * 5` | 5:00 PM, Fridays |
| `0 0 1 * *` | Midnight, 1st of month |

## Security

- All OAuth tokens encrypted at rest using AES-256
- MCP tokens are unique per user, revocable
- Google OAuth restricted to organization domain
- Session-based auth portal with HTTPS
- Audit logging for all tool executions
- No tokens stored in client or logs

## Deployment

### DigitalOcean App Platform

```yaml
# app.yaml
name: joyus-ai-mcp
services:
  - name: web
    source:
      repo: zivtech/joyus-ai
      branch: main
    build_command: npm ci && npm run build
    run_command: npm run db:migrate && npm start
    http_port: 3000
    instance_size_slug: basic-xs
    envs:
      - key: DATABASE_URL
        value: ${db.DATABASE_URL}
      # Add other env vars as secrets

databases:
  - name: db
    engine: PG
    production: true
```

### Environment Variables (Production)

```env
NODE_ENV=production
PORT=3000
BASE_URL=https://mcp.zivtech.com
DATABASE_URL=postgresql://...
SESSION_SECRET=<random-32-bytes>
TOKEN_ENCRYPTION_KEY=<random-32-bytes-hex>
GOOGLE_CLIENT_ID=...
GOOGLE_CLIENT_SECRET=...
ATLASSIAN_CLIENT_ID=...
ATLASSIAN_CLIENT_SECRET=...
SLACK_CLIENT_ID=...
SLACK_CLIENT_SECRET=...
GITHUB_CLIENT_ID=...
GITHUB_CLIENT_SECRET=...
```

## Development

```bash
# Install dependencies
npm install

# Run in development mode
npm run dev

# Build for production
npm run build

# Run production build
npm start

# Database commands
npm run db:generate   # Generate migrations
npm run db:migrate    # Run migrations
npm run db:push       # Push schema (dev)
npm run db:studio     # Open Drizzle Studio
```

## License

Proprietary - Zivtech Internal Use Only
