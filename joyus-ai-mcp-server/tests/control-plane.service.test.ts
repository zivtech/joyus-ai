import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest';

import {
  appendEvent,
  canAccessTenant,
  createArtifact,
  createWorkspace,
  decidePolicy,
  getPolicyPublicKeys,
  getArtifactProvenance,
  hasTenantRole,
  resetControlPlaneState,
  resolveSkills,
  verifyPolicyDecisionToken,
} from '../src/control-plane/service.js';

function decodePayload(token: string): Record<string, unknown> {
  const [payload] = token.split('.');
  const raw = Buffer.from(payload, 'base64url').toString('utf8');
  return JSON.parse(raw) as Record<string, unknown>;
}

describe('control-plane service', () => {
  beforeEach(() => {
    resetControlPlaneState();
    vi.unstubAllEnvs();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('enforces tenant access with default and allowlist modes', () => {
    vi.stubEnv('CONTROL_PLANE_ALLOW_ANY_TENANT', 'false');
    vi.stubEnv('CONTROL_PLANE_LEGACY_TENANT_MATCH', 'false');
    vi.stubEnv('CONTROL_PLANE_TENANT_MEMBERSHIPS', '');
    vi.stubEnv('CONTROL_PLANE_TENANT_ALLOWLIST', '');
    expect(canAccessTenant('u1', 'u1')).toBe(false);
    expect(canAccessTenant('u1', 't1')).toBe(false);

    vi.stubEnv('CONTROL_PLANE_LEGACY_TENANT_MATCH', 'true');
    expect(canAccessTenant('u1', 'u1')).toBe(true);

    vi.stubEnv('CONTROL_PLANE_LEGACY_TENANT_MATCH', 'false');
    vi.stubEnv('CONTROL_PLANE_TENANT_MEMBERSHIPS', 'u1:t1=operator,u2:t2=viewer');
    expect(canAccessTenant('u1', 't1')).toBe(true);
    expect(canAccessTenant('u1', 't2')).toBe(false);
    expect(hasTenantRole('u2', 't2', ['viewer'])).toBe(true);
    expect(hasTenantRole('u2', 't2', ['owner', 'admin'])).toBe(false);

    vi.stubEnv('CONTROL_PLANE_TENANT_MEMBERSHIPS', '');
    vi.stubEnv('CONTROL_PLANE_TENANT_ALLOWLIST', 'u1:t1,u2:t2');
    expect(canAccessTenant('u1', 't1')).toBe(true);
    expect(canAccessTenant('u1', 't2')).toBe(false);

    vi.stubEnv('CONTROL_PLANE_ALLOW_ANY_TENANT', 'true');
    expect(canAccessTenant('u1', 'random')).toBe(true);
  });

  it('returns deny/escalate/allow policy decisions by risk and metadata', () => {
    const denyDecision = decidePolicy({
      actor_user_id: 'u1',
      action: { name: 'write_file', risk_level: 'low' },
      session: { session_id: 's1', tenant_id: 'u1' },
      metadata: { blocked: true },
    });
    expect(denyDecision.decision).toBe('deny');

    const highDecision = decidePolicy({
      actor_user_id: 'u1',
      action: { name: 'anything', risk_level: 'high' },
      session: { session_id: 's1', tenant_id: 'u1' },
    });
    expect(highDecision.decision).toBe('escalate');

    const mediumDestructiveDecision = decidePolicy({
      actor_user_id: 'u1',
      action: { name: 'publish_release', risk_level: 'medium' },
      session: { session_id: 's1', tenant_id: 'u1' },
    });
    expect(mediumDestructiveDecision.decision).toBe('escalate');

    const allowDecision = decidePolicy({
      actor_user_id: 'u1',
      action: { name: 'read_file', risk_level: 'low' },
      session: { session_id: 's1', tenant_id: 'u1' },
    });
    expect(allowDecision.decision).toBe('allow');
  });

  it('creates a signed token payload with tenant/session binding fields', () => {
    const decision = decidePolicy({
      actor_user_id: 'u1',
      action: { name: 'run_command', risk_level: 'medium', details: { cmd: 'npm test' } },
      session: { session_id: 's1', tenant_id: 't1', workspace_id: 'w1' },
    });

    expect(decision.token.split('.')).toHaveLength(2);
    const payload = decodePayload(decision.token);
    expect(payload.jti).toBe(decision.jti);
    expect(payload.tenant_id).toBe('t1');
    expect(payload.workspace_id).toBe('w1');
    expect(payload.session_id).toBe('s1');
    expect(payload.action_hash).toBeTypeOf('string');
    expect(payload.kid).toBeTypeOf('string');
    expect(payload.iat).toBeTypeOf('number');
    expect(payload.exp).toBeTypeOf('number');
  });

  it('verifies decision token signatures and policy binding context', () => {
    const decision = decidePolicy({
      actor_user_id: 'u1',
      action: { name: 'run_command', risk_level: 'medium' },
      session: { session_id: 's1', tenant_id: 't1', workspace_id: 'w1' },
    });

    const verification = verifyPolicyDecisionToken(decision.token, {
      tenant_id: 't1',
      workspace_id: 'w1',
      session_id: 's1',
      action: { name: 'run_command', risk_level: 'medium' },
    });
    expect(verification.ok).toBe(true);
    expect(verification.payload?.jti).toBe(decision.jti);

    const wrongSession = verifyPolicyDecisionToken(decision.token, {
      tenant_id: 't1',
      workspace_id: 'w1',
      session_id: 'other',
      action: { name: 'run_command', risk_level: 'medium' },
    });
    expect(wrongSession).toEqual({ ok: false, reason: 'session_mismatch' });

    const malformed = verifyPolicyDecisionToken('not-a-token', {
      tenant_id: 't1',
      session_id: 's1',
      action: { name: 'run_command', risk_level: 'medium' },
    });
    expect(malformed).toEqual({ ok: false, reason: 'malformed_token' });
  });

  it('exposes active policy public keys for remote verification', () => {
    const keys = getPolicyPublicKeys();
    expect(keys.length).toBeGreaterThanOrEqual(1);
    expect(keys[0]).toEqual(
      expect.objectContaining({
        kid: expect.any(String),
        alg: 'Ed25519',
        public_key_pem: expect.any(String),
      }),
    );
  });

  it('stores events and artifacts and returns provenance links', () => {
    const workspace = createWorkspace('u1', {
      tenant_id: 'u1',
      mode: 'managed_remote',
      label: 'pilot workspace',
    });

    const artifact = createArtifact('u1', {
      tenant_id: 'u1',
      workspace_id: workspace.workspace_id,
      session_id: 's1',
      artifact_type: 'patch',
      uri: 'file:///tmp/diff.patch',
      policy_decision_jti: 'jti-123',
      skill_ids: ['drupal-security'],
    });

    appendEvent('u1', {
      tenant_id: 'u1',
      workspace_id: workspace.workspace_id,
      session_id: 's1',
      action_type: 'tool_call',
      risk_level: 'medium',
      policy_result: 'allow',
      runtime_target: 'remote',
      artifact_ids: [artifact.artifact_id],
      skill_ids: ['drupal-security'],
    });

    const provenance = getArtifactProvenance(artifact.artifact_id);
    expect(provenance).not.toBeNull();
    expect(provenance?.artifact.artifact_id).toBe(artifact.artifact_id);
    expect(provenance?.related_events).toHaveLength(1);
    expect(provenance?.related_events[0].artifact_ids).toContain(artifact.artifact_id);
  });

  it('resolves requested and inferred skills with de-duplication', () => {
    const resolved = resolveSkills({
      tenant_id: 'u1',
      file_path: 'web/modules/custom/example/example.module',
      requested_skill_ids: ['drupal-security', 'compliance-core'],
      language: 'php',
    });

    const ids = resolved.map((entry) => entry.skill_id);
    expect(ids).toContain('drupal-security');
    expect(ids).toContain('drupal-coding-standards');
    expect(ids).toContain('compliance-core');
    expect(new Set(ids).size).toBe(ids.length);

    for (const skill of resolved) {
      expect(skill.digest).toHaveLength(64);
      expect(skill.constraints.length).toBeGreaterThan(0);
    }
  });
});
