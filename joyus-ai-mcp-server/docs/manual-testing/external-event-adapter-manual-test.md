# External Event Adapter Manual Test

| Field | Value |
| --- | --- |
| Feature area | External event adapter |
| Related PR/issues | Spec/branch 018, `claude/018-external-event-adapter` |
| Environment | Local Docker Compose |
| Required services | PostgreSQL, MCP server, optional Inngest Dev Server |
| Required credentials | MCP bearer token |
| Last verified | Not yet verified |

## Purpose

This validates the `/v1/events/*` external event adapter flow, including event source CRUD, signed webhook ingestion, schedule management, automation callbacks, event log queries, health reporting, Inngest delivery, and the admin UI.

## Prerequisites

- Docker stack running: `docker compose up`
- MCP bearer token — get it from `http://localhost:3000/auth` after signing in with Google. The token is shown once on login; use the **Regenerate** button if you need to retrieve it again. This is the same token used to connect Claude Desktop to the server.
- Set in your shell:
  ```bash
  BASE=http://localhost:3000
  TOKEN=<your MCP bearer token>
  ```
- Get or create a pipeline ID:
  ```bash
  # List existing pipelines
  curl -s -o /tmp/ea.json -w "HTTP %{http_code}\n" $BASE/api/pipelines \
    -H "Authorization: Bearer $TOKEN" && jq '.pipelines[].id' /tmp/ea.json

  # Or create one (triggerType, triggerConfig, and steps are all required)
  curl -s -o /tmp/ea.json -w "HTTP %{http_code}\n" -X POST $BASE/api/pipelines \
    -H "Authorization: Bearer $TOKEN" \
    -H "Content-Type: application/json" \
    -d '{
      "name": "Event Adapter Test Pipeline",
      "triggerType": "manual_request",
      "triggerConfig": { "type": "manual_request" },
      "steps": [
        { "stepType": "notification", "name": "Placeholder Step", "config": { "type": "notification", "channel": "webhook", "message": "test" } }
      ]
    }' && jq '.pipeline | {id, name}' /tmp/ea.json

  PIPELINE_ID=<paste id here>
  ```

> **Note on curl pattern:** `-o /tmp/ea.json` writes the response body to a file and `-w "HTTP %{http_code}\n"` prints the status code to your terminal. `jq` then reads from the file. This avoids `jq` parse errors on the status code line.

---

## 1. Event Sources CRUD

**Create a generic webhook source**
```bash
curl -s -o /tmp/ea.json -w "HTTP %{http_code}\n" -X POST $BASE/v1/events/sources \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d "{
    \"name\": \"Test Webhook\",
    \"sourceType\": \"generic_webhook\",
    \"authMethod\": \"hmac_sha256\",
    \"authSecret\": \"supersecret123\",
    \"targetPipelineId\": \"$PIPELINE_ID\"
  }" && jq . /tmp/ea.json
```
- [ ] `HTTP 201` with `id`, `endpointSlug`, `hasSecret: true`
- [ ] `authSecret` is NOT in the response

```bash
SOURCE_SLUG=<paste endpointSlug here>
SOURCE_ID=<paste id here>
```

**Missing authSecret → 400**
```bash
curl -s -o /tmp/ea.json -w "HTTP %{http_code}\n" -X POST $BASE/v1/events/sources \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d "{
    \"name\": \"No Secret Source\",
    \"sourceType\": \"generic_webhook\",
    \"authMethod\": \"hmac_sha256\",
    \"targetPipelineId\": \"$PIPELINE_ID\"
  }" && jq . /tmp/ea.json
```
- [ ] `HTTP 400` with `authSecret` validation error

**Invalid pipeline ID → 422**
```bash
curl -s -o /tmp/ea.json -w "HTTP %{http_code}\n" -X POST $BASE/v1/events/sources \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "Bad Source",
    "sourceType": "generic_webhook",
    "authMethod": "hmac_sha256",
    "authSecret": "some-secret",
    "targetPipelineId": "nonexistent-pipeline-id"
  }' && jq . /tmp/ea.json
```
- [ ] `HTTP 422` with `error: "invalid_pipeline"`

**Create a GitHub source with corpus mapping**
```bash
curl -s -o /tmp/ea.json -w "HTTP %{http_code}\n" -X POST $BASE/v1/events/sources \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d "{
    \"name\": \"GitHub Push\",
    \"sourceType\": \"github\",
    \"authMethod\": \"hmac_sha256\",
    \"authSecret\": \"gh-webhook-secret\",
    \"corpusId\": \"corpus-abc-123\",
    \"targetPipelineId\": \"$PIPELINE_ID\"
  }" && jq . /tmp/ea.json
```
- [ ] `HTTP 201` with `corpusId: "corpus-abc-123"` in response

**List sources**
```bash
curl -s -o /tmp/ea.json -w "HTTP %{http_code}\n" $BASE/v1/events/sources \
  -H "Authorization: Bearer $TOKEN" && jq . /tmp/ea.json
```
- [ ] `HTTP 200` with both sources in `data` array

**Update a source (patch lifecycle state)**
```bash
curl -s -o /tmp/ea.json -w "HTTP %{http_code}\n" -X PATCH $BASE/v1/events/sources/$SOURCE_ID \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"lifecycleState": "paused"}' && jq '.lifecycleState' /tmp/ea.json
```
- [ ] `HTTP 200`, value is `"paused"`

**Restore it before continuing**
```bash
curl -s -o /tmp/ea.json -w "HTTP %{http_code}\n" -X PATCH $BASE/v1/events/sources/$SOURCE_ID \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"lifecycleState": "active"}' && jq '.lifecycleState' /tmp/ea.json
```
- [ ] `HTTP 200`, value is `"active"`

---

## 2. Webhook Ingestion (no bearer token required)

**Send a valid signed webhook**
```bash
BODY='{"event":"test","data":"hello"}'
SIG=$(echo -n "$BODY" | openssl dgst -sha256 -hmac 'supersecret123' | awk '{print "sha256="$2}')

curl -s -o /tmp/ea.json -w "HTTP %{http_code}\n" -X POST $BASE/v1/events/webhook/$SOURCE_SLUG \
  -H "Content-Type: application/json" \
  -H "X-Hub-Signature-256: $SIG" \
  -d "$BODY" && jq . /tmp/ea.json
```
- [ ] `HTTP 202` with `event_id`

**Bad HMAC → 401**
```bash
curl -s -o /tmp/ea.json -w "HTTP %{http_code}\n" -X POST $BASE/v1/events/webhook/$SOURCE_SLUG \
  -H "Content-Type: application/json" \
  -H "X-Hub-Signature-256: sha256=badhash" \
  -d '{"event":"test"}' && jq . /tmp/ea.json
```
- [ ] `HTTP 401`

**Unknown slug → 404**
```bash
curl -s -o /tmp/ea.json -w "HTTP %{http_code}\n" -X POST $BASE/v1/events/webhook/no-such-slug \
  -H "Content-Type: application/json" \
  -d '{"event":"test"}' && jq . /tmp/ea.json
```
- [ ] `HTTP 404`

---

## 3. Schedules CRUD

**Create a schedule**
```bash
curl -s -o /tmp/ea.json -w "HTTP %{http_code}\n" -X POST $BASE/v1/events/schedules \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d "{
    \"name\": \"Daily at 9am\",
    \"cronExpression\": \"0 9 * * 1-5\",
    \"timezone\": \"America/New_York\",
    \"targetPipelineId\": \"$PIPELINE_ID\",
    \"triggerType\": \"manual-request\"
  }" && jq . /tmp/ea.json
```
- [ ] `HTTP 201` with `nextFireAt` populated and in the future

**Invalid cron → 422**
```bash
curl -s -o /tmp/ea.json -w "HTTP %{http_code}\n" -X POST $BASE/v1/events/schedules \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d "{\"name\":\"Bad\",\"cronExpression\":\"not a cron\",\"timezone\":\"UTC\",\"targetPipelineId\":\"$PIPELINE_ID\"}" \
  && jq . /tmp/ea.json
```
- [ ] `HTTP 422` with validation error

---

## 4. Automation Destination + Trigger Callback

**Register an automation destination**
```bash
curl -s -o /tmp/ea.json -w "HTTP %{http_code}\n" -X PUT $BASE/v1/events/automation \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "url": "https://example.com/webhook",
    "authSecret": "shared-secret-token"
  }' && jq . /tmp/ea.json
```
- [ ] `HTTP 200` with `hasAuth: true`; secret NOT in response

**Trigger callback (simulating automation tool calling back)**
```bash
curl -s -o /tmp/ea.json -w "HTTP %{http_code}\n" -X POST $BASE/v1/events/trigger \
  -H "Authorization: Bearer shared-secret-token" \
  -H "Content-Type: application/json" \
  -d "{
    \"triggerType\": \"manual-request\",
    \"pipelineId\": \"$PIPELINE_ID\",
    \"metadata\": {\"source\": \"n8n\"}
  }" && jq . /tmp/ea.json
```
- [ ] `HTTP 202` with `event_id`

**Wrong bearer token → 401**
```bash
curl -s -o /tmp/ea.json -w "HTTP %{http_code}\n" -X POST $BASE/v1/events/trigger \
  -H "Authorization: Bearer wrong-token" \
  -H "Content-Type: application/json" \
  -d "{\"triggerType\":\"manual-request\",\"pipelineId\":\"$PIPELINE_ID\",\"metadata\":{}}" \
  && jq . /tmp/ea.json
```
- [ ] `HTTP 401`

---

## 5. Event Log

**Query events**
```bash
curl -s -o /tmp/ea.json -w "HTTP %{http_code}\n" "$BASE/v1/events/events?limit=10" \
  -H "Authorization: Bearer $TOKEN" && jq . /tmp/ea.json
```
- [ ] `HTTP 200` with paginated list of events from tests above

**Filter by status**
```bash
curl -s -o /tmp/ea.json -w "HTTP %{http_code}\n" "$BASE/v1/events/events?status=pending" \
  -H "Authorization: Bearer $TOKEN" && jq . /tmp/ea.json
```
- [ ] `HTTP 200` — only pending events (or empty array)

---

## 6. Health Endpoint

```bash
curl -s -o /tmp/ea.json -w "HTTP %{http_code}\n" $BASE/v1/events/health \
  -H "Authorization: Bearer $TOKEN" && jq . /tmp/ea.json
```
- [ ] `HTTP 200` with `status` field (`healthy`, `degraded`, or `unhealthy`)
- [ ] `events`, `delivery`, `queue`, `schedules`, `latency`, `scheduler` sections all present
- [ ] `scheduler.healthy: true`

---

## 7. Inngest Delivery (buffer drain)

After sending a webhook event, wait ~5 seconds for the buffer drain to process it, then:
```bash
curl -s -o /tmp/ea.json -w "HTTP %{http_code}\n" "$BASE/v1/events/events?status=delivered&limit=5" \
  -H "Authorization: Bearer $TOKEN" && jq '.data[].status' /tmp/ea.json
```
- [ ] `HTTP 200` — events show `"delivered"` status
- [ ] Check Inngest dev server (if running locally) for `pipeline/manual.triggered` events

For a GitHub push event with `corpusId` set on the source:
- [ ] Inngest should receive `pipeline/corpus.changed` with `corpusId` in `data`

---

## 8. Admin UI (platform-level)

Open in browser (append your MCP token as a query param since browsers can't send auth headers):
```
http://localhost:3000/event-adapter/admin?token=<your MCP bearer token>
```
- [ ] Source table shows both sources including `corpus_id` column
- [ ] Corpus ID field visible in the create/edit form
