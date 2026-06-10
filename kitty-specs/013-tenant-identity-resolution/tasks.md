# Tasks: Tenant Identity Resolution (Spec 013)

**Feature**: 013-tenant-identity-resolution
**Plan**: [plan.md](plan.md)
**Total subtasks**: 31 across 5 work packages

## Subtask Inventory

| ID | Description | WP |
|----|-------------|----|
| T001 | Add `tenants` table to Drizzle schema | WP01 |
| T002 | Add `tenant_memberships` table with role, status, and primary flag | WP01 |
| T003 | Add `tenant_access_audit` table for override events | WP01 |
| T004 | Generate Drizzle migration | WP01 |
| T005 | Add idempotent compatibility seed for `tenantId === userId` | WP01 |
| T006 | Add optional allowlist import helper for export memberships | WP01 |
| T007 | Add schema and seed tests | WP01 |
| T008 | Define `TenantContext` and resolver input types | WP02 |
| T009 | Implement membership lookup repository | WP02 |
| T010 | Implement bearer default resolution | WP02 |
| T011 | Implement explicit requested tenant authorization | WP02 |
| T012 | Implement API-key tenant context adapter | WP02 |
| T013 | Implement operator override with audit event | WP02 |
| T014 | Add Express middleware helpers | WP02 |
| T015 | Add resolver unit tests for success and failure paths | WP02 |
| T016 | Port exports route and service to shared resolver | WP03 |
| T017 | Preserve export response contracts and non-disclosure behavior | WP03 |
| T018 | Port content mediation auth through API-key resolver adapter | WP03 |
| T019 | Add exports route tests | WP03 |
| T020 | Add content mediation auth compatibility tests | WP03 |
| T021 | Port pipeline routes to shared resolver | WP04 |
| T022 | Port orchestrator tenant middleware to shared resolver | WP04 |
| T023 | Port event adapter management routes to shared resolver | WP04 |
| T024 | Pass tenant context into MCP tool execution | WP04 |
| T025 | Replace direct `userId === tenantId` assignments with resolver output | WP04 |
| T026 | Add bearer route and tool tests | WP04 |
| T027 | Replace event adapter admin header-only tenant selection | WP05 |
| T028 | Add admin tenant selector or explicit operator override path | WP05 |
| T029 | Remove runtime use of export allowlist env vars | WP05 |
| T030 | Run acceptance grep and client abstraction checks | WP05 |
| T031 | Run TypeScript and targeted vitest suites | WP05 |

## Work Packages

### WP01 - Schema and Compatibility Migration

**Goal**: Create first-class tenant and membership tables while preserving current behavior.
**Priority**: High
**Dependencies**: None
**Prompt**: [tasks/WP01-schema-memberships.md](tasks/WP01-schema-memberships.md)

### WP02 - Shared Resolver

**Goal**: Implement the reusable tenant context resolver and middleware adapters.
**Priority**: High
**Dependencies**: WP01
**Prompt**: [tasks/WP02-shared-resolver.md](tasks/WP02-shared-resolver.md)

### WP03 - Explicit Tenant and API-Key Routes

**Goal**: Port the two surfaces with existing non-user tenant semantics: exports and content mediation.
**Priority**: High
**Dependencies**: WP02
**Prompt**: [tasks/WP03-explicit-and-api-key-routes.md](tasks/WP03-explicit-and-api-key-routes.md)

### WP04 - Bearer Routes and Tool Execution

**Goal**: Port bearer-token APIs and MCP tools away from direct `userId === tenantId` assignment.
**Priority**: High
**Dependencies**: WP02, WP03
**Prompt**: [tasks/WP04-bearer-routes-and-tools.md](tasks/WP04-bearer-routes-and-tools.md)

### WP05 - Admin Cleanup and Acceptance

**Goal**: Replace header-only admin tenant selection, remove runtime allowlists, and complete acceptance tests.
**Priority**: High
**Dependencies**: WP04
**Prompt**: [tasks/WP05-admin-cleanup-acceptance.md](tasks/WP05-admin-cleanup-acceptance.md)

## MVP Scope

WP01 through WP03 produce a usable resolver for explicit tenant and API-key paths. WP04 and WP05 are required before issue #37 can close because route-local fallbacks and admin header selection still remain until then.

## Parallelization Opportunities

- T008 through T014 can be developed with pure unit tests before route ports begin.
- T019 and T020 can be written in parallel after WP03 route ports.
- Event adapter management route ports in T023 can be split by route file after the shared middleware is available.

<!-- status-model:start -->
## Canonical Status (Generated)
- WP01: planned
- WP02: planned
- WP03: planned
- WP04: planned
- WP05: planned
<!-- status-model:end -->
