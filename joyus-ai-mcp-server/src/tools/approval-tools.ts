/**
 * Workflow Approval Tool Definitions
 */

import { ToolDefinition } from './index.js';

export const approvalTools: ToolDefinition[] = [
  {
    name: 'approval_create',
    description:
      'Create a durable approval request for proposal-gated workflow automation. Pending approvals block progression until approved.',
    inputSchema: {
      type: 'object',
      properties: {
        workflowRunId: {
          type: 'string',
          description: 'Workflow run or orchestrator session ID, such as workflow-1',
        },
        proposalId: {
          type: 'string',
          description: 'Proposal identifier, such as proposal-1 or PROJ-123',
        },
        proposalSummary: {
          type: 'string',
          description: 'Short generic proposal summary',
        },
        proposalRef: {
          type: 'object',
          description: 'Optional structured reference to the proposal source',
        },
        reviewerId: {
          type: 'string',
          description: 'Optional reviewer identifier',
        },
        expiresInHours: {
          type: 'number',
          description: 'Hours before an unanswered approval expires',
        },
        metadata: {
          type: 'object',
          description: 'Optional caller metadata',
        },
      },
      required: ['workflowRunId', 'proposalId', 'proposalSummary'],
    },
  },
  {
    name: 'approval_status',
    description:
      'Get the current approval state for a workflow proposal, including whether automation can proceed.',
    inputSchema: {
      type: 'object',
      properties: {
        approvalId: {
          type: 'string',
          description: 'Approval request ID returned by approval_create',
        },
      },
      required: ['approvalId'],
    },
  },
  {
    name: 'approval_decide',
    description:
      'Record an approval or rejection for a pending workflow proposal. Approved requests allow proposal-gated automation to proceed.',
    inputSchema: {
      type: 'object',
      properties: {
        approvalId: {
          type: 'string',
          description: 'Approval request ID',
        },
        decision: {
          type: 'string',
          enum: ['approved', 'rejected'],
          description: 'Approval outcome',
        },
        reviewerId: {
          type: 'string',
          description: 'Reviewer identifier to record with the decision',
        },
        feedback: {
          type: 'object',
          description: 'Optional structured feedback for the decision',
        },
      },
      required: ['approvalId', 'decision'],
    },
  },
  {
    name: 'approval_expire_due',
    description:
      'Expire pending workflow approvals whose timeout has passed and record escalation metadata without auto-approving.',
    inputSchema: {
      type: 'object',
      properties: {
        limit: {
          type: 'number',
          description: 'Maximum pending approvals to expire (default: 100, max: 500)',
        },
        now: {
          type: 'string',
          description: 'Optional ISO timestamp to use as the expiration cutoff',
        },
      },
    },
  },
];
