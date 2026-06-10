/**
 * WorkflowApprovalService
 *
 * Tenant-scoped approval lifecycle for proposal-gated automation. Pending
 * approvals block progression until a human records an approval decision.
 */

import { and, asc, eq, lte } from 'drizzle-orm';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';

import {
  workflowApprovals,
  type WorkflowApproval,
  type WorkflowApprovalStatus,
} from '../db/schema/approvals.js';

export const DEFAULT_APPROVAL_EXPIRES_IN_HOURS = 48;
export const MAX_APPROVAL_EXPIRES_IN_HOURS = 24 * 30;

export interface CreateApprovalRequestInput {
  workflowRunId: string;
  proposalId: string;
  proposalSummary: string;
  proposalRef?: Record<string, unknown>;
  reviewerId?: string;
  expiresInHours?: number;
  metadata?: Record<string, unknown>;
}

export interface DecideApprovalInput {
  decision: 'approved' | 'rejected';
  reviewerId?: string;
  feedback?: Record<string, unknown>;
}

export interface ExpireDueApprovalsInput {
  now?: Date;
  limit?: number;
}

export interface ApprovalState {
  approvalId: string;
  workflowRunId: string;
  proposalId: string;
  proposalSummary: string;
  proposalRef: Record<string, unknown> | null;
  status: WorkflowApprovalStatus;
  reviewerId: string | null;
  feedback: Record<string, unknown> | null;
  metadata: Record<string, unknown>;
  expiresAt: Date;
  decidedAt: Date | null;
  escalatedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
  canProceed: boolean;
  isTerminal: boolean;
  blockReason: 'approval_pending' | 'approval_rejected' | 'approval_expired' | null;
}

export interface ApprovalEscalationEvent {
  approval: WorkflowApproval;
  tenantId: string;
  expiredAt: Date;
}

export type ApprovalEscalationHook = (
  event: ApprovalEscalationEvent,
) => Promise<Record<string, unknown> | void> | Record<string, unknown> | void;

export interface ExpiredApprovalResult {
  approvalId: string;
  workflowRunId: string;
  proposalId: string;
  status: 'expired';
  escalatedAt: Date;
  escalation: Record<string, unknown>;
}

export class ApprovalNotFoundError extends Error {
  constructor(approvalId: string, tenantId: string) {
    super(`Approval request not found: ${approvalId} (tenant: ${tenantId})`);
    this.name = 'ApprovalNotFoundError';
  }
}

export class ApprovalAlreadyTerminalError extends Error {
  constructor(approvalId: string, status: WorkflowApprovalStatus) {
    super(`Approval request ${approvalId} is already ${status}`);
    this.name = 'ApprovalAlreadyTerminalError';
  }
}

export class ApprovalExpiredError extends Error {
  constructor(approvalId: string, expiresAt: Date) {
    super(`Approval request ${approvalId} expired at ${expiresAt.toISOString()}`);
    this.name = 'ApprovalExpiredError';
  }
}

export class InvalidApprovalExpirationError extends Error {
  constructor(expiresInHours: number) {
    super(
      `expiresInHours must be greater than 0 and no more than ${MAX_APPROVAL_EXPIRES_IN_HOURS}; received ${expiresInHours}`,
    );
    this.name = 'InvalidApprovalExpirationError';
  }
}

export class WorkflowApprovalService {
  constructor(
    private readonly db: NodePgDatabase<Record<string, unknown>>,
    private readonly escalationHook?: ApprovalEscalationHook,
  ) {}

  async createApprovalRequest(
    tenantId: string,
    input: CreateApprovalRequestInput,
    options: { now?: Date } = {},
  ): Promise<ApprovalState> {
    const now = options.now ?? new Date();
    const expiresInHours = input.expiresInHours ?? DEFAULT_APPROVAL_EXPIRES_IN_HOURS;
    this.assertValidExpiration(expiresInHours);

    const expiresAt = new Date(now.getTime() + expiresInHours * 60 * 60 * 1000);

    const [approval] = await this.db
      .insert(workflowApprovals)
      .values({
        tenantId,
        workflowRunId: input.workflowRunId,
        proposalId: input.proposalId,
        proposalSummary: input.proposalSummary,
        proposalRef: input.proposalRef ?? null,
        status: 'pending',
        reviewerId: input.reviewerId ?? null,
        feedback: null,
        metadata: input.metadata ?? {},
        expiresAt,
        decidedAt: null,
        escalatedAt: null,
        createdAt: now,
        updatedAt: now,
      })
      .returning();

    return this.toApprovalState(approval, now);
  }

  async getApprovalStatus(
    tenantId: string,
    approvalId: string,
    options: { now?: Date } = {},
  ): Promise<ApprovalState> {
    const approval = await this.getApprovalForTenant(tenantId, approvalId);
    return this.toApprovalState(approval, options.now ?? new Date());
  }

  async decideApproval(
    tenantId: string,
    approvalId: string,
    input: DecideApprovalInput,
    options: { now?: Date } = {},
  ): Promise<ApprovalState> {
    const now = options.now ?? new Date();
    const current = await this.getApprovalForTenant(tenantId, approvalId);

    if (current.status !== 'pending') {
      throw new ApprovalAlreadyTerminalError(approvalId, current.status);
    }

    if (current.expiresAt.getTime() <= now.getTime()) {
      await this.expireApproval(current, now);
      throw new ApprovalExpiredError(approvalId, current.expiresAt);
    }

    const [approval] = await this.db
      .update(workflowApprovals)
      .set({
        status: input.decision,
        reviewerId: input.reviewerId ?? current.reviewerId,
        feedback: input.feedback ?? null,
        decidedAt: now,
        updatedAt: now,
      })
      .where(and(
        eq(workflowApprovals.id, approvalId),
        eq(workflowApprovals.tenantId, tenantId),
        eq(workflowApprovals.status, 'pending'),
      ))
      .returning();

    if (!approval) {
      const latest = await this.getApprovalForTenant(tenantId, approvalId);
      throw new ApprovalAlreadyTerminalError(approvalId, latest.status);
    }

    return this.toApprovalState(approval, now);
  }

  async expireDueApprovals(
    tenantId: string,
    input: ExpireDueApprovalsInput = {},
  ): Promise<{ expiredApprovals: ExpiredApprovalResult[]; count: number; now: Date }> {
    const now = input.now ?? new Date();
    const limit = Math.min(Math.max(input.limit ?? 100, 1), 500);

    const dueApprovals = await this.db
      .select()
      .from(workflowApprovals)
      .where(and(
        eq(workflowApprovals.tenantId, tenantId),
        eq(workflowApprovals.status, 'pending'),
        lte(workflowApprovals.expiresAt, now),
      ))
      .orderBy(asc(workflowApprovals.expiresAt))
      .limit(limit);

    const expiredApprovals: ExpiredApprovalResult[] = [];

    for (const dueApproval of dueApprovals) {
      const approval = await this.expireApproval(dueApproval, now);
      const hookResult = await this.escalationHook?.({
        approval,
        tenantId,
        expiredAt: now,
      });

      expiredApprovals.push({
        approvalId: approval.id,
        workflowRunId: approval.workflowRunId,
        proposalId: approval.proposalId,
        status: 'expired',
        escalatedAt: approval.escalatedAt ?? now,
        escalation: hookResult ?? {
          eventType: 'workflow_approval.expired',
          status: 'recorded',
        },
      });
    }

    return { expiredApprovals, count: expiredApprovals.length, now };
  }

  private async getApprovalForTenant(
    tenantId: string,
    approvalId: string,
  ): Promise<WorkflowApproval> {
    const [approval] = await this.db
      .select()
      .from(workflowApprovals)
      .where(and(
        eq(workflowApprovals.id, approvalId),
        eq(workflowApprovals.tenantId, tenantId),
      ))
      .limit(1);

    if (!approval) {
      throw new ApprovalNotFoundError(approvalId, tenantId);
    }

    return approval;
  }

  private async expireApproval(
    approval: WorkflowApproval,
    now: Date,
  ): Promise<WorkflowApproval> {
    const [expired] = await this.db
      .update(workflowApprovals)
      .set({
        status: 'expired',
        escalatedAt: now,
        updatedAt: now,
      })
      .where(and(
        eq(workflowApprovals.id, approval.id),
        eq(workflowApprovals.tenantId, approval.tenantId),
        eq(workflowApprovals.status, 'pending'),
      ))
      .returning();

    return expired ?? { ...approval, status: 'expired', escalatedAt: now, updatedAt: now };
  }

  private toApprovalState(approval: WorkflowApproval, now: Date = new Date()): ApprovalState {
    const isExpiredPending =
      approval.status === 'pending' && approval.expiresAt.getTime() <= now.getTime();
    const status = isExpiredPending ? 'expired' : approval.status;
    const isTerminal = status !== 'pending';
    const canProceed = status === 'approved';

    return {
      approvalId: approval.id,
      workflowRunId: approval.workflowRunId,
      proposalId: approval.proposalId,
      proposalSummary: approval.proposalSummary,
      proposalRef: approval.proposalRef ?? null,
      status,
      reviewerId: approval.reviewerId ?? null,
      feedback: approval.feedback ?? null,
      metadata: approval.metadata ?? {},
      expiresAt: approval.expiresAt,
      decidedAt: approval.decidedAt ?? null,
      escalatedAt: approval.escalatedAt ?? null,
      createdAt: approval.createdAt,
      updatedAt: approval.updatedAt,
      canProceed,
      isTerminal,
      blockReason: this.blockReasonFor(status),
    };
  }

  private blockReasonFor(
    status: WorkflowApprovalStatus,
  ): ApprovalState['blockReason'] {
    switch (status) {
      case 'pending':
        return 'approval_pending';
      case 'rejected':
        return 'approval_rejected';
      case 'expired':
        return 'approval_expired';
      case 'approved':
        return null;
    }
  }

  private assertValidExpiration(expiresInHours: number): void {
    if (
      !Number.isFinite(expiresInHours) ||
      expiresInHours <= 0 ||
      expiresInHours > MAX_APPROVAL_EXPIRES_IN_HOURS
    ) {
      throw new InvalidApprovalExpirationError(expiresInHours);
    }
  }
}
