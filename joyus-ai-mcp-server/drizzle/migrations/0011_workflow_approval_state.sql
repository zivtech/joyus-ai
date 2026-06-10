-- Workflow Approval State
-- Durable approval requests for proposal-gated workflow automation.
-- Generated: 2026-05-25
-- Note: Authored manually to match the repository's recent migration pattern.

CREATE TYPE "public"."workflow_approval_status" AS ENUM(
  'pending',
  'approved',
  'rejected',
  'expired'
);

CREATE TABLE "workflow_approvals" (
  "id"               TEXT PRIMARY KEY,
  "tenant_id"        TEXT NOT NULL,
  "workflow_run_id"  TEXT NOT NULL,
  "proposal_id"      TEXT NOT NULL,
  "proposal_summary" TEXT NOT NULL,
  "proposal_ref"     JSONB,
  "status"           "workflow_approval_status" NOT NULL DEFAULT 'pending',
  "reviewer_id"      TEXT,
  "feedback"         JSONB,
  "metadata"         JSONB DEFAULT '{}',
  "expires_at"       TIMESTAMP NOT NULL,
  "decided_at"       TIMESTAMP,
  "escalated_at"     TIMESTAMP,
  "created_at"       TIMESTAMP NOT NULL DEFAULT NOW(),
  "updated_at"       TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE INDEX "workflow_approvals_tenant_status_idx"
  ON "workflow_approvals" ("tenant_id", "status");

CREATE INDEX "workflow_approvals_tenant_workflow_idx"
  ON "workflow_approvals" ("tenant_id", "workflow_run_id");

CREATE INDEX "workflow_approvals_tenant_proposal_idx"
  ON "workflow_approvals" ("tenant_id", "proposal_id");

CREATE INDEX "workflow_approvals_pending_expiry_idx"
  ON "workflow_approvals" ("tenant_id", "status", "expires_at");
