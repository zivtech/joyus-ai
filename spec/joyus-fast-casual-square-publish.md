# Joyus Fast Casual — Square Publish Capability (Production)

## Purpose
Move schedule publishing from static PoC UX into Joyus AI as a real multi-tenant application capability.

This keeps the GitHub Pages planner lightweight while making publish operations secure, auditable, and role-gated.

## Scope
- In scope:
  - Publish approved schedules to Square from Joyus backend services.
  - Tenant-isolated auth, RBAC, and audit logging.
  - Dry-run and apply flows.
  - MCP tool surface for chat-driven operations.
- Out of scope:
  - Direct browser-side publish commands.
  - Unapproved schedule auto-publish.

## Roles and Approval Gates
- Manager:
  - Creates/edits schedule proposals.
  - Submits proposed week for approval.
- Admin Approver (Amy/CEO equivalent):
  - Approves or rejects proposed week.
- Publisher (service account or authorized admin):
  - Executes dry run/apply to Square after approval gate passes.

Mandatory gates:
1. No pending day-level policy requests.
2. Next-week approval status = approved.
3. Coverage rules valid (>=1 opener, >=2 closers).
4. No unassigned required positions.

## Architecture
1. Planner UI (Joyus web app)
- Persists schedule proposals and approval state.
- Does not contain CLI commands.

2. Joyus API (server-side)
- Validates approval and coverage gates.
- Builds canonical publish payload.
- Calls Square connector.
- Stores publish run and results.

3. Square connector
- Uses Square credentials/tokens stored server-side per tenant.
- Supports dry-run and apply.
- Returns created/updated shift IDs and per-shift statuses.

4. MCP layer
- Exposes publish operations to chat agents with tenant-scoped authorization.

## API Contract (proposed)
- `POST /api/v1/tenants/{tenantId}/schedules/{scheduleId}/square/dry-run`
  - Response: validation summary + diff preview + estimated changes.
- `POST /api/v1/tenants/{tenantId}/schedules/{scheduleId}/square/publish`
  - Response: publish run ID + per-shift result status.
- `GET /api/v1/tenants/{tenantId}/square-publish-runs/{runId}`
  - Response: status, errors, created/updated shift IDs, timestamps.

## MCP Tools (proposed)
- `ops_square_schedule_dry_run`
  - Inputs: `tenant_id`, `schedule_id`
  - Output: validation/diff summary
- `ops_square_schedule_publish`
  - Inputs: `tenant_id`, `schedule_id`, `approval_ref`
  - Output: publish run metadata + results URL/ID

## Security and Multi-Tenant Requirements
- All schedule and publish operations scoped by `tenant_id`.
- No cross-tenant read/write access.
- Square tokens encrypted at rest and never exposed to client/browser.
- Immutable audit logs for:
  - proposal submit
  - approval/rejection
  - dry-run
  - publish execution

## Data Model (minimum)
- `schedule_versions`
- `schedule_approvals`
- `square_publish_runs`
- `square_publish_run_items`
- `audit_events`

## Operational Behavior
- Idempotency key for publish endpoint required.
- Retries only for transient Square failures.
- Hard-fail when approval state changes between dry-run and publish.
- Provide rollback strategy for partially applied runs (or explicit manual remediation report).

## Rollout Plan
1. Phase 1: backend dry-run endpoint + UI validation report.
2. Phase 2: backend publish endpoint + run history view.
3. Phase 3: MCP tools + tenant policy controls + alerting.

## Notes for current Milk Jawn PoC
- Keep the static planner export-only.
- Keep local script `scripts/publish_schedule_to_square_mcp.py` for manual operator testing only.
- Do not surface script commands in the app UI.
