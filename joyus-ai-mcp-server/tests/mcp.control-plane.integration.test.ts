import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mockGetUserFromToken = vi.fn();
vi.mock('../src/auth/verify.js', () => ({
  getUserFromToken: (...args: unknown[]) => mockGetUserFromToken(...args),
}));

const mockCanAccessTenant = vi.fn();
const mockDecidePolicy = vi.fn();
const mockHasTenantRole = vi.fn();
const mockVerifyPolicyDecisionToken = vi.fn();
vi.mock('../src/control-plane/service.js', async () => {
  const actual = await vi.importActual<typeof import('../src/control-plane/service.js')>('../src/control-plane/service.js');
  return {
    ...actual,
    canAccessTenant: (...args: unknown[]) => mockCanAccessTenant(...args),
    decidePolicy: (...args: unknown[]) => mockDecidePolicy(...args),
    hasTenantRole: (...args: unknown[]) => mockHasTenantRole(...args),
    verifyPolicyDecisionToken: (...args: unknown[]) => mockVerifyPolicyDecisionToken(...args),
  };
});

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

import { app } from '../src/index.js';
import { db } from '../src/db/client.js';

async function postJson(url: string, token: string, body: unknown): Promise<Response> {
  return fetch(url, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${token}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify(body),
  });
}

describe('/mcp control-plane tool integration', () => {
  let server: Server;
  let baseUrl: string;

  beforeEach(async () => {
    vi.clearAllMocks();
    mockGetUserFromToken.mockResolvedValue({ id: 'tenant-a', email: 'u@example.com', name: null });

    mockCanAccessTenant.mockReturnValue(true);
    mockHasTenantRole.mockReturnValue(true);
    mockDecidePolicy.mockReturnValue({
      decision: 'allow',
      reason: 'ok',
      token: 'payload.signature',
      token_expires_at: '2026-03-05T13:00:00.000Z',
      jti: 'jti-1',
      risk_level: 'low',
    });

    mockIssuePolicyDecisionJtiRecord.mockResolvedValue(undefined);
    mockVerifyPolicyDecisionToken.mockReturnValue({
      ok: true,
      payload: { jti: 'jti-1' },
    });
    mockCreateWorkspaceRecord.mockResolvedValue({ workspace_id: 'ws-1', status: 'ready' });
    mockConsumePolicyDecisionJtiRecord.mockResolvedValue('consumed');
    mockAppendEventRecord.mockResolvedValue({
      event_id: 'evt-1',
      timestamp: '2026-03-05T13:00:00.000Z',
      artifact_ids: [],
    });
    mockCreateArtifactRecord.mockResolvedValue({ artifact_id: 'art-1' });
    mockGetArtifactProvenanceRecord.mockResolvedValue({
      artifact: { artifact_id: 'art-1', tenant_id: 'tenant-a' },
      related_events: [],
    });
    mockCreateApprovalRequestRecord.mockResolvedValue({ approval_id: 'appr-1', status: 'requested' });
    mockResolveApprovalRecord.mockResolvedValue({ approval_id: 'appr-1', status: 'approved' });
    mockGetApprovalStatusRecord.mockResolvedValue({ approval_id: 'appr-1', tenant_id: 'tenant-a', status: 'approved' });
    mockGetGovernanceMetricsSnapshot.mockResolvedValue({ approvals_requested_24h: 1 });

    const values = vi.fn().mockResolvedValue(undefined);
    vi.spyOn(db, 'insert').mockReturnValue({ values } as unknown as ReturnType<typeof db.insert>);
    vi.spyOn(db, 'select').mockImplementation(
      (() => ({
        from: () => ({
          where: () => Promise.resolve([]),
        }),
      })) as typeof db.select,
    );

    await new Promise<void>((resolve) => {
      server = app.listen(0, () => {
        const address = server.address() as AddressInfo;
        baseUrl = `http://127.0.0.1:${address.port}`;
        resolve();
      });
    });
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    await new Promise<void>((resolve, reject) => {
      server.close((err) => (err ? reject(err) : resolve()));
    });
  });

  it('includes control-plane tools in tools/list', async () => {
    const response = await postJson(`${baseUrl}/mcp`, 'token-1', {
      jsonrpc: '2.0',
      id: 1,
      method: 'tools/list',
      params: {},
    });

    expect(response.status).toBe(200);
    const payload = (await response.json()) as {
      result: { tools: Array<{ name: string }> };
    };
    const names = payload.result.tools.map((tool) => tool.name);

    expect(names).toContain('verify_before_action');
    expect(names).toContain('request_workspace');
    expect(names).toContain('submit_output');
    expect(names).toContain('get_provenance');
    expect(names).toContain('request_approval');
    expect(names).toContain('resolve_approval');
    expect(names).toContain('get_approval_status');
    expect(names).toContain('get_governance_metrics');
  });

  it('dispatches all control-plane tools through tools/call', async () => {
    const calls = [
      {
        name: 'verify_before_action',
        arguments: {
          tenant_id: 'tenant-a',
          session_id: 'sess-1',
          action_name: 'tool_call',
          risk_level: 'low',
        },
      },
      {
        name: 'request_workspace',
        arguments: {
          tenant_id: 'tenant-a',
        },
      },
      {
        name: 'submit_output',
        arguments: {
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
      },
      {
        name: 'get_provenance',
        arguments: {
          artifact_id: 'art-1',
        },
      },
      {
        name: 'request_approval',
        arguments: {
          tenant_id: 'tenant-a',
          session_id: 'sess-1',
          action_type: 'tool_call',
          risk_level: 'high',
          policy_decision_jti: 'jti-1',
        },
      },
      {
        name: 'resolve_approval',
        arguments: {
          approval_id: 'appr-1',
          tenant_id: 'tenant-a',
          decision: 'approve',
        },
      },
      {
        name: 'get_approval_status',
        arguments: {
          approval_id: 'appr-1',
        },
      },
      {
        name: 'get_governance_metrics',
        arguments: {},
      },
    ];

    for (const call of calls) {
      const response = await postJson(`${baseUrl}/mcp`, 'token-1', {
        jsonrpc: '2.0',
        id: call.name,
        method: 'tools/call',
        params: call,
      });

      expect(response.status).toBe(200);
      const payload = (await response.json()) as {
        result: { content: Array<{ type: string; text: string }> };
      };
      const content = payload.result.content[0];
      expect(content.type).toBe('text');
      expect(content.text).toMatch(/\{|\[/);
    }

    expect(mockIssuePolicyDecisionJtiRecord).toHaveBeenCalledOnce();
    expect(mockConsumePolicyDecisionJtiRecord).toHaveBeenCalledOnce();
    expect(mockCreateApprovalRequestRecord).toHaveBeenCalledOnce();
    expect(mockResolveApprovalRecord).toHaveBeenCalledOnce();
    expect(mockGetApprovalStatusRecord).toHaveBeenCalledOnce();
    expect(mockGetGovernanceMetricsSnapshot).toHaveBeenCalledOnce();
  });
});
