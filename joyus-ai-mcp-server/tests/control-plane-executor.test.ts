import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockCanAccessTenant = vi.fn();
const mockDecidePolicy = vi.fn();
const mockHasTenantRole = vi.fn();
const mockVerifyPolicyDecisionToken = vi.fn();

vi.mock('../src/control-plane/service.js', () => ({
  canAccessTenant: (...args: unknown[]) => mockCanAccessTenant(...args),
  decidePolicy: (...args: unknown[]) => mockDecidePolicy(...args),
  hasTenantRole: (...args: unknown[]) => mockHasTenantRole(...args),
  verifyPolicyDecisionToken: (...args: unknown[]) => mockVerifyPolicyDecisionToken(...args),
}));

const mockAppendEventRecord = vi.fn();
const mockCreateArtifactRecord = vi.fn();
const mockCreateWorkspaceRecord = vi.fn();
const mockGetArtifactProvenanceRecord = vi.fn();
const mockIssuePolicyDecisionJtiRecord = vi.fn();
const mockConsumePolicyDecisionJtiRecord = vi.fn();
const mockCreateApprovalRequestRecord = vi.fn();
const mockResolveApprovalRecord = vi.fn();
const mockGetApprovalStatusRecord = vi.fn();
const mockGetGovernanceMetricsSnapshot = vi.fn();

vi.mock('../src/control-plane/store.js', () => ({
  appendEventRecord: (...args: unknown[]) => mockAppendEventRecord(...args),
  createArtifactRecord: (...args: unknown[]) => mockCreateArtifactRecord(...args),
  createWorkspaceRecord: (...args: unknown[]) => mockCreateWorkspaceRecord(...args),
  getArtifactProvenanceRecord: (...args: unknown[]) => mockGetArtifactProvenanceRecord(...args),
  issuePolicyDecisionJtiRecord: (...args: unknown[]) => mockIssuePolicyDecisionJtiRecord(...args),
  consumePolicyDecisionJtiRecord: (...args: unknown[]) => mockConsumePolicyDecisionJtiRecord(...args),
  createApprovalRequestRecord: (...args: unknown[]) => mockCreateApprovalRequestRecord(...args),
  resolveApprovalRecord: (...args: unknown[]) => mockResolveApprovalRecord(...args),
  getApprovalStatusRecord: (...args: unknown[]) => mockGetApprovalStatusRecord(...args),
  getGovernanceMetricsSnapshot: (...args: unknown[]) => mockGetGovernanceMetricsSnapshot(...args),
}));

import { executeControlPlaneTool } from '../src/tools/executors/control-plane-executor.js';

describe('control-plane tool executor', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockCanAccessTenant.mockReturnValue(true);
    mockHasTenantRole.mockReturnValue(true);
    mockIssuePolicyDecisionJtiRecord.mockResolvedValue(undefined);
    mockConsumePolicyDecisionJtiRecord.mockResolvedValue('consumed');
    mockVerifyPolicyDecisionToken.mockReturnValue({
      ok: true,
      payload: { jti: 'jti-1' },
    });
  });

  it('executes verify_before_action and returns a policy decision', async () => {
    mockDecidePolicy.mockReturnValue({ decision: 'allow', token: 'a.b', jti: 'j1' });

    const result = await executeControlPlaneTool(
      'verify_before_action',
      {
        tenant_id: 'tenant-a',
        session_id: 'sess-1',
        action_name: 'tool_call',
        risk_level: 'low',
      },
      { userId: 'tenant-a' },
    );

    expect(mockDecidePolicy).toHaveBeenCalledWith(
      expect.objectContaining({
        actor_user_id: 'tenant-a',
        session: expect.objectContaining({ tenant_id: 'tenant-a', session_id: 'sess-1' }),
      }),
    );
    expect(mockIssuePolicyDecisionJtiRecord).toHaveBeenCalledWith(
      'tenant-a',
      expect.objectContaining({
        jti: 'j1',
        tenant_id: 'tenant-a',
        session_id: 'sess-1',
        action_name: 'tool_call',
      }),
    );
    expect(result).toEqual({ decision: 'allow', token: 'a.b', jti: 'j1' });
  });

  it('creates a workspace with managed_remote default mode', async () => {
    mockCreateWorkspaceRecord.mockResolvedValue({ workspace_id: 'ws-1', status: 'ready' });

    const result = await executeControlPlaneTool(
      'request_workspace',
      { tenant_id: 'tenant-a', label: 'pilot' },
      { userId: 'tenant-a' },
    );

    expect(mockCreateWorkspaceRecord).toHaveBeenCalledWith(
      'tenant-a',
      expect.objectContaining({ tenant_id: 'tenant-a', mode: 'managed_remote', label: 'pilot' }),
    );
    expect(result).toEqual({ workspace_id: 'ws-1', status: 'ready' });
  });

  it('submits output with a newly registered artifact', async () => {
    mockCreateArtifactRecord.mockResolvedValue({ artifact_id: 'art-1' });
    mockAppendEventRecord.mockResolvedValue({
      event_id: 'evt-1',
      timestamp: '2026-03-05T00:00:00.000Z',
      artifact_ids: ['art-1'],
    });

    const result = await executeControlPlaneTool(
      'submit_output',
      {
        tenant_id: 'tenant-a',
        workspace_id: 'ws-1',
        session_id: 'sess-1',
        action_type: 'tool_call',
        risk_level: 'medium',
        policy_result: 'allow',
        runtime_target: 'remote',
        policy_decision_jti: 'jti-1',
        policy_decision_token: 'token-1',
        artifact: {
          artifact_type: 'patch',
          uri: 'file:///tmp/out.patch',
        },
      },
      { userId: 'tenant-a' },
    );

    expect(mockCreateArtifactRecord).toHaveBeenCalledOnce();
    expect(mockVerifyPolicyDecisionToken).toHaveBeenCalledWith('token-1', {
      tenant_id: 'tenant-a',
      workspace_id: 'ws-1',
      session_id: 'sess-1',
      action: {
        name: 'tool_call',
        risk_level: 'medium',
      },
    });
    expect(mockConsumePolicyDecisionJtiRecord).toHaveBeenCalledWith('tenant-a', {
      jti: 'jti-1',
      tenant_id: 'tenant-a',
      workspace_id: 'ws-1',
      session_id: 'sess-1',
    });
    expect(mockAppendEventRecord).toHaveBeenCalledWith(
      'tenant-a',
      expect.objectContaining({ artifact_ids: ['art-1'], workspace_id: 'ws-1' }),
    );
    expect(result).toEqual({
      event_id: 'evt-1',
      accepted_at: '2026-03-05T00:00:00.000Z',
      artifact_id: 'art-1',
      artifact_ids: ['art-1'],
    });
  });

  it('returns artifact provenance when authorized', async () => {
    mockGetArtifactProvenanceRecord.mockResolvedValue({
      artifact: { tenant_id: 'tenant-a', artifact_id: 'art-1' },
      related_events: [],
    });

    const result = await executeControlPlaneTool(
      'get_provenance',
      { artifact_id: 'art-1' },
      { userId: 'tenant-a' },
    );

    expect(mockGetArtifactProvenanceRecord).toHaveBeenCalledWith('art-1');
    expect(result).toEqual({
      artifact: { tenant_id: 'tenant-a', artifact_id: 'art-1' },
      related_events: [],
    });
  });

  it('throws for unauthorized tenant access', async () => {
    mockCanAccessTenant.mockReturnValue(false);

    await expect(
      executeControlPlaneTool(
        'verify_before_action',
        {
          tenant_id: 'tenant-b',
          session_id: 'sess-1',
          action_name: 'tool_call',
          risk_level: 'low',
        },
        { userId: 'tenant-a' },
      ),
    ).rejects.toThrow('cannot access tenant');
  });

  it('throws when provenance is missing', async () => {
    mockGetArtifactProvenanceRecord.mockResolvedValue(null);

    await expect(
      executeControlPlaneTool(
        'get_provenance',
        { artifact_id: 'art-missing' },
        { userId: 'tenant-a' },
      ),
    ).rejects.toThrow('Artifact not found');
  });

  it('rejects replayed policy decision tokens on submit_output', async () => {
    mockConsumePolicyDecisionJtiRecord.mockResolvedValue('replayed');

    await expect(
      executeControlPlaneTool(
        'submit_output',
        {
          tenant_id: 'tenant-a',
          workspace_id: 'ws-1',
          session_id: 'sess-1',
          action_type: 'tool_call',
          risk_level: 'low',
          policy_result: 'allow',
          runtime_target: 'remote',
          policy_decision_jti: 'jti-1',
          policy_decision_token: 'token-1',
        },
        { userId: 'tenant-a' },
      ),
    ).rejects.toThrow('already used');
  });

  it('rejects expired policy decision tokens on submit_output', async () => {
    mockConsumePolicyDecisionJtiRecord.mockResolvedValue('expired');

    await expect(
      executeControlPlaneTool(
        'submit_output',
        {
          tenant_id: 'tenant-a',
          workspace_id: 'ws-1',
          session_id: 'sess-1',
          action_type: 'tool_call',
          risk_level: 'low',
          policy_result: 'allow',
          runtime_target: 'remote',
          policy_decision_jti: 'jti-1',
          policy_decision_token: 'token-1',
        },
        { userId: 'tenant-a' },
      ),
    ).rejects.toThrow('expired');
  });

  it('rejects missing policy decision tokens on submit_output', async () => {
    mockConsumePolicyDecisionJtiRecord.mockResolvedValue('missing');

    await expect(
      executeControlPlaneTool(
        'submit_output',
        {
          tenant_id: 'tenant-a',
          workspace_id: 'ws-1',
          session_id: 'sess-1',
          action_type: 'tool_call',
          risk_level: 'low',
          policy_result: 'allow',
          runtime_target: 'remote',
          policy_decision_jti: 'jti-1',
          policy_decision_token: 'token-1',
        },
        { userId: 'tenant-a' },
      ),
    ).rejects.toThrow('not found');
  });

  it('rejects submit_output when policy token verification fails', async () => {
    mockVerifyPolicyDecisionToken.mockReturnValue({
      ok: false,
      reason: 'invalid_signature',
    });

    await expect(
      executeControlPlaneTool(
        'submit_output',
        {
          tenant_id: 'tenant-a',
          workspace_id: 'ws-1',
          session_id: 'sess-1',
          action_type: 'tool_call',
          risk_level: 'low',
          policy_result: 'allow',
          runtime_target: 'remote',
          policy_decision_jti: 'jti-1',
          policy_decision_token: 'token-1',
        },
        { userId: 'tenant-a' },
      ),
    ).rejects.toThrow('Invalid policy decision token');
  });

  it('rejects submit_output when token jti and parameter jti mismatch', async () => {
    mockVerifyPolicyDecisionToken.mockReturnValue({
      ok: true,
      payload: { jti: 'different-jti' },
    });

    await expect(
      executeControlPlaneTool(
        'submit_output',
        {
          tenant_id: 'tenant-a',
          workspace_id: 'ws-1',
          session_id: 'sess-1',
          action_type: 'tool_call',
          risk_level: 'low',
          policy_result: 'allow',
          runtime_target: 'remote',
          policy_decision_jti: 'jti-1',
          policy_decision_token: 'token-1',
        },
        { userId: 'tenant-a' },
      ),
    ).rejects.toThrow('jti does not match');
  });

  it('creates and resolves approvals and returns governance metrics', async () => {
    mockCreateApprovalRequestRecord.mockResolvedValue({ approval_id: 'appr-1', status: 'requested' });
    mockResolveApprovalRecord.mockResolvedValue({ approval_id: 'appr-1', status: 'approved' });
    mockGetApprovalStatusRecord.mockResolvedValue({ approval_id: 'appr-1', tenant_id: 'tenant-a', status: 'approved' });
    mockGetGovernanceMetricsSnapshot.mockResolvedValue({ approvals_requested_24h: 1 });

    const requested = await executeControlPlaneTool(
      'request_approval',
      {
        tenant_id: 'tenant-a',
        session_id: 'sess-1',
        action_type: 'tool_call',
        risk_level: 'high',
        policy_decision_jti: 'jti-1',
      },
      { userId: 'tenant-a' },
    );
    const resolved = await executeControlPlaneTool(
      'resolve_approval',
      {
        approval_id: 'appr-1',
        tenant_id: 'tenant-a',
        decision: 'approve',
      },
      { userId: 'tenant-a' },
    );
    const status = await executeControlPlaneTool(
      'get_approval_status',
      {
        approval_id: 'appr-1',
      },
      { userId: 'tenant-a' },
    );
    const metrics = await executeControlPlaneTool('get_governance_metrics', {}, { userId: 'tenant-a' });

    expect(requested).toEqual({ approval_id: 'appr-1', status: 'requested' });
    expect(resolved).toEqual({ approval_id: 'appr-1', status: 'approved' });
    expect(status).toEqual({ approval_id: 'appr-1', tenant_id: 'tenant-a', status: 'approved' });
    expect(metrics).toEqual({ approvals_requested_24h: 1 });
  });

  it('rejects resolve_approval when user lacks privileged tenant role', async () => {
    mockHasTenantRole.mockReturnValue(false);

    await expect(
      executeControlPlaneTool(
        'resolve_approval',
        {
          approval_id: 'appr-1',
          tenant_id: 'tenant-a',
          decision: 'approve',
        },
        { userId: 'tenant-a' },
      ),
    ).rejects.toThrow('missing required role');
  });
});
