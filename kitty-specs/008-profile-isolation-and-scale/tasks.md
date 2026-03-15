# Work Packages: Profile Isolation and Scale
*Feature 008 — Task decomposition*

**Total**: 8 work packages, 48 subtasks
**Parallelization**: 6 layers — up to 2 WPs can run concurrently at peak

## Dependency Graph

```
Layer 0: WP01 (schema & types foundation)
Layer 1: WP02, WP03 (parallel — both depend only on WP01)
Layer 2: WP04 (depends on WP03)
Layer 3: WP05, WP06 (parallel — WP05 depends on WP01, WP06 depends on WP03)
Layer 4: WP07 (depends on WP02, WP03, WP04, WP05, WP06)
Layer 5: WP08 (depends on all)
```

---

## Subtask Index

| ID | Description | WP | Parallel |
|----|-------------|-----|----------|
| T001 | Create profiles Drizzle schema (`src/profiles/schema.ts`) — 7 tables, 5 enums | WP01 | |
| T002 | Create shared TypeScript types and constants (`src/profiles/types.ts`) | WP01 | |
| T003 | Create Zod validation schemas (`src/profiles/validation.ts`) | WP01 | |
| T004 | Create module barrel export (`src/profiles/index.ts`) | WP01 | |
| T005 | Export profiles schema from `src/db/client.ts` | WP01 | |
| T006 | Generate Drizzle migration (`drizzle/`) | WP01 | |
| T007 | Verify typecheck and existing tests pass | WP01 | |
| T008 | Implement ProfileAccessDeniedError and ProfileNotFoundError (`src/profiles/access/errors.ts`) | WP02 | |
| T009 | Implement audit log writer (`src/profiles/access/audit.ts`) | WP02 | |
| T010 | Implement assertProfileAccessOrAudit guard (`src/profiles/access/guard.ts`) | WP02 | |
| T011 | Implement session-profile binding validation | WP02 | |
| T012 | Create access module barrel and unit tests | WP02 | |
| T013 | Implement version creation logic (`src/profiles/versioning/manager.ts`) | WP03 | |
| T014 | Implement version pinning and currentVersion updates | WP03 | |
| T015 | Implement feature vector diff engine (`src/profiles/versioning/diff.ts`) | WP03 | [P] |
| T016 | Implement staleness detection (`src/profiles/versioning/staleness.ts`) | WP03 | [P] |
| T017 | Create versioning module barrel and unit tests | WP03 | |
| T018 | Implement batch ingestion job queue (`src/profiles/ingestion/batch.ts`) | WP04 | |
| T019 | Implement single-document processor (`src/profiles/ingestion/processor.ts`) | WP04 | [P] |
| T020 | Implement progress tracking and cancellation | WP04 | |
| T021 | Implement completion event emission with accuracy metrics | WP04 | |
| T022 | Create ingestion module barrel and unit tests | WP04 | |
| T023 | Implement LRU cache with TTL (`src/profiles/cache/lru.ts`) | WP05 | |
| T024 | Implement cache stampede protection (mutex on miss) | WP05 | |
| T025 | Implement cache invalidation on retrain/version-change | WP05 | |
| T026 | Create cache module barrel and unit tests | WP05 | |
| T027 | Implement ProfileEngineClient interface (`src/profiles/engine/interface.ts`) | WP06 | |
| T028 | Implement NullProfileEngineClient stub (`src/profiles/engine/null-client.ts`) | WP06 | [P] |
| T029 | Implement drift event listener (`src/profiles/retraining/listener.ts`) | WP06 | |
| T030 | Implement retraining worker with advisory locks (`src/profiles/retraining/worker.ts`) | WP06 | |
| T031 | Create engine and retraining module barrels and unit tests | WP06 | |
| T032 | Implement profile CRUD routes (`src/profiles/routes.ts`) — create, list, get, delete | WP07 | |
| T033 | Implement version routes — list versions, get version, diff | WP07 | [P] |
| T034 | Implement action routes — retrain, pin | WP07 | [P] |
| T035 | Implement audit log query route | WP07 | |
| T036 | Implement MCP tool definitions (`src/profiles/tools.ts`) — 7 tools | WP07 | |
| T037 | Enforce tenant scoping on all routes and tools | WP07 | |
| T038 | Create module entry point with initialization (`src/profiles/index.ts`) | WP07 | |
| T039 | Mount profile routes and register tools in `src/index.ts` | WP07 | |
| T040 | Unit tests for routes and tools | WP07 | |
| T041 | Integration test — tenant isolation (cross-tenant access denied) | WP08 | |
| T042 | Integration test — version lifecycle (create, retrain, pin, diff, rollback) | WP08 | |
| T043 | Integration test — batch ingestion (100 docs, progress, cancel) | WP08 | |
| T044 | Integration test — drift-triggered retraining (drift event -> new version) | WP08 | |
| T045 | Integration test — cache behavior (hit, miss, invalidation, stampede) | WP08 | |
| T046 | Integration test — session-profile binding validation | WP08 | |
| T047 | Integration test — audit log completeness (all operations logged) | WP08 | |
| T048 | Validation sweep — `npm run validate` (typecheck + lint + test), zero regressions | WP08 | |

---

## Phase A: Foundation

### WP01 — Profile Schema & Tenant Scoping
**Prompt**: [`tasks/WP01-profile-schema.md`](tasks/WP01-profile-schema.md)
**Priority**: P0 (blocks everything) | **Dependencies**: none | **Est. ~500 lines**

Create the Drizzle ORM schema for the `profiles` PostgreSQL schema (7 tables, 5 enums), Zod validation schemas, shared TypeScript types, and wire exports into the existing database client. Generate and verify the Drizzle migration.

**Subtasks**:
- [ ] T001: Create profiles Drizzle schema (`src/profiles/schema.ts`) — all 7 tables with pgSchema, enums, relations, indexes
- [ ] T002: Create shared TypeScript types, enums, and constants (`src/profiles/types.ts`)
- [ ] T003: Create Zod validation schemas (`src/profiles/validation.ts`) — profile creation, retrain request, version pin
- [ ] T004: Create module barrel export (`src/profiles/index.ts`)
- [ ] T005: Export profiles schema from `src/db/client.ts`
- [ ] T006: Generate Drizzle migration (`drizzle/`)
- [ ] T007: Verify typecheck and existing tests pass

**Parallel opportunities**: None — this is the foundation.
**Risks**: Drizzle `pgSchema` must create the `profiles` schema before tables. May need `CREATE SCHEMA IF NOT EXISTS profiles;` in migration.

---

### WP02 — Profile Access Control
**Prompt**: [`tasks/WP02-access-control.md`](tasks/WP02-access-control.md)
**Priority**: P0 (security foundation) | **Dependencies**: WP01 | **Est. ~400 lines**

Implement the `assertProfileAccessOrAudit()` guard, error types, audit log writer, and session-profile binding validation. This is the single enforcement point for tenant isolation.

**Subtasks**:
- [ ] T008: Implement ProfileAccessDeniedError and ProfileNotFoundError (`src/profiles/access/errors.ts`)
- [ ] T009: Implement audit log writer (`src/profiles/access/audit.ts`) — `logAccess()` and `logDenial()` methods
- [ ] T010: Implement assertProfileAccessOrAudit guard (`src/profiles/access/guard.ts`)
- [ ] T011: Implement session-profile binding validation (tenantId match check for mediation sessions)
- [ ] T012: Create access module barrel export and unit tests

**Parallel opportunities**: Can run in parallel with WP03.
**Risks**: Guard must handle the case where the profile does not exist (return 404, not 403 — avoid leaking existence info? Decision: return 404 uniformly for both not-found and wrong-tenant to prevent enumeration).

---

## Phase B: Profile Lifecycle

### WP03 — Profile Versioning
**Prompt**: [`tasks/WP03-versioning.md`](tasks/WP03-versioning.md)
**Priority**: P1 | **Dependencies**: WP01 | **Est. ~450 lines**

Implement the version creation and management logic, version pinning, feature vector diff engine, and staleness detection.

**Subtasks**:
- [ ] T013: Implement version creation logic (`src/profiles/versioning/manager.ts`) — create version, update currentVersion pointer
- [ ] T014: Implement version pinning and currentVersion updates
- [ ] T015: Implement feature vector diff engine (`src/profiles/versioning/diff.ts`) — compare two versions, produce structured diff
- [ ] T016: Implement staleness detection (`src/profiles/versioning/staleness.ts`) — computed on query from lastRetrainedAt
- [ ] T017: Create versioning module barrel export and unit tests

**Parallel opportunities**: Can run in parallel with WP02. T015 (diff) and T016 (staleness) are independent of T013-T014 (version management).
**Risks**: Version numbering must be monotonically increasing per profile. Use `MAX(versionNumber) + 1` query with row-level lock to prevent duplicates under concurrency.

---

### WP04 — Batch Ingestion Pipeline
**Prompt**: [`tasks/WP04-batch-ingestion.md`](tasks/WP04-batch-ingestion.md)
**Priority**: P1 | **Dependencies**: WP03 | **Est. ~450 lines**

Build the batch ingestion pipeline for processing large document corpora: job queue, per-document processing, progress tracking, cancellation, and completion events.

**Subtasks**:
- [ ] T018: Implement batch ingestion job queue (`src/profiles/ingestion/batch.ts`) — create job, poll pending jobs, update status
- [ ] T019: Implement single-document processor (`src/profiles/ingestion/processor.ts`) — wraps ProfileEngineClient.extractFeatures
- [ ] T020: Implement progress tracking and cancellation — update processedCount, check for cancellation flag
- [ ] T021: Implement completion event emission with accuracy metrics — emit `profile.training.completed` event
- [ ] T022: Create ingestion module barrel export and unit tests

**Parallel opportunities**: T019 (processor) is independent of T018 (queue). T020 and T021 depend on both.
**Risks**: Batch jobs must validate document tenant ownership before extraction. A tenant must not train profiles on another tenant's documents. Check `contentItems.sourceId -> contentSources.tenantId` matches the profile's `tenantId`.

---

## Phase C: Performance & Resilience

### WP05 — Profile Caching & Latency
**Prompt**: [`tasks/WP05-caching.md`](tasks/WP05-caching.md)
**Priority**: P2 | **Dependencies**: WP01 | **Est. ~350 lines**

Build the in-memory LRU cache for profile feature vectors with TTL, stampede protection, and invalidation hooks.

**Subtasks**:
- [ ] T023: Implement LRU cache with TTL (`src/profiles/cache/lru.ts`) — configurable maxSize and TTL
- [ ] T024: Implement cache stampede protection (mutex on cache miss) — prevent thundering herd
- [ ] T025: Implement cache invalidation on retrain/version-change — hook into version manager
- [ ] T026: Create cache module barrel export and unit tests

**Parallel opportunities**: Can run in parallel with WP06. T023 and T024 are independent of the rest of the profile module.
**Risks**: LRU eviction under memory pressure. Set conservative defaults (maxSize: 1000, TTL: 1 hour). Monitor memory usage.

---

### WP06 — Engine Interface & Drift-Triggered Retraining
**Prompt**: [`tasks/WP06-engine-retraining.md`](tasks/WP06-engine-retraining.md)
**Priority**: P1 | **Dependencies**: WP03 | **Est. ~450 lines**

Define the ProfileEngineClient interface, implement the NullClient stub, build the drift event listener, and implement the retraining worker with advisory locks.

**Subtasks**:
- [ ] T027: Implement ProfileEngineClient interface (`src/profiles/engine/interface.ts`) — extractFeatures, computeSimilarity, trainProfile
- [ ] T028: Implement NullProfileEngineClient stub (`src/profiles/engine/null-client.ts`) — returns synthetic feature vectors
- [ ] T029: Implement drift event listener (`src/profiles/retraining/listener.ts`) — listens for `profile.drift.exceeded` from Spec 005
- [ ] T030: Implement retraining worker with advisory locks (`src/profiles/retraining/worker.ts`) — pg_advisory_xact_lock, creates new version
- [ ] T031: Create engine and retraining module barrels and unit tests

**Parallel opportunities**: Can run in parallel with WP05. T027-T028 (engine) and T029-T030 (retraining) are independent tracks.
**Risks**: Advisory lock hash collisions are theoretically possible but practically negligible. Use a deterministic hash function on the profile CUID to generate the lock ID. Retraining worker must verify that the drift report is still current (not superseded by a newer report) before proceeding.

---

## Phase D: API & Integration

### WP07 — Profile API & MCP Tools
**Prompt**: [`tasks/WP07-api-mcp-tools.md`](tasks/WP07-api-mcp-tools.md)
**Priority**: P1 | **Dependencies**: WP02, WP03, WP04, WP05, WP06 | **Est. ~550 lines**

Implement Express routes for profile management, MCP tool definitions, tenant-scoped route enforcement, module entry point, and server mount.

**Subtasks**:
- [ ] T032: Implement profile CRUD routes (`src/profiles/routes.ts`) — create, list, get, delete (soft-archive)
- [ ] T033: Implement version routes — list versions, get version, diff
- [ ] T034: Implement action routes — retrain (enqueue batch job), pin (set version pin)
- [ ] T035: Implement audit log query route — paginated, tenant-scoped
- [ ] T036: Implement MCP tool definitions (`src/profiles/tools.ts`) — 7 tools matching FR-014
- [ ] T037: Enforce tenant scoping on all routes and tools — `req.tenantId` from auth middleware
- [ ] T038: Create module entry point with initialization (`src/profiles/index.ts`) — wire cache, engine, listener
- [ ] T039: Mount profile routes and register tools in `src/index.ts`
- [ ] T040: Unit tests for routes and tools

**Parallel opportunities**: T032-T035 (routes) and T036 (tools) are independent. T037 wraps both.
**Risks**: Must match existing tool registration pattern (ToolDefinition interface, prefix routing in executor). Profile creation must trigger initial batch ingestion if document IDs are provided.

---

### WP08 — Integration & Validation
**Prompt**: [`tasks/WP08-integration-validation.md`](tasks/WP08-integration-validation.md)
**Priority**: P1 | **Dependencies**: WP01-WP07 | **Est. ~500 lines**

End-to-end integration tests: tenant isolation, version lifecycle, batch ingestion, drift-triggered retraining, cache behavior, session binding, audit completeness, and full validation sweep.

**Subtasks**:
- [ ] T041: Integration test — tenant isolation (cross-tenant profile access denied on all paths)
- [ ] T042: Integration test — version lifecycle (create -> retrain -> new version -> pin -> diff -> rollback)
- [ ] T043: Integration test — batch ingestion (100 documents, progress tracking, cancellation)
- [ ] T044: Integration test — drift-triggered retraining (mock drift event -> retraining -> new version created)
- [ ] T045: Integration test — cache behavior (cache hit < 5ms, miss -> DB fetch, invalidation on retrain)
- [ ] T046: Integration test — session-profile binding validation (tenant mismatch rejected)
- [ ] T047: Integration test — audit log completeness (all CRUD + access attempts logged)
- [ ] T048: Validation sweep — `npm run validate` (typecheck + lint + test), zero regressions

**Parallel opportunities**: T041-T047 are independent test suites.
**Risks**: Integration tests need database fixtures, mock profile engine client, and clock manipulation for staleness tests. Must not interfere with existing tests.

---

## Dependency Graph

```
WP01 (Schema & Types)
  ├──▶ WP02 (Access Control) ──────────────────────┐
  ├──▶ WP03 (Versioning) ──▶ WP04 (Batch Ingest) ──┤
  │                        └──▶ WP06 (Engine/Retrain)┤
  └──▶ WP05 (Caching) ─────────────────────────────┤
                                                     ▼
                                              WP07 (API & Tools)
                                                     │
                                                     ▼
                                              WP08 (Integration)
```

**Parallelization**: After WP01 completes, WP02/WP03/WP05 can all run in parallel. WP04 and WP06 run after WP03. WP05 and WP06 can run in parallel. WP07 requires all preceding WPs. WP08 requires everything.

## Summary

| WP | Title | Subtasks | Est. Lines | Priority |
|----|-------|----------|-----------|----------|
| WP01 | Profile Schema & Tenant Scoping | 7 (T001-T007) | ~500 | P0 |
| WP02 | Profile Access Control | 5 (T008-T012) | ~400 | P0 |
| WP03 | Profile Versioning | 5 (T013-T017) | ~450 | P1 |
| WP04 | Batch Ingestion Pipeline | 5 (T018-T022) | ~450 | P1 |
| WP05 | Profile Caching & Latency | 4 (T023-T026) | ~350 | P2 |
| WP06 | Engine Interface & Drift Retraining | 5 (T027-T031) | ~450 | P1 |
| WP07 | Profile API & MCP Tools | 9 (T032-T040) | ~550 | P1 |
| WP08 | Integration & Validation | 8 (T041-T048) | ~500 | P1 |

**Total**: 8 work packages, 48 subtasks
**MVP scope**: WP01 + WP02 + WP03 + WP07 (Schema + Access Control + Versioning + API = tenant-isolated profile management with versioning)
