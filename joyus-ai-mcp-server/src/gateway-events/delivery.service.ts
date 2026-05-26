import type {
  GatewayDeliveryEndpoint,
  GatewayEventDeliveryAttempt,
  GatewayPlatformEvent,
} from '../db/schema/gateway-events.js';

import type {
  DeliveryAdapter,
  DeliveryAdapterResult,
  DeliveryTerminalStatus,
} from './adapters/types.js';
import {
  assertTenantMatch,
  sanitizeErrorSummary,
  type DeliveryEndpointType,
  type DeliveryStatus,
} from './types.js';

export interface DeliveryResultRecord {
  attemptId: string;
  tenantId: string;
  status: DeliveryTerminalStatus;
  deliveredAt?: Date;
  lastError?: string;
  responseSummary?: Record<string, unknown>;
  retryable: boolean;
}

export interface GatewayDeliveryPersistence {
  getPlatformEvent(tenantId: string, eventId: string): Promise<GatewayPlatformEvent | null>;
  getEndpoint(tenantId: string, endpointId: string): Promise<GatewayDeliveryEndpoint | null>;
  recordDeliveryResult(
    attempt: GatewayEventDeliveryAttempt,
    result: DeliveryResultRecord,
  ): Promise<GatewayEventDeliveryAttempt>;
}

export interface GatewayDeliveryServiceOptions {
  now?: () => Date;
}

export interface GatewayDeliveryAttemptOutcome {
  attemptId: string;
  tenantId: string;
  endpointType?: DeliveryEndpointType;
  status: DeliveryStatus;
  deliveredAt?: Date;
  lastError?: string;
  responseSummary?: Record<string, unknown>;
  retryable: boolean;
}

export class DeliveryAdapterNotFoundError extends Error {
  constructor(endpointType: DeliveryEndpointType) {
    super(`Delivery adapter not registered for endpoint type: ${endpointType}`);
    this.name = 'DeliveryAdapterNotFoundError';
  }
}

export class GatewayDeliveryResourceNotFoundError extends Error {
  constructor(resourceName: string, resourceId: string) {
    super(`${resourceName} not found: ${resourceId}`);
    this.name = 'GatewayDeliveryResourceNotFoundError';
  }
}

export class GatewayDeliveryService {
  private readonly adapters = new Map<DeliveryEndpointType, DeliveryAdapter>();
  private readonly now: () => Date;

  constructor(
    private readonly persistence: GatewayDeliveryPersistence,
    adapters: DeliveryAdapter[],
    options: GatewayDeliveryServiceOptions = {},
  ) {
    for (const adapter of adapters) {
      this.adapters.set(adapter.type, adapter);
    }
    this.now = options.now ?? (() => new Date());
  }

  async deliverAttempts(
    attempts: GatewayEventDeliveryAttempt[],
  ): Promise<GatewayDeliveryAttemptOutcome[]> {
    return Promise.all(attempts.map((attempt) => this.deliverAttemptSafely(attempt)));
  }

  async deliverAttempt(
    attempt: GatewayEventDeliveryAttempt,
  ): Promise<GatewayDeliveryAttemptOutcome> {
    if (attempt.status !== 'pending') {
      return {
        attemptId: attempt.id,
        tenantId: attempt.tenantId,
        status: 'failed',
        lastError: `Delivery attempt is not pending: ${attempt.status}`,
        retryable: false,
      };
    }

    const [event, endpoint] = await Promise.all([
      this.persistence.getPlatformEvent(attempt.tenantId, attempt.eventId),
      this.persistence.getEndpoint(attempt.tenantId, attempt.endpointId),
    ]);

    if (!event) {
      throw new GatewayDeliveryResourceNotFoundError('platform event', attempt.eventId);
    }
    if (!endpoint) {
      throw new GatewayDeliveryResourceNotFoundError('delivery endpoint', attempt.endpointId);
    }

    assertTenantMatch(attempt.tenantId, event.tenantId, 'platform event');
    assertTenantMatch(attempt.tenantId, endpoint.tenantId, 'delivery endpoint');

    const adapter = this.adapters.get(endpoint.type);
    if (!adapter) {
      throw new DeliveryAdapterNotFoundError(endpoint.type);
    }

    const adapterResult = await adapter.deliver({
      event,
      endpoint,
      attempt,
      now: this.now(),
    });
    return this.recordResult(attempt, endpoint.type, normalizeAdapterResult(adapterResult));
  }

  private async deliverAttemptSafely(
    attempt: GatewayEventDeliveryAttempt,
  ): Promise<GatewayDeliveryAttemptOutcome> {
    try {
      return await this.deliverAttempt(attempt);
    } catch (error) {
      const result = normalizeAdapterResult({
        status: 'failed',
        lastError: sanitizeErrorSummary(error),
        responseSummary: { backend: 'coordinator' },
        retryable: false,
      });
      return this.recordResult(attempt, undefined, result);
    }
  }

  private async recordResult(
    attempt: GatewayEventDeliveryAttempt,
    endpointType: DeliveryEndpointType | undefined,
    result: RequiredNormalizedDeliveryResult,
  ): Promise<GatewayDeliveryAttemptOutcome> {
    const recorded = await this.persistence.recordDeliveryResult(attempt, {
      attemptId: attempt.id,
      tenantId: attempt.tenantId,
      status: result.status,
      deliveredAt: result.deliveredAt,
      lastError: result.lastError,
      responseSummary: result.responseSummary,
      retryable: result.retryable,
    });

    return {
      attemptId: recorded.id,
      tenantId: recorded.tenantId,
      endpointType,
      status: recorded.status as DeliveryStatus,
      deliveredAt: recorded.deliveredAt ?? undefined,
      lastError: recorded.lastError ?? undefined,
      responseSummary: recorded.responseSummary ?? undefined,
      retryable: result.retryable,
    };
  }
}

interface RequiredNormalizedDeliveryResult {
  status: DeliveryTerminalStatus;
  deliveredAt?: Date;
  lastError?: string;
  responseSummary: Record<string, unknown>;
  retryable: boolean;
}

function normalizeAdapterResult(result: DeliveryAdapterResult): RequiredNormalizedDeliveryResult {
  return {
    status: result.status,
    deliveredAt: result.status === 'sent' ? result.deliveredAt ?? new Date() : undefined,
    lastError: result.lastError ? sanitizeErrorSummary(result.lastError).slice(0, 2000) : undefined,
    responseSummary: sanitizeResponseSummary(result.responseSummary ?? {}),
    retryable: result.retryable ?? result.status === 'failed',
  };
}

function sanitizeResponseSummary(summary: Record<string, unknown>): Record<string, unknown> {
  const entries = Object.entries(summary).filter(([key]) => (
    !/(secret|token|password|credential|signature|authorization|payload|body|headers?)/i.test(key)
  ));
  return Object.fromEntries(entries);
}
