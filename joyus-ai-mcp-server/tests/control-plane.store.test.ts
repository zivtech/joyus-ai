import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { db } from '../src/db/client.js';
import {
  consumePolicyDecisionJtiRecord,
  createApprovalRequestRecord,
  getApprovalStatusRecord,
  getGovernanceMetricsSnapshot,
  listExpiredArtifacts,
  resolveApprovalRecord,
} from '../src/control-plane/store.js';

function makeFromResult<T>(rows: T[]) {
  const promise = Promise.resolve(rows);
  const whereResult = {
    limit: () => promise,
    orderBy: () => ({ limit: () => promise }),
    then: promise.then.bind(promise),
    catch: promise.catch.bind(promise),
  };

  return {
    where: () => whereResult,
    limit: () => promise,
    orderBy: () => ({ limit: () => promise }),
    then: promise.then.bind(promise),
    catch: promise.catch.bind(promise),
  };
}

function makeUpdateReturning<T>(rows: T[]) {
  return {
    set: vi.fn().mockReturnValue({
      where: vi.fn().mockReturnValue({
        returning: vi.fn().mockResolvedValue(rows),
      }),
    }),
  };
}

describe('control-plane store', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-03-05T10:00:00.000Z'));
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('consumes policy jti tokens and reports status transitions', async () => {
    vi.spyOn(db, 'update').mockReturnValue(
      makeUpdateReturning([{ jti: 'jti-1' }]) as unknown as ReturnType<typeof db.update>,
    );

    const consumed = await consumePolicyDecisionJtiRecord('user-1', {
      jti: 'jti-1',
      tenant_id: 'tenant-a',
      workspace_id: 'ws-1',
      session_id: 'sess-1',
    });

    expect(consumed).toBe('consumed');

    vi.spyOn(db, 'update').mockReturnValue(
      makeUpdateReturning([]) as unknown as ReturnType<typeof db.update>,
    );
    vi.spyOn(db, 'select').mockReturnValue({
      from: () => makeFromResult([{ consumedAt: null, expiresAt: new Date('2026-03-05T09:59:00.000Z') }]),
    } as unknown as ReturnType<typeof db.select>);

    const expired = await consumePolicyDecisionJtiRecord('user-1', {
      jti: 'jti-expired',
      tenant_id: 'tenant-a',
      workspace_id: 'ws-1',
      session_id: 'sess-1',
    });

    expect(expired).toBe('expired');
  });

  it('creates approval requests with defaults and maps to response shape', async () => {
    const returning = vi.fn().mockResolvedValue([
      {
        id: 'apr_1',
        tenantId: 'tenant-a',
        workspaceId: '',
        sessionId: 'sess-1',
        actionType: 'tool_call',
        riskLevel: 'high',
        policyDecisionJti: 'jti-1',
        status: 'requested',
        requestReason: null,
        requestedBy: 'user-1',
        requestedAt: new Date('2026-03-05T10:00:00.000Z'),
        expiresAt: new Date('2026-03-05T10:15:00.000Z'),
        decidedBy: null,
        decidedAt: null,
        decisionReason: null,
      },
    ]);
    const values = vi.fn().mockReturnValue({ returning });
    vi.spyOn(db, 'insert').mockReturnValue({ values } as unknown as ReturnType<typeof db.insert>);

    const approval = await createApprovalRequestRecord('user-1', {
      tenant_id: 'tenant-a',
      session_id: 'sess-1',
      action_type: 'tool_call',
      risk_level: 'high',
      policy_decision_jti: 'jti-1',
    });

    expect(values).toHaveBeenCalledWith(
      expect.objectContaining({
        workspaceId: '',
        status: 'requested',
        requestedBy: 'user-1',
      }),
    );
    expect(approval).toEqual(
      expect.objectContaining({
        approval_id: 'apr_1',
        tenant_id: 'tenant-a',
        status: 'requested',
      }),
    );
  });

  it('resolves approvals for not pending and approved outcomes', async () => {
    vi.spyOn(db, 'select').mockReturnValue({
      from: () =>
        makeFromResult([
          {
            id: 'apr_1',
            tenantId: 'tenant-a',
            workspaceId: 'ws-1',
            sessionId: 'sess-1',
            actionType: 'tool_call',
            riskLevel: 'high',
            policyDecisionJti: 'jti-1',
            status: 'approved',
            requestReason: null,
            requestedBy: 'user-1',
            requestedAt: new Date('2026-03-05T09:00:00.000Z'),
            expiresAt: new Date('2026-03-05T11:00:00.000Z'),
            decidedBy: 'reviewer-1',
            decidedAt: new Date('2026-03-05T09:10:00.000Z'),
            decisionReason: 'ok',
            metadata: null,
          },
        ]),
    } as unknown as ReturnType<typeof db.select>);

    const notPending = await resolveApprovalRecord('reviewer-2', {
      approval_id: 'apr_1',
      decision: 'approve',
    });
    expect(notPending.result).toBe('not_pending');

    vi.spyOn(db, 'select').mockReturnValue({
      from: () =>
        makeFromResult([
          {
            id: 'apr_2',
            tenantId: 'tenant-a',
            workspaceId: 'ws-1',
            sessionId: 'sess-1',
            actionType: 'tool_call',
            riskLevel: 'high',
            policyDecisionJti: 'jti-2',
            status: 'requested',
            requestReason: null,
            requestedBy: 'user-1',
            requestedAt: new Date('2026-03-05T09:00:00.000Z'),
            expiresAt: new Date('2026-03-05T11:00:00.000Z'),
            decidedBy: null,
            decidedAt: null,
            decisionReason: null,
            metadata: null,
          },
        ]),
    } as unknown as ReturnType<typeof db.select>);

    vi.spyOn(db, 'update').mockReturnValue(
      makeUpdateReturning([
        {
          id: 'apr_2',
          tenantId: 'tenant-a',
          workspaceId: 'ws-1',
          sessionId: 'sess-1',
          actionType: 'tool_call',
          riskLevel: 'high',
          policyDecisionJti: 'jti-2',
          status: 'approved',
          requestReason: null,
          requestedBy: 'user-1',
          requestedAt: new Date('2026-03-05T09:00:00.000Z'),
          expiresAt: new Date('2026-03-05T11:00:00.000Z'),
          decidedBy: 'reviewer-1',
          decidedAt: new Date('2026-03-05T10:00:00.000Z'),
          decisionReason: 'approved',
        },
      ]) as unknown as ReturnType<typeof db.update>,
    );

    const approved = await resolveApprovalRecord('reviewer-1', {
      approval_id: 'apr_2',
      decision: 'approve',
      decision_reason: 'approved',
    });

    expect(approved.result).toBe('approved');
    expect(approved.approval?.status).toBe('approved');
  });

  it('auto-expires stale pending approvals when checking status', async () => {
    vi.spyOn(db, 'select').mockReturnValue({
      from: () =>
        makeFromResult([
          {
            id: 'apr_3',
            tenantId: 'tenant-a',
            workspaceId: '',
            sessionId: 'sess-1',
            actionType: 'tool_call',
            riskLevel: 'medium',
            policyDecisionJti: 'jti-3',
            status: 'requested',
            requestReason: null,
            requestedBy: 'user-1',
            requestedAt: new Date('2026-03-05T09:00:00.000Z'),
            expiresAt: new Date('2026-03-05T09:59:00.000Z'),
            decidedBy: null,
            decidedAt: null,
            decisionReason: null,
            metadata: null,
          },
        ]),
    } as unknown as ReturnType<typeof db.select>);

    vi.spyOn(db, 'update').mockReturnValue(
      makeUpdateReturning([
        {
          id: 'apr_3',
          tenantId: 'tenant-a',
          workspaceId: '',
          sessionId: 'sess-1',
          actionType: 'tool_call',
          riskLevel: 'medium',
          policyDecisionJti: 'jti-3',
          status: 'expired',
          requestReason: null,
          requestedBy: 'user-1',
          requestedAt: new Date('2026-03-05T09:00:00.000Z'),
          expiresAt: new Date('2026-03-05T09:59:00.000Z'),
          decidedBy: null,
          decidedAt: null,
          decisionReason: null,
        },
      ]) as unknown as ReturnType<typeof db.update>,
    );

    const approval = await getApprovalStatusRecord('apr_3');
    expect(approval?.status).toBe('expired');
  });

  it('returns governance metrics counts and expired artifact records', async () => {
    let call = 0;
    const countRows = [
      [{ count: '8' }],
      [{ count: '3' }],
      [{ count: '2' }],
      [{ count: '1' }],
      [{ count: '1' }],
      [{ count: '4' }],
    ];

    vi.spyOn(db, 'select').mockImplementation(
      (() => ({
        from: () => makeFromResult(countRows[call++] ?? []),
      })) as ReturnType<typeof vi.fn>,
    );

    const metrics = await getGovernanceMetricsSnapshot();
    expect(metrics).toEqual({
      events_total: 8,
      artifacts_total: 3,
      approvals_requested_total: 2,
      approvals_open_total: 1,
      approvals_expired_total: 1,
      unconsumed_policy_jtis_total: 4,
    });

    vi.spyOn(db, 'select').mockReturnValue({
      from: () => ({
        where: () => ({
          limit: () =>
            Promise.resolve([
              {
                id: 'art_1',
                tenantId: 'tenant-a',
                workspaceId: 'ws-1',
                sessionId: 'sess-1',
                artifactType: 'log_bundle',
                uri: 's3://bucket/a',
                policyDecisionJti: 'jti-1',
                skillIds: ['drupal-security'],
                metadata: { source: 'runner' },
                createdBy: 'user-1',
                createdAt: new Date('2026-03-01T10:00:00.000Z'),
              },
            ]),
        }),
      }),
    } as unknown as ReturnType<typeof db.select>);

    const artifacts = await listExpiredArtifacts(50);
    expect(artifacts).toEqual([
      expect.objectContaining({
        artifact_id: 'art_1',
        skill_ids: ['drupal-security'],
        metadata: { source: 'runner' },
      }),
    ]);
  });
});
