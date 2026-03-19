# Requirements Checklist — Automated Pipelines Framework (009)

## Functional Requirements

- [x] Pipeline CRUD — create, read, update, delete pipelines per tenant
- [x] Trigger types — `corpus_change`, `manual_request`, `schedule_tick`
- [x] Step types — profile-generation, fidelity-check, content-generation, source-query, notification
- [x] Retry policy — exponential backoff with configurable max attempts
- [x] Review gates — pause execution, record approval/rejection, resume on approval
- [x] Timeout escalation — escalate gated executions past deadline
- [x] Schedule triggers — cron-based with overlap detection and timezone support
- [x] Pipeline templates — built-in definitions, instantiation, CRUD
- [x] Cycle detection — DFS-based circular dependency detection at create/update time
- [x] Idempotency — dedup via idempotency keys on execution records
- [x] Concurrency policy — skip_if_running, queue, allow_concurrent

## Non-Functional Requirements

- [x] Tenant isolation — all queries and tools scoped by tenant ID
- [x] Analytics — per-pipeline success rate, p95 duration, rejection rate
- [x] Quality signals — governance emission when rejection rate exceeds threshold
- [x] MCP tools — 9 tools exposed via MCP server
- [x] REST API — 10+ endpoints with Zod validation

## Integration Requirements

- [x] Compatible with Feature 005 (profile engine) step handlers
- [x] Compatible with Feature 006 (content infrastructure) step handlers
- [x] Event bus uses PostgreSQL LISTEN/NOTIFY with queue table persistence
