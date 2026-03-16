/**
 * Automated Pipelines Framework — EventBus Contract
 *
 * Defines the EventEnvelope shape, handler type, and EventBus interface.
 * InMemoryEventBus provides a synchronous in-process implementation for testing.
 */

import { createId } from '@paralleldrive/cuid2';
import type { TriggerEventType } from '../types.js';

// ============================================================
// TYPES
// ============================================================

export interface EventEnvelope {
  id: string;
  tenantId: string;
  eventType: TriggerEventType;
  payload: Record<string, unknown>;
  createdAt: Date;
}

export type EventHandler = (event: EventEnvelope) => Promise<void>;

// ============================================================
// INTERFACE
// ============================================================

export interface EventBus {
  /**
   * Publish an event. Returns the generated event ID.
   */
  publish(
    tenantId: string,
    eventType: TriggerEventType,
    payload: Record<string, unknown>,
  ): Promise<string>;

  /**
   * Subscribe a handler for a specific event type.
   * Returns a subscription ID that can be passed to unsubscribe().
   */
  subscribe(eventType: TriggerEventType, handler: EventHandler): string;

  /**
   * Remove a previously registered subscription.
   */
  unsubscribe(subscriptionId: string): void;

  /**
   * Gracefully shut down the bus and release resources.
   */
  close(): Promise<void>;
}

// ============================================================
// IN-MEMORY IMPLEMENTATION (testing)
// ============================================================

interface Subscription {
  eventType: TriggerEventType;
  handler: EventHandler;
}

export class InMemoryEventBus implements EventBus {
  private readonly subscriptions = new Map<string, Subscription>();

  async publish(
    tenantId: string,
    eventType: TriggerEventType,
    payload: Record<string, unknown>,
  ): Promise<string> {
    const id = createId();
    const envelope: EventEnvelope = { id, tenantId, eventType, payload, createdAt: new Date() };

    const dispatches: Promise<void>[] = [];
    for (const sub of this.subscriptions.values()) {
      if (sub.eventType === eventType) {
        dispatches.push(sub.handler(envelope));
      }
    }
    await Promise.all(dispatches);

    return id;
  }

  subscribe(eventType: TriggerEventType, handler: EventHandler): string {
    const subscriptionId = createId();
    this.subscriptions.set(subscriptionId, { eventType, handler });
    return subscriptionId;
  }

  unsubscribe(subscriptionId: string): void {
    this.subscriptions.delete(subscriptionId);
  }

  async close(): Promise<void> {
    this.subscriptions.clear();
  }
}
