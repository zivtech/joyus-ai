import {
  canAccessTenant,
  decidePolicy,
  hasTenantRole,
  verifyPolicyDecisionToken,
  type RiskLevel,
} from '../../control-plane/service.js';
import {
  appendEventRecord,
  consumePolicyDecisionJtiRecord,
  createApprovalRequestRecord,
  createArtifactRecord,
  createWorkspaceRecord,
  getApprovalStatusRecord,
  getArtifactProvenanceRecord,
  getGovernanceMetricsSnapshot,
  issuePolicyDecisionJtiRecord,
  resolveApprovalRecord,
} from '../../control-plane/store.js';
import {
  isControlPlaneToolName,
  type ControlPlaneToolName,
} from '../control-plane-tools.js';

interface ControlPlaneExecutorContext {
  userId: string;
}

function requireString(input: Record<string, unknown>, key: string): string {
  const value = input[key];
  if (typeof value === 'string' && value.trim()) return value.trim();
  throw new Error(`Missing required parameter: ${key}`);
}

function optionalString(input: Record<string, unknown>, key: string): string | undefined {
  const value = input[key];
  if (typeof value === 'string' && value.trim()) return value.trim();
  return undefined;
}

function optionalRecord(input: Record<string, unknown>, key: string): Record<string, unknown> | undefined {
  const value = input[key];
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  return value as Record<string, unknown>;
}

function optionalStringArray(input: Record<string, unknown>, key: string): string[] | undefined {
  const value = input[key];
  if (value === undefined) return undefined;
  if (!Array.isArray(value)) {
    throw new Error(`Invalid parameter: ${key}`);
  }
  return value.filter((entry): entry is string => typeof entry === 'string' && entry.trim().length > 0);
}

function requireRiskLevel(input: Record<string, unknown>, key: string): RiskLevel {
  const value = input[key];
  if (value === 'low' || value === 'medium' || value === 'high') return value;
  throw new Error(`Invalid or missing parameter: ${key}`);
}

function requirePolicyOutcome(input: Record<string, unknown>, key: string): 'allow' | 'deny' | 'escalate' {
  const value = input[key];
  if (value === 'allow' || value === 'deny' || value === 'escalate') return value;
  throw new Error(`Invalid or missing parameter: ${key}`);
}

function requireRuntimeTarget(input: Record<string, unknown>, key: string): 'local' | 'remote' {
  const value = input[key];
  if (value === 'local' || value === 'remote') return value;
  throw new Error(`Invalid or missing parameter: ${key}`);
}

function optionalOutcome(input: Record<string, unknown>, key: string): 'pass' | 'fail' | 'warn' | undefined {
  const value = input[key];
  if (value === undefined) return undefined;
  if (value === 'pass' || value === 'fail' || value === 'warn') return value;
  throw new Error(`Invalid parameter: ${key}`);
}

function optionalMode(input: Record<string, unknown>, key: string): 'managed_remote' | 'local' | undefined {
  const value = input[key];
  if (value === undefined) return undefined;
  if (value === 'managed_remote' || value === 'local') return value;
  throw new Error(`Invalid parameter: ${key}`);
}

function optionalLatencyMs(input: Record<string, unknown>, key: string): number | undefined {
  const value = input[key];
  if (value === undefined) return undefined;
  if (typeof value !== 'number' || Number.isNaN(value) || value < 0) {
    throw new Error(`Invalid parameter: ${key}`);
  }
  return Math.floor(value);
}

function optionalPositiveInteger(input: Record<string, unknown>, key: string): number | undefined {
  const value = input[key];
  if (value === undefined) return undefined;
  if (typeof value !== 'number' || Number.isNaN(value) || value <= 0) {
    throw new Error(`Invalid parameter: ${key}`);
  }
  return Math.floor(value);
}

function ensureTenantAccess(userId: string, tenantId: string): void {
  if (!canAccessTenant(userId, tenantId)) {
    throw new Error(`User ${userId} cannot access tenant ${tenantId}`);
  }
}

function ensureTenantRole(userId: string, tenantId: string, roles: Array<'owner' | 'admin' | 'reviewer'>): void {
  if (!hasTenantRole(userId, tenantId, roles)) {
    throw new Error(`User ${userId} is missing required role for tenant ${tenantId}`);
  }
}

async function verifyBeforeAction(input: Record<string, unknown>, context: ControlPlaneExecutorContext): Promise<unknown> {
  const tenantId = requireString(input, 'tenant_id');
  ensureTenantAccess(context.userId, tenantId);

  const actionName = requireString(input, 'action_name');
  const riskLevel = requireRiskLevel(input, 'risk_level');
  const sessionId = requireString(input, 'session_id');
  const workspaceId = optionalString(input, 'workspace_id');
  const decision = decidePolicy({
    actor_user_id: context.userId,
    action: {
      name: actionName,
      risk_level: riskLevel,
      target: optionalString(input, 'target'),
      details: optionalRecord(input, 'details'),
    },
    session: {
      session_id: sessionId,
      tenant_id: tenantId,
      workspace_id: workspaceId,
    },
    metadata: optionalRecord(input, 'metadata'),
  });

  await issuePolicyDecisionJtiRecord(context.userId, {
    jti: decision.jti,
    tenant_id: tenantId,
    workspace_id: workspaceId,
    session_id: sessionId,
    action_name: actionName,
    risk_level: riskLevel,
    decision: decision.decision,
    token_expires_at: decision.token_expires_at,
  });

  return decision;
}

async function requestWorkspace(input: Record<string, unknown>, context: ControlPlaneExecutorContext): Promise<unknown> {
  const tenantId = requireString(input, 'tenant_id');
  ensureTenantAccess(context.userId, tenantId);

  return createWorkspaceRecord(context.userId, {
    tenant_id: tenantId,
    mode: optionalMode(input, 'mode') ?? 'managed_remote',
    label: optionalString(input, 'label'),
  });
}

async function submitOutput(input: Record<string, unknown>, context: ControlPlaneExecutorContext): Promise<unknown> {
  const tenantId = requireString(input, 'tenant_id');
  const workspaceId = requireString(input, 'workspace_id');
  const sessionId = requireString(input, 'session_id');
  const actionType = requireString(input, 'action_type');
  const riskLevel = requireRiskLevel(input, 'risk_level');
  const policyDecisionJti = requireString(input, 'policy_decision_jti');
  const policyDecisionToken = requireString(input, 'policy_decision_token');
  ensureTenantAccess(context.userId, tenantId);

  const verification = verifyPolicyDecisionToken(policyDecisionToken, {
    tenant_id: tenantId,
    workspace_id: workspaceId,
    session_id: sessionId,
    action: {
      name: actionType,
      risk_level: riskLevel,
    },
  });

  if (!verification.ok || !verification.payload) {
    throw new Error(`Invalid policy decision token: ${verification.reason}`);
  }

  if (verification.payload.jti !== policyDecisionJti) {
    throw new Error('Policy decision token jti does not match policy_decision_jti');
  }

  const consumeResult = await consumePolicyDecisionJtiRecord(context.userId, {
    jti: policyDecisionJti,
    tenant_id: tenantId,
    workspace_id: workspaceId,
    session_id: sessionId,
  });

  if (consumeResult === 'missing') {
    throw new Error(`Policy decision token not found: ${policyDecisionJti}`);
  }

  if (consumeResult === 'expired') {
    throw new Error(`Policy decision token expired: ${policyDecisionJti}`);
  }

  if (consumeResult === 'replayed') {
    throw new Error(`Policy decision token already used: ${policyDecisionJti}`);
  }

  const artifactInput = optionalRecord(input, 'artifact');
  const artifactIds = optionalStringArray(input, 'artifact_ids') ?? [];
  const skillIds = optionalStringArray(input, 'skill_ids');
  let createdArtifactId: string | null = null;

  if (artifactInput) {
    const artifact = await createArtifactRecord(context.userId, {
      tenant_id: tenantId,
      workspace_id: workspaceId,
      session_id: sessionId,
      artifact_type: requireString(artifactInput, 'artifact_type'),
      uri: requireString(artifactInput, 'uri'),
      policy_decision_jti: optionalString(artifactInput, 'policy_decision_jti') ?? policyDecisionJti,
      skill_ids: optionalStringArray(artifactInput, 'skill_ids') ?? skillIds,
      metadata: optionalRecord(artifactInput, 'metadata'),
    });
    createdArtifactId = artifact.artifact_id;
    artifactIds.push(artifact.artifact_id);
  }

  const event = await appendEventRecord(context.userId, {
    tenant_id: tenantId,
    workspace_id: workspaceId,
    session_id: sessionId,
    action_type: actionType,
    risk_level: riskLevel,
    policy_result: requirePolicyOutcome(input, 'policy_result'),
    runtime_target: requireRuntimeTarget(input, 'runtime_target'),
    skill_ids: skillIds,
    artifact_ids: Array.from(new Set(artifactIds)),
    outcome: optionalOutcome(input, 'outcome'),
    error_code: optionalString(input, 'error_code'),
    latency_ms: optionalLatencyMs(input, 'latency_ms'),
    details: optionalRecord(input, 'details'),
  });

  return {
    event_id: event.event_id,
    accepted_at: event.timestamp,
    artifact_id: createdArtifactId,
    artifact_ids: event.artifact_ids,
  };
}

async function getProvenance(input: Record<string, unknown>, context: ControlPlaneExecutorContext): Promise<unknown> {
  const artifactId = requireString(input, 'artifact_id');
  const provenance = await getArtifactProvenanceRecord(artifactId);

  if (!provenance) {
    throw new Error(`Artifact not found: ${artifactId}`);
  }

  ensureTenantAccess(context.userId, provenance.artifact.tenant_id);
  return provenance;
}

async function requestApproval(input: Record<string, unknown>, context: ControlPlaneExecutorContext): Promise<unknown> {
  const tenantId = requireString(input, 'tenant_id');
  ensureTenantAccess(context.userId, tenantId);

  return createApprovalRequestRecord(context.userId, {
    tenant_id: tenantId,
    workspace_id: optionalString(input, 'workspace_id'),
    session_id: requireString(input, 'session_id'),
    action_type: requireString(input, 'action_type'),
    risk_level: requireRiskLevel(input, 'risk_level'),
    policy_decision_jti: requireString(input, 'policy_decision_jti'),
    request_reason: optionalString(input, 'request_reason'),
    metadata: optionalRecord(input, 'metadata'),
    ttl_seconds: optionalPositiveInteger(input, 'ttl_seconds'),
  });
}

async function resolveApproval(input: Record<string, unknown>, context: ControlPlaneExecutorContext): Promise<unknown> {
  const tenantId = requireString(input, 'tenant_id');
  ensureTenantAccess(context.userId, tenantId);
  ensureTenantRole(context.userId, tenantId, ['owner', 'admin', 'reviewer']);

  const decision = requireString(input, 'decision');
  if (decision !== 'approve' && decision !== 'deny') {
    throw new Error('Invalid parameter: decision');
  }

  return resolveApprovalRecord(context.userId, {
    approval_id: requireString(input, 'approval_id'),
    decision,
    decision_reason: optionalString(input, 'decision_reason'),
  });
}

async function getApprovalStatus(input: Record<string, unknown>, context: ControlPlaneExecutorContext): Promise<unknown> {
  const approval = await getApprovalStatusRecord(requireString(input, 'approval_id'));
  if (!approval) {
    throw new Error('Approval request not found');
  }

  ensureTenantAccess(context.userId, approval.tenant_id);
  return approval;
}

async function getGovernanceMetrics(): Promise<unknown> {
  return getGovernanceMetricsSnapshot();
}

export async function executeControlPlaneTool(
  toolName: string,
  input: Record<string, unknown>,
  context: ControlPlaneExecutorContext,
): Promise<unknown> {
  if (!isControlPlaneToolName(toolName)) {
    throw new Error(`Unsupported control plane tool: ${toolName}`);
  }

  const typedName: ControlPlaneToolName = toolName;

  switch (typedName) {
    case 'verify_before_action':
      return verifyBeforeAction(input, context);
    case 'request_workspace':
      return requestWorkspace(input, context);
    case 'submit_output':
      return submitOutput(input, context);
    case 'get_provenance':
      return getProvenance(input, context);
    case 'request_approval':
      return requestApproval(input, context);
    case 'resolve_approval':
      return resolveApproval(input, context);
    case 'get_approval_status':
      return getApprovalStatus(input, context);
    case 'get_governance_metrics':
      return getGovernanceMetrics();
    default:
      throw new Error(`Unsupported control plane tool: ${toolName}`);
  }
}
