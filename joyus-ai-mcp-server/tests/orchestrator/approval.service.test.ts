/**
 * Unit tests for WorkflowApprovalService.
 *
 * DB calls are mocked; these tests focus on lifecycle, tenant scoping, and
 * expiration behavior for proposal-gated workflow approvals.
 */

import { describe, it, expect, vi } from 'vitest';

import {
  ApprovalAlreadyTerminalError,
  ApprovalExpiredError,
  ApprovalNotFoundError,
  WorkflowApprovalService,
} from '../../src/orchestrator/approval.service.js';

const NOW = new Date('2026-05-25T16:00:00.000Z');
const TENANT = 'tenant-a';

type ApprovalRow = {
  id: string;
  tenantId: string;
  workflowRunId: string;
  proposalId: string;
  proposalSummary: string;
  proposalRef: Record<string, unknown> | null;
  status: 'pending' | 'approved' | 'rejected' | 'expired';
  reviewerId: string | null;
  feedback: Record<string, unknown> | null;
  metadata: Record<string, unknown>;
  expiresAt: Date;
  decidedAt: Date | null;
  escalatedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
};

function approvalRow(overrides: Partial<ApprovalRow> = {}): ApprovalRow {
  return {
    id: 'approval-1',
    tenantId: TENANT,
    workflowRunId: 'workflow-1',
    proposalId: 'proposal-1',
    proposalSummary: 'Update button label contrast',
    proposalRef: { issueKey: 'PROJ-123' },
    status: 'pending',
    reviewerId: null,
    feedback: null,
    metadata: {},
    expiresAt: new Date('2026-05-27T16:00:00.000Z'),
    decidedAt: null,
    escalatedAt: null,
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides,
  };
}

function makeChainableRows(rows: unknown[]) {
  const result = [...rows] as unknown[] & {
    where: ReturnType<typeof vi.fn>;
    orderBy: ReturnType<typeof vi.fn>;
    limit: ReturnType<typeof vi.fn>;
  };

  result.where = vi.fn().mockReturnValue(result);
  result.orderBy = vi.fn().mockReturnValue(result);
  result.limit = vi.fn().mockResolvedValue(rows);

  return result;
}

function makeDb(options: {
  selectResults?: unknown[][];
  updateResults?: unknown[][];
} = {}) {
  let selectIndex = 0;
  let updateIndex = 0;
  const insertValues: unknown[] = [];
  const updateValues: unknown[] = [];

  const db = {
    insert: vi.fn().mockReturnValue({
      values: vi.fn().mockImplementation((values) => {
        insertValues.push(values);
        return {
          returning: vi.fn().mockResolvedValue([
            approvalRow({
              id: 'approval-created',
              ...values,
            }),
          ]),
        };
      }),
    }),
    select: vi.fn().mockImplementation(() => {
      const rows = options.selectResults?.[selectIndex] ?? [];
      selectIndex++;
      return {
        from: vi.fn().mockReturnValue(makeChainableRows(rows)),
      };
    }),
    update: vi.fn().mockReturnValue({
      set: vi.fn().mockImplementation((values) => {
        updateValues.push(values);
        const rows = options.updateResults?.[updateIndex] ?? [];
        updateIndex++;
        return {
          where: vi.fn().mockReturnValue({
            returning: vi.fn().mockResolvedValue(rows),
          }),
        };
      }),
    }),
    _insertValues: insertValues,
    _updateValues: updateValues,
  };

  return db;
}

describe('WorkflowApprovalService.createApprovalRequest', () => {
  it('persists a pending approval request with an expiration timestamp', async () => {
    const db = makeDb();
    const service = new WorkflowApprovalService(db as never);

    const result = await service.createApprovalRequest(
      TENANT,
      {
        workflowRunId: 'workflow-1',
        proposalId: 'proposal-1',
        proposalSummary: 'Update button label contrast',
        reviewerId: 'reviewer-1',
        expiresInHours: 2,
        metadata: { source: 'workflow' },
      },
      { now: NOW },
    );

    expect(result.status).toBe('pending');
    expect(result.canProceed).toBe(false);
    expect(result.blockReason).toBe('approval_pending');
    expect(result.expiresAt).toEqual(new Date('2026-05-25T18:00:00.000Z'));
    expect(db._insertValues[0]).toMatchObject({
      tenantId: TENANT,
      workflowRunId: 'workflow-1',
      proposalId: 'proposal-1',
      reviewerId: 'reviewer-1',
      status: 'pending',
    });
  });
});

describe('WorkflowApprovalService.getApprovalStatus', () => {
  it('returns pending state as a machine-readable block', async () => {
    const db = makeDb({ selectResults: [[approvalRow()]] });
    const service = new WorkflowApprovalService(db as never);

    const result = await service.getApprovalStatus(TENANT, 'approval-1', { now: NOW });

    expect(result.status).toBe('pending');
    expect(result.canProceed).toBe(false);
    expect(result.blockReason).toBe('approval_pending');
  });

  it('fails closed for another tenant approval', async () => {
    const db = makeDb({ selectResults: [[]] });
    const service = new WorkflowApprovalService(db as never);

    await expect(
      service.getApprovalStatus('tenant-b', 'approval-1'),
    ).rejects.toThrow(ApprovalNotFoundError);
  });
});

describe('WorkflowApprovalService.decideApproval', () => {
  it('approves a pending approval and records reviewer metadata', async () => {
    const approved = approvalRow({
      status: 'approved',
      reviewerId: 'reviewer-2',
      decidedAt: NOW,
      updatedAt: NOW,
    });
    const db = makeDb({
      selectResults: [[approvalRow()]],
      updateResults: [[approved]],
    });
    const service = new WorkflowApprovalService(db as never);

    const result = await service.decideApproval(
      TENANT,
      'approval-1',
      { decision: 'approved', reviewerId: 'reviewer-2' },
      { now: NOW },
    );

    expect(result.status).toBe('approved');
    expect(result.canProceed).toBe(true);
    expect(result.blockReason).toBeNull();
    expect(db._updateValues[0]).toMatchObject({
      status: 'approved',
      reviewerId: 'reviewer-2',
      decidedAt: NOW,
    });
  });

  it('rejects a pending approval and records feedback', async () => {
    const rejected = approvalRow({
      status: 'rejected',
      reviewerId: 'reviewer-1',
      feedback: { reason: 'Needs a smaller change' },
      decidedAt: NOW,
      updatedAt: NOW,
    });
    const db = makeDb({
      selectResults: [[approvalRow({ reviewerId: 'reviewer-1' })]],
      updateResults: [[rejected]],
    });
    const service = new WorkflowApprovalService(db as never);

    const result = await service.decideApproval(
      TENANT,
      'approval-1',
      {
        decision: 'rejected',
        feedback: { reason: 'Needs a smaller change' },
      },
      { now: NOW },
    );

    expect(result.status).toBe('rejected');
    expect(result.canProceed).toBe(false);
    expect(result.blockReason).toBe('approval_rejected');
    expect(db._updateValues[0]).toMatchObject({
      status: 'rejected',
      reviewerId: 'reviewer-1',
      feedback: { reason: 'Needs a smaller change' },
    });
  });

  it('rejects duplicate decisions on terminal approvals', async () => {
    const db = makeDb({
      selectResults: [[approvalRow({ status: 'approved', decidedAt: NOW })]],
    });
    const service = new WorkflowApprovalService(db as never);

    await expect(
      service.decideApproval(TENANT, 'approval-1', { decision: 'approved' }, { now: NOW }),
    ).rejects.toThrow(ApprovalAlreadyTerminalError);
    expect(db.update).not.toHaveBeenCalled();
  });

  it('expires a timed-out pending approval instead of approving it', async () => {
    const expiredAt = new Date('2026-05-25T15:00:00.000Z');
    const expired = approvalRow({
      status: 'expired',
      expiresAt: expiredAt,
      escalatedAt: NOW,
      updatedAt: NOW,
    });
    const db = makeDb({
      selectResults: [[approvalRow({ expiresAt: expiredAt })]],
      updateResults: [[expired]],
    });
    const service = new WorkflowApprovalService(db as never);

    await expect(
      service.decideApproval(TENANT, 'approval-1', { decision: 'approved' }, { now: NOW }),
    ).rejects.toThrow(ApprovalExpiredError);
    expect(db._updateValues[0]).toMatchObject({
      status: 'expired',
      escalatedAt: NOW,
    });
  });
});

describe('WorkflowApprovalService.expireDueApprovals', () => {
  it('expires due pending approvals and records escalation metadata', async () => {
    const due = approvalRow({ expiresAt: new Date('2026-05-25T15:00:00.000Z') });
    const expired = approvalRow({
      status: 'expired',
      expiresAt: due.expiresAt,
      escalatedAt: NOW,
      updatedAt: NOW,
    });
    const hook = vi.fn().mockResolvedValue({ eventType: 'workflow_approval.expired', status: 'queued' });
    const db = makeDb({
      selectResults: [[due]],
      updateResults: [[expired]],
    });
    const service = new WorkflowApprovalService(db as never, hook);

    const result = await service.expireDueApprovals(TENANT, { now: NOW, limit: 10 });

    expect(result.count).toBe(1);
    expect(result.expiredApprovals[0]).toMatchObject({
      approvalId: 'approval-1',
      status: 'expired',
      escalation: { eventType: 'workflow_approval.expired', status: 'queued' },
    });
    expect(hook).toHaveBeenCalledWith({
      approval: expired,
      tenantId: TENANT,
      expiredAt: NOW,
    });
  });

  it('does not expire terminal approvals returned by the pending query', async () => {
    const db = makeDb({ selectResults: [[]] });
    const service = new WorkflowApprovalService(db as never);

    const result = await service.expireDueApprovals(TENANT, { now: NOW });

    expect(result.count).toBe(0);
    expect(db.update).not.toHaveBeenCalled();
  });
});
