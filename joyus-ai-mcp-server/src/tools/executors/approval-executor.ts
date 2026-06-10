/**
 * Workflow Approval Tool Executor
 */

import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { z } from 'zod';

import { WorkflowApprovalService } from '../../orchestrator/approval.service.js';

const metadataSchema = z.record(z.unknown());

const CreateApprovalToolInput = z.object({
  workflowRunId: z.string().min(1),
  proposalId: z.string().min(1),
  proposalSummary: z.string().min(1),
  proposalRef: metadataSchema.optional(),
  reviewerId: z.string().min(1).optional(),
  expiresInHours: z.number().positive().optional(),
  metadata: metadataSchema.optional(),
});

const ApprovalStatusToolInput = z.object({
  approvalId: z.string().min(1),
});

const ApprovalDecideToolInput = z.object({
  approvalId: z.string().min(1),
  decision: z.enum(['approved', 'rejected']),
  reviewerId: z.string().min(1).optional(),
  feedback: metadataSchema.optional(),
});

const ApprovalExpireDueToolInput = z.object({
  limit: z.number().int().positive().max(500).optional(),
  now: z.string().datetime({ offset: true }).optional(),
});

export interface ApprovalExecutorContext {
  tenantId: string;
  db: NodePgDatabase<Record<string, unknown>>;
  approvalService?: WorkflowApprovalService;
}

export async function executeApprovalTool(
  toolName: string,
  input: Record<string, unknown>,
  context: ApprovalExecutorContext,
): Promise<unknown> {
  const approvalService =
    context.approvalService ?? new WorkflowApprovalService(context.db);

  switch (toolName) {
    case 'approval_create': {
      const parsed = CreateApprovalToolInput.safeParse(input);
      if (!parsed.success) {
        throw new Error(`Invalid approval input: ${formatIssues(parsed.error)}`);
      }

      return approvalService.createApprovalRequest(context.tenantId, parsed.data);
    }

    case 'approval_status': {
      const parsed = ApprovalStatusToolInput.safeParse(input);
      if (!parsed.success) {
        throw new Error(`Invalid approval status input: ${formatIssues(parsed.error)}`);
      }

      return approvalService.getApprovalStatus(context.tenantId, parsed.data.approvalId);
    }

    case 'approval_decide': {
      const parsed = ApprovalDecideToolInput.safeParse(input);
      if (!parsed.success) {
        throw new Error(`Invalid approval decision input: ${formatIssues(parsed.error)}`);
      }

      return approvalService.decideApproval(
        context.tenantId,
        parsed.data.approvalId,
        {
          decision: parsed.data.decision,
          reviewerId: parsed.data.reviewerId,
          feedback: parsed.data.feedback,
        },
      );
    }

    case 'approval_expire_due': {
      const parsed = ApprovalExpireDueToolInput.safeParse(input);
      if (!parsed.success) {
        throw new Error(`Invalid approval expiration input: ${formatIssues(parsed.error)}`);
      }

      return approvalService.expireDueApprovals(context.tenantId, {
        limit: parsed.data.limit,
        now: parsed.data.now ? new Date(parsed.data.now) : undefined,
      });
    }

    default:
      throw new Error(`Unknown approval tool: ${toolName}`);
  }
}

function formatIssues(error: z.ZodError): string {
  return error.issues.map((issue) => issue.message).join(', ');
}
