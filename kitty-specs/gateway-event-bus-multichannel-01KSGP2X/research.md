# Research: Gateway Event Bus and Multi-Channel Delivery

## Summary

The accepted planning packet supports a Phase 1 in-process gateway event bus inside `joyus-ai-mcp-server`. The public implementation mission keeps private rationale and source logs out of this repo while preserving the implementation decisions needed to proceed.

## Key Decisions

### D-001: Implement In-Process for Phase 1

Start with an in-process TypeScript module under `joyus-ai-mcp-server/src/gateway-events/`.

Rationale:

- The existing server already hosts Express routes, Drizzle persistence, orchestrator events, pipeline review flows, and monitoring routes.
- Existing comments in `orchestrator/notification.service.ts` already assume a future gateway event bus injection point.
- A service boundary can be extracted later without changing the event envelope or public contract.

### D-002: Keep Inngest and Gateway Responsibilities Separate

Inngest remains the durable workflow executor. The Gateway Event Bus owns operator-facing delivery, retry/dead-letter status, and decision return routing.

Implications:

- Pipeline review handlers own review validation and workflow resume behavior.
- Monitoring handlers own alert acknowledgment and dismissal state.
- Workflow approval handlers, if added, own approval lifecycle and expiration state.
- Gateway decisions prove receipt, idempotency, and routing, not final domain completion.

### D-003: Use Database-Backed Delivery Logs with Bounded Retry

Phase 1 should persist every event, subscription, endpoint, delivery attempt, and decision. Retry scheduling can begin with a lightweight in-process worker as long as the state model supports a future Inngest worker.

Defaults:

- `maxAttempts`: 3
- terminal success: `sent`
- terminal failure: `dead_letter`
- terminal non-failure: `skipped_no_channel`

### D-004: Dashboard Baseline, Webhook First External Backend

Dashboard delivery is the baseline non-external surface. Webhook is the first external backend because it is provider-neutral, easy to test locally, and exercises the same retry, signing, redaction, and audit concerns needed by Slack and email.

Slack and email should use the same delivery adapter interface and endpoint/subscription persistence.

### D-005: Channel Delivery Is Optional

Channel delivery is an adapter, not a platform requirement. If no channel connection is present, the gateway records `skipped_no_channel`; this is inspectable but not a failed delivery and not a dead-letter event.

## Existing Local Surfaces

- `joyus-ai-mcp-server/src/orchestrator/event.service.ts` provides append-only tenant-scoped events and SSE streaming.
- `joyus-ai-mcp-server/src/orchestrator/notification.service.ts` already isolates gateway forwarding behind a swappable interface.
- `joyus-ai-mcp-server/src/pipelines/review/decision.ts` provides a domain-owned decision recording surface that should remain outside gateway lifecycle ownership.
- `joyus-ai-mcp-server/src/content/monitoring/routes.ts` and monitoring services provide likely alert emitters.
- `joyus-ai-mcp-server/src/db/schema/events.ts` shows the current codebase convention of text IDs and tenant indexes; gateway tables should follow local Drizzle conventions even where the abstract model says UUID.

## Risks

- The gateway could duplicate the existing orchestrator event stream instead of extending it. Mitigation: treat orchestrator events as one producer and gateway events as delivery/audit records.
- The gateway could accidentally become the approval database for every workflow. Mitigation: require handler routing and document that domain handlers own lifecycle state.
- Channel delivery could become a hidden requirement. Mitigation: keep dashboard baseline complete and test `skipped_no_channel`.
- Retry workers could drift from persisted state. Mitigation: persist `nextRetryAt`, `attemptNumber`, `maxAttempts`, and terminal states before adding scheduler sophistication.

## Evidence Register

The public mission uses local code surfaces and sanitized implementation constraints only. Private source logs, backlog issue mapping, and private rationale are intentionally not copied into this repo.
