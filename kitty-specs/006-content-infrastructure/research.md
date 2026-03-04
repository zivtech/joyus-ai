# Research: Content Infrastructure
*Phase 0 output for Feature 006*

## R1: PostgreSQL Full-Text Search for Content Indexing

**Decision**: Use PostgreSQL `tsvector`/`tsquery` with GIN indexes as the initial search provider, behind a `SearchProvider` interface that allows swapping to a dedicated engine later.

**Rationale**:
- Already using PostgreSQL (Drizzle ORM + pg). No new infrastructure dependency.
- PostgreSQL FTS supports ranked results (`ts_rank`), phrase matching, prefix search, and weighting by field (title vs body).
- At 500K items per source, GIN indexes on `tsvector` columns perform well for keyword search.
- The `SearchProvider` interface abstracts the implementation — swapping to Elasticsearch, Typesense, or Solr later requires only a new provider, no API changes.

**Alternatives considered**:
- **Elasticsearch/OpenSearch**: Superior for faceted search and fuzzy matching, but adds significant operational complexity (separate cluster, JVM tuning). Overkill for MVP with keyword search.
- **Typesense**: Simpler than Elasticsearch, but still a separate service to deploy and manage.
- **SQLite FTS5**: Not applicable — already committed to PostgreSQL.

**Implementation notes**:
- Store `tsvector` as a generated column on content items: `search_vector tsvector GENERATED ALWAYS AS (to_tsvector('english', coalesce(title,'') || ' ' || coalesce(body,''))) STORED`
- GIN index on `search_vector` for fast lookup
- Use `ts_rank(search_vector, query)` for relevance scoring
- Drizzle ORM supports raw SQL for FTS operations via `sql` tagged template

## R2: Pluggable Connector Architecture

**Decision**: Define a `ContentConnector` TypeScript interface with lifecycle methods (discover, index, fetch). Each connector type implements this interface. A `ConnectorRegistry` maps source type strings to connector constructors.

**Rationale**:
- The spec requires two MVP connectors (relational DB, REST/GraphQL API) with the architecture supporting future additions.
- A simple interface + registry pattern is the lightest abstraction that supports extensibility without frameworks.
- Connectors are stateless — sync state lives in the database, not in the connector instance.

**Alternatives considered**:
- **Plugin system with dynamic loading**: Over-engineered for platform-team-only connectors. Dynamic `import()` adds complexity without benefit when all connectors ship in the same package.
- **Event-driven connector bus**: Unnecessary for batch-only sync. Events add indirection without value when sync is orchestrated by a central engine.

**Interface shape**:
```typescript
interface ContentConnector {
  type: string;
  discover(config: ConnectorConfig): Promise<DiscoveryResult>;
  indexBatch(config: ConnectorConfig, cursor: string | null, batchSize: number): Promise<IndexBatchResult>;
  fetchContent(config: ConnectorConfig, itemRef: string): Promise<ContentPayload>;
  healthCheck(config: ConnectorConfig): Promise<HealthStatus>;
}
```

## R3: Entitlement Resolution Strategy

**Decision**: Define an `EntitlementResolver` interface with a single `resolve(userId, context)` method. Ship an `HttpEntitlementResolver` that queries any HTTP endpoint returning a standard JSON shape. Cache resolved entitlements per session.

**Rationale**:
- Different organizations use different entitlement sources (CRM APIs, subscription platforms, custom databases). A generic HTTP resolver covers the widest range of backends.
- Session-scoped caching (resolve once per session, re-resolve on new sessions) matches the spec requirement and avoids per-request latency to external systems.
- The interface is simple enough that organizations can implement custom resolvers for non-HTTP sources.

**Alternatives considered**:
- **Direct CRM integration** (e.g., HubSpot SDK): Ties the platform to a specific vendor. Violates §2.10.
- **LDAP/Active Directory resolver**: Too narrow — most modern entitlement data lives in SaaS APIs, not directory services.
- **GraphQL resolver**: Could be a future addition but HTTP POST with JSON covers GraphQL endpoints too.

**Cache design**:
- In-memory Map keyed by `sessionId` → `ResolvedEntitlements`
- TTL = session duration (cleared on session end)
- Fallback on resolver failure: use cached entitlements if available, otherwise restricted-access mode (no content returned)

## R4: Drizzle ORM Schema Separation

**Decision**: Use PostgreSQL `CREATE SCHEMA content` via Drizzle's `pgSchema` to namespace all content infrastructure tables, keeping them physically and logically separated from existing platform tables.

**Rationale**:
- Same PostgreSQL instance avoids operational overhead of a second database.
- Schema separation provides clean namespace boundaries — `content.sources`, `content.items`, etc. don't collide with existing `public.users`, `public.connections`.
- Drizzle ORM supports `pgSchema` for defining tables in a custom schema.
- Migrations can target the `content` schema independently.

**Alternatives considered**:
- **Same `public` schema with table prefixes** (`content_sources`, `content_items`): Works but less clean; no ability to grant schema-level permissions separately.
- **Separate database**: Adds connection pool management, cross-database query complexity, and deployment overhead for no meaningful benefit at this scale.

**Implementation notes**:
- Define schema: `const contentSchema = pgSchema('content');`
- All content tables use: `contentSchema.table('sources', { ... })`
- Migration creates the schema: `CREATE SCHEMA IF NOT EXISTS content;`
- Existing `db` client works unchanged — Drizzle handles schema-qualified queries automatically.

## R5: Two-Layer Mediation Authentication

**Decision**: API key in `X-API-Key` header identifies the integration; OAuth2/OIDC Bearer token in `Authorization` header identifies the end user. Both are required for every mediation API request.

**Rationale**:
- Two-layer auth cleanly separates "which integration is calling" from "on behalf of which user." This enables per-integration rate limiting and per-user entitlement resolution independently.
- API keys are simple to issue and revoke. OAuth2/OIDC tokens leverage existing identity providers — the platform doesn't need to be an identity provider.
- The platform validates the user token by calling the configured OIDC discovery endpoint / JWKS URI.

**Alternatives considered**:
- **Single token (JWT with embedded integration claims)**: Conflates integration identity and user identity. Harder to revoke integration access without invalidating user tokens.
- **Mutual TLS**: High operational bar for integration partners. Appropriate for enterprise but not as a default.
- **Session cookies**: Not suitable for API-to-API communication (bot integrations, server-side widgets).

**Implementation notes**:
- API keys stored in `content.api_keys` table (hashed, with integration metadata)
- User token validation: configurable JWKS URI per integration, standard JWT verification
- Middleware chain: `validateApiKey` → `validateUserToken` → `resolveEntitlements` → handler

## R6: Content-Aware Generation Architecture

**Decision**: Two generation paths — (1) MCP tools for client-driven generation (Claude Desktop, AI assistants) and (2) a server-side `/mediation/generate` endpoint for bot integrations. Both share the same retrieval → generation → citation pipeline.

**Rationale**:
- MCP tools let AI agents call content retrieval and generation as tool calls — natural fit for Claude Desktop and other MCP clients.
- Bot mediation requires a server-side endpoint because external chat widgets can't speak MCP protocol — they need HTTP REST.
- Sharing the pipeline (retriever → generator → citation builder) between both paths avoids duplication and ensures consistent behavior.

**Alternatives considered**:
- **MCP only**: Excludes bot integrations that need HTTP REST. The mediation API is a spec requirement.
- **REST only**: Loses the MCP tool integration that makes content available to AI agents directly.
- **Separate pipeline per path**: Duplication risk, consistency burden.

**Pipeline shape**:
1. **Retrieve**: Query search index filtered by user entitlements → ranked content items
2. **Build context**: Assemble retrieval results + voice profile into generation prompt
3. **Generate**: Call AI model (model-agnostic — currently Claude via Agent SDK)
4. **Cite**: Extract source references from generation, attach citation metadata
5. **Return**: Response with generated text + structured citations

## R7: Batch Sync Engine Design

**Decision**: A `SyncEngine` orchestrates per-source sync as a batch process. Each sync run fetches items in configurable batch sizes via the connector's `indexBatch` method, updates the content index, and records sync state. Sync can be triggered by schedule (cron) or manually.

**Rationale**:
- Spec explicitly excludes real-time streaming. Batch processing with cursor-based pagination scales to 500K items.
- Incremental sync (cursor-based) avoids re-fetching the entire source on each run.
- Sync state in the database enables resumption after failures.

**Alternatives considered**:
- **Full re-index on each sync**: Simple but doesn't scale to 500K items. Would exceed the spec's performance expectations.
- **Change data capture (CDC)**: Explicitly out of scope for this feature.

**Sync strategies**:
- **Mirror**: Full local copy — fetch both metadata and content, store locally
- **Pass-through**: On-demand fetch — store metadata only, fetch content per-request via connector
- **Hybrid**: Local metadata + on-demand content — default for large sources

## R8: Voice Drift Monitoring Integration

**Decision**: Background job that periodically evaluates recent generated content against target voice profiles. Uses the profile engine's analysis capabilities (from Feature 005, now in private repo) via a pluggable `VoiceAnalyzer` interface. Reports drift dimensions and severity.

**Rationale**:
- Spec explicitly states drift monitoring is background, not per-generation gating.
- The profile engine (joyus-profile-engine) provides the actual analysis; this feature defines the integration interface and scheduling.
- A pluggable interface decouples the monitoring scheduler from the specific analysis implementation.

**Alternatives considered**:
- **Per-generation gating**: Explicitly rejected by spec. Would add latency to every generation.
- **Inline drift scoring**: Tempting but violates the background monitoring requirement.

**Implementation notes**:
- Scheduled job (cron) processes recent generations in batches
- Calls `VoiceAnalyzer.analyze(content, profileId)` for each
- Aggregates results into drift reports stored in `content.drift_reports`
- Reports available via MCP tools and health/metrics endpoints
