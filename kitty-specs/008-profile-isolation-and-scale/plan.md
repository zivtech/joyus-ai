# Implementation Plan: Profile Isolation and Scale

**Branch**: `008-profile-isolation-and-scale` | **Date**: 2026-03-14 | **Spec**: [spec.md](spec.md)
**Input**: Feature specification from `spec/008-profile-isolation-and-scale/spec.md`

---

## Summary

Build the platform layer in `joyus-ai` that wraps the Python profile engine with multi-tenant isolation, semantic versioning, caching, batch ingestion, and drift-triggered retraining. Eight tables in a new `profiles` PostgreSQL schema store profile metadata, versions, audit logs, and batch jobs. Access control is enforced via `assertProfileAccessOrAudit()` at every entry point. The profile engine remains a Python library — this layer governs access, lifecycle, and scale.

## Technical Context

**Language/Version**: TypeScript 5.x, Node.js 20 LTS
**Primary Dependencies**: Express.js, Drizzle ORM, Zod, `@paralleldrive/cuid2`
**Storage**: PostgreSQL 16 — new `profiles` schema (follows `content` schema pattern from Spec 006)
**Testing**: Vitest (unit + integration), existing test infrastructure
**Target Platform**: Linux server (Docker), same deployment as Spec 001
**Project Type**: Platform module within `joyus-ai` monorepo
**Performance Goals**: < 5ms cache hit, < 50ms DB fetch, >= 10 docs/sec batch ingestion
**Constraints**: No new infrastructure — runs in existing Express process; Python engine called via service interface
**Scale/Scope**: Hundreds of profiles per tenant, thousands of versions, millions of audit entries

## Constitution Check

*GATE: Must pass before implementation. Re-check after Phase A.*

| Principle | Status | Notes |
|-----------|--------|-------|
| 2.1 Multi-Tenant from Day One | **PASS** | `tenantId` on every table. `assertProfileAccessOrAudit()` enforces isolation. No single-tenant shortcuts. |
| 2.2 Skills as Guardrails | **PASS** | Profile operations exposed as MCP tools with tenant-scoped validation. |
| 2.3 Sandbox by Default | **PASS** | Cross-tenant access denied by default. Audit log captures all access attempts. |
| 2.4 Monitor Everything | **PASS** | Audit log (FR-003), staleness detection (FR-008), drift monitoring integration (FR-009). |
| 2.5 Feedback Loops | **PASS** | Drift-triggered retraining creates a closed loop: generate -> monitor -> retrain -> generate. |
| 3.2 Data Governance | **PASS** | Feature vectors stored in PostgreSQL with encryption at rest. Audit trail is append-only. |
| 5.1 Technology Choices | **PASS** | Express + Drizzle + PostgreSQL — matches existing platform stack. No new dependencies. |
| 5.2 Cost Awareness | **PASS** | In-memory LRU cache, no external cache service. Queue table in PostgreSQL, no message broker. |
| 5.3 Reliability | **PASS** | Cache degrades gracefully. Retraining failures don't corrupt current version. Batch jobs are resumable. |

No violations. All gates pass.

## Project Structure

### Documentation (this feature)

```
spec/008-profile-isolation-and-scale/
├── spec.md              # Feature specification
├── plan.md              # This file
├── tasks.md             # Task decomposition
├── tasks/               # WP prompt files (WP01-WP08)
├── checklists/          # Quality validation
└── research/            # Background research
```

### Source Code (in joyus-ai repository)

```
src/
├── profiles/
│   ├── schema.ts                # Drizzle schema — profiles pgSchema, 7 tables, 5 enums
│   ├── types.ts                 # Shared TypeScript types, constants, feature vector shape
│   ├── validation.ts            # Zod schemas for all profile inputs
│   ├── index.ts                 # Module barrel export + initialization
│   ├── access/
│   │   ├── guard.ts             # assertProfileAccessOrAudit() implementation
│   │   ├── audit.ts             # Audit log writer and query helpers
│   │   ├── errors.ts            # ProfileAccessDeniedError, ProfileNotFoundError
│   │   └── index.ts             # Access module barrel
│   ├── versioning/
│   │   ├── manager.ts           # Version creation, pinning, currentVersion updates
│   │   ├── diff.ts              # Feature vector diff engine
│   │   ├── staleness.ts         # Staleness detection logic
│   │   └── index.ts             # Versioning module barrel
│   ├── ingestion/
│   │   ├── batch.ts             # Batch ingestion pipeline (queue, progress, cancel)
│   │   ├── processor.ts         # Single-document feature extraction wrapper
│   │   └── index.ts             # Ingestion module barrel
│   ├── cache/
│   │   ├── lru.ts               # LRU cache with TTL and stampede protection
│   │   └── index.ts             # Cache module barrel
│   ├── engine/
│   │   ├── interface.ts         # ProfileEngineClient interface + FeatureVector type
│   │   ├── null-client.ts       # NullProfileEngineClient stub
│   │   └── index.ts             # Engine module barrel
│   ├── retraining/
│   │   ├── listener.ts          # Drift event listener, retraining job enqueue
│   │   ├── worker.ts            # Retraining job processor (advisory lock, version creation)
│   │   └── index.ts             # Retraining module barrel
│   ├── routes.ts                # Express API routes (10 endpoints)
│   └── tools.ts                 # MCP tool definitions (7 tools)
│
├── tools/
│   └── profile-tools.ts         # Profile MCP tools registration (or inline in profiles/tools.ts)
│
tests/
├── profiles/
│   ├── access/
│   │   ├── guard.test.ts
│   │   └── audit.test.ts
│   ├── versioning/
│   │   ├── manager.test.ts
│   │   ├── diff.test.ts
│   │   └── staleness.test.ts
│   ├── ingestion/
│   │   └── batch.test.ts
│   ├── cache/
│   │   └── lru.test.ts
│   ├── retraining/
│   │   └── listener.test.ts
│   ├── routes.test.ts
│   └── integration/
│       ├── tenant-isolation.test.ts
│       ├── version-lifecycle.test.ts
│       └── drift-retraining.test.ts
│
drizzle/
└── <timestamp>_profiles_schema.sql  # Generated migration
```

**Structure Decision**: Module follows the established `src/content/` pattern from Spec 006 — dedicated directory with schema, types, validation, submodules, routes, and tools. Uses `pgSchema('profiles')` for namespace isolation. Access control is extracted into its own submodule because it is the single most critical piece of this feature.

## Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                    joyus-ai Express Server                       │
│                                                                  │
│  ┌───────────────────────────────────────────────────────────┐  │
│  │                  Profile Module (src/profiles/)            │  │
│  │                                                            │  │
│  │  ┌─────────────┐  ┌──────────────┐  ┌──────────────────┐ │  │
│  │  │ API Routes   │  │  MCP Tools   │  │  Event Listener  │ │  │
│  │  │ (routes.ts)  │  │ (tools.ts)   │  │ (listener.ts)    │ │  │
│  │  └──────┬───────┘  └──────┬───────┘  └────────┬─────────┘ │  │
│  │         │                 │                    │            │  │
│  │         ▼                 ▼                    ▼            │  │
│  │  ┌──────────────────────────────────────────────────────┐  │  │
│  │  │          assertProfileAccessOrAudit()                 │  │  │
│  │  │          (access/guard.ts)                            │  │  │
│  │  └──────────────────────┬───────────────────────────────┘  │  │
│  │                         │                                   │  │
│  │         ┌───────────────┼───────────────┐                  │  │
│  │         ▼               ▼               ▼                  │  │
│  │  ┌────────────┐  ┌───────────┐  ┌─────────────────┐       │  │
│  │  │ Versioning │  │ Ingestion │  │   Retraining    │       │  │
│  │  │ (manager,  │  │ (batch,   │  │ (listener,      │       │  │
│  │  │  diff,     │  │  process) │  │  worker)        │       │  │
│  │  │  staleness)│  │           │  │                  │       │  │
│  │  └──────┬─────┘  └─────┬─────┘  └────────┬────────┘       │  │
│  │         │               │                 │                 │  │
│  │         ▼               ▼                 ▼                 │  │
│  │  ┌────────────────────────────────────────────────────┐    │  │
│  │  │              Profile Cache (LRU)                    │    │  │
│  │  │              cache/lru.ts                           │    │  │
│  │  └──────────────────────┬─────────────────────────────┘    │  │
│  │                         │                                   │  │
│  │                         ▼                                   │  │
│  │  ┌────────────────────────────────────────────────────┐    │  │
│  │  │         PostgreSQL (profiles schema)                │    │  │
│  │  │  profiles | versions | audit_log | batch_jobs       │    │  │
│  │  │  version_pins | feature_vectors | job_documents     │    │  │
│  │  └──────────────────────┬─────────────────────────────┘    │  │
│  │                         │                                   │  │
│  └─────────────────────────┼───────────────────────────────┘  │
│                            │                                    │
│                            ▼                                    │
│  ┌──────────────────────────────────────────────────────────┐  │
│  │          ProfileEngineClient Interface                     │  │
│  │  (engine/interface.ts)                                     │  │
│  │                                                            │  │
│  │  ┌─────────────────┐  ┌─────────────────────────────┐    │  │
│  │  │ NullClient      │  │ Real Client (future)         │    │  │
│  │  │ (dev/test)      │  │ (subprocess / HTTP to Python)│    │  │
│  │  └─────────────────┘  └─────────────────────────────┘    │  │
│  └──────────────────────────────────────────────────────────┘  │
│                                                                  │
│  Integration Points:                                             │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────────────┐  │
│  │ Spec 005     │  │ Spec 006     │  │ Spec 009             │  │
│  │ Drift Monitor│  │ Content Infra│  │ Pipeline Framework   │  │
│  │ (emits drift │  │ (profileId   │  │ (profile_generation  │  │
│  │  events)     │  │  references) │  │  step handler)       │  │
│  └──────────────┘  └──────────────┘  └──────────────────────┘  │
└─────────────────────────────────────────────────────────────────┘
```

## Phase Breakdown

### Phase A: Foundation (WP01-WP02)
Schema, types, validation, access control, and audit logging. This is the security-critical foundation — nothing proceeds until tenant isolation is proven.

### Phase B: Profile Lifecycle (WP03-WP04)
Versioning (create, pin, diff, staleness) and batch ingestion pipeline. These are the core value propositions of the feature.

### Phase C: Performance & Resilience (WP05-WP06)
Caching layer and drift-triggered retraining. These optimize the foundation and close the feedback loop with Spec 005.

### Phase D: API & Integration (WP07-WP08)
Express routes, MCP tools, and end-to-end integration tests. These expose the feature to users and validate everything works together.

## Security Considerations

1. **Tenant isolation is enforced at the guard layer, not the route layer.** Routes call `assertProfileAccessOrAudit()` which hits the DB to verify ownership. This means even if a new code path is added that skips route-level checks, the guard catches it.

2. **Audit log is append-only.** The `profile_audit_log` table has no UPDATE or DELETE operations in application code. This is enforced by the audit writer interface (only `logAccess` and `logDenial` methods).

3. **Feature vectors are sensitive.** They represent a fingerprint of an author's writing style. Stored in PostgreSQL JSONB, encrypted at rest via PostgreSQL's disk-level encryption. No feature vectors are returned in API responses — only metadata and diff summaries.

4. **Advisory locks prevent retraining races.** Two concurrent drift events for the same profile don't create two versions. `pg_advisory_xact_lock(hashCode(profileId))` serializes retraining within a transaction.

5. **Batch ingestion validates document ownership.** Before extracting features from a document, verify the document belongs to the same tenant as the profile being trained. This prevents a tenant from training a profile on another tenant's documents.

## Future Considerations (Not in Scope)

- **Real-time streaming ingestion**: Profile training from live content streams rather than batch
- **Profile templates**: Pre-built voice profiles (e.g., "formal business", "casual blog") as starting points
- **Cross-tenant sharing**: Explicit consent-based profile sharing between tenants
- **Profile engine hot-swap**: Ability to switch between profile engine implementations without retraining
- **Feature vector search**: Find profiles similar to a given writing sample (nearest-neighbor on feature vectors)

## Complexity Tracking

No Constitution violations. All principles pass without exception.
