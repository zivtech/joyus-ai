# Quickstart: Platform Core Orchestrator

**Mission:** platform-core-orchestrator-01KREQVK
**Target repo:** `joyus-ai` → `joyus-ai-mcp-server/`

---

## Prerequisites

- Node.js ≥20, pnpm
- PostgreSQL running (local or Docker)
- Inngest Dev Server (`npx inngest-cli@latest dev`)
- `joyus-ai-mcp-server` builds and passes tests

## Getting Started

```bash
# 1. Clone and install
cd ~/claude/joyus-ai/joyus-ai-mcp-server
pnpm install

# 2. Start Inngest dev server (separate terminal)
npx inngest-cli@latest dev

# 3. Run migrations (after WP01 adds orchestrator schema)
pnpm db:migrate

# 4. Start the server
pnpm dev

# 5. Run tests
pnpm test
```

## Key Paths (after implementation)

```
joyus-ai-mcp-server/src/
├── orchestrator/
│   ├── index.ts              # Module entry point, Express router
│   ├── session.service.ts    # Session lifecycle (FR-001)
│   ├── agent-loop.service.ts # Agent loop execution (FR-002)
│   ├── coordination.service.ts # Work units & groups (FR-003)
│   ├── event.service.ts      # Event system (FR-004)
│   ├── tool-router.service.ts # Tool routing (FR-008)
│   ├── skill-loader.service.ts # Skill application (FR-009)
│   ├── memory.service.ts     # Conversation memory (FR-010)
│   └── types.ts              # Shared types and Zod schemas
├── db/
│   └── schema.ts             # Extended with orchestrator tables
├── inngest/
│   └── functions/
│       └── orchestrator/     # Inngest function definitions
└── auth/                     # Existing — tenant context extraction
```

## Verifying the Spike (WP00)

```bash
# After WP00 spike code is written:
cd joyus-ai-mcp-server/spike/orchestrator

# Test Mastra + Inngest composition
pnpm test:spike

# Check: does the agent complete a multi-step tool-use loop?
# Check: does tenant context propagate without global state?
# Check: what's the token overhead vs raw Claude API?
```

## API Smoke Test (after WP01+WP02)

```bash
# Create a session
curl -X POST http://localhost:3000/api/v1/orchestrator/sessions \
  -H "Authorization: Bearer $JWT" \
  -H "Content-Type: application/json" \
  -d '{"userId": "user-uuid-here"}'

# Send a message (returns SSE stream)
curl -N http://localhost:3000/api/v1/orchestrator/sessions/$SESSION_ID/messages \
  -H "Authorization: Bearer $JWT" \
  -H "Content-Type: application/json" \
  -d '{"content": "Hello, what tools do you have available?"}'

# Subscribe to events
curl -N http://localhost:3000/api/v1/orchestrator/sessions/$SESSION_ID/events \
  -H "Authorization: Bearer $JWT"
```

---

*Quickstart created: 2026-05-12*
