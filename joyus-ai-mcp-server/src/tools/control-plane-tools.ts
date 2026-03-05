/**
 * Control Plane Tool Definitions
 */

import type { ToolDefinition } from './index.js';

export const controlPlaneToolNames = [
  'verify_before_action',
  'request_workspace',
  'submit_output',
  'get_provenance',
  'request_approval',
  'resolve_approval',
  'get_approval_status',
  'get_governance_metrics',
] as const;

export type ControlPlaneToolName = typeof controlPlaneToolNames[number];

export function isControlPlaneToolName(toolName: string): toolName is ControlPlaneToolName {
  return (controlPlaneToolNames as readonly string[]).includes(toolName);
}

export const controlPlaneTools: ToolDefinition[] = [
  {
    name: 'verify_before_action',
    description:
      'Request a policy decision token before privileged action execution.',
    inputSchema: {
      type: 'object',
      properties: {
        tenant_id: { type: 'string', description: 'Tenant identifier' },
        workspace_id: { type: 'string', description: 'Optional workspace identifier' },
        session_id: { type: 'string', description: 'Active session identifier' },
        action_name: { type: 'string', description: 'Action identifier' },
        risk_level: { type: 'string', enum: ['low', 'medium', 'high'] },
        target: { type: 'string', description: 'Optional action target' },
        details: { type: 'object', description: 'Optional structured action details' },
        metadata: { type: 'object', description: 'Optional policy metadata flags' },
      },
      required: ['tenant_id', 'session_id', 'action_name', 'risk_level'],
    },
  },
  {
    name: 'request_workspace',
    description:
      'Create and return a managed workspace allocation for a tenant session.',
    inputSchema: {
      type: 'object',
      properties: {
        tenant_id: { type: 'string', description: 'Tenant identifier' },
        mode: { type: 'string', enum: ['managed_remote', 'local'] },
        label: { type: 'string', description: 'Optional human-readable workspace label' },
      },
      required: ['tenant_id'],
    },
  },
  {
    name: 'submit_output',
    description:
      'Write mediated output metadata to the event ledger and optionally register a related artifact.',
    inputSchema: {
      type: 'object',
      properties: {
        tenant_id: { type: 'string', description: 'Tenant identifier' },
        workspace_id: { type: 'string', description: 'Workspace identifier' },
        session_id: { type: 'string', description: 'Session identifier' },
        action_type: { type: 'string', description: 'Action category' },
        risk_level: { type: 'string', enum: ['low', 'medium', 'high'] },
        policy_result: { type: 'string', enum: ['allow', 'deny', 'escalate'] },
        runtime_target: { type: 'string', enum: ['local', 'remote'] },
        policy_decision_jti: { type: 'string' },
        policy_decision_token: { type: 'string' },
        skill_ids: { type: 'array', items: { type: 'string' } },
        artifact_ids: { type: 'array', items: { type: 'string' } },
        outcome: { type: 'string', enum: ['pass', 'fail', 'warn'] },
        error_code: { type: 'string' },
        latency_ms: { type: 'number' },
        details: { type: 'object' },
        artifact: {
          type: 'object',
          properties: {
            artifact_type: { type: 'string' },
            uri: { type: 'string' },
            policy_decision_jti: { type: 'string' },
            skill_ids: { type: 'array', items: { type: 'string' } },
            metadata: { type: 'object' },
          },
          required: ['artifact_type', 'uri'],
        },
      },
      required: [
        'tenant_id',
        'workspace_id',
        'session_id',
        'action_type',
        'risk_level',
        'policy_result',
        'runtime_target',
        'policy_decision_jti',
        'policy_decision_token',
      ],
    },
  },
  {
    name: 'get_provenance',
    description:
      'Fetch artifact provenance including the artifact record and related control-plane events.',
    inputSchema: {
      type: 'object',
      properties: {
        artifact_id: { type: 'string', description: 'Artifact identifier' },
      },
      required: ['artifact_id'],
    },
  },
  {
    name: 'request_approval',
    description: 'Create an approval request for an escalated policy decision.',
    inputSchema: {
      type: 'object',
      properties: {
        tenant_id: { type: 'string' },
        workspace_id: { type: 'string' },
        session_id: { type: 'string' },
        action_type: { type: 'string' },
        risk_level: { type: 'string', enum: ['low', 'medium', 'high'] },
        policy_decision_jti: { type: 'string' },
        request_reason: { type: 'string' },
        ttl_seconds: { type: 'number' },
        metadata: { type: 'object' },
      },
      required: ['tenant_id', 'session_id', 'action_type', 'risk_level', 'policy_decision_jti'],
    },
  },
  {
    name: 'resolve_approval',
    description: 'Resolve a pending approval request as approve or deny.',
    inputSchema: {
      type: 'object',
      properties: {
        approval_id: { type: 'string' },
        tenant_id: { type: 'string' },
        decision: { type: 'string', enum: ['approve', 'deny'] },
        decision_reason: { type: 'string' },
      },
      required: ['approval_id', 'tenant_id', 'decision'],
    },
  },
  {
    name: 'get_approval_status',
    description: 'Get the current status of an approval request.',
    inputSchema: {
      type: 'object',
      properties: {
        approval_id: { type: 'string' },
      },
      required: ['approval_id'],
    },
  },
  {
    name: 'get_governance_metrics',
    description: 'Get governance metrics for policy, approvals, and audit activity.',
    inputSchema: {
      type: 'object',
      properties: {},
    },
  },
];
