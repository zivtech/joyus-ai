import { createId } from '@paralleldrive/cuid2';

import type {
  ActionProposal,
  ActionProposalType,
  ActionProposalTargetEntityType,
  JudgeResult,
} from '../types.js';

export const MEDIATION_APPROVAL_AGUI_VERSION = 'mediation-approval-agui-v1';
export const DEFAULT_MEDIATION_APPROVAL_TTL_MS = 48 * 60 * 60 * 1000;

export const MEDIATION_APPROVAL_AGUI_EVENT_NAMES = {
  requested: 'mediation.approval.requested',
  decided: 'mediation.approval.decided',
} as const;

export const MEDIATION_APPROVAL_DECISIONS = ['approve', 'reject', 'revise_with_edits'] as const;

export type MediationApprovalDecision = (typeof MEDIATION_APPROVAL_DECISIONS)[number];
export type MediationApprovalKind = 'approval_request' | 'revision_request';
export type MediationApprovalNextAction = 'execute' | 'cancel' | 'rerun_judge';

export interface AguiBaseEvent {
  type: string;
  timestamp?: number;
  rawEvent?: unknown;
}

export interface AguiRunStartedEvent extends AguiBaseEvent {
  type: 'RUN_STARTED';
  threadId: string;
  runId: string;
  parentRunId?: string;
}

export interface AguiRunFinishedEvent extends AguiBaseEvent {
  type: 'RUN_FINISHED';
  threadId: string;
  runId: string;
  result?: unknown;
}

export interface AguiStateDeltaEvent extends AguiBaseEvent {
  type: 'STATE_DELTA';
  delta: Array<{
    op: 'add' | 'replace' | 'remove';
    path: string;
    value?: unknown;
  }>;
}

export interface AguiCustomEvent extends AguiBaseEvent {
  type: 'CUSTOM';
  name: string;
  value: unknown;
}

export type MediationApprovalAguiEvent =
  | AguiRunStartedEvent
  | AguiStateDeltaEvent
  | AguiCustomEvent
  | AguiRunFinishedEvent;

export interface MediationApprovalRequest {
  version: typeof MEDIATION_APPROVAL_AGUI_VERSION;
  approvalRequestId: string;
  kind: MediationApprovalKind;
  status: 'awaiting_user_decision';
  actionProposalId: string;
  judgmentId: string;
  judgeOutcome: 'revise' | 'escalate';
  actionType: ActionProposalType;
  actionTarget: {
    entityType: ActionProposalTargetEntityType;
    entityId: string;
  };
  payloadSummary: string;
  payloadRef?: {
    type: string;
    id: string;
  };
  judgment: {
    reasonCode: string;
    summary: string;
    policyVersion: string;
    judgedAt: string;
  };
  requiredRevision?: JudgeResult['requiredRevision'];
  escalation?: JudgeResult['escalation'];
  expiresAt: string;
  responseContract: {
    decisions: readonly MediationApprovalDecision[];
    reviseWithEditsRequires: readonly ['editedPayloadSummary'];
  };
  resume: {
    requestId: string | null;
    sessionId: string | null;
    actionProposalId: string;
    judgmentId: string;
  };
}

export interface CreateMediationApprovalRequestOptions {
  approvalRequestId?: string;
  now?: Date;
  ttlMs?: number;
}

export interface CreateMediationApprovalEventsOptions extends CreateMediationApprovalRequestOptions {
  threadId?: string;
  runId?: string;
  parentRunId?: string;
}

export interface CreateMediationApprovalResponseInput {
  approvalRequestId: string;
  actionProposalId: string;
  decision: MediationApprovalDecision;
  decidedAt?: Date;
  reviewerNote?: string;
  editedPayloadSummary?: string;
  editedPayloadRef?: {
    type: string;
    id: string;
  };
}

export interface MediationApprovalResponse {
  version: typeof MEDIATION_APPROVAL_AGUI_VERSION;
  approvalRequestId: string;
  actionProposalId: string;
  decision: MediationApprovalDecision;
  nextAction: MediationApprovalNextAction;
  decidedAt: string;
  reviewerNote?: string;
  editedPayloadSummary?: string;
  editedPayloadRef?: {
    type: string;
    id: string;
  };
}

function isApprovalDecision(value: string): value is MediationApprovalDecision {
  return MEDIATION_APPROVAL_DECISIONS.includes(value as MediationApprovalDecision);
}

function expiresAt(now: Date, ttlMs: number): string {
  return new Date(now.getTime() + ttlMs).toISOString();
}

function approvalKindFor(judgment: JudgeResult): MediationApprovalKind {
  return judgment.outcome === 'revise' ? 'revision_request' : 'approval_request';
}

function nextActionFor(decision: MediationApprovalDecision): MediationApprovalNextAction {
  if (decision === 'approve') return 'execute';
  if (decision === 'reject') return 'cancel';
  return 'rerun_judge';
}

export function createMediationApprovalRequest(
  proposal: ActionProposal,
  judgment: JudgeResult,
  options: CreateMediationApprovalRequestOptions = {}
): MediationApprovalRequest {
  if (judgment.outcome !== 'revise' && judgment.outcome !== 'escalate') {
    throw new Error(`Cannot create approval request for ${judgment.outcome} judgment`);
  }

  const now = options.now ?? new Date();
  const ttlMs = options.ttlMs ?? DEFAULT_MEDIATION_APPROVAL_TTL_MS;

  return {
    version: MEDIATION_APPROVAL_AGUI_VERSION,
    approvalRequestId: options.approvalRequestId ?? createId(),
    kind: approvalKindFor(judgment),
    status: 'awaiting_user_decision',
    actionProposalId: proposal.id,
    judgmentId: judgment.id,
    judgeOutcome: judgment.outcome,
    actionType: proposal.action.type,
    actionTarget: {
      entityType: proposal.action.target.entityType,
      entityId: proposal.action.target.entityId,
    },
    payloadSummary: proposal.action.payloadSummary,
    payloadRef: proposal.action.payloadRef,
    judgment: {
      reasonCode: judgment.reasonCode,
      summary: judgment.summary,
      policyVersion: judgment.policyVersion,
      judgedAt: judgment.judgedAt,
    },
    requiredRevision: judgment.requiredRevision,
    escalation: judgment.escalation,
    expiresAt: expiresAt(now, ttlMs),
    responseContract: {
      decisions: MEDIATION_APPROVAL_DECISIONS,
      reviseWithEditsRequires: ['editedPayloadSummary'],
    },
    resume: {
      requestId: proposal.context.requestId ?? null,
      sessionId: proposal.context.sessionId ?? null,
      actionProposalId: proposal.id,
      judgmentId: judgment.id,
    },
  };
}

export function createMediationApprovalAguiEvents(
  proposal: ActionProposal,
  judgment: JudgeResult,
  options: CreateMediationApprovalEventsOptions = {}
): MediationApprovalAguiEvent[] {
  const request = createMediationApprovalRequest(proposal, judgment, options);
  const timestamp = (options.now ?? new Date()).getTime();
  const threadId = options.threadId ?? proposal.context.sessionId ?? request.approvalRequestId;
  const runId = options.runId ?? request.approvalRequestId;

  return [
    {
      type: 'RUN_STARTED',
      threadId,
      runId,
      parentRunId: options.parentRunId,
      timestamp,
    },
    {
      type: 'STATE_DELTA',
      timestamp,
      delta: [
        {
          op: 'add',
          path: '/mediationApproval',
          value: request,
        },
      ],
    },
    {
      type: 'CUSTOM',
      name: MEDIATION_APPROVAL_AGUI_EVENT_NAMES.requested,
      value: request,
      timestamp,
    },
    {
      type: 'RUN_FINISHED',
      threadId,
      runId,
      timestamp,
      result: {
        status: request.status,
        approvalRequestId: request.approvalRequestId,
      },
    },
  ];
}

export function createMediationApprovalResponse(
  input: CreateMediationApprovalResponseInput
): MediationApprovalResponse {
  if (!isApprovalDecision(input.decision)) {
    throw new Error(`Unsupported approval decision: ${input.decision}`);
  }
  if (input.decision === 'revise_with_edits' && !input.editedPayloadSummary) {
    throw new Error('revise_with_edits requires editedPayloadSummary');
  }

  return {
    version: MEDIATION_APPROVAL_AGUI_VERSION,
    approvalRequestId: input.approvalRequestId,
    actionProposalId: input.actionProposalId,
    decision: input.decision,
    nextAction: nextActionFor(input.decision),
    decidedAt: (input.decidedAt ?? new Date()).toISOString(),
    reviewerNote: input.reviewerNote,
    editedPayloadSummary: input.editedPayloadSummary,
    editedPayloadRef: input.editedPayloadRef,
  };
}

export function createMediationApprovalDecisionEvent(
  response: MediationApprovalResponse,
  now = new Date()
): AguiCustomEvent {
  return {
    type: 'CUSTOM',
    name: MEDIATION_APPROVAL_AGUI_EVENT_NAMES.decided,
    value: response,
    timestamp: now.getTime(),
  };
}
