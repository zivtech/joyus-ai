# Gateway Event Bus and Multi-Channel Delivery

**Status:** Fresh public-safe implementation mission promoted from an accepted planning packet
**Mission type:** software-dev
**Target repo:** `joyus-ai`
**Target branch:** `codex/gateway-event-bus-promotion-20260525`

## Goal

Build the Gateway Event Bus as the tenant-scoped platform layer for outbound event fanout, multi-channel delivery, bounded retry/dead-letter handling, and human decision ingestion.

The gateway provides a shared path for review notifications, monitoring alerts, workflow acknowledgments, and operator-facing delivery surfaces. Source domains emit events and register decision handlers; the gateway records receipt, routes deliveries, audits outcomes, and returns decisions to the owning domain without becoming the canonical lifecycle store for every domain.

## Placement Decision

This mission intentionally uses a fresh current slug: `gateway-event-bus-multichannel-01KSGP2X`.

Older gateway drafts covered a broader MCP gateway surface, including auth, routing, and rate-limit concerns. This mission narrows Phase 1 to the event bus, delivery, retry/dead-letter, decision-ingestion, and audit surface. Broader gateway concerns remain future roadmap input.

Phase 1 implementation should be in-process inside `joyus-ai-mcp-server`. A separate service boundary can be introduced later if delivery volume, operational ownership, or deployment constraints justify it.

## Problem

Platform workflows need a common delivery and decision path. Without one, each feature is likely to implement separate Slack, email, webhook, dashboard, retry, audit, and approval-return logic. That creates inconsistent tenant isolation, duplicated delivery failure handling, and unclear ownership of human decision flows.

## Scope

### In Scope

- Tenant-scoped `PlatformEvent` envelope and event taxonomy.
- Delivery endpoints for dashboard, webhook, Slack, email, and optional channel delivery.
- Event subscriptions with tenant and event-type filters.
- Delivery attempt records, bounded retry, and dead-letter status.
- Decision ingestion for approvals, rejections, request-changes decisions, acknowledgments, and dismissals.
- Handler registry for routing accepted decisions to domain-owned handlers.
- Audit records for event receipt, delivery attempts, decisions, handler routing, and sanitized backend errors.
- Integration points for pipeline review events, monitoring alerts, orchestrator events, and future workflow approval events.

### Out of Scope

- Making channel delivery required.
- Desktop Channel Server implementation.
- Replacing Inngest durable execution.
- Rebuilding monitoring dashboards.
- Owning pipeline review state, monitoring alert state, or durable workflow approval lifecycle.
- Gateway auth, MCP routing, and global rate-limit roadmap work outside this event-bus slice.

## Functional Requirements

- FR-001: The gateway MUST provide an internal event emission interface that accepts typed tenant-scoped platform events.
- FR-002: Operators MUST be able to configure tenant-scoped delivery endpoints.
- FR-003: Operators MUST be able to configure tenant-scoped event subscriptions by event type, severity, endpoint, and approved structured filters.
- FR-004: The gateway MUST route each accepted event to all matching enabled subscriptions and create delivery attempt records.
- FR-005: Delivery failures MUST retry with bounded backoff and move to `dead_letter` after exhaustion or terminal failure.
- FR-006: The dashboard delivery surface MUST remain the baseline complete non-external delivery surface.
- FR-007: Webhook delivery MUST be implemented as the first external backend because it is provider-neutral and testable without vendor-specific configuration.
- FR-008: Slack and email delivery MUST use the same endpoint, subscription, attempt, retry, and audit abstractions as webhook delivery.
- FR-009: Optional channel delivery MUST record `skipped_no_channel` when no channel connection exists and MUST NOT block or fail other backends.
- FR-010: A gateway decision endpoint MUST accept decisions from any authenticated delivery surface.
- FR-011: Decisions MUST be deduplicated by tenant, event, and idempotency key before handler invocation.
- FR-012: The gateway MUST route decisions to registered domain handlers without becoming the canonical lifecycle state store for the domain.
- FR-013: All event, endpoint, subscription, delivery, decision, and audit records MUST be tenant-scoped.

## Non-Functional Requirements

- NFR-001: Event emission MUST NOT wait for external delivery backends. Source components can continue after the gateway persists the event and schedules deliveries.
- NFR-002: Delivery retries MUST default to at most three attempts unless configuration explicitly changes the maximum.
- NFR-003: Cross-tenant event, endpoint, subscription, delivery, or decision combinations MUST be rejected.
- NFR-004: Audit records MUST include event id, tenant id, source component, delivery backend, decision source, idempotency key, route status, and sanitized error/response summaries.
- NFR-005: Secret values, webhook signatures, tokens, SMTP credentials, and raw sensitive payloads MUST NOT appear in delivery logs, audit exports, or error summaries.
- NFR-006: API contracts MUST be represented with Zod schemas and OpenAPI-compatible shapes.
- NFR-007: Tests MUST cover tenant isolation, idempotency, retry/dead-letter transitions, `skipped_no_channel`, and handler boundary semantics.

## Constraints

- C-001: The implementation MUST follow the project client abstraction rule. Fixtures and examples must stay generic and platform-level.
- C-002: Inngest remains the durable pipeline execution system. The gateway is the admin-facing event delivery and decision-routing layer.
- C-003: Dashboard delivery is the baseline. Slack, email, webhook, and channel are independent backends.
- C-004: Channel delivery is optional and cannot be required for admin workflows.
- C-005: Domain services own their lifecycle state after decisions are routed.

## Adoption Plan

Phase 1 lands the in-process gateway module, database schema, API routes, dashboard delivery, webhook delivery, retry/dead-letter behavior, decision ingestion, audit records, and producer integration for review and monitoring events. Operators can validate delivery behavior through manual API workflows before any dedicated admin UI is required.

Phase 2 should add the first configured external notification backend beyond webhook when an operator workflow needs it. Slack and email must reuse the endpoint, subscription, attempt, retry, and audit abstractions rather than adding backend-specific state machines.

Phase 3 should evaluate whether delivery scheduling should move from the in-process retry worker to the platform durable execution layer. A separate service boundary should be introduced only if delivery volume, deployment ownership, or operational isolation makes the in-process module insufficient.

## ROI Metrics

- Delivery consolidation: number of producer surfaces using the gateway instead of custom notification logic.
- Operator response coverage: percentage of review, monitoring, and workflow events with at least one successful dashboard or external delivery.
- Reliability visibility: delivery attempts, retry counts, dead-letter counts, and terminal skip counts available per tenant and event type.
- Decision throughput: accepted decisions deduplicated and routed to registered domain handlers without duplicate state transitions.
- Maintenance reduction: new delivery backends added without schema changes or source-domain delivery rewrites.

## Security + MCP Governance

The gateway must resolve tenant context from authenticated platform middleware and reject cross-tenant combinations across events, endpoints, subscriptions, deliveries, decisions, and audit reads. Request bodies cannot override tenant ownership.

Delivery adapters must store configuration through typed endpoint records and must never write secrets, raw tokens, webhook signatures, SMTP credentials, or sensitive payload fragments into delivery logs, audit records, or error summaries.

MCP-facing tools and routes that expose gateway state must preserve the same tenant boundary as the HTTP routes. Tool responses should return sanitized delivery summaries and stable identifiers, not raw backend credentials or unbounded event payloads.

## Acceptance Criteria

- AC-001: `joyus-ai-mcp-server` contains a gateway event module with typed event, endpoint, subscription, delivery attempt, decision, and handler registry primitives.
- AC-002: Drizzle schema and migration changes persist gateway event bus tables with tenant-scoped indexes and uniqueness constraints.
- AC-003: `POST /gateway/events`, endpoint/subscription management routes, delivery inspection routes, and `POST /gateway/decisions` are implemented and validated.
- AC-004: Dashboard and webhook backends work in Phase 1; Slack/email share the same adapter interface and can be implemented without schema changes.
- AC-005: Failed webhook delivery retries with bounded backoff, records sanitized failure details, and reaches `dead_letter` after exhaustion.
- AC-006: Missing channel connection records `skipped_no_channel` and does not block dashboard, webhook, Slack, or email deliveries.
- AC-007: Decision ingestion dedupes by idempotency key and routes to registered domain handlers.
- AC-008: Pipeline review and monitoring emitters use the gateway without duplicating delivery logic.
- AC-009: Tests cover event validation, subscription matching, delivery routing, retry/dead-letter behavior, decision ingestion, handler routing, tenant mismatch rejection, and optional channel skip behavior.
- AC-010: Documentation includes a non-channel quickstart, channel-optional quickstart, and OpenAPI contract seed.

## Open Questions

- OQ-001: Should Slack or email be implemented in the first code slice, or deferred until the webhook adapter and shared delivery abstractions are merged?
- OQ-002: Should retry scheduling use an in-process worker for Phase 1 or an Inngest scheduled function immediately?
- OQ-003: Which dashboard endpoint should be the final admin UI surface for event queue inspection?
