# Zivtech AI Platform - Implementation Plan

## Executive Summary

Transform the existing Zivtech AI MCP Server into a full platform that enables all team members to access AI-powered work tools without local setup. The platform will be built incrementally, with each phase delivering usable value.

**Timeline:** 6-8 weeks to MVP
**Team:** 1-2 developers

---

## Phase 0: Foundation (Current State) ✅

**What we have:**
- Working MCP server with Jira, Slack, GitHub, Google tools
- OAuth authentication for all services
- Drizzle ORM with PostgreSQL
- Scheduled tasks system
- Docker configuration

**What's missing:**
- Web UI for AFK access
- Claude API integration for web chat
- Playwright/browser automation
- Usage analytics and improvement tracking
- Admin dashboard

---

## Phase 1: Core Platform Enhancements (Week 1-2)

### Goal
Solidify the foundation and add essential infrastructure for the web app.

### Tasks

#### 1.1 Database Schema Extensions
```sql
-- Conversations table (for web chat)
CREATE TABLE conversations (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id),
  title TEXT,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

-- Messages table
CREATE TABLE messages (
  id TEXT PRIMARY KEY,
  conversation_id TEXT NOT NULL REFERENCES conversations(id),
  role TEXT NOT NULL, -- 'user' | 'assistant'
  content TEXT NOT NULL,
  tool_calls JSONB,
  created_at TIMESTAMP DEFAULT NOW()
);

-- Tool executions (enhanced audit)
CREATE TABLE tool_executions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id),
  message_id TEXT REFERENCES messages(id),
  tool_name TEXT NOT NULL,
  input JSONB NOT NULL,
  output JSONB,
  success BOOLEAN NOT NULL,
  error_type TEXT,
  error_message TEXT,
  duration_ms INTEGER,
  created_at TIMESTAMP DEFAULT NOW()
);

-- Improvement tracking
CREATE TABLE confusion_events (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id),
  conversation_id TEXT REFERENCES conversations(id),
  trigger_type TEXT NOT NULL, -- 'retry' | 'clarification' | 'abandonment' | 'explicit'
  context JSONB,
  resolved BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMP DEFAULT NOW()
);
```

#### 1.2 Claude API Integration Service
```typescript
// src/services/claude.ts
interface ClaudeService {
  // Stream a chat response with tool use
  streamChat(params: {
    userId: string;
    conversationId: string;
    message: string;
    onToken: (token: string) => void;
    onToolCall: (call: ToolCall) => void;
    onToolResult: (result: ToolResult) => void;
    onComplete: (message: Message) => void;
  }): Promise<void>;

  // Get available tools for user
  getToolsForUser(userId: string): Promise<Tool[]>;
}
```

#### 1.3 API Routes for Web App
```
POST   /api/v1/conversations              - Create conversation
GET    /api/v1/conversations              - List conversations
GET    /api/v1/conversations/:id          - Get conversation with messages
DELETE /api/v1/conversations/:id          - Delete conversation
POST   /api/v1/conversations/:id/messages - Send message (SSE streaming)
```

#### 1.4 WebSocket/SSE Infrastructure
- Real-time streaming for Claude responses
- Tool execution status updates
- Typing indicators

### Deliverables
- [ ] Extended database schema (Drizzle migrations)
- [ ] Claude API service with streaming
- [ ] REST API for conversations
- [ ] SSE endpoint for streaming responses

### Success Criteria
- Can send a message and receive streamed Claude response via API
- Tool calls execute and results stream back
- Conversation history persists

---

## Phase 2: Web Application (Week 2-4)

### Goal
Build a functional web chat interface for AFK access.

### Tasks

#### 2.1 Next.js Web App Setup
```
joyus-ai-web/
├── src/
│   ├── app/
│   │   ├── layout.tsx
│   │   ├── page.tsx              # Landing/login
│   │   ├── chat/
│   │   │   ├── page.tsx          # Chat interface
│   │   │   └── [id]/page.tsx     # Specific conversation
│   │   └── api/
│   │       └── auth/[...nextauth]/route.ts
│   ├── components/
│   │   ├── ChatInterface.tsx
│   │   ├── MessageList.tsx
│   │   ├── MessageInput.tsx
│   │   ├── ToolCallDisplay.tsx
│   │   └── ConversationSidebar.tsx
│   └── lib/
│       ├── api.ts                # API client
│       └── stream.ts             # SSE handling
├── package.json
└── tailwind.config.js
```

#### 2.2 Core Components

**Chat Interface**
```
┌─────────────────────────────────────────────────────────────────────────────┐
│  Zivtech AI                                              admin@example.com ▼ │
├─────────────────────────────────────────────────────────────────────────────┤
│ ┌───────────────┐ ┌─────────────────────────────────────────────────────────┤
│ │ Conversations │ │                                                         │
│ │               │ │  ┌─────────────────────────────────────────────────────┐│
│ │ ○ Jira sprint │ │  │ 👤 What are my open Jira tickets?                   ││
│ │ ○ PR review   │ │  └─────────────────────────────────────────────────────┘│
│ │ ● New chat    │ │                                                         │
│ │               │ │  ┌─────────────────────────────────────────────────────┐│
│ │               │ │  │ 🤖 I'll check your Jira tickets...                  ││
│ │               │ │  │                                                      ││
│ │               │ │  │ 🔧 Using: jira_get_my_issues                        ││
│ │               │ │  │    ┌─────────────────────────────────┐              ││
│ │               │ │  │    │ Found 5 open tickets:           │              ││
│ │               │ │  │    │ • PROJ-123: Fix login bug       │              ││
│ │               │ │  │    │ • PROJ-124: Add dark mode       │              ││
│ │               │ │  │    │ ...                             │              ││
│ │               │ │  │    └─────────────────────────────────┘              ││
│ │               │ │  │                                                      ││
│ │               │ │  │ You have 5 open tickets. The highest priority...    ││
│ │               │ │  └─────────────────────────────────────────────────────┘│
│ │               │ │                                                         │
│ │               │ │  ┌─────────────────────────────────────────────────────┐│
│ │               │ │  │ Message Zivtech AI...                          Send ││
│ │               │ │  └─────────────────────────────────────────────────────┘│
│ └───────────────┘ └─────────────────────────────────────────────────────────┘
└─────────────────────────────────────────────────────────────────────────────┘
```

#### 2.3 Authentication Integration
- NextAuth.js with Google provider
- Session sync with backend API
- Automatic token refresh

#### 2.4 Streaming Response Handling
```typescript
// Handle SSE stream from backend
const stream = await fetch('/api/chat', {
  method: 'POST',
  body: JSON.stringify({ message }),
});

const reader = stream.body.getReader();
while (true) {
  const { done, value } = await reader.read();
  if (done) break;

  const event = parseSSE(value);
  switch (event.type) {
    case 'token':
      appendToMessage(event.data);
      break;
    case 'tool_call':
      showToolExecution(event.data);
      break;
    case 'tool_result':
      showToolResult(event.data);
      break;
  }
}
```

### Deliverables
- [ ] Next.js app with authentication
- [ ] Chat interface with conversation history
- [ ] Real-time streaming responses
- [ ] Tool call visualization
- [ ] Mobile-responsive design

### Success Criteria
- Users can sign in and chat via web browser
- Conversations persist across sessions
- Tool executions visible in real-time
- Works on mobile browsers

---

## Phase 3: Playwright Browser Automation (Week 4-5)

### Goal
Add browser automation capabilities via Playwright MCP.

### Tasks

#### 3.1 Playwright MCP Server Integration
- Run Playwright as a managed subprocess
- Sandbox browser sessions (isolated per request)
- Screenshot capture and streaming

#### 3.2 Browser Tool Definitions
```typescript
const playwrightTools = [
  {
    name: 'browser_navigate',
    description: 'Navigate to a URL and take a screenshot',
    inputSchema: {
      type: 'object',
      properties: {
        url: { type: 'string', description: 'URL to navigate to' }
      },
      required: ['url']
    }
  },
  {
    name: 'browser_screenshot',
    description: 'Take a screenshot of the current page',
    inputSchema: {
      type: 'object',
      properties: {
        fullPage: { type: 'boolean', default: false }
      }
    }
  },
  {
    name: 'browser_click',
    description: 'Click an element on the page',
    inputSchema: {
      type: 'object',
      properties: {
        selector: { type: 'string', description: 'CSS selector or text content' }
      },
      required: ['selector']
    }
  },
  {
    name: 'browser_fill',
    description: 'Fill in a form field',
    inputSchema: {
      type: 'object',
      properties: {
        selector: { type: 'string' },
        value: { type: 'string' }
      },
      required: ['selector', 'value']
    }
  },
  {
    name: 'browser_get_text',
    description: 'Get text content from the page',
    inputSchema: {
      type: 'object',
      properties: {
        selector: { type: 'string', description: 'CSS selector (optional, defaults to body)' }
      }
    }
  }
];
```

#### 3.3 Security Sandboxing
- Browsers run in isolated containers
- No access to internal network (localhost blocked)
- Session timeout (max 5 minutes)
- Screenshot size limits

#### 3.4 Visual Response Display
- Screenshots displayed inline in chat
- Step-by-step visual feedback
- Error screenshots for debugging

### Deliverables
- [ ] Playwright MCP integration
- [ ] Browser tool definitions
- [ ] Sandboxed browser execution
- [ ] Screenshot streaming to chat
- [ ] Browser session management

### Success Criteria
- Users can ask Claude to browse websites
- Screenshots appear in conversation
- Browser automation secure and isolated
- Reasonable performance (< 3s for simple operations)

---

## Phase 4: Continuous Improvement System (Week 5-6)

### Goal
Build the feedback loop that makes the platform smarter over time.

### Tasks

#### 4.1 Event Detection System
```typescript
interface ImprovementDetector {
  // Detect when user seems confused
  detectConfusion(conversation: Conversation): ConfusionEvent[];

  // Classify errors for prioritization
  classifyError(execution: ToolExecution): ErrorClassification;

  // Identify patterns across users
  findPatterns(events: Event[], timeRange: DateRange): Pattern[];
}

// Confusion signals
const confusionSignals = [
  'retry_similar_request',     // User asks same thing differently
  'clarification_phrase',      // "I meant...", "No, I wanted..."
  'help_request',              // "How do I...", "What can you do?"
  'abandoned_conversation',    // Started but didn't finish
  'explicit_confusion',        // "This is confusing", "I don't understand"
];
```

#### 4.2 Feedback Collection
```
┌─────────────────────────────────────────────────────────────────────────────┐
│  🤖 Here are your open tickets...                                           │
│                                                                              │
│  [Thumbs Up 👍] [Thumbs Down 👎] [Report Issue 🐛]                          │
│                                                                              │
│  ┌─────────────────────────────────────────────────────────────────────────┐│
│  │ Was this helpful?                                                        ││
│  │                                                                          ││
│  │ [ ] Yes, exactly what I needed                                          ││
│  │ [ ] Partially helpful                                                   ││
│  │ [ ] Not what I was looking for                                          ││
│  │                                                                          ││
│  │ What would have been better? (optional)                                  ││
│  │ ┌─────────────────────────────────────────────────────────────────────┐ ││
│  │ │                                                                      │ ││
│  │ └─────────────────────────────────────────────────────────────────────┘ ││
│  │                                                                [Submit] ││
│  └─────────────────────────────────────────────────────────────────────────┘│
└─────────────────────────────────────────────────────────────────────────────┘
```

#### 4.3 Admin Improvement Queue
- Prioritized list of issues
- One-click investigation (see context)
- Resolution tracking
- Impact measurement

#### 4.4 Auto-Documentation
- Generate usage examples from successful interactions
- Update tool descriptions based on common use cases
- Create FAQ from repeated questions

### Deliverables
- [ ] Confusion detection algorithms
- [ ] Feedback UI components
- [ ] Admin improvement queue
- [ ] Pattern detection reports
- [ ] Auto-documentation system

### Success Criteria
- Confusion events automatically detected
- Users can easily provide feedback
- Admins see prioritized improvement queue
- Measurable improvement over time

---

## Phase 5: Admin Dashboard (Week 6-7)

### Goal
Visibility into platform usage, health, and improvement opportunities.

### Tasks

#### 5.1 Dashboard Pages
- **Overview**: Key metrics, recent activity, health status
- **Users**: User list, usage patterns, connection status
- **Tools**: Per-tool usage, success rates, common errors
- **Improvements**: Queue, resolved issues, impact tracking
- **Settings**: OAuth apps, rate limits, feature flags

#### 5.2 Metrics Collection
```typescript
interface Metrics {
  // Usage
  totalUsers: number;
  activeUsersToday: number;
  toolCallsThisWeek: number;
  conversationsThisWeek: number;

  // Health
  successRate: number;
  avgLatency: number;
  errorsByType: Record<string, number>;

  // Improvement
  unresolvedConfusionEvents: number;
  feedbackScore: number;
  improvementsDeployed: number;
}
```

#### 5.3 Alerting
- Error rate spike notifications
- New error type alerts
- Usage anomaly detection

### Deliverables
- [ ] Admin dashboard UI
- [ ] Metrics collection and aggregation
- [ ] User management interface
- [ ] Tool monitoring views
- [ ] Basic alerting

### Success Criteria
- Admins can see platform health at a glance
- Easy to identify and investigate issues
- User management functional
- Alerts for critical issues

---

## Phase 6: Polish & Launch (Week 7-8)

### Goal
Production-ready deployment with documentation.

### Tasks

#### 6.1 Production Hardening
- [ ] Load testing
- [ ] Security audit
- [ ] Rate limiting tuned
- [ ] Error handling comprehensive
- [ ] Logging structured

#### 6.2 Documentation
- [ ] User guide (how to use the platform)
- [ ] Admin guide (managing the platform)
- [ ] Developer guide (extending with new MCPs)
- [ ] API documentation

#### 6.3 Deployment
- [ ] DigitalOcean App Platform setup
- [ ] Domain configuration (ai.example.com)
- [ ] SSL certificates
- [ ] Backup strategy
- [ ] Monitoring (uptime, errors)

#### 6.4 Onboarding
- [ ] Team training session
- [ ] Onboarding flow in app
- [ ] Welcome email with quick start
- [ ] Office hours for questions

### Deliverables
- [ ] Production deployment
- [ ] Documentation complete
- [ ] Team onboarded
- [ ] Support process defined

### Success Criteria
- Platform live at ai.example.com
- All team members can access
- < 1 minute to first successful tool use
- Clear path for support/feedback

---

## Risk Mitigation

| Risk | Likelihood | Impact | Mitigation |
|------|------------|--------|------------|
| Claude API costs unexpectedly high | Medium | High | Implement usage limits, monitor closely |
| Playwright security vulnerability | Low | High | Strict sandboxing, no internal network access |
| OAuth token expiration issues | Medium | Medium | Proactive refresh, clear reconnect flow |
| Users confused by capabilities | High | Medium | Onboarding, examples, improvement loop |
| Performance issues at scale | Low | Medium | Caching, async processing, load testing |

---

## Success Metrics

### Week 4 (Phase 2 Complete)
- [ ] 5+ team members using web app
- [ ] 100+ conversations created
- [ ] 90%+ tool execution success rate

### Week 6 (Phase 4 Complete)
- [ ] Confusion detection working
- [ ] 3+ improvements shipped from feedback
- [ ] User satisfaction > 4/5

### Week 8 (Launch)
- [ ] All team members onboarded
- [ ] < 5 minute average response time from support
- [ ] Zero critical security issues
- [ ] Platform uptime > 99%

---

## Resource Requirements

### Team
- 1 Full-stack developer (primary)
- 1 Developer (part-time, weeks 2-4)
- Alex (product direction, testing)

### Infrastructure
- DigitalOcean droplet (API server): ~$50/mo
- DigitalOcean managed Postgres: ~$15/mo
- Anthropic API: ~$100-500/mo (usage dependent)
- Domain/SSL: Already have

### Third-Party Services
- Anthropic Claude API (API key)
- Google OAuth app (already configured)
- Atlassian OAuth app (already configured)
- Slack OAuth app (already configured)
- GitHub OAuth app (already configured)

---

## Next Steps

1. **Review this plan** - Adjust scope/timeline as needed
2. **Phase 1 kickoff** - Start with database schema and Claude integration
3. **Weekly check-ins** - Review progress, adjust priorities
4. **Incremental releases** - Ship usable features as they're ready

---

*Document Version: 1.0*
*Last Updated: February 2026*
