# Data Model: Content Infrastructure
*Phase 1 output for Feature 006*

## Schema Overview

All content infrastructure tables live in the PostgreSQL `content` schema, separate from the existing `public` schema tables. This provides clean namespace boundaries and enables independent access control.

```
content schema
├── sources          # Content source connections
├── items            # Indexed content items
├── products         # Named content/voice collections
├── product_sources  # Product ↔ source mapping
├── product_profiles # Product ↔ voice profile mapping
├── entitlements     # Resolved user entitlements (cached)
├── api_keys         # Integration API keys (mediation)
├── mediation_sessions # Active mediation sessions
├── sync_runs        # Sync execution history
├── generation_logs  # Generated content audit trail
├── drift_reports    # Voice drift monitoring reports
└── operation_logs   # Structured content operation logs
```

## Entities

### ContentSource

A connection to an external system holding organizational content.

| Field | Type | Constraints | Description |
|-------|------|-------------|-------------|
| id | text (CUID2) | PK | Unique identifier |
| tenantId | text | NOT NULL, INDEX | Tenant this source belongs to |
| name | text | NOT NULL | Human-readable source name |
| type | enum | NOT NULL | `relational-database` \| `rest-api` |
| syncStrategy | enum | NOT NULL | `mirror` \| `pass-through` \| `hybrid` |
| connectionConfig | jsonb | NOT NULL | Encrypted connection details (host, credentials, query config) |
| freshnessWindowMinutes | integer | NOT NULL, DEFAULT 1440 | How long before content is considered stale (default: 24h) |
| status | enum | NOT NULL, DEFAULT 'active' | `active` \| `syncing` \| `error` \| `disconnected` |
| itemCount | integer | NOT NULL, DEFAULT 0 | Number of items discovered |
| lastSyncAt | timestamp | NULL | Last successful sync completion |
| lastSyncError | text | NULL | Last sync error message (if status = error) |
| schemaVersion | text | NULL | Detected schema version for change detection |
| createdAt | timestamp | NOT NULL, DEFAULT now() | |
| updatedAt | timestamp | NOT NULL, DEFAULT now() | |

**Indexes**: `tenantId`, `(tenantId, type)`, `(tenantId, status)`

### ContentItem

A discrete piece of content within a source.

| Field | Type | Constraints | Description |
|-------|------|-------------|-------------|
| id | text (CUID2) | PK | Unique identifier |
| sourceId | text | NOT NULL, FK → sources.id, INDEX | Parent source |
| sourceRef | text | NOT NULL | External identifier in the source system |
| title | text | NOT NULL | Content title |
| body | text | NULL | Full content body (NULL for pass-through items) |
| contentType | text | NOT NULL, DEFAULT 'text' | MIME type or category |
| metadata | jsonb | NOT NULL, DEFAULT '{}' | Source-specific metadata (author, date, tags) |
| dataTier | integer | NOT NULL, DEFAULT 1 | Data governance tier (1-4, per §3.1) |
| searchVector | tsvector | GENERATED | Full-text search vector (title + body) |
| lastSyncedAt | timestamp | NOT NULL | When this item was last synced |
| isStale | boolean | NOT NULL, DEFAULT false | Computed: exceeds source freshness window |
| createdAt | timestamp | NOT NULL, DEFAULT now() | |
| updatedAt | timestamp | NOT NULL, DEFAULT now() | |

**Indexes**: GIN on `searchVector`, `sourceId`, `(sourceId, sourceRef)` UNIQUE, `(sourceId, isStale)`

### Product

A named collection of content and/or voice profiles that can be independently entitled.

| Field | Type | Constraints | Description |
|-------|------|-------------|-------------|
| id | text (CUID2) | PK | Unique identifier |
| tenantId | text | NOT NULL, INDEX | Tenant this product belongs to |
| name | text | NOT NULL | Product name (e.g., "Annual Report Collection") |
| description | text | NULL | Product description |
| isActive | boolean | NOT NULL, DEFAULT true | Whether product is currently available |
| createdAt | timestamp | NOT NULL, DEFAULT now() | |
| updatedAt | timestamp | NOT NULL, DEFAULT now() | |

**Indexes**: `tenantId`, `(tenantId, name)` UNIQUE

### ProductSource (join table)

Maps products to content sources.

| Field | Type | Constraints | Description |
|-------|------|-------------|-------------|
| productId | text | NOT NULL, FK → products.id | |
| sourceId | text | NOT NULL, FK → sources.id | |

**Primary key**: `(productId, sourceId)`

### ProductProfile (join table)

Maps products to voice profiles.

| Field | Type | Constraints | Description |
|-------|------|-------------|-------------|
| productId | text | NOT NULL, FK → products.id | |
| profileId | text | NOT NULL | Voice profile identifier (from profile engine) |

**Primary key**: `(productId, profileId)`

### Entitlement

A resolved access grant linking a user to specific products.

| Field | Type | Constraints | Description |
|-------|------|-------------|-------------|
| id | text (CUID2) | PK | Unique identifier |
| tenantId | text | NOT NULL, INDEX | Tenant context |
| userId | text | NOT NULL | User identifier (from auth token) |
| sessionId | text | NOT NULL, INDEX | Session this entitlement belongs to |
| productId | text | NOT NULL, FK → products.id | Entitled product |
| resolvedFrom | text | NOT NULL | Source of resolution (e.g., "crm-api", "subscription-api") |
| resolvedAt | timestamp | NOT NULL | When this entitlement was resolved |
| expiresAt | timestamp | NOT NULL | When to re-resolve (session end or TTL) |

**Indexes**: `(sessionId, userId)`, `(userId, productId)`, `tenantId`

### ApiKey

Integration API keys for the mediation API.

| Field | Type | Constraints | Description |
|-------|------|-------------|-------------|
| id | text (CUID2) | PK | Unique identifier |
| tenantId | text | NOT NULL, INDEX | Tenant this key belongs to |
| keyHash | text | NOT NULL, UNIQUE | SHA-256 hash of the API key |
| keyPrefix | text | NOT NULL | First 8 chars of key (for identification in logs) |
| integrationName | text | NOT NULL | Human-readable integration name |
| jwksUri | text | NULL | OIDC JWKS URI for user token validation |
| issuer | text | NULL | Expected JWT issuer |
| audience | text | NULL | Expected JWT audience |
| isActive | boolean | NOT NULL, DEFAULT true | Whether key is active |
| lastUsedAt | timestamp | NULL | Last request timestamp |
| createdAt | timestamp | NOT NULL, DEFAULT now() | |

**Indexes**: `keyHash` UNIQUE, `tenantId`, `(tenantId, isActive)`

### MediationSession

An authenticated interaction between an external interface and the platform.

| Field | Type | Constraints | Description |
|-------|------|-------------|-------------|
| id | text (CUID2) | PK | Session identifier |
| tenantId | text | NOT NULL, INDEX | Tenant context |
| apiKeyId | text | NOT NULL, FK → api_keys.id | Integration that initiated |
| userId | text | NOT NULL | Authenticated end user |
| activeProfileId | text | NULL | Currently active voice profile |
| messageCount | integer | NOT NULL, DEFAULT 0 | Number of messages in session |
| startedAt | timestamp | NOT NULL, DEFAULT now() | |
| lastActivityAt | timestamp | NOT NULL, DEFAULT now() | |
| endedAt | timestamp | NULL | When session ended |

**Indexes**: `(tenantId, userId)`, `apiKeyId`, `(tenantId, lastActivityAt)`

### SyncRun

Individual sync execution record.

| Field | Type | Constraints | Description |
|-------|------|-------------|-------------|
| id | text (CUID2) | PK | Unique identifier |
| sourceId | text | NOT NULL, FK → sources.id, INDEX | Source being synced |
| status | enum | NOT NULL | `pending` \| `running` \| `completed` \| `failed` |
| trigger | enum | NOT NULL | `scheduled` \| `manual` |
| itemsDiscovered | integer | NOT NULL, DEFAULT 0 | Items found |
| itemsCreated | integer | NOT NULL, DEFAULT 0 | New items indexed |
| itemsUpdated | integer | NOT NULL, DEFAULT 0 | Existing items updated |
| itemsRemoved | integer | NOT NULL, DEFAULT 0 | Items no longer in source |
| cursor | text | NULL | Resume cursor for incremental sync |
| error | text | NULL | Error message if failed |
| startedAt | timestamp | NOT NULL, DEFAULT now() | |
| completedAt | timestamp | NULL | |

**Indexes**: `(sourceId, startedAt)`, `status`

### GenerationLog

Audit trail for content-aware generation.

| Field | Type | Constraints | Description |
|-------|------|-------------|-------------|
| id | text (CUID2) | PK | Unique identifier |
| tenantId | text | NOT NULL, INDEX | Tenant context |
| userId | text | NOT NULL | User who requested generation |
| sessionId | text | NULL | Mediation session (if via mediation API) |
| profileId | text | NULL | Voice profile used |
| query | text | NOT NULL | User's input query/prompt |
| sourcesUsed | jsonb | NOT NULL, DEFAULT '[]' | Array of content item IDs used as context |
| citationCount | integer | NOT NULL, DEFAULT 0 | Number of citations in response |
| responseLength | integer | NOT NULL | Character count of generated response |
| driftScore | real | NULL | Voice drift score (populated by background monitor) |
| createdAt | timestamp | NOT NULL, DEFAULT now() | |

**Indexes**: `(tenantId, createdAt)`, `(tenantId, userId)`, `(profileId, createdAt)`

### DriftReport

Voice drift monitoring results.

| Field | Type | Constraints | Description |
|-------|------|-------------|-------------|
| id | text (CUID2) | PK | Unique identifier |
| tenantId | text | NOT NULL, INDEX | Tenant context |
| profileId | text | NOT NULL | Voice profile evaluated |
| windowStart | timestamp | NOT NULL | Evaluation window start |
| windowEnd | timestamp | NOT NULL | Evaluation window end |
| generationsEvaluated | integer | NOT NULL | Number of generations in window |
| overallDriftScore | real | NOT NULL | Aggregate drift score (0.0 = perfect, 1.0 = max drift) |
| dimensionScores | jsonb | NOT NULL | Per-dimension scores (formality, complexity, etc.) |
| recommendations | jsonb | NOT NULL, DEFAULT '[]' | Suggested corrections |
| createdAt | timestamp | NOT NULL, DEFAULT now() | |

**Indexes**: `(tenantId, profileId, windowEnd)`, `(profileId, createdAt)`

### OperationLog

Structured log for all content operations (FR-024).

| Field | Type | Constraints | Description |
|-------|------|-------------|-------------|
| id | text (CUID2) | PK | Unique identifier |
| tenantId | text | NOT NULL | Tenant context |
| operation | text | NOT NULL | Operation type (sync, search, resolve, generate, mediate) |
| sourceId | text | NULL | Related content source |
| userId | text | NULL | Related user |
| durationMs | integer | NOT NULL | Operation duration |
| success | boolean | NOT NULL | Whether operation succeeded |
| metadata | jsonb | NOT NULL, DEFAULT '{}' | Operation-specific details |
| createdAt | timestamp | NOT NULL, DEFAULT now() | |

**Indexes**: `(tenantId, operation, createdAt)`, `(tenantId, createdAt)`

## Relationships

```
ContentSource 1 ←→ N ContentItem       (source has many items)
ContentSource N ←→ N Product            (via ProductSource)
Product       N ←→ N VoiceProfile       (via ProductProfile, external ref)
Product       1 ←→ N Entitlement        (product has many entitlements)
ContentSource 1 ←→ N SyncRun            (source has many sync runs)
ApiKey        1 ←→ N MediationSession   (key has many sessions)
```

## State Transitions

### ContentSource.status
```
active → syncing (sync started)
syncing → active (sync completed successfully)
syncing → error (sync failed)
error → syncing (retry/manual trigger)
active → disconnected (source unreachable)
disconnected → active (source reconnected + sync)
```

### SyncRun.status
```
pending → running (picked up by engine)
running → completed (all batches processed)
running → failed (unrecoverable error)
```

## Data Governance Notes

- `ContentItem.dataTier` maps to Constitution §3.1 tiers (1-4)
- `ContentSource.connectionConfig` is encrypted at rest (reuse existing `encryptToken`/`decryptToken` from `db/encryption.ts`)
- `ApiKey.keyHash` stores only the hash — raw key shown once at creation, never stored
- `OperationLog` entries are append-only (no updates or deletes) for audit compliance
- Entitlements are session-scoped and auto-expire — no persistent access grants stored
