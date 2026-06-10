# Data Model: Gateway Event Bus and Multi-Channel Delivery

## Overview

The Gateway Event Bus data model separates event emission, subscription configuration, delivery attempts, and decision ingestion. It is intentionally different from Inngest's durable execution events: this model is for tenant-scoped admin notification and human decision routing.

## Entities

### PlatformEvent

Represents a tenant-scoped outbound platform event emitted by pipelines, monitoring, orchestrator, profile, or integration components.

| Field | Type | Notes |
|-------|------|-------|
| `id` | UUID | Primary event identifier. |
| `tenantId` | string/UUID | Required tenant scope. |
| `type` | enum/string | Canonical event type such as `review.pending`, `monitoring.alert`, or `fidelity.threshold_breached`. |
| `severity` | enum | `info`, `warning`, or `critical`. |
| `sourceSpec` | string | Planning/spec source, for example `011`, `012`, `015`, or `018`. |
| `sourceComponent` | string | Emitting component, for example `pipeline-review`, `monitoring-alerts`, or `platform-orchestrator`. |
| `subjectType` | string | Optional domain target, for example `pipeline_execution`, `review_decision`, or `monitoring_alert`. |
| `subjectId` | string | Optional target identifier used by decision handlers. |
| `correlationId` | string | Links event to upstream request, execution, or alert. |
| `idempotencyKey` | string | Unique per tenant and source event to dedupe delivery. |
| `payload` | JSON | Sanitized event body for delivery rendering and handler context. |
| `payloadSchemaVersion` | string | Version for payload validation and renderer compatibility. |
| `requiresDecision` | boolean | True when a human decision can be returned through the gateway. |
| `handlerKey` | string/null | Domain handler hint for decision routing; required when `requiresDecision=true`. |
| `occurredAt` | timestamp | Source event time. |
| `emittedAt` | timestamp | Gateway receive time. |

#### Event Type Policy

Canonical event types should be short, dotted names with a stable domain prefix. Phase 1 should treat the following as canonical seeds:

- `review.pending`
- `review.decided`
- `review.escalated`
- `monitoring.alert`
- `monitoring.alert.acknowledged`
- `pipeline.completed`
- `pipeline.failed`
- `dead_letter.accumulated`
- `rate_limit.exceeded`
- `circuit_breaker.opened`

Future event types can be added without a migration when they follow the same naming policy and have a registered payload schema. Wildcard subscription groups are allowed only for approved namespace prefixes such as `review.*` or `monitoring.*`; arbitrary globbing is out of scope for Phase 1.

Emission is asynchronous from the caller's perspective. Source components write or enqueue a `PlatformEvent` and continue; delivery backends must not sit on the source component's critical path.

### DeliveryEndpoint

Represents a tenant-owned destination that can receive matching events.

| Field | Type | Notes |
|-------|------|-------|
| `id` | UUID | Primary key. |
| `tenantId` | string/UUID | Required tenant scope. |
| `type` | enum | `slack`, `email`, `webhook`, `dashboard`, or `channel`. |
| `name` | string | Operator-facing label. |
| `config` | encrypted JSON / secret ref | Backend-specific settings; secrets should be stored by reference where possible. |
| `secretRef` | string/null | Preferred pointer to Slack webhook, webhook HMAC secret, SMTP credential, or channel credential material. |
| `isActive` | boolean | Disabled endpoints do not receive deliveries. |
| `createdBy` | string | Admin/operator id. |
| `createdAt` | timestamp | Creation time. |
| `updatedAt` | timestamp | Last update time. |

### EventSubscription

Connects event filters to delivery endpoints.

| Field | Type | Notes |
|-------|------|-------|
| `id` | UUID | Primary key. |
| `tenantId` | string/UUID | Required tenant scope. |
| `eventType` | enum/string | Exact event type or approved wildcard group. |
| `minimumSeverity` | enum/null | Optional severity floor. |
| `endpointId` | UUID | References `DeliveryEndpoint`. |
| `filter` | JSON/null | Optional structured filter for subject type, source component, or payload attributes approved by implementation. |
| `isEnabled` | boolean | Subscription toggle. |
| `createdAt` | timestamp | Creation time. |

Subscription rows link one event filter to one endpoint. Sending one event to Slack and email requires two subscriptions. This keeps retry, audit, and disable behavior deterministic per backend. Grouped filters belong in `eventType` or `filter`; grouped endpoints are not modeled in Phase 1.

Validation rules:

- A disabled endpoint never receives new `EventDeliveryAttempt` rows.
- A disabled subscription never receives new `EventDeliveryAttempt` rows even if its endpoint is active.
- `EventSubscription.tenantId` must match `DeliveryEndpoint.tenantId`.
- Slack URLs, webhook HMAC secrets, SMTP credentials, and channel credentials must be referenced or encrypted. They must not appear in `EventDeliveryAttempt.lastError`, `responseSummary`, or exported audit views.

### EventDeliveryAttempt

Audit and retry record for each routed event/backend attempt.

| Field | Type | Notes |
|-------|------|-------|
| `id` | UUID | Primary key. |
| `tenantId` | string/UUID | Duplicated for scoped queries and isolation checks. |
| `eventId` | UUID | References `PlatformEvent`. |
| `subscriptionId` | UUID | References `EventSubscription`. |
| `endpointId` | UUID | References `DeliveryEndpoint`. |
| `status` | enum | `pending`, `sent`, `failed`, `retry_scheduled`, `dead_letter`, or `skipped_no_channel`. |
| `attemptNumber` | integer | Starts at 1. |
| `maxAttempts` | integer | Defaults to 3 unless the implementation owner changes the threshold. |
| `nextRetryAt` | timestamp/null | Set when retry is scheduled. |
| `deliveredAt` | timestamp/null | Set on success. |
| `lastError` | string/null | Sanitized backend error. |
| `responseSummary` | JSON/null | Sanitized response metadata. |

#### Delivery Attempt State Transitions

| From | To | Allowed when |
|------|----|--------------|
| `pending` | `sent` | Backend accepted delivery. |
| `pending` | `failed` | Backend returned a retryable or terminal error. |
| `pending` | `skipped_no_channel` | Endpoint type is `channel` and no active `ChannelConnection` exists. |
| `failed` | `retry_scheduled` | `attemptNumber < maxAttempts` and backend error is retryable. |
| `retry_scheduled` | `pending` | Retry worker reaches `nextRetryAt`. |
| `failed` | `dead_letter` | `attemptNumber >= maxAttempts` or error is terminal. |

`sent`, `dead_letter`, and `skipped_no_channel` are terminal states. `skipped_no_channel` is not a failure and must not increment dead-letter metrics. Dashboard queries need to filter by `tenantId`, `eventId`, `endpointId`, `status`, `attemptNumber`, and `nextRetryAt` so operators can inspect pending retries and dead letters.

### GatewayDecision

Represents a decision received from any delivery surface and routed to a registered domain handler.

| Field | Type | Notes |
|-------|------|-------|
| `id` | UUID | Primary key. |
| `tenantId` | string/UUID | Required tenant scope. |
| `eventId` | UUID | References the event that requested action. |
| `decision` | enum | `approved`, `rejected`, `request_changes`, `acknowledged`, or `dismissed`. |
| `decisionBy` | string | Admin/operator id or service actor. |
| `sourceBackend` | enum | `slack`, `email`, `webhook`, `dashboard`, or `channel`. |
| `idempotencyKey` | string | Unique per tenant/event/actor decision attempt. |
| `metadata` | JSON | Backend-specific context and handler payload. |
| `receivedAt` | timestamp | Gateway receive time. |
| `handlerKey` | string | Domain handler selected from event metadata. |
| `routeStatus` | enum | `pending`, `routed`, `failed`, or `rejected`. |
| `routeError` | string/null | Sanitized handler error. |

Decision records require a matching tenant-scoped `PlatformEvent`. The gateway dedupes by `tenantId + eventId + idempotencyKey` before invoking a handler. If the event is not decision-capable, or if the handler rejects the payload for domain reasons, the gateway records `routeStatus=rejected` while leaving domain state unchanged.

### ChannelConnection

Tracks optional `joyus-desktop` Channel Server connections so channel delivery can no-op cleanly when none exist.

| Field | Type | Notes |
|-------|------|-------|
| `id` | UUID | Primary key. |
| `tenantId` | string/UUID | Required tenant scope. |
| `adminId` | string/null | Connected admin where known. |
| `connectionId` | string | Runtime connection/session id. |
| `status` | enum | `connected`, `stale`, or `disconnected`. |
| `capabilities` | JSON | Channel protocol/capability declaration. |
| `connectedAt` | timestamp | Connection start. |
| `lastSeenAt` | timestamp | Heartbeat/update time. |
| `expiresAt` | timestamp/null | Optional lease expiration. |

## Relationships

- `PlatformEvent` has many `EventDeliveryAttempt` rows.
- `DeliveryEndpoint` has many `EventSubscription` rows.
- `EventSubscription` has many `EventDeliveryAttempt` rows.
- `PlatformEvent` has zero or more `GatewayDecision` rows, depending on whether action is requested.
- `ChannelConnection` is consulted by `DeliveryEndpoint(type='channel')`; absence of an active connection produces `skipped_no_channel`, not a dead letter.

## Tenant Isolation Rules

- Every persisted row includes `tenantId`.
- All joins must verify matching `tenantId`; cross-tenant event/endpoint/decision combinations are invalid.
- Webhook HMAC secrets, Slack URLs, and email credentials should be encrypted or stored as secret references, not plaintext in audit logs.
- Payloads must be sanitized before logging or external delivery.

## Validation and Audit Notes

These checks are required for NFR-003 and NFR-004:

- Reject event emission when `tenantId`, `type`, `sourceComponent`, `idempotencyKey`, or `payloadSchemaVersion` is missing.
- Reject subscription creation when `EventSubscription.tenantId` differs from `DeliveryEndpoint.tenantId`.
- Reject delivery attempt creation when event, subscription, and endpoint tenant ids do not all match.
- Reject decision ingestion when `GatewayDecision.tenantId` differs from the referenced event tenant.
- Deduplicate events by `tenantId + sourceComponent + idempotencyKey`.
- Deduplicate decisions by `tenantId + eventId + idempotencyKey`.
- Audit event id, tenant id, source component, endpoint id, subscription id, delivery backend, decision source, idempotency key, route status, and sanitized error/response summaries.
- Audit records may include payload summaries, but must not include plaintext Slack URLs, webhook HMAC secrets, SMTP credentials, channel credentials, or raw sensitive payload data.

## Handler Boundary

The gateway routes decisions to domain handlers by `handlerKey` and event metadata. The handler owns domain state:

- Pipeline review handler validates and records review decisions, then resumes via Inngest where appropriate.
- Monitoring handler records alert acknowledgment/dismissal.
- Workflow approval handler, if used, owns approval lifecycle and expiration state.

Gateway persistence proves receipt, idempotency, route attempt, and audit trail; it does not become the canonical approval database for every domain.
