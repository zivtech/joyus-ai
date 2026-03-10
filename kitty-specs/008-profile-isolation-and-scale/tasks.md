# Work Packages: Profile Isolation and Scale
*Feature 008 — Phase 2 task decomposition*

**Total**: 8 work packages, 41 subtasks
**Parallelization**: 6 layers — up to 2 WPs can run concurrently

## Dependency Graph

```
Layer 0: WP01 (foundation)
Layer 1: WP02, WP05 (parallel — both depend only on WP01)
Layer 2: WP03, WP04 (parallel — WP03 depends on WP02; WP04 depends on WP01)
Layer 3: WP06 (depends on WP04)
Layer 4: WP07 (depends on WP02-WP06)
Layer 5: WP08 (depends on all)
```

---

## Phase A: Foundation

### WP01 — Schema & Foundation
**Prompt**: [`tasks/WP01-schema-foundation.md`](tasks/WP01-schema-foundation.md)
**Priority**: P0 (blocks everything) | **Dependencies**: none | **Est. ~400 lines**

Create the Drizzle ORM schema for the `profiles` PostgreSQL schema (7 tables + 4 enums), tenant-scoped query helpers (Leash pattern), Zod validation schemas, shared TypeScript types, Drizzle migration, and wire exports into the existing db client.

**Subtasks**:
- [ ] T001: Create profiles Drizzle schema (`src/profiles/schema.ts`) — all 7 tables with pgSchema, enums, relations, indexes
- [ ] T002: Create shared TypeScript types and constants (`src/profiles/types.ts`)
- [ ] T003: Create Zod validation schemas (`src/profiles/validation.ts`)
- [ ] T004: Create tenant-scoped query helpers (`src/profiles/tenant-scope.ts`) — Leash pattern enforcement
- [ ] T005: Create Drizzle migration for `profiles` schema
- [ ] T006: Export profiles schema from `src/db/client.ts`

**Parallel opportunities**: T002 and T004 are independent. T003 depends on T001 + T002.
**Risks**: Drizzle `pgSchema` partial index syntax for `WHERE status = 'active'` may need raw SQL.

---

## Phase B: Generation & Intake Pipelines

### WP02 — Profile Generation Pipeline
**Prompt**: [`tasks/WP02-generation-pipeline.md`](tasks/WP02-generation-pipeline.md)
**Priority**: P1 | **Dependencies**: WP01 | **Est. ~450 lines**

Build the core pipeline: engine bridge to Spec 005 Python subprocess, corpus snapshot service, generation orchestrator, concurrent tenant execution, and pipeline status tracking.

**Subtasks**:
- [ ] T007: Create engine bridge (`src/profiles/generation/engine-bridge.ts`) — subprocess invocation of Spec 005 Python engine
- [ ] T008: Create corpus snapshot service (`src/profiles/generation/corpus-snapshot.ts`) — immutable snapshot creation from document sets
- [ ] T009: Create generation pipeline orchestrator (`src/profiles/generation/pipeline.ts`) — intake -> extract -> generate -> store
- [ ] T010: Add concurrent pipeline execution — tenant-isolated advisory locks
- [ ] T011: Add pipeline status tracking and structured logging

**Parallel opportunities**: T007 and T008 are independent (different files, same foundation). T009 depends on both.
**Risks**: Subprocess invocation latency may consume >60% of the 10-minute budget. If so, fallback to HTTP bridge (deferred item).

### WP05 — Self-Service Corpus Intake
**Prompt**: [`tasks/WP05-corpus-intake.md`](tasks/WP05-corpus-intake.md)
**Priority**: P2 | **Dependencies**: WP01 | **Est. ~450 lines**

Build the document upload pipeline: parser interface, PDF/DOCX/text parsers, content-hash deduplication, intake orchestrator, and unsupported format handling.

**Subtasks**:
- [ ] T022: Define document parser interface and registry (`src/profiles/intake/parsers/interface.ts`, `registry.ts`)
- [ ] T023: Implement PDF parser (`src/profiles/intake/parsers/pdf-parser.ts`) — pdf-parse wrapper
- [ ] T024: Implement DOCX parser (`src/profiles/intake/parsers/docx-parser.ts`) — mammoth wrapper
- [ ] T025: Implement TXT/HTML/Markdown passthrough parser (`src/profiles/intake/parsers/text-parser.ts`)
- [ ] T026: Create content-hash deduplication service (`src/profiles/intake/dedup.ts`)
- [ ] T027: Create intake orchestrator (`src/profiles/intake/service.ts`) — upload -> parse -> dedup -> snapshot -> queue
- [ ] T028: Add unsupported format handling and partial failure recovery

**Parallel opportunities**: T023, T024, T025 are independent (different files, same interface). T026 is independent of parsers.
**Risks**: pdf-parse text extraction quality varies across PDF generators. Normalize aggressively before hashing.

---

## Phase C: Versioning & Inheritance

### WP03 — Profile Versioning
**Prompt**: [`tasks/WP03-profile-versioning.md`](tasks/WP03-profile-versioning.md)
**Priority**: P1 | **Dependencies**: WP02 | **Est. ~400 lines**

Implement immutable version management: version creation with monotonic integers, atomic rollback, version history queries, retention policy enforcement, and version comparison.

**Subtasks**:
- [ ] T012: Create version creation service (`src/profiles/versioning/service.ts`) — immutable rows, monotonic version numbers
- [ ] T013: Implement atomic rollback — swap status fields in a transaction, all consumers switch
- [ ] T014: Implement version history queries (`src/profiles/versioning/history.ts`) — list versions with timestamps, corpus snapshots, fidelity
- [ ] T015: Implement retention policy enforcement — soft-delete after retention window, hard-delete after 30 days
- [ ] T016: Implement version comparison — feature vector delta between two versions

**Parallel opportunities**: T014 and T016 are independent query functions. T015 is independent background logic.
**Risks**: Atomic rollback must ensure no concurrent version creation races with the status swap. Use advisory locks.

### WP04 — Composite Profile Inheritance
**Prompt**: [`tasks/WP04-composite-inheritance.md`](tasks/WP04-composite-inheritance.md)
**Priority**: P2 | **Dependencies**: WP01 | **Est. ~450 lines**

Build three-tier inheritance: hierarchy management, nearest-ancestor-wins resolver, feature vector merging with override tracking, override source tracing, and cascade propagation.

**Subtasks**:
- [ ] T017: Create hierarchy management service (`src/profiles/inheritance/hierarchy.ts`) — CRUD for parent-child relationships
- [ ] T018: Create inheritance resolver (`src/profiles/inheritance/resolver.ts`) — walk chain, apply nearest-ancestor-wins
- [ ] T019: Implement feature vector merging (`src/profiles/inheritance/merge.ts`) — merge 129-feature vectors with override tracking
- [ ] T020: Implement override source tracing — resolved profile shows which tier provided each feature
- [ ] T021: Implement cascade propagation — ancestor update triggers downstream re-resolution

**Parallel opportunities**: T017 is independent CRUD. T019 is independent merge logic. T018 depends on both.
**Risks**: Fidelity degradation after inheritance must be <=5%. Validate with realistic feature vectors in tests.

---

## Phase D: Caching

### WP06 — Resolved Profile Caching
**Prompt**: [`tasks/WP06-profile-caching.md`](tasks/WP06-profile-caching.md)
**Priority**: P3 | **Dependencies**: WP04 | **Est. ~350 lines**

Build precomputed resolved profile cache with inheritance-aware invalidation and cache warming for large tenants.

**Subtasks**:
- [ ] T029: Create cache service (`src/profiles/cache/service.ts`) — store/retrieve resolved profiles, upsert semantics
- [ ] T030: Implement inheritance-aware invalidation (`src/profiles/cache/invalidation.ts`) — recursive CTE descendant walk
- [ ] T031: Implement cache warming — precompute resolved profiles for large tenants on profile change

**Parallel opportunities**: T029 and T030 are partially independent (T030 uses T029 for deletion).
**Risks**: Recursive CTE depth. Safety check: if chain exceeds 10 levels, invalidate all tenant caches.

---

## Phase E: Integration & Validation

### WP07 — MCP Tools & Integration
**Prompt**: [`tasks/WP07-mcp-tools-integration.md`](tasks/WP07-mcp-tools-integration.md)
**Priority**: P1 | **Dependencies**: WP02, WP03, WP04, WP05, WP06 | **Est. ~500 lines**

Implement MCP tools for profile operations, create the module entry point, mount profiles in the main server, and build cross-tenant isolation and edge case test suites.

**Subtasks**:
- [ ] T032: Create MCP tools for profile operations (`src/tools/profile-tools.ts`) — list, get, generate, rollback, history, intake, cache
- [ ] T033: Create module entry point (`src/profiles/index.ts`) — service initialization and route mounting
- [ ] T034: Extend main `src/index.ts` to mount profiles module
- [ ] T035: Create cross-tenant isolation regression tests (`tests/profiles/tenant-isolation.test.ts`)
- [ ] T036: Create edge case tests — tenant deletion, zero-doc corpus, single-author, no-author corpus

**Parallel opportunities**: T032 and T033 are independent. T035 and T036 are independent test suites.
**Risks**: Must match existing tool registration pattern exactly (ToolDefinition interface, prefix routing in executor).

### WP08 — Performance Validation
**Prompt**: [`tasks/WP08-performance-validation.md`](tasks/WP08-performance-validation.md)
**Priority**: P1 | **Dependencies**: WP01-WP07 | **Est. ~350 lines**

Validate all performance targets: generation timing, rollback speed, cache latency, concurrent pipeline stress test, and final typecheck/lint/test pass.

**Subtasks**:
- [ ] T037: Performance test — 50-document corpus generation within 10 minutes
- [ ] T038: Performance test — profile rollback within 30 seconds
- [ ] T039: Performance test — cached profile lookup <50ms p95
- [ ] T040: Concurrent pipeline stress test — 5 tenants generating simultaneously
- [ ] T041: Final validation — typecheck, lint, full test suite pass

**Parallel opportunities**: T037-T040 are independent performance tests. T041 must come last.
**Risks**: Performance targets depend on test environment hardware. Document baseline and environment.
