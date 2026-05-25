# Implementation Plan: Gateway Event Bus and Multi-Channel Delivery

**Mission:** `gateway-event-bus-multichannel-01KSGP2X`
**Date:** 2026-05-25
**Target:** `joyus-ai-mcp-server`
**Phase 1 shape:** in-process gateway module

## Summary

Implement a shared gateway event bus for tenant-scoped platform events, subscriptions, delivery attempts, bounded retry/dead-letter behavior, and decision ingestion. The module should integrate with existing orchestrator, pipeline review, and monitoring surfaces while preserving domain ownership of lifecycle state.

## Architecture

Add a module under:

```text
joyus-ai-mcp-server/src/gateway-events/
```

Recommended structure:

```text
gateway-events/
├── adapters/
│   ├── dashboard.adapter.ts
│   ├── webhook.adapter.ts
│   ├── slack.adapter.ts
│   ├── email.adapter.ts
│   └── channel.adapter.ts
├── routes/
│   ├── events.ts
│   ├── endpoints.ts
│   ├── subscriptions.ts
│   ├── deliveries.ts
│   └── decisions.ts
├── audit.service.ts
├── decision.service.ts
├── delivery.service.ts
├── event.service.ts
├── handler-registry.ts
├── retry.worker.ts
├── schemas.ts
├── store.ts
├── types.ts
└── index.ts
```

Persistence should live in `joyus-ai-mcp-server/src/db/schema/gateway-events.ts` with a matching Drizzle migration.

## Phase 1 Decisions

- Use text IDs following local codebase conventions.
- Store delivery endpoints and secret references; do not store plaintext credentials in delivery logs.
- Implement dashboard and webhook delivery first.
- Keep Slack/email adapters behind the same interface; they can be completed after webhook proves the shared path.
- Treat channel delivery as optional; disconnected state creates `skipped_no_channel`.
- Start retry scheduling with persisted state and a small worker; leave the model compatible with future Inngest scheduling.

## Fallback Matrix

| Backend | Status when configured | Failure behavior | Operator fallback |
|---------|------------------------|------------------|-------------------|
| Dashboard | Required baseline endpoint | Service health issue, not per-event dead letter | Event remains queryable through persisted gateway records |
| Webhook | Phase 1 external backend | Retry with sanitized errors, then `dead_letter` | Dashboard remains complete |
| Slack | Adapter-compatible backend | Retry/dead-letter through same attempt model | Dashboard and webhook continue |
| Email | Adapter-compatible backend | Retry/dead-letter through same attempt model | Dashboard and webhook continue |
| Channel | Optional backend | `skipped_no_channel` when disconnected | Dashboard and other backends continue |

## Work Package Order

1. WP01 creates the event bus domain model and persistence.
2. WP02 implements event emission, endpoint/subscription management, and read APIs.
3. WP03 implements delivery routing plus dashboard/webhook adapters.
4. WP04 implements retry, dead-letter, and audit inspection.
5. WP05 implements decision ingestion and domain handler routing.
6. WP06 wires producers and acceptance tests.

## Test Strategy

- Unit tests for Zod schemas, event validation, idempotency keys, and tenant mismatch rejection.
- Store tests for endpoint/subscription matching and unique constraints.
- Delivery tests for dashboard, webhook success, webhook retry, dead-letter, and `skipped_no_channel`.
- Decision tests for accepted, duplicate, not decision-capable, handler rejected, and handler routed outcomes.
- Integration tests for pipeline review and monitoring emitters.
- Acceptance gate: `npm run typecheck`, targeted Vitest suites, and OpenAPI YAML parse.

## Rollout Notes

- The gateway should be disabled by default until routes, persistence, and at least dashboard/webhook delivery pass tests.
- Existing `orchestrator/notification.service.ts` should swap from its stub gateway to the real gateway service in WP06.
- Domain emitters should send sanitized payloads only.
- Manual validation should use generic tenants, events, and operators.

## Deferred Work

- Separate service extraction.
- Desktop Channel Server implementation.
- Full Slack/email provider configuration beyond shared adapter contracts.
- Global MCP gateway auth/routing/rate-limit roadmap work.
