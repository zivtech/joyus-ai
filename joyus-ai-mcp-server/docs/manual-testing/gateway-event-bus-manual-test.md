# Gateway Event Bus Manual Test

This guide uses generic fixtures and does not require Slack, email, or channel configuration.

## Setup

Run the server with a migrated database and an MCP bearer token:

```bash
cd joyus-ai-mcp-server
npm run db:migrate
npm run dev
```

Set local shell helpers:

```bash
export BASE_URL=http://localhost:3000
export TOKEN='<mcp bearer token>'
export TENANT_ID='<authenticated user id>'
```

## Dashboard Baseline

Create a dashboard endpoint:

```bash
curl -sS -X POST "$BASE_URL/gateway/endpoints" \
  -H "authorization: Bearer $TOKEN" \
  -H "content-type: application/json" \
  -d "{
    \"tenantId\": \"$TENANT_ID\",
    \"type\": \"dashboard\",
    \"name\": \"Operations Dashboard\",
    \"isActive\": true
  }"
```

Create a subscription using the returned endpoint id:

```bash
export DASHBOARD_ENDPOINT_ID='<endpoint id>'

curl -sS -X POST "$BASE_URL/gateway/subscriptions" \
  -H "authorization: Bearer $TOKEN" \
  -H "content-type: application/json" \
  -d "{
    \"tenantId\": \"$TENANT_ID\",
    \"eventType\": \"review.pending\",
    \"minimumSeverity\": \"warning\",
    \"endpointId\": \"$DASHBOARD_ENDPOINT_ID\",
    \"isEnabled\": true
  }"
```

Emit a review event:

```bash
curl -sS -X POST "$BASE_URL/gateway/events" \
  -H "authorization: Bearer $TOKEN" \
  -H "content-type: application/json" \
  -d "{
    \"tenantId\": \"$TENANT_ID\",
    \"type\": \"review.pending\",
    \"severity\": \"warning\",
    \"sourceSpec\": \"gateway-event-bus\",
    \"sourceComponent\": \"manual-test\",
    \"subjectType\": \"review_decision\",
    \"subjectId\": \"review_decision_manual_1\",
    \"correlationId\": \"manual_run_1\",
    \"idempotencyKey\": \"manual:review_decision_manual_1:pending\",
    \"payloadSchemaVersion\": \"review.pending.v1\",
    \"requiresDecision\": true,
    \"handlerKey\": \"pipeline-review\",
    \"payload\": {
      \"title\": \"Review required\",
      \"summary\": \"Generated output is ready for operator review.\"
    }
  }"
```

Expected: `202 Accepted` with an event id and at least one delivery attempt. Reposting the same event returns duplicate behavior.

## Decision Route Smoke Test

For a route that does not require existing pipeline review rows, emit a monitoring alert with `handlerKey=monitoring-alert`, then acknowledge it:

```bash
curl -sS -X POST "$BASE_URL/gateway/events" \
  -H "authorization: Bearer $TOKEN" \
  -H "content-type: application/json" \
  -d "{
    \"tenantId\": \"$TENANT_ID\",
    \"type\": \"monitoring.alert\",
    \"severity\": \"warning\",
    \"sourceSpec\": \"gateway-event-bus\",
    \"sourceComponent\": \"manual-test\",
    \"subjectType\": \"monitoring_alert\",
    \"subjectId\": \"alert_manual_1\",
    \"correlationId\": \"manual_run_1\",
    \"idempotencyKey\": \"manual:alert_manual_1\",
    \"payloadSchemaVersion\": \"monitoring.alert.v1\",
    \"requiresDecision\": true,
    \"handlerKey\": \"monitoring-alert\",
    \"payload\": {
      \"summary\": \"Example alert for manual validation.\"
    }
  }"
```

```bash
export GATEWAY_EVENT_ID='<event id>'

curl -sS -X POST "$BASE_URL/gateway/decisions" \
  -H "authorization: Bearer $TOKEN" \
  -H "content-type: application/json" \
  -d "{
    \"tenantId\": \"$TENANT_ID\",
    \"eventId\": \"$GATEWAY_EVENT_ID\",
    \"decision\": \"acknowledged\",
    \"decisionBy\": \"operator_manual\",
    \"sourceBackend\": \"dashboard\",
    \"idempotencyKey\": \"manual:alert_manual_1:acknowledged\",
    \"metadata\": {
      \"comment\": \"Acknowledged during manual test.\"
    }
  }"
```

Expected: `202 Accepted` with `routeStatus=routed`. Reposting the same decision returns duplicate behavior and does not invoke the handler again.

## Optional Channel Check

Create a `channel` endpoint and subscription for `monitoring.alert`, then emit a matching alert without any active channel connection.

Expected: the channel attempt records `skipped_no_channel`. Dashboard or webhook attempts for the same event continue independently.

## Validation Commands

```bash
cd joyus-ai-mcp-server
npm run typecheck
npm test -- gateway-events
```

```bash
ruby -e "require 'yaml'; YAML.load_file('kitty-specs/gateway-event-bus-multichannel-01KSGP2X/contracts/gateway-event-bus.openapi.yaml')"
git diff --check
```
