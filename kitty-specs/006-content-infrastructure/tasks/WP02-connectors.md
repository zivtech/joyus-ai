---
work_package_id: WP02
title: Connector Abstraction & MVP Connectors
lane: "done"
dependencies: []
base_branch: 006-content-infrastructure-WP01
base_commit: ad3ac9985edbc8dfbdeb1616fb5329168797f97f
created_at: '2026-02-21T12:32:19.695589+00:00'
subtasks: [T006, T007, T008, T009, T010]
shell_pid: "21782"
reviewed_by: "Alex Urevick-Ackelsberg"
review_status: "approved"
history:
- date: '2026-02-21'
  action: created
  by: spec-kitty.tasks
---

# WP02: Connector Abstraction & MVP Connectors

## Objective

Define the pluggable `ContentConnector` interface, build the connector registry, and implement both MVP connector types: relational database (PostgreSQL/MySQL via direct query) and REST/GraphQL API.

## Implementation Command

```bash
spec-kitty implement WP02 --base WP01
```

## Context

- **Spec**: `kitty-specs/006-content-infrastructure/spec.md` (FR-001, FR-002)
- **Research**: `kitty-specs/006-content-infrastructure/research.md` (§R2: Connector Architecture)
- **Contracts**: `kitty-specs/006-content-infrastructure/contracts/internal-services.yaml` (ContentConnector interface)
- **Types**: `src/content/types.ts` (ConnectorConfig variants from WP01)

Connectors are stateless — all sync state lives in the database. The connector only knows how to discover, fetch batches, and retrieve individual items from a source.

---

## Subtask T006: Define ContentConnector Interface

**Purpose**: Create the TypeScript interface that all content connectors must implement.

**Steps**:
1. Create `joyus-ai-mcp-server/src/content/connectors/interface.ts`
2. Define interfaces (reference: contracts/internal-services.yaml):
   ```typescript
   export interface ContentConnector {
     readonly type: string;
     discover(config: ConnectorConfig): Promise<DiscoveryResult>;
     indexBatch(config: ConnectorConfig, cursor: string | null, batchSize: number): Promise<IndexBatchResult>;
     fetchContent(config: ConnectorConfig, itemRef: string): Promise<ContentPayload>;
     healthCheck(config: ConnectorConfig): Promise<HealthStatus>;
   }

   export interface DiscoveryResult {
     collections: DiscoveredCollection[];
     totalEstimate: number;
   }

   export interface DiscoveredCollection {
     name: string;
     itemEstimate: number;
     fields: string[];
   }

   export interface IndexBatchResult {
     items: ContentPayload[];
     nextCursor: string | null;
     totalProcessed: number;
   }

   export interface ContentPayload {
     sourceRef: string;
     title: string;
     body: string | null;
     contentType: string;
     metadata: Record<string, unknown>;
   }

   export interface HealthStatus {
     healthy: boolean;
     message: string | null;
     latencyMs: number;
   }
   ```

**Files**:
- `joyus-ai-mcp-server/src/content/connectors/interface.ts` (new, ~60 lines)

**Validation**:
- [ ] `npm run typecheck` passes
- [ ] Interface is importable from other content modules

---

## Subtask T007: Create ConnectorRegistry

**Purpose**: Registry that maps source type strings to connector constructors, enabling dynamic connector selection.

**Steps**:
1. Create `joyus-ai-mcp-server/src/content/connectors/registry.ts`
2. Implement:
   ```typescript
   class ConnectorRegistry {
     private connectors = new Map<string, ContentConnector>();

     register(connector: ContentConnector): void;
     get(type: string): ContentConnector | undefined;
     getOrThrow(type: string): ContentConnector;
     list(): string[];
   }
   ```
3. Export a singleton `connectorRegistry` instance
4. Create `joyus-ai-mcp-server/src/content/connectors/index.ts` that:
   - Imports and instantiates `DatabaseConnector` and `ApiConnector`
   - Registers both with the registry
   - Exports the configured registry

**Files**:
- `joyus-ai-mcp-server/src/content/connectors/registry.ts` (new, ~40 lines)
- `joyus-ai-mcp-server/src/content/connectors/index.ts` (new, ~20 lines)

**Validation**:
- [ ] Registry correctly maps `relational-database` → DatabaseConnector
- [ ] Registry correctly maps `rest-api` → ApiConnector
- [ ] `getOrThrow` throws meaningful error for unknown types

---

## Subtask T008: Implement DatabaseConnector

**Purpose**: Connector for relational databases (PostgreSQL/MySQL) that queries tables/views directly.

**Steps**:
1. Create `joyus-ai-mcp-server/src/content/connectors/database-connector.ts`
2. Implement `ContentConnector` interface with `type = 'relational-database'`
3. **discover**: Connect to the database, query `information_schema.tables` to list available tables/views, estimate row counts via `pg_stat_user_tables` or `COUNT(*)`
4. **indexBatch**: Execute `SELECT` with `LIMIT/OFFSET` or keyset pagination using the cursor. Map configurable columns (titleColumn, bodyColumn, refColumn from `DatabaseConnectorConfig`) to `ContentPayload` fields
5. **fetchContent**: `SELECT` a single row by ref column value
6. **healthCheck**: Attempt a `SELECT 1` query, measure latency
7. Use `pg` directly (new Pool per source) for database connections — NOT the app's Drizzle client (these are external databases, not the app database)
8. Handle connection errors gracefully — return unhealthy status, don't crash

**Important**: Connection credentials in `connectionConfig` are encrypted. Call `decryptToken` before use. Import from `../../db/encryption.js`.

**Files**:
- `joyus-ai-mcp-server/src/content/connectors/database-connector.ts` (new, ~150 lines)

**Validation**:
- [ ] Implements all 4 ContentConnector methods
- [ ] healthCheck returns latency and health status
- [ ] indexBatch returns correct cursor for pagination
- [ ] Connection pool is properly closed after operations

---

## Subtask T009: Implement ApiConnector

**Purpose**: Connector for REST and GraphQL APIs that fetches content from HTTP endpoints.

**Steps**:
1. Create `joyus-ai-mcp-server/src/content/connectors/api-connector.ts`
2. Implement `ContentConnector` interface with `type = 'rest-api'`
3. **discover**: Call the configured discovery endpoint (or list endpoint with `?limit=0`) to enumerate available collections and estimate counts
4. **indexBatch**: Call the list endpoint with pagination parameters (page/offset or cursor). Map response fields to `ContentPayload` using configurable field mappings from `ApiConnectorConfig`
5. **fetchContent**: Call the detail endpoint with the item reference to get full content
6. **healthCheck**: Call the base URL or a dedicated health endpoint, measure latency
7. Support authentication types: `none`, `bearer`, `api-key`, `basic` (from `ApiConnectorConfig.authType`)
8. Use `axios` (already a dependency) for HTTP requests
9. Handle pagination patterns: offset-based (`?page=N`), cursor-based (`?cursor=X`), and link-header (`Link: <url>; rel="next"`)

**Files**:
- `joyus-ai-mcp-server/src/content/connectors/api-connector.ts` (new, ~180 lines)

**Validation**:
- [ ] Implements all 4 ContentConnector methods
- [ ] Handles all 3 pagination patterns
- [ ] Supports 4 auth types
- [ ] Gracefully handles HTTP errors (4xx, 5xx, timeouts)

---

## Subtask T010: Add Connector Health Check Support

**Purpose**: Add shared error handling and health check utilities used by both connectors.

**Steps**:
1. Add to `joyus-ai-mcp-server/src/content/connectors/interface.ts` (or a new `utils.ts`):
   ```typescript
   export async function measureHealth(
     fn: () => Promise<void>
   ): Promise<HealthStatus> {
     const start = Date.now();
     try {
       await fn();
       return { healthy: true, message: null, latencyMs: Date.now() - start };
     } catch (error) {
       return {
         healthy: false,
         message: error instanceof Error ? error.message : 'Unknown error',
         latencyMs: Date.now() - start,
       };
     }
   }
   ```
2. Add a `ConnectorError` class with `sourceId`, `connectorType`, and `operation` fields for structured error reporting
3. Use `ConnectorError` in both connectors for consistent error handling

**Files**:
- `joyus-ai-mcp-server/src/content/connectors/interface.ts` (extend, ~30 lines added)

**Validation**:
- [ ] `measureHealth` correctly measures latency for both success and failure
- [ ] `ConnectorError` carries structured context for logging

---

## Definition of Done

- [ ] `ContentConnector` interface defined with all 4 methods
- [ ] `ConnectorRegistry` maps type strings to connectors
- [ ] `DatabaseConnector` implements full interface for PostgreSQL/MySQL
- [ ] `ApiConnector` implements full interface for REST/GraphQL
- [ ] Health check utilities shared between connectors
- [ ] `npm run typecheck` passes

## Risks

- **External database schemas vary wildly**: The database connector must handle configurable column mappings, not hardcoded field names.
- **API pagination inconsistency**: Different APIs use different pagination patterns. The ApiConnector must detect or be configured for the pattern.

## Reviewer Guidance

- Verify both connectors implement the exact same interface
- Check that database connector uses separate connection pool (NOT the app's Drizzle client)
- Confirm credentials are decrypted before use
- Verify error handling doesn't expose connection details in error messages
- Check cursor-based pagination correctness (no infinite loops, handles empty results)

## Activity Log

- 2026-02-21T12:39:44Z – unknown – shell_pid=21782 – lane=done – Connectors: interface, registry, database, API
