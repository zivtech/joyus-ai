-- WP01: Gateway Event Bus Tables
-- Tenant-scoped platform event fanout, delivery attempts, optional channel
-- connections, decision ingestion, and sanitized audit records.
-- Generated: 2026-05-25
-- Note: This migration was authored manually to match the existing hand-authored
--       migration pattern used for orchestrator and coordination tables.

-- =====================================================================
-- ENUM TYPES
-- =====================================================================

CREATE TYPE "public"."gateway_event_severity" AS ENUM(
  'info',
  'warning',
  'critical'
);

CREATE TYPE "public"."gateway_endpoint_type" AS ENUM(
  'dashboard',
  'webhook',
  'slack',
  'email',
  'channel'
);

CREATE TYPE "public"."gateway_delivery_status" AS ENUM(
  'pending',
  'sent',
  'failed',
  'retry_scheduled',
  'dead_letter',
  'skipped_no_channel'
);

CREATE TYPE "public"."gateway_decision" AS ENUM(
  'approved',
  'rejected',
  'request_changes',
  'acknowledged',
  'dismissed'
);

CREATE TYPE "public"."gateway_decision_route_status" AS ENUM(
  'pending',
  'routed',
  'failed',
  'rejected'
);

CREATE TYPE "public"."gateway_channel_connection_status" AS ENUM(
  'connected',
  'stale',
  'disconnected'
);

CREATE TYPE "public"."gateway_audit_action" AS ENUM(
  'event.accepted',
  'event.duplicate',
  'delivery.created',
  'delivery.sent',
  'delivery.failed',
  'delivery.retry_scheduled',
  'delivery.dead_lettered',
  'delivery.skipped_no_channel',
  'decision.accepted',
  'decision.duplicate',
  'decision.routed',
  'decision.failed',
  'decision.rejected'
);

-- =====================================================================
-- TABLES
-- =====================================================================

CREATE TABLE "gateway_platform_events" (
  "id"                     TEXT PRIMARY KEY,
  "tenant_id"              TEXT NOT NULL,
  "type"                   TEXT NOT NULL,
  "severity"               "gateway_event_severity" NOT NULL,
  "source_spec"            TEXT NOT NULL,
  "source_component"       TEXT NOT NULL,
  "subject_type"           TEXT,
  "subject_id"             TEXT,
  "correlation_id"         TEXT,
  "idempotency_key"        TEXT NOT NULL,
  "payload"                JSONB NOT NULL,
  "payload_schema_version" TEXT NOT NULL,
  "requires_decision"      BOOLEAN NOT NULL DEFAULT FALSE,
  "handler_key"            TEXT,
  "occurred_at"            TIMESTAMP NOT NULL,
  "emitted_at"             TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE TABLE "gateway_delivery_endpoints" (
  "id"         TEXT PRIMARY KEY,
  "tenant_id"  TEXT NOT NULL,
  "type"       "gateway_endpoint_type" NOT NULL,
  "name"       TEXT NOT NULL,
  "config"     JSONB NOT NULL DEFAULT '{}',
  "secret_ref" TEXT,
  "is_active"  BOOLEAN NOT NULL DEFAULT TRUE,
  "created_by" TEXT,
  "created_at" TIMESTAMP NOT NULL DEFAULT NOW(),
  "updated_at" TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE TABLE "gateway_event_subscriptions" (
  "id"               TEXT PRIMARY KEY,
  "tenant_id"        TEXT NOT NULL,
  "event_type"       TEXT NOT NULL,
  "minimum_severity" "gateway_event_severity",
  "endpoint_id"      TEXT NOT NULL REFERENCES "gateway_delivery_endpoints"("id") ON DELETE CASCADE,
  "filter"           JSONB,
  "is_enabled"       BOOLEAN NOT NULL DEFAULT TRUE,
  "created_at"       TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE TABLE "gateway_event_delivery_attempts" (
  "id"               TEXT PRIMARY KEY,
  "tenant_id"        TEXT NOT NULL,
  "event_id"         TEXT NOT NULL REFERENCES "gateway_platform_events"("id") ON DELETE CASCADE,
  "subscription_id"  TEXT NOT NULL REFERENCES "gateway_event_subscriptions"("id") ON DELETE CASCADE,
  "endpoint_id"      TEXT NOT NULL REFERENCES "gateway_delivery_endpoints"("id") ON DELETE CASCADE,
  "status"           "gateway_delivery_status" NOT NULL DEFAULT 'pending',
  "attempt_number"   INTEGER NOT NULL DEFAULT 1,
  "max_attempts"     INTEGER NOT NULL DEFAULT 3,
  "next_retry_at"    TIMESTAMP,
  "delivered_at"     TIMESTAMP,
  "last_error"       TEXT,
  "response_summary" JSONB,
  "created_at"       TIMESTAMP NOT NULL DEFAULT NOW(),
  "updated_at"       TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE TABLE "gateway_decisions" (
  "id"              TEXT PRIMARY KEY,
  "tenant_id"       TEXT NOT NULL,
  "event_id"        TEXT NOT NULL REFERENCES "gateway_platform_events"("id") ON DELETE CASCADE,
  "decision"        "gateway_decision" NOT NULL,
  "decision_by"     TEXT NOT NULL,
  "source_backend"  "gateway_endpoint_type" NOT NULL,
  "idempotency_key" TEXT NOT NULL,
  "metadata"        JSONB NOT NULL DEFAULT '{}',
  "received_at"     TIMESTAMP NOT NULL DEFAULT NOW(),
  "handler_key"     TEXT NOT NULL,
  "route_status"    "gateway_decision_route_status" NOT NULL DEFAULT 'pending',
  "route_error"     TEXT
);

CREATE TABLE "gateway_channel_connections" (
  "id"            TEXT PRIMARY KEY,
  "tenant_id"     TEXT NOT NULL,
  "admin_id"      TEXT,
  "connection_id" TEXT NOT NULL,
  "status"        "gateway_channel_connection_status" NOT NULL DEFAULT 'connected',
  "capabilities"  JSONB NOT NULL DEFAULT '{}',
  "connected_at"  TIMESTAMP NOT NULL DEFAULT NOW(),
  "last_seen_at"  TIMESTAMP NOT NULL DEFAULT NOW(),
  "expires_at"    TIMESTAMP
);

CREATE TABLE "gateway_audit_records" (
  "id"                  TEXT PRIMARY KEY,
  "tenant_id"           TEXT NOT NULL,
  "action"              "gateway_audit_action" NOT NULL,
  "event_id"            TEXT REFERENCES "gateway_platform_events"("id") ON DELETE SET NULL,
  "delivery_attempt_id" TEXT REFERENCES "gateway_event_delivery_attempts"("id") ON DELETE SET NULL,
  "decision_id"         TEXT REFERENCES "gateway_decisions"("id") ON DELETE SET NULL,
  "endpoint_id"         TEXT REFERENCES "gateway_delivery_endpoints"("id") ON DELETE SET NULL,
  "source_backend"      "gateway_endpoint_type",
  "idempotency_key"     TEXT,
  "summary"             JSONB NOT NULL DEFAULT '{}',
  "error_summary"       TEXT,
  "created_at"          TIMESTAMP NOT NULL DEFAULT NOW()
);

-- =====================================================================
-- INDEXES
-- =====================================================================

CREATE INDEX "gw_events_tenant_type_emitted_idx"
  ON "gateway_platform_events" ("tenant_id", "type", "emitted_at");

CREATE INDEX "gw_events_tenant_subject_idx"
  ON "gateway_platform_events" ("tenant_id", "subject_type", "subject_id");

CREATE UNIQUE INDEX "gw_events_tenant_source_idem_unique"
  ON "gateway_platform_events" ("tenant_id", "source_component", "idempotency_key");

CREATE INDEX "gw_endpoints_tenant_type_active_idx"
  ON "gateway_delivery_endpoints" ("tenant_id", "type", "is_active");

CREATE INDEX "gw_subs_tenant_event_enabled_idx"
  ON "gateway_event_subscriptions" ("tenant_id", "event_type", "is_enabled");

CREATE INDEX "gw_subs_endpoint_idx"
  ON "gateway_event_subscriptions" ("endpoint_id");

CREATE INDEX "gw_attempts_tenant_event_idx"
  ON "gateway_event_delivery_attempts" ("tenant_id", "event_id");

CREATE INDEX "gw_attempts_tenant_status_retry_idx"
  ON "gateway_event_delivery_attempts" ("tenant_id", "status", "next_retry_at");

CREATE INDEX "gw_attempts_endpoint_status_idx"
  ON "gateway_event_delivery_attempts" ("endpoint_id", "status");

CREATE INDEX "gw_decisions_tenant_event_idx"
  ON "gateway_decisions" ("tenant_id", "event_id");

CREATE INDEX "gw_decisions_tenant_route_status_idx"
  ON "gateway_decisions" ("tenant_id", "route_status");

CREATE UNIQUE INDEX "gw_decisions_tenant_event_idem_unique"
  ON "gateway_decisions" ("tenant_id", "event_id", "idempotency_key");

CREATE INDEX "gw_channels_tenant_status_idx"
  ON "gateway_channel_connections" ("tenant_id", "status");

CREATE UNIQUE INDEX "gw_channels_tenant_connection_unique"
  ON "gateway_channel_connections" ("tenant_id", "connection_id");

CREATE INDEX "gw_audit_tenant_created_idx"
  ON "gateway_audit_records" ("tenant_id", "created_at");

CREATE INDEX "gw_audit_tenant_action_idx"
  ON "gateway_audit_records" ("tenant_id", "action");
