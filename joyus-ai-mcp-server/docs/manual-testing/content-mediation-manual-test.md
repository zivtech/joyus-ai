# Content Mediation Manual Test

| Field                | Value                                         |
| -------------------- | --------------------------------------------- |
| Feature area         | Content mediation                             |
| Related PR/issues    | Not specified                                 |
| Environment          | Local Docker Compose                          |
| Required services    | PostgreSQL, MCP server, local JWT/JWKS helper |
| Required credentials | Mediation API key and user JWT                |
| Last verified        | Not yet verified                              |

## Purpose

This tests the `/api/mediation/*` flow, including session creation, message
count increments, idle-gap tracking, and cache-miss logging.

## Important Auth Note

`/auth` and `/api/mediation` use different auth paths.

- `/auth` signs in a human user and gives them an MCP bearer token for `/mcp`.
- `/api/mediation` is for external content integrations and requires:
  - `X-API-Key`: identifies the tenant/integration.
  - `Authorization: Bearer <JWT>`: identifies the end user inside that integration.

The mediation API key is not recoverable from the database. Only its SHA-256
hash is stored. The operator command prints the raw key once at creation time.
If you lose it, revoke that key and create a new one.

## Do I Need To Write SQL?

No. Use the `mediation-api-keys` operator command to create, list, and revoke
mediation API keys. The command wraps `ApiKeyService`, stores only the hashed
key, and prints the raw key only in the `create` response.

## Overview

Use three terminals:

- Terminal 1: database and app
- Terminal 2: local JWT/JWKS helper
- Terminal 3: `psql` and `curl` commands

The local JWT/JWKS helper removes the need for Auth0, Okta, Clerk, Cognito, or
another external identity provider during local testing.

## Terminal 1: Start Database And App

Start Postgres:

```bash
docker compose up -d db
```

Set the database URL if your shell does not already have it:

```bash
export DATABASE_URL="postgresql://postgres:postgres@localhost:5432/joyus_ai_mcp"
```

Run migrations:

```bash
npm run db:migrate
```

Start the app:

```bash
npm run dev
```

Leave the app running.

Confirm the mediation router is mounted:

```bash
curl -sS "http://localhost:3000/api/mediation/health"
```

Expected:

```json
{ "status": "ok" }
```

## Terminal 2: Start Local JWT/JWKS Helper

Run:

```bash
npm run dev:mediation-auth
```

The helper:

- Generates a temporary RSA signing key.
- Serves the public key at `http://127.0.0.1:3999/.well-known/jwks.json`.
- Prints a matching `USER_JWT`.

Leave this process running while testing.

Copy the two `export` lines it prints into Terminal 3. They look like this:

```bash
export JWKS_URI="http://127.0.0.1:3999/.well-known/jwks.json"
export USER_JWT="<printed-jwt>"
```

## Terminal 3: Run Setup And Curl Commands

Set the base URL:

```bash
export BASE_URL="http://localhost:3000"
```

Set the database URL if needed:

```bash
export DATABASE_URL="postgresql://postgres:postgres@localhost:5432/joyus_ai_mcp"
```

Verify Postgres is reachable if this is a fresh local environment:

```bash
psql "$DATABASE_URL" -c "select 1;"
```

Copy the `JWKS_URI` and `USER_JWT` exports from Terminal 2 into this terminal.

## Create A Local Mediation API Key

Create a key for the local test tenant:

```bash
npm run mediation-api-keys -- create \
  --tenant-id tenant-1 \
  --integration-name local-manual-test \
  --jwks-uri "$JWKS_URI"
```

The command prints:

- key ID
- key prefix
- tenant and integration metadata
- raw API key, shown once

Copy the raw key into an environment variable:

```bash
export MEDIATION_API_KEY="<raw-key-printed-by-create>"
```

The local helper's JWT `sub` claim becomes the mediation user ID.

List safe key metadata without exposing raw keys or hashes:

```bash
npm run mediation-api-keys -- list --tenant-id tenant-1
```

## Create A Session

```bash
export SESSION_ID="$(
  curl -sS -X POST "$BASE_URL/api/mediation/sessions" \
    -H "Content-Type: application/json" \
    -H "X-API-Key: $MEDIATION_API_KEY" \
    -H "Authorization: Bearer $USER_JWT" \
    -d '{"profileId":"profile-1"}' \
  | jq -r '.sessionId'
)"

echo "$SESSION_ID"
```

Expected: a non-empty session ID.

If `SESSION_ID` is `null`, print the raw response to see the auth error:

```bash
curl -sS -X POST "$BASE_URL/api/mediation/sessions" \
  -H "Content-Type: application/json" \
  -H "X-API-Key: $MEDIATION_API_KEY" \
  -H "Authorization: Bearer $USER_JWT" \
  -d '{"profileId":"profile-1"}'
```

If the response is `{"error":"Invalid token"}`, the request is hitting the
generic MCP/pipeline bearer-token middleware instead of the mediation router.
Restart the app and confirm `GET /api/mediation/health` returns
`{"status":"ok"}` before retrying.

## Send A Message

```bash
curl -sS -X POST "$BASE_URL/api/mediation/sessions/$SESSION_ID/messages" \
  -H "Content-Type: application/json" \
  -H "X-API-Key: $MEDIATION_API_KEY" \
  -H "Authorization: Bearer $USER_JWT" \
  -d '{
    "message": "What content is available for this user?",
    "maxSources": 3
  }'
```

Expected: a generated response payload.

The idle-gap/cache-miss logic runs after generation succeeds. If this request
returns a generation/provider/content error, auth and session creation may still
be working, but the message counter and cache-miss metrics will not update for
that failed message.

## Force A Cache Miss

Age the session:

```bash
psql "$DATABASE_URL" -c "
update content.mediation_sessions
set last_activity_at = now() - interval '10 minutes'
where id = '$SESSION_ID';
"
```

Send another message:

```bash
curl -sS -X POST "$BASE_URL/api/mediation/sessions/$SESSION_ID/messages" \
  -H "Content-Type: application/json" \
  -H "X-API-Key: $MEDIATION_API_KEY" \
  -H "Authorization: Bearer $USER_JWT" \
  -d '{
    "message": "Summarize the most relevant source.",
    "maxSources": 3
  }'
```

## Verify Results

```bash
psql "$DATABASE_URL" -c "
select id, message_count, cache_miss_count, max_idle_gap_seconds, last_activity_at
from content.mediation_sessions
where id = '$SESSION_ID';
"
```

Expected:

- `message_count` increments after successful message processing.
- `cache_miss_count` increments after the aged-session message.
- `max_idle_gap_seconds` is at least the aged interval.

Check cache-miss operation logs:

```bash
psql "$DATABASE_URL" -c "
select operation, session_id, metadata, created_at
from content.operation_logs
where session_id = '$SESSION_ID'
order by created_at desc
limit 5;
"
```

Expected: one row with `operation = 'cache_miss'` and metadata containing
`idleGapSeconds` and `cacheTtlSeconds`.

## Revoke The Local Key

After testing, revoke the key by ID:

```bash
npm run mediation-api-keys -- revoke --key-id <key-id-printed-by-create>
```

The `dev:mediation-auth` helper only handles the JWKS/JWT side of local auth.
The `mediation-api-keys` command manages the integration API key used in the
`X-API-Key` header.
