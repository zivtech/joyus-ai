/**
 * Tests for approval_* MCP tool executor routing and validation.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

import { executeApprovalTool, type ApprovalExecutorContext } from '../../src/tools/executors/approval-executor.js';

function makeApprovalService() {
  return {
    createApprovalRequest: vi.fn().mockResolvedValue({ approvalId: 'approval-1', status: 'pending' }),
    getApprovalStatus: vi.fn().mockResolvedValue({ approvalId: 'approval-1', status: 'pending' }),
    decideApproval: vi.fn().mockResolvedValue({ approvalId: 'approval-1', status: 'approved' }),
    expireDueApprovals: vi.fn().mockResolvedValue({ expiredApprovals: [], count: 0 }),
  };
}

describe('executeApprovalTool', () => {
  let approvalService: ReturnType<typeof makeApprovalService>;
  let context: ApprovalExecutorContext;

  beforeEach(() => {
    approvalService = makeApprovalService();
    context = {
      tenantId: 'tenant-a',
      db: {} as ApprovalExecutorContext['db'],
      approvalService: approvalService as unknown as ApprovalExecutorContext['approvalService'],
    };
  });

  it('delegates approval_create with validated input', async () => {
    const result = await executeApprovalTool(
      'approval_create',
      {
        workflowRunId: 'workflow-1',
        proposalId: 'proposal-1',
        proposalSummary: 'Fix form field association',
        proposalRef: { issueKey: 'PROJ-123' },
        expiresInHours: 4,
      },
      context,
    );

    expect(result).toEqual({ approvalId: 'approval-1', status: 'pending' });
    expect(approvalService.createApprovalRequest).toHaveBeenCalledWith(
      'tenant-a',
      expect.objectContaining({
        workflowRunId: 'workflow-1',
        proposalId: 'proposal-1',
        proposalSummary: 'Fix form field association',
      }),
    );
  });

  it('delegates approval_status', async () => {
    await executeApprovalTool('approval_status', { approvalId: 'approval-1' }, context);

    expect(approvalService.getApprovalStatus).toHaveBeenCalledWith('tenant-a', 'approval-1');
  });

  it('delegates approval_decide with reviewer feedback', async () => {
    await executeApprovalTool(
      'approval_decide',
      {
        approvalId: 'approval-1',
        decision: 'rejected',
        reviewerId: 'reviewer-1',
        feedback: { reason: 'Needs a smaller scope' },
      },
      context,
    );

    expect(approvalService.decideApproval).toHaveBeenCalledWith(
      'tenant-a',
      'approval-1',
      {
        decision: 'rejected',
        reviewerId: 'reviewer-1',
        feedback: { reason: 'Needs a smaller scope' },
      },
    );
  });

  it('delegates approval_expire_due with an ISO cutoff', async () => {
    await executeApprovalTool(
      'approval_expire_due',
      { now: '2026-05-25T16:00:00.000Z', limit: 20 },
      context,
    );

    expect(approvalService.expireDueApprovals).toHaveBeenCalledWith(
      'tenant-a',
      {
        limit: 20,
        now: new Date('2026-05-25T16:00:00.000Z'),
      },
    );
  });

  it('rejects invalid decisions', async () => {
    await expect(
      executeApprovalTool(
        'approval_decide',
        { approvalId: 'approval-1', decision: 'maybe' },
        context,
      ),
    ).rejects.toThrow('Invalid approval decision input');
  });

  it('throws for unknown approval tools', async () => {
    await expect(
      executeApprovalTool('approval_unknown', {}, context),
    ).rejects.toThrow('Unknown approval tool');
  });
});
