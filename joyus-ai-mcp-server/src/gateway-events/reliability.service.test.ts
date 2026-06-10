import { describe, expect, it } from 'vitest';

import type {
  GatewayAuditRecord,
  GatewayEventDeliveryAttempt,
} from '../db/schema/gateway-events.js';

import {
  summarizeDeliveryAttempts,
  type CreateGatewayAuditRecordInput,
  type GatewayAuditQuery,
  GatewayAuditService,
  type GatewayAuditStore,
} from './audit.service.js';
import {
  DeliveryAttemptStateService,
  type DeliveryAttemptStatePatch,
  type DeliveryAttemptStateStore,
} from './dead-letter.service.js';
import type { GatewayDeliveryAttemptOutcome } from './delivery.service.js';
import { GatewayRetryWorker } from './retry.worker.js';
import type { DeliveryStatus } from './types.js';

class FakeDeliveryAttemptStateStore implements DeliveryAttemptStateStore {
  attempts = new Map<string, GatewayEventDeliveryAttempt>();

  async updateDeliveryAttempt(
    _tenantId: string,
    attemptId: string,
    patch: DeliveryAttemptStatePatch,
  ): Promise<GatewayEventDeliveryAttempt> {
    const current = this.attempts.get(attemptId);
    if (!current) {
      throw new Error(`missing attempt ${attemptId}`);
    }

    const updated = {
      ...current,
      ...patch,
      updatedAt: patch.updatedAt ?? current.updatedAt,
    } satisfies GatewayEventDeliveryAttempt;
    this.attempts.set(attemptId, updated);
    return updated;
  }

  async listDeliveryAttemptsByStatus(
    tenantId: string,
    status: DeliveryStatus,
  ): Promise<GatewayEventDeliveryAttempt[]> {
    return [...this.attempts.values()].filter((attempt) => (
      attempt.tenantId === tenantId && attempt.status === status
    ));
  }

  async listDueRetryAttempts(now: Date, limit: number): Promise<GatewayEventDeliveryAttempt[]> {
    return [...this.attempts.values()]
      .filter((attempt) => (
        attempt.status === 'retry_scheduled'
        && attempt.nextRetryAt !== null
        && attempt.nextRetryAt <= now
      ))
      .slice(0, limit);
  }
}

class FakeAuditStore implements GatewayAuditStore {
  records: GatewayAuditRecord[] = [];

  async createAuditRecord(input: CreateGatewayAuditRecordInput): Promise<GatewayAuditRecord> {
    const record = {
      id: `audit_${this.records.length + 1}`,
      tenantId: input.tenantId,
      action: input.action,
      eventId: input.eventId ?? null,
      deliveryAttemptId: input.deliveryAttemptId ?? null,
      decisionId: input.decisionId ?? null,
      endpointId: input.endpointId ?? null,
      sourceBackend: input.sourceBackend ?? null,
      idempotencyKey: input.idempotencyKey ?? null,
      summary: input.summary ?? {},
      errorSummary: input.errorSummary ?? null,
      createdAt: new Date('2026-05-25T12:00:00Z'),
    } satisfies GatewayAuditRecord;
    this.records.push(record);
    return record;
  }

  async listAuditRecords(
    tenantId: string,
    query: GatewayAuditQuery = {},
  ): Promise<GatewayAuditRecord[]> {
    return this.records.filter((record) => (
      record.tenantId === tenantId
      && (!query.action || record.action === query.action)
      && (!query.eventId || record.eventId === query.eventId)
      && (!query.deliveryAttemptId || record.deliveryAttemptId === query.deliveryAttemptId)
      && (!query.decisionId || record.decisionId === query.decisionId)
    ));
  }
}

function attempt(overrides: Partial<GatewayEventDeliveryAttempt> = {}): GatewayEventDeliveryAttempt {
  return {
    id: 'attempt_1',
    tenantId: 'tenant_123',
    eventId: 'event_1',
    subscriptionId: 'subscription_1',
    endpointId: 'endpoint_1',
    status: 'pending',
    attemptNumber: 1,
    maxAttempts: 3,
    nextRetryAt: null,
    deliveredAt: null,
    lastError: null,
    responseSummary: null,
    createdAt: new Date('2026-05-25T12:00:00Z'),
    updatedAt: new Date('2026-05-25T12:00:00Z'),
    ...overrides,
  };
}

describe('DeliveryAttemptStateService', () => {
  it('schedules retryable failures with bounded backoff and sanitized state', async () => {
    const store = new FakeDeliveryAttemptStateStore();
    const original = attempt({
      responseSummary: {
        existing: true,
      },
    });
    store.attempts.set(original.id, original);
    const service = new DeliveryAttemptStateService(store, {
      now: () => new Date('2026-05-25T12:00:00Z'),
      retryBackoffMs: 30_000,
    });

    const updated = await service.recordDeliveryResult(original, {
      attemptId: original.id,
      tenantId: original.tenantId,
      status: 'failed',
      lastError: 'POST failed Bearer abc.def?secret=not-kept',
      responseSummary: {
        status: 503,
        webhookSecret: 'should-not-persist',
      },
      retryable: true,
    });

    expect(updated).toMatchObject({
      status: 'retry_scheduled',
      lastError: 'POST failed Bearer [REDACTED]?secret=[REDACTED]',
    });
    expect(updated.nextRetryAt?.toISOString()).toBe('2026-05-25T12:00:30.000Z');
    expect(JSON.stringify(updated.responseSummary)).not.toContain('should-not-persist');
  });

  it('dead-letters terminal failures and exhausted retry budgets', async () => {
    const store = new FakeDeliveryAttemptStateStore();
    const original = attempt({ attemptNumber: 3, maxAttempts: 3 });
    store.attempts.set(original.id, original);
    const service = new DeliveryAttemptStateService(store);

    const updated = await service.recordDeliveryResult(original, {
      attemptId: original.id,
      tenantId: original.tenantId,
      status: 'failed',
      lastError: 'HTTP 400 from delivery backend',
      retryable: true,
    });

    expect(updated.status).toBe('dead_letter');
    expect(await service.listDeadLetters('tenant_123')).toHaveLength(1);
  });

  it('moves due retry attempts back to pending before dispatch', async () => {
    const store = new FakeDeliveryAttemptStateStore();
    const scheduled = attempt({
      status: 'retry_scheduled',
      attemptNumber: 1,
      nextRetryAt: new Date('2026-05-25T12:00:00Z'),
    });
    store.attempts.set(scheduled.id, scheduled);
    const service = new DeliveryAttemptStateService(store);

    const pending = await service.markRetryDuePending(
      scheduled,
      new Date('2026-05-25T12:01:00Z'),
    );

    expect(pending).toMatchObject({
      status: 'pending',
      attemptNumber: 2,
      nextRetryAt: null,
    });
  });
});

describe('GatewayRetryWorker', () => {
  it('dispatches due retries and summarizes resulting states', async () => {
    const store = new FakeDeliveryAttemptStateStore();
    const scheduled = attempt({
      status: 'retry_scheduled',
      attemptNumber: 1,
      nextRetryAt: new Date('2026-05-25T12:00:00Z'),
    });
    store.attempts.set(scheduled.id, scheduled);
    const state = new DeliveryAttemptStateService(store);
    const dispatcher = {
      async deliverAttempts(): Promise<GatewayDeliveryAttemptOutcome[]> {
        return [
          {
            attemptId: scheduled.id,
            tenantId: scheduled.tenantId,
            endpointType: 'webhook',
            status: 'retry_scheduled',
            retryable: true,
          },
        ];
      },
    };
    const worker = new GatewayRetryWorker(state, dispatcher, {
      now: () => new Date('2026-05-25T12:01:00Z'),
    });

    const summary = await worker.runOnce();

    expect(summary).toEqual({
      due: 1,
      dispatched: 1,
      sent: 0,
      retryScheduled: 1,
      deadLetter: 0,
      skippedNoChannel: 0,
      failed: 0,
    });
  });
});

describe('GatewayAuditService', () => {
  it('redacts delivery audit records before persistence and requires tenant scope', async () => {
    const store = new FakeAuditStore();
    const service = new GatewayAuditService(store);
    const record = await service.recordDeliveryAttempt(
      attempt({
        status: 'failed',
        lastError: 'delivery failed Bearer abc.def?token=hidden',
        responseSummary: {
          status: 500,
          authToken: 'should-not-persist',
        },
      }),
      'webhook',
    );

    expect(record.action).toBe('delivery.failed');
    expect(record.errorSummary).toBe('delivery failed Bearer [REDACTED]?token=[REDACTED]');
    expect(JSON.stringify(record.summary)).not.toContain('should-not-persist');
    await expect(service.listTenantAuditRecords('')).rejects.toThrow('tenantId is required');
  });

  it('tracks skipped_no_channel separately from failures and dead letters', () => {
    const metrics = summarizeDeliveryAttempts([
      attempt({ id: 'sent', status: 'sent' }),
      attempt({ id: 'retry', status: 'retry_scheduled' }),
      attempt({ id: 'dead', status: 'dead_letter' }),
      attempt({ id: 'skipped', status: 'skipped_no_channel' }),
    ]);

    expect(metrics).toEqual({
      total: 4,
      sent: 1,
      failed: 0,
      retryScheduled: 1,
      deadLetter: 1,
      skippedNoChannel: 1,
    });
  });
});
