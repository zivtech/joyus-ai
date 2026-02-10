# Zivtech AI Platform Architecture

## Vision

A centralized AI-powered work assistant platform that gives all team members access to powerful MCP tools (Jira, Playwright, GitHub, Slack, etc.) without requiring local installation, terminal access, or technical setup. The platform is built on a foundation of continuous improvement, where every mistake and moment of confusion becomes fuel for making the system better.

## Core Principles

1. **Zero Local Setup** - Users connect via web or Claude Desktop; all MCPs run server-side
2. **Visibility & Accountability** - Full audit trail of tool usage for the organization
3. **Continuous Improvement** - Mistakes and confusion are captured and used to improve
4. **Multi-Modal Access** - Claude Desktop for power users, Web UI for AFK/mobile access
5. **Secure by Default** - Centralized credential management, no tokens on user devices

---

## System Architecture

```
┌─────────────────────────────────────────────────────────────────────────────────┐
│                              USER ACCESS LAYER                                   │
│                                                                                  │
│   ┌─────────────────┐   ┌─────────────────┐   ┌─────────────────────────────┐   │
│   │  Claude Desktop │   │   Web Browser   │   │     Mobile (Future)         │   │
│   │   (MCP Client)  │   │   (React App)   │   │    (React Native/PWA)       │   │
│   └────────┬────────┘   └────────┬────────┘   └─────────────┬───────────────┘   │
│            │                     │                          │                    │
│            │     Bearer Token    │      Session/OAuth       │                    │
│            └─────────────────────┼──────────────────────────┘                    │
│                                  │                                               │
└──────────────────────────────────┼───────────────────────────────────────────────┘
                                   │
                                   ▼
┌──────────────────────────────────────────────────────────────────────────────────┐
│                          ZIVTECH AI GATEWAY                                       │
│                                                                                   │
│  ┌─────────────────────────────────────────────────────────────────────────────┐ │
│  │                           API Gateway / Load Balancer                        │ │
│  │                        (Rate Limiting, Auth Verification)                    │ │
│  └─────────────────────────────────────────────────────────────────────────────┘ │
│                                       │                                           │
│         ┌─────────────────────────────┼─────────────────────────────┐            │
│         │                             │                             │            │
│         ▼                             ▼                             ▼            │
│  ┌─────────────┐             ┌─────────────┐             ┌─────────────────┐    │
│  │ MCP Endpoint│             │  Web API    │             │  WebSocket      │    │
│  │   /mcp      │             │  /api/v1    │             │  /ws            │    │
│  │             │             │             │             │                 │    │
│  │ • tools/list│             │ • Chat      │             │ • Real-time     │    │
│  │ • tools/call│             │ • History   │             │ • Streaming     │    │
│  │ • resources │             │ • Settings  │             │ • Notifications │    │
│  └──────┬──────┘             └──────┬──────┘             └────────┬────────┘    │
│         │                           │                              │             │
│         └───────────────────────────┼──────────────────────────────┘             │
│                                     │                                            │
│  ┌──────────────────────────────────▼──────────────────────────────────────────┐ │
│  │                          ORCHESTRATION LAYER                                 │ │
│  │                                                                              │ │
│  │  ┌────────────────┐  ┌────────────────┐  ┌────────────────────────────────┐ │ │
│  │  │  Tool Router   │  │ Claude API     │  │     Improvement Engine         │ │ │
│  │  │                │  │ Integration    │  │                                │ │ │
│  │  │ • Route to MCP │  │                │  │ • Error Classification         │ │ │
│  │  │ • Validate     │  │ • Chat/Agentic │  │ • Confusion Detection          │ │ │
│  │  │ • Transform    │  │ • Tool Use     │  │ • Feedback Collection          │ │ │
│  │  │                │  │ • Streaming    │  │ • Auto-documentation           │ │ │
│  │  └────────────────┘  └────────────────┘  └────────────────────────────────┘ │ │
│  │                                                                              │ │
│  └──────────────────────────────────────────────────────────────────────────────┘ │
│                                     │                                            │
│  ┌──────────────────────────────────▼──────────────────────────────────────────┐ │
│  │                           MCP TOOL LAYER                                     │ │
│  │                                                                              │ │
│  │  ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌──────────────────┐  │ │
│  │  │   Jira   │ │  Slack   │ │  GitHub  │ │  Google  │ │    Playwright    │  │ │
│  │  │  Tools   │ │  Tools   │ │  Tools   │ │  Tools   │ │     Browser      │  │ │
│  │  │          │ │          │ │          │ │          │ │                  │  │ │
│  │  │ • Search │ │ • Search │ │ • PRs    │ │ • Gmail  │ │ • Navigate       │  │ │
│  │  │ • Update │ │ • Post   │ │ • Issues │ │ • Drive  │ │ • Screenshot     │  │ │
│  │  │ • Create │ │ • React  │ │ • Code   │ │ • Docs   │ │ • Interact       │  │ │
│  │  └──────────┘ └──────────┘ └──────────┘ └──────────┘ └──────────────────┘  │ │
│  │                                                                              │ │
│  │  ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌──────────────────────────────────┐│ │
│  │  │ Notion   │ │ Linear   │ │ Figma    │ │        Custom MCPs               ││ │
│  │  │  (TBD)   │ │  (TBD)   │ │  (TBD)   │ │    (Extensible Registry)         ││ │
│  │  └──────────┘ └──────────┘ └──────────┘ └──────────────────────────────────┘│ │
│  │                                                                              │ │
│  └──────────────────────────────────────────────────────────────────────────────┘ │
│                                                                                   │
└───────────────────────────────────────────────────────────────────────────────────┘
                                       │
                                       ▼
┌───────────────────────────────────────────────────────────────────────────────────┐
│                              DATA & ANALYTICS LAYER                                │
│                                                                                    │
│  ┌────────────────────┐  ┌─────────────────────┐  ┌─────────────────────────────┐ │
│  │    PostgreSQL      │  │   Analytics Store   │  │    Improvement Store        │ │
│  │                    │  │   (ClickHouse/PG)   │  │                             │ │
│  │ • Users            │  │                     │  │ • Error Patterns            │ │
│  │ • Connections      │  │ • Tool Usage Stats  │  │ • Confusion Events          │ │
│  │ • Conversations    │  │ • Latency Metrics   │  │ • User Feedback             │ │
│  │ • Tool Credentials │  │ • Success/Fail      │  │ • Improvement Suggestions   │ │
│  │ • Audit Logs       │  │ • User Patterns     │  │ • A/B Test Results          │ │
│  └────────────────────┘  └─────────────────────┘  └─────────────────────────────┘ │
│                                                                                    │
└───────────────────────────────────────────────────────────────────────────────────┘
                                       │
                                       ▼
┌───────────────────────────────────────────────────────────────────────────────────┐
│                              EXTERNAL SERVICES                                     │
│                                                                                    │
│  ┌─────────────┐ ┌─────────────┐ ┌─────────────┐ ┌─────────────┐ ┌─────────────┐  │
│  │ Atlassian   │ │   Slack     │ │   GitHub    │ │   Google    │ │  Target     │  │
│  │    API      │ │    API      │ │    API      │ │   APIs      │ │  Websites   │  │
│  └─────────────┘ └─────────────┘ └─────────────┘ └─────────────┘ └─────────────┘  │
│                                                                                    │
└───────────────────────────────────────────────────────────────────────────────────┘
```

---

## Continuous Improvement System

The platform is designed to get smarter over time by learning from every interaction.

```
┌─────────────────────────────────────────────────────────────────────────────────┐
│                        CONTINUOUS IMPROVEMENT LOOP                               │
│                                                                                  │
│    ┌──────────────┐         ┌──────────────┐         ┌──────────────┐           │
│    │   OBSERVE    │────────▶│   CLASSIFY   │────────▶│    IMPROVE   │           │
│    │              │         │              │         │              │           │
│    │ • Errors     │         │ • Tool Error │         │ • Update     │           │
│    │ • Confusion  │         │ • User Error │         │   Prompts    │           │
│    │ • Friction   │         │ • UX Issue   │         │ • Add Docs   │           │
│    │ • Feedback   │         │ • Missing    │         │ • New Tools  │           │
│    │ • Retries    │         │   Feature    │         │ • Fix Bugs   │           │
│    └──────────────┘         └──────────────┘         └──────────────┘           │
│           ▲                                                   │                  │
│           │                                                   │                  │
│           └───────────────────────────────────────────────────┘                  │
│                              Feedback Loop                                       │
│                                                                                  │
└─────────────────────────────────────────────────────────────────────────────────┘

OBSERVATION TRIGGERS:
┌────────────────────────────────────────────────────────────────────────────────┐
│                                                                                 │
│  🔴 Tool Execution Errors      - API failures, permission issues, timeouts     │
│  🟡 User Confusion Signals     - Repeated similar requests, "I meant...",      │
│                                  abandoned conversations, help requests        │
│  🟠 Friction Points            - Long pauses, edits, clarifications needed     │
│  💬 Explicit Feedback          - Thumbs up/down, comments, suggestions         │
│  🔄 Retry Patterns             - User tries same thing multiple ways           │
│                                                                                 │
└────────────────────────────────────────────────────────────────────────────────┘

IMPROVEMENT ACTIONS:
┌────────────────────────────────────────────────────────────────────────────────┐
│                                                                                 │
│  📝 Auto-Documentation         - Generate docs from successful interactions    │
│  🎯 Prompt Enhancement         - Improve tool descriptions based on usage      │
│  🔧 Tool Refinement            - Add parameters, improve defaults              │
│  📊 Admin Alerts               - Flag issues needing human intervention        │
│  🤖 A/B Testing                - Test prompt variations automatically          │
│                                                                                 │
└────────────────────────────────────────────────────────────────────────────────┘
```

---

## Data Model

```
┌─────────────────────────────────────────────────────────────────────────────────┐
│                              CORE ENTITIES                                       │
└─────────────────────────────────────────────────────────────────────────────────┘

┌─────────────────┐       ┌─────────────────┐       ┌─────────────────┐
│      User       │       │   Connection    │       │  Conversation   │
├─────────────────┤       ├─────────────────┤       ├─────────────────┤
│ id              │──┐    │ id              │       │ id              │
│ email           │  │    │ userId       ───┼───────│ userId       ───┼──┐
│ name            │  │    │ service         │       │ title           │  │
│ role            │  │    │ accessToken*    │       │ createdAt       │  │
│ mcpToken        │  └───▶│ refreshToken*   │       │ lastMessageAt   │  │
│ preferences     │       │ expiresAt       │       │ context         │  │
│ createdAt       │       │ metadata        │       └─────────────────┘  │
└─────────────────┘       └─────────────────┘              │             │
                                                           │             │
┌─────────────────┐       ┌─────────────────┐              │             │
│    Message      │       │   ToolExecution │              │             │
├─────────────────┤       ├─────────────────┤              │             │
│ id              │       │ id              │              │             │
│ conversationId──┼───────│ messageId    ───┼──────────────┘             │
│ role            │       │ userId       ───┼────────────────────────────┘
│ content         │       │ toolName        │
│ toolCalls       │       │ input           │
│ createdAt       │       │ output          │
└─────────────────┘       │ success         │
                          │ errorType       │
                          │ duration        │
                          │ createdAt       │
                          └─────────────────┘

┌─────────────────────────────────────────────────────────────────────────────────┐
│                           IMPROVEMENT ENTITIES                                   │
└─────────────────────────────────────────────────────────────────────────────────┘

┌─────────────────┐       ┌─────────────────┐       ┌─────────────────┐
│ ConfusionEvent  │       │   Feedback      │       │  Improvement    │
├─────────────────┤       ├─────────────────┤       ├─────────────────┤
│ id              │       │ id              │       │ id              │
│ userId          │       │ userId          │       │ type            │
│ conversationId  │       │ messageId       │       │ status          │
│ triggerType     │       │ rating          │       │ description     │
│ context         │       │ comment         │       │ relatedEvents   │
│ resolved        │       │ createdAt       │       │ implementedAt   │
│ createdAt       │       └─────────────────┘       │ impact          │
└─────────────────┘                                 └─────────────────┘
```

---

## User Flows

### Flow 1: Claude Desktop User (Power User)

```
┌──────────────────────────────────────────────────────────────────────────────┐
│                                                                               │
│  1. User opens Claude Desktop                                                 │
│  2. Zivtech AI MCP already configured (one-time setup)                        │
│  3. User asks: "What are my open Jira tickets?"                               │
│                                                                               │
│     Claude Desktop                    Zivtech AI Gateway                      │
│          │                                  │                                 │
│          │──── MCP tools/list ─────────────▶│                                 │
│          │◀─── [jira_*, slack_*, ...] ──────│                                 │
│          │                                  │                                 │
│          │──── jira_get_my_issues ─────────▶│                                 │
│          │                                  │──▶ Jira API                     │
│          │                                  │◀── Issues                       │
│          │◀─── Formatted Results ───────────│                                 │
│          │                                  │                                 │
│                                                                               │
│  4. Claude presents results naturally                                         │
│  5. User can follow up: "Transition PROJ-123 to In Progress"                  │
│                                                                               │
└──────────────────────────────────────────────────────────────────────────────┘
```

### Flow 2: Web App User (AFK Access)

```
┌──────────────────────────────────────────────────────────────────────────────┐
│                                                                               │
│  1. User visits https://ai.zivtech.com                                        │
│  2. Signs in with Google (Zivtech domain)                                     │
│  3. Chat interface appears with conversation history                          │
│                                                                               │
│     Web Browser                       Zivtech AI Gateway                      │
│          │                                  │                                 │
│          │──── POST /api/v1/chat ──────────▶│                                 │
│          │     { message: "..." }           │                                 │
│          │                                  │──▶ Claude API                   │
│          │                                  │    (with tools)                 │
│          │                                  │                                 │
│          │◀─── SSE: Streaming Response ─────│                                 │
│          │◀─── SSE: Tool Call ──────────────│                                 │
│          │◀─── SSE: Tool Result ────────────│                                 │
│          │◀─── SSE: Final Response ─────────│                                 │
│          │                                  │                                 │
│                                                                               │
│  4. Real-time streaming response in browser                                   │
│  5. Full conversation history persisted                                       │
│                                                                               │
└──────────────────────────────────────────────────────────────────────────────┘
```

### Flow 3: Playwright Browser Automation

```
┌──────────────────────────────────────────────────────────────────────────────┐
│                                                                               │
│  User: "Go to our staging site and check if the contact form works"           │
│                                                                               │
│  ┌─────────────────────────────────────────────────────────────────────────┐ │
│  │                         Playwright Sandbox                               │ │
│  │                                                                          │ │
│  │   1. browser_navigate → https://staging.client-site.com                  │ │
│  │   2. browser_screenshot → [Image shown to Claude]                        │ │
│  │   3. browser_click → "Contact" link                                      │ │
│  │   4. browser_fill → Form fields                                          │ │
│  │   5. browser_click → Submit button                                       │ │
│  │   6. browser_screenshot → Confirmation page                              │ │
│  │                                                                          │ │
│  │   Each step: Screenshot returned to Claude for visual reasoning          │ │
│  │                                                                          │ │
│  └─────────────────────────────────────────────────────────────────────────┘ │
│                                                                               │
│  Claude: "I tested the contact form. It works! Here's what I did..."         │
│          [Shows screenshots of each step]                                     │
│                                                                               │
└──────────────────────────────────────────────────────────────────────────────┘
```

---

## Security Model

```
┌─────────────────────────────────────────────────────────────────────────────────┐
│                              SECURITY LAYERS                                     │
│                                                                                  │
│  ┌─────────────────────────────────────────────────────────────────────────────┐│
│  │ Layer 1: Authentication                                                      ││
│  │                                                                              ││
│  │  • Google OAuth (restricted to @zivtech.com)                                 ││
│  │  • MCP Bearer tokens (unique per user, revocable)                            ││
│  │  • Session-based web auth with secure cookies                                ││
│  └─────────────────────────────────────────────────────────────────────────────┘│
│                                                                                  │
│  ┌─────────────────────────────────────────────────────────────────────────────┐│
│  │ Layer 2: Authorization                                                       ││
│  │                                                                              ││
│  │  • Role-based access (Admin, User)                                           ││
│  │  • Per-tool permissions (future)                                             ││
│  │  • Rate limiting per user/tool                                               ││
│  └─────────────────────────────────────────────────────────────────────────────┘│
│                                                                                  │
│  ┌─────────────────────────────────────────────────────────────────────────────┐│
│  │ Layer 3: Data Protection                                                     ││
│  │                                                                              ││
│  │  • OAuth tokens encrypted at rest (AES-256)                                  ││
│  │  • No credentials stored on user devices                                     ││
│  │  • Audit logging for all tool executions                                     ││
│  │  • Playwright sandboxed (no access to internal network)                      ││
│  └─────────────────────────────────────────────────────────────────────────────┘│
│                                                                                  │
│  ┌─────────────────────────────────────────────────────────────────────────────┐│
│  │ Layer 4: Operational Security                                                ││
│  │                                                                              ││
│  │  • Secrets in environment variables / secrets manager                        ││
│  │  • HTTPS everywhere                                                          ││
│  │  • Regular token rotation                                                    ││
│  │  • Admin dashboard for monitoring                                            ││
│  └─────────────────────────────────────────────────────────────────────────────┘│
│                                                                                  │
└─────────────────────────────────────────────────────────────────────────────────┘
```

---

## Technology Stack

| Layer | Technology | Rationale |
|-------|------------|-----------|
| **Frontend (Web)** | Next.js + React | SSR, great DX, easy deployment |
| **Backend** | Node.js + Express | Already have working MCP server |
| **Database** | PostgreSQL + Drizzle | Relational, typed ORM, no binaries |
| **Real-time** | WebSockets / SSE | Streaming Claude responses |
| **MCP Runtime** | Node.js child processes | Isolated MCP execution |
| **Browser Automation** | Playwright | Best-in-class, Anthropic-recommended |
| **Deployment** | DigitalOcean App Platform | Simple, cost-effective |
| **Monitoring** | Built-in + Sentry | Error tracking, performance |

---

## Admin Dashboard

```
┌─────────────────────────────────────────────────────────────────────────────────┐
│  ZIVTECH AI ADMIN                                               alex@zivtech.com │
├─────────────────────────────────────────────────────────────────────────────────┤
│                                                                                  │
│  ┌─────────────────┐  ┌─────────────────┐  ┌─────────────────┐  ┌─────────────┐ │
│  │  Total Users    │  │  Tool Calls     │  │  Success Rate   │  │  Errors     │ │
│  │      12         │  │   1,247/week    │  │     94.2%       │  │    73       │ │
│  │  +2 this week   │  │   ↑ 23%         │  │   ↑ 2.1%        │  │   ↓ 15%     │ │
│  └─────────────────┘  └─────────────────┘  └─────────────────┘  └─────────────┘ │
│                                                                                  │
│  TOOL USAGE (Last 7 Days)                                                        │
│  ┌─────────────────────────────────────────────────────────────────────────────┐│
│  │  jira_search_issues      ████████████████████████████████  342              ││
│  │  slack_search_messages   ██████████████████████  198                        ││
│  │  github_list_prs         ███████████████  156                               ││
│  │  playwright_screenshot   ████████████  134                                  ││
│  │  gmail_search            ████████  89                                       ││
│  └─────────────────────────────────────────────────────────────────────────────┘│
│                                                                                  │
│  IMPROVEMENT QUEUE                                                               │
│  ┌─────────────────────────────────────────────────────────────────────────────┐│
│  │  🔴 HIGH: jira_transition_issue failing for "Done" status (12 occurrences)  ││
│  │  🟡 MED:  Users asking for "sprint velocity" - feature request?             ││
│  │  🟡 MED:  Playwright timeout on client-x.com (slow site)                    ││
│  │  🟢 LOW:  "What can you do?" asked 8 times - improve onboarding?            ││
│  └─────────────────────────────────────────────────────────────────────────────┘│
│                                                                                  │
│  RECENT ACTIVITY                                                                 │
│  ┌─────────────────────────────────────────────────────────────────────────────┐│
│  │  14:32  alex@zivtech.com    jira_get_my_issues           ✓ 234ms            ││
│  │  14:31  sarah@zivtech.com   playwright_navigate          ✓ 1.2s             ││
│  │  14:28  mike@zivtech.com    slack_post_message           ✓ 189ms            ││
│  │  14:25  alex@zivtech.com    github_list_prs              ✗ 401 Unauthorized ││
│  └─────────────────────────────────────────────────────────────────────────────┘│
│                                                                                  │
└─────────────────────────────────────────────────────────────────────────────────┘
```
