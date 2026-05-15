# Orchestrator Event-Streamed Completion Manual Test

| Field | Value |
| --- | --- |
| Feature area | Platform core orchestrator |
| Related PR/issues | Platform core orchestrator branch |
| Environment | Local development |
| Required services | PostgreSQL, MCP server |
| Required credentials | MCP bearer token when testing protected HTTP routes |
| Last verified | Not yet verified |

## Purpose

This validates that the orchestrator message API and event log behavior match the
current contract:

- Message responses are documented as standard SSE orchestrator message events.
- Text payloads are not guaranteed to correspond to provider token deltas.
- Session lifecycle and context-window events are recorded through the typed
  event log.

## Prerequisites

From the repository root, use the orchestrator branch:

```bash
git checkout claude/platform-core-orchestrator
git pull origin claude/platform-core-orchestrator
```

Install dependencies if needed:

```bash
cd joyus-ai-mcp-server
npm install
```

Start PostgreSQL and apply the local schema:

```bash
docker compose up -d db
export DATABASE_URL="postgresql://postgres:postgres@localhost:5432/joyus_ai_mcp"
npm run db:migrate
```

Use `db:migrate` for this runbook. The orchestrator tables are covered by
checked-in migrations. `db:push` may fail in this branch because Drizzle Kit
loads TypeScript schema files through CommonJS and does not resolve the
NodeNext `.js` source imports used by the app runtime.

If using Docker Compose for the app server, confirm the `server` service startup
command runs `npm run db:migrate && npm run dev`, not `npm run db:push`.

Set a local base URL if testing the HTTP API manually:

```bash
export BASE_URL="http://localhost:3000"
```

If the route under test requires auth, sign in through the local auth flow and
set an MCP bearer token:

```bash
export TOKEN="<mcp-bearer-token>"
```

## Steps

### 1. Run Automated Smoke Checks

```bash
npm run typecheck
npm run lint
npx vitest run \
  tests/orchestrator/routes/openapi.test.ts \
  tests/orchestrator/streaming.test.ts \
  tests/orchestrator/agent-loop.service.test.ts \
  tests/orchestrator/integration/mount-wiring.test.ts
```

- [ ] Typecheck passes.
- [ ] Lint passes.
- [ ] The focused orchestrator test slice passes.

### 2. Inspect The OpenAPI Contract

Search the OpenAPI route and generated contract text:

```bash
rg -n "standard Server-Sent Events|provider token deltas|event-streamed completion|provider token streaming|token-by-token" \
  src/orchestrator/routes/openapi.ts \
  src/orchestrator/schemas.ts \
  ../kitty-specs/platform-core-orchestrator-01KREQVK/contracts/api.yaml
```

- [ ] Message streaming is described as standard Server-Sent Events.
- [ ] The docs clarify that text payloads are not guaranteed provider token deltas.
- [ ] No message endpoint description promises token-by-token provider output.

### 3. Start The Local Server

```bash
npm run dev
```

Leave the server running in this terminal.

Confirm the server is responding before hitting protected routes:

```bash
curl -i "$BASE_URL/health"
```

- [ ] Health returns an HTTP response from the app.

In another terminal:

```bash
export BASE_URL="http://localhost:3000"
export TOKEN="<mcp-bearer-token>"
```

Confirm the bearer token, database, and orchestrator mount are working:

```bash
curl -i "$BASE_URL/api/v1/orchestrator/openapi.json" \
  -H "Authorization: Bearer $TOKEN"
```

- [ ] The response is `HTTP 200`.
- [ ] The response body is the orchestrator OpenAPI document.

Resolve the authenticated user ID from the MCP bearer token:

```bash
export USER_ID="$(
  psql "$DATABASE_URL" -tA \
    -c "select id from users where mcp_token = '$TOKEN' limit 1;"
)"
test -n "$USER_ID" && echo "$USER_ID"
```

- [ ] `USER_ID` prints a real `users.id` value.

### 4. Exercise A Streamed Message Request

Create a session first:

```bash
curl -sS "$BASE_URL/api/v1/orchestrator/sessions" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d "{
    \"userId\": \"$USER_ID\",
    \"metadata\": {
      \"source\": \"manual-test\"
    }
  }"
```

Copy the returned `id` from this newly-created session:

```bash
export SESSION_ID="<returned-session-id>"
```

Confirm the session is `pending` or `running` before sending a message:

```bash
curl -sS "$BASE_URL/api/v1/orchestrator/sessions/$SESSION_ID" \
  -H "Authorization: Bearer $TOKEN"
```

- [ ] The session status is `pending` or `running`.

Send a streamed message request through the session-scoped message endpoint:

```bash
curl -N -sS "$BASE_URL/api/v1/orchestrator/sessions/$SESSION_ID/messages" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "message": "Reply with a short confirmation.",
    "stream": true
  }'
```

- [ ] The response is delivered as server-sent events.
- [ ] The stream emits structured completion/events.
- [ ] Any text chunks represent available completion text and are not guaranteed
      to correspond to provider token deltas.
- [ ] The stream reaches a terminal completion or error event.
- [ ] Reusing a `completed`, `failed`, or `cancelled` session returns `409`
      instead of accepting a new message.

Close the manual test session when you are done sending messages:

```bash
curl -sS -X PATCH "$BASE_URL/api/v1/orchestrator/sessions/$SESSION_ID" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"action":"stop"}'
```

- [ ] The session status becomes `completed`.

### 5. Verify Session Lifecycle Events

Create a new orchestrator session through the local session route or through the
message flow if that is the configured entry point.

- [ ] A typed event-log entry is recorded for `session.created`.
- [ ] Updating the session status records `session.status_changed`.
- [ ] The event payload includes the session and tenant identifiers expected by
      the local setup.

If the local environment uses PostgreSQL-backed events, inspect the event table
with the project database URL:

```bash
psql "$DATABASE_URL" -c "
select type, tenant_id, session_id, created_at
from orchestrator_events
where session_id = '$SESSION_ID'
order by created_at desc
limit 20;
"
```

### 6. Verify Context-Window Utilization Events

Run a message flow that exceeds the configured high-utilization threshold for
the orchestrator context window. Use a long prompt or existing local fixture data
if available.

- [ ] A typed event-log entry is recorded for
      `orchestrator.context_window.high_utilization`.
- [ ] The event includes utilization details sufficient to diagnose the session.
- [ ] The message request still completes or fails through the normal
      orchestrator event stream.

### 7. Confirm The SSE Contract Is Clear

Review the message endpoint wording and confirm it does not imply a nonstandard
SSE transport.

- [ ] `stream: true` is documented as standard Server-Sent Events.
- [ ] Events represent orchestrator message progress and completion.
- [ ] Text payloads are not guaranteed to correspond to provider token deltas.

## Expected Results

- The branch passes typecheck, lint, and the focused orchestrator tests.
- OpenAPI and spec wording consistently say standard SSE orchestrator message
  events.
- Manual SSE testing shows structured orchestrator events without promising
  provider token deltas.
- Typed event-log records exist for session creation, session status changes,
  and high context-window utilization.
- The SSE transport and orchestrator event semantics are described separately
  without implying a nonstandard SSE variant.

## Cleanup

Stop the local dev server with `Ctrl-C`.

If the manual session is still `running`, stop it:

```bash
curl -sS -X PATCH "$BASE_URL/api/v1/orchestrator/sessions/$SESSION_ID" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"action":"stop"}'
```

If test data was written to a local database, remove the manual session and its
related event rows according to the local schema and retention needs.

Unset local shell variables if desired:

```bash
unset BASE_URL TOKEN
```

## Troubleshooting

- If `curl` reports `Empty reply from server`, check the `npm run dev` terminal.
  This usually means the server process closed the connection before Express
  wrote a response. For this flow, the common causes are PostgreSQL not running,
  `DATABASE_URL` not set in the server shell, schema not applied with
  `npm run db:migrate`, or an MCP token lookup error.
- If `npm run db:push` fails with `Cannot find module '../schema.js'`, use
  `npm run db:migrate` instead for this manual test.
- If Docker Compose logs show the same `Cannot find module '../schema.js'`
  failure from `server-1`, rebuild/recreate the `server` service after pulling
  the compose change so it runs `db:migrate`.
- If the streamed message request returns `401`, refresh the local MCP bearer
  token and rerun the request with `Authorization: Bearer $TOKEN`.
- If session creation returns `INVALID_USER_ID` or the database reports
  `orchestrator_sessions_user_id_fkey`, the `userId` in the request does not
  exist in `users`. Resolve `USER_ID` from the bearer token and use that value
  instead of a made-up test ID.
- If sending a message returns `SESSION_NOT_RUNNING` with status `completed`,
  create a fresh session and update `SESSION_ID`. Completed sessions are
  terminal and are expected to reject new messages.
- If the route returns `404`, confirm the local orchestrator HTTP routes are
  mounted in the current dev configuration.
- If no event rows appear in the database, confirm the local server is using the
  same `DATABASE_URL` as the shell running `psql`.
- If the stream emits text chunks, treat them as available completion text unless
  a future API contract explicitly guarantees provider token deltas.
