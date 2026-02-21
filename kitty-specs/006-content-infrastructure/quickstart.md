# Quickstart: Content Infrastructure
*Phase 1 output for Feature 006*

## Prerequisites

- Node.js >=20.0.0
- PostgreSQL (same instance as existing MCP server)
- Existing `joyus-ai-mcp-server` package set up and running

## Setup

### 1. Create the `content` schema

The content infrastructure uses a separate PostgreSQL schema. After implementing the Drizzle schema changes, generate and run the migration:

```bash
cd joyus-ai-mcp-server
npm run db:generate
npm run db:push     # or db:migrate for production
```

This creates the `content` schema and all tables defined in `src/content/schema.ts`.

### 2. Configure a content source

Content sources are configured via MCP tools or the admin API. Example using the MCP tool:

```json
{
  "tool": "content_configure_source",
  "input": {
    "name": "Documentation Archive",
    "type": "relational-database",
    "syncStrategy": "hybrid",
    "connectionConfig": {
      "host": "db.example.com",
      "port": 5432,
      "database": "docs",
      "table": "articles",
      "titleColumn": "title",
      "bodyColumn": "content",
      "refColumn": "id"
    },
    "freshnessWindowMinutes": 720
  }
}
```

### 3. Trigger initial sync

```json
{
  "tool": "content_sync_source",
  "input": {
    "sourceId": "clx..."
  }
}
```

Monitor progress:

```json
{
  "tool": "content_get_sync_status",
  "input": {
    "syncRunId": "clx..."
  }
}
```

### 4. Search content

```json
{
  "tool": "content_search",
  "input": {
    "query": "compliance requirements",
    "limit": 10
  }
}
```

Results are automatically filtered by the user's resolved entitlements.

### 5. Generate with voice

```json
{
  "tool": "content_generate",
  "input": {
    "query": "Summarize the key compliance requirements",
    "profileId": "voice-profile-formal"
  }
}
```

Returns generated text with source citations.

## Bot Mediation Integration

External chat interfaces connect via the mediation REST API:

### 1. Obtain an API key

API keys are provisioned per tenant for each integration (admin operation).

### 2. Create a session

```bash
curl -X POST /api/mediation/sessions \
  -H "X-API-Key: jyk_abc123..." \
  -H "Authorization: Bearer <user-oidc-token>" \
  -H "Content-Type: application/json" \
  -d '{"profileId": "voice-profile-formal"}'
```

### 3. Send messages

```bash
curl -X POST /api/mediation/sessions/{sessionId}/messages \
  -H "X-API-Key: jyk_abc123..." \
  -H "Authorization: Bearer <user-oidc-token>" \
  -H "Content-Type: application/json" \
  -d '{"message": "What are the key compliance requirements?"}'
```

Response includes generated text, citations, and metadata.

### 4. End session

```bash
curl -X DELETE /api/mediation/sessions/{sessionId} \
  -H "X-API-Key: jyk_abc123..." \
  -H "Authorization: Bearer <user-oidc-token>"
```

## Observability

### Health endpoint

```bash
curl /api/mediation/health
```

Returns status of database, connectors, entitlement resolver, and search provider.

### Metrics

Content operation metrics are available via the platform's metrics endpoint:
- Connector sync status and latency
- Search query latency (p50, p95, p99)
- Entitlement resolution times
- Generation request counts and latency
- Drift scores by profile

### Structured logs

All content operations emit structured JSON logs with:
- `operation`: sync | search | resolve | generate | mediate
- `tenantId`, `userId`, `sourceId` (as applicable)
- `durationMs`: operation duration
- `success`: boolean result

## Development

### Running tests

```bash
cd joyus-ai-mcp-server
npm test                    # all tests
npm test -- --grep content  # content infrastructure tests only
```

### Type checking

```bash
npm run typecheck
```

### Full validation

```bash
npm run validate  # typecheck + lint + test
```

## Architecture Notes

- **Pluggable interfaces**: Connectors, search providers, entitlement resolvers, and voice analyzers are all defined as TypeScript interfaces. Each has a concrete MVP implementation + registration mechanism.
- **Schema separation**: All content tables live in the PostgreSQL `content` schema, separate from the `public` schema used by existing platform tables.
- **Entitlement caching**: Resolved entitlements are cached per session. New sessions re-resolve from the external system.
- **Sync strategies**: Mirror (full local copy), pass-through (on-demand fetch), hybrid (local metadata + on-demand content). Configured per source.
- **Search abstraction**: PostgreSQL FTS is the default. The `SearchProvider` interface supports swapping to a dedicated search engine without API changes.
