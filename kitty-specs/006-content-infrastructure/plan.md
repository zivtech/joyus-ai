# Implementation Plan: Content Infrastructure
*Path: [kitty-specs/006-content-infrastructure/plan.md](kitty-specs/006-content-infrastructure/plan.md)*

**Branch**: `006-content-infrastructure` | **Date**: 2026-02-21 | **Spec**: [spec.md](spec.md)
**Input**: Feature specification from `/kitty-specs/006-content-infrastructure/spec.md`

## Summary

Build the content infrastructure layer for the Joyus AI platform: pluggable content source connectors (database + REST/GraphQL API), unified search with entitlement filtering, CRM-driven access resolution, content-aware AI generation with voice profiles and citations, background voice drift monitoring, and a bot mediation API with two-layer authentication. All new code extends the existing `joyus-ai-mcp-server` package (TypeScript/Express), storing content metadata in a schema-separated PostgreSQL `content` schema via Drizzle ORM, with PostgreSQL full-text search behind a swappable provider abstraction.

## Technical Context

**Language/Version**: TypeScript 5.3+, Node.js >=20.0.0
**Primary Dependencies**: Express 4.x, Drizzle ORM 0.45+, @modelcontextprotocol/sdk 1.x, pg 8.x, axios 1.x, Zod (new — schema validation)
**Storage**: PostgreSQL (same instance as existing MCP server, schema-separated via `content` pgSchema)
**Testing**: Vitest 1.x (unit + integration), existing `validate` script (`typecheck && lint && test`)
**Target Platform**: Linux server (Docker), macOS development
**Project Type**: Single package extension (`joyus-ai-mcp-server/`)
**Performance Goals**: Search <2s, entitlement resolution <500ms, 100 concurrent mediation sessions
**Constraints**: Batch sync only (no streaming/CDC), English only, platform team builds all connectors
**Scale/Scope**: 50,000–500,000 items per content source, incremental batch indexing

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| Principle | Status | Notes |
|-----------|--------|-------|
| §2.1 Multi-Tenant from Day One | PASS | Content sources, products, and entitlements are tenant-scoped. All queries filter by tenant context. |
| §2.2 Skills as Encoded Knowledge | PASS | Voice profiles consumed from profile engine (Feature 005) via pluggable interface. |
| §2.3 Sandbox by Default | PASS | Entitlement filtering enforced before search results or generated content returned. Default: no access. |
| §2.4 Monitor Everything | PASS | Structured logging for all content operations; health/metrics endpoints for observability. |
| §2.5 Feedback Loops | PASS | Drift monitoring captures voice deviations; corrections flow back to profile updates. |
| §2.6 Mediated AI Access | PASS | Bot mediation API provides controlled, model-agnostic content access. |
| §2.7 Automated Pipelines | PASS | Scheduled sync and background drift monitoring are automated pipeline citizens. |
| §2.8 Open Source | PASS | Content infrastructure is platform core — lives in public repo. No client data in artifacts. |
| §2.10 Client-Informed, Platform-Generic | PASS | All examples use generic terms (Author A, Example Corp). No client names or domain jargon. |
| §3.1 Data Governance | PASS | Content items carry data tier classification; access respects tier restrictions. |
| §3.2 Compliance Framework Awareness | PASS | Entitlement resolver respects compliance framework declarations on tenant config. |
| §3.3 Non-Negotiables | PASS | Audit trail for all content operations. No organizational data used for training. |

**Post-design re-check**: All principles remain satisfied. The `content` schema separation reinforces tenant isolation (§2.1, §2.3). The pluggable connector/resolver/search interfaces align with platform extensibility (§2.8).

## Project Structure

### Documentation (this feature)

```
kitty-specs/006-content-infrastructure/
├── plan.md              # This file
├── research.md          # Phase 0 output
├── data-model.md        # Phase 1 output
├── quickstart.md        # Phase 1 output
├── contracts/           # Phase 1 output
│   ├── content-tools.yaml    # MCP tool contracts
│   ├── mediation-api.yaml    # Bot mediation REST API
│   └── internal-services.yaml # Internal service interfaces
└── tasks.md             # Phase 2 output (NOT created by /spec-kitty.plan)
```

### Source Code (repository root)

```
joyus-ai-mcp-server/
├── src/
│   ├── content/                     # NEW — Content infrastructure
│   │   ├── connectors/              # Pluggable connector abstraction
│   │   │   ├── interface.ts         # ContentConnector interface + types
│   │   │   ├── database-connector.ts # Relational DB connector (PG/MySQL)
│   │   │   ├── api-connector.ts     # REST/GraphQL API connector
│   │   │   └── registry.ts         # Connector registration + factory
│   │   ├── search/                  # Search abstraction
│   │   │   ├── interface.ts         # SearchProvider interface
│   │   │   ├── pg-fts-provider.ts   # PostgreSQL FTS implementation
│   │   │   └── index.ts            # Search service (entitlement-filtered)
│   │   ├── entitlements/            # Access resolution
│   │   │   ├── interface.ts         # EntitlementResolver interface
│   │   │   ├── http-resolver.ts     # Generic HTTP resolver
│   │   │   ├── cache.ts            # Session-scoped entitlement cache
│   │   │   └── index.ts            # Entitlement service
│   │   ├── generation/              # Content-aware AI generation
│   │   │   ├── retriever.ts         # Content retrieval + context building
│   │   │   ├── generator.ts         # Voice-consistent generation
│   │   │   └── citations.ts        # Source citation management
│   │   ├── sync/                    # Sync engine
│   │   │   ├── engine.ts           # Batch sync orchestrator
│   │   │   ├── scheduler.ts        # Scheduled sync jobs
│   │   │   └── state.ts            # Content state tracking + freshness
│   │   ├── monitoring/              # Drift monitoring + observability
│   │   │   ├── drift.ts            # Background voice drift monitor
│   │   │   ├── logger.ts           # Structured content operation logger
│   │   │   └── metrics.ts          # Health + metrics endpoint handlers
│   │   ├── mediation/               # Bot mediation API
│   │   │   ├── router.ts           # Mediation HTTP routes
│   │   │   ├── auth.ts             # Two-layer auth (API key + OAuth2/OIDC)
│   │   │   └── session.ts          # Mediation session management
│   │   └── schema.ts               # Content schema (Drizzle, pgSchema 'content')
│   ├── tools/
│   │   ├── content-tools.ts         # NEW — MCP tools for content operations
│   │   └── ... (existing tools unchanged)
│   ├── db/
│   │   ├── client.ts               # EXTEND — export content schema tables
│   │   └── schema.ts               # UNCHANGED — existing tables
│   └── ... (existing auth, scheduler, exports, index.ts unchanged)
├── tests/
│   ├── content/                     # NEW — Content infrastructure tests
│   │   ├── connectors/
│   │   ├── search/
│   │   ├── entitlements/
│   │   ├── generation/
│   │   ├── sync/
│   │   ├── monitoring/
│   │   └── mediation/
│   └── ... (existing tests unchanged)
└── drizzle/                         # Migration files (auto-generated)
```

**Structure Decision**: Extend the existing `joyus-ai-mcp-server` package with a new `src/content/` module. All content infrastructure lives under this single namespace. The `content` PostgreSQL schema keeps tables physically separated from existing platform tables. No new packages or projects are required — this follows the existing pattern of feature modules within the MCP server.

## Complexity Tracking

*No constitution violations requiring justification.*

No additional complexity beyond what the spec requires. The pluggable interfaces (connector, search provider, entitlement resolver) are mandated by the spec's extensibility requirements, not over-engineering — each has a concrete MVP implementation alongside the interface.
