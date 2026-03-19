# Inngest Self-Hosted Setup — Feature 010 Spike Notes

## Overview

This document captures the setup steps and observations from WP01 of the Inngest evaluation spike.
The goal is to run a self-hosted Inngest server alongside the existing `joyus-ai-mcp-server` and
verify that the Express serve() adapter works.

## Prerequisites

- Docker Compose (existing `deploy/docker-compose.yml` running)
- `joyus-ai-mcp-server` running on port 3000
- PostgreSQL and Redis accessible on the `jawn-net` Docker network

## Step 1 — Install the Inngest SDK

```bash
cd joyus-ai-mcp-server
npm install inngest
```

Version installed: `inngest` latest (check `package.json` for pinned version).

## Step 2 — Start the Inngest Server

```bash
# From the repo root
docker-compose -f deploy/docker-compose.yml -f deploy/docker-compose.inngest.yml up inngest-server redis
```

The Inngest dev UI will be available at: http://localhost:8288

## Step 3 — Environment Variables

Add to `.env` (or `docker-compose.override.yml`):

```dotenv
INNGEST_BASE_URL=http://localhost:8288
INNGEST_EVENT_KEY=local-dev-key
INNGEST_SIGNING_KEY=local-signing-key
```

These match the values set in `docker-compose.inngest.yml`.

## Step 4 — Register the App with Inngest

The `serve()` adapter is mounted at `/api/inngest` in the Express server. After starting both
services, register the app in the Inngest dev UI:

1. Open http://localhost:8288
2. Click **Add App**
3. Enter the app URL: `http://host.docker.internal:3000/api/inngest`
   - Use `host.docker.internal` when the Express server runs on the host (not in Docker)
   - Use the container name/service name when both run inside Docker

Inngest will call GET `/api/inngest` to discover registered functions.

## Step 5 — Verify the Stub Function

After registration, the Inngest dev UI should show:

- App: `joyus-ai`
- Functions: `Pipeline Stub (Feature 010 spike verification)`

To trigger it manually:

```bash
curl -X POST http://localhost:8288/e/local-dev-key \
  -H "Content-Type: application/json" \
  -d '{"name":"pipeline/corpus.changed","data":{"tenantId":"tenant-1","corpusId":"corpus-abc","changeType":"created"}}'
```

The function run should appear in the Inngest dev UI with status `Completed`.

## Architecture Notes

### Client (`src/inngest/client.ts`)

- Single `Inngest` instance typed with `PipelineEvents` — all event types defined here
- Configured via env vars: `INNGEST_BASE_URL`, `INNGEST_EVENT_KEY`
- Three event types pre-defined: `pipeline/corpus.changed`, `pipeline/review.decided`, `pipeline/schedule.tick`

### Serve Adapter (`src/index.ts`)

- Mounted at `app.use('/api/inngest', serve({ client: inngest, functions: allFunctions }))`
- No bearer-token auth — Inngest server authenticates via `INNGEST_SIGNING_KEY` (HMAC request signing)
- `allFunctions` array is the registration list; add new functions here as WP02-WP04 implement them

### Docker Overlay (`deploy/docker-compose.inngest.yml`)

- Uses `inngest/inngest:latest` image
- Shares the existing `postgres` service for state storage
- Adds `redis:7-alpine` for queue/concurrency
- Both services join `jawn-net` (external network declared in base compose)

## Observations

- Inngest self-hosted requires Redis (queue backend) + Postgres (state storage)
- The `serve()` adapter handles both GET (function discovery) and POST (function execution)
- No auth middleware needed on the Inngest route — Inngest signs requests with the signing key
- Top-level `await` in barrel exports is not needed; static imports work fine

## Next Steps (WP02)

- Port the `CorpusChangedHandler` pipeline step to an Inngest function
- Replace `EventBus.emit('corpus.changed', ...)` with `inngest.send('pipeline/corpus.changed', ...)`
- Compare execution model vs. the custom engine (retries, durability, observability)
