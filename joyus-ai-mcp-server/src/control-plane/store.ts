import { createId } from '@paralleldrive/cuid2';
import { and, desc, eq, gt, isNull, lte, sql } from 'drizzle-orm';

import { db } from '../db/client.js';
import {
  controlPlaneApprovals,
  controlPlaneArtifacts,
  controlPlaneEvents,
  controlPlanePolicyJtis,
  controlPlaneWorkspaces,
} from '../db/schema.js';
import type {
  ArtifactInput,
  ArtifactRecord,
  EventInput,
  StoredEvent,
  WorkspaceInput,
  WorkspaceRecord,
} from './service.js';

export type ConsumePolicyDecisionResult = 'consumed' | 'replayed' | 'missing' | 'expired';
export type ResolveApprovalDecision = 'approve' | 'deny';
export type ResolveApprovalResult = 'approved' | 'denied' | 'expired' | 'missing' | 'not_pending';

export interface ApprovalRecord {
  approval_id: string;
  tenant_id: string;
  workspace_id: string;
  session_id: string;
  action_type: string;
  risk_level: EventInput['risk_level'];
  policy_decision_jti: string;
  status: 'requested' | 'approved' | 'denied' | 'expired' | 'cancelled';
  request_reason?: string;
  requested_by: string;
  requested_at: string;
  expires_at: string;
  decided_by?: string;
  decided_at?: string;
  decision_reason?: string;
}

function asStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((entry): entry is string => typeof entry === 'string');
}

export async function appendEventRecord(userId: string, input: EventInput): Promise<StoredEvent> {
  const [row] = await db
    .insert(controlPlaneEvents)
    .values({
      id: `evt_${createId()}`,
      tenantId: input.tenant_id,
      workspaceId: input.workspace_id ?? '',
      sessionId: input.session_id,
      userId,
      actionType: input.action_type,
      riskLevel: input.risk_level,
      policyResult: input.policy_result,
      runtimeTarget: input.runtime_target,
      skillIds: input.skill_ids ?? [],
      artifactIds: input.artifact_ids ?? [],
      outcome: input.outcome ?? 'pass',
      errorCode: input.error_code ?? null,
      latencyMs: input.latency_ms ?? null,
      details: input.details ?? null,
    })
    .returning();

  return {
    tenant_id: row.tenantId,
    workspace_id: row.workspaceId,
    session_id: row.sessionId,
    action_type: row.actionType,
    risk_level: row.riskLevel,
    policy_result: row.policyResult,
    runtime_target: row.runtimeTarget,
    skill_ids: asStringArray(row.skillIds),
    artifact_ids: asStringArray(row.artifactIds),
    outcome: row.outcome,
    error_code: row.errorCode ?? undefined,
    latency_ms: row.latencyMs ?? undefined,
    details: (row.details as Record<string, unknown> | null) ?? undefined,
    event_id: row.id,
    user_id: row.userId,
    timestamp: row.createdAt.toISOString(),
  };
}

export async function createWorkspaceRecord(userId: string, input: WorkspaceInput): Promise<WorkspaceRecord> {
  const workspaceId = `ws_${createId()}`;

  const [row] = await db
    .insert(controlPlaneWorkspaces)
    .values({
      id: workspaceId,
      tenantId: input.tenant_id,
      mode: input.mode,
      createdBy: userId,
      label: input.label ?? null,
      status: 'ready',
    })
    .returning();

  return {
    workspace_id: row.id,
    tenant_id: row.tenantId,
    mode: row.mode,
    created_by: row.createdBy,
    label: row.label,
    created_at: row.createdAt.toISOString(),
    status: row.status,
  };
}

export async function createArtifactRecord(userId: string, input: ArtifactInput): Promise<ArtifactRecord> {
  const artifactId = `art_${createId()}`;

  const [row] = await db
    .insert(controlPlaneArtifacts)
    .values({
      id: artifactId,
      tenantId: input.tenant_id,
      workspaceId: input.workspace_id,
      sessionId: input.session_id,
      artifactType: input.artifact_type,
      uri: input.uri,
      policyDecisionJti: input.policy_decision_jti,
      expiresAt: inferArtifactExpiry(input.artifact_type),
      skillIds: input.skill_ids ?? [],
      metadata: input.metadata ?? null,
      createdBy: userId,
    })
    .returning();

  return {
    artifact_id: row.id,
    tenant_id: row.tenantId,
    workspace_id: row.workspaceId,
    session_id: row.sessionId,
    artifact_type: row.artifactType,
    uri: row.uri,
    policy_decision_jti: row.policyDecisionJti,
    skill_ids: asStringArray(row.skillIds),
    metadata: (row.metadata as Record<string, unknown> | null) ?? undefined,
    created_by: row.createdBy,
    created_at: row.createdAt.toISOString(),
  };
}

function inferArtifactExpiry(artifactType: string): Date | null {
  const normalized = artifactType.toLowerCase();
  const days = normalized.includes('log') || normalized.includes('event') ? 90 : 30;
  return new Date(Date.now() + days * 24 * 60 * 60 * 1000);
}

export async function issuePolicyDecisionJtiRecord(
  userId: string,
  input: {
    jti: string;
    tenant_id: string;
    workspace_id?: string;
    session_id: string;
    action_name: string;
    risk_level: EventInput['risk_level'];
    decision: EventInput['policy_result'];
    token_expires_at: string;
  },
): Promise<void> {
  await db
    .insert(controlPlanePolicyJtis)
    .values({
      jti: input.jti,
      tenantId: input.tenant_id,
      workspaceId: input.workspace_id ?? '',
      sessionId: input.session_id,
      actionName: input.action_name,
      riskLevel: input.risk_level,
      decision: input.decision,
      issuedBy: userId,
      expiresAt: new Date(input.token_expires_at),
    });
}

export async function consumePolicyDecisionJtiRecord(
  userId: string,
  input: {
    jti: string;
    tenant_id: string;
    workspace_id?: string;
    session_id: string;
  },
): Promise<ConsumePolicyDecisionResult> {
  const now = new Date();
  const workspaceId = input.workspace_id ?? '';

  const consumed = await db
    .update(controlPlanePolicyJtis)
    .set({
      consumedAt: now,
      consumedBy: userId,
    })
    .where(and(
      eq(controlPlanePolicyJtis.jti, input.jti),
      eq(controlPlanePolicyJtis.tenantId, input.tenant_id),
      eq(controlPlanePolicyJtis.workspaceId, workspaceId),
      eq(controlPlanePolicyJtis.sessionId, input.session_id),
      isNull(controlPlanePolicyJtis.consumedAt),
      gt(controlPlanePolicyJtis.expiresAt, now),
    ))
    .returning({ jti: controlPlanePolicyJtis.jti });

  if (consumed.length > 0) return 'consumed';

  const [row] = await db
    .select({
      consumedAt: controlPlanePolicyJtis.consumedAt,
      expiresAt: controlPlanePolicyJtis.expiresAt,
    })
    .from(controlPlanePolicyJtis)
    .where(and(
      eq(controlPlanePolicyJtis.jti, input.jti),
      eq(controlPlanePolicyJtis.tenantId, input.tenant_id),
      eq(controlPlanePolicyJtis.workspaceId, workspaceId),
      eq(controlPlanePolicyJtis.sessionId, input.session_id),
    ))
    .limit(1);

  if (!row) return 'missing';
  if (row.consumedAt) return 'replayed';
  if (row.expiresAt.getTime() <= now.getTime()) return 'expired';

  return 'replayed';
}

function rowToApprovalRecord(row: typeof controlPlaneApprovals.$inferSelect): ApprovalRecord {
  return {
    approval_id: row.id,
    tenant_id: row.tenantId,
    workspace_id: row.workspaceId,
    session_id: row.sessionId,
    action_type: row.actionType,
    risk_level: row.riskLevel,
    policy_decision_jti: row.policyDecisionJti,
    status: row.status,
    request_reason: row.requestReason ?? undefined,
    requested_by: row.requestedBy,
    requested_at: row.requestedAt.toISOString(),
    expires_at: row.expiresAt.toISOString(),
    decided_by: row.decidedBy ?? undefined,
    decided_at: row.decidedAt?.toISOString(),
    decision_reason: row.decisionReason ?? undefined,
  };
}

export async function createApprovalRequestRecord(
  userId: string,
  input: {
    tenant_id: string;
    workspace_id?: string;
    session_id: string;
    action_type: string;
    risk_level: EventInput['risk_level'];
    policy_decision_jti: string;
    request_reason?: string;
    metadata?: Record<string, unknown>;
    ttl_seconds?: number;
  },
): Promise<ApprovalRecord> {
  const approvalId = `apr_${createId()}`;
  const ttlSeconds = input.ttl_seconds ?? 15 * 60;
  const expiresAt = new Date(Date.now() + ttlSeconds * 1000);

  const [row] = await db
    .insert(controlPlaneApprovals)
    .values({
      id: approvalId,
      tenantId: input.tenant_id,
      workspaceId: input.workspace_id ?? '',
      sessionId: input.session_id,
      actionType: input.action_type,
      riskLevel: input.risk_level,
      policyDecisionJti: input.policy_decision_jti,
      status: 'requested',
      requestReason: input.request_reason ?? null,
      requestedBy: userId,
      expiresAt,
      metadata: input.metadata ?? null,
    })
    .returning();

  return rowToApprovalRecord(row);
}

export async function resolveApprovalRecord(
  userId: string,
  input: {
    approval_id: string;
    decision: ResolveApprovalDecision;
    decision_reason?: string;
  },
): Promise<{ result: ResolveApprovalResult; approval?: ApprovalRecord }> {
  const [existing] = await db
    .select()
    .from(controlPlaneApprovals)
    .where(eq(controlPlaneApprovals.id, input.approval_id))
    .limit(1);

  if (!existing) return { result: 'missing' };

  if (existing.status !== 'requested') return { result: 'not_pending', approval: rowToApprovalRecord(existing) };

  const now = new Date();
  if (existing.expiresAt.getTime() <= now.getTime()) {
    const [expired] = await db
      .update(controlPlaneApprovals)
      .set({ status: 'expired' })
      .where(eq(controlPlaneApprovals.id, existing.id))
      .returning();
    return { result: 'expired', approval: rowToApprovalRecord(expired) };
  }

  const nextStatus = input.decision === 'approve' ? 'approved' : 'denied';
  const [resolved] = await db
    .update(controlPlaneApprovals)
    .set({
      status: nextStatus,
      decidedBy: userId,
      decidedAt: now,
      decisionReason: input.decision_reason ?? null,
    })
    .where(eq(controlPlaneApprovals.id, existing.id))
    .returning();

  return { result: nextStatus, approval: rowToApprovalRecord(resolved) };
}

export async function getApprovalStatusRecord(approvalId: string): Promise<ApprovalRecord | null> {
  const [row] = await db
    .select()
    .from(controlPlaneApprovals)
    .where(eq(controlPlaneApprovals.id, approvalId))
    .limit(1);

  if (!row) return null;

  if (row.status === 'requested' && row.expiresAt.getTime() <= Date.now()) {
    const [expired] = await db
      .update(controlPlaneApprovals)
      .set({ status: 'expired' })
      .where(eq(controlPlaneApprovals.id, row.id))
      .returning();
    return rowToApprovalRecord(expired);
  }

  return rowToApprovalRecord(row);
}

export async function getGovernanceMetricsSnapshot(): Promise<Record<string, number>> {
  const now = new Date();
  const [events, artifacts, approvalsRequested, approvalsOpen, approvalsExpired, replayProtected] = await Promise.all([
    db.select({ count: sql<number>`count(*)` }).from(controlPlaneEvents),
    db.select({ count: sql<number>`count(*)` }).from(controlPlaneArtifacts),
    db.select({ count: sql<number>`count(*)` }).from(controlPlaneApprovals).where(eq(controlPlaneApprovals.status, 'requested')),
    db.select({ count: sql<number>`count(*)` }).from(controlPlaneApprovals).where(and(eq(controlPlaneApprovals.status, 'requested'), gt(controlPlaneApprovals.expiresAt, now))),
    db.select({ count: sql<number>`count(*)` }).from(controlPlaneApprovals).where(and(eq(controlPlaneApprovals.status, 'requested'), lte(controlPlaneApprovals.expiresAt, now))),
    db.select({ count: sql<number>`count(*)` }).from(controlPlanePolicyJtis).where(isNull(controlPlanePolicyJtis.consumedAt)),
  ]);

  return {
    events_total: Number(events[0]?.count ?? 0),
    artifacts_total: Number(artifacts[0]?.count ?? 0),
    approvals_requested_total: Number(approvalsRequested[0]?.count ?? 0),
    approvals_open_total: Number(approvalsOpen[0]?.count ?? 0),
    approvals_expired_total: Number(approvalsExpired[0]?.count ?? 0),
    unconsumed_policy_jtis_total: Number(replayProtected[0]?.count ?? 0),
  };
}

export async function listExpiredArtifacts(limit: number = 200): Promise<ArtifactRecord[]> {
  const rows = await db
    .select()
    .from(controlPlaneArtifacts)
    .where(lte(controlPlaneArtifacts.expiresAt, new Date()))
    .limit(limit);

  return rows.map((row) => ({
    artifact_id: row.id,
    tenant_id: row.tenantId,
    workspace_id: row.workspaceId,
    session_id: row.sessionId,
    artifact_type: row.artifactType,
    uri: row.uri,
    policy_decision_jti: row.policyDecisionJti,
    skill_ids: asStringArray(row.skillIds),
    metadata: (row.metadata as Record<string, unknown> | null) ?? undefined,
    created_by: row.createdBy,
    created_at: row.createdAt.toISOString(),
  }));
}

export async function getArtifactProvenanceRecord(
  artifactId: string,
): Promise<{ artifact: ArtifactRecord; related_events: StoredEvent[] } | null> {
  const [artifactRow] = await db
    .select()
    .from(controlPlaneArtifacts)
    .where(eq(controlPlaneArtifacts.id, artifactId))
    .limit(1);

  if (!artifactRow) return null;

  const eventRows = await db
    .select()
    .from(controlPlaneEvents)
    .where(
      and(
        eq(controlPlaneEvents.tenantId, artifactRow.tenantId),
        eq(controlPlaneEvents.workspaceId, artifactRow.workspaceId),
        eq(controlPlaneEvents.sessionId, artifactRow.sessionId),
      ),
    )
    .orderBy(desc(controlPlaneEvents.createdAt))
    .limit(200);

  const related_events: StoredEvent[] = eventRows
    .filter((eventRow) => asStringArray(eventRow.artifactIds).includes(artifactId))
    .map((eventRow) => ({
      tenant_id: eventRow.tenantId,
      workspace_id: eventRow.workspaceId,
      session_id: eventRow.sessionId,
      action_type: eventRow.actionType,
      risk_level: eventRow.riskLevel,
      policy_result: eventRow.policyResult,
      runtime_target: eventRow.runtimeTarget,
      skill_ids: asStringArray(eventRow.skillIds),
      artifact_ids: asStringArray(eventRow.artifactIds),
      outcome: eventRow.outcome,
      error_code: eventRow.errorCode ?? undefined,
      latency_ms: eventRow.latencyMs ?? undefined,
      details: (eventRow.details as Record<string, unknown> | null) ?? undefined,
      event_id: eventRow.id,
      user_id: eventRow.userId,
      timestamp: eventRow.createdAt.toISOString(),
    }));

  const artifact: ArtifactRecord = {
    artifact_id: artifactRow.id,
    tenant_id: artifactRow.tenantId,
    workspace_id: artifactRow.workspaceId,
    session_id: artifactRow.sessionId,
    artifact_type: artifactRow.artifactType,
    uri: artifactRow.uri,
    policy_decision_jti: artifactRow.policyDecisionJti,
    skill_ids: asStringArray(artifactRow.skillIds),
    metadata: (artifactRow.metadata as Record<string, unknown> | null) ?? undefined,
    created_by: artifactRow.createdBy,
    created_at: artifactRow.createdAt.toISOString(),
  };

  return { artifact, related_events };
}
