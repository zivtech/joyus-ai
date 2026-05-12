---
work_package_id: WP06
title: Typed HTTP API
dependencies:
- WP02
- WP03
requirement_refs:
- FR-007
planning_base_branch: claude/platform-core-orchestrator
merge_target_branch: claude/platform-core-orchestrator
branch_strategy: Planning artifacts for this feature were generated on claude/platform-core-orchestrator. During /spec-kitty.implement this WP may branch from a dependency-specific base, but completed changes must merge back into claude/platform-core-orchestrator unless the human explicitly redirects the landing branch.
subtasks:
- T041
- T042
- T043
- T044
- T045
- T046
- T047
history:
- date: '2026-05-12'
  action: created
  agent: planner
authoritative_surface: joyus-ai-mcp-server/src/orchestrator/routes/
execution_mode: code_change
owned_files:
- joyus-ai-mcp-server/src/orchestrator/index.ts
- joyus-ai-mcp-server/src/orchestrator/routes/**
- joyus-ai-mcp-server/src/orchestrator/schemas.ts
tags: []
---

# WP06: Typed HTTP API

## Objective

Expose all orchestrator functionality via a typed HTTP API with auto-generated OpenAPI documentation. After this WP, external systems can create sessions, send messages, subscribe to events, and manage work units programmatically — all through a schema-validated REST API.

## Context

- **WP02 provides:** Agent loop service, streaming infrastructure
- **WP03 provides:** Event system, SSE streaming
- **API contract:** `contracts/api.yaml` defines all endpoints, schemas, and response types
- **Gas City typed-wire principle:** Every endpoint has a typed schema; OpenAPI is generated from types, not hand-maintained
- **Existing Express app:** The MCP server already has Express routes; mount orchestrator under `/api/v1/orchestrator`

## Subtasks

### T041: Create Express Router and Mount

**Purpose:** Set up the orchestrator API routing infrastructure.

**Steps:**
1. Create `src/orchestrator/index.ts` — module entry point
2. Create `src/orchestrator/routes/` directory
3. Create an Express Router for the orchestrator
4. Mount at `/api/v1/orchestrator` in the main Express app
5. Apply tenant middleware (from WP01) to all orchestrator routes
6. Apply JSON body parsing, request ID generation (correlation ID for tracing)

**Files:**
- `src/orchestrator/index.ts` (new, ~30 lines)
- `src/orchestrator/routes/index.ts` (new, ~20 lines)

### T042: Implement Session API Endpoints

**Purpose:** CRUD endpoints for session management.

**Steps:**
1. Create `src/orchestrator/routes/sessions.ts`
2. Implement endpoints per `contracts/api.yaml`:
   - `POST /sessions` — create session (validates CreateSessionRequest, calls session service)
   - `GET /sessions` — list sessions (supports status, userId filters, cursor pagination)
   - `GET /sessions/:sessionId` — get session details
   - `PATCH /sessions/:sessionId` — update session (suspend, resume, stop, kill actions)
3. All endpoints extract tenantId from middleware, never from request body
4. Return 404 if session doesn't exist OR doesn't belong to the tenant (same response to prevent enumeration)
5. Cursor-based pagination: encode cursor as opaque base64 string containing createdAt + id

**Files:** `src/orchestrator/routes/sessions.ts` (new, ~80 lines)

### T043: Implement Message Endpoint

**Purpose:** Send a message and receive a streamed response.

**Steps:**
1. Create `src/orchestrator/routes/messages.ts`
2. Implement `POST /sessions/:sessionId/messages`:
   - Validate request body (SendMessageRequest schema)
   - Verify session exists and is in "running" status
   - Call agent loop service to process the message
   - Stream response as SSE (using streaming infrastructure from WP02)
   - Response Content-Type: `text/event-stream`
3. If session is not in "running" status: return 409 Conflict
4. If session doesn't exist: return 404

**Files:** `src/orchestrator/routes/messages.ts` (new, ~50 lines)

### T044: Implement Event Subscription Endpoints

**Purpose:** SSE endpoints for event streaming.

**Steps:**
1. Create `src/orchestrator/routes/events.ts`
2. Implement endpoints:
   - `GET /sessions/:sessionId/events` — subscribe to session events (SSE)
   - `GET /events` — subscribe to all tenant events (SSE)
3. Both accept query parameters: `types` (comma-separated filter), `lastEventId` (resume point)
4. Wire to event service SSE handler from WP03
5. Handle client disconnect gracefully

**Files:** `src/orchestrator/routes/events.ts` (new, ~40 lines)

### T045: Implement Coordination API Endpoints

**Purpose:** CRUD endpoints for work units and coordination groups.

**Steps:**
1. Create `src/orchestrator/routes/coordination.ts`
2. Implement endpoints per `contracts/api.yaml`:
   - `POST /work-units` — create work unit
   - `GET /work-units` — list work units (filters: sessionId, coordinationGroupId, status)
   - `GET /work-units/:workUnitId` — get work unit details
   - `PATCH /work-units/:workUnitId` — update work unit
   - `POST /coordination-groups` — create coordination group
   - `GET /coordination-groups/:groupId` — get group with work units
3. All tenant-scoped via middleware

**Files:** `src/orchestrator/routes/coordination.ts` (new, ~80 lines)

### T046: Add Zod Schemas and OpenAPI Generation

**Purpose:** Type-safe request/response validation with auto-generated API docs.

**Steps:**
1. Create `src/orchestrator/schemas.ts` — all Zod schemas for request/response types
2. Define schemas matching `contracts/api.yaml` types:
   - CreateSessionRequest, UpdateSessionRequest, SendMessageRequest
   - CreateWorkUnitRequest, UpdateWorkUnitRequest
   - CreateCoordinationGroupRequest
   - Session, Turn, WorkUnit, CoordinationGroup response schemas
3. Use `zod-to-openapi` (or similar) to generate OpenAPI 3.1 spec from Zod schemas
4. Serve OpenAPI spec at `/api/v1/orchestrator/openapi.json`
5. Validate every request body against its Zod schema in route handlers
6. Return 400 with Zod error details on validation failure

**Library choice:** Use `@asteasolutions/zod-to-openapi` — it's the most mature Zod → OpenAPI library. If already using a different OpenAPI generator in the project, use that instead.

**Files:** `src/orchestrator/schemas.ts` (new, ~120 lines)

### T047: Add CI Schema Drift Detection

**Purpose:** Ensure the OpenAPI spec stays in sync with the Zod schemas.

**Steps:**
1. Add a test that generates the OpenAPI spec from Zod schemas at test time
2. Compare generated spec against the committed `contracts/api.yaml`
3. If they differ: fail the test with a clear diff showing what changed
4. This enforces the typed-wire principle: schema changes must flow through Zod → OpenAPI, never by editing the YAML directly

**Alternative:** If the project generates OpenAPI at build time rather than committing it, add a CI step that generates and verifies no drift.

**Files:** Test file in the project's test directory (~40 lines)

## Definition of Done

- [ ] All endpoints from contracts/api.yaml are implemented and responding
- [ ] Request bodies are validated against Zod schemas; invalid requests return 400
- [ ] OpenAPI documentation is auto-generated from Zod schemas
- [ ] OpenAPI spec is served at `/api/v1/orchestrator/openapi.json`
- [ ] CI detects schema drift between Zod schemas and committed OpenAPI spec
- [ ] All endpoints are tenant-scoped; 404 returned for cross-tenant access attempts
- [ ] Cursor-based pagination works correctly on list endpoints

## Risks

| Risk | Mitigation |
|------|-----------|
| zod-to-openapi may not support all Zod types | Test with complex types (unions, discriminated unions) early |
| OpenAPI 3.1 vs 3.0 compatibility | Use 3.1; most tooling supports it now |

## Reviewer Guidance

- **No tenantId in request body:** Verify every endpoint extracts tenantId from middleware, never from the request.
- **404 vs 403:** Session/work-unit not found and "not yours" MUST return the same 404 (prevent ID enumeration).
- **Zod schema completeness:** Every field in contracts/api.yaml should have a corresponding Zod schema field.
- **SSE endpoints:** Verify they set correct Content-Type headers and handle disconnect.
