import {
  createHash,
  createPrivateKey,
  createPublicKey,
  generateKeyPairSync,
  randomUUID,
  sign as cryptoSign,
  verify as cryptoVerify,
  type KeyObject,
} from 'crypto';

export type RiskLevel = 'low' | 'medium' | 'high';
export type PolicyOutcome = 'allow' | 'deny' | 'escalate';
export type TenantRole = 'owner' | 'admin' | 'operator' | 'reviewer' | 'viewer';

export interface PolicyAction {
  name: string;
  risk_level: RiskLevel;
  target?: string;
  details?: Record<string, unknown>;
}

export interface PolicySession {
  session_id: string;
  tenant_id: string;
  workspace_id?: string;
}

export interface PolicyDecisionInput {
  actor_user_id: string;
  action: PolicyAction;
  session: PolicySession;
  metadata?: Record<string, unknown>;
}

export interface DecisionTokenPayload {
  jti: string;
  tenant_id: string;
  workspace_id: string | null;
  session_id: string;
  action_hash: string;
  exp: number;
  iat: number;
  decision: PolicyOutcome;
  kid: string;
}

export interface PolicyDecision {
  decision: PolicyOutcome;
  reason: string;
  token: string;
  token_expires_at: string;
  jti: string;
  risk_level: RiskLevel;
}

export interface EventInput {
  tenant_id: string;
  workspace_id?: string;
  session_id: string;
  action_type: string;
  risk_level: RiskLevel;
  policy_result: PolicyOutcome;
  runtime_target: 'local' | 'remote';
  skill_ids?: string[];
  artifact_ids?: string[];
  outcome?: 'pass' | 'fail' | 'warn';
  error_code?: string;
  latency_ms?: number;
  details?: Record<string, unknown>;
}

export interface StoredEvent extends EventInput {
  event_id: string;
  user_id: string;
  timestamp: string;
}

export interface WorkspaceInput {
  tenant_id: string;
  mode: 'managed_remote' | 'local';
  label?: string;
}

export interface WorkspaceRecord {
  workspace_id: string;
  tenant_id: string;
  mode: 'managed_remote' | 'local';
  created_by: string;
  label: string | null;
  created_at: string;
  status: 'ready';
}

export interface ArtifactInput {
  tenant_id: string;
  workspace_id: string;
  session_id: string;
  artifact_type: string;
  uri: string;
  policy_decision_jti: string;
  skill_ids?: string[];
  metadata?: Record<string, unknown>;
}

export interface ArtifactRecord extends ArtifactInput {
  artifact_id: string;
  created_by: string;
  created_at: string;
}

export interface SkillResolveInput {
  tenant_id: string;
  file_path?: string;
  requested_skill_ids?: string[];
  language?: string;
}

export interface ResolvedSkill {
  skill_id: string;
  digest: string;
  constraints: string[];
  source: 'requested' | 'inferred';
}

interface PolicyKeyMaterial {
  kid: string;
  privateKey: KeyObject;
  publicKey: KeyObject;
  publicKeyPem: string;
  createdAt: string;
}

export interface PolicyPublicKey {
  kid: string;
  alg: 'Ed25519';
  public_key_pem: string;
  created_at: string;
}

export interface VerifyPolicyDecisionContext {
  tenant_id: string;
  workspace_id?: string;
  session_id: string;
  action: PolicyAction;
}

export type VerifyPolicyDecisionReason =
  | 'malformed_token'
  | 'unknown_key'
  | 'invalid_signature'
  | 'expired'
  | 'tenant_mismatch'
  | 'workspace_mismatch'
  | 'session_mismatch'
  | 'action_mismatch';

export interface VerifyPolicyDecisionResult {
  ok: boolean;
  reason?: VerifyPolicyDecisionReason;
  payload?: DecisionTokenPayload;
}

function defaultTokenKid(): string {
  return process.env.POLICY_TOKEN_KEY_ID || 'policy-dev-ed25519-v1';
}

function nowIso(): string {
  return new Date().toISOString();
}

function expiresIso(ttlSeconds: number): string {
  return new Date(Date.now() + ttlSeconds * 1000).toISOString();
}

function toBase64Url(value: string): string {
  return Buffer.from(value).toString('base64url');
}

function fromBase64Url(value: string): string {
  return Buffer.from(value, 'base64url').toString('utf8');
}

function initializePolicyKeyMaterial(): PolicyKeyMaterial {
  const configuredPrivate = process.env.POLICY_TOKEN_PRIVATE_KEY;
  const configuredPublic = process.env.POLICY_TOKEN_PUBLIC_KEY;

  if (configuredPrivate && configuredPublic) {
    const privateKey = createPrivateKey(configuredPrivate);
    const publicKey = createPublicKey(configuredPublic);
    return {
      kid: defaultTokenKid(),
      privateKey,
      publicKey,
      publicKeyPem: configuredPublic,
      createdAt: nowIso(),
    };
  }

  const generated = generateKeyPairSync('ed25519');
  return {
    kid: defaultTokenKid(),
    privateKey: generated.privateKey,
    publicKey: generated.publicKey,
    publicKeyPem: generated.publicKey.export({ type: 'spki', format: 'pem' }).toString(),
    createdAt: nowIso(),
  };
}

const keyMaterial = initializePolicyKeyMaterial();

export function getPolicyPublicKeys(): PolicyPublicKey[] {
  return [
    {
      kid: keyMaterial.kid,
      alg: 'Ed25519',
      public_key_pem: keyMaterial.publicKeyPem,
      created_at: keyMaterial.createdAt,
    },
  ];
}

function parseDecisionToken(token: string): { payload: DecisionTokenPayload; encodedPayload: string; signature: string } | null {
  const parts = token.split('.');
  if (parts.length !== 2) return null;

  const [encodedPayload, signature] = parts;
  if (!encodedPayload || !signature) return null;

  try {
    const payload = JSON.parse(fromBase64Url(encodedPayload)) as DecisionTokenPayload;
    return { payload, encodedPayload, signature };
  } catch {
    return null;
  }
}

export function computeActionHash(action: PolicyAction): string {
  return createHash('sha256').update(JSON.stringify(action)).digest('hex');
}

function signDecisionToken(payload: DecisionTokenPayload): string {
  const encodedPayload = toBase64Url(JSON.stringify(payload));
  const signature = cryptoSign(null, Buffer.from(encodedPayload), keyMaterial.privateKey).toString('base64url');
  return `${encodedPayload}.${signature}`;
}

function verifyDecisionTokenSignature(token: string): { ok: boolean; payload?: DecisionTokenPayload; reason?: VerifyPolicyDecisionReason } {
  const parsed = parseDecisionToken(token);
  if (!parsed) return { ok: false, reason: 'malformed_token' };

  if (parsed.payload.kid !== keyMaterial.kid) {
    return { ok: false, reason: 'unknown_key' };
  }

  const valid = cryptoVerify(
    null,
    Buffer.from(parsed.encodedPayload),
    keyMaterial.publicKey,
    Buffer.from(parsed.signature, 'base64url'),
  );

  if (!valid) {
    return { ok: false, reason: 'invalid_signature' };
  }

  return { ok: true, payload: parsed.payload };
}

interface TenantMembershipEntry {
  userId: string;
  tenantId: string;
  role: TenantRole;
}

function parseTenantMemberships(raw: string): TenantMembershipEntry[] {
  return raw
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean)
    .map((entry) => {
      const [principal, rolePart] = entry.split('=');
      const [userId, tenantId] = principal.split(':');
      const role = (rolePart?.trim() || 'operator') as TenantRole;
      if (!userId || !tenantId) return null;
      if (!['owner', 'admin', 'operator', 'reviewer', 'viewer'].includes(role)) return null;
      return { userId: userId.trim(), tenantId: tenantId.trim(), role };
    })
    .filter((entry): entry is TenantMembershipEntry => entry !== null);
}

export function getTenantRole(userId: string, tenantId: string): TenantRole | null {
  const memberships = parseTenantMemberships(process.env.CONTROL_PLANE_TENANT_MEMBERSHIPS || '');
  const match = memberships.find((entry) => entry.userId === userId && entry.tenantId === tenantId);
  if (match) return match.role;

  const allowlist = (process.env.CONTROL_PLANE_TENANT_ALLOWLIST || '')
    .split(',')
    .map((entry) => entry.trim())
    .filter(Boolean);

  if (allowlist.includes(`${userId}:${tenantId}`)) {
    return 'operator';
  }

  if (process.env.CONTROL_PLANE_LEGACY_TENANT_MATCH === 'true' && userId === tenantId) {
    return 'owner';
  }

  return null;
}

export function canAccessTenant(userId: string, tenantId: string): boolean {
  if (process.env.CONTROL_PLANE_ALLOW_ANY_TENANT === 'true') return true;
  return getTenantRole(userId, tenantId) !== null;
}

export function hasTenantRole(userId: string, tenantId: string, roles: TenantRole[]): boolean {
  const role = getTenantRole(userId, tenantId);
  if (!role) return false;
  return roles.includes(role);
}

function decideOutcome(action: PolicyAction, metadata?: Record<string, unknown>): { decision: PolicyOutcome; reason: string } {
  if (metadata?.blocked === true) {
    return { decision: 'deny', reason: 'action blocked by policy metadata' };
  }

  if (action.risk_level === 'high') {
    return { decision: 'escalate', reason: 'high-risk action requires human approval' };
  }

  if (action.risk_level === 'medium') {
    const name = action.name.toLowerCase();
    if (name.includes('delete') || name.includes('publish') || name.includes('force')) {
      return { decision: 'escalate', reason: 'medium-risk destructive action requires approval' };
    }
  }

  return { decision: 'allow', reason: 'risk policy allows action' };
}

const eventLedger = new Map<string, StoredEvent>();
const workspaces = new Map<string, WorkspaceRecord>();
const artifacts = new Map<string, ArtifactRecord>();

export function resetControlPlaneState(): void {
  eventLedger.clear();
  workspaces.clear();
  artifacts.clear();
}

export function decidePolicy(input: PolicyDecisionInput): PolicyDecision {
  const outcome = decideOutcome(input.action, input.metadata);
  const jti = randomUUID();
  const iat = Math.floor(Date.now() / 1000);
  const expSeconds = iat + 60;

  const tokenPayload: DecisionTokenPayload = {
    jti,
    kid: keyMaterial.kid,
    tenant_id: input.session.tenant_id,
    workspace_id: input.session.workspace_id ?? null,
    session_id: input.session.session_id,
    action_hash: computeActionHash(input.action),
    iat,
    exp: expSeconds,
    decision: outcome.decision,
  };

  return {
    decision: outcome.decision,
    reason: outcome.reason,
    token: signDecisionToken(tokenPayload),
    token_expires_at: expiresIso(60),
    jti,
    risk_level: input.action.risk_level,
  };
}

export function verifyPolicyDecisionToken(
  token: string,
  context: VerifyPolicyDecisionContext,
  nowEpochSeconds: number = Math.floor(Date.now() / 1000),
): VerifyPolicyDecisionResult {
  const signatureCheck = verifyDecisionTokenSignature(token);
  if (!signatureCheck.ok || !signatureCheck.payload) {
    return { ok: false, reason: signatureCheck.reason };
  }

  const payload = signatureCheck.payload;

  if (payload.exp <= nowEpochSeconds) {
    return { ok: false, reason: 'expired' };
  }

  if (payload.tenant_id !== context.tenant_id) {
    return { ok: false, reason: 'tenant_mismatch' };
  }

  const expectedWorkspace = context.workspace_id ?? null;
  if (payload.workspace_id !== expectedWorkspace) {
    return { ok: false, reason: 'workspace_mismatch' };
  }

  if (payload.session_id !== context.session_id) {
    return { ok: false, reason: 'session_mismatch' };
  }

  if (payload.action_hash !== computeActionHash(context.action)) {
    return { ok: false, reason: 'action_mismatch' };
  }

  return { ok: true, payload };
}

export function appendEvent(userId: string, input: EventInput): StoredEvent {
  const event: StoredEvent = {
    ...input,
    event_id: randomUUID(),
    user_id: userId,
    timestamp: nowIso(),
    skill_ids: input.skill_ids ?? [],
    artifact_ids: input.artifact_ids ?? [],
    outcome: input.outcome ?? 'pass',
  };

  eventLedger.set(event.event_id, event);
  return event;
}

export function listEventsForArtifact(artifactId: string): StoredEvent[] {
  return Array.from(eventLedger.values()).filter((evt) => evt.artifact_ids?.includes(artifactId));
}

export function createWorkspace(userId: string, input: WorkspaceInput): WorkspaceRecord {
  const workspace: WorkspaceRecord = {
    workspace_id: `ws_${randomUUID()}`,
    tenant_id: input.tenant_id,
    mode: input.mode,
    created_by: userId,
    label: input.label ?? null,
    created_at: nowIso(),
    status: 'ready',
  };

  workspaces.set(workspace.workspace_id, workspace);
  return workspace;
}

export function createArtifact(userId: string, input: ArtifactInput): ArtifactRecord {
  const artifact: ArtifactRecord = {
    ...input,
    artifact_id: `art_${randomUUID()}`,
    created_by: userId,
    created_at: nowIso(),
    skill_ids: input.skill_ids ?? [],
  };

  artifacts.set(artifact.artifact_id, artifact);
  return artifact;
}

export function getArtifactProvenance(artifactId: string): { artifact: ArtifactRecord; related_events: StoredEvent[] } | null {
  const artifact = artifacts.get(artifactId);
  if (!artifact) return null;

  return {
    artifact,
    related_events: listEventsForArtifact(artifactId),
  };
}

function buildSkillConstraints(skillId: string): string[] {
  const key = skillId.toLowerCase();

  if (key.includes('security')) {
    return ['validate inputs', 'avoid unsafe query patterns'];
  }

  if (key.includes('drupal')) {
    return ['follow Drupal coding standards', 'prefer framework APIs'];
  }

  if (key.includes('compliance')) {
    return ['preserve audit trail metadata', 'avoid policy bypass'];
  }

  return ['follow project coding standards'];
}

export function resolveSkills(input: SkillResolveInput): ResolvedSkill[] {
  const requested = (input.requested_skill_ids ?? []).map((skillId) => ({
    skill_id: skillId,
    source: 'requested' as const,
  }));

  const inferred: Array<{ skill_id: string; source: 'inferred' }> = [];
  const filePath = input.file_path?.toLowerCase() ?? '';

  if (filePath.endsWith('.module') || filePath.endsWith('.theme') || filePath.endsWith('.php')) {
    inferred.push({ skill_id: 'drupal-security', source: 'inferred' });
    inferred.push({ skill_id: 'drupal-coding-standards', source: 'inferred' });
  }

  const merged = [...requested, ...inferred];
  const dedup = new Map<string, { source: 'requested' | 'inferred' }>();

  for (const entry of merged) {
    if (!dedup.has(entry.skill_id)) {
      dedup.set(entry.skill_id, { source: entry.source });
    }
  }

  return Array.from(dedup.entries()).map(([skill_id, meta]) => ({
    skill_id,
    source: meta.source,
    digest: createHash('sha256').update(skill_id).digest('hex'),
    constraints: buildSkillConstraints(skill_id),
  }));
}
