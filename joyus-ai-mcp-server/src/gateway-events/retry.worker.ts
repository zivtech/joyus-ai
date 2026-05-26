import type { GatewayEventDeliveryAttempt } from '../db/schema/gateway-events.js';

import { DeliveryAttemptStateService } from './dead-letter.service.js';
import type { GatewayDeliveryAttemptOutcome } from './delivery.service.js';
import type { DeliveryStatus } from './types.js';

export interface DeliveryAttemptDispatcher {
  deliverAttempts(attempts: GatewayEventDeliveryAttempt[]): Promise<GatewayDeliveryAttemptOutcome[]>;
}

export interface GatewayRetryWorkerOptions {
  batchSize?: number;
  intervalMs?: number;
  now?: () => Date;
  logger?: Pick<Console, 'warn' | 'error'>;
}

export interface GatewayRetryWorkerSummary {
  due: number;
  dispatched: number;
  sent: number;
  retryScheduled: number;
  deadLetter: number;
  skippedNoChannel: number;
  failed: number;
}

const DEFAULT_BATCH_SIZE = 100;
const DEFAULT_INTERVAL_MS = 30_000;

export class GatewayRetryWorker {
  private readonly batchSize: number;
  private readonly intervalMs: number;
  private readonly now: () => Date;
  private readonly logger?: Pick<Console, 'warn' | 'error'>;
  private timer?: ReturnType<typeof setInterval>;

  constructor(
    private readonly state: DeliveryAttemptStateService,
    private readonly dispatcher: DeliveryAttemptDispatcher,
    options: GatewayRetryWorkerOptions = {},
  ) {
    this.batchSize = options.batchSize ?? DEFAULT_BATCH_SIZE;
    this.intervalMs = options.intervalMs ?? DEFAULT_INTERVAL_MS;
    this.now = options.now ?? (() => new Date());
    this.logger = options.logger;
  }

  async runOnce(): Promise<GatewayRetryWorkerSummary> {
    const due = await this.state.listDueRetryAttempts(this.now(), this.batchSize);
    const pendingAttempts: GatewayEventDeliveryAttempt[] = [];

    for (const attempt of due) {
      try {
        pendingAttempts.push(await this.state.markRetryDuePending(attempt, this.now()));
      } catch (error) {
        this.logger?.warn('gateway retry attempt skipped', {
          attemptId: attempt.id,
          tenantId: attempt.tenantId,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }

    const outcomes = pendingAttempts.length > 0
      ? await this.dispatcher.deliverAttempts(pendingAttempts)
      : [];

    return summarizeRetryOutcomes(due.length, pendingAttempts.length, outcomes);
  }

  start(): void {
    if (this.timer) {
      return;
    }

    this.timer = setInterval(() => {
      this.runOnce().catch((error) => {
        this.logger?.error('gateway retry worker failed', {
          error: error instanceof Error ? error.message : String(error),
        });
      });
    }, this.intervalMs);
  }

  stop(): void {
    if (!this.timer) {
      return;
    }

    clearInterval(this.timer);
    this.timer = undefined;
  }
}

export function summarizeRetryOutcomes(
  due: number,
  dispatched: number,
  outcomes: GatewayDeliveryAttemptOutcome[],
): GatewayRetryWorkerSummary {
  const counts: Record<DeliveryStatus, number> = {
    pending: 0,
    sent: 0,
    failed: 0,
    retry_scheduled: 0,
    dead_letter: 0,
    skipped_no_channel: 0,
  };

  for (const outcome of outcomes) {
    counts[outcome.status] += 1;
  }

  return {
    due,
    dispatched,
    sent: counts.sent,
    retryScheduled: counts.retry_scheduled,
    deadLetter: counts.dead_letter,
    skippedNoChannel: counts.skipped_no_channel,
    failed: counts.failed,
  };
}
