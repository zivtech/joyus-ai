# Zivtech AI MCP Server - Architecture Document

## Overview

The Zivtech AI MCP Server is a remote MCP (Model Context Protocol) server that allows Claude Desktop users to interact with their work tools (Jira, Slack, GitHub, Google) directly through Claude's conversational interface.

## Why MCP Server Instead of Full Web App?

| Aspect | MCP Server | Full Web App |
|--------|-----------|--------------|
| **UI** | Uses Claude Desktop (existing, polished) | Custom chat UI needed |
| **Development** | ~2 weeks | ~4-6 weeks |
| **Maintenance** | Server only | Server + Frontend |
| **UX** | Native Claude experience | Custom, may be inferior |
| **Mobile** | Works via Claude mobile app | Need separate mobile app |
| **Requirements** | Claude paid plan | Any browser |

We chose **MCP Server** because:
1. Your Windows team member has a Claude paid plan
2. Claude Desktop already provides an excellent chat experience
3. Faster time to value (tools work today)
4. Option to add web app later if needed

## System Architecture

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                              USER DEVICES                                    │
│                                                                              │
│   ┌─────────────────┐     ┌─────────────────┐     ┌─────────────────┐       │
│   │ Windows Desktop │     │   Mac Desktop   │     │  Mobile (iOS/   │       │
│   │ Claude Desktop  │     │ Claude Desktop  │     │  Android)       │       │
│   │                 │     │                 │     │  Claude App     │       │
│   └────────┬────────┘     └────────┬────────┘     └────────┬────────┘       │
│            │                       │                       │                 │
└────────────┼───────────────────────┼───────────────────────┼─────────────────┘
             │                       │                       │
             │       MCP Protocol (HTTPS + JSON-RPC 2.0)     │
             │                       │                       │
             └───────────────────────┴───────────────────────┘
                                     │
                                     ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                        ZIVTECH AI MCP SERVER                                 │
│                         (Node.js / Express)                                  │
│                                                                              │
│   ┌─────────────────────────────────────────────────────────────────────┐   │
│   │                        Express Application                           │   │
│   │                                                                      │   │
│   │   ┌─────────────┐  ┌─────────────┐  ┌─────────────────────────────┐ │   │
│   │   │   /health   │  │   /auth/*   │  │          /mcp               │ │   │
│   │   │             │  │             │  │                             │ │   │
│   │   │ Health      │  │ Auth Portal │  │  • initialize               │ │   │
│   │   │ checks      │  │ OAuth flows │  │  • tools/list               │ │   │
│   │   │             │  │ Dashboard   │  │  • tools/call               │ │   │
│   │   └─────────────┘  └─────────────┘  └─────────────────────────────┘ │   │
│   │                                                                      │   │
│   └─────────────────────────────────────────────────────────────────────┘   │
│                                                                              │
│   ┌─────────────────────────────────────────────────────────────────────┐   │
│   │                        Tool Executors                                │   │
│   │                                                                      │   │
│   │  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌──────────────────────┐ │   │
│   │  │   Jira   │  │  Slack   │  │  GitHub  │  │       Google         │ │   │
│   │  │ Executor │  │ Executor │  │ Executor │  │      Executor        │ │   │
│   │  │          │  │          │  │          │  │ Gmail|Drive|Docs     │ │   │
│   │  └──────────┘  └──────────┘  └──────────┘  └──────────────────────┘ │   │
│   │                                                                      │   │
│   └─────────────────────────────────────────────────────────────────────┘   │
│                                                                              │
│   ┌─────────────────────────────────────────────────────────────────────┐   │
│   │                        Data Layer                                    │   │
│   │                                                                      │   │
│   │  ┌──────────────────┐  ┌─────────────────┐  ┌────────────────────┐  │   │
│   │  │  Drizzle ORM     │  │   Encryption    │  │   Token Refresh    │  │   │
│   │  │                  │  │   (AES-256)     │  │   (Auto-renewal)   │  │   │
│   │  └──────────────────┘  └─────────────────┘  └────────────────────┘  │   │
│   │                                                                      │   │
│   └─────────────────────────────────────────────────────────────────────┘   │
│                                                                              │
└──────────────────────────────────┬──────────────────────────────────────────┘
                                   │
                                   ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                           PostgreSQL Database                                │
│                                                                              │
│   ┌─────────────┐  ┌─────────────────┐  ┌───────────┐  ┌────────────────┐   │
│   │    User     │  │   Connection    │  │ AuditLog  │  │   OAuthState   │   │
│   │             │  │                 │  │           │  │                │   │
│   │ id          │  │ id              │  │ id        │  │ id             │   │
│   │ email       │  │ userId          │  │ userId    │  │ state          │   │
│   │ name        │  │ service         │  │ tool      │  │ userId         │   │
│   │ mcpToken    │◄─│ accessToken*    │  │ input     │  │ service        │   │
│   │             │  │ refreshToken*   │  │ success   │  │ expiresAt      │   │
│   └─────────────┘  │ expiresAt       │  │ error     │  └────────────────┘   │
│                    │ metadata        │  │ duration  │                        │
│                    └─────────────────┘  └───────────┘                        │
│                    * encrypted at rest                                       │
└─────────────────────────────────────────────────────────────────────────────┘
                                   │
                    ┌──────────────┼──────────────┐
                    │              │              │
                    ▼              ▼              ▼
           ┌───────────────┐ ┌──────────┐ ┌─────────────┐
           │ Atlassian API │ │ Slack    │ │ GitHub API  │  + Google APIs
           │ (Jira Cloud)  │ │ Web API  │ │             │
           └───────────────┘ └──────────┘ └─────────────┘
```

## Data Flow

### User Onboarding

```
1. User visits https://mcp.zivtech.com/auth
2. Signs in with Google (restricted to @zivtech.com)
3. Clicks "Connect Jira" → OAuth flow → Tokens stored (encrypted)
4. Clicks "Connect Slack" → OAuth flow → Tokens stored (encrypted)
5. Clicks "Connect GitHub" → OAuth flow → Tokens stored (encrypted)
6. Copies MCP token from dashboard
7. Adds server to Claude Desktop: Settings → Connectors
```

### Tool Execution

```
1. User asks Claude: "What are my open Jira tickets?"
2. Claude Desktop sends MCP request to /mcp endpoint
3. Server validates Bearer token → Gets user
4. Server calls tools/list → Returns available tools based on connections
5. Claude selects jira_get_my_issues tool
6. Server executes tool:
   a. Gets user's Jira connection from database
   b. Decrypts access token
   c. Checks if token expired → Refreshes if needed
   d. Calls Jira API with token
   e. Formats response
   f. Logs to AuditLog
7. Returns result to Claude
8. Claude formats and presents to user
```

## Security Model

### Authentication Layers

| Layer | Mechanism |
|-------|-----------|
| Auth Portal | Google OAuth (Zivtech domain only) |
| MCP Endpoint | Bearer token (user's mcpToken) |
| Service APIs | OAuth 2.0 tokens per service |

### Token Storage

- All OAuth tokens encrypted using AES-256 before database storage
- Encryption key stored in environment variable (not in code/repo)
- MCP tokens are random 64-character hex strings
- Tokens can be revoked by disconnecting service in Auth Portal

### Audit Trail

Every tool execution is logged with:
- User ID
- Tool name
- Input parameters
- Success/failure status
- Error message (if any)
- Duration (ms)
- Timestamp

## File Structure

```
zivtech-ai-mcp-server/
├── src/
│   ├── index.ts              # Express server, MCP endpoint
│   ├── db/
│   │   ├── client.ts         # Drizzle client singleton
│   │   ├── schema.ts         # Database schema (Drizzle)
│   │   └── encryption.ts     # Token encryption/decryption
│   ├── auth/
│   │   ├── verify.ts         # MCP token verification
│   │   └── routes.ts         # OAuth flows, Auth Portal UI
│   ├── scheduler/
│   │   ├── index.ts          # Task scheduler (cron)
│   │   ├── routes.ts         # Task management UI
│   │   ├── task-executor.ts  # Task type implementations
│   │   └── notifications.ts  # Slack/Email notifications
│   └── tools/
│       ├── index.ts          # Tool definitions aggregator
│       ├── executor.ts       # Tool routing and execution
│       ├── jira-tools.ts     # Jira tool definitions
│       ├── slack-tools.ts    # Slack tool definitions
│       ├── github-tools.ts   # GitHub tool definitions
│       ├── google-tools.ts   # Google tool definitions
│       └── executors/
│           ├── jira-executor.ts
│           ├── slack-executor.ts
│           ├── github-executor.ts
│           └── google-executor.ts
├── drizzle/
│   └── migrations/           # Database migrations
├── package.json
├── tsconfig.json
├── drizzle.config.ts
├── Dockerfile
├── docker-compose.yml
└── README.md
```

## Future Enhancements

### Phase 2: Full Web App (If Needed)

If we need to support users without Claude paid plans:

```
┌─────────────────┐      ┌───────────────────┐
│  Claude Desktop │      │ Zivtech AI Web App│
│  (MCP Client)   │      │   (Custom Chat)   │
└────────┬────────┘      └────────┬──────────┘
         │                        │
         │   Both use same       │
         │   backend tools       │
         └────────┬──────────────┘
                  │
                  ▼
         ┌───────────────┐
         │  Zivtech AI   │
         │  MCP Server   │
         └───────────────┘
```

The web app would:
1. Authenticate users via the existing Auth Portal
2. Call Claude API directly with tool definitions
3. Execute tools via internal API calls to same executors
4. Maintain conversation history in database

### Phase 3: Additional Integrations

- **Notion**: Meeting notes, documentation
- **Linear**: Alternative issue tracking
- **Confluence**: Wiki search
- **Figma**: Design specs
- **Asana**: Task management
