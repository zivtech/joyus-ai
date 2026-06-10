/**
 * Workflow Approval DB Schema
 *
 * Durable proposal approval state for workflow-wide, proposal-gated automation.
 * This stays separate from pipeline review decisions because approval requests
 * can be tied to orchestrator sessions, work units, external issues, or other
 * workflow runs without requiring pipeline execution rows.
 */

import { createId } from '@paralleldrive/cuid2';
import {
  index,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
} from 'drizzle-orm/pg-core';

export const workflowApprovalStatusEnum = pgEnum('workflow_approval_status', [
  'pending',
  'approved',
  'rejected',
  'expired',
]);

export const workflowApprovals = pgTable('workflow_approvals', {
  id: text('id').primaryKey().$defaultFn(() => createId()),

  // Multi-tenant partition key. All service queries include tenantId.
  tenantId: text('tenant_id').notNull(),

  // Workflow/proposal identifiers supplied by the caller.
  workflowRunId: text('workflow_run_id').notNull(),
  proposalId: text('proposal_id').notNull(),
  proposalSummary: text('proposal_summary').notNull(),
  proposalRef: jsonb('proposal_ref').$type<Record<string, unknown>>(),

  status: workflowApprovalStatusEnum('status').notNull().default('pending'),

  reviewerId: text('reviewer_id'),
  feedback: jsonb('feedback').$type<Record<string, unknown>>(),
  metadata: jsonb('metadata').$type<Record<string, unknown>>().default({}),

  expiresAt: timestamp('expires_at').notNull(),
  decidedAt: timestamp('decided_at'),
  escalatedAt: timestamp('escalated_at'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
}, (table) => ({
  tenantStatusIdx: index('workflow_approvals_tenant_status_idx').on(table.tenantId, table.status),
  tenantWorkflowIdx: index('workflow_approvals_tenant_workflow_idx').on(table.tenantId, table.workflowRunId),
  tenantProposalIdx: index('workflow_approvals_tenant_proposal_idx').on(table.tenantId, table.proposalId),
  pendingExpiryIdx: index('workflow_approvals_pending_expiry_idx').on(table.tenantId, table.status, table.expiresAt),
}));

export type WorkflowApproval = typeof workflowApprovals.$inferSelect;
export type NewWorkflowApproval = typeof workflowApprovals.$inferInsert;
export type WorkflowApprovalStatus = 'pending' | 'approved' | 'rejected' | 'expired';
