# Work Packages: Content Infrastructure
*Feature 006 — Phase 2 task decomposition*

**Total**: 12 work packages, 58 subtasks
**Parallelization**: 4 layers — up to 4 WPs can run concurrently

## Dependency Graph

```
Layer 0: WP01 (foundation)
Layer 1: WP02, WP04, WP05, WP11 (parallel — all depend only on WP01)
Layer 2: WP03, WP06, WP08 (parallel — mixed deps from Layer 1)
Layer 3: WP07, WP09, WP10 (parallel — depend on Layer 2)
Layer 4: WP12 (integration — depends on all)
```

---

## Phase A: Foundation

### WP01 — Content Schema & Foundation
**Prompt**: [`tasks/WP01-content-schema-foundation.md`](tasks/WP01-content-schema-foundation.md)
**Priority**: P0 (blocks everything) | **Dependencies**: none | **Est. ~350 lines**

Create the Drizzle ORM schema for the `content` PostgreSQL schema (12 tables), Zod validation schemas, shared TypeScript types, and wire exports into the existing db client.

**Subtasks**:
- [x] T001: Create content Drizzle schema (`src/content/schema.ts`) — all 12 tables with pgSchema, enums, relations, indexes
- [x] T002: Create Zod validation schemas (`src/content/validation.ts`) — input validation for all content operations
- [x] T003: Create shared TypeScript types and constants (`src/content/types.ts`)
- [x] T004: Export content schema from `src/db/client.ts`
- [x] T005: Add Zod dependency to `package.json`

**Parallel opportunities**: None — this is the foundation.
**Risks**: Drizzle `pgSchema` API may need custom SQL for generated `tsvector` column and GIN index.

---

## Phase B: Content Source Layer

### WP02 — Connector Abstraction & MVP Connectors
**Prompt**: [`tasks/WP02-connectors.md`](tasks/WP02-connectors.md)
**Priority**: P1 | **Dependencies**: WP01 | **Est. ~400 lines**

Define the pluggable `ContentConnector` interface and implement both MVP connectors: relational database (PostgreSQL/MySQL) and REST/GraphQL API.

**Subtasks**:
- [x] T006: Define ContentConnector interface and shared connector types (`src/content/connectors/interface.ts`)
- [x] T007: Create ConnectorRegistry — type string → connector factory (`src/content/connectors/registry.ts`)
- [x] T008: Implement DatabaseConnector — query-based indexing for PostgreSQL/MySQL (`src/content/connectors/database-connector.ts`)
- [x] T009: Implement ApiConnector — REST/GraphQL endpoint indexing (`src/content/connectors/api-connector.ts`)
- [x] T010: Add connector health check support and error handling

**Parallel opportunities**: T008 and T009 can be developed in parallel (different files, same interface).
**Risks**: Database connector needs to handle varied schema structures; API connector must handle pagination patterns.

### WP03 — Sync Engine
**Prompt**: [`tasks/WP03-sync-engine.md`](tasks/WP03-sync-engine.md)
**Priority**: P1 | **Dependencies**: WP01, WP02 | **Est. ~450 lines**

Build the batch sync engine that orchestrates content indexing across connected sources, supporting all three sync strategies with scheduled and manual triggers.

**Subtasks**:
- [ ] T011: Create SyncEngine batch orchestrator (`src/content/sync/engine.ts`)
- [ ] T012: Implement cursor-based incremental indexing with configurable batch size
- [ ] T013: Implement sync state tracking — SyncRun records with status transitions
- [ ] T014: Implement sync strategy handling (mirror/pass-through/hybrid)
- [ ] T015: Add content staleness detection and flagging
- [ ] T016: Add scheduled sync via node-cron (`src/content/sync/scheduler.ts`)
- [ ] T017: Add manual sync trigger

**Parallel opportunities**: T015 (staleness) and T016 (scheduling) are independent.
**Risks**: Cursor-based pagination must handle 500K items without memory issues. Sync state must survive server restarts.

---

## Phase C: Search & Access

### WP04 — Search Abstraction & PostgreSQL FTS
**Prompt**: [`tasks/WP04-search.md`](tasks/WP04-search.md)
**Priority**: P1 | **Dependencies**: WP01 | **Est. ~350 lines**

Build the search layer: a `SearchProvider` interface with PostgreSQL full-text search as the default implementation, wrapped in an entitlement-filtered search service.

**Subtasks**:
- [x] T018: Define SearchProvider interface (`src/content/search/interface.ts`)
- [x] T019: Implement PostgreSQL FTS provider — tsvector, GIN index, ts_rank (`src/content/search/pg-fts-provider.ts`)
- [x] T020: Create entitlement-filtered search service (`src/content/search/index.ts`)
- [x] T021: Add search result formatting — source attribution, ranking, staleness indicators

**Parallel opportunities**: Can run in parallel with WP02, WP05.
**Risks**: Drizzle ORM FTS requires raw SQL via `sql` tagged template — no built-in tsvector support.

### WP05 — Entitlement Resolution
**Prompt**: [`tasks/WP05-entitlements.md`](tasks/WP05-entitlements.md)
**Priority**: P1 | **Dependencies**: WP01 | **Est. ~400 lines**

Build the entitlement system: pluggable resolver interface, HTTP-based resolver, session-scoped cache, and product management.

**Subtasks**:
- [ ] T022: Define EntitlementResolver interface (`src/content/entitlements/interface.ts`)
- [ ] T023: Implement HttpEntitlementResolver — generic HTTP endpoint query (`src/content/entitlements/http-resolver.ts`)
- [ ] T024: Create session-scoped entitlement cache (`src/content/entitlements/cache.ts`)
- [ ] T025: Create entitlement service — resolve + cache + fallback (`src/content/entitlements/index.ts`)
- [ ] T026: Create product management — CRUD for products, source mappings, profile mappings

**Parallel opportunities**: Can run in parallel with WP02, WP04. T026 (products) is independent of T022-T025 (resolver).
**Risks**: Entitlement cache must handle concurrent access safely. Fallback behavior (restricted access mode) must not leak content.

---

## Phase D: Generation & Tools

### WP06 — Content-Aware Generation
**Prompt**: [`tasks/WP06-generation.md`](tasks/WP06-generation.md)
**Priority**: P2 | **Dependencies**: WP04, WP05 | **Est. ~400 lines**

Build the content-aware generation pipeline: retrieve relevant content from accessible sources, apply voice profiles, generate with citations, and log for audit.

**Subtasks**:
- [ ] T027: Create content retriever — search + entitlement filter → ranked context (`src/content/generation/retriever.ts`)
- [ ] T028: Create voice-consistent generator — profile engine integration interface (`src/content/generation/generator.ts`)
- [ ] T029: Create citation manager — source reference extraction and formatting (`src/content/generation/citations.ts`)
- [ ] T030: Create generation audit logging — GenerationLog records

**Parallel opportunities**: T029 (citations) is independent of T028 (generator).
**Risks**: Generator must be model-agnostic (§2.6). Citation extraction depends on generation output format.

### WP07 — MCP Content Tools
**Prompt**: [`tasks/WP07-mcp-tools.md`](tasks/WP07-mcp-tools.md)
**Priority**: P2 | **Dependencies**: WP02, WP03, WP04, WP05, WP06 | **Est. ~500 lines**

Implement all 13 MCP tools for content operations and register them in the existing tool system.

**Subtasks**:
- [ ] T031: Implement source management tools — content_list_sources, content_get_source, content_sync_source, content_get_sync_status
- [ ] T032: Implement search tools — content_search, content_get_item
- [ ] T033: Implement entitlement tools — content_resolve_entitlements, content_list_products
- [ ] T034: Implement generation tool — content_generate
- [ ] T035: Implement content state dashboard tool — content_state_dashboard
- [ ] T036: Implement drift monitoring tools — content_drift_report, content_drift_summary
- [ ] T037: Register content tools in tool index (`src/tools/index.ts`) and executor (`src/tools/executor.ts`)

**Parallel opportunities**: T031-T036 are independent (different tool groups). T037 must come last.
**Risks**: Must match existing tool registration pattern exactly (ToolDefinition interface, prefix routing in executor).

---

## Phase E: Bot Mediation

### WP08 — Mediation API Auth & Sessions
**Prompt**: [`tasks/WP08-mediation-auth.md`](tasks/WP08-mediation-auth.md)
**Priority**: P3 | **Dependencies**: WP01, WP05 | **Est. ~350 lines**

Build the mediation API authentication layer (two-layer: API key + OAuth2/OIDC) and session management.

**Subtasks**:
- [ ] T038: Create two-layer auth middleware — API key validation + JWT/OIDC token verification (`src/content/mediation/auth.ts`)
- [ ] T039: Create API key management — hashed storage, creation, validation, revocation
- [ ] T040: Create mediation session management — create, get, close sessions (`src/content/mediation/session.ts`)
- [ ] T041: Mount mediation router in Express app (`src/content/mediation/router.ts`)

**Parallel opportunities**: Can run in parallel with WP06, WP07.
**Risks**: JWKS URI fetching and JWT verification must handle network failures gracefully. API key hashing must use constant-time comparison.

### WP09 — Mediation API Endpoints
**Prompt**: [`tasks/WP09-mediation-endpoints.md`](tasks/WP09-mediation-endpoints.md)
**Priority**: P3 | **Dependencies**: WP06, WP08 | **Est. ~400 lines**

Implement the mediation REST API endpoints: session creation, messaging, and health check.

**Subtasks**:
- [ ] T042: Implement POST /sessions — create session with entitlement resolution
- [ ] T043: Implement POST /sessions/:id/messages — send message, generate response
- [ ] T044: Implement GET /sessions/:id and DELETE /sessions/:id
- [ ] T045: Implement GET /health — mediation subsystem health check

**Parallel opportunities**: T042-T045 are independent endpoints.
**Risks**: Message endpoint (T043) is the critical path — must orchestrate retrieval, generation, and citation in a single request. Must handle 100 concurrent sessions (SC-006).

---

## Phase F: Monitoring & Observability

### WP10 — Voice Drift Monitoring
**Prompt**: [`tasks/WP10-drift-monitoring.md`](tasks/WP10-drift-monitoring.md)
**Priority**: P2 | **Dependencies**: WP06 | **Est. ~350 lines**

Build the background voice drift monitoring system: interface, scheduler, report generation, and drift score integration.

**Subtasks**:
- [ ] T046: Define VoiceAnalyzer interface (`src/content/monitoring/interface.ts`)
- [ ] T047: Create drift monitor scheduler — cron background job (`src/content/monitoring/drift.ts`)
- [ ] T048: Implement drift report generation and storage — DriftReport records
- [ ] T049: Integrate drift scores with generation logs — back-populate driftScore field

**Parallel opportunities**: Can run in parallel with WP07, WP08.
**Risks**: VoiceAnalyzer is an interface with no concrete implementation in this feature (profile engine provides it). Must ship with a mock/stub for testing.

### WP11 — Observability
**Prompt**: [`tasks/WP11-observability.md`](tasks/WP11-observability.md)
**Priority**: P2 | **Dependencies**: WP01 | **Est. ~350 lines**

Build structured logging, health endpoints, and metrics collection for all content operations.

**Subtasks**:
- [ ] T050: Create structured content operation logger (`src/content/monitoring/logger.ts`)
- [ ] T051: Create health endpoint handler — all subsystem health checks (`src/content/monitoring/health.ts`)
- [ ] T052: Create metrics collection — sync stats, search latency, resolution times, generation metrics (`src/content/monitoring/metrics.ts`)
- [ ] T053: Mount health/metrics routes in Express app

**Parallel opportunities**: Can run in parallel with WP02, WP04, WP05 (only depends on WP01). T050-T052 are independent files.
**Risks**: Health checks must aggregate status from connectors, search provider, and entitlement resolver — need to handle partial availability gracefully.

---

## Phase G: Integration

### WP12 — Integration Tests & Server Wiring
**Prompt**: [`tasks/WP12-integration.md`](tasks/WP12-integration.md)
**Priority**: P2 | **Dependencies**: WP01-WP11 | **Est. ~400 lines**

Wire the content module into server startup and create integration tests covering the full content pipeline, mediation flow, entitlement enforcement, and drift monitoring.

**Subtasks**:
- [ ] T054: Wire content module initialization into server startup (`src/index.ts`)
- [ ] T055: Integration tests — content pipeline (connect → sync → search → generate)
- [ ] T056: Integration tests — mediation flow (auth → session → message → cite)
- [ ] T057: Integration tests — entitlement enforcement (access granted/denied across all paths)
- [ ] T058: Integration tests — drift monitoring pipeline

**Parallel opportunities**: T055-T058 are independent test suites.
**Risks**: Integration tests need database fixtures and mock external services. Must not interfere with existing tests.
