# Content Mediation Manual Test

| Field | Value |
| --- | --- |
| Feature area | Content mediation |
| Related PR/issues | Not specified |
| Environment | Local Docker Compose |
| Required services | PostgreSQL, MCP server, local JWT/JWKS helper |
| Required credentials | Mediation API key and user JWT |
| Last verified | Not yet verified |

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
hash is stored. If you do not already have the raw key, create a local test key
and insert its hash.

## Do I Need To Run Postgres Commands?

For the current code, yes, unless a valid mediation API key and matching JWT
already exist.

There is an `ApiKeyService` in code, but there is no admin HTTP endpoint or CLI
wrapper for creating mediation API keys. Manual DB setup is the current shortest
path for a local smoke test.

The database commands below only create/update local test data. They are not
needed in production if the integration key has already been provisioned.

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
{"status":"ok"}
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

Verify Postgres is reachable:

```bash
psql "$DATABASE_URL" -c "select 1;"
```

Copy the `JWKS_URI` and `USER_JWT` exports from Terminal 2 into this terminal.

## Create A Local Mediation API Key Row

Choose a raw key:

```bash
export MEDIATION_API_KEY="jyk_local_manual_test_key_001"
```

Hash it:

```bash
export MEDIATION_API_KEY_HASH="$(
  node -e "console.log(require('crypto').createHash('sha256').update(process.env.MEDIATION_API_KEY).digest('hex'))"
)"
```

Insert or update the test key:

```bash
psql "$DATABASE_URL" -c "
insert into content.api_keys (
  id,
  tenant_id,
  key_hash,
  key_prefix,
  integration_name,
  jwks_uri,
  issuer,
  audience,
  is_active
)
values (
  'manual-api-key-1',
  'tenant-1',
  '$MEDIATION_API_KEY_HASH',
  'jyk_loca',
  'manual-local-test',
  '$JWKS_URI',
  null,
  null,
  true
)
on conflict (id) do update set
  key_hash = excluded.key_hash,
  key_prefix = excluded.key_prefix,
  jwks_uri = excluded.jwks_uri,
  is_active = true;
"
```

The local helper's JWT `sub` claim becomes the mediation user ID.

Check that the API key row exists:

```bash
psql "$DATABASE_URL" -c "
select id, tenant_id, key_prefix, integration_name, jwks_uri, is_active
from content.api_keys
where id = 'manual-api-key-1';
"
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

## Cleaner Future Improvement

Issue #60 tracks adding a local/operator provisioning command that wraps
`ApiKeyService.createKey`. That would remove the need to hand-write SQL for
local manual testing. The `dev:mediation-auth` helper only handles the JWKS/JWT
side of local auth.
