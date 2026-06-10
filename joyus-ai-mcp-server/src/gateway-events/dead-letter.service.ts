import type { GatewayEventDeliveryAttempt } from '../db/schema/gateway-events.js';

import type { DeliveryResultRecord } from './delivery.service.js';
import {
  redactSecretsDeep,
  sanitizeErrorSummary,
  type DeliveryStatus,
} from './types.js';

export const DEFAULT_MAX_DELIVERY_ATTEMPTS = 3;
export const DEFAULT_RETRY_BACKOFF_MS = 60_000;
export const MAX_RETRY_BACKOFF_MS = 15 * 60_000;

export const TERMINAL_DELIVERY_STATUSES = [
  'sent',
  'dead_letter',
  'skipped_no_channel',
] as const satisfies readonly DeliveryStatus[];

export interface DeliveryAttemptStatePatch {
  status?: DeliveryStatus;
  attemptNumber?: number;
  nextRetryAt?: Date | null;
  deliveredAt?: Date | null;
  lastError?: string | null;
  responseSummary?: Record<string, unknown> | null;
  updatedAt?: Date;
}

export interface DeliveryAttemptStateStore {
  updateDeliveryAttempt(
    tenantId: string,
    attemptId: string,
    patch: DeliveryAttemptStatePatch,
  ): Promise<GatewayEventDeliveryAttempt>;
  listDeliveryAttemptsByStatus(
    tenantId: string,
    status: DeliveryStatus,
  ): Promise<GatewayEventDeliveryAttempt[]>;
  listDueRetryAttempts(now: Date, limit: number): Promise<GatewayEventDeliveryAttempt[]>;
}

export interface DeliveryAttemptStateServiceOptions {
  now?: () => Date;
  retryBackoffMs?: number;
}

export class DeliveryAttemptStateService {
  private readonly now: () => Date;
  private readonly retryBackoffMs: number;

  constructor(
    private readonly store: DeliveryAttemptStateStore,
    options: DeliveryAttemptStateServiceOptions = {},
  ) {
    this.now = options.now ?? (() => new Date());
    this.retryBackoffMs = options.retryBackoffMs ?? DEFAULT_RETRY_BACKOFF_MS;
  }

  async recordDeliveryResult(
    attempt: GatewayEventDeliveryAttempt,
    result: DeliveryResultRecord,
  ): Promise<GatewayEventDeliveryAttempt> {
    const now = this.now();
    const patch = this.transitionFromResult(attempt, result, now);
    return this.store.updateDeliveryAttempt(attempt.tenantId, attempt.id, patch);
  }

  async markRetryDuePending(
    attempt: GatewayEventDeliveryAttempt,
    now = this.now(),
  ): Promise<GatewayEventDeliveryAttempt> {
    if (attempt.status !== 'retry_scheduled') {
      throw new Error(`Delivery attempt is not scheduled for retry: ${attempt.status}`);
    }
    if (attempt.nextRetryAt && attempt.nextRetryAt > now) {
      throw new Error('Delivery attempt retry time has not arrived');
    }

    const maxAttempts = attempt.maxAttempts || DEFAULT_MAX_DELIVERY_ATTEMPTS;
    if (attempt.attemptNumber >= maxAttempts) {
      return this.deadLetterAttempt(attempt, 'Retry budget exhausted before dispatch');
    }

    return this.store.updateDeliveryAttempt(attempt.tenantId, attempt.id, {
      status: 'pending',
      attemptNumber: attempt.attemptNumber + 1,
      nextRetryAt: null,
      updatedAt: now,
    });
  }

  async deadLetterAttempt(
    attempt: GatewayEventDeliveryAttempt,
    reason: string,
  ): Promise<GatewayEventDeliveryAttempt> {
    return this.store.updateDeliveryAttempt(attempt.tenantId, attempt.id, {
      status: 'dead_letter',
      nextRetryAt: null,
      deliveredAt: null,
      lastError: sanitizeErrorSummary(reason).slice(0, 2000),
      updatedAt: this.now(),
    });
  }

  async listDeadLetters(tenantId: string): Promise<GatewayEventDeliveryAttempt[]> {
    requireTenantScope(tenantId);
    return this.store.listDeliveryAttemptsByStatus(tenantId, 'dead_letter');
  }

  async listDueRetryAttempts(
    now = this.now(),
    limit = 100,
  ): Promise<GatewayEventDeliveryAttempt[]> {
    return this.store.listDueRetryAttempts(now, limit);
  }

  private transitionFromResult(
    attempt: GatewayEventDeliveryAttempt,
    result: DeliveryResultRecord,
    now: Date,
  ): DeliveryAttemptStatePatch {
    const responseSummary = sanitizeSummary(result.responseSummary ?? {});
    if (result.status === 'sent') {
      return {
        status: 'sent',
        deliveredAt: result.deliveredAt ?? now,
        nextRetryAt: null,
        lastError: null,
        responseSummary,
        updatedAt: now,
      };
    }

    if (result.status === 'skipped_no_channel') {
      return {
        status: 'skipped_no_channel',
        deliveredAt: null,
        nextRetryAt: null,
        lastError: null,
        responseSummary,
        updatedAt: now,
      };
    }

    const lastError = sanitizeErrorSummary(result.lastError ?? 'Delivery failed').slice(0, 2000);
    const shouldDeadLetter = !result.retryable || attempt.attemptNumber >= maxAttemptsFor(attempt);
    if (shouldDeadLetter) {
      return {
        status: 'dead_letter',
        deliveredAt: null,
        nextRetryAt: null,
        lastError,
        responseSummary,
        updatedAt: now,
      };
    }

    return {
      status: 'retry_scheduled',
      deliveredAt: null,
      nextRetryAt: new Date(now.getTime() + retryDelayMs(attempt, this.retryBackoffMs)),
      lastError,
      responseSummary,
      updatedAt: now,
    };
  }
}

export function isTerminalDeliveryStatus(status: DeliveryStatus): boolean {
  return TERMINAL_DELIVERY_STATUSES.includes(status as (typeof TERMINAL_DELIVERY_STATUSES)[number]);
}

export function retryDelayMs(
  attempt: GatewayEventDeliveryAttempt,
  baseBackoffMs = DEFAULT_RETRY_BACKOFF_MS,
): number {
  const exponent = Math.max(0, attempt.attemptNumber - 1);
  return Math.min(baseBackoffMs * 2 ** exponent, MAX_RETRY_BACKOFF_MS);
}

export function maxAttemptsFor(attempt: GatewayEventDeliveryAttempt): number {
  return attempt.maxAttempts || DEFAULT_MAX_DELIVERY_ATTEMPTS;
}

export function requireTenantScope(tenantId: string): void {
  if (!tenantId.trim()) {
    throw new Error('tenantId is required');
  }
}

function sanitizeSummary(summary: Record<string, unknown>): Record<string, unknown> {
  const redacted = redactSecretsDeep(summary);
  return redacted && typeof redacted === 'object' && !Array.isArray(redacted)
    ? redacted as Record<string, unknown>
    : { value: redacted };
}
