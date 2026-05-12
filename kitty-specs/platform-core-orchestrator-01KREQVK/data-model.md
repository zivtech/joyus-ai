# Data Model: Platform Core Orchestrator

**Mission:** platform-core-orchestrator-01KREQVK
**Date:** 2026-05-12
**Storage:** PostgreSQL (existing), Drizzle ORM

---

## Entities

### Session

The primary orchestrator entity. Represents an active or completed agent interaction.

| Field | Type | Constraints | Notes |
|-------|------|-------------|-------|
| id | UUID | PK | Generated on creation |
| tenantId | UUID | FK → tenants, NOT NULL, INDEX | Partition key for multi-tenant isolation |
| userId | UUID | FK → users, NOT NULL, INDEX | Session owner |
| status | ENUM | NOT NULL | pending, running, suspended, completed, failed |
| metadata | JSONB | DEFAULT '{}' | Extensible key-value metadata |
| inngestRunId | VARCHAR | NULLABLE, INDEX | Links to Inngest function run for durable execution |
| createdAt | TIMESTAMP | NOT NULL, DEFAULT now() | |
| updatedAt | TIMESTAMP | NOT NULL, DEFAULT now() | |
| completedAt | TIMESTAMP | NULLABLE | Set on terminal status |

**Indexes:** (tenantId, status), (tenantId, userId, createdAt DESC)
**Tenant scoping:** All queries MUST include tenantId in WHERE clause.

### Turn

A single exchange within a session. Immutable after creation.

| Field | Type | Constraints | Notes |
|-------|------|-------------|-------|
| id | UUID | PK | |
| sessionId | UUID | FK → sessions, NOT NULL, INDEX | |
| tenantId | UUID | FK → tenants, NOT NULL | Denormalized for query performance |
| sequence | INTEGER | NOT NULL | Turn order within session (0-indexed) |
| role | ENUM | NOT NULL | user, assistant, tool |
| content | TEXT | NULLABLE | Text content of the message |
| toolCalls | JSONB | NULLABLE | Array of tool_use blocks from assistant response |
| toolResults | JSONB | NULLABLE | Array of tool results for tool role |
| tokenUsage | JSONB | NULLABLE | { inputTokens, outputTokens, cacheHits } |
| createdAt | TIMESTAMP | NOT NULL, DEFAULT now() | |

**Indexes:** (sessionId, sequence), (tenantId, sessionId)
**Constraint:** UNIQUE (sessionId, sequence)

### WorkUnit

An individual piece of agent work with lifecycle tracking. Inspired by Gas City's bead model.

| Field | Type | Constraints | Notes |
|-------|------|-------------|-------|
| id | UUID | PK | |
| tenantId | UUID | FK → tenants, NOT NULL, INDEX | |
| sessionId | UUID | FK → sessions, NULLABLE | May be created before session assignment |
| coordinationGroupId | UUID | FK → coordination_groups, NULLABLE | |
| status | ENUM | NOT NULL | pending, assigned, running, completed, failed, cancelled |
| title | VARCHAR(255) | NOT NULL | Human-readable description |
| type | VARCHAR(100) | NOT NULL | Categorization (e.g., research, generation, analysis) |
| assignee | VARCHAR(255) | NULLABLE | Agent or system that owns this work |
| dependencies | UUID[] | DEFAULT '{}' | IDs of work units that must complete first |
| labels | VARCHAR[] | DEFAULT '{}' | Freeform tags |
| metadata | JSONB | DEFAULT '{}' | |
| createdAt | TIMESTAMP | NOT NULL, DEFAULT now() | |
| updatedAt | TIMESTAMP | NOT NULL, DEFAULT now() | |
| completedAt | TIMESTAMP | NULLABLE | |

**Indexes:** (tenantId, status), (coordinationGroupId), (tenantId, sessionId)

### CoordinationGroup

A logical grouping of work units with completion semantics.

| Field | Type | Constraints | Notes |
|-------|------|-------------|-------|
| id | UUID | PK | |
| tenantId | UUID | FK → tenants, NOT NULL, INDEX | |
| title | VARCHAR(255) | NOT NULL | |
| completionPolicy | ENUM | NOT NULL, DEFAULT 'all' | all (all units must complete), any (first completion triggers), majority |
| status | ENUM | NOT NULL | active, completed, failed |
| metadata | JSONB | DEFAULT '{}' | |
| createdAt | TIMESTAMP | NOT NULL, DEFAULT now() | |
| completedAt | TIMESTAMP | NULLABLE | |

**Indexes:** (tenantId, status)

### Event

A typed, immutable record of a state change. Append-only.

| Field | Type | Constraints | Notes |
|-------|------|-------------|-------|
| id | UUID | PK | |
| tenantId | UUID | NOT NULL, INDEX | |
| sessionId | UUID | NULLABLE, INDEX | NULL for tenant-level events |
| type | VARCHAR(100) | NOT NULL, INDEX | Registered event type (e.g., session.created, tool.completed) |
| payload | JSONB | NOT NULL | Event-specific data, validated against type schema |
| sequence | BIGSERIAL | NOT NULL | Global ordering for replay |
| createdAt | TIMESTAMP | NOT NULL, DEFAULT now() | |

**Indexes:** (tenantId, type, createdAt), (sessionId, sequence), (sequence) for replay
**Constraint:** Events are append-only. No UPDATE or DELETE.

### ToolRegistration

A discovered tool available to a tenant.

| Field | Type | Constraints | Notes |
|-------|------|-------------|-------|
| id | UUID | PK | |
| tenantId | UUID | FK → tenants, NOT NULL | |
| name | VARCHAR(255) | NOT NULL | Tool name as presented to the agent |
| description | TEXT | NULLABLE | |
| inputSchema | JSONB | NOT NULL | JSON Schema for tool input |
| mcpServerId | VARCHAR(255) | NULLABLE | MCP server that hosts this tool |
| enabled | BOOLEAN | NOT NULL, DEFAULT true | |
| permissions | JSONB | DEFAULT '{}' | Role/scope requirements |
| createdAt | TIMESTAMP | NOT NULL, DEFAULT now() | |
| updatedAt | TIMESTAMP | NOT NULL, DEFAULT now() | |

**Indexes:** (tenantId, enabled), UNIQUE (tenantId, name)

---

## State Transitions

### Session Lifecycle

```
pending → running → completed
pending → running → suspended → running → completed
pending → running → failed
pending → cancelled
running → failed (crash → auto-recovery → running)
```

### WorkUnit Lifecycle

```
pending → assigned → running → completed
pending → assigned → running → failed
pending → cancelled
```

### CoordinationGroup Lifecycle

```
active → completed (when completionPolicy is satisfied)
active → failed (when a required work unit fails with no recovery)
```

---

## Relationships

```
Tenant (1) ──── (N) Session
Session (1) ──── (N) Turn
Session (1) ──── (N) WorkUnit
Tenant (1) ──── (N) CoordinationGroup
CoordinationGroup (1) ──── (N) WorkUnit
Tenant (1) ──── (N) Event
Session (1) ──── (N) Event
Tenant (1) ──── (N) ToolRegistration
```

---

*Data model created: 2026-05-12*
*Storage: PostgreSQL via Drizzle ORM (extends existing joyus-ai-mcp-server schema)*
