# Quickstart: Gateway Event Bus

This quickstart describes the expected implementation behavior for local validation after the work packages are complete.

## 1. Create a Dashboard Endpoint

Create a tenant-scoped dashboard endpoint:

```json
{
  "tenantId": "tenant_123",
  "type": "dashboard",
  "name": "Operations Dashboard",
  "isActive": true
}
```

Expected outcome:

1. The endpoint is stored with `tenantId`.
2. No external secret is required.
3. The endpoint can be referenced by subscriptions for the same tenant only.

## 2. Subscribe to Review Events

Create a subscription:

```json
{
  "tenantId": "tenant_123",
  "eventType": "review.pending",
  "minimumSeverity": "warning",
  "endpointId": "endpoint_dashboard_123",
  "isEnabled": true
}
```

Expected outcome:

1. The endpoint tenant must match the subscription tenant.
2. Future matching events produce delivery attempts.
3. Disabled subscriptions produce no new attempts.

## 3. Emit a Review Event

Emit:

```json
{
  "type": "review.pending",
  "tenantId": "tenant_123",
  "severity": "warning",
  "sourceSpec": "gateway-event-bus",
  "sourceComponent": "pipeline-review",
  "subjectType": "pipeline_execution",
  "subjectId": "execution_456",
  "correlationId": "run_789",
  "idempotencyKey": "pipeline-review:execution_456:pending",
  "payloadSchemaVersion": "review.pending.v1",
  "requiresDecision": true,
  "handlerKey": "pipeline-review",
  "payload": {
    "title": "Review required",
    "summary": "Generated output is ready for operator review."
  }
}
```

Expected outcome:

1. The gateway persists the event.
2. Matching subscriptions create delivery attempts.
3. Dashboard delivery reaches `sent`.
4. Event emission does not wait for external backends.
5. Repeating the same idempotency key returns duplicate behavior without creating a second event.

## 4. Add Webhook Delivery

Create a webhook endpoint with a secret reference:

```json
{
  "tenantId": "tenant_123",
  "type": "webhook",
  "name": "Example Webhook",
  "url": "https://example.invalid/hooks/gateway",
  "hmacSecretRef": "secret_ref_webhook_123",
  "isActive": true
}
```

Expected outcome:

1. The endpoint stores the URL and secret reference.
2. Delivery errors redact secrets.
3. Retry attempts update `attemptNumber` and `nextRetryAt`.
4. Exhausted retries reach `dead_letter`.
5. Dashboard delivery remains available when webhook delivery fails.

## 5. Ingest a Decision

Post a dashboard approval:

```json
{
  "tenantId": "tenant_123",
  "eventId": "22222222-2222-4222-8222-222222222222",
  "decision": "approved",
  "decisionBy": "operator_456",
  "sourceBackend": "dashboard",
  "idempotencyKey": "dashboard:event_222:operator_456:approved",
  "metadata": {
    "comment": "Approved after review."
  }
}
```

Expected outcome:

1. The gateway validates tenant scope.
2. The decision is deduplicated by idempotency key.
3. The gateway records receipt and route status.
4. The registered `pipeline-review` handler validates and owns domain state updates.

## 6. Validate Optional Channel Behavior

Create a channel endpoint and subscription without an active channel connection, then emit a matching event.

Expected outcome:

1. The channel attempt records `skipped_no_channel`.
2. The skipped attempt is terminal.
3. It does not increment dead-letter metrics.
4. Dashboard and webhook attempts still run.

## 7. Acceptance Commands

From `joyus-ai-mcp-server/`:

```bash
npm run typecheck
npm test -- gateway-events
```

From the repository root:

```bash
ruby -e "require 'yaml'; YAML.load_file('kitty-specs/gateway-event-bus-multichannel-01KSGP2X/contracts/gateway-event-bus.openapi.yaml')"
git diff --check
```
