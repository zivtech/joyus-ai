import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Request, Response } from 'express';

vi.mock('../src/auth/middleware.js', () => ({
  requireTokenAuth: (_req: unknown, _res: unknown, next: () => void) => next(),
}));

const mockDecidePolicy = vi.fn();
const mockResolveSkills = vi.fn();
const mockCanAccessTenant = vi.fn();

vi.mock('../src/control-plane/service.js', () => ({
  decidePolicy: (...args: unknown[]) => mockDecidePolicy(...args),
  resolveSkills: (...args: unknown[]) => mockResolveSkills(...args),
  canAccessTenant: (...args: unknown[]) => mockCanAccessTenant(...args),
}));

const mockAppendEventRecord = vi.fn();
const mockCreateWorkspaceRecord = vi.fn();
const mockCreateArtifactRecord = vi.fn();
const mockGetArtifactProvenanceRecord = vi.fn();
const mockIssuePolicyDecisionJtiRecord = vi.fn();

vi.mock('../src/control-plane/store.js', () => ({
  appendEventRecord: (...args: unknown[]) => mockAppendEventRecord(...args),
  createWorkspaceRecord: (...args: unknown[]) => mockCreateWorkspaceRecord(...args),
  createArtifactRecord: (...args: unknown[]) => mockCreateArtifactRecord(...args),
  getArtifactProvenanceRecord: (...args: unknown[]) => mockGetArtifactProvenanceRecord(...args),
  issuePolicyDecisionJtiRecord: (...args: unknown[]) => mockIssuePolicyDecisionJtiRecord(...args),
}));

import { controlPlaneRouter } from '../src/control-plane/router.js';

type RouterLayer = {
  route?: {
    path: string;
    stack: { handle: (...args: unknown[]) => unknown }[];
  };
};

function findHandler(path: string) {
  const layers = (controlPlaneRouter as unknown as { stack: RouterLayer[] }).stack;
  const layer = layers.find((entry) => entry.route?.path === path);
  if (!layer?.route) throw new Error(`Route not found: ${path}`);
  return layer.route.stack[0].handle;
}

function makeReq(overrides: Partial<Request> = {}): Request {
  return {
    headers: {},
    params: {},
    body: {},
    authUser: { id: 'tenant-a', email: 'u@example.com', name: null },
    ...overrides,
  } as unknown as Request;
}

function makeRes(): Response & { _status: number; _body: unknown } {
  const res = {
    _status: 200,
    _body: undefined as unknown,
    status: vi.fn().mockReturnThis(),
    json: vi.fn().mockReturnThis(),
  } as unknown as Response & { _status: number; _body: unknown };

  (res.status as ReturnType<typeof vi.fn>).mockImplementation((code: number) => {
    res._status = code;
    return res;
  });

  (res.json as ReturnType<typeof vi.fn>).mockImplementation((body: unknown) => {
    res._body = body;
    return res;
  });

  return res;
}

describe('control-plane router', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockCanAccessTenant.mockReturnValue(true);
  });

  it('returns 400 for invalid policy payloads', async () => {
    const handler = findHandler('/policy/decide');
    const req = makeReq({ body: { action: { name: 'x' } } });
    const res = makeRes();

    await handler(req, res, vi.fn());

    expect(res._status).toBe(400);
    expect((res._body as { error: string }).error).toBe('invalid_request');
  });

  it('returns policy decision for valid requests', async () => {
    mockDecidePolicy.mockReturnValue({ decision: 'allow', reason: 'ok', token: 'p.s', token_expires_at: 't', jti: 'j', risk_level: 'low' });
    mockIssuePolicyDecisionJtiRecord.mockResolvedValue(undefined);

    const handler = findHandler('/policy/decide');
    const req = makeReq({
      body: {
        action: { name: 'run', risk_level: 'low' },
        session: { session_id: 's1', tenant_id: 'tenant-a' },
      },
    });
    const res = makeRes();

    await handler(req, res, vi.fn());

    expect(res._status).toBe(200);
    expect(mockDecidePolicy).toHaveBeenCalledOnce();
    expect(mockIssuePolicyDecisionJtiRecord).toHaveBeenCalledOnce();
    expect((res._body as { decision: string }).decision).toBe('allow');
  });

  it('enforces tenant authorization on events', async () => {
    mockCanAccessTenant.mockReturnValue(false);

    const handler = findHandler('/events');
    const req = makeReq({
      body: {
        tenant_id: 'tenant-b',
        workspace_id: 'ws-1',
        session_id: 's1',
        action_type: 'tool_call',
        risk_level: 'low',
        policy_result: 'allow',
        runtime_target: 'local',
      },
    });
    const res = makeRes();

    await handler(req, res, vi.fn());

    expect(res._status).toBe(403);
    expect(mockAppendEventRecord).not.toHaveBeenCalled();
  });

  it('persists event records and returns ids', async () => {
    mockAppendEventRecord.mockResolvedValue({ event_id: 'evt-1', timestamp: '2026-03-05T00:00:00.000Z' });

    const handler = findHandler('/events');
    const req = makeReq({
      body: {
        tenant_id: 'tenant-a',
        workspace_id: 'ws-1',
        session_id: 's1',
        action_type: 'tool_call',
        risk_level: 'medium',
        policy_result: 'allow',
        runtime_target: 'remote',
      },
    });
    const res = makeRes();

    await handler(req, res, vi.fn());

    expect(res._status).toBe(201);
    expect(mockAppendEventRecord).toHaveBeenCalledWith(
      'tenant-a',
      expect.objectContaining({ tenant_id: 'tenant-a', session_id: 's1' }),
    );
    expect(res._body).toEqual({ event_id: 'evt-1', accepted_at: '2026-03-05T00:00:00.000Z' });
  });

  it('returns 404 when artifact provenance is missing', async () => {
    mockGetArtifactProvenanceRecord.mockResolvedValue(null);

    const handler = findHandler('/artifacts/:artifactId/provenance');
    const req = makeReq({ params: { artifactId: 'art-missing' } });
    const res = makeRes();

    await handler(req, res, vi.fn());

    expect(res._status).toBe(404);
  });

  it('returns resolved skills', async () => {
    mockResolveSkills.mockReturnValue([{ skill_id: 'drupal-security' }]);

    const handler = findHandler('/skills/resolve');
    const req = makeReq({ body: { tenant_id: 'tenant-a', file_path: 'foo.module' } });
    const res = makeRes();

    await handler(req, res, vi.fn());

    expect(res._status).toBe(200);
    expect(res._body).toEqual({ resolved_skills: [{ skill_id: 'drupal-security' }] });
  });
});
