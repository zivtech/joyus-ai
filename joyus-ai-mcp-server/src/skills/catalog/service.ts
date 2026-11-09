/**
 * In-process generation store and refresh orchestrator (data-model.md, refresh.md).
 * Owns atomic activation, the fresh/stale/unavailable state table, the 64 MiB memory
 * budget, and the single `refresh()` entry point shared by startup, timer and the
 * authenticated HTTP trigger. Never itself decides tool-level authorization: reads are
 * gated by matching the current published source binding against the generation's
 * verified binding (`getActiveGeneration`).
 *
 * `refresh()` returns as soon as the attempt is admitted (queued or started); the actual
 * policy (re-)reads, source fetch and validation run in the background, exactly like the
 * startup/timer paths, and are only observable through `getRefreshAttempt`.
 */
import { CATALOG_LIMITS } from './config.js';
import { CatalogMemoryLedger } from './service-budget.js';
import { CatalogSourceQueue } from './service-queue.js';
import { CandidateReservation } from './service-reservation.js';
import type { CatalogSourcePort } from './service-source.js';
import {
  computeLogicalSourceKey,
  sourceBindingRevision,
  type CatalogAccessPolicyReader,
  type CatalogServiceRuntime,
  type Freshness,
  type Generation,
  type RefreshAttempt,
  type RefreshAttemptState,
  type RefreshCategory,
  type RefreshTrigger,
} from './types.js';
import { parseIndex, validateCandidate } from './validation.js';

const HEADROOM_POLL_INTERVAL_MS = 200;

export interface MonotonicClock {
  now(): number;
}

export const systemClock: MonotonicClock = { now: () => performance.now() };

export interface CatalogServiceOptions {
  readonly policyReader: CatalogAccessPolicyReader;
  readonly sourcePort: CatalogSourcePort;
  /** Resolves a policy-supplied `credentialAlias` to the actual secret value, or undefined. */
  readonly resolveCredential: (credentialAlias: string) => string | undefined;
  readonly clock?: MonotonicClock;
  readonly randomOperationId?: () => string;
  /** Overridable for tests; production default is a real timer-based sleep. */
  readonly sleep?: (ms: number) => Promise<void>;
}

interface GenerationRecord {
  generation: Generation;
  pinCount: number;
}

function defaultOperationId(): string {
  return `refresh_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
}

function defaultSleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/** The sole production/test generation store and refresh orchestrator. */
export class CatalogService implements CatalogServiceRuntime {
  private readonly clock: MonotonicClock;
  private readonly randomOperationId: () => string;
  private readonly sleep: (ms: number) => Promise<void>;
  private readonly ledger = new CatalogMemoryLedger();
  private readonly queue = new CatalogSourceQueue();

  private readonly records = new Map<string, GenerationRecord>();
  // Reverification can create distinct read-held objects with identical source/revision/epoch.
  private readonly retiredRecords = new Map<Generation, GenerationRecord>();
  private readonly sourceAuthDenied = new Set<string>();
  private readonly failedSinceVerification = new Set<string>();
  private readonly sequenceBySource = new Map<string, number>();

  private readonly inFlightBySource = new Map<string, RefreshAttempt>();
  private readonly finishedOrder: string[] = [];
  private readonly attemptsById = new Map<string, RefreshAttempt>();
  private readonly controllersById = new Map<string, AbortController>();
  private readonly queuedTriggerBySource = new Map<string, RefreshTrigger>();

  private timer: ReturnType<typeof setInterval> | undefined;
  private shuttingDown = false;

  constructor(private readonly options: CatalogServiceOptions) {
    this.clock = options.clock ?? systemClock;
    this.randomOperationId = options.randomOperationId ?? defaultOperationId;
    this.sleep = options.sleep ?? defaultSleep;
  }

  // --- CatalogGenerationQuery / CatalogServiceRuntime -----------------------------------

  getActiveGeneration(logicalSourceKey: string, currentBinding: string): Generation | undefined {
    const record = this.records.get(logicalSourceKey);
    if (!record) return undefined;
    if (record.generation.sourceBindingRevision !== currentBinding) return undefined;
    if (this.sourceAuthDenied.has(logicalSourceKey)) return undefined;
    if (this.computeFreshness(record.generation) === 'unavailable') return undefined;
    return record.generation;
  }

  computeFreshness(generation: Generation): Freshness {
    if (this.sourceAuthDenied.has(generation.logicalSourceKey)) return 'unavailable';
    const ageMs = this.clock.now() - generation.verifiedAtMonotonicMs;
    if (ageMs >= CATALOG_LIMITS.STALE_CEILING_MS) return 'unavailable';
    if (
      ageMs < CATALOG_LIMITS.REFRESH_INTERVAL_MS &&
      !this.failedSinceVerification.has(generation.logicalSourceKey)
    ) {
      return 'fresh';
    }
    return 'stale';
  }

  pinGeneration(generation: Generation): void {
    const record = this.records.get(generation.logicalSourceKey);
    if (record && record.generation === generation) {
      record.pinCount += 1;
      return;
    }
    for (const retired of this.retiredRecords.values()) {
      if (retired.generation === generation) {
        retired.pinCount += 1;
        return;
      }
    }
  }

  releaseGeneration(generation: Generation): void {
    const record = this.records.get(generation.logicalSourceKey);
    if (record && record.generation === generation) {
      record.pinCount = Math.max(0, record.pinCount - 1);
      return;
    }
    for (const [key, retired] of this.retiredRecords) {
      if (retired.generation === generation) {
        retired.pinCount = Math.max(0, retired.pinCount - 1);
        if (retired.pinCount === 0) {
          this.ledger.releaseRetired(key);
          this.retiredRecords.delete(key);
        }
        return;
      }
    }
  }

  // --- Refresh lifecycle -----------------------------------------------------------------

  getRefreshAttempt(operationId: string): RefreshAttempt | undefined {
    return this.attemptsById.get(operationId);
  }

  /** The currently in-flight (queued or running) attempt for `tenantId`, if any. */
  peekInFlight(tenantId: string): RefreshAttempt | undefined {
    return this.inFlightBySource.get(tenantId);
  }

  /** Single entry point used identically by startup, timer, and the authenticated HTTP route. */
  refresh(tenantId: string, trigger: RefreshTrigger): RefreshAttempt {
    const existing = this.inFlightBySource.get(tenantId);
    if (existing) return existing;

    const sequence = (this.sequenceBySource.get(tenantId) ?? 0) + 1;
    this.sequenceBySource.set(tenantId, sequence);

    const attempt: RefreshAttempt = {
      operationId: this.randomOperationId(),
      sourceKey: tenantId,
      epoch: '',
      sequence,
      trigger,
      state: 'in_progress',
      startedAt: new Date().toISOString(),
    };
    this.attemptsById.set(attempt.operationId, attempt);

    if (this.shuttingDown) {
      return this.terminalize(attempt, 'rejected', 'shutdown');
    }

    this.inFlightBySource.set(tenantId, attempt);
    const outcome = this.queue.enqueue(tenantId);
    if (outcome === 'full') {
      this.inFlightBySource.delete(tenantId);
      return this.terminalize(attempt, 'rejected', 'limit');
    }
    if (outcome === 'started') {
      void this.runAttempt(tenantId, sequence, attempt);
    } else {
      this.queuedTriggerBySource.set(tenantId, trigger);
    }
    return attempt;
  }

  /** Startup/timer: enumerate all configured tenants from one policy read and refresh each;
   * also sweeps tracked generations whose tenant is no longer enabled/approved/present. */
  async runConfiguredRefresh(trigger: Extract<RefreshTrigger, 'startup' | 'timer'>): Promise<void> {
    const policyResult = await this.readPolicyBounded();
    if (!policyResult.ok) return;

    for (const logicalSourceKey of [...this.records.keys()]) {
      const tenantId = logicalSourceKey.split('::')[0];
      const entry = policyResult.policy.tenants[tenantId];
      if (!entry || !entry.enabled || !entry.approved) this.evictIfTracked(tenantId);
    }

    for (const [tenantId, entry] of Object.entries(policyResult.policy.tenants)) {
      if (entry.enabled && entry.approved) this.refresh(tenantId, trigger);
    }
  }

  startTimer(): void {
    if (this.timer) return;
    this.timer = setInterval(() => {
      void this.runConfiguredRefresh('timer');
    }, CATALOG_LIMITS.REFRESH_INTERVAL_MS);
    this.timer.unref?.();
  }

  shutdown(): void {
    this.shuttingDown = true;
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = undefined;
    }
    this.queue.clear();
    this.queuedTriggerBySource.clear();
    for (const controller of this.controllersById.values()) controller.abort();
    for (const [tenantId, attempt] of [...this.inFlightBySource]) {
      if (attempt.state === 'in_progress') this.terminalizeInPlace(attempt, 'rejected', 'shutdown');
      this.inFlightBySource.delete(tenantId);
    }
  }

  // --- Internal helpers --------------------------------------------------------------------

  private async readPolicyBounded() {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), CATALOG_LIMITS.POLICY_READ_DEADLINE_MS);
    try {
      return await this.options.policyReader.readPolicy(controller.signal);
    } finally {
      clearTimeout(timer);
    }
  }

  private evictIfTracked(tenantId: string): void {
    for (const logicalSourceKey of [...this.records.keys()]) {
      if (!logicalSourceKey.startsWith(`${tenantId}::`)) continue;
      const record = this.records.get(logicalSourceKey);
      if (!record) continue;
      this.records.delete(logicalSourceKey);
      if (record.pinCount > 0) {
        const retiredKey = record.generation;
        this.retiredRecords.set(retiredKey, record);
        this.ledger.retire(retiredKey, record.generation.totalDocumentBytes);
      }
      this.ledger.removeActive(logicalSourceKey);
    }
  }

  private terminalize(
    attempt: RefreshAttempt,
    state: RefreshAttemptState,
    category?: RefreshCategory,
    revision?: string
  ): RefreshAttempt {
    this.terminalizeInPlace(attempt, state, category, revision);
    return attempt;
  }

  private terminalizeInPlace(
    attempt: RefreshAttempt,
    state: RefreshAttemptState,
    category?: RefreshCategory,
    revision?: string
  ): void {
    attempt.state = state;
    attempt.category = category;
    attempt.completedAt = new Date().toISOString();
    if (revision) attempt.revision = revision;
    this.recordFinished(attempt);
  }

  private recordFinished(attempt: RefreshAttempt): void {
    this.finishedOrder.push(attempt.operationId);
    while (this.finishedOrder.length > CATALOG_LIMITS.REFRESH_STATUS_MAX_RECORDS) {
      const oldest = this.finishedOrder.shift();
      if (oldest) this.attemptsById.delete(oldest);
    }
    const timer = setTimeout(() => {
      this.attemptsById.delete(attempt.operationId);
    }, CATALOG_LIMITS.REFRESH_STATUS_RETENTION_MS);
    timer.unref?.();
  }

  private async reserveWithWait(bytes: number, signal: AbortSignal): Promise<boolean> {
    if (this.ledger.reserveCandidateBytes(bytes)) return true;
    const deadline = this.clock.now() + CATALOG_LIMITS.CANDIDATE_RELEASE_WAIT_MS;
    while (this.clock.now() < deadline) {
      if (signal.aborted) return false;
      await this.sleep(HEADROOM_POLL_INTERVAL_MS);
      if (this.ledger.reserveCandidateBytes(bytes)) return true;
    }
    return false;
  }

  private activate(logicalSourceKey: string, generation: Generation): void {
    const priorRecord = this.records.get(logicalSourceKey);
    this.ledger.activate(logicalSourceKey, generation.totalDocumentBytes);
    if (priorRecord && priorRecord.pinCount > 0) {
      const retiredKey = priorRecord.generation;
      this.ledger.retire(retiredKey, priorRecord.generation.totalDocumentBytes);
      this.retiredRecords.set(retiredKey, priorRecord);
    }
    this.records.set(logicalSourceKey, { generation, pinCount: 0 });
    this.sourceAuthDenied.delete(logicalSourceKey);
    this.failedSinceVerification.delete(logicalSourceKey);
  }

  private recordSourceFailure(logicalSourceKey: string, category: RefreshCategory): void {
    if (category === 'source_authorization') {
      this.sourceAuthDenied.add(logicalSourceKey);
    } else {
      this.failedSinceVerification.add(logicalSourceKey);
    }
  }

  private promoteNext(finishedSourceKey: string): void {
    const promoted = this.queue.complete(finishedSourceKey);
    if (!promoted) return;
    const trigger = this.queuedTriggerBySource.get(promoted);
    this.queuedTriggerBySource.delete(promoted);
    const promotedAttempt = this.inFlightBySource.get(promoted);
    if (promotedAttempt && trigger)
      void this.runAttempt(promoted, promotedAttempt.sequence, promotedAttempt);
  }

  private async runAttempt(
    tenantId: string,
    sequence: number,
    attempt: RefreshAttempt
  ): Promise<void> {
    const controller = new AbortController();
    this.controllersById.set(attempt.operationId, controller);
    const deadlineAt = this.clock.now() + CATALOG_LIMITS.CANDIDATE_TIMEOUT_MS;
    const timeoutTimer = setTimeout(() => controller.abort(), CATALOG_LIMITS.CANDIDATE_TIMEOUT_MS);
    timeoutTimer.unref?.();

    let reservation: CandidateReservation | undefined;
    const finish = (
      state: RefreshAttemptState,
      category?: RefreshCategory,
      revision?: string
    ): void => {
      // Idempotent: shutdown() may have already terminalized this attempt directly.
      if (attempt.state !== 'in_progress') return;
      clearTimeout(timeoutTimer);
      this.controllersById.delete(attempt.operationId);
      this.terminalizeInPlace(attempt, state, category, revision);
      this.inFlightBySource.delete(tenantId);
      this.promoteNext(tenantId);
    };
    const releaseAndFinish = (state: RefreshAttemptState, category: RefreshCategory): void => {
      reservation?.dispose();
      finish(state, category);
    };

    try {
      const policyResult = await this.readPolicyBounded();
      if (!policyResult.ok) return releaseAndFinish('rejected', 'policy');
      const entry = policyResult.policy.tenants[tenantId];
      if (!entry || !entry.enabled || !entry.approved) {
        this.evictIfTracked(tenantId);
        return releaseAndFinish('rejected', 'policy');
      }
      if (this.sequenceBySource.get(tenantId) !== sequence)
        return releaseAndFinish('rejected', 'superseded');

      const epoch = entry.epoch;
      const binding = sourceBindingRevision(entry.source);
      const source = {
        provider: entry.source.provider,
        owner: entry.source.owner,
        repository: entry.source.repository,
        ref: entry.source.ref,
      };
      const logicalSourceKey = computeLogicalSourceKey(tenantId, source);

      const credential = this.options.resolveCredential(entry.source.credentialAlias);
      if (!credential) return releaseAndFinish('rejected', 'policy');

      const headResult = await this.options.sourcePort.resolveCandidate({
        owner: source.owner,
        repository: source.repository,
        ref: source.ref,
        credential,
        deadlineAt,
        signal: controller.signal,
      });
      if (!headResult.ok) {
        this.recordSourceFailure(logicalSourceKey, headResult.failure.category);
        return releaseAndFinish('rejected', headResult.failure.category);
      }

      const indexResult = parseIndex(headResult.value.indexRaw);
      if (!indexResult.ok) {
        this.recordSourceFailure(logicalSourceKey, indexResult.failure.category);
        return releaseAndFinish('rejected', indexResult.failure.category);
      }

      const declaredBytes = indexResult.value.skills.reduce((sum, skill) => sum + skill.bytes, 0);
      if (declaredBytes > CATALOG_LIMITS.MAX_GENERATION_DOCUMENT_BYTES)
        return releaseAndFinish('rejected', 'limit');

      const reserved = await this.reserveWithWait(declaredBytes, controller.signal);
      if (!reserved) return releaseAndFinish('rejected', 'limit');
      const candidateReservation = new CandidateReservation(this.ledger, declaredBytes);
      reservation = candidateReservation;

      const paths = indexResult.value.skills.map(skill => skill.path);
      const documentsResult = await this.options.sourcePort.fetchDocuments({
        owner: source.owner,
        repository: source.repository,
        ref: source.ref,
        credential,
        deadlineAt,
        signal: controller.signal,
        revision: headResult.value.revision,
        paths,
        reserveDocumentBytes: bytes => candidateReservation.reserve(bytes),
        releaseDocumentBytes: bytes => candidateReservation.release(bytes),
      });
      if (!documentsResult.ok) {
        this.recordSourceFailure(logicalSourceKey, documentsResult.failure.category);
        return releaseAndFinish('rejected', documentsResult.failure.category);
      }

      const validated = validateCandidate(headResult.value.indexRaw, documentsResult.value);
      if (!validated.ok) {
        this.recordSourceFailure(logicalSourceKey, validated.failure.category);
        return releaseAndFinish('rejected', validated.failure.category);
      }

      const reverify = await this.readPolicyBounded();
      if (!reverify.ok) return releaseAndFinish('rejected', 'policy');
      const currentEntry = reverify.policy.tenants[tenantId];
      const stillCurrent =
        currentEntry !== undefined &&
        currentEntry.enabled &&
        currentEntry.approved &&
        sourceBindingRevision(currentEntry.source) === binding &&
        this.sequenceBySource.get(tenantId) === sequence;
      if (!stillCurrent) return releaseAndFinish('rejected', 'superseded');

      if (!this.ledger.canActivate(logicalSourceKey, validated.value.totalDocumentBytes)) {
        return releaseAndFinish('rejected', 'limit');
      }

      const generation: Generation = {
        logicalSourceKey,
        source,
        epoch,
        sourceBindingRevision: binding,
        revision: headResult.value.revision,
        verifiedAtMonotonicMs: this.clock.now(),
        verifiedAtIso: new Date().toISOString(),
        skills: validated.value.skills.map(({ document: _document, ...meta }) => meta),
        documents: new Map(validated.value.skills.map(skill => [skill.path, skill.document])),
        totalDocumentBytes: validated.value.totalDocumentBytes,
      };

      if (!candidateReservation.transfer(generation.totalDocumentBytes)) {
        return releaseAndFinish('rejected', 'validation');
      }
      this.activate(logicalSourceKey, generation);
      finish('activated', undefined, generation.revision);
    } catch {
      releaseAndFinish('rejected', controller.signal.aborted ? 'timeout' : 'upstream_failure');
    }
  }
}

export function createCatalogService(options: CatalogServiceOptions): CatalogService {
  return new CatalogService(options);
}
