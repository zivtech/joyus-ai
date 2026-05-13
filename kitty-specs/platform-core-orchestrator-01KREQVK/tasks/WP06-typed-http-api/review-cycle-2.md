---
affected_files: []
cycle_number: 2
mission_slug: platform-core-orchestrator-01KREQVK
reproduction_command:
reviewed_at: '2026-05-12T23:43:49Z'
reviewer_agent: unknown
verdict: rejected
wp_id: WP06
---

# Review Feedback — WP06: Typed HTTP API (Cycle 1)

**Reviewer:** orchestrator (from stalled reviewer findings)
**Date:** 2026-05-12
**Verdict:** REJECT

---

## Blocking Issue

### Missing `listTurns` endpoint (T042/T046)
`GET /sessions/{sessionId}/turns` is defined in `contracts/api.yaml` and T046 lists "Turn" and "TurnList" as required response schemas. Neither the endpoint nor the schemas exist in the implementation. This is a contract gap — external consumers relying on the API spec cannot retrieve conversation history.

**Fix:** Add `GET /sessions/:id/turns` route in `sessions.ts` that calls `memoryService.loadHistory(sessionId)` and returns paginated turns. Add `TurnResponse` and `TurnListResponse` Zod schemas.

---

## Non-blocking Issues (fix if easy)

1. **operationId mismatch:** Contract says `subscribeTenantEvents`, implementation has `subscribeAllEvents`. Minor naming drift.

2. **`lastEventId` header vs query param:** Contract defines it as a query param; implementation reads `Last-Event-ID` header. Header is better SSE practice but diverges from contract without documented rationale.

3. **Missing route tests for messages, events, coordination:** Only sessions, helpers, and openapi routes have tests. T043/T044/T045 handlers are untested.
