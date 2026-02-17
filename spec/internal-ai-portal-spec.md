# Zivtech Internal AI Portal — Technical Specification

**Version:** 1.0
**Date:** January 29, 2026
**Status:** Ready for Implementation

---

## Overview

A self-hosted web application that provides Zivtech staff with Claude-powered AI assistance, integrated with their work tools (Jira, Slack, Gmail, Google Docs, GitHub).

## Technology Stack

| Layer | Technology | Rationale |
|-------|------------|-----------|
| **Frontend** | Next.js 14 (App Router) | Modern React, SSR, great DX |
| **Backend** | Next.js API Routes | Single codebase, simpler deployment |
| **Database** | PostgreSQL | Reliable, good for OAuth tokens |
| **ORM** | Prisma | Type-safe, great migrations |
| **Auth** | NextAuth.js | Easy Google OAuth, session management |
| **AI** | Anthropic Claude API | Tool use, streaming responses |
| **UI** | Tailwind + shadcn/ui | Professional, consistent styling |
| **Hosting** | DigitalOcean App Platform | Simple, affordable, managed PostgreSQL |

## Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                    NEXT.JS APPLICATION                           │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  /app                                                            │
│  ├── page.tsx                    Landing / Login                 │
│  ├── /chat                                                       │
│  │   └── page.tsx                Main chat interface             │
│  ├── /settings                                                   │
│  │   └── page.tsx                Connection management           │
│  └── /api                                                        │
│      ├── /auth/[...nextauth]     NextAuth.js routes             │
│      ├── /chat                   Claude API proxy + tools        │
│      ├── /connections                                            │
│      │   ├── /jira               Jira OAuth + operations        │
│      │   ├── /slack              Slack OAuth + operations       │
│      │   ├── /github             GitHub OAuth + operations      │
│      │   └── /google             Google OAuth (extended scopes) │
│      └── /tools                                                  │
│          ├── /jira               Tool implementations           │
│          ├── /slack                                              │
│          ├── /github                                             │
│          └── /google                                             │
│                                                                  │
│  /lib                                                            │
│  ├── claude.ts                   Claude API client + tool exec  │
│  ├── tools/                      Tool definitions per service   │
│  │   ├── jira-tools.ts                                          │
│  │   ├── slack-tools.ts                                         │
│  │   ├── github-tools.ts                                        │
│  │   └── google-tools.ts                                        │
│  └── db.ts                       Prisma client                  │
│                                                                  │
│  /prisma                                                         │
│  └── schema.prisma               Database schema                │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

## Database Schema

```prisma
// prisma/schema.prisma

generator client {
  provider = "prisma-client-js"
}

datasource db {
  provider = "postgresql"
  url      = env("DATABASE_URL")
}

model User {
  id            String    @id @default(cuid())
  email         String    @unique
  name          String?
  image         String?
  createdAt     DateTime  @default(now())
  updatedAt     DateTime  @updatedAt

  // NextAuth.js relations
  accounts      Account[]
  sessions      Session[]

  // Our relations
  connections   Connection[]
  conversations Conversation[]
}

model Account {
  id                String  @id @default(cuid())
  userId            String
  type              String
  provider          String
  providerAccountId String
  refresh_token     String? @db.Text
  access_token      String? @db.Text
  expires_at        Int?
  token_type        String?
  scope             String?
  id_token          String? @db.Text
  session_state     String?

  user User @relation(fields: [userId], references: [id], onDelete: Cascade)

  @@unique([provider, providerAccountId])
}

model Session {
  id           String   @id @default(cuid())
  sessionToken String   @unique
  userId       String
  expires      DateTime
  user         User     @relation(fields: [userId], references: [id], onDelete: Cascade)
}

// Service-specific OAuth tokens (beyond Google SSO)
model Connection {
  id           String    @id @default(cuid())
  userId       String
  service      String    // 'jira', 'slack', 'github'
  accessToken  String    @db.Text  // Encrypted
  refreshToken String?   @db.Text  // Encrypted
  expiresAt    DateTime?
  metadata     Json?     // Service-specific data (e.g., Slack workspace)
  createdAt    DateTime  @default(now())
  updatedAt    DateTime  @updatedAt

  user User @relation(fields: [userId], references: [id], onDelete: Cascade)

  @@unique([userId, service])
}

model Conversation {
  id        String    @id @default(cuid())
  userId    String
  title     String?
  messages  Json      // Array of {role, content, tools}
  createdAt DateTime  @default(now())
  updatedAt DateTime  @updatedAt

  user User @relation(fields: [userId], references: [id], onDelete: Cascade)
}
```

## OAuth Configuration

### Google (SSO + Workspace)

**Console:** https://console.cloud.google.com/apis/credentials

**Scopes:**
```
openid
email
profile
https://www.googleapis.com/auth/gmail.readonly
https://www.googleapis.com/auth/gmail.send
https://www.googleapis.com/auth/drive.readonly
https://www.googleapis.com/auth/documents.readonly
```

**Redirect URI:** `https://your-domain.com/api/auth/callback/google`

### Atlassian (Jira)

**Console:** https://developer.atlassian.com/console/myapps/

**Scopes:**
```
read:jira-work
write:jira-work
read:jira-user
```

**Redirect URI:** `https://your-domain.com/api/connections/jira/callback`

### Slack

**Console:** https://api.slack.com/apps

**Scopes (User Token):**
```
channels:history
channels:read
chat:write
users:read
search:read
```

**Redirect URI:** `https://your-domain.com/api/connections/slack/callback`

### GitHub

**Console:** https://github.com/settings/developers

**Scopes:**
```
repo
read:user
read:org
```

**Redirect URI:** `https://your-domain.com/api/connections/github/callback`

## Tool Definitions

### Jira Tools

```typescript
// lib/tools/jira-tools.ts

export const jiraTools = [
  {
    name: "jira_search_issues",
    description: "Search Jira issues using JQL",
    input_schema: {
      type: "object",
      properties: {
        jql: { type: "string", description: "JQL query string" },
        maxResults: { type: "number", default: 20 }
      },
      required: ["jql"]
    }
  },
  {
    name: "jira_get_issue",
    description: "Get details of a specific Jira issue",
    input_schema: {
      type: "object",
      properties: {
        issueKey: { type: "string", description: "Issue key like PROJ-123" }
      },
      required: ["issueKey"]
    }
  },
  {
    name: "jira_get_my_issues",
    description: "Get issues assigned to the current user",
    input_schema: {
      type: "object",
      properties: {
        status: { type: "string", description: "Filter by status (optional)" }
      }
    }
  },
  {
    name: "jira_add_comment",
    description: "Add a comment to a Jira issue",
    input_schema: {
      type: "object",
      properties: {
        issueKey: { type: "string" },
        comment: { type: "string" }
      },
      required: ["issueKey", "comment"]
    }
  },
  {
    name: "jira_transition_issue",
    description: "Move an issue to a different status",
    input_schema: {
      type: "object",
      properties: {
        issueKey: { type: "string" },
        transitionName: { type: "string", description: "Target status name" }
      },
      required: ["issueKey", "transitionName"]
    }
  }
];
```

### Slack Tools

```typescript
// lib/tools/slack-tools.ts

export const slackTools = [
  {
    name: "slack_search_messages",
    description: "Search for messages in Slack",
    input_schema: {
      type: "object",
      properties: {
        query: { type: "string" },
        count: { type: "number", default: 20 }
      },
      required: ["query"]
    }
  },
  {
    name: "slack_get_channel_history",
    description: "Get recent messages from a channel",
    input_schema: {
      type: "object",
      properties: {
        channel: { type: "string", description: "Channel name or ID" },
        limit: { type: "number", default: 50 }
      },
      required: ["channel"]
    }
  },
  {
    name: "slack_post_message",
    description: "Send a message to a Slack channel",
    input_schema: {
      type: "object",
      properties: {
        channel: { type: "string" },
        text: { type: "string" }
      },
      required: ["channel", "text"]
    }
  },
  {
    name: "slack_list_channels",
    description: "List available Slack channels",
    input_schema: {
      type: "object",
      properties: {}
    }
  }
];
```

### GitHub Tools

```typescript
// lib/tools/github-tools.ts

export const githubTools = [
  {
    name: "github_search_code",
    description: "Search for code across repositories",
    input_schema: {
      type: "object",
      properties: {
        query: { type: "string" },
        org: { type: "string", description: "Limit to organization (optional)" }
      },
      required: ["query"]
    }
  },
  {
    name: "github_list_prs",
    description: "List pull requests for a repository",
    input_schema: {
      type: "object",
      properties: {
        repo: { type: "string", description: "owner/repo format" },
        state: { type: "string", enum: ["open", "closed", "all"], default: "open" }
      },
      required: ["repo"]
    }
  },
  {
    name: "github_get_pr",
    description: "Get details of a specific pull request",
    input_schema: {
      type: "object",
      properties: {
        repo: { type: "string" },
        prNumber: { type: "number" }
      },
      required: ["repo", "prNumber"]
    }
  },
  {
    name: "github_list_issues",
    description: "List issues for a repository",
    input_schema: {
      type: "object",
      properties: {
        repo: { type: "string" },
        state: { type: "string", enum: ["open", "closed", "all"], default: "open" }
      },
      required: ["repo"]
    }
  }
];
```

### Google Tools

```typescript
// lib/tools/google-tools.ts

export const googleTools = [
  {
    name: "gmail_search",
    description: "Search Gmail messages",
    input_schema: {
      type: "object",
      properties: {
        query: { type: "string", description: "Gmail search query" },
        maxResults: { type: "number", default: 10 }
      },
      required: ["query"]
    }
  },
  {
    name: "gmail_get_message",
    description: "Get a specific email message",
    input_schema: {
      type: "object",
      properties: {
        messageId: { type: "string" }
      },
      required: ["messageId"]
    }
  },
  {
    name: "gmail_send",
    description: "Send an email",
    input_schema: {
      type: "object",
      properties: {
        to: { type: "string" },
        subject: { type: "string" },
        body: { type: "string" }
      },
      required: ["to", "subject", "body"]
    }
  },
  {
    name: "drive_search",
    description: "Search Google Drive files",
    input_schema: {
      type: "object",
      properties: {
        query: { type: "string" },
        maxResults: { type: "number", default: 10 }
      },
      required: ["query"]
    }
  },
  {
    name: "docs_get_content",
    description: "Get content of a Google Doc",
    input_schema: {
      type: "object",
      properties: {
        documentId: { type: "string" }
      },
      required: ["documentId"]
    }
  }
];
```

## Chat API Implementation

```typescript
// app/api/chat/route.ts

import Anthropic from '@anthropic-ai/sdk';
import { getServerSession } from 'next-auth';
import { prisma } from '@/lib/db';
import { executeJiraTool } from '@/lib/tools/jira-executor';
import { executeSlackTool } from '@/lib/tools/slack-executor';
import { executeGithubTool } from '@/lib/tools/github-executor';
import { executeGoogleTool } from '@/lib/tools/google-executor';
import { jiraTools } from '@/lib/tools/jira-tools';
import { slackTools } from '@/lib/tools/slack-tools';
import { githubTools } from '@/lib/tools/github-tools';
import { googleTools } from '@/lib/tools/google-tools';

const anthropic = new Anthropic();

export async function POST(req: Request) {
  const session = await getServerSession();
  if (!session?.user?.email) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { messages, conversationId } = await req.json();

  // Get user's connections
  const user = await prisma.user.findUnique({
    where: { email: session.user.email },
    include: { connections: true }
  });

  // Build available tools based on connections
  const tools = [];
  const connections = new Map(user.connections.map(c => [c.service, c]));

  if (connections.has('jira')) tools.push(...jiraTools);
  if (connections.has('slack')) tools.push(...slackTools);
  if (connections.has('github')) tools.push(...githubTools);
  // Google tools always available via SSO
  tools.push(...googleTools);

  // System message with context
  const systemMessage = `You are a helpful AI assistant for Zivtech staff.

Available integrations:
${connections.has('jira') ? '- Jira: Search issues, view details, add comments' : ''}
${connections.has('slack') ? '- Slack: Search messages, read channels, post messages' : ''}
${connections.has('github') ? '- GitHub: Search code, view PRs and issues' : ''}
- Google: Search Gmail, read/send emails, search Drive, read Docs

When asked about work tasks, proactively use tools to gather relevant information.
Always cite your sources (e.g., "According to PROJ-123..." or "In #channel...").`;

  // Call Claude with tools
  let response = await anthropic.messages.create({
    model: 'claude-sonnet-4-20250514',
    max_tokens: 4096,
    system: systemMessage,
    messages,
    tools,
  });

  // Handle tool use
  while (response.stop_reason === 'tool_use') {
    const toolUseBlock = response.content.find(b => b.type === 'tool_use');

    let toolResult;
    try {
      toolResult = await executeTool(
        toolUseBlock.name,
        toolUseBlock.input,
        user,
        connections
      );
    } catch (error) {
      toolResult = { error: error.message };
    }

    // Continue conversation with tool result
    response = await anthropic.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 4096,
      system: systemMessage,
      messages: [
        ...messages,
        { role: 'assistant', content: response.content },
        {
          role: 'user',
          content: [{
            type: 'tool_result',
            tool_use_id: toolUseBlock.id,
            content: JSON.stringify(toolResult)
          }]
        }
      ],
      tools,
    });
  }

  return Response.json({ content: response.content });
}

async function executeTool(name: string, input: any, user: any, connections: Map<string, any>) {
  if (name.startsWith('jira_')) {
    return executeJiraTool(name, input, connections.get('jira'));
  }
  if (name.startsWith('slack_')) {
    return executeSlackTool(name, input, connections.get('slack'));
  }
  if (name.startsWith('github_')) {
    return executeGithubTool(name, input, connections.get('github'));
  }
  if (name.startsWith('gmail_') || name.startsWith('drive_') || name.startsWith('docs_')) {
    return executeGoogleTool(name, input, user);
  }
  throw new Error(`Unknown tool: ${name}`);
}
```

## Deployment Configuration

### Environment Variables

```env
# .env.local

# Database
DATABASE_URL="postgresql://user:pass@host:5432/joyus_ai_portal"

# NextAuth
NEXTAUTH_SECRET="generate-with-openssl-rand-base64-32"
NEXTAUTH_URL="https://ai.zivtech.com"

# Google OAuth
GOOGLE_CLIENT_ID="xxx.apps.googleusercontent.com"
GOOGLE_CLIENT_SECRET="xxx"

# Anthropic
ANTHROPIC_API_KEY="sk-ant-xxx"

# Atlassian/Jira
ATLASSIAN_CLIENT_ID="xxx"
ATLASSIAN_CLIENT_SECRET="xxx"

# Slack
SLACK_CLIENT_ID="xxx"
SLACK_CLIENT_SECRET="xxx"

# GitHub
GITHUB_CLIENT_ID="xxx"
GITHUB_CLIENT_SECRET="xxx"

# Encryption key for stored tokens
TOKEN_ENCRYPTION_KEY="generate-32-byte-key"
```

### DigitalOcean App Platform

```yaml
# app.yaml

name: joyus-ai-portal
services:
  - name: web
    source:
      repo: zivtech/ai-portal
      branch: main
    build_command: npm run build
    run_command: npm start
    envs:
      - key: NODE_ENV
        value: production
      - key: DATABASE_URL
        value: ${db.DATABASE_URL}
      # ... other env vars as secrets
    http_port: 3000
    instance_size_slug: basic-xs
    instance_count: 1

databases:
  - name: db
    engine: PG
    production: true
    cluster_name: joyus-ai-db
    db_name: ai_portal
    db_user: ai_portal
```

## Security Checklist

- [ ] Google OAuth restricted to @zivtech.com domain
- [ ] All OAuth tokens encrypted at rest using AES-256
- [ ] HTTPS enforced via App Platform
- [ ] Rate limiting on API routes
- [ ] CORS configured for production domain only
- [ ] Session timeout after 24 hours
- [ ] Audit logging for all tool executions
- [ ] No secrets in client-side code

## Implementation Order

### Week 1: Foundation
1. Next.js project setup with TypeScript
2. Prisma + PostgreSQL schema
3. NextAuth.js with Google OAuth
4. Basic chat UI (no tools yet)
5. Deploy to DigitalOcean

### Week 2: Integrations
1. Jira OAuth flow + tools
2. Slack OAuth flow + tools
3. GitHub OAuth flow + tools
4. Extended Google scopes + tools

### Week 3: Polish
1. Connection management UI
2. Conversation history
3. Error handling improvements
4. Usage logging
5. Testing + bug fixes

## Success Metrics

- Staff member can authenticate via Google
- Can query all 4 connected services via chat
- Response time < 5 seconds for simple queries
- Zero unencrypted token storage
- 99%+ uptime on DigitalOcean
