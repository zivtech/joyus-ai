/**
 * Tool policy provider (joyus-ai-internal spec 016, FR-24).
 *
 * The platform asks "which tools are denied for this subject" and applies the
 * answer in three places: `getAllTools` (list), `executeTool` (call) and
 * `getAuthorizedTools` (orchestrator, tenant only). Denies, never an allowlist,
 * so a newly deployed tool stays visible until a policy names it.
 */

export interface ToolDecision {
  /** Published policy epoch; `"0"` when the tenant has never published. */
  epoch: string;
  deniedTools: string[];
}

export interface DecisionSubject {
  tenantId: string;
  /** Absent: tenant-level denies only (the ceiling). */
  userId?: string;
}

export interface PolicyProvider {
  decide(subject: DecisionSubject): Promise<ToolDecision>;
}

/** The provider could not answer and no recent decision exists: callers fail closed. */
export class PolicyUnavailableError extends Error {
  constructor(reason: string) {
    super(`policy provider unavailable: ${reason}`);
    this.name = 'PolicyUnavailableError';
  }
}

/** Default when no policy service is configured: nothing is denied. */
export class AllowAllPolicyProvider implements PolicyProvider {
  async decide(): Promise<ToolDecision> {
    return { epoch: '0', deniedTools: [] };
  }
}

/** How long the last successful decision for a subject may be served when the service fails. */
export const LAST_DECISION_TTL_MS = 10 * 60 * 1000;
const REQUEST_TIMEOUT_MS = 2_000;

export interface HttpPolicyProviderOptions {
  baseUrl: string;
  serviceToken: string;
  fetchImpl?: typeof fetch;
  now?: () => number;
  timeoutMs?: number;
  logger?: Pick<Console, 'error' | 'warn'>;
}

interface Cached {
  decision: ToolDecision;
  etag: string | null;
  /** Last time the service confirmed this decision (200 or 304). */
  confirmedAt: number;
}

function isDecision(value: unknown): value is ToolDecision {
  if (!value || typeof value !== 'object') return false;
  const v = value as Record<string, unknown>;
  return typeof v.epoch === 'string' && Array.isArray(v.deniedTools) && v.deniedTools.every((t) => typeof t === 'string');
}

/**
 * Calls the policy service's `/policy/decide` routes. Revalidates on every
 * call with `If-None-Match`; a 304 reuses the cached decision. On any failure
 * it serves the last decision for that subject if the service confirmed it
 * within {@link LAST_DECISION_TTL_MS}, otherwise it throws
 * {@link PolicyUnavailableError} and callers fail closed. Never fails open.
 */
export class HttpPolicyProvider implements PolicyProvider {
  private readonly cache = new Map<string, Cached>();
  private readonly fetchImpl: typeof fetch;
  private readonly now: () => number;
  private readonly timeoutMs: number;
  private readonly logger: Pick<Console, 'error' | 'warn'>;

  constructor(private readonly options: HttpPolicyProviderOptions) {
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.now = options.now ?? Date.now;
    this.timeoutMs = options.timeoutMs ?? REQUEST_TIMEOUT_MS;
    this.logger = options.logger ?? console;
  }

  async decide(subject: DecisionSubject): Promise<ToolDecision> {
    const key = `${subject.tenantId}\u0000${subject.userId ?? ''}`;
    const cached = this.cache.get(key);
    try {
      const fresh = await this.fetchDecision(subject, cached);
      this.cache.set(key, fresh);
      return fresh.decision;
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      if (cached && this.now() - cached.confirmedAt < LAST_DECISION_TTL_MS) {
        this.logger.warn(`[policy] serving last decision for ${subject.tenantId}: ${reason}`);
        return cached.decision;
      }
      this.logger.error(`[policy] failing closed for ${subject.tenantId}: ${reason}`);
      throw new PolicyUnavailableError(reason);
    }
  }

  private url(subject: DecisionSubject): string {
    const base = this.options.baseUrl.replace(/\/+$/, '');
    const tenant = encodeURIComponent(subject.tenantId);
    return subject.userId === undefined
      ? `${base}/policy/decide/${tenant}`
      : `${base}/policy/decide/${tenant}/${encodeURIComponent(subject.userId)}`;
  }

  private async fetchDecision(subject: DecisionSubject, cached: Cached | undefined): Promise<Cached> {
    const headers: Record<string, string> = {
      authorization: `Bearer ${this.options.serviceToken}`,
      accept: 'application/json',
    };
    if (cached?.etag) headers['if-none-match'] = cached.etag;
    const response = await this.fetchImpl(this.url(subject), {
      headers,
      signal: AbortSignal.timeout(this.timeoutMs),
      redirect: 'error',
    });
    if (response.status === 304 && cached) {
      return { ...cached, confirmedAt: this.now() };
    }
    if (response.status !== 200) throw new Error(`HTTP ${response.status}`);
    const body: unknown = await response.json();
    if (!isDecision(body)) throw new Error('malformed decision');
    return {
      decision: { epoch: body.epoch, deniedTools: [...body.deniedTools] },
      etag: response.headers.get('etag'),
      confirmedAt: this.now(),
    };
  }
}
