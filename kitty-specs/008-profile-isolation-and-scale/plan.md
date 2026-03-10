# Implementation Plan: Profile Isolation and Scale
*Path: [kitty-specs/008-profile-isolation-and-scale/plan.md](kitty-specs/008-profile-isolation-and-scale/plan.md)*

**Branch**: `008-profile-isolation-and-scale` | **Date**: 2026-03-10 | **Spec**: [spec.md](spec.md)
**Input**: Feature specification from `/kitty-specs/008-profile-isolation-and-scale/spec.md`

## Summary

Add multi-tenant profile isolation, versioning, composite inheritance, self-service corpus intake, and resolved-profile caching to the Joyus AI platform. All new code extends the existing `joyus-ai-mcp-server` package (TypeScript/Express) as a new `src/profiles/` module, parallel to the existing `src/content/` module. Profile data lives in a schema-separated PostgreSQL `profiles` schema via Drizzle ORM. Profile generation delegates to Spec 005's stable Python stylometric engine via subprocess invocation. Tenant isolation follows the Leash pattern (ADR-0002): mandatory `tenant_id` filtering on every query, injected from authenticated session context, never from user input.

## Technical Context

**Language/Version**: TypeScript 5.3+, Node.js >=20.0.0
**Primary Dependencies**: Express 4.x, Drizzle ORM 0.45+, @modelcontextprotocol/sdk 1.x, pg 8.x, Zod (schema validation), pdf-parse (PDF extraction), mammoth (DOCX extraction)
**Storage**: PostgreSQL (same instance as existing MCP server, schema-separated via `profiles` pgSchema)
**External**: Spec 005 Python stylometric engine (subprocess invocation via `child_process.execFile`)
**Testing**: Vitest 1.x (unit + integration), existing `validate` script (`typecheck && lint && test`)
**Target Platform**: Linux server (Docker), macOS development
**Project Type**: Single package extension (`joyus-ai-mcp-server/`)
**Performance Goals**: Profile generation <=10 min for 50-doc corpus, rollback <=30s, cached profile lookup <50ms p95
**Constraints**: Batch pipeline only (no streaming profile updates), soft tenant isolation (application-scoped tenant_id per ADR-0002), Spec 005 engine is stable and unchanged
**Scale/Scope**: <=500 documents and <=30 authors per tenant (initial cohort), profile versions retained >=90 days

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| Principle | Status | Notes |
|-----------|--------|-------|
| §2.1 Multi-Tenant from Day One | PASS | All profile tables carry `tenant_id`. Every query filters by tenant context from authenticated session. Leash pattern (ADR-0002) enforced at the service layer — tenant_id is never accepted from user input. |
| §2.2 Skills as Encoded Knowledge | PASS | Profiles are the input to skill generation. Profile versioning ensures skill files are traceable to a specific corpus snapshot and profile version. |
| §2.3 Sandbox by Default | PASS | New tenants start with zero profiles. Profile data is inaccessible to other tenants at the data layer (tenant_id scoping on all queries). Default: no cross-tenant access. |
| §2.4 Monitor Everything | PASS | Structured logging for all profile operations (generation, rollback, inheritance resolution, intake). Operation logs track duration, success/failure, and tenant context. |
| §2.5 Feedback Loops | PASS | Profile versioning enables comparison between versions. Fidelity scores at generation time provide quantitative feedback. Rollback is the corrective action when fidelity degrades. |
| §2.6 Mediated AI Access | PASS | Profile generation is a platform-mediated pipeline, not direct AI access. The stylometric engine runs server-side; users interact via intake API. |
| §2.7 Automated Pipelines | PASS | Profile generation pipelines are automated pipeline citizens. Corpus intake triggers profile generation without manual intervention. Spec 009 will consume profile-change events from this feature. |
| §2.8 Open Source | PASS | Profile isolation infrastructure is platform core — lives in public repo. No client data in code, schemas, or test fixtures. Generic examples only (Author A, Example Org). |
| §2.9 Assumption Awareness | PASS | Corpus snapshots capture what data informed each profile version. Fidelity scores track assumption quality. Version history provides audit trail for when assumptions change. |
| §2.10 Client-Informed, Platform-Generic | PASS | All examples use generic terms. Profile tiers and inheritance are configurable per tenant, not hardcoded to any client's org structure. |
| §3.1 Data Governance | PASS | Corpus documents carry data tier classification (inherited from content infrastructure). Profile data respects tier restrictions. |
| §3.2 Compliance Framework Awareness | PASS | Profile generation respects tenant compliance framework declarations. Corpus retention follows tenant-configured retention policies. |
| §3.3 Non-Negotiables | PASS | Audit trail for all profile operations (generation, rollback, version changes). Corpus data never used for model training. Profile versions are immutable — no silent mutations. |

**Post-design re-check**: All principles remain satisfied. The `profiles` schema separation reinforces tenant isolation (§2.1, §2.3). The immutable version model ensures auditability (§3.3). The subprocess boundary with Spec 005 keeps the stylometric engine stable (§2.2).

## Project Structure

### Documentation (this feature)

```
kitty-specs/008-profile-isolation-and-scale/
├── plan.md              # This file
├── research.md          # Phase 0 output
├── data-model.md        # Phase 1 output
├── spec.md              # Feature specification
├── checklists/          # Phase gates
├── research/            # Research artifacts
└── tasks/               # Phase 2 output (NOT created by /spec-kitty.plan)
    └── README.md        # Task tracking placeholder
```

### Source Code (repository root)

```
joyus-ai-mcp-server/
├── src/
│   ├── profiles/                      # NEW — Profile isolation & scale
│   │   ├── index.ts                  # Module entry point (init + route mount)
│   │   ├── schema.ts                 # Drizzle schema (pgSchema 'profiles')
│   │   ├── types.ts                  # Shared types & constants
│   │   ├── validation.ts             # Zod input schemas
│   │   ├── tenant-scope.ts           # Tenant-scoped query helpers (Leash pattern)
│   │   ├── generation/               # Profile generation pipeline
│   │   │   ├── pipeline.ts           # Orchestrator: intake → extract → generate → store
│   │   │   ├── engine-bridge.ts      # Subprocess bridge to Spec 005 Python engine
│   │   │   └── corpus-snapshot.ts    # Corpus snapshot creation & management
│   │   ├── versioning/               # Profile version lifecycle
│   │   │   ├── service.ts            # Version creation, rollback, retention
│   │   │   └── history.ts            # Version history queries & comparisons
│   │   ├── inheritance/              # Composite profile inheritance
│   │   │   ├── resolver.ts           # Inheritance chain resolution (nearest-ancestor-wins)
│   │   │   ├── hierarchy.ts          # Hierarchy management (org > dept > individual)
│   │   │   └── merge.ts             # Feature vector merging strategies
│   │   ├── intake/                   # Self-service corpus intake
│   │   │   ├── service.ts            # Upload orchestration & deduplication
│   │   │   ├── parsers/              # Document format parsers
│   │   │   │   ├── interface.ts      # DocumentParser interface
│   │   │   │   ├── pdf-parser.ts     # PDF text extraction
│   │   │   │   ├── docx-parser.ts    # DOCX text extraction
│   │   │   │   ├── text-parser.ts    # TXT/HTML/Markdown passthrough
│   │   │   │   └── registry.ts       # Parser registration & format detection
│   │   │   └── dedup.ts             # Content-hash deduplication
│   │   ├── cache/                    # Resolved profile caching
│   │   │   ├── service.ts            # Cache read/write with TTL
│   │   │   └── invalidation.ts       # Inheritance-aware cache invalidation
│   │   └── monitoring/               # Profile operation observability
│   │       ├── logger.ts             # Structured profile operation logger
│   │       └── metrics.ts            # Profile-specific metrics
│   ├── tools/
│   │   ├── profile-tools.ts          # NEW — MCP tools for profile operations
│   │   └── ... (existing tools unchanged)
│   ├── db/
│   │   ├── client.ts                 # EXTEND — import + export profiles schema
│   │   └── schema.ts                 # UNCHANGED — existing tables
│   ├── content/                      # UNCHANGED — existing content infrastructure
│   └── ... (existing auth, scheduler, exports, index.ts — extend to mount profiles)
├── tests/
│   ├── profiles/                      # NEW — Profile isolation tests
│   │   ├── generation/
│   │   ├── versioning/
│   │   ├── inheritance/
│   │   ├── intake/
│   │   ├── cache/
│   │   └── tenant-isolation.test.ts   # Cross-tenant isolation regression tests
│   └── ... (existing tests unchanged)
└── drizzle/                           # Migration files (auto-generated)
```

**Structure Decision**: Extend the existing `joyus-ai-mcp-server` package with a new `src/profiles/` module, following the same pattern as `src/content/`. All profile isolation logic lives under this single namespace. The `profiles` PostgreSQL schema keeps tables physically separated from both existing `public` and `content` schema tables. No new packages or projects are required.

## Work Breakdown

### Phase 0 — Research (1–2 days)

Research topics documented in [research.md](research.md):

| ID | Topic | Decision needed |
|----|-------|----------------|
| R1 | Drizzle ORM multi-tenant patterns | How to enforce tenant_id scoping at the query builder level (middleware vs. helper vs. wrapper) |
| R2 | Profile versioning strategies | Immutable append-only vs. copy-on-write for 129-feature vectors |
| R3 | Composite profile inheritance resolution | Nearest-ancestor-wins merge strategy for feature vectors |
| R4 | Document format parsing libraries | pdf-parse vs. pdf.js, mammoth vs. docx, performance + license |
| R5 | Cache invalidation for hierarchical data | Strategies for invalidating descendant caches on ancestor profile update |

**Exit criteria**: All 5 decisions documented in research.md with rationale and alternatives considered.

### Phase 1 — Data Model & Interfaces (2–3 days)

Design the `profiles` schema and service interfaces.

| ID | Deliverable | Depends on |
|----|------------|------------|
| 1.1 | `profiles` pgSchema with all tables (data-model.md → schema.ts) | R1, R2 |
| 1.2 | Tenant-scoped query helpers (`tenant-scope.ts`) | R1 |
| 1.3 | Zod validation schemas (`validation.ts`) | 1.1 |
| 1.4 | Shared types and constants (`types.ts`) | 1.1 |
| 1.5 | Drizzle migration for `profiles` schema creation | 1.1 |
| 1.6 | Extend `db/client.ts` to import profiles schema | 1.1 |

**Exit criteria**: Schema compiles, migration runs against empty database, types are exported, tenant-scope helpers have unit tests.

### Phase 2 — Profile Generation Pipeline (3–4 days)

Core pipeline: corpus intake → snapshot → engine invocation → versioned profile storage.

| ID | Deliverable | Depends on | FR |
|----|------------|------------|-----|
| 2.1 | Engine bridge (`engine-bridge.ts`) — subprocess invocation of Spec 005 Python engine | Phase 1 | FR-002 |
| 2.2 | Corpus snapshot service (`corpus-snapshot.ts`) — create immutable snapshots from document sets | Phase 1 | FR-007 |
| 2.3 | Generation pipeline orchestrator (`pipeline.ts`) — intake → extract → generate → store | 2.1, 2.2 | FR-001, FR-002, FR-010 |
| 2.4 | Concurrent pipeline execution — tenant-isolated, non-contending | 2.3 | FR-010 |
| 2.5 | Pipeline status tracking and structured logging | 2.3 | — |

**Exit criteria**: A 50-document corpus can be ingested and produce versioned profiles for 3 authors within 10 minutes. Two concurrent tenant pipelines complete independently with correct results. All profile data is scoped to the correct tenant.

### Phase 3 — Profile Versioning (2–3 days)

Immutable version management with rollback support.

| ID | Deliverable | Depends on | FR |
|----|------------|------------|-----|
| 3.1 | Version creation service — immutable rows with monotonic version numbers | Phase 2 | FR-003 |
| 3.2 | Atomic rollback — switch active pointer, all consumers see old version | 3.1 | FR-004 |
| 3.3 | Version history queries — list versions with timestamps, corpus snapshots, fidelity scores | 3.1 | FR-009 |
| 3.4 | Retention policy enforcement — soft-delete after retention window, hard-delete after 30 days | 3.1 | FR-009 |
| 3.5 | Version comparison — diff between two profile versions (feature vector delta) | 3.1 | — |

**Exit criteria**: Profile generation creates version N+1 without mutating version N. Rollback completes in <30 seconds and all downstream queries return the rolled-back version. Version history for 5 versions is queryable with all metadata. Retention policy correctly soft-deletes expired versions.

### Phase 4 — Composite Profile Inheritance (3–4 days)

Three-tier inheritance: org > department > individual.

| ID | Deliverable | Depends on | FR |
|----|------------|------------|-----|
| 4.1 | Hierarchy management service — create/update parent-child relationships | Phase 1 | FR-005 |
| 4.2 | Inheritance resolver — walk the chain, apply nearest-ancestor-wins merging | 4.1 | FR-005 |
| 4.3 | Feature vector merging — merge 129-feature vectors with override tracking | 4.2 | FR-005, NFR-005 |
| 4.4 | Override source tracing — resolved profile shows which tier each feature came from | 4.2 | FR-005 |
| 4.5 | Cascade propagation — org profile update triggers downstream re-resolution | 4.2 | FR-005 |

**Exit criteria**: A three-tier hierarchy (org > dept > individual) resolves correctly. Department overrides of org features are reflected in the resolved individual profile. Override source is traceable for every feature. Fidelity degradation after inheritance resolution is <=5% vs. standalone.

### Phase 5 — Self-Service Corpus Intake (2–3 days)

Document upload, parsing, deduplication, and pipeline trigger.

| ID | Deliverable | Depends on | FR |
|----|------------|------------|-----|
| 5.1 | Document parser interface and registry | — | FR-006 |
| 5.2 | PDF parser (`pdf-parse` wrapper) | 5.1 | FR-006 |
| 5.3 | DOCX parser (`mammoth` wrapper) | 5.1 | FR-006 |
| 5.4 | TXT/HTML/Markdown passthrough parser | 5.1 | FR-006 |
| 5.5 | Content-hash deduplication service | Phase 1 | FR-007 |
| 5.6 | Intake orchestrator — upload → parse → dedup → snapshot → queue generation | 5.1–5.5, Phase 2 | FR-006, FR-007 |
| 5.7 | Unsupported format handling — reject bad files, continue good ones | 5.1 | FR-006 |

**Exit criteria**: A mixed-format upload (PDF, DOCX, TXT, HTML, Markdown) is ingested with 2 duplicates correctly detected. Unsupported formats are rejected with clear errors without blocking valid files. Author metadata is extracted or prompted for. Intake completes with <=2 manual interventions for a 100-document upload.

### Phase 6 — Resolved Profile Caching (1–2 days)

Precomputed resolved profiles with inheritance-aware invalidation.

| ID | Deliverable | Depends on | FR |
|----|------------|------------|-----|
| 6.1 | Cache service — store resolved profiles with TTL | Phase 4 | FR-008 |
| 6.2 | Inheritance-aware invalidation — invalidate descendant caches when ancestor updates | 6.1 | FR-008 |
| 6.3 | Cache warming — precompute resolved profiles for large tenants on profile change | 6.1 | FR-008 |

**Exit criteria**: Cached resolved profile lookups return in <50ms at p95. Cache invalidation triggers correctly on any upstream change. Stale cache entries are never served after invalidation.

### Phase 7 — MCP Tools & Integration (2–3 days)

Platform integration: MCP tools, module initialization, route mounting.

| ID | Deliverable | Depends on | FR |
|----|------------|------------|-----|
| 7.1 | MCP tools for profile operations (list, get, generate, rollback, version history) | Phases 2–6 | — |
| 7.2 | Module entry point (`index.ts`) — service initialization and route mounting | Phases 2–6 | — |
| 7.3 | Extend main `index.ts` to mount profiles module (same pattern as content module) | 7.2 | — |
| 7.4 | Cross-tenant isolation regression test suite | All phases | FR-001, FR-002 |
| 7.5 | Edge case tests: tenant deletion (soft-delete), zero-document corpus, single-author corpus, no-author corpus | All phases | — |

**Exit criteria**: All MCP tools function correctly. Module initializes without errors. Cross-tenant isolation test suite passes 10,000 queries with zero leaks. Edge cases produce correct behavior (clear errors, low-confidence flags, deferred generation).

### Phase 8 — Performance Validation & Hardening (1–2 days)

| ID | Deliverable | Depends on |
|----|------------|------------|
| 8.1 | Performance test: 50-document corpus generation within 10 minutes | Phase 2 |
| 8.2 | Performance test: rollback within 30 seconds | Phase 3 |
| 8.3 | Performance test: cached profile lookup <50ms p95 | Phase 6 |
| 8.4 | Concurrent pipeline stress test: 5 tenants generating simultaneously | Phase 2 |
| 8.5 | Final typecheck, lint, full test suite pass | All phases |

**Exit criteria**: All success criteria from spec met. All tests pass. Zero type errors. Zero lint violations.

## Estimated Total: 17–24 days

| Phase | Days | Priority |
|-------|------|----------|
| Phase 0 — Research | 1–2 | — |
| Phase 1 — Data Model & Interfaces | 2–3 | P1 |
| Phase 2 — Profile Generation Pipeline | 3–4 | P1 |
| Phase 3 — Profile Versioning | 2–3 | P1 |
| Phase 4 — Composite Profile Inheritance | 3–4 | P2 |
| Phase 5 — Self-Service Corpus Intake | 2–3 | P2 |
| Phase 6 — Resolved Profile Caching | 1–2 | P3 |
| Phase 7 — MCP Tools & Integration | 2–3 | P1 |
| Phase 8 — Performance Validation | 1–2 | P1 |

**Critical path**: Phase 0 → Phase 1 → Phase 2 → Phase 3 → Phase 7 → Phase 8. Phases 4 and 5 can proceed in parallel after Phase 1. Phase 6 depends on Phase 4.

## Risks

| Risk | Likelihood | Impact | Mitigation |
|------|-----------|--------|------------|
| Spec 005 Python engine subprocess invocation adds latency beyond 10-minute budget | Medium | High | Profile the subprocess call early in Phase 2. If too slow, switch to HTTP bridge with a lightweight Flask wrapper around the engine. Budget 60% of the 10-minute window for the engine, 40% for orchestration overhead. |
| Inheritance resolution at three tiers causes >5% fidelity degradation | Low | High | The 5% threshold is generous for nearest-ancestor-wins merging. Validate empirically in Phase 4 with real feature vectors. If violated, offer per-feature override granularity rather than tier-level overrides. |
| Concurrent pipeline execution contends on shared database resources | Medium | Medium | Use advisory locks (`pg_advisory_xact_lock`) per tenant during profile writes. Pipelines for different tenants cannot contend on the same lock. Performance degradation is acceptable per FR-010; data corruption is not. |
| Document parser libraries produce inconsistent text extraction across formats | Medium | Low | Normalize all extracted text (strip excessive whitespace, normalize Unicode) before hashing and before passing to the stylometric engine. Add per-parser integration tests with known-good reference documents. |
| Cache invalidation misses a descendant when hierarchy is deep (>3 levels) | Low | Medium | Initial scope is 3 tiers (spec requirement). Invalidation walks the `parent_profile_id` chain recursively. Add a safety check: if chain depth exceeds 10, log a warning and invalidate all cached profiles for the tenant. |

## Exit Criteria (Feature Complete)

- [ ] All 10 functional requirements (FR-001 through FR-010) implemented and tested
- [ ] All 5 non-functional requirements (NFR-001 through NFR-005) validated
- [ ] All 6 success criteria (SC-001 through SC-006) passing
- [ ] Cross-tenant isolation: 10,000 queries with zero data leaks
- [ ] Edge cases: tenant deletion, zero-document, single-author, no-author all handled
- [ ] typecheck, lint, and full test suite pass
- [ ] Profile generation pipeline produces correct results for two concurrent tenants with overlapping author names
- [ ] Spec 009 integration point: corpus-change events are emittable (event schema defined, emission point exists in the generation pipeline)

## Deferred Items

| Item | Reason | Tracked |
|------|--------|---------|
| Hard tenant isolation (separate schemas/databases) | Soft isolation via tenant_id is sufficient for initial scale. Revisit if regulatory requirements demand physical separation. | Spec assumption |
| Real-time streaming profile updates | Batch pipeline only per spec. Stream-on-change deferred to future iteration if latency requirements tighten. | Spec out-of-scope |
| Cross-tenant profile sharing / marketplace | Explicitly out of scope. No mechanism for profile data to cross tenant boundaries. | Spec out-of-scope |
| Profile export/import between instances | Deferred to future portability work. | Spec out-of-scope |
| HTTP bridge to Spec 005 engine | Subprocess invocation is the initial approach. If latency is unacceptable, wrap the engine in a lightweight HTTP service. | Risk mitigation |
| Spec 009 pipeline consumer | This feature emits corpus-change events. Spec 009 builds the pipeline consumer. | Spec 009 |

## Complexity Tracking

*No constitution violations requiring justification.*

No additional complexity beyond what the spec requires. The `profiles` pgSchema mirrors the pattern established by `content` pgSchema (Feature 006). The tenant-scoped query helpers (Leash pattern) are a thin utility layer, not a framework — they enforce what the constitution requires (§2.1, §2.3). The subprocess bridge to Spec 005 is the lightest integration that avoids modifying the stable Python engine.
