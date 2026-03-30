/**
 * Event Adapter — Buffer Drain Worker
 *
 * Background worker that polls the webhook_event buffer for pending events,
 * translates them to trigger calls, forwards to Spec 009, and updates status.
 *
 * Uses setTimeout recursion (not setInterval) to prevent overlapping ticks.
 * Handles graceful shutdown: current batch completes before the worker exits.
 */

import { eq } from 'drizzle-orm';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';

import { eventSources, eventScheduledTasks } from '../schema.js';
import type { WebhookEvent } from '../schema.js';
import { BUFFER_DRAIN_INTERVAL_MS } from '../types.js';
import {
  claimEvent,
  markDelivered,
  markFailed,
  escalateToDeadLetter,
  getRetryableEvents,
  requeueForRetry,
  queryEvents,
} from '../services/event-buffer.js';
import { translateEvent, TranslationError, fanOutPlatformEvent } from '../services/event-translator.js';
import { TriggerForwarder, type TriggerCall } from '../services/trigger-forwarder.js';
import { AutomationForwarder } from '../services/automation-forwarder.js';

// ============================================================
// TYPES
// ============================================================

export interface BufferDrainConfig {
  /** Drain interval in ms (default: BUFFER_DRAIN_INTERVAL_MS) */
  intervalMs?: number;
  /** Max events per batch (default: 10) */
  batchSize?: number;
}

// ============================================================
// WORKER
// ============================================================

const DEFAULT_BATCH_SIZE = 10;

export class BufferDrainWorker {
  private running = false;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private readonly intervalMs: number;
  private readonly batchSize: number;
  private readonly db: NodePgDatabase<Record<string, unknown>>;
  private readonly forwarder: TriggerForwarder;
  private readonly automationForwarder?: AutomationForwarder;

  constructor(
    db: NodePgDatabase<Record<string, unknown>>,
    forwarder: TriggerForwarder,
    config: BufferDrainConfig = {},
    automationForwarder?: AutomationForwarder,
  ) {
    this.db = db;
    this.forwarder = forwarder;
    this.automationForwarder = automationForwarder;
    this.intervalMs = config.intervalMs ?? BUFFER_DRAIN_INTERVAL_MS;
    this.batchSize = config.batchSize ?? DEFAULT_BATCH_SIZE;
  }

  /**
   * Start the drain worker. Begins polling immediately.
   */
  async start(): Promise<void> {
    if (this.running) return;
    this.running = true;
    console.log(`[event-adapter] Buffer drain worker started (interval: ${this.intervalMs}ms, batch: ${this.batchSize})`);
    await this.tick();
  }

  /**
   * Stop the drain worker gracefully. Current batch completes before exit.
   */
  stop(): void {
    this.running = false;
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    console.log('[event-adapter] Buffer drain worker stopped');
  }

  get isRunning(): boolean {
    return this.running;
  }

  // ============================================================
  // INTERNAL
  // ============================================================

  private async tick(): Promise<void> {
    if (!this.running) return;

    try {
      await this.requeueRetryableEvents();
      await this.drainBatch();
    } catch (err) {
      console.error('[event-adapter] Buffer drain error', err);
    }

    if (this.running) {
      this.timer = setTimeout(() => this.tick(), this.intervalMs);
    }
  }

  /**
   * Find failed events eligible for retry and requeue them as pending.
   */
  private async requeueRetryableEvents(): Promise<void> {
    const retryable = await getRetryableEvents(this.db);
    for (const event of retryable) {
      await requeueForRetry(this.db, event.id);
    }
  }

  /**
   * Claim and process a batch of pending events.
   */
  private async drainBatch(): Promise<void> {
    // Get pending events
    const { events } = await queryEvents(this.db, {
      status: 'pending',
      limit: this.batchSize,
    });

    if (events.length === 0) return;

    // Claim and process concurrently
    const results = await Promise.allSettled(
      events.map((event) => this.processEvent(event)),
    );

    // Log any unexpected rejections (processEvent should not throw)
    for (const result of results) {
      if (result.status === 'rejected') {
        console.error('[event-adapter] Unexpected drain error', result.reason);
      }
    }
  }

  /**
   * Process a single event: claim → translate → forward → update status.
   */
  private async processEvent(event: WebhookEvent): Promise<void> {
    const startTime = Date.now();

    // Claim the event (optimistic lock)
    const claimed = await claimEvent(this.db, event.id);
    if (!claimed) return; // Already claimed by another worker

    // Load associated source or schedule
    let source = null;
    let schedule = null;

    if (claimed.sourceId) {
      const [s] = await this.db
        .select()
        .from(eventSources)
        .where(eq(eventSources.id, claimed.sourceId));
      source = s ?? null;
    }

    if (claimed.scheduleId) {
      const [s] = await this.db
        .select()
        .from(eventScheduledTasks)
        .where(eq(eventScheduledTasks.id, claimed.scheduleId));
      schedule = s ?? null;
    }

    // Translate
    let triggerCall: TriggerCall;
    try {
      triggerCall = translateEvent(claimed, source, schedule);
    } catch (err) {
      if (err instanceof TranslationError) {
        // Translation errors indicate misconfiguration — escalate to dead letter
        await markFailed(this.db, claimed.id, `Translation error: ${err.message}`);
        await escalateToDeadLetter(this.db, claimed.id);
        return;
      }
      throw err;
    }

    // Forward to Spec 009
    const result = await this.forwarder.forwardTrigger(triggerCall);
    const processingDurationMs = Date.now() - startTime;

    if (result.success) {
      await markDelivered(this.db, claimed.id, {
        translatedTrigger: {
          ...triggerCall,
          runId: result.runId,
        },
        triggerType: triggerCall.triggerType,
        pipelineId: triggerCall.pipelineId,
        processingDurationMs,
      });

      // Fan out to tenant subscribers if this is a platform-wide source
      if (source?.isPlatformWide) {
        try {
          const fanOut = await fanOutPlatformEvent(this.db, claimed, triggerCall, this.forwarder);
          console.log(`[event-adapter] Platform fan-out: ${fanOut.succeeded} succeeded, ${fanOut.failed} failed`);
        } catch (err) {
          console.error('[event-adapter] Platform fan-out error', err);
          // Don't fail the primary event
        }
      }

      // Forward to automation destination (fire-and-forget)
      if (this.automationForwarder) {
        setImmediate(() =>
          this.automationForwarder!.forwardToAutomation(claimed, triggerCall).catch((err) =>
            console.error('[event-adapter] automation forward error', err)
          )
        );
      }
    } else {
      await markFailed(this.db, claimed.id, result.error ?? 'Unknown forwarding error');
    }
  }
}
