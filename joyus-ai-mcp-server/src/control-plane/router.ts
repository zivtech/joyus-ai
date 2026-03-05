import { Router, type Response } from 'express';
import { z } from 'zod';

import { requireTokenAuth, type AuthenticatedRequest } from '../auth/middleware.js';
import {
  canAccessTenant,
  getPolicyPublicKeys,
  hasTenantRole,
  decidePolicy,
  resolveSkills,
} from './service.js';
import {
  appendEventRecord,
  createApprovalRequestRecord,
  createArtifactRecord,
  createWorkspaceRecord,
  getApprovalStatusRecord,
  getArtifactProvenanceRecord,
  getGovernanceMetricsSnapshot,
  issuePolicyDecisionJtiRecord,
  resolveApprovalRecord,
} from './store.js';

const riskSchema = z.enum(['low', 'medium', 'high']);

const policyInputSchema = z.object({
  action: z.object({
    name: z.string().min(1),
    risk_level: riskSchema,
    target: z.string().optional(),
    details: z.record(z.string(), z.unknown()).optional(),
  }),
  session: z.object({
    session_id: z.string().min(1),
    tenant_id: z.string().min(1),
    workspace_id: z.string().optional(),
  }),
  metadata: z.record(z.string(), z.unknown()).optional(),
});

const eventInputSchema = z.object({
  tenant_id: z.string().min(1),
  workspace_id: z.string().optional(),
  session_id: z.string().min(1),
  action_type: z.string().min(1),
  risk_level: riskSchema,
  policy_result: z.enum(['allow', 'deny', 'escalate']),
  runtime_target: z.enum(['local', 'remote']),
  skill_ids: z.array(z.string()).optional(),
  artifact_ids: z.array(z.string()).optional(),
  outcome: z.enum(['pass', 'fail', 'warn']).optional(),
  error_code: z.string().optional(),
  latency_ms: z.number().int().nonnegative().optional(),
  details: z.record(z.string(), z.unknown()).optional(),
});

const workspaceInputSchema = z.object({
  tenant_id: z.string().min(1),
  mode: z.enum(['managed_remote', 'local']),
  label: z.string().optional(),
});

const artifactInputSchema = z.object({
  tenant_id: z.string().min(1),
  workspace_id: z.string().min(1),
  session_id: z.string().min(1),
  artifact_type: z.string().min(1),
  uri: z.string().min(1),
  policy_decision_jti: z.string().min(1),
  skill_ids: z.array(z.string()).optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
});

const approvalRequestSchema = z.object({
  tenant_id: z.string().min(1),
  workspace_id: z.string().optional(),
  session_id: z.string().min(1),
  action_type: z.string().min(1),
  risk_level: riskSchema,
  policy_decision_jti: z.string().min(1),
  request_reason: z.string().optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
  ttl_seconds: z.number().int().positive().optional(),
});

const approvalResolveSchema = z.object({
  approval_id: z.string().min(1),
  tenant_id: z.string().min(1),
  decision: z.enum(['approve', 'deny']),
  decision_reason: z.string().optional(),
});

const skillsResolveSchema = z.object({
  tenant_id: z.string().min(1),
  file_path: z.string().optional(),
  requested_skill_ids: z.array(z.string()).optional(),
  language: z.string().optional(),
});

function parseOr400<T>(schema: z.ZodSchema<T>, input: unknown, res: Response): T | null {
  const parsed = schema.safeParse(input);
  if (!parsed.success) {
    res.status(400).json({
      error: 'invalid_request',
      message: parsed.error.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`).join('; '),
    });
    return null;
  }

  return parsed.data;
}

function requireTenantAccessOr403(userId: string, tenantId: string, res: Response): boolean {
  if (canAccessTenant(userId, tenantId)) return true;
  res.status(403).json({ error: 'forbidden', message: `User ${userId} cannot access tenant ${tenantId}` });
  return false;
}

function requireTenantRoleOr403(userId: string, tenantId: string, roles: Array<'owner' | 'admin' | 'reviewer'>, res: Response): boolean {
  if (hasTenantRole(userId, tenantId, roles)) return true;
  res.status(403).json({ error: 'forbidden', message: `User ${userId} lacks required role for tenant ${tenantId}` });
  return false;
}

export const controlPlaneRouter = Router();

controlPlaneRouter.use(requireTokenAuth);

controlPlaneRouter.get('/policy/public-keys', (_req: AuthenticatedRequest, res: Response) => {
  res.status(200).json({ keys: getPolicyPublicKeys() });
});

controlPlaneRouter.post('/policy/decide', async (req: AuthenticatedRequest, res: Response) => {
  const input = parseOr400(policyInputSchema, req.body, res);
  if (!input || !req.authUser) return;

  if (!requireTenantAccessOr403(req.authUser.id, input.session.tenant_id, res)) return;

  const decision = decidePolicy({
    actor_user_id: req.authUser.id,
    action: {
      name: input.action.name,
      risk_level: input.action.risk_level,
      target: input.action.target,
      details: input.action.details,
    },
    session: input.session,
    metadata: input.metadata,
  });

  await issuePolicyDecisionJtiRecord(req.authUser.id, {
    jti: decision.jti,
    tenant_id: input.session.tenant_id,
    workspace_id: input.session.workspace_id,
    session_id: input.session.session_id,
    action_name: input.action.name,
    risk_level: input.action.risk_level,
    decision: decision.decision,
    token_expires_at: decision.token_expires_at,
  });

  res.status(200).json(decision);
});

controlPlaneRouter.post('/events', async (req: AuthenticatedRequest, res: Response) => {
  const input = parseOr400(eventInputSchema, req.body, res);
  if (!input || !req.authUser) return;

  if (!requireTenantAccessOr403(req.authUser.id, input.tenant_id, res)) return;

  const stored = await appendEventRecord(req.authUser.id, input);

  res.status(201).json({ event_id: stored.event_id, accepted_at: stored.timestamp });
});

controlPlaneRouter.post('/workspaces', async (req: AuthenticatedRequest, res: Response) => {
  const input = parseOr400(workspaceInputSchema, req.body, res);
  if (!input || !req.authUser) return;

  if (!requireTenantAccessOr403(req.authUser.id, input.tenant_id, res)) return;

  const workspace = await createWorkspaceRecord(req.authUser.id, input);
  res.status(201).json(workspace);
});

controlPlaneRouter.post('/artifacts', async (req: AuthenticatedRequest, res: Response) => {
  const input = parseOr400(artifactInputSchema, req.body, res);
  if (!input || !req.authUser) return;

  if (!requireTenantAccessOr403(req.authUser.id, input.tenant_id, res)) return;

  const artifact = await createArtifactRecord(req.authUser.id, input);
  res.status(201).json(artifact);
});

controlPlaneRouter.get('/artifacts/:artifactId/provenance', async (req: AuthenticatedRequest, res: Response) => {
  if (!req.authUser) return;

  const provenance = await getArtifactProvenanceRecord(req.params.artifactId);
  if (!provenance) {
    res.status(404).json({ error: 'not_found', message: 'Artifact not found' });
    return;
  }

  if (!requireTenantAccessOr403(req.authUser.id, provenance.artifact.tenant_id, res)) return;

  res.status(200).json(provenance);
});

controlPlaneRouter.post('/approvals', async (req: AuthenticatedRequest, res: Response) => {
  const input = parseOr400(approvalRequestSchema, req.body, res);
  if (!input || !req.authUser) return;

  if (!requireTenantAccessOr403(req.authUser.id, input.tenant_id, res)) return;

  const approval = await createApprovalRequestRecord(req.authUser.id, input);
  res.status(201).json(approval);
});

controlPlaneRouter.post('/approvals/resolve', async (req: AuthenticatedRequest, res: Response) => {
  const input = parseOr400(approvalResolveSchema, req.body, res);
  if (!input || !req.authUser) return;

  if (!requireTenantAccessOr403(req.authUser.id, input.tenant_id, res)) return;
  if (!requireTenantRoleOr403(req.authUser.id, input.tenant_id, ['owner', 'admin', 'reviewer'], res)) return;

  const result = await resolveApprovalRecord(req.authUser.id, {
    approval_id: input.approval_id,
    decision: input.decision,
    decision_reason: input.decision_reason,
  });

  res.status(200).json(result);
});

controlPlaneRouter.get('/approvals/:approvalId', async (req: AuthenticatedRequest, res: Response) => {
  if (!req.authUser) return;

  const approval = await getApprovalStatusRecord(req.params.approvalId);
  if (!approval) {
    res.status(404).json({ error: 'not_found', message: 'Approval request not found' });
    return;
  }

  if (!requireTenantAccessOr403(req.authUser.id, approval.tenant_id, res)) return;
  res.status(200).json(approval);
});

controlPlaneRouter.get('/metrics/governance', async (_req: AuthenticatedRequest, res: Response) => {
  const metrics = await getGovernanceMetricsSnapshot();
  res.status(200).json(metrics);
});

controlPlaneRouter.post('/skills/resolve', (req: AuthenticatedRequest, res: Response) => {
  const input = parseOr400(skillsResolveSchema, req.body, res);
  if (!input || !req.authUser) return;

  if (!requireTenantAccessOr403(req.authUser.id, input.tenant_id, res)) return;

  const resolved_skills = resolveSkills(input);
  res.status(200).json({ resolved_skills });
});
