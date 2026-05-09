# Manual Testing: External Event Adapter (Branch `claude/018-external-event-adapter`)

**Prerequisites**

- Docker stack running: `docker compose up`
- Bearer token from `/auth/login` (or existing session token)
- `BASE=http://localhost:3000` and `TOKEN=<your bearer token>` set in shell

---

## 1. Event Sources CRUD

**Create a generic webhook source**
```bash
curl -s -X POST $BASE/v1/events/sources \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "Test Webhook",
    "sourceType": "generic_webhook",
    "authMethod": "hmac_sha256",
    "authSecret": "supersecret123",
    "targetPipelineId": "<any pipeline id>"
  }' | jq .
```
- [ ] Returns 201 with `id`, `slug`, `hasSecret: true`
- [ ] `authSecret` is NOT in the response

**Create a GitHub source with corpus mapping**
```bash
curl -s -X POST $BASE/v1/events/sources \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "GitHub Push",
    "sourceType": "github",
    "authMethod": "hmac_sha256",
    "authSecret": "gh-webhook-secret",
    "corpusId": "corpus-abc-123",
    "targetPipelineId": "<any pipeline id>"
  }' | jq .
```
- [ ] Returns 201 with `corpusId: "corpus-abc-123"` in response

**List sources**
```bash
curl -s $BASE/v1/events/sources -H "Authorization: Bearer $TOKEN" | jq .
```
- [ ] Returns array with both sources created above

**Update a source (patch lifecycle state)**
```bash
curl -s -X PATCH $BASE/v1/events/sources/<source-id> \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"lifecycleState": "paused"}' | jq .
```
- [ ] Returns updated record with `lifecycleState: "paused"`

---

## 2. Webhook Ingestion (no auth required on this endpoint)

**Send a generic webhook**
```bash
SLUG=<slug from source created above>
curl -s -X POST $BASE/v1/events/webhook/$SLUG \
  -H "Content-Type: application/json" \
  -H "X-Hub-Signature-256: $(echo -n '{"event":"test","data":"hello"}' | openssl dgst -sha256 -hmac 'supersecret123' -hex | sed 's/SHA2-256(stdin)= /sha256=/')" \
  -d '{"event":"test","data":"hello"}' | jq .
```
- [ ] Returns `202` with `event_id`
- [ ] Check event was buffered: `curl -s $BASE/v1/events/events -H "Authorization: Bearer $TOKEN" | jq .`

**Bad HMAC → 401**
```bash
curl -s -X POST $BASE/v1/events/webhook/$SLUG \
  -H "Content-Type: application/json" \
  -H "X-Hub-Signature-256: sha256=badhash" \
  -d '{"event":"test"}' | jq .
```
- [ ] Returns `401`

**Unknown slug → 404**
```bash
curl -s -X POST $BASE/v1/events/webhook/no-such-slug \
  -H "Content-Type: application/json" \
  -d '{"event":"test"}' | jq .
```
- [ ] Returns `404`

---

## 3. Schedules CRUD

**Create a schedule**
```bash
curl -s -X POST $BASE/v1/events/schedules \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "Daily at 9am",
    "cronExpression": "0 9 * * 1-5",
    "timezone": "America/New_York",
    "targetPipelineId": "<any pipeline id>",
    "triggerType": "manual-request"
  }' | jq .
```
- [ ] Returns 201 with `nextFireAt` populated
- [ ] `nextFireAt` should be in the future

**Invalid cron → 422**
```bash
curl -s -X POST $BASE/v1/events/schedules \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"name":"Bad","cronExpression":"not a cron","timezone":"UTC","targetPipelineId":"x"}' | jq .
```
- [ ] Returns `422` with validation error

---

## 4. Automation Destination + Trigger Callback

**Register an automation destination**
```bash
curl -s -X PUT $BASE/v1/events/automation \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "url": "https://example.com/webhook",
    "authSecret": "shared-secret-token"
  }' | jq .
```
- [ ] Returns destination with `hasAuth: true`; secret NOT in response

**Trigger callback (simulating automation tool calling back)**
```bash
curl -s -X POST $BASE/v1/events/trigger \
  -H "Authorization: Bearer shared-secret-token" \
  -H "Content-Type: application/json" \
  -d '{
    "triggerType": "manual-request",
    "pipelineId": "<valid pipeline id for this tenant>",
    "metadata": {"source": "n8n"}
  }' | jq .
```
- [ ] Returns `202` with `event_id`

**Wrong bearer token → 401**
```bash
curl -s -X POST $BASE/v1/events/trigger \
  -H "Authorization: Bearer wrong-token" \
  -H "Content-Type: application/json" \
  -d '{"triggerType":"manual-request","pipelineId":"x","metadata":{}}' | jq .
```
- [ ] Returns `401`

---

## 5. Event Log

**Query events**
```bash
curl -s "$BASE/v1/events/events?limit=10" -H "Authorization: Bearer $TOKEN" | jq .
```
- [ ] Returns paginated list of events from tests above

**Filter by status**
```bash
curl -s "$BASE/v1/events/events?status=pending" -H "Authorization: Bearer $TOKEN" | jq .
```
- [ ] Returns only pending events (or empty array)

---

## 6. Health Endpoint

```bash
curl -s $BASE/v1/events/health -H "Authorization: Bearer $TOKEN" | jq .
```
- [ ] Returns `200` with `status` field (`healthy`, `degraded`, or `unhealthy`)
- [ ] `events`, `delivery`, `queue`, `schedules`, `latency`, `scheduler` sections all present
- [ ] `scheduler.healthy: true` (scheduler running)

---

## 7. Inngest Delivery (buffer drain)

After sending a webhook event, wait ~5 seconds for the buffer drain to process it, then:
```bash
curl -s "$BASE/v1/events/events?status=delivered&limit=5" -H "Authorization: Bearer $TOKEN" | jq '.[].status'
```
- [ ] Events move from `pending` → `delivered`
- [ ] Check Inngest dev server (if running locally) for `pipeline/manual.triggered` events

For a GitHub push event with `corpusId` set on the source:
- [ ] Inngest should receive `pipeline/corpus.changed` with `corpusId` in `data`

---

## 8. Admin UI (platform-level)

Open in browser:
```
http://localhost:3000/event-adapter/admin
```
- [ ] Source table shows both sources including `corpus_id` column
- [ ] Corpus ID field visible in the create/edit form
