-- WP04: Coordination Tables
-- Work units and coordination groups for multi-agent coordination.
-- Generated: 2026-05-12
-- Note: This migration was authored manually because drizzle-kit generate
--       requires node_modules in the worktree, which are not installed.
--       Run `pnpm drizzle-kit generate` locally to regenerate with metadata.

-- =====================================================================
-- ENUM TYPES
-- =====================================================================

CREATE TYPE "public"."coordination_completion_policy" AS ENUM(
  'all',
  'any',
  'majority'
);

CREATE TYPE "public"."coordination_group_status" AS ENUM(
  'active',
  'completed',
  'failed'
);

CREATE TYPE "public"."work_unit_status" AS ENUM(
  'pending',
  'assigned',
  'running',
  'completed',
  'failed',
  'cancelled'
);

-- =====================================================================
-- TABLES
-- =====================================================================

-- Coordination groups: logical grouping of work units with completion semantics.
-- Lifecycle: active → completed | failed
-- All queries MUST include tenant_id in WHERE clause.
CREATE TABLE "coordination_groups" (
  "id"                TEXT PRIMARY KEY,
  "tenant_id"         TEXT NOT NULL,
  "title"             TEXT NOT NULL,
  "completion_policy" "coordination_completion_policy" NOT NULL DEFAULT 'all',
  "status"            "coordination_group_status" NOT NULL DEFAULT 'active',
  "metadata"          JSONB DEFAULT '{}',
  "created_at"        TIMESTAMP NOT NULL DEFAULT NOW(),
  "completed_at"      TIMESTAMP
);

-- Work units: individual pieces of agent work with lifecycle tracking.
-- Inspired by Gas City's bead model. Dependencies form a DAG (cycles rejected at service layer).
-- All queries MUST include tenant_id in WHERE clause.
CREATE TABLE "work_units" (
  "id"                      TEXT PRIMARY KEY,
  "tenant_id"               TEXT NOT NULL,
  "session_id"              TEXT REFERENCES "orchestrator_sessions"("id") ON DELETE SET NULL,
  "coordination_group_id"   TEXT REFERENCES "coordination_groups"("id") ON DELETE SET NULL,
  "status"                  "work_unit_status" NOT NULL DEFAULT 'pending',
  "title"                   TEXT NOT NULL,
  "type"                    TEXT NOT NULL,
  "assignee"                TEXT,
  -- text[] for dependency IDs (cuid2 strings, not UUIDs — matches codebase ID convention)
  "dependencies"            TEXT[] NOT NULL DEFAULT '{}',
  "labels"                  TEXT[] NOT NULL DEFAULT '{}',
  "metadata"                JSONB DEFAULT '{}',
  "created_at"              TIMESTAMP NOT NULL DEFAULT NOW(),
  "updated_at"              TIMESTAMP NOT NULL DEFAULT NOW(),
  "completed_at"            TIMESTAMP
);

-- =====================================================================
-- INDEXES
-- =====================================================================

-- coordination_groups: composite index for tenant + status queries
CREATE INDEX "coord_groups_tenant_status_idx"
  ON "coordination_groups" ("tenant_id", "status");

-- work_units: composite index for tenant + status queries (most common access path)
CREATE INDEX "work_units_tenant_status_idx"
  ON "work_units" ("tenant_id", "status");

-- work_units: group lookup — used when evaluating completion policies
CREATE INDEX "work_units_coordination_group_idx"
  ON "work_units" ("coordination_group_id");

-- work_units: tenant + session composite — common access pattern for session-scoped work
CREATE INDEX "work_units_tenant_session_idx"
  ON "work_units" ("tenant_id", "session_id");
